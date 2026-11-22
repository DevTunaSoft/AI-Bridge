# Handoff

Read first: `AGENTS.md`, `MASTER_ENGINEERING_PLAN.md`, `MASTER_AUTONOMOUS_DEVELOPMENT_PROMPT.md`. Then `ROADMAP.md`, `FEATURE_STATUS.md`, `SECURITY.md`, `TESTING.md`.

## Where things stand

- Branch: `claude/jolly-shannon-p3tocj` (the designated development branch for this session). Base: `main` at `589d774`.
- P1: S-01 to S-11 (global limits), S-15 and S-16 are fixed. Open: S-12, S-13 (owner decisions), S-14 (needs a real AI tab). Fixes have tests; most were red before the change.
- P2: strict tool-call protocol implemented (S-17). Protocol-level tests only. No real model reply or OpenCode run yet.
- `npm test`: 43/43 pass. `node tools/e2e/extension-roundtrip.cjs`: passes on headless Chromium (Linux).
- Not done: upstream pin (P0), real model replies for tool calls, OpenCode, Edge, and the Windows tab tests beyond the single-message and multi-turn checks.

## Breaking changes to communicate

0. Tool calls are strict. Tool replies must be exactly one marker block. Anything else is plain text, and a broken block returns 502.
0a. Pre- and post-prompt text is off by default. Users who already have `ai-bridge.settings.json` from an earlier download still have `"Generic Pre-prompt"`; they must change it to `""`.
1. The API key is always required. Existing IDE configs with a placeholder key will get 401. Use the key in `.ai-bridge-api-key`.
2. The bridge token is no longer printed. Copy it from `.ai-bridge-token`.
3. Reload the extension after updating the server (the token is now sent in the WebSocket subprotocol).
4. Browser pages cannot use the HTTP API any more (no CORS, `Origin` refused).

## Decisions taken without the owner (review these)

- Mandatory API key is auto-generated to a file, not printed. The alternative was to reuse the bridge token; a separate key keeps the IDE's credential apart from the extension's.
- Secrets must be at least 16 characters, from `[A-Za-z0-9._~-]`. Tests use 32-character values.
- `/health` remains unauthenticated (S-12 left open for the owner).
- A `--api-key` flag previously never worked (`parseArgs` stores `api-key`); the fix reads `api-key` correctly.

## Environment notes

- Chromium and Playwright are pre-installed. Run the e2e with `NODE_PATH=$(npm root -g)` if `require('playwright')` does not resolve from the repo.
- The e2e script runs Chromium with `--no-sandbox` because the container runs as root.
- No Windows or Edge environment is available in this session.

## Blockers

1. Upstream pin: `RenZekta/AI-Bridge` is outside this session's repository scope, so its commit could not be read. The owner needs to provide the pinned commit SHA or attach that repository.
2. Real provider verification needs logged-in ChatGPT/Claude/etc. tabs on a Windows machine.

## Next steps

1. Pick up P1 follow-ups: S-15 site-message validation, WebSocket message rate (rest of S-11), S-14 permission review.
2. Start P2: strict tool-call contract with negative tests (S-17). Do not claim OpenCode support until a real OpenCode run passes.
