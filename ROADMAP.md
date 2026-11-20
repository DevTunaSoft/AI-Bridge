# Roadmap

Derived from `MASTER_ENGINEERING_PLAN.md` (milestones P0–P7). Current status is in `FEATURE_STATUS.md`; security detail is in `SECURITY.md`.

| Milestone | Scope | Status |
|-----------|-------|--------|
| **P0** Baseline | Upstream pin, licence notices, audit, baseline test run | **Partial**: baseline tests run (20/20). Audit done (`SECURITY.md`). Upstream commit pin **blocked**: the session is scoped to `DevTunaSoft/AI-Bridge`, so `RenZekta/AI-Bridge` was not read. Owner needs to supply the pinned commit or grant access. |
| **P1** Security hardening | API auth, CORS, Host/Origin, token handling, extension auth, rate limit | **In progress**: S-01 to S-10 and S-16 fixed with regression tests. S-11 partial (HTTP rate limit and response cap added; WebSocket message rate open). Open: `/health` exposure decision (S-12), Windows ACLs (S-13), extension permission review (S-14), site-message validation (S-15). |
| **P2** OpenCode tool-call acceptance | Strict tool-call recognition, schema validation, allowlists, multi-turn tool results, real OpenCode read/edit/test/fix/commit loop | **Not started**. Largest open risk: S-17 (best-effort tool-call extraction). |
| **P3** Durable state and recovery | Persisted request state machine, submission-uncertainty handling, crash/sleep recovery, encrypted backup | **Not started** |
| **P4** Provider adapters | Independently verified adapters for nine providers in real Chrome and Edge | **Not started** (no real provider tabs verified) |
| **P5** Stress and interruption | Long runs, cancellation, races, fuzzing, resource budgets | **Not started** |
| **P6** Windows controller | Installer, uninstaller, OpenCode wizard, repair/upgrade, ACLs | **Not started** |
| **P7** Release | Independent security review, documentation, signed artifacts | **Not started** |

## Next priorities

1. P1 follow-ups that are cheap and testable: S-15 site-message validation, WebSocket message rate (rest of S-11), S-14 permission review.
2. P2 start: strict tool-call contract (delimited output, offered-name allowlist, schema validation) with negative tests for quoted or prose "tool calls" (S-17).
3. Owner decisions needed: S-12 (`/health` exposure), the upstream pin source (P0), and the Windows test machine for P6.
