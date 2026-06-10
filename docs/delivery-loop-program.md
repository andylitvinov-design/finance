# Universal /delivery Loop — Technical Implementation Program

Status: reusable implementation program  
Command name: `/delivery`  
Internal name: `PRODUCTION_DELIVERY_LOOP`  
Scope: all user software projects  
Primary goal: eliminate manual release-management checks after an agent coding task  
Final result: `STATUS: SUCCESS` or `STATUS: BLOCKED`

---

## 1. Executive Purpose

`/delivery` is a reusable release-owner workflow for coding agents.

It is not just a prompt. It is an operating protocol that tells the agent to own the whole path from task to live verification.

The user should be able to write:

```txt
/delivery

Task:
[concrete task]

Target:
Production live site.
```

And the agent must continue until one of two final states:

```txt
STATUS: SUCCESS
```

or

```txt
STATUS: BLOCKED
```

The agent must not stop at code changes, PR creation, green CI, merge, deployment, or "should be live soon".

The task is complete only when the requested behavior is verified on the target live environment, or when a real external blocker prevents completion.

---

## 2. Problem This Solves

Without `/delivery`, the user has to manually check every step:

- Did the agent actually create a PR?
- Is the PR targeting the correct branch?
- Is the PR mergeable?
- Are there conflicts?
- Did CI/checks pass?
- Does the PR actually match the original task?
- Were all requirements from the original task covered?
- Did the agent fix missing details until task coverage is complete?
- Was the PR merged?
- Did merge really land on the target branch?
- Did the deployment provider pick up the final commit?
- Did deployment succeed?
- Is the correct commit deployed?
- Is the requested behavior visible or working on live?
- Is the final answer evidence-based or just an assumption?

`/delivery` turns this into a mandatory loop that the agent must run itself.

---

## 3. Core Delivery Chain

The canonical chain is:

```txt
Task
-> Acceptance criteria
-> Project adapter
-> Code implementation
-> Local checks
-> PR creation/update
-> PR health check
-> CI/checks until green
-> Task coverage audit
-> Merge until confirmed
-> Deployment verification
-> Live verification
-> Final report
```

Short form:

```txt
idea -> code -> PR -> checks -> merge -> deploy -> live -> proof
```

---

## 4. Command Family

Recommended command family across projects:

```txt
/goal        — clarify goal and break down the task
/supercool   — improve idea, UX, architecture, or product quality
/pr          — create or update a clean mergeable PR, but do not merge
/delivery    — implement, verify, PR, merge, deploy, and live-check
/fix-deploy  — diagnose and fix deployment/live issues
/audit       — inspect whether task, PR, merge, deployment, and live state match
```

`/delivery` may use outputs from `/goal` and `/supercool`, but it must still verify the final result against the original task.

---

## 5. What /delivery Means

When `/delivery` is invoked, the agent acts as a release owner.

The agent owns:

```txt
understand -> implement -> verify -> PR -> CI -> merge -> deploy -> live check
```

The agent must not act like a narrow coding assistant that only edits files.

Partial progress is not success.

Not success:

- code changed;
- local build passed;
- PR created;
- PR ready for review;
- CI green;
- merge completed;
- deployment started;
- deployment succeeded;
- site should update soon.

Success:

```txt
The requested behavior is verified on the target live environment, and the final report proves it.
```

Blocked:

```txt
A real permission, access, secret, CI, deployment, review, or environment blocker prevents completion, and the final report identifies the exact blocker and next user action.
```

---

## 6. Source Patterns Combined

`/delivery` is a composite loop assembled from several known loop patterns:

1. **Build Until Green**  
   Run production build, fix the first meaningful failure, repeat until successful.

2. **Ship PR Until Green**  
   Create/update PR, run PR checks, fix failures, repeat until PR is green and mergeable.

3. **CI Failure Watcher**  
   Read failed CI logs, identify root cause, fix, push, re-check.

4. **PR Babysitter**  
   Keep PR healthy: correct base, no conflicts, not stale, not behind, required checks green.

5. **Deploy Verification Loop**  
   Check deployment status, inspect build/runtime logs, fix deployment failures.

6. **Live Verification Loop**  
   Open live URL or run smoke tests and verify the requested behavior.

7. **Task Coverage Audit**  
   Compare implementation and live result against the original task.

8. **Final Evidence Report**  
   Return exact proof in a fixed format.

The custom part for the user's workflow is the end-to-end requirement:

```txt
PR is not enough. Merge is not enough. Deployment is not enough. Live behavior must be checked.
```

---

## 7. Universal Project Adapter

Because `/delivery` must work for all projects, the agent must create a project adapter at the start of every run.

The project adapter records project-specific facts.

```txt
PROJECT ADAPTER
- Repository:
- Default branch:
- Target branch:
- Package manager:
- Framework/runtime:
- Build command:
- Lint command:
- Typecheck command:
- Test command:
- Smoke/live test command:
- CI provider:
- Deployment provider:
- Production/live URL:
- Preview/staging URL:
- Required env/secrets:
- PR policy:
- Merge policy:
- Branch protection/review requirements:
- Docs/rules to read first:
```

The agent must infer these from project files and connected tools, for example:

- `AGENTS.md`
- `CLAUDE.md`
- `.cursorrules`
- `.cursor/rules/*`
- `README.md`
- `package.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `package-lock.json`
- `.github/workflows/*`
- `vercel.json`
- `netlify.toml`
- `render.yaml`
- `railway.json`
- deployment docs
- release workflow docs

If a required project fact cannot be discovered and blocks completion, stop with `STATUS: BLOCKED` and specify exactly what is missing.

---

## 8. Files to Add to Each Project

For best results, each project should include these files.

### Required

```txt
AGENTS.md
```

Purpose: persistent agent operating rules and command registry.

Should contain or link to:

```txt
/delivery -> docs/delivery-loop-program.md
/pr -> PR_READY_LOOP
/fix-deploy -> DEPLOY_FIX_LOOP
/audit -> DELIVERY_AUDIT_LOOP
```

### Required or strongly recommended

```txt
docs/delivery-loop-program.md
```

Purpose: full universal `/delivery` protocol and implementation program.

### Recommended

```txt
docs/release-workflow.md
```

Purpose: project-specific release flow: branches, deployment provider, production URL, merge rules.

### Recommended

```txt
docs/deploy-fallback.md
```

Purpose: what to do if deployment fails, environment variables are missing, or live is stale.

### Recommended

```txt
.github/pull_request_template.md
```

Purpose: force PR descriptions to include task coverage and test plan.

### Recommended

```txt
.github/workflows/ci.yml
```

Purpose: CI gate that checks build/lint/typecheck/tests.

### Recommended

```txt
scripts/delivery-status.sh
scripts/live-smoke-test.sh
```

Purpose: local or CI helper scripts for deployment/live verification.

### Optional for Claude Code

```txt
.claude/commands/delivery.md
```

Purpose: slash command implementation for Claude Code.

### Optional for Cursor

```txt
.cursor/rules/delivery.mdc
```

Purpose: persistent rule mapping `/delivery` to this protocol.

---

## 9. AGENTS.md Implementation Block

Add this to each project's `AGENTS.md`:

```md
# Agent Command Registry

## /delivery

When the user invokes `/delivery`, follow `docs/delivery-loop-program.md`.

Act as a release owner, not only a coding assistant.

Do not stop after code changes, PR creation, green checks, merge, or deployment.

Stop only with:

- `STATUS: SUCCESS` — task implemented, verified, PR/merge completed if required, deployed, and verified on live.
- `STATUS: BLOCKED` — real external blocker with exact evidence and required user action.

Before starting, create a project adapter:

- repository;
- target branch;
- package manager;
- framework;
- build/test commands;
- CI provider;
- deployment provider;
- live URL;
- PR/merge policy.
```

---

## 10. Pull Request Template

Create `.github/pull_request_template.md`:

```md
## Summary

-

## Original Task

-

## Acceptance Criteria

- [ ]
- [ ]
- [ ]

## Files Changed

-

## Checks

- [ ] Build passed
- [ ] Lint passed or not available
- [ ] Typecheck passed or not available
- [ ] Tests passed or not available
- [ ] Manual check completed

## Deployment / Live Verification

- Deployment URL:
- Commit deployed:
- Live URL:
- Live behavior checked:

## Risks / Notes

-
```

Checkpoint: every `/delivery` PR must include task coverage and test plan.

---

## 11. CI Workflow Template

For a JavaScript/TypeScript frontend project, create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint --if-present

      - name: Typecheck
        run: npm run typecheck --if-present

      - name: Test
        run: npm test --if-present

      - name: Build
        run: npm run build
```

Adapt for `pnpm`, `yarn`, Python, Ruby, or other stacks.

Checkpoint: `/delivery` must not report `SUCCESS` if required CI is failing.

---

## 12. Package Scripts Template

For Node projects, add or normalize these scripts in `package.json` when appropriate:

```json
{
  "scripts": {
    "build": "vite build",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run lint --if-present && npm run typecheck --if-present && npm test --if-present && npm run build",
    "smoke:live": "node scripts/live-smoke-test.mjs",
    "delivery:status": "bash scripts/delivery-status.sh"
  }
}
```

Do not add tools blindly. Only add scripts that match the project stack.

Checkpoint: the agent must discover the actual available commands and use those.

---

## 13. Live Smoke Test Script Template

Create `scripts/live-smoke-test.mjs` for projects where a simple URL check is useful:

```js
const liveUrl = process.env.LIVE_URL;
const expectedText = process.env.EXPECTED_TEXT;

if (!liveUrl) {
  console.error('LIVE_URL is required');
  process.exit(2);
}

const response = await fetch(liveUrl, { redirect: 'follow' });

if (!response.ok) {
  console.error(`Live URL failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const body = await response.text();

if (expectedText && !body.includes(expectedText)) {
  console.error(`Expected text not found on live page: ${expectedText}`);
  process.exit(1);
}

console.log(`Live smoke test passed: ${liveUrl}`);
```

Usage:

```bash
LIVE_URL="https://example.com" EXPECTED_TEXT="Dashboard" npm run smoke:live
```

Checkpoint: live verification should check behavior when possible, not only HTTP 200.

---

## 14. Delivery Status Script Template

Create `scripts/delivery-status.sh` when shell scripts are appropriate:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "== Git status =="
git status --short

echo "== Current branch =="
git branch --show-current

echo "== Recent commits =="
git log --oneline -n 5

if command -v gh >/dev/null 2>&1; then
  echo "== GitHub PR status =="
  gh pr status || true
fi

if [ -n "${LIVE_URL:-}" ]; then
  echo "== Live URL check =="
  curl -fsSI "$LIVE_URL" || exit 1
fi
```

Checkpoint: this script helps the agent collect evidence for the final report.

---

## 15. Claude Code Slash Command

Optional file: `.claude/commands/delivery.md`

```md
# /delivery

Follow `docs/delivery-loop-program.md`.

Act as release owner.

Input format:

Task:
$ARGUMENTS

Required final status:

- STATUS: SUCCESS
- STATUS: BLOCKED

Do not stop after code, PR, checks, merge, or deploy.
```

Checkpoint: in Claude Code, the user should be able to type:

```txt
/delivery Fix the billing/quota error handling and verify live.
```

---

## 16. Cursor Rule

Optional file: `.cursor/rules/delivery.mdc`

```md
---
description: Delivery loop for release-owner coding tasks
alwaysApply: false
---

When the user invokes `/delivery`, follow `docs/delivery-loop-program.md`.

You are responsible for implementation, PR, checks, merge if permitted, deployment verification, and live verification.

Final answer must be exactly one of:

- STATUS: SUCCESS
- STATUS: BLOCKED

Never claim success from PR creation, merge, or deployment alone.
```

Checkpoint: Cursor should load this rule when `/delivery` is mentioned.

---

## 17. Codex / Generic Agent Prompt

For a generic coding agent, use:

```txt
/delivery

Task:
[task]

First read docs/delivery-loop-program.md and the project's agent/rules files.

Create the project adapter.

Then execute the delivery loop until STATUS: SUCCESS or STATUS: BLOCKED.
```

Checkpoint: this works even when the agent does not support slash commands natively.

---

## 18. GitHub Permissions Required

For full `SUCCESS`, the agent needs access to:

- read repository;
- create branch;
- commit;
- push;
- create PR;
- read PR checks;
- read CI logs;
- merge PR, if the user wants automatic merge;
- read target branch after merge.

If the agent lacks merge permission but everything else is ready, it must return:

```txt
STATUS: BLOCKED
Reason: PR is ready but agent has no merge permission or human review is required.
Required user action: merge PR or grant permission.
```

Checkpoint: no pretending that a PR was merged.

---

## 19. Deployment Permissions Required

For full live verification, the agent needs one of:

- deployment provider access;
- GitHub deployment status access;
- production URL access;
- logs access when deployment fails;
- enough information to verify the deployed commit.

If the agent cannot access deployment state, it must return `STATUS: BLOCKED` with exact missing access.

Checkpoint: no `SUCCESS` without deployment/live evidence.

---

## 20. Environment and Secrets Rules

The agent must never expose or print secrets.

If a deployment fails because a secret is missing, the agent should report:

```txt
STATUS: BLOCKED
Missing required secret/env variable: [name only, not value]
Where it is needed: [CI/Vercel/runtime]
User action: add it in the deployment provider or CI settings.
```

The agent must not ask the user to paste secrets into the chat unless the environment is explicitly designed for secret input.

Checkpoint: security failure blocks delivery.

---

## 21. Acceptance Criteria Extraction

At the start, the agent must convert the user task into acceptance criteria.

Example:

```txt
Task:
Fix OpenAI key wallet so it distinguishes invalid key, quota/billing issue, network error, and successful validation.

Acceptance criteria:
- [ ] Empty key is rejected before API call.
- [ ] Invalid key shows invalid-key message.
- [ ] Quota/billing issue shows billing/quota message.
- [ ] Network failure shows network message.
- [ ] Successful validation shows success state.
- [ ] Key is not logged.
- [ ] Behavior verified locally and on live.
```

Checkpoint: the agent must not implement loosely. It must implement against criteria.

---

## 22. Task Coverage Audit

Before merge and again after live verification, the agent must check:

```txt
TASK COVERAGE AUDIT
- Does every acceptance criterion have evidence?
- Is anything from the original task missing?
- Did we introduce unrelated changes?
- Did we change user-visible behavior outside the requested scope?
- Are edge cases handled?
- Are error states clear to the user?
```

If any answer is bad, the agent must fix before continuing.

Checkpoint: task coverage must be proven, not assumed.

---

## 23. Local Checks Loop

The agent must run the available project checks.

Recommended order:

```txt
1. dependency install if needed
2. lint
3. typecheck
4. tests
5. build
6. manual UI check or smoke check
```

If a check fails:

```txt
read failure -> identify root cause -> fix -> rerun same check -> rerun full check set
```

Checkpoint: no PR should be created or updated as "ready" while local build is known broken.

---

## 24. PR Health Loop

The agent must verify:

- PR exists;
- correct base branch;
- no merge conflicts;
- not behind target branch, or safely updated;
- checks passed;
- reviews/branch protection status known;
- PR title and description match task;
- PR contains no unrelated files;
- PR is mergeable.

If not healthy:

```txt
fix -> push -> re-check
```

Checkpoint: PR creation is a midpoint, not an endpoint.

---

## 25. Merge Confirmation Loop

After merge, the agent must verify:

- merge command/action succeeded;
- PR state is merged;
- final commit is on target branch;
- target branch contains the intended files/changes.

If merge fails because of branch protection, required review, stale branch, or conflicts, return `STATUS: BLOCKED` or fix if permitted.

Checkpoint: no `SUCCESS` if merge is only assumed.

---

## 26. Deployment Verification Loop

After merge, the agent must verify:

- deployment was triggered;
- deployment corresponds to the final commit;
- deployment targets the correct environment;
- deployment status is successful;
- no build/runtime deployment error is visible.

Provider-specific examples:

```txt
Vercel: check production deployment and commit SHA.
Netlify: check production deploy status and commit SHA.
Cloudflare Pages: check latest production deployment.
Render/Railway/Fly: check service deployment logs/status.
```

If deployment fails:

```txt
inspect logs -> identify root cause -> fix via git/PR flow -> repeat delivery loop
```

Checkpoint: deployment success must be tied to the final commit.

---

## 27. Live Verification Loop

The agent must verify the actual live behavior.

Verification can include:

- opening the exact route;
- checking visible UI text;
- testing the changed button/form/flow;
- checking API behavior;
- checking error states;
- running smoke/e2e tests against live;
- checking browser console/runtime errors if available.

Live verification is not just HTTP 200 unless the task only asks for uptime.

Checkpoint: no `SUCCESS` until the user-requested behavior is visible or working on live.

---

## 28. Cost-Control and Prompt Caching Layer

`/delivery` includes cost-control by default.

### Stable vs Dynamic Context

Structure every `/delivery` run so stable context comes first and dynamic context follows.

**Stable context (cache-friendly, read once, do not rewrite each run):**

```txt
AGENTS.md
project rules
architecture summary
/delivery protocol (docs/delivery-loop-program.md)
technical delivery details (docs/delivery-loop-technical-details.md)
source loop patterns + live proof contract (docs/delivery-loop-source-patterns-and-live-proof.md)
coding standards
security guardrails
PR/merge/deploy checklist
secrets/env restrictions
```

**Dynamic context (placed after stable context, updated per run):**

```txt
current task
current bug
current files / diffs
latest logs
latest PR status
latest CI status
latest deployment status
latest blocker
```

Rules:

- Do not rewrite or rephrase the stable context each run.
- Prefer diffs over full files.
- Read only relevant files first. Do not scan the full repository unless necessary.
- Do not resend full files when a diff is enough.
- Keep a compact running state across loop steps:
  - task
  - acceptance criteria
  - files changed
  - checks run
  - blockers
  - next action

### Model Routing (Universal)

When model routing is available:

- Use the cheapest capable model/tooling for routine checks: status reads, PR body edits, repetitive summaries, file listing.
- Use stronger reasoning only for: architecture gate, hard debugging, security-sensitive review, final delivery-risk review.
- Do not use expensive reasoning for: repetitive status checks, formatting, PR body edits, or routine summaries.

Optional Claude Code guidance:

- Sonnet: default for most delivery work.
- Haiku: simple summaries, status checks, file listing — if available.
- Opus: hard architecture decisions, hard debug, final delivery-risk reasoning gate — if available.

### Loop Limits

Stop and return `STATUS: BLOCKED` when:

- The same issue has failed to fix after **3 attempts**. Do not retry a fourth time on the same root cause; report the exact blocker and required user action.
- PR mergeability is blocked by external policy (branch protection, required review, admin lock).
- The next action would touch: env vars, secrets, billing settings, production database, auth-sensitive settings, or any destructive operation.

For destructive or sensitive operations: stop, describe the exact action required, and ask for explicit user approval before proceeding.

Checkpoint:

- [ ] Stable context is not reread or rewritten unnecessarily.
- [ ] Dynamic context is placed after stable context.
- [ ] Diffs are preferred over full files.
- [ ] Loop limit of 3 same-issue attempts is respected.
- [ ] Destructive/sensitive operations require explicit approval.
- [ ] Final report includes COST CONTROL section.

---

## 29. Anti-Gaming Rules

The agent must never:

- disable tests to pass;
- remove checks to pass;
- bypass branch protection;
- hide failed checks;
- ignore failed checks;
- mark unchecked criteria as done;
- claim success based on code only;
- claim success based on PR only;
- claim success based on CI only;
- claim success based on merge only;
- claim success based on deployment only;
- say "should be live soon" as `SUCCESS`;
- claim live verification without checking live;
- silently change the task to something easier.

Checkpoint: if evidence is missing, status is `BLOCKED`, not `SUCCESS`.

---

## 29. Stop States

Every `/delivery` run must end in exactly one of two states.

### STATUS: SUCCESS

Allowed only when:

- task implemented;
- acceptance criteria satisfied;
- local checks passed or unavailable checks are explicitly reported;
- PR exists or the project intentionally uses direct-to-main delivery;
- PR targets correct branch when PR workflow exists;
- PR has no conflicts;
- PR checks passed or absence of checks is explicitly reported;
- PR is mergeable when PR workflow exists;
- PR is merged when merge is part of the requested target;
- final commit is present on target branch;
- deployment succeeded for final commit;
- live URL was checked;
- requested behavior is visible or working on live;
- no unrelated changes were introduced;
- final report includes evidence.

### STATUS: BLOCKED

Allowed only when a real external blocker prevents completion, such as:

- no permission to push;
- no permission to create PR;
- no permission to merge;
- required human review;
- branch protection restriction;
- no deployment-provider access;
- missing secret/env variable;
- CI/deployment requires manual action;
- target live URL is unknown;
- task is unsafe or contradicts architecture;
- unresolved external service outage.

---

## 30. Final Report Format

The agent must always end exactly with:

```txt
STATUS: SUCCESS or BLOCKED

LOOP:
- /delivery / PRODUCTION_DELIVERY_LOOP

PROJECT ADAPTER:
- Repository:
- Default branch:
- Target branch:
- Package manager:
- Framework/runtime:
- CI provider:
- Deployment provider:
- Live URL:

TASK:
- Original request:
- Acceptance criteria:

TASK COVERAGE:
- [ ] Criterion 1 — evidence:
- [ ] Criterion 2 — evidence:
- [ ] Criterion 3 — evidence:

IMPLEMENTATION:
- Summary:
- Files changed:
- Unrelated changes: none / list

CHECKS:
- Build:
- Lint:
- Typecheck:
- Tests:
- Manual check:

GIT / PR:
- Branch:
- PR:
- PR checks:
- Mergeable:
- Merged:
- Final commit on target branch:

DEPLOYMENT:
- Provider:
- Deployment URL:
- Deployment status:
- Commit deployed:
- Live URL:

LIVE VERIFICATION:
- Checked route/page:
- Expected result:
- Actual result:
- Evidence:

BLOCKERS:
- None, if SUCCESS.
- Exact blocker and required user action, if BLOCKED.

NEXT STEP:
- None, if SUCCESS.
- Required user action, if BLOCKED.

COST CONTROL:
- Stable project context reused:
- Dynamic context separated:
- Diffs preferred over full files:
- Full repo scan avoided:
- Repeated analysis avoided:
- Loop attempts used:
- Same-issue retry count:
- Expensive reasoning used for:
- Cost/token risk: low / medium / high
- What was avoided to save cost:
```

---

## 31. Implementation Plan Across Projects

### Phase 1 — Add Universal Protocol

Add:

```txt
docs/delivery-loop-program.md
```

Checkpoint at end:

- [ ] Document exists.
- [ ] It is universal, not tied to one repo.
- [ ] It defines `/delivery`.
- [ ] It defines `SUCCESS` and `BLOCKED`.
- [ ] It includes code, PR, merge, deploy, and live verification.

### Phase 2 — Register /delivery in Agent Rules

Update project agent rules:

```txt
AGENTS.md
CLAUDE.md
.cursor/rules/delivery.mdc
.claude/commands/delivery.md
```

Use whichever files the project supports.

Checkpoint at end:

- [ ] Agent can discover `/delivery` by reading project rules.
- [ ] Minimal prompt works: `/delivery Task: ...`.
- [ ] Rules say not to stop at PR/merge/deploy.

### Phase 3 — Add or Normalize Checks

Add or confirm:

```txt
build
lint
typecheck
test
check
```

Checkpoint at end:

- [ ] Project has a known build command.
- [ ] Project has known lint/typecheck/test commands or explicitly says they are unavailable.
- [ ] Agent knows which checks are required before PR/merge.

### Phase 4 — Add CI Gate

Add or confirm CI, for example GitHub Actions.

Checkpoint at end:

- [ ] PR triggers CI.
- [ ] Main/target branch triggers CI.
- [ ] Build is required.
- [ ] Lint/typecheck/test are included when available.

### Phase 5 — Add PR Template

Add `.github/pull_request_template.md`.

Checkpoint at end:

- [ ] PR template includes original task.
- [ ] PR template includes acceptance criteria.
- [ ] PR template includes checks.
- [ ] PR template includes deployment/live verification.

### Phase 6 — Add Deployment Knowledge

Add project-specific release notes:

```txt
docs/release-workflow.md
docs/deploy-fallback.md
```

Checkpoint at end:

- [ ] Live URL is documented.
- [ ] Deployment provider is documented.
- [ ] Target branch is documented.
- [ ] Env/secrets policy is documented.
- [ ] What to do when deploy fails is documented.

### Phase 7 — Add Live Smoke Check

Add script or documented manual smoke test:

```txt
scripts/live-smoke-test.*
```

Checkpoint at end:

- [ ] Agent can verify live URL.
- [ ] Agent can verify a task-specific visible result.
- [ ] Agent knows when HTTP 200 is not enough.

### Phase 8 — Test /delivery on a Small Task

Run `/delivery` on a low-risk change.

Checkpoint at end:

- [ ] Agent creates/updates PR.
- [ ] Agent checks PR mergeability.
- [ ] Agent fixes failures.
- [ ] Agent merges if permitted.
- [ ] Agent verifies deployment.
- [ ] Agent verifies live.
- [ ] Final report is `SUCCESS` or `BLOCKED` with evidence.

### Phase 9 — Harden Permissions

Configure permissions intentionally.

Checkpoint at end:

- [ ] Agent can push branches.
- [ ] Agent can create PRs.
- [ ] Agent can read checks/logs.
- [ ] Merge permission is either granted or intentionally blocked.
- [ ] Deployment access is either granted or documented as blocker.
- [ ] Required reviews/branch protection are clear.

### Phase 10 — Use /delivery as Standard Release Prompt

The user prompt becomes:

```txt
/delivery

Task:
[task]

Target:
Production live site.
```

Checkpoint at end:

- [ ] User no longer manually asks: did you create PR?
- [ ] User no longer manually asks: is it mergeable?
- [ ] User no longer manually asks: did Vercel deploy?
- [ ] User no longer manually asks: is it on live?
- [ ] Agent final report answers all of that.

---

## 32. Definition of Done for /delivery Implementation

The `/delivery` system is fully implemented in a project when all are true:

- [ ] Project has a universal `/delivery` protocol document.
- [ ] Project agent rules reference `/delivery`.
- [ ] Agent can create a project adapter.
- [ ] Build/check commands are known.
- [ ] PR template includes acceptance criteria and checks.
- [ ] CI runs on PRs.
- [ ] Deployment provider and live URL are documented.
- [ ] Live smoke/manual verification path is documented.
- [ ] Final report format is fixed.
- [ ] `SUCCESS` requires live verification.
- [ ] `BLOCKED` requires exact blocker, evidence, and user action.
- [ ] A test `/delivery` run was performed on a small change.

---

## 33. Minimal Prompt for Future Use

```txt
/delivery

Task:
[insert task]

Target:
Production live site.

Do not stop at code, PR, checks, merge, or deploy. Stop only with:

STATUS: SUCCESS — implemented, merged, deployed, and verified live.

or

STATUS: BLOCKED — exact blocker, evidence, and required user action.
```

---

## 34. Optional Project-Specific Appendix Template

Each repository may add a short appendix below this universal protocol.

```txt
PROJECT-SPECIFIC DELIVERY SETTINGS
- Repository:
- Production URL:
- Preview URL:
- Deployment provider:
- Build command:
- Output directory:
- Required checks:
- Merge policy:
- Required docs to read first:
```

Example only:

```txt
PROJECT-SPECIFIC DELIVERY SETTINGS
- Repository: owner/project-name
- Production URL: https://example.com
- Preview URL: provider preview URL
- Framework: Vite + React / Next.js / other
- Hosting: Vercel / Netlify / Render / other
- Build command: npm run build
- Output directory: dist / .next / build / other
- Required docs to read first: AGENTS.md, README.md, docs/release-workflow.md
```

The appendix is project-specific. The `/delivery` protocol itself is universal.

---



