import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "security-test-token-0123456789abcdef";
const API_KEY = "security-test-api-key-0123456789abcdef";
const WS_PROTOCOL = "ai-bridge.v1";

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  await once(probe, "close");
  return port;
}

// Starts local-server.mjs with isolated files and no inherited BRIDGE_* secrets.
async function startServer(context, extraArgs = [], { keepSecretEnv = false } = {}) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ai-bridge-security-"));
  context.after(async () => fs.rm(workspace, { recursive: true, force: true }));
  const settingsFile = path.join(workspace, "ai-bridge.settings.json");
  await fs.writeFile(settingsFile, `${JSON.stringify({
    interceptTitleRequests: true,
    injectPromptInstructionsEveryMessage: false,
    prePrompt: "",
    postPrompt: "",
  }, null, 2)}\n`);

  const env = { ...process.env };
  if (!keepSecretEnv) {
    for (const name of ["BRIDGE_TOKEN", "BRIDGE_TOKEN_FILE", "BRIDGE_API_KEY", "BRIDGE_API_KEY_FILE"]) delete env[name];
  }
  const port = await freePort();
  const child = spawn(process.execPath, [
    "local-server.mjs",
    `--port=${port}`,
    `--settings-file=${settingsFile}`,
    `--prompt-instructions-dir=${path.join(workspace, "prompt-instructions")}`,
    ...extraArgs,
  ], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => child.kill());

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = once(child, "exit");
  await waitFor(() => output.includes("listening") || child.exitCode !== null, 10_000);
  return { port, child, workspace, output: () => output, exited };
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Sends a raw HTTP request so tests can control Host and Origin headers exactly.
function httpRequest(port, { method = "GET", target = "/health", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method, path: target, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

// Sends a raw WebSocket upgrade request and returns the status line and headers.
function rawUpgrade(port, { target = "/bridge", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let data = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Upgrade timed out.")); }, 5_000);
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve({ status: Number(data.split(" ")[1]), raw: data });
      }
    });
    socket.on("close", () => { clearTimeout(timer); resolve({ status: Number(data.split(" ")[1]) || 0, raw: data }); });
    socket.on("error", reject);
    const { Host: hostOverride, ...otherHeaders } = headers;
    const lines = [
      `GET ${target} HTTP/1.1`,
      `Host: ${hostOverride ?? `127.0.0.1:${port}`}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
      ...Object.entries(otherHeaders).map(([name, value]) => `${name}: ${value}`),
      "",
      "",
    ];
    socket.write(lines.join("\r\n"));
  });
}

test("startup output never contains the bridge token or the API key", async (context) => {
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key=${API_KEY}`]);
  assert.ok(server.output().includes("listening"));
  assert.equal(server.output().includes(TOKEN), false, "bridge token leaked into startup output");
  assert.equal(server.output().includes(API_KEY), false, "API key leaked into startup output");
});

test("generated bridge token is stored in the token file and never printed", async (context) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ai-bridge-printed-token-"));
  context.after(async () => fs.rm(workspace, { recursive: true, force: true }));
  const tokenFile = path.join(workspace, "token");
  const apiKeyFile = path.join(workspace, "api-key");
  const server = await startServer(context, [`--token-file=${tokenFile}`, `--api-key-file=${apiKeyFile}`]);
  const stored = (await fs.readFile(tokenFile, "utf8")).trim();
  assert.ok(stored.length >= 32, "generated token should be at least 32 characters");
  assert.equal(server.output().includes(stored), false, "generated token leaked into startup output");
});

test("HTTP API requires an API key even when none was configured", async (context) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ai-bridge-apikey-"));
  context.after(async () => fs.rm(workspace, { recursive: true, force: true }));
  const apiKeyFile = path.join(workspace, "api-key");
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key-file=${apiKeyFile}`]);
  const generatedKey = (await fs.readFile(apiKeyFile, "utf8")).trim();
  assert.ok(generatedKey.length >= 32, "generated API key should be at least 32 characters");

  const anonymous = await httpRequest(server.port, { target: "/v1/models" });
  assert.equal(anonymous.status, 401);

  const wrong = await httpRequest(server.port, { target: "/v1/models", headers: { authorization: "Bearer not-the-key" } });
  assert.equal(wrong.status, 401);

  const prefixOnly = await httpRequest(server.port, { target: "/v1/models", headers: { authorization: `Bearer ${generatedKey}x` } });
  assert.equal(prefixOnly.status, 401);

  const valid = await httpRequest(server.port, { target: "/v1/models", headers: { authorization: `Bearer ${generatedKey}` } });
  assert.equal(valid.status, 200);
});

test("HTTP responses carry no CORS grant and browser-origin requests are refused", async (context) => {
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key=${API_KEY}`]);

  const plain = await httpRequest(server.port, { target: "/health" });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers["access-control-allow-origin"], undefined);

  const fromWebPage = await httpRequest(server.port, {
    method: "POST",
    target: "/v1/chat/completions",
    headers: { origin: "https://evil.example", "content-type": "text/plain", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: "bridge-auto", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(fromWebPage.status, 403);
  assert.equal(fromWebPage.headers["access-control-allow-origin"], undefined);

  const preflight = await httpRequest(server.port, { method: "OPTIONS", target: "/v1/models", headers: { origin: "https://evil.example" } });
  assert.notEqual(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], undefined);
});

test("DNS-rebinding style Host headers are refused on HTTP", async (context) => {
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key=${API_KEY}`]);

  const rebound = await httpRequest(server.port, { target: "/health", headers: { host: "evil.example" } });
  assert.equal(rebound.status, 403);

  const reboundWithPort = await httpRequest(server.port, { target: "/health", headers: { host: `evil.example:${server.port}` } });
  assert.equal(reboundWithPort.status, 403);

  const loopback = await httpRequest(server.port, { target: "/health", headers: { host: `127.0.0.1:${server.port}` } });
  assert.equal(loopback.status, 200);

  const localhost = await httpRequest(server.port, { target: "/health", headers: { host: `localhost:${server.port}` } });
  assert.equal(localhost.status, 200);
});

test("WebSocket upgrade refuses web-page origins and wrong or URL-carried tokens", async (context) => {
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key=${API_KEY}`]);
  const protocols = `${WS_PROTOCOL}, ai-bridge.token.${TOKEN}`;

  const fromWebPage = await rawUpgrade(server.port, { headers: { "Sec-WebSocket-Protocol": protocols, Origin: "https://grok.com" } });
  assert.equal(fromWebPage.status, 403);

  const wrongToken = await rawUpgrade(server.port, { headers: { "Sec-WebSocket-Protocol": `${WS_PROTOCOL}, ai-bridge.token.wrong-token-0123456789` } });
  assert.equal(wrongToken.status, 401);

  const tokenInUrl = await rawUpgrade(server.port, { target: `/bridge?token=${TOKEN}` });
  assert.equal(tokenInUrl.status, 401, "tokens must not be accepted from the URL");

  const reboundUpgrade = await rawUpgrade(server.port, { headers: { "Sec-WebSocket-Protocol": protocols, Host: "evil.example" } });
  assert.equal(reboundUpgrade.status, 403);
});

test("WebSocket upgrade accepts the extension origin and echoes the protocol", async (context) => {
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key=${API_KEY}`]);
  const accepted = await rawUpgrade(server.port, {
    headers: {
      "Sec-WebSocket-Protocol": `${WS_PROTOCOL}, ai-bridge.token.${TOKEN}`,
      Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    },
  });
  assert.equal(accepted.status, 101);
  assert.match(accepted.raw, /Sec-WebSocket-Protocol: ai-bridge\.v1/);
  assert.doesNotMatch(accepted.raw, new RegExp(TOKEN));
});

test("HTTP API is rate limited per minute, while health stays available", async (context) => {
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key=${API_KEY}`, "--rate-limit-per-minute=5"]);
  const auth = { authorization: `Bearer ${API_KEY}` };
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await httpRequest(server.port, { target: "/v1/models", headers: auth })).status, 200);
  }
  const limited = await httpRequest(server.port, { target: "/v1/models", headers: auth });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers["retry-after"], "429 must say when to retry");
  assert.equal((await httpRequest(server.port, { target: "/health" })).status, 200);
});

test("a runaway extension response is cut off at the size cap instead of growing without bound", async (context) => {
  const server = await startServer(context, [`--token=${TOKEN}`, `--api-key=${API_KEY}`]);
  const extension = new WebSocket(`ws://127.0.0.1:${server.port}/bridge`, [WS_PROTOCOL, `ai-bridge.token.${TOKEN}`]);
  context.after(() => extension.close());
  await new Promise((resolve, reject) => {
    extension.addEventListener("open", resolve, { once: true });
    extension.addEventListener("error", () => reject(new Error("Extension test socket could not connect.")), { once: true });
  });
  extension.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== "bridge:run") return;
    const chunk = "a".repeat(900_000);
    for (let index = 0; index < 3; index += 1) {
      extension.send(JSON.stringify({ type: "bridge:chunk", id: message.id, text: chunk }));
    }
  });
  extension.send(JSON.stringify({ type: "bridge:hello", version: "test", providers: [] }));

  const reply = await httpRequest(server.port, {
    method: "POST",
    target: "/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: "bridge-auto", messages: [{ role: "user", content: "stress" }] }),
  });
  assert.equal(reply.status, 502);
  assert.match(reply.text, /size limit/);
});

test("refuses to start with a bridge token or API key shorter than 16 characters", async (context) => {
  const port = await freePort();
  const child = spawn(process.execPath, ["local-server.mjs", `--port=${port}`, "--token=short", `--api-key=${API_KEY}`], {
    cwd: repoRoot,
    env: { ...process.env, BRIDGE_TOKEN: "", BRIDGE_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill());
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exitCode = await Promise.race([
    once(child, "exit").then(([code]) => code),
    new Promise((resolve) => setTimeout(() => resolve("still-running"), 5_000)),
  ]);
  assert.notEqual(exitCode, "still-running", "server accepted a short token and kept running");
  assert.notEqual(exitCode, 0, "server must refuse a short token");
  assert.equal(output.includes("listening"), false);
  assert.match(output, /at least 16 characters/);
});
