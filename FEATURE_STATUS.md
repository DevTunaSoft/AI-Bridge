# Feature status

Status is evidence-based. "Verified" means an automated test or a real-browser run exists and passed. Nothing here is marked as verified on Windows or against real AI chat tabs.

| Feature | Status | Evidence / notes |
|---------|--------|------------------|
| Loopback-only HTTP server (`127.0.0.1`) | Partly verified | Server binds `127.0.0.1` and checks the remote address and Host header. No test connects from a non-loopback address; that is a gap. |
| `GET /health` | Verified (test) | `serves the local OpenAI discovery…` |
| `GET /v1/models` (nine providers + auto) | Verified (test) | Discovery test |
| `POST /v1/chat/completions` (non-stream) | Verified (test) | Bridge relay test |
| Streaming (SSE) | Verified (test) | Streamed tool-call and title tests |
| Conversation-title interception | Verified (test) | Title tests (opt-out via `BRIDGE_INTERCEPT_TITLES=0`) |
| Prompt pre/post instructions | Verified (test) | `prompt-instructions.test.mjs` |
| Text-to-`tool_calls` conversion | **Partial, best-effort** | Passes existing tests. Not safe for unattended use: see S-17 and P2. |
| **API-key authentication (mandatory)** | Verified (test) | Changed in P1: always required; auto-generated to `.ai-bridge-api-key` |
| **Bridge token (WebSocket)** | Verified (test + Chromium) | Changed in P1: sent in subprotocol, never printed |
| **CORS** | Removed (test) | No `Access-Control-*` headers; `Origin` requests refused |
| **Host / Origin checks** | Verified (test) | Loopback Host only; extension origin only on WebSocket |
| Chrome MV3 extension connects and round-trips | Verified (headless Chromium, Linux) | `tools/e2e/extension-roundtrip.cjs` |
| Microsoft Edge extension | **Not verified** | Not run |
| Full-prompt insertion + normal Send in real AI tabs | **Not verified** | Existing code path; no real-tab run in this session |
| Provider adapters (nine) | **Not verified** | No real provider run |
| Durable request state machine | **Not implemented** | P3 |
| Windows installer / controller | **Not implemented** | P6 |
