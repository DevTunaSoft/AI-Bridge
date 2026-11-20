# Handoff

Read first: `AGENTS.md`, `MASTER_ENGINEERING_PLAN.md`, `MASTER_AUTONOMOUS_DEVELOPMENT_PROMPT.md`. Then `ROADMAP.md`, `FEATURE_STATUS.md`, `SECURITY.md`, `TESTING.md`.

## Where things stand

- Branch: `claude/jolly-shannon-p3tocj` (the designated development branch for this session). Base: `main` at `589d774`.
- P1 security hardening: S-01 to S-10 and S-16 are fixed. S-11 is partly fixed (HTTP rate limit and response size cap). Each fix has a test that failed before the fix.
- `npm test`: 30/30 pass. `node tools/e2e/extension-roundtrip.cjs`: passes on headless Chromium (Linux), two consecutive runs.
- Not done: upstream pin (P0), real AI chat tabs, Edge, Windows, the P2 tool-call contract.

## Breaking changes to communicate

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
