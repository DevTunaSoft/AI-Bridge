// Autonomous browser test with a MOCKED provider page.
//
// What is real: headless Chromium, the unpacked MV3 extension and its content script, the local
// server, the strict tool-call protocol, and the composer -> Send -> response-extraction path.
// What is mocked: the chat website. Playwright serves a local fake "chat.deepseek.com" page whose
// model replies are scripted. A passing run does NOT show how the real provider behaves.
//
// Usage: node tools/e2e/fake-provider-roundtrip.cjs     (needs Playwright with a Chromium channel)

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "ai-bridge-fake-"));
const PORT = Number(process.env.E2E_PORT ?? 4337);
const TOKEN = "fake-provider-token-0123456789abcdef";
const API_KEY = "fake-provider-api-key-0123456789abcdef";
const PROVIDER_URL = "https://chat.deepseek.com/";

// The fake provider page. Its "model" reads the prompt that arrived in the composer and answers
// according to a scenario tag in the last user turn. Replies stream in slowly, like a real chat.
const FAKE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fake DeepSeek</title></head>
<body>
<main id="log"></main>
<div id="composer"><textarea id="chat-input" placeholder="Message DeepSeek"></textarea>
<button id="send" aria-label="Send">Send</button></div>
<script>
const input = document.getElementById("chat-input");
const log = document.getElementById("log");
window.__sendCount = 0;
window.__lastPrompt = "";
function fakeModel(prompt) {
  if (prompt.includes("TOOL RESULT (tool_call_id")) return "The listing was received: a.txt";
  const lastUser = prompt.slice(prompt.lastIndexOf("USER:\\n"));
  const nonce = (prompt.match(/<<AIB:CALL:([A-Za-z0-9_-]+)>>/) || [])[1] || "missing";
  const block = (body, n) => "<<AIB:CALL:" + (n || nonce) + ">>\\n" + body + "\\n<<AIB:END:" + (n || nonce) + ">>";
  const call = '{"name":"Bash","arguments":{"command":"ls"}}';
  if (lastUser.includes("CMD_PONG")) return "pong";
  if (lastUser.includes("CMD_VALID")) return block(call);
  if (lastUser.includes("CMD_FORGED")) return block(call, "forged-nonce-0000");
  if (lastUser.includes("CMD_QUOTED")) return "Example only: " + block(call);
  if (lastUser.includes("CMD_BARE")) return call;
  return "unrecognised scenario";
}
document.getElementById("send").addEventListener("click", () => {
  const prompt = input.value;
  if (!prompt.trim()) return;
  window.__sendCount += 1;
  window.__lastPrompt = prompt;
  input.value = "";
  const reply = document.createElement("div");
  reply.className = "ds-markdown";
  const stop = document.createElement("button");
  stop.setAttribute("aria-label", "Stop");
  stop.textContent = "Stop";
  log.append(reply, stop);
  const answer = fakeModel(prompt);
  let shown = 0;
  const step = () => {
    shown = Math.min(answer.length, shown + 25);
    reply.textContent = answer.slice(0, shown);
    if (shown < answer.length) setTimeout(step, 60);
    else setTimeout(() => stop.remove(), 300);
  };
  setTimeout(step, 300);
});
</script>
</body></html>`;

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

async function ask(body) {
  const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
}

(async () => {
  fs.writeFileSync(path.join(SCRATCH, "token"), `${TOKEN}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(SCRATCH, "api-key"), `${API_KEY}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(SCRATCH, "settings.json"), JSON.stringify({
    interceptTitleRequests: false,
    injectPromptInstructionsEveryMessage: false,
    prePrompt: "",
    postPrompt: "",
  }));

  await waitUntil("server listening", () => serverLog.includes("listening"), 10_000);

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
    await worker.evaluate((settings) => chrome.storage.local.set(settings), {
      serverUrl: `http://127.0.0.1:${PORT}`,
      token: TOKEN,
      defaultProvider: "deepseek",
      paused: false,
    });
    await waitUntil("extension connected", async () => {
      const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json());
      return health.connected_extensions === 1;
    }, 20_000);

    await context.route(`${PROVIDER_URL}**`, (route) => {
      if (route.request().resourceType() === "document") {
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FAKE_PAGE });
      }
      return route.fulfill({ status: 204, body: "" });
    });
    const page = await context.newPage();
    await page.goto(PROVIDER_URL);
    await page.waitForSelector("#chat-input", { timeout: 10_000 });

    const model = "bridge-deepseek";
    const userText = (tag) => `${tag} list the files in the current folder`;

    // 1. Plain text reply through the full browser path.
    const plain = await ask({ model, messages: [{ role: "user", content: userText("CMD_PONG") }] });
    record("plain reply reaches the API", plain.status === 200 && plain.body.choices[0].message.content === "pong", { status: plain.status, content: plain.body.choices[0].message.content });

    // 2. Valid tool block -> OpenAI tool_calls.
    const tools = [{ type: "function", function: { name: "Bash", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } } }];
    const valid = await ask({ model, tools, messages: [{ role: "user", content: userText("CMD_VALID") }] });
    const call = valid.body.choices?.[0]?.message?.tool_calls?.[0];
    record("valid tool block becomes tool_calls", valid.status === 200 && call?.function?.name === "Bash", { status: valid.status, call: call?.function });

    // 3. The prompt that reached the composer was complete and multi-line.
    const lastPrompt = await page.evaluate(() => window.__lastPrompt);
    record("composer received the whole multi-line prompt", lastPrompt.startsWith("USER:\n") && lastPrompt.includes("CMD_VALID") && lastPrompt.trimEnd().endsWith("do not use that block."), { length: lastPrompt.length });

    // 4. Multi-turn: send the tool result back and expect the final answer.
    const followUp = await ask({
      model,
      tools,
      messages: [
        { role: "user", content: userText("CMD_VALID") },
        { role: "assistant", content: null, tool_calls: [call ?? { id: "call_missing", type: "function", function: { name: "Bash", arguments: "{}" } }] },
        { role: "tool", tool_call_id: call?.id ?? "call_missing", content: "a.txt" },
      ],
    });
    const followContent = followUp.body.choices?.[0]?.message?.content ?? "";
    const lastPromptAfterTool = await page.evaluate(() => window.__lastPrompt);
    record("tool result is sent back and answered", followUp.status === 200 && followContent.includes("a.txt"), { status: followUp.status, content: followContent });
    record("transcript carries the earlier tool call and its id", lastPromptAfterTool.includes(`[tool call id=${call?.id} name=Bash]`) && lastPromptAfterTool.includes(`TOOL RESULT (tool_call_id=${call?.id})`), {});

    // 5. Fail-closed cases through the same browser path.
    const forged = await ask({ model, tools, messages: [{ role: "user", content: userText("CMD_FORGED") }] });
    record("forged-nonce block is rejected (502)", forged.status === 502 && /rejected/.test(forged.body.error.message), { status: forged.status, message: forged.body.error?.message });

    const quoted = await ask({ model, tools, messages: [{ role: "user", content: userText("CMD_QUOTED") }] });
    record("quoted block is rejected (502)", quoted.status === 502, { status: quoted.status, message: quoted.body.error?.message });

    const bare = await ask({ model, tools, messages: [{ role: "user", content: userText("CMD_BARE") }] });
    record("bare JSON is plain text, not a tool call", bare.status === 200 && bare.body.choices[0].message.tool_calls === undefined, { status: bare.status });

    record("page received one send per request", (await page.evaluate(() => window.__sendCount)) === 6, { sends: await page.evaluate(() => window.__sendCount) });
    await page.close();
  } finally {
    await context.close();
    server.kill();
  }

  record("server log does not contain the token or key", !serverLog.includes(TOKEN) && !serverLog.includes(API_KEY), {});
  const failed = results.filter((item) => !item.passed);
  console.log(JSON.stringify({ mocked_provider: true, results, passed: results.length - failed.length, failed: failed.length }, null, 2));
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  if (failed.length > 0) process.exit(1);
})().catch((error) => {
  console.error("FAKE-PROVIDER RUN FAILED:", error.message);
  console.error("--- server log ---\n" + serverLog);
  server.kill();
  process.exit(1);
});
