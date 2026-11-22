# Roadmap

Derived from `MASTER_ENGINEERING_PLAN.md` (milestones P0–P7). Current status is in `FEATURE_STATUS.md`; security detail is in `SECURITY.md`.

| Milestone | Scope | Status |
|-----------|-------|--------|
| **P0** Baseline | Upstream pin, licence notices, audit, baseline test run | **Partial**: baseline tests run (20/20). Audit done (`SECURITY.md`). Upstream commit pin **blocked**: the session is scoped to `DevTunaSoft/AI-Bridge`, so `RenZekta/AI-Bridge` was not read. Owner needs to supply the pinned commit or grant access. |
| **P1** Security hardening | API auth, CORS, Host/Origin, token handling, extension auth, rate limits, site-message policy | **Nearly done**: S-01 to S-11 (global limits), S-15 and S-16 fixed with regression tests. Open: `/health` exposure decision (S-12), Windows ACLs (S-13), `tabs` permission review (S-14, needs a real AI tab). |
| **P2** OpenCode tool-call acceptance | Strict tool-call recognition, schema validation, allowlists, multi-turn tool results, real OpenCode read/edit/test/fix/commit loop | **In progress**: strict protocol implemented and tested at protocol level (S-17). Not yet verified with a real model reply or real OpenCode. |
| **P3** Durable state and recovery | Persisted request state machine, submission-uncertainty handling, crash/sleep recovery, encrypted backup | **Not started** |
| **P4** Provider adapters | Independently verified adapters for nine providers in real Chrome and Edge | **Not started** (no real provider tabs verified) |
| **P5** Stress and interruption | Long runs, cancellation, races, fuzzing, resource budgets | **Not started** |
| **P6** Windows controller | Installer, uninstaller, OpenCode wizard, repair/upgrade, ACLs | **Not started** |
| **P7** Release | Independent security review, documentation, signed artifacts | **Not started** |

## Next priorities

1. Windows: one tool-call request against DeepSeek in the user's browser, then a multi-turn tool result.
2. P2: real OpenCode run once the Windows checkout is available. Do not claim OpenCode support before that.
3. P1 leftovers: S-14 (`tabs` permission) on a real AI tab; owner decisions on S-12 and S-13; the upstream pin source (P0).
