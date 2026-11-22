# AI Bridge

AI Bridge turns a tab you are already logged into on an AI chat website into a **local, OpenAI-compatible** endpoint for a local IDE or agent. It deliberately keeps the two halves on your computer:

```text
IDE / agent ──HTTP──> 127.0.0.1:4317/v1 ──WebSocket──> Chrome extension ──DOM──> logged-in AI chat tab
```

## Supported AI chats

- [Grok](https://grok.com/)
- [Gemini](https://gemini.google.com/app)
- [DeepSeek](https://chat.deepseek.com/)
- [Perplexity](https://www.perplexity.ai/)
- [Qwen](https://chat.qwen.ai/)
- [ChatGPT](https://chatgpt.com/)
- [Claude](https://claude.ai/)
- [Z.ai](https://chat.z.ai/)
- [Kimi](https://www.kimi.com/)

This project borrows the practical idea of a web-chat-to-OpenAI gateway from [geminiweb-as-api](https://github.com/hieonn/geminiweb-as-api) and the extension-first direction of [Quarkonix](https://github.com/nikita-nikita12308/Quarkonix), without copying browser profiles or exposing a remote server.

## Install

1. Install Node.js 20 or newer.
2. From this directory, start the local companion with Run.bat or manually in cmd:

   ```powershell
   npm start
   ```

   On first start it creates two secret files next to `local-server.mjs`: `.ai-bridge-token` (for the extension) and `.ai-bridge-api-key` (for your IDE). Secret values are never printed to the terminal; open the files to copy them. Leave this terminal running. Future starts reuse both files.

3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the `extension` folder in this project.
4. Open the AI Bridge extension, paste the token from `.ai-bridge-token`, and click **Save & connect**.
5. Click a provider in the popup, sign in normally, and leave that tab open. Choose it as the default provider, or use a provider-specific model name.

The server binds only to `127.0.0.1`. It never reads, copies, or uploads Chrome profile files. Each request is serialised because a chat tab can answer only one prompt at a time. While connected, the extension exchanges a heartbeat every 20 seconds, so its Manifest V3 service worker remains active indefinitely on Chrome 116 or newer. The **Pause** button intentionally stops that connection; **Continue** restores it.

After changing extension files during development, click the extension's **Reload** button on `chrome://extensions`. Restart `npm start` after changing the local server.

## Use from an IDE

Set the IDE's OpenAI-compatible base URL to:

```text
http://127.0.0.1:4317/v1
```

Use `bridge-auto` to route to the configured default provider, or select one explicitly:

```text
bridge-grok       bridge-gemini     bridge-deepseek
bridge-perplexity bridge-qwen       bridge-chatgpt
bridge-claude     bridge-zai        bridge-kimi
```

The local endpoint implements `GET /v1/models`, `POST /v1/chat/completions`, including Server-Sent Events when `stream: true`, and `GET /health`.

Automatic “name this conversation” requests are detected and completed locally; they do not use the active AI-chat tab. Set `BRIDGE_INTERCEPT_TITLES=0` before starting the server to disable this behavior.

```powershell
curl http://127.0.0.1:4317/v1/chat/completions `
  -H 'Content-Type: application/json' `
  -H 'Authorization: Bearer <contents of .ai-bridge-api-key>' `
  -d '{"model":"bridge-gemini","messages":[{"role":"user","content":"Explain this error briefly."}]}'
```

API-key authentication is always on. Every `/v1/*` request must send `Authorization: Bearer <API key>`, where the key is the contents of `.ai-bridge-api-key` (created on first start). To choose your own key instead, set `BRIDGE_API_KEY` (at least 16 characters, letters, digits, `.`, `_`, `~` or `-`) before `npm start`. Placeholder keys such as `sk-local` are not accepted.

Browser pages cannot call this API: requests carrying an `Origin` header are refused and no CORS headers are sent. Use your IDE or a command-line client, not a web page.

The `/v1/*` routes are limited to 60 requests per minute. Requests above that get HTTP 429 with a `Retry-After` header. Set `BRIDGE_RATE_LIMIT_PER_MINUTE` (1 to 10000) to change the limit.

### Bridge-token storage

The bridge token is automatically stored in the ignored `.ai-bridge-token` file, with owner-only permissions where the OS supports them. Delete that file to rotate the token, then paste the new value from the file into the extension. To use a managed token without writing a file, set `BRIDGE_TOKEN`; to choose another location, pass `--token-file <path>` or set `BRIDGE_TOKEN_FILE`. The API key follows the same pattern with `.ai-bridge-api-key`, `BRIDGE_API_KEY`, `--api-key-file` and `BRIDGE_API_KEY_FILE`.

The extension sends the token in the WebSocket subprotocol header, never in the URL. Reload the extension after updating the server, because older extension builds that put the token in the URL are refused.

### Settings

`ai-bridge.settings.json` sits beside the local server and is deliberately readable and versionable:

```json
{
  "interceptTitleRequests": true,
  "injectPromptInstructionsEveryMessage": true,
  "prePrompt": "",
  "postPrompt": "",
  "// disguiseModelNameAsAssistant": "Turning on may increase responsiveness of a model to the prompt",
  "disguiseModelNameAsAssistant": false
}
```

Set `interceptTitleRequests` to `false` to pass IDE conversation-naming calls through to the selected AI website. The environment variable `BRIDGE_INTERCEPT_TITLES=0` overrides this setting for one run. Use `BRIDGE_SETTINGS_FILE` or `--settings-file <path>` to load a settings file from elsewhere.

Set `disguiseModelNameAsAssistant` to `true` to always replace `{{modelName}}` with `an assistant` instead of the provider display name. Turning this on may increase responsiveness of a model to the prompt. Keys that start with `//` are comments and are ignored.

### Prompt instructions

Markdown files under `prompt-instructions/` are wrapped around the bridged chat transcript before it is typed into the AI tab:

```text
prompt-instructions/
  pre-prompt/
    Generic Pre-prompt.md
    ZCode Pre-prompt.md
  post-prompt/
    Generic Post-prompt.md
    ZCode Post-prompt.md
```

- `prePrompt` / `postPrompt` name the active file stem (with or without `.md`). They default to `""` (off), because the text is typed into the visible chat. Name a file to opt in.
- Pre-prompt text is placed at the very start of the outgoing prompt; post-prompt text at the very end.
- With `injectPromptInstructionsEveryMessage: true` (default), both are injected on every chat completion. Set it to `false` to inject only on the first user turn of a conversation (`messages` has at most one `role: "user"` entry).
- Use `{{modelName}}` in either file for the provider display name (for example `Claude`, `Gemini`, `ChatGPT`). Prefer a provider-specific model (`bridge-claude`, …) so the server can substitute immediately; with `bridge-auto`, the placeholder is filled by the content script from the live tab hostname.
- Edit the markdown files anytime; the next request reloads them. Settings changes still require restarting `npm start`.
- Use `BRIDGE_PROMPT_INSTRUCTIONS_DIR` or `--prompt-instructions-dir <path>` to point at another instructions root.

## Notes and limits

- This uses the visible web UI, not a provider's private or undocumented network API. UI changes can require selector updates in `extension/content.js`.
- You are responsible for the terms, plan limits, and acceptable-use rules of every provider you choose to connect.
- File uploads, images, provider-specific citations, and native tool execution are outside the first version.
- Tool calls use a strict protocol. The bridge asks the chat tab for one block wrapped in markers with a random per-request nonce. It returns OpenAI `tool_calls` only when the whole reply is that block, the tool was offered, and the arguments match the tool's JSON schema. Bare JSON, fenced JSON and quoted examples are treated as plain text. A block that breaks any rule returns HTTP 502 instead of guessing. Schemas that use keywords the bridge cannot enforce (for example `oneOf`, `$ref`) are refused with HTTP 400. OpenCode still enforces its own permissions for every action.
- Earlier tool calls and tool results are included in the transcript sent to the chat tab. A tool result whose `tool_call_id` does not match an earlier call is refused with HTTP 400.
- Anything the bridge types into the chat, including the tool-protocol instructions and the full transcript, is visible in that chat's history.
- Claude responses are intentionally emitted once its final response block is stable, rather than streaming its intermediate thinking/status blocks into the IDE.
- Keep the requested provider page fully loaded. If a request says the content script is not ready, reload that tab.
- The extension has permissions only for the nine named chat websites and localhost; it does not have broad `<all_urls>` access.

## Development

```powershell
npm test
```

The tests cover the local health endpoint, model list, title-request interception, bridge relay, streaming, heartbeats, token persistence, prompt-instruction injection, and text-to-`tool_calls` conversion.
