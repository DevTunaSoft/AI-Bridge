# Permanent Autonomous Testing, Quality Assurance & Cloud Recovery Policy

**Scope:** AI-Bridge, all OpenCode coding workers, reviewers, the Orchestrator supervisor, resumed sessions, and CI. This policy is mandatory and supplements existing engineering instructions. It is a requirement to implement and verify, not evidence that automation is already operational.

## 1. Fully unattended verification

- Automatically execute applicable unit, integration, regression, security, dependency, and end-to-end tests for each change.
- Build and launch the actual application in isolated test environments. Exercise real browser extension installation, browser interactions, provider readiness, and functional flows in Chrome and Edge wherever technically supported.
- Use Windows GitHub Actions runners for Windows-specific acceptance testing and Linux runners for cross-platform checks.
- Include concurrency, crash recovery, restart, sleep/wake, resource consumption, and rollback testing when relevant.
- Detect test failures, investigate root causes, implement fixes, and rerun affected tests and regressions without routine user intervention.
- Require independent review before declaring work verified. Do not use mocked tests as proof of real integrations; explicitly document the remaining real-world coverage gaps.
- Never claim that unrun, blocked, or failing tests passed. Block completion or merge when required checks are not verified.
- Preserve machine-readable results, logs, and artifacts from CI. GitHub Actions artifacts may expire; keep durable test summaries, evidence manifests, and links in version control as appropriate, excluding sensitive data.

## 2. Cloud-first development and disaster recovery

- GitHub is the authoritative cloud copy of source code, tests, instructions, review records, and recoverable development state. A local Git commit alone is **not** a cloud backup.
- On startup, audit all existing repositories, branches, worktrees, untracked files, local commits, stashes, and divergence before assigning overlapping tasks.
- Each worker must use an isolated branch/worktree and checkpoint recoverable work frequently, including before session shutdown, reassignment, or cleanup.
- Scan staged content for secrets, credentials, tokens, personal data, and unsafe artifacts before any push. Never publish secrets. Quarantine unsafe material and report the blocker.
- Push safe, verified task commits to dedicated remote feature branches; create draft pull requests. For incomplete work, use clearly marked recovery branches and draft PRs, without claiming completion or CI success.
- Verify remote branch SHA after each push. Record the branch, SHA, timestamp, test status, and any remaining unpublished work. A worker's “done” report is insufficient evidence of a push.
- Retry transient GitHub failures with bounded backoff. If the remote cannot be verified, retain local files and worktrees and mark the backup **UNVERIFIED**. Never delete unpublished changes.
- Keep a deduplicated, dependency-aware task queue, ownership/lease records, worker assignments, progress, test status, and recovery checkpoints in version-controlled sanitized files. A local-only `.ao` backlog does not satisfy cloud recovery.
- Never force-push, overwrite unrelated work, delete unbacked-up worktrees, or automatically merge to `main`. Keep unverified PRs draft.
- Store credentials and sensitive runtime state outside Git. If restoring Orchestrator or OpenCode requires local databases or settings, document and implement a **separate encrypted cloud backup** with restore validation; GitHub alone does not back up those files.

## 3. Autonomous orchestration

- Target six independent productive OpenCode coding workers with non-overlapping tasks and automatic replenishment from the persistent queue.
- Confirm actual coding/tool activity rather than counting session cards. Reconcile completed branches before reassigning workers.
- On worker spawn failure, record the exact error, use bounded retries and safe recovery, continue with available workers, and do not claim six workers are active when fewer are running.
- The supervisor owns automatic CI dispatch, status collection, failure remediation, checkpoint synchronization, draft PR creation, and progress reporting.
- Do not require the owner to run PowerShell, build/install applications, manually operate browsers, repeatedly request continuation, or perform routine QA.
- Where unavailable hardware, accounts, permissions, credentials, or external services make unattended verification impossible, report the exact limitation, preserve the work, and continue independent tasks. Never invent passing evidence.

## 4. Acceptance criteria for declaring this policy implemented

1. A worker creates a real change, runs appropriate automated tests, commits it, pushes it, and the supervisor verifies the exact remote SHA.
2. A draft PR shows the required CI checks and machine-readable test evidence.
3. An intentionally failing test blocks completion; autonomous remediation reruns tests and records the outcome.
4. A worker crash or supervisor restart resumes from durable state without losing tasks or duplicating work.
5. An interrupted or failed push is detected; unpublished work is preserved and flagged until the remote is verified.
6. The task queue and recovery records are recoverable from GitHub on a replacement machine; sensitive local configuration is restored only from its separate encrypted backup.
7. A browser end-to-end test executes on a supported runner, or the missing capability is explicitly recorded as an unverified acceptance gap.
8. The active worker count is accurately reported, including any OpenCode Go/ACP connection blockers.

**Until these checks pass, report this policy as documented but not fully implemented or verified.**
