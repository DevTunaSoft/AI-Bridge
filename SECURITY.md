# Security audit and hardening status

Last reviewed: 2026-11-20 against commit `589d774` (plus the P1 change set on `claude/jolly-shannon-p3tocj`).
Scope: `local-server.mjs`, `tool-calls.mjs`, `extension/*`, `README.md` instructions. Requirements come from `MASTER_ENGINEERING_PLAN.md` ("Security controls — release blocking").

Status legend: **Fixed** = code change plus automated regression test that failed before the fix. **Open** = known, not yet addressed. **Partial** = mitigated, with a documented gap.

## Findings

| ID | Finding (verified in code before the fix) | Severity | Status | Evidence |
|----|-------------------------------------------|----------|--------|----------|
| S-01 | Bridge token printed in plain text at startup (`local-server.mjs` startup log). | High | **Fixed** | `startup output never contains the bridge token or the API key`; `generated bridge token is stored in the token file and never printed` |
| S-02 | Wildcard CORS (`Access-Control-Allow-Origin: *`) on every response. Any web page could read API output. | High | **Fixed** | `HTTP responses carry no CORS grant and browser-origin requests are refused` |
| S-03 | HTTP API unauthenticated when `BRIDGE_API_KEY` unset (`isAuthorized` returned `true`). Any local or web-page request could queue prompts into the logged-in chat tab. | Critical | **Fixed** | `HTTP API requires an API key even when none was configured`; `HTTP responses carry no CORS grant…` (browser-origin POST refused) |
| S-04 | `--api-key` flag never parsed (code read `args.apiKey`, but `parseArgs` stores `api-key`). | Medium | **Fixed** (as part of S-03) | `HTTP API requires an API key…` (uses `--api-key-file`; `--api-key` covered by startup test) |
| S-05 | No Host-header check: DNS rebinding from a hostile domain resolving to 127.0.0.1 could reach the API. | High | **Fixed** | `DNS-rebinding style Host headers are refused on HTTP`; `WebSocket upgrade refuses … ` (Host check on upgrade) |
| S-06 | No Origin check on WebSocket upgrade; any web page could attempt to attach as an "extension" if it knew the token. | High | **Fixed** | `WebSocket upgrade refuses web-page origins and wrong or URL-carried tokens`; `WebSocket upgrade accepts the extension origin and echoes the protocol` |
| S-07 | Bridge token passed in the WebSocket URL query string (`?token=`), where it is logged by proxies and some tools. | Medium | **Fixed** | `WebSocket upgrade refuses … URL-carried tokens`; extension `background.js` now uses `Sec-WebSocket-Protocol` |
| S-08 | Token comparison used `!==` (not constant-time). | Low | **Fixed** | Covered by `safeEqual` in the WebSocket and API tests (behavioural only) |
| S-09 | Weak or placeholder secrets accepted (e.g. `choose-a-local-secret`, `test`). | Medium | **Fixed** | `refuses to start with a bridge token or API key shorter than 16 characters` |
| S-10 | Extension popup placeholder and README told users to copy a printed token. | Low | **Fixed** | Docs and `popup.html` updated to read `.ai-bridge-token` |
| S-11 | No rate limiting on the HTTP API or WebSocket messages. | Medium | **Open** | Queue bound (10) limits backlog only. Needs per-client token-bucket and body/message rate limits. |
| S-12 | `/health` is unauthenticated and reveals connected-extension count, active request ID and queue length. | Low | **Open (decision)** | Loopback-only and Host/Origin-checked. Owner to decide whether to require auth or reduce fields. |
| S-13 | Token and API-key files on Windows do not get owner-only ACLs (`mode 0600` is ignored there). | Medium | **Open** | Needs Windows ACL hardening (P6). README notes the limitation. |
| S-14 | Extension requests `tabs` permission and loopback host permissions it may not need. | Low | **Open** | Minimum-permission review pending (P1 follow-up). |
| S-15 | Extension accepts `bridge:site-message` from any content script without schema validation. | Low | **Open** | Content scripts run only on the nine named sites. Schema validation pending. |
| S-16 | First-install race: `onInstalled` writes defaults after the user saves settings, which can overwrite them in a brand-new profile. | Low | **Open** | Reproduced in headless Chromium; the test waits for it. Fix: merge defaults rather than overwrite. |
| S-17 | Tool-call extraction is best-effort (quoted text and prose can become tool calls). | High (for unattended use) | **Open — P2** | Requires strict delimiter, schema validation and allowlist work; not part of P1. |

## Behaviour changes (breaking, intentional)

- The HTTP API always requires `Authorization: Bearer <API key>`. Placeholder keys are refused. IDEs must use the key from `.ai-bridge-api-key`.
- The bridge token is never printed. Copy it from `.ai-bridge-token`.
- Browser pages cannot call the HTTP API: any request with an `Origin` header is refused, and no CORS headers are sent.
- The extension must be reloaded after the server is updated, because it now sends the token in `Sec-WebSocket-Protocol` and tokens in the URL are refused.

## Verification

Automated regression tests are in `test/security.test.mjs` and `test/local-server.test.mjs`. Before the fix, the 8 new security tests failed (red run recorded in `TESTING.md`). After the fix, all 28 tests pass. The real-browser check is `tools/e2e/extension-roundtrip.cjs`: it loads the unpacked extension into headless Chromium, connects it with the subprotocol token, and completes one round trip. See `TESTING.md` for the evidence and its limits.

Not yet verified: Microsoft Edge, Windows 11, real logged-in AI chat tabs, and independent security review (P7).
