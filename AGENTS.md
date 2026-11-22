# AGENTS.md — AI Bridge Enhanced
Every coding agent, reviewer and resumed session must read these three complete documents before modifying code or making architectural decisions:
1. [MASTER_ENGINEERING_PLAN.md](MASTER_ENGINEERING_PLAN.md) — authoritative project scope, technical/security specifications, features, exclusions, milestones and acceptance criteria.
2. [MASTER_AUTONOMOUS_DEVELOPMENT_PROMPT.md](MASTER_AUTONOMOUS_DEVELOPMENT_PROMPT.md) — mandatory autonomous development workflow, testing, Git and handoff rules.
3. [docs/AUTONOMOUS_QA_CLOUD_RECOVERY_POLICY.md](docs/AUTONOMOUS_QA_CLOUD_RECOVERY_POLICY.md) — permanent unattended testing, GitHub backup, recovery and worker-supervision requirements.

Re-read all three after context compaction or handoff. Do not rely on incomplete summaries. If either file is missing or unreadable, stop and report the blocker. Preserve pre-existing repo instructions; these documents supplement rather than nullify them. When instructions conflict, flag it and favor security, proven correctness and direct owner decisions.

Before work: inspect repo/branches/PRs/status, existing docs and test evidence to avoid duplicate work. During work: branch, implement narrowly, validate, update tests and records, commit and push verified work to feature branches; preserve incomplete work in clearly labeled recovery branches/draft PRs after secret scanning; verify remote SHAs; never claim a local commit is cloud-backed-up, keep unverified PRs draft. Never claim unrun tests passed. OpenCode retains actual tool execution authority; gateway is a transport/validation layer and must fail closed on unsafe or unknown operations.

Current mission: Harden upstream RenZekta/AI-Bridge, preserve the real browser chat full-prompt input/normal-send approach, and prove secure multi-turn OpenCode tool-based coding on actual Windows Chrome/Edge. No Docker or local-LLM requirement. Review the full master plan before defining 'done'.