// Real-Chromium check: load the unpacked AI Bridge extension, connect it to the
// hardened local server with the subprotocol token, then do one bridge round trip.
// Requires Playwright with a Chromium channel that supports extensions. Not run by npm test.
// Usage: node tools/e2e/extension-roundtrip.cjs   (set E2E_PORT to change the port)
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "ai-bridge-e2e-"));
const PORT = Number(process.env.E2E_PORT ?? 4327);
const TOKEN = "e2e-extension-token-0123456789";
const API_KEY = "e2e-api-key-0123456789abcdef";

fs.writeFileSync(path.join(SCRATCH, "token"), `${TOKEN}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(SCRATCH, "api-key"), `${API_KEY}\n`, { mode: 0o600 });
fs.copyFileSync(path.join(REPO, "ai-bridge.settings.json"), path.join(SCRATCH, "settings.json"));

const server = spawn(process.execPath, [
  "local-server.mjs",
  `--port=${PORT}`,
  `--token-file=${SCRATCH}/token`,
  `--api-key-file=${SCRATCH}/api-key`,
  `--settings-file=${SCRATCH}/settings.json`,
  `--prompt-instructions-dir=${REPO}/prompt-instructions`,
], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits for the AI Bridge extension's own service worker. If it never appears, the error lists every
// worker and page seen, so a failing run shows what actually loaded.
async function extensionWorker(context) {
  // Chromium can run built-in extension workers too, so pick the one whose manifest is AI Bridge.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const item of context.serviceWorkers().filter((w) => w.url().startsWith("chrome-extension://"))) {
      const name = await item.evaluate(() => (typeof chrome !== "undefined" && chrome.runtime?.getManifest?.().name) || null).catch(() => null);
      if (name === "AI Bridge") return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`AI Bridge service worker not found. Workers: ${JSON.stringify(context.serviceWorkers().map((w) => w.url()))}. Pages: ${JSON.stringify(context.pages().map((p) => p.url()))}`);
}
async function waitUntil(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}

(async () => {
  const results = {};
  await waitUntil("server listening", () => serverLog.includes("listening"), 10_000);
  results.serverStartedWithoutSecrets = !serverLog.includes(TOKEN) && !serverLog.includes(API_KEY);

  const context = await chromium.launchPersistentContext(path.join(SCRATCH, "profile"), {
    channel: "chromium",
    headless: true,
    args: [
      "--no-sandbox",
      `--disable-extensions-except=${REPO}/extension`,
      `--load-extension=${REPO}/extension`,
    ],
  });
  try {
    const worker = await extensionWorker(context);
    results.extensionLoaded = worker.url().startsWith("chrome-extension://");

    await worker.evaluate((settings) => chrome.storage.local.set(settings), {
      serverUrl: `http://127.0.0.1:${PORT}`,
      token: TOKEN,
      defaultProvider: "auto",
      paused: false,
    });
    results.storedTokenReadBack = await worker.evaluate(() => chrome.storage.local.get("token").then((v) => v.token.length > 0));

    const health = async () => (await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json()));
    await waitUntil("extension connected", async () => (await health()).connected_extensions === 1, 20_000);
    results.extensionConnected = true;

    // Round trip: HTTP client -> server -> WebSocket -> real extension -> error reply (no AI tab open).
    const reply = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: "bridge-auto", messages: [{ role: "user", content: "ping" }] }),
    });
    const body = await reply.json();
    results.roundTripStatus = reply.status;
    results.roundTripMessage = body.error?.message ?? null;

    const unauthenticated = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
    results.unauthenticatedModelsStatus = unauthenticated.status;
  } finally {
    await context.close();
    server.kill();
  }

  results.logLeaksToken = serverLog.includes(TOKEN) || serverLog.includes(API_KEY);
  console.log(JSON.stringify(results, null, 2));
  fs.rmSync(SCRATCH, { recursive: true, force: true });
})().catch((error) => {
  console.error("E2E FAILED:", error.message);
  console.error("--- server log ---\n" + serverLog);
  server.kill();
  process.exit(1);
});
