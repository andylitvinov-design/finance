# /delivery Completion Program — 8-Phase Implementation Plan

Status: detailed completion program  
Repository: `andylitvinov-design/finance`  
Project: finance / EzoHata incoming ledger  
Primary live URL: `https://ezohata-incoming-ledger.vercel.app`  
Command: `/delivery`  
Goal: make `/delivery` a reliable release-owner loop that finishes only with `STATUS: SUCCESS` or `STATUS: BLOCKED`.

---

## 0. Executive Summary

`/delivery` already exists in this project as a protocol, docs, Claude command/skill, and finance-specific adapter.

The next work is not to invent the idea again. The next work is to harden it into an operational system.

The user wants to type only:

```txt
/delivery
Task: [task]
```

or:

```txt
/delivery [task]
```

The agent should then own the full release path:

```txt
task -> acceptance criteria -> implementation -> result quality verification -> local checks -> PR -> PR health -> merge if safe/permitted -> Vercel deploy -> live proof -> final report
```

The user should not manually ask:

- did you create a PR?
- is the PR mergeable?
- did checks pass?
- does it match the original task?
- did you fix missing requirements?
- did merge succeed?
- did Vercel deploy?
- is the correct commit live?
- is the live behavior correct?

The final answer must be one of:

```txt
STATUS: SUCCESS
```

or:

```txt
STATUS: BLOCKED
```

No intermediate status may be presented as done.

---

## 1. Current Known State

The project already contains these local `/delivery` sources of truth:

```txt
.claude/commands/delivery.md
.claude/skills/delivery/SKILL.md
docs/delivery-loop-program.md
docs/delivery-loop-technical-details.md
docs/delivery-loop-source-patterns-and-live-proof.md
AGENTS.md
CLAUDE_CODE_PROMPTS.md
```

The technical details document already includes a `FINAL RESULT VERIFICATION GATE`.

That gate says:

- implementation is not completion;
- verification against the original request is completion;
- result verification must include original request contract, requirements, evidence, verification method, status, not verified items, merge readiness, and repair attempts;
- allowed requirement statuses are `PASS`, `PARTIAL`, `FAIL`, `NOT VERIFIED`;
- `PARTIAL`, `FAIL`, and `NOT VERIFIED` block completion language and block `STATUS: SUCCESS`.

This is the critical quality upgrade added today. The completion program must preserve and operationalize it.

---

## 2. Non-Negotiable End State

The system is complete only when `/delivery` can be used as a real release-owner workflow.

### The user input should be enough

The user should not need extra delegation language.

Correct:

```txt
/delivery
Task: Fix X.
```

Not required:

```txt
I explicitly delegate PR creation, checks, merge, deployment and live verification.
```

`/delivery` itself must mean full safe delegation.

### `SUCCESS` requires proof

`STATUS: SUCCESS` is allowed only if all are true:

- task implemented;
- acceptance criteria extracted;
- every criterion has evidence;
- result quality gate passed;
- local checks passed or unavailable checks clearly reported;
- PR exists or project policy explicitly allows direct-to-main;
- PR is healthy, green, and mergeable where PR workflow exists;
- merge completed if merge is safe/permitted and required for the target;
- final commit is on target branch;
- deployment provider deployed the final commit or correct target branch;
- live URL was checked;
- requested live behavior is visible/working;
- no unrelated changes were introduced;
- final report includes evidence and cost-control section.

### `BLOCKED` requires exact next action

`STATUS: BLOCKED` is required if any external blocker prevents proof:

- no push permission;
- no PR permission;
- no merge permission;
- branch protection requires review;
- CI failed after allowed repair attempts;
- missing secret/env variable;
- Vercel/deployment access missing;
- deployment still pending and cannot be watched;
- live URL mismatch/stale and cannot be resolved;
- unsafe finance-risk;
- destructive action required;
- command discovery broken locally.

A blocked report must include:

```txt
- Where the loop stopped:
- What is complete:
- What is not complete:
- Exact blocker:
- Evidence:
- Required user action:
- Next prompt to run after unblocking:
```

---

# Phase 1 — Claude Code Command Discovery and Local Invocation

## Goal

Make sure `/delivery` is actually visible and invocable in Claude Code inside the local `finance` project.

## Why This Matters

If Claude Code does not discover `/delivery`, all protocol work becomes invisible. The first operational risk is command discovery, not release logic.

## Files to Inspect

```txt
.claude/commands/delivery.md
.claude/skills/delivery/SKILL.md
AGENTS.md
CLAUDE_CODE_PROMPTS.md
```

## Local Diagnostic Commands

Claude Code should run:

```bash
pwd
git branch --show-current
git status --short
git log --oneline -5
find .claude -maxdepth 5 -type f -print
sed -n '1,160p' .claude/commands/delivery.md 2>/dev/null || true
sed -n '1,200p' .claude/skills/delivery/SKILL.md 2>/dev/null || true
```

If `.claude` is not found, run:

```bash
find . -maxdepth 4 -iname '*claude*' -print
```

## Checks

- [ ] Claude Code was opened from the repo root, not a parent or child folder.
- [ ] Local branch includes the latest GitHub commits.
- [ ] `.claude/commands/delivery.md` exists locally.
- [ ] `.claude/skills/delivery/SKILL.md` exists locally, if the installed Claude Code supports skills.
- [ ] The command file is short enough and has no unsupported syntax that breaks discovery.
- [ ] The skill file has compatible metadata/frontmatter if required by the installed Claude Code version.
- [ ] Claude Code was restarted/reloaded after file changes.
- [ ] `/delivery` appears or there is a precise local reason why it does not.

## Fix Strategy

1. Confirm local repo is up to date:

```bash
git pull origin main
```

2. If command discovery still fails, simplify `.claude/commands/delivery.md` to the most compatible form:

```md
# /delivery

Read and follow:

1. `docs/delivery-loop-completion-program.md`
2. `docs/delivery-loop-program.md`
3. `docs/delivery-loop-technical-details.md`
4. `docs/delivery-loop-source-patterns-and-live-proof.md`
5. `AGENTS.md`

Act as release owner.

The user invocation `/delivery` is sufficient by itself.

Stop only with `STATUS: SUCCESS` or `STATUS: BLOCKED`.
```

3. If the installed Claude Code does not support `.claude/skills`, do not rely on skills for discovery. Keep the skill as documentation only.

4. If the installed Claude Code supports a different project command format, add the correct file and document the exact format.

## Phase 1 Done Means

- [ ] `/delivery` can be invoked locally, or
- [ ] exact local Claude Code discovery blocker is reported with next action.

## Phase 1 Final Report Requirement

```txt
PHASE 1 STATUS: PASS or BLOCKED
Command visible:
Command file path:
Skill file path:
Claude Code reload step:
Evidence:
Next action:
```

---

# Phase 2 — Project Adapter and Finance-Safe Delegation

## Goal

Make `/delivery` self-sufficient for finance without extra wording.

The command itself must mean:

```txt
implement -> checks -> PR -> PR health -> merge if safe/permitted -> Vercel deploy -> live verification
```

## Finance Project Adapter

The adapter must be available to the agent:

```txt
Repository: andylitvinov-design/finance
Default branch: main
Target branch: main
Package manager: npm
Framework/runtime: static HTML + Vercel Functions, Node >=20
Build: npm run build
Test: node --test tests/*.test.*
Release guard: bash scripts/release-guard.sh
CI: GitHub Actions
Deployment: Vercel auto-deploy from main
Primary live URL: https://ezohata-incoming-ledger.vercel.app
Status URL: https://ezohata-incoming-ledger.vercel.app/api/status
Production verify: npm run verify:production
Deploy fallback: gh workflow run deploy-production.yml --ref main -f ref=main -f expected_sha=<SHA> -f reason="<reason>"
```

## Finance Safety Rules

`/delivery` must never silently override finance safety.

Rules:

- prove failing layer before patching production bugs;
- minimal patch only;
- no broad repo scan unless justified;
- no unrelated refactor;
- no env/secrets/billing/provider credential changes;
- no destructive data repair, migrations, or backfills unless explicitly requested;
- no balance/gross/net/fee/source semantic changes without proven root cause and regression tests;
- merge to `main` is allowed by `/delivery` only after release guard, relevant tests/checks, PR health, and task coverage pass;
- if merge/deploy/live verification requires missing permission or unsafe action, return `STATUS: BLOCKED`.

## Checks

- [ ] `.claude/commands/delivery.md` states `/delivery` is sufficient by itself.
- [ ] `AGENTS.md` says `/delivery` is a named repository command, not a normal giant prompt.
- [ ] Finance adapter is present in the command or linked docs.
- [ ] Finance safety rules block unsafe actions.
- [ ] No extra phrase like “I explicitly delegate merge” is required.

## Phase 2 Done Means

A user can type only:

```txt
/delivery
Task: [task]
```

and Claude Code understands the full safe release path.

---

# Phase 3 — Result Quality Verification Gate

## Goal

Before any final readiness claim, the agent must perform a quality review against the original request.

## Required Gate

Add or verify a mandatory section called:

```txt
RESULT QUALITY VERIFICATION
```

It must run after implementation and again before final report.

## Required Fields

Machine-readable or structured final report fields:

```txt
original_request_contract
requirements
evidence
verification_method
status
not_verified_items
merge_readiness
repair_attempts
```

## Requirement Statuses

Allowed statuses:

```txt
PASS
PARTIAL
FAIL
NOT VERIFIED
```

Rules:

- `PASS` means evidence exists.
- `PARTIAL` means some but not all of the requirement is covered.
- `FAIL` means requirement is not met.
- `NOT VERIFIED` means the agent cannot prove it.

Blocking rule:

```txt
PARTIAL, FAIL, or NOT VERIFIED blocks STATUS: SUCCESS.
```

## Quality Review Checklist

Before final report, agent must ask:

- [ ] Did I restate the original task correctly?
- [ ] Did I extract all acceptance criteria?
- [ ] Does each criterion have evidence?
- [ ] Did I verify user-facing behavior, not only code changes?
- [ ] Did I verify error states if requested?
- [ ] Did I avoid unrelated changes?
- [ ] Did I preserve finance semantics?
- [ ] Did I run required checks?
- [ ] Did PR/merge/deploy/live proof match the final commit?
- [ ] Are any items `PARTIAL`, `FAIL`, or `NOT VERIFIED`?

If any item is not proven, the agent must fix or return `STATUS: BLOCKED`.

## Repair Loop

If quality gate fails:

```txt
identify missing criterion -> patch or add test -> rerun checks -> rerun quality gate
```

Same-issue repair limit:

```txt
3 attempts maximum on the same root cause.
```

After 3 failed attempts:

```txt
STATUS: BLOCKED
```

## Phase 3 Done Means

- [ ] Final report cannot say ready/done unless quality gate is `PASS` for all requirements.
- [ ] Every requirement has evidence.
- [ ] `PARTIAL`, `FAIL`, `NOT VERIFIED` prevent `SUCCESS`.

---

# Phase 4 — Local Checks, Release Guard, and Evidence Scripts

## Goal

Give `/delivery` repeatable local verification commands and evidence.

## Required Checks for Finance

Before PR or merge, run:

```bash
bash scripts/release-guard.sh
node --test tests/*.test.*
npm run build
```

If scripts exist, also run:

```bash
npm run lint --if-present
npm run typecheck --if-present
npm run delivery:checks --if-present
```

## Scripts to Verify or Add

```txt
scripts/delivery-checks.sh
scripts/delivery-status.sh
scripts/live-smoke-test.mjs
scripts/verify-deployment.mjs
```

## Desired package.json scripts

If compatible, expose:

```json
{
  "scripts": {
    "delivery:checks": "bash scripts/delivery-checks.sh",
    "delivery:status": "bash scripts/delivery-status.sh",
    "smoke:live": "node scripts/live-smoke-test.mjs",
    "deploy:verify": "node scripts/verify-deployment.mjs"
  }
}
```

Do not add scripts blindly. Respect the existing project stack.

## Evidence Requirements

Final report must include:

```txt
CHECKS:
- Release guard:
- Build:
- Lint:
- Typecheck:
- Tests:
- Manual check:
```

If no script exists:

```txt
Tests: not available — no test script found.
```

Never say tests passed if tests were not available.

## Phase 4 Done Means

- [ ] Agent has a known command set for local checks.
- [ ] Release guard is mandatory for finance.
- [ ] Check failures block PR/merge/SUCCESS.
- [ ] Missing checks are explicitly reported.

---

# Phase 5 — PR Health, Mergeability, and Task Coverage Loop

## Goal

Make PR creation a midpoint, not an endpoint.

## Required PR Loop

After implementation:

```txt
create/update branch -> commit -> push -> create/update PR -> check PR status -> fix until green/mergeable/task-complete
```

## Required PR Checks

Claude Code must verify:

- [ ] PR exists.
- [ ] Correct base branch: `main`.
- [ ] Correct head branch naming: `agent/delivery/YYYYMMDD-task-slug` or equivalent.
- [ ] No merge conflicts.
- [ ] PR checks passed or absence is explained.
- [ ] PR is mergeable.
- [ ] PR is not stale or safely updated.
- [ ] PR body includes original task.
- [ ] PR body includes acceptance criteria.
- [ ] PR body includes test evidence.
- [ ] PR body includes deployment/live verification section.
- [ ] Changed files are relevant.
- [ ] No unrelated changes.

## GitHub Commands

Use when `gh` is available:

```bash
gh repo view --json nameWithOwner,defaultBranchRef,url
gh pr view --json url,state,mergeable,baseRefName,headRefName,statusCheckRollup,isDraft,reviewDecision
gh pr checks
gh run list --limit 5
gh run view RUN_ID --log-failed
```

## Merge Confirmation

If safe/permitted, merge:

```bash
gh pr merge --squash --delete-branch
```

Then confirm:

```bash
gh pr view --json state,mergeCommit,url
git fetch origin
git branch -r --contains FINAL_COMMIT
```

## Blockers

Return `STATUS: BLOCKED` if:

- required review blocks merge;
- branch protection blocks merge;
- merge permission missing;
- checks keep failing after allowed repair attempts;
- finance-risk remains unresolved.

## Phase 5 Done Means

- [ ] PR is not treated as completion.
- [ ] Mergeability is checked.
- [ ] Task coverage is checked before merge.
- [ ] Merge is confirmed by final commit on target branch.

---

# Phase 6 — Vercel Deployment and Live Proof

## Goal

Make deployment and live verification provable.

## Deployment Facts

Finance uses:

```txt
Provider: Vercel
Production URL: https://ezohata-incoming-ledger.vercel.app
Status URL: https://ezohata-incoming-ledger.vercel.app/api/status
Deployment source: main branch auto-deploy
```

## Required Deployment Checks

After merge:

- [ ] Deployment triggered.
- [ ] Deployment belongs to final commit or correct target branch.
- [ ] Deployment targets production, not only preview.
- [ ] Deployment status is successful.
- [ ] No build/runtime error is visible.
- [ ] Live URL responds.
- [ ] `/api/status` responds.
- [ ] Task-specific behavior is visible/working.

## Useful Commands

If Vercel CLI is available:

```bash
vercel ls
vercel inspect DEPLOYMENT_URL
vercel logs DEPLOYMENT_URL
```

If project verification command exists:

```bash
npm run verify:production -- <SHA>
```

If direct check is enough for a route:

```bash
curl -fsS https://ezohata-incoming-ledger.vercel.app/api/status
```

## Live Proof Contract

Final report must include:

```txt
LIVE PROOF:
- Live URL:
- Checked route/page:
- Final deployed commit:
- Expected live behavior:
- Actual live behavior:
- Evidence:
- Auth boundary: NONE / GOOGLE_OAUTH_EXPECTED / SUPABASE_AUTH_EXPECTED / PRIVATE_CABINET_EXPECTED / OWNER_SESSION_REQUIRED
- Authenticated live proof: VERIFIED / SKIPPED_EXPECTED_AUTH_BOUNDARY / OWNER_REQUIRED / NOT_APPLICABLE
```

## If Deployment Is Pending

Do not say `SUCCESS`.

Return:

```txt
STATUS: BLOCKED
Blocker: Deployment is pending; live proof cannot be completed yet.
Evidence: [deployment status]
Required user action: rerun /delivery or /fix-deploy after deployment completes.
```

## If Live Is Stale

Investigate:

- wrong domain;
- wrong deployment environment;
- wrong branch;
- wrong commit;
- CDN/browser cache;
- feature flag/env mismatch;
- runtime error;
- old service worker;
- wrong project linked to domain.

## Phase 6 Done Means

- [ ] Deployment is tied to final commit/branch.
- [ ] Live proof is task-specific.
- [ ] Deployment success alone is not enough.

---

# Phase 7 — Managed Agent Upgrade Path

## Goal

Prepare `/delivery` to work not only locally but also through Claude Managed Agents.

This is the next level after local Claude Code.

## Why

Local `/delivery` still depends on:

- local Claude Code being open;
- local repo being up to date;
- local command discovery;
- local credentials and CLI tools;
- user starting it manually.

Managed Agent deployment can eventually provide:

- scheduled deployments;
- new session per run;
- env vars through managed vault/network boundary;
- GitHub/Vercel access via environment;
- no local Mac dependency;
- watchdog monitoring.

## Proposed Managed Agents

### 1. `delivery-on-demand`

Purpose:

```txt
Run /delivery for a specific user task.
```

Start message:

```txt
Follow docs/delivery-loop-completion-program.md and run the /delivery protocol for the provided task in andylitvinov-design/finance. Finish only with STATUS: SUCCESS or STATUS: BLOCKED. SUCCESS requires live proof.
```

### 2. `delivery-watchdog`

Purpose:

```txt
Scheduled check for stuck PRs, failed CI, failed Vercel deploys, pending live verification.
```

Schedule:

```txt
Every 1 hour during active development, or 2-4 times/day for lower cost.
```

Start message:

```txt
Check open delivery PRs and recent deployments. If a PR/deploy/live verification is stuck, fix if safe or report STATUS: BLOCKED with evidence and required user action.
```

### 3. `production-health-check`

Purpose:

```txt
Scheduled production health and critical flow verification.
```

Schedule:

```txt
Morning and evening, or before/after important work windows.
```

Start message:

```txt
Check finance production health: live URL, /api/status, recent deployment state, and critical read-only flows. Do not mutate production data. Report SUCCESS or BLOCKED.
```

## Required Env Vars

Names only. Do not commit values.

```txt
GITHUB_TOKEN
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
LIVE_URL
STATUS_URL
PRODUCTION_VERIFY_COMMAND
```

Optional:

```txt
SLACK_WEBHOOK_URL
NOTIFICATION_EMAIL
ANTHROPIC_API_KEY
```

## Managed Agent Security Rules

- Secrets must be stored in the Managed Agent environment/vault, not repo.
- Agent may name missing env vars but never print values.
- Agent must not write env/secrets/billing/provider credentials without explicit approval.
- Agent must restrict API calls to expected GitHub/Vercel/live domains.

## Phase 7 Done Means

- [ ] A Managed Agent plan exists.
- [ ] Required env var names are documented.
- [ ] On-demand delivery agent is defined.
- [ ] Watchdog agent is defined.
- [ ] Production health agent is defined.
- [ ] Security rules for secrets are defined.

---

# Phase 8 — End-to-End Pilot and Final Hardening

## Goal

Run `/delivery` on a small, safe task and prove the system works.

## Pilot Task Requirements

Choose a low-risk task:

- docs-only improvement;
- harmless UI text tweak;
- non-finance semantic change;
- no env/secrets;
- no production data writes;
- no balance/gross/net/fee/source logic.

Example:

```txt
/delivery
Task: Add a small docs note that explains how to run production verification for finance.
```

## Pilot Must Exercise

- [ ] command invocation;
- [ ] project adapter;
- [ ] acceptance criteria extraction;
- [ ] result quality gate;
- [ ] local checks;
- [ ] PR creation/update;
- [ ] PR health checks;
- [ ] merge if safe/permitted;
- [ ] Vercel deployment check;
- [ ] live proof or precise blocker.

## Final Hardening Checklist

After pilot, update docs/rules based on what happened:

- [ ] command discovery issue resolved;
- [ ] confusing instruction removed;
- [ ] missing script added;
- [ ] final report format improved;
- [ ] quality gate enforced;
- [ ] Vercel/live proof improved;
- [ ] Managed Agent follow-up tasks created.

## Phase 8 Done Means

A real `/delivery` run ended in a clean:

```txt
STATUS: SUCCESS
```

or a clean:

```txt
STATUS: BLOCKED
```

with exact evidence and next user action.

---

# Final Definition of Done for the Whole Program

The `/delivery` system is done when all eight phases are complete.

## System DoD

- [ ] `/delivery` is visible/invocable in Claude Code or exact local blocker is documented.
- [ ] `/delivery` requires no extra delegation text.
- [ ] Finance adapter is correct.
- [ ] Finance safety rules are enforced.
- [ ] Result quality gate blocks incomplete completion.
- [ ] Local checks are known and repeatable.
- [ ] PR health/mergeability loop is operational.
- [ ] Merge is confirmed by final commit on target branch.
- [ ] Deployment is tied to final commit/branch.
- [ ] Live proof is required for `SUCCESS`.
- [ ] `BLOCKED` reports exact blocker and next action.
- [ ] Cost-control section exists in final report.
- [ ] Managed Agent upgrade path is documented.
- [ ] A pilot `/delivery` run has been completed or cleanly blocked.

---

# Short Claude Code Prompt to Complete This Program

Use this prompt in Claude Code from the local `finance` repo root.

```txt
Do not clear context.

Task:
Complete and harden the /delivery system according to:

docs/delivery-loop-completion-program.md

Scope:
Only docs/config/agent-command/scripts needed for /delivery. Do not change finance business logic, ledger calculations, env/secrets, provider credentials, production data, migrations, or backfills.

Start by reading:
1. docs/delivery-loop-completion-program.md
2. .claude/commands/delivery.md
3. .claude/skills/delivery/SKILL.md
4. AGENTS.md
5. docs/delivery-loop-technical-details.md

Then execute Phases 1-8 as far as safe.

Required focus:
- confirm /delivery command discovery or document exact blocker;
- ensure /delivery alone means full safe delegation;
- enforce result quality gate before final readiness report;
- ensure PARTIAL / FAIL / NOT VERIFIED block STATUS: SUCCESS;
- verify local checks/release guard commands;
- verify PR/merge/deploy/live proof requirements;
- prepare Managed Agent upgrade plan if implementation cannot be completed locally.

Do not deploy or merge unless this is a safe pilot task and all checks pass.
If merge/deploy/live proof is blocked by permission, review, missing env, or tool access, return STATUS: BLOCKED with exact evidence.

Final answer:
STATUS: SUCCESS, SUCCESS_WITH_AUTH_LIMITATION, or BLOCKED

PHASE RESULTS:
1. Command discovery:
2. Project adapter:
3. Result quality gate:
4. Local checks:
5. PR/merge loop:
6. Deployment/live proof:
7. Managed Agent plan:
8. Pilot/hardening:

FILES CHANGED:
-

EVIDENCE:
-

BLOCKERS:
-

NEXT ACTION:
-
```

---

# One-Line Rule

```txt
/delivery is not done when code is written. It is done only when the requested change is quality-verified, delivered to the target environment, proven live, or precisely blocked with evidence.
```


## Expected Auth Boundary

Follow `docs/delivery-auth-boundary-standard.md` when Google OAuth, Supabase auth, private cabinet login, or an owner-only session blocks automated post-login live verification. Expected auth boundaries are not delivery failures by themselves. Use `STATUS: SUCCESS_WITH_AUTH_LIMITATION` when safe public/login/protected-redirect/local-or-code proof passes and the only missing proof is authenticated post-login live verification.
