# Testing

## Layers

| Layer | What it proves | How to run | Status |
|-------|----------------|-----------|--------|
| Unit | Tool-call parsing, prompt instructions, name matching | `npm test` (files `test/tool-calls.test.mjs`, `test/prompt-instructions.test.mjs`) | 20/20 passing (pre-existing) |
| Integration (server, protocol level) | HTTP/WebSocket contracts, auth, Host/Origin, CORS, token handling, startup validation | `npm test` (`test/local-server.test.mjs`, `test/security.test.mjs`) | 28/28 total passing with the P1 change set |
| Real browser (Chromium, extension loaded) | Unpacked MV3 extension connects with the subprotocol token and completes a round trip | `node tools/e2e/extension-roundtrip.cjs` (needs Playwright with a Chromium channel that supports extensions) | Passing on Linux headless Chromium |
| Real AI chat tabs (ChatGPT, Claude, etc.) | Composer insertion, Send, response extraction | Not run | **Not verified** |
| Windows 11 / Edge | Install, start, extension load, OpenCode | Not run | **Not verified** |

## Evidence for the P1 change set

Red-first: the 8 new tests in `test/security.test.mjs` were run against the unmodified server before any fix. All 8 failed for the reasons they target (for example `bridge token leaked into startup output`, `'*' !== undefined` for CORS, `ENOENT … api-key` when no key file existed, and `server accepted a short token and kept running`). Output: `red.txt` in the session scratchpad.

Green: after the fix, `npm test` exited 0 with `# tests 28 / # pass 28 / # fail 0`.

Real browser: `node tools/e2e/extension-roundtrip.cjs` printed:

```json
{
  "serverStartedWithoutSecrets": true,
  "extensionLoaded": true,
  "storedTokenReadBack": true,
  "extensionConnected": true,
  "roundTripStatus": 502,
  "roundTripMessage": "Open a logged-in supported AI chat tab, then retry.",
  "unauthenticatedModelsStatus": 401,
  "logLeaksToken": false
}
```

The 502 is expected: no AI chat tab was open, so the extension answered with its own error. That shows the request reached the real extension and the reply came back. It does not show an AI response.

## Known test caveats

- The round-trip script waits 2 s after the extension starts before writing settings. Without this, the extension's first-install handler can overwrite them (see S-16 in `SECURITY.md`).
- The round-trip script needs `--no-sandbox` because it runs as root in this container. This is not needed on a normal Windows or macOS desktop.
- Tests spawn `local-server.mjs` on random free ports and use temp directories. They do not read or write the repository's secret files.

## Commands

```bash
npm test
node tools/e2e/extension-roundtrip.cjs
```
