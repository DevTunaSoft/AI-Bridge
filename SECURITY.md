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
| S-11 | No rate limiting on the HTTP API, WebSocket messages, or unbounded extension responses. | Medium | **Fixed** (global limits, loopback-only server) | HTTP token bucket on `/v1/*` (60/min, `BRIDGE_RATE_LIMIT_PER_MINUTE`, 429 + `Retry-After`); extension socket token bucket (burst 200, 100/s, excess closes with 1008); 2,000,000-character response cap. Evidence: `HTTP API is rate limited per minute…`, `an extension socket that floods messages is disconnected…`, `a runaway extension response is cut off…`. Limits are global, not per client, which is acceptable for a single-user loopback service. |
| S-12 | `/health` is unauthenticated and reveals connected-extension count, active request ID and queue length. | Low | **Open (decision)** | Loopback-only and Host/Origin-checked. Owner to decide whether to require auth or reduce fields. |
| S-13 | Token and API-key files on Windows do not get owner-only ACLs (`mode 0600` is ignored there). | Medium | **Open** | Needs Windows ACL hardening (P6). README notes the limitation. |
| S-14 | Extension requests the `tabs` permission and loopback host permissions it may not need. | Low | **Open (needs real-site test)** | Removing `tabs` changes what `chrome.tabs.query({url})` returns. That can only be verified on a real logged-in provider tab, which this container cannot reach. Planned for the Windows run. |
| S-15 | Extension forwarded any `bridge:site-message` verbatim to the server, so a content script in another tab could inject text into a job. | Medium | **Fixed** | `extension/site-message-policy.js`: accepts only messages from this extension, from the tab the job was dispatched to, with a known type and bounded fields; forwards only validated fields. Evidence: `test/site-message-policy.test.mjs` (5 tests). Not yet exercised in a real AI tab. |
| S-16 | First-install race: `onInstalled` wrote defaults back to storage, which could overwrite settings saved just after install (reproduced once in headless Chromium, and the storage probe showed the overwrite). | Low | **Fixed** | Removed the write-back; defaults are applied on read. Evidence: `tools/e2e/extension-roundtrip.cjs` passes twice in a row with no wait before saving settings. |
| S-17 | Tool-call extraction was best-effort: bare, fenced or quoted JSON could become an executable tool call. | High (for unattended use) | **Fixed at the protocol level** | Strict protocol in `tool-calls.mjs`: whole-reply block only, per-request nonce, exact tool name, JSON-schema validation with fail-closed keywords, single block, transcript pairing. Evidence: `test/tool-calls.test.mjs` (15 tests) and `fails closed over HTTP…`. **Not verified** with a real model reply in a real chat tab; that is the next Windows test. |
| S-18 | Pre- and post-prompt text (tool and identity instructions) was typed into the visible chat by default. | Privacy / UX | **Fixed (default changed)** | Defaults are now off (`prePrompt`/`postPrompt` = `""`). Tool-protocol instructions still appear in the chat when tools are used, because the bridge must send them. Evidence: `README.md` and `ai-bridge.settings.json`. |
| S-19 | The full conversation transcript is re-sent to the provider as one prompt on every request, so earlier messages are duplicated in the chat history. | Privacy / design | **Open (P3 design)** | Needs a verified session-continuity design (P3). Owner should review what is sent to each provider before enabling multi-provider use. |

## Behaviour changes (breaking, intentional)

- Tool calls are now strict: bare JSON, fenced JSON and quoted examples are plain text. A malformed or unpermitted block returns HTTP 502. Tools with unsupported schema keywords are refused with HTTP 400.
- Pre- and post-prompt instructions are off by default.

- The HTTP API always requires `Authorization: Bearer <API key>`. Placeholder keys are refused. IDEs must use the key from `.ai-bridge-api-key`.
- The bridge token is never printed. Copy it from `.ai-bridge-token`.
- Browser pages cannot call the HTTP API: any request with an `Origin` header is refused, and no CORS headers are sent.
- The extension must be reloaded after the server is updated, because it now sends the token in `Sec-WebSocket-Protocol` and tokens in the URL are refused.
- `/v1/*` requests are limited to 60 per minute by default. Excess requests get HTTP 429 with `Retry-After`. Set `BRIDGE_RATE_LIMIT_PER_MINUTE` to change this. The 60/min default is a judgement call for the owner to confirm.

## Verification

Automated regression tests are in `test/security.test.mjs` and `test/local-server.test.mjs`. Before the fix, the 8 new security tests failed (red run recorded in `TESTING.md`). After the fix, all 28 tests pass. The real-browser check is `tools/e2e/extension-roundtrip.cjs`: it loads the unpacked extension into headless Chromium, connects it with the subprotocol token, and completes one round trip. See `TESTING.md` for the evidence and its limits.

Not yet verified: Microsoft Edge, Windows 11, real logged-in AI chat tabs, and independent security review (P7).
