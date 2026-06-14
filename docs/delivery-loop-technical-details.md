# /delivery Loop — Technical Implementation Details

Status: reusable technical blueprint
Applies to: all user software projects
Parent protocol: `docs/delivery-loop-program.md`
Command: `/delivery`
Internal workflow: `PRODUCTION_DELIVERY_LOOP`

---

## 1. Purpose of This Technical Document

This document explains how to implement `/delivery` in code and project infrastructure.

The parent document defines the protocol. This document defines the practical technical layer:

- what files to create;
- what scripts to add;
- what commands agents should run;
- what JSON status files should contain;
- how GitHub PR, CI, merge, deployment, and live verification should be checked;
- what the exact checkpoints are;
- what must exist at the end for the implementation to be considered complete.

The goal is to make `/delivery` operational, repeatable, and hard to fake.

## FINAL RESULT VERIFICATION GATE

The delivery technical layer must include result verification against the
original request. Implementation is not completion; verification against the
original request is completion.

Minimum machine-readable fields for the added `result_verification` status
section:

- `original_request_contract`
- `requirements`
- `evidence`
- `verification_method`
- `status`
- `not_verified_items`
- `merge_readiness`
- `repair_attempts`
- optional top-level `spiralValidatorCritic`

Allowed requirement statuses: `PASS`, `PARTIAL`, `FAIL`, `NOT VERIFIED`.
`PARTIAL`, `FAIL`, and `NOT VERIFIED` block completion language and block
`STATUS: SUCCESS`.

Optional machine-readable `spiralValidatorCritic` fields:

- `loopNumber` — integer 1 through 3;
- `verdict` — `READY_FOR_MERGE`, `READY_WITH_NOTES`, `IMPROVE`, `IMPROVE_MINOR`, `SAFETY_STOP`, or `NEEDS_HUMAN_DECISION`;
- `requirements` — critic requirement rows with `requirement`, `status`, `evidence`, and `nextAction`;
- `nextImprovementPlan` — concrete next patch steps for improvement verdicts;
- `safetyRisks` — required for `SAFETY_STOP`;
- optional `notVerified`, `missing`, and `notes`.

`spiralValidatorCritic` is top-level and optional. Do not put it inside
`result_verification`, because existing status files and
`result_verification.additionalProperties: false` must remain compatible.

Validation rules:

- legacy status files without `spiralValidatorCritic` remain valid;
- `READY_FOR_MERGE` requires all critic requirements `PASS`;
- `READY_WITH_NOTES` may include non-`PASS` requirements only when gaps are documented and have `nextAction`;
- `IMPROVE` and `IMPROVE_MINOR` require a non-empty `nextImprovementPlan`;
- `SAFETY_STOP` requires non-empty `safetyRisks`;
- `loopNumber: 3` cannot remain `IMPROVE`.

---

## 2. Target Architecture

Every project should eventually have this structure or an equivalent adapted version:

```txt
.
├── AGENTS.md
├── docs/
│   ├── delivery-loop-program.md
│   ├── delivery-loop-technical-details.md
│   ├── release-workflow.md
│   └── deploy-fallback.md
├── .github/
│   ├── pull_request_template.md
│   └── workflows/
│       └── ci.yml
├── scripts/
│   ├── delivery-status.sh
│   ├── delivery-checks.sh
│   ├── live-smoke-test.mjs
│   └── verify-deployment.mjs
├── .delivery/
│   ├── config.example.json
│   ├── status.schema.json
│   └── reports/
│       └── .gitkeep
├── .claude/
│   └── commands/
│       └── delivery.md
└── .cursor/
    └── rules/
        └── delivery.mdc
```

Not every project needs every file, but the agent must know which parts exist and which are unavailable.

---

## 3. Implementation Layers

`/delivery` should be implemented in four layers.

### Layer 1 — Agent Rules

Files:

```txt
AGENTS.md
CLAUDE.md
.cursor/rules/delivery.mdc
.claude/commands/delivery.md
```

Purpose:

- teach the agent what `/delivery` means;
- route the command to the delivery docs;
- force final states: `SUCCESS` or `BLOCKED`.

### Layer 2 — Project Configuration

Files:

```txt
.delivery/config.example.json
docs/release-workflow.md
docs/deploy-fallback.md
```

Purpose:

- define build/test/deploy/live details;
- remove guesswork;
- let the agent create a project adapter quickly.

### Layer 3 — Automation Scripts

Files:

```txt
scripts/delivery-status.sh
scripts/delivery-checks.sh
scripts/live-smoke-test.mjs
scripts/verify-deployment.mjs
```

Purpose:

- provide repeatable checks;
- give the agent commands to run;
- make final reports evidence-based.

### Layer 4 — CI/CD Gates

Files:

```txt
.github/workflows/ci.yml
.github/pull_request_template.md
```

Purpose:

- make PR quality externally verifiable;
- prevent the agent from replacing checks with words;
- standardize task coverage and live verification reporting.

---

## 4. `.delivery/config.example.json`

Create:

```txt
.delivery/config.example.json
```

Template:

```json
{
  "projectName": "PROJECT_NAME",
  "repository": "owner/repo",
  "defaultBranch": "main",
  "targetBranch": "main",
  "packageManager": "npm",
  "framework": "unknown",
  "commands": {
    "install": "npm ci",
    "build": "npm run build",
    "lint": "npm run lint --if-present",
    "typecheck": "npm run typecheck --if-present",
    "test": "npm test --if-present",
    "check": "npm run check --if-present",
    "smokeLive": "npm run smoke:live --if-present"
  },
  "ci": {
    "provider": "github-actions",
    "required": true
  },
  "deployment": {
    "provider": "vercel",
    "productionUrl": "https://example.com",
    "previewUrl": null,
    "requiresDashboardAccess": true
  },
  "github": {
    "usePullRequests": true,
    "allowAutoMerge": false,
    "requireHumanReview": true,
    "branchProtectionExpected": true
  },
  "liveVerification": {
    "required": true,
    "method": "browser-or-smoke-test",
    "defaultExpectedText": null,
    "routes": ["/"]
  },
  "security": {
    "neverPrintSecrets": true,
    "blockedSecretNamesOnly": true
  }
}
```

Implementation rule:

- agents may create a project-specific `.delivery/config.json` if the project wants it;
- do not commit real secrets;
- config may name env variables but must not contain secret values.

Checkpoint:

- [ ] Config template exists.
- [ ] It has repo, branches, commands, CI, deployment, live verification, and security sections.
- [ ] It does not contain secrets.

---

## 5. `.delivery/status.schema.json`

Create:

```txt
.delivery/status.schema.json
```

Template:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "DeliveryStatus",
  "type": "object",
  "required": [
    "status",
    "loop",
    "task",
    "projectAdapter",
    "checks",
    "git",
    "deployment",
    "liveVerification",
    "blockers"
  ],
  "properties": {
    "status": {
      "type": "string",
      "enum": ["SUCCESS", "BLOCKED"]
    },
    "loop": {
      "type": "string",
      "const": "PRODUCTION_DELIVERY_LOOP"
    },
    "task": {
      "type": "object",
      "required": ["originalRequest", "acceptanceCriteria"],
      "properties": {
        "originalRequest": { "type": "string" },
        "acceptanceCriteria": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["criterion", "done", "evidence"],
            "properties": {
              "criterion": { "type": "string" },
              "done": { "type": "boolean" },
              "evidence": { "type": "string" }
            }
          }
        }
      }
    },
    "projectAdapter": {
      "type": "object",
      "properties": {
        "repository": { "type": "string" },
        "defaultBranch": { "type": "string" },
        "targetBranch": { "type": "string" },
        "packageManager": { "type": "string" },
        "framework": { "type": "string" },
        "ciProvider": { "type": "string" },
        "deploymentProvider": { "type": "string" },
        "liveUrl": { "type": "string" }
      }
    },
    "checks": {
      "type": "object",
      "properties": {
        "build": { "type": "string" },
        "lint": { "type": "string" },
        "typecheck": { "type": "string" },
        "tests": { "type": "string" },
        "manual": { "type": "string" }
      }
    },
    "git": {
      "type": "object",
      "properties": {
        "branch": { "type": "string" },
        "prUrl": { "type": "string" },
        "prChecks": { "type": "string" },
        "mergeable": { "type": "string" },
        "merged": { "type": "string" },
        "finalCommit": { "type": "string" }
      }
    },
    "deployment": {
      "type": "object",
      "properties": {
        "provider": { "type": "string" },
        "deploymentUrl": { "type": "string" },
        "status": { "type": "string" },
        "commit": { "type": "string" }
      }
    },
    "liveVerification": {
      "type": "object",
      "properties": {
        "checked": { "type": "boolean" },
        "route": { "type": "string" },
        "expected": { "type": "string" },
        "actual": { "type": "string" },
        "evidence": { "type": "string" }
      }
    },
    "blockers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "blocker": { "type": "string" },
          "evidence": { "type": "string" },
          "requiredUserAction": { "type": "string" }
        }
      }
    }
  }
}
```

Purpose:

- makes final delivery reports structured;
- allows future automation to validate `SUCCESS` / `BLOCKED` reports;
- prevents vague final answers.

Checkpoint:

- [ ] Status schema exists.
- [ ] It requires evidence for criteria, checks, git, deployment, and live verification.

---

## 6. `scripts/delivery-checks.sh`

Create:

```txt
scripts/delivery-checks.sh
```

Template:

```bash
#!/usr/bin/env bash
set -euo pipefail

run_if_script_exists() {
  local script_name="$1"
  if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script_name'] ? 0 : 1)"; then
    echo "== Running npm run $script_name =="
    npm run "$script_name"
  else
    echo "== Skipping $script_name: script not found =="
  fi
}

if [ -f package-lock.json ]; then
  echo "== Installing with npm ci =="
  npm ci
elif [ -f pnpm-lock.yaml ]; then
  echo "== Installing with pnpm =="
  corepack enable || true
  pnpm install --frozen-lockfile
elif [ -f yarn.lock ]; then
  echo "== Installing with yarn =="
  corepack enable || true
  yarn install --frozen-lockfile
else
  echo "== No known lockfile found; skipping install =="
fi

run_if_script_exists lint
run_if_script_exists typecheck
run_if_script_exists test
run_if_script_exists build
```

Make executable:

```bash
chmod +x scripts/delivery-checks.sh
```

Checkpoint:

- [ ] Script detects package manager.
- [ ] Script runs available checks.
- [ ] Script does not fail only because optional scripts are missing.
- [ ] Script fails when an actual check fails.
- [ ] Script validates `spiralValidatorCritic` when present.
- [ ] Script preserves legacy `.delivery/status.json` files without `spiralValidatorCritic`.

---

## 7. `scripts/delivery-status.sh`

Create:

```txt
scripts/delivery-status.sh
```

Template:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "== Delivery Status =="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "\n== Git status =="
git status --short

echo "\n== Current branch =="
git branch --show-current

echo "\n== Recent commits =="
git log --oneline -n 5

if command -v gh >/dev/null 2>&1; then
  echo "\n== GitHub PR status =="
  gh pr status || true

  echo "\n== Current PR view =="
  gh pr view --json url,state,mergeable,baseRefName,headRefName,statusCheckRollup 2>/dev/null || true

  echo "\n== Current PR checks =="
  gh pr checks 2>/dev/null || true
else
  echo "\n== GitHub CLI not available =="
fi

if [ -n "${LIVE_URL:-}" ]; then
  echo "\n== Live URL HEAD =="
  curl -fsSI "$LIVE_URL" || exit 1
fi
```

Make executable:

```bash
chmod +x scripts/delivery-status.sh
```

Checkpoint:

- [ ] Script prints branch, commits, PR, checks, and optional live URL status.
- [ ] Script prints `Spiral Validator-Critic Status` when `spiralValidatorCritic` is present.
- [ ] Script reports legacy status files without `spiralValidatorCritic` as not recorded, not failed.
- [ ] Agent can use this output as final report evidence.

---

## 8. `scripts/live-smoke-test.mjs`

Create:

```txt
scripts/live-smoke-test.mjs
```

Template:

```js
const liveUrl = process.env.LIVE_URL;
const expectedText = process.env.EXPECTED_TEXT;
const expectedStatus = Number(process.env.EXPECTED_STATUS || 200);

if (!liveUrl) {
  console.error('LIVE_URL is required');
  process.exit(2);
}

let response;
try {
  response = await fetch(liveUrl, { redirect: 'follow' });
} catch (error) {
  console.error(`Live URL request failed: ${error.message}`);
  process.exit(1);
}

if (response.status !== expectedStatus) {
  console.error(`Unexpected status: expected ${expectedStatus}, got ${response.status}`);
  process.exit(1);
}

const body = await response.text();

if (expectedText && !body.includes(expectedText)) {
  console.error(`Expected text not found: ${expectedText}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  liveUrl,
  status: response.status,
  expectedText: expectedText || null,
  checkedAt: new Date().toISOString()
}, null, 2));
```

Usage:

```bash
LIVE_URL="https://example.com" EXPECTED_TEXT="Dashboard" node scripts/live-smoke-test.mjs
```

Checkpoint:

- [ ] Script fails on unreachable live URL.
- [ ] Script can verify expected visible text.
- [ ] Script outputs JSON evidence.

---

## 9. `scripts/verify-deployment.mjs`

Create:

```txt
scripts/verify-deployment.mjs
```

Generic template:

```js
const provider = process.env.DEPLOYMENT_PROVIDER || 'unknown';
const expectedCommit = process.env.EXPECTED_COMMIT || '';
const deploymentUrl = process.env.DEPLOYMENT_URL || '';
const liveUrl = process.env.LIVE_URL || '';

const result = {
  provider,
  expectedCommit: expectedCommit || null,
  deploymentUrl: deploymentUrl || null,
  liveUrl: liveUrl || null,
  checkedAt: new Date().toISOString(),
  ok: false,
  notes: []
};

if (!deploymentUrl && !liveUrl) {
  result.notes.push('No DEPLOYMENT_URL or LIVE_URL provided.');
  console.error(JSON.stringify(result, null, 2));
  process.exit(2);
}

const urlToCheck = deploymentUrl || liveUrl;

try {
  const response = await fetch(urlToCheck, { redirect: 'follow' });
  result.httpStatus = response.status;
  result.ok = response.ok;
  if (!response.ok) {
    result.notes.push(`HTTP check failed: ${response.status}`);
  }
} catch (error) {
  result.notes.push(`Request failed: ${error.message}`);
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
```

Provider-specific agents can replace or extend this with Vercel/Netlify/Render APIs.

Checkpoint:

- [ ] Script can verify a deployment/live URL returns success.
- [ ] Script outputs machine-readable evidence.

---

## 10. Package Scripts to Add

For Node projects, add scripts when compatible:

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

If project already has a `check` script, keep it.

If not, optionally add:

```json
{
  "scripts": {
    "check": "npm run lint --if-present && npm run typecheck --if-present && npm test --if-present && npm run build"
  }
}
```

Checkpoint:

- [ ] Agent has one command for local checks.
- [ ] Agent has one command for delivery status.
- [ ] Agent has one command for live smoke verification.

---

## 11. GitHub CLI Commands for Agents

Agents should use these when `gh` is available.

### Check current repo

```bash
gh repo view --json nameWithOwner,defaultBranchRef,url
```

### Create PR

```bash
gh pr create --title "TASK TITLE" --body-file .delivery/pr-body.md --base main --head BRANCH_NAME
```

### View PR status

```bash
gh pr view --json url,state,mergeable,baseRefName,headRefName,statusCheckRollup,isDraft,reviewDecision
```

### Check PR checks

```bash
gh pr checks
```

### Watch checks

```bash
gh pr checks --watch
```

### View failed CI run

```bash
gh run list --limit 5
gh run view RUN_ID --log-failed
```

### Merge PR

Use only if allowed by project policy:

```bash
gh pr merge --squash --delete-branch
```

or project-specific merge method:

```bash
gh pr merge --merge --delete-branch
gh pr merge --rebase --delete-branch
```

### Confirm merge

```bash
gh pr view --json state,mergeCommit,url
git fetch origin
git branch -r --contains FINAL_COMMIT
```

Checkpoint:

- [ ] Agent verifies PR state after creation.
- [ ] Agent checks mergeability.
- [ ] Agent checks CI.
- [ ] Agent confirms merge landed.

---

## 12. Vercel-Specific Commands

Use when the project uses Vercel and the agent has access.

### Basic project check

```bash
vercel project ls
```

### Pull env/project settings if appropriate

```bash
vercel pull --yes
```

### Check deployment list

```bash
vercel ls
```

### Inspect a deployment

```bash
vercel inspect DEPLOYMENT_URL
```

### Inspect logs

```bash
vercel logs DEPLOYMENT_URL
```

### Production deploy if project uses CLI deploys

```bash
vercel --prod
```

Important:

- if the project auto-deploys from GitHub, prefer GitHub merge -> Vercel auto deployment;
- do not manually deploy a different working tree unless project policy allows it;
- verify the deployed commit when possible.

Checkpoint:

- [ ] Vercel deployment belongs to final commit or expected branch.
- [ ] Deployment is production, not only preview, unless target is preview.
- [ ] Deployment status is successful.
- [ ] Live URL shows requested behavior.

---

## 13. Netlify / Other Provider Pattern

For non-Vercel projects, use the same conceptual checks:

```txt
provider detected -> deployment triggered -> final commit deployed -> deployment successful -> live route checked
```

Provider examples:

```txt
Netlify: netlify status, netlify deploys, deploy logs
Render: service deploy status and logs
Railway: railway status/logs
Cloudflare Pages: pages deployment status/logs
Fly.io: fly status/logs/releases
Static host: git branch/commit + live URL check
```

Checkpoint:

- [ ] Provider is identified.
- [ ] The expected commit/branch is tied to deployment.
- [ ] Live behavior is verified.

---

## 14. Branch and PR Naming Convention

Recommended branch format:

```txt
agent/delivery/YYYYMMDD-short-task-slug
```

Examples:

```txt
agent/delivery/20260609-openai-key-wallet-errors
agent/delivery/20260609-fix-live-navbar
```

Recommended PR title:

```txt
[delivery] Short task description
```

Recommended commit messages:

```txt
Implement short task description
Fix CI failure in short task description
Add live verification for short task description
```

Checkpoint:

- [ ] Branch clearly belongs to delivery loop.
- [ ] PR title matches task.
- [ ] Commits are task-focused.

---

## 15. PR Body Generation

Agents may create `.delivery/pr-body.md` before PR creation.

Template:

```md
## Summary

[What changed]

## Original Task

[Paste or summarize original user task]

## Acceptance Criteria

- [ ] Criterion — evidence
- [ ] Criterion — evidence
- [ ] Criterion — evidence

## Implementation Notes

- Files changed:
- Key decisions:
- Security notes:

## Checks Run

- Build:
- Lint:
- Typecheck:
- Tests:
- Manual:

## Deployment / Live Verification

- Target environment:
- Deployment URL:
- Live URL:
- Expected behavior:
- Actual behavior:

## Risks

- None / list
```

Checkpoint:

- [ ] PR body contains the original task.
- [ ] PR body contains acceptance criteria.
- [ ] PR body contains check evidence.

---

## 16. Delivery Report File

Agents may create a local report during the loop:

```txt
.delivery/reports/YYYYMMDD-HHMM-task-slug.json
```

Example:

```json
{
  "status": "BLOCKED",
  "loop": "PRODUCTION_DELIVERY_LOOP",
  "task": {
    "originalRequest": "Fix OpenAI key wallet error messages.",
    "acceptanceCriteria": [
      {
        "criterion": "Invalid key shows invalid-key message",
        "done": true,
        "evidence": "Manual test + component logic verified"
      },
      {
        "criterion": "Live site shows updated behavior",
        "done": false,
        "evidence": "Vercel access unavailable"
      }
    ]
  },
  "blockers": [
    {
      "blocker": "No Vercel access",
      "evidence": "vercel ls failed: authentication required",
      "requiredUserAction": "Grant Vercel access or verify deployment manually"
    }
  ]
}
```

Project policy decides whether reports are committed. Usually, do not commit transient reports unless useful.

Checkpoint:

- [ ] Final answer can be generated from structured report fields.

---

## 17. Exit Codes for Scripts

Use consistent exit codes:

```txt
0 = success
1 = check failed / verification failed
2 = missing required configuration
3 = missing permissions/access
4 = unsafe task or policy violation
5 = external service unavailable
```

Checkpoint:

- [ ] Scripts fail clearly.
- [ ] Agent can distinguish config issue from actual failed check.

---

## 18. Agent Decision Table

| Situation | Agent action | Final status |
|---|---|---|
| Code compiles, PR not created | Create PR | Continue |
| PR created, checks failing | Inspect logs, fix, push | Continue |
| PR green but not mergeable | Rebase/fix conflicts if permitted | Continue or BLOCKED |
| PR requires human review | Report required review | BLOCKED |
| PR merged, deployment not triggered | Inspect provider/GitHub integration | Continue or BLOCKED |
| Deployment failed | Inspect logs, fix through PR/git flow | Continue |
| Deployment success but live stale | Check commit, cache, branch, route | Continue |
| Live behavior verified | Final report | SUCCESS |
| Missing secret | Name secret only, no value | BLOCKED |
| No merge permission | Give PR link and exact action | BLOCKED |
| No deployment access | Give exact missing access | BLOCKED |

Checkpoint:

- [ ] Agent knows when to continue vs stop.
- [ ] Agent does not return vague partial success.

---

## 18a. Loop Limits and Cost-Control Rules

### Loop Limits

Stop and return `STATUS: BLOCKED` when:

- The same issue has failed to fix after **3 attempts**. Do not attempt a fourth fix on the same root cause. Report the exact blocker, the 3 attempts made, and the required user action.
- PR mergeability is blocked by external policy (branch protection, required review, admin lock) — this is an immediate blocker, not a fixable loop.

### Sensitive and Destructive Operation Gate

Stop immediately before any of the following and ask for explicit user approval:

```txt
env vars or secrets (read by name only; never write or expose values)
billing or subscription settings
production database (writes, migrations, schema changes, drops)
auth-sensitive settings (OAuth credentials, JWT secrets, session config)
destructive git operations (force push, reset --hard, branch -D on protected branches)
infrastructure changes (DNS, CDN, firewall rules, deployment provider settings)
removing branch protection or required reviews
```

Correct wording before a sensitive action:

```txt
STATUS: BLOCKED
Blocker: Next required action is sensitive/destructive: [describe exact action].
Evidence: [what was found].
Required user action: explicitly approve this action, or perform it manually.
Next prompt: /delivery after approving [action].
```

### Prompt Caching and Context Discipline

- Place stable project context first in each run (AGENTS.md, protocol docs, rules).
- Place dynamic context after stable context (current task, diffs, logs, PR status).
- Do not reread or resend unchanged large files — use diffs.
- Do not scan the full repository unless necessary.
- Keep a compact running state: task, criteria, files changed, checks run, blockers, next action.

### Model Routing (Universal)

When model routing is available:

- Cheapest capable model/tooling for: status reads, PR body edits, file listing, repetitive summaries.
- Stronger reasoning only for: architecture gate, hard debugging, security-sensitive review, final delivery-risk review.

Optional Claude Code guidance:

- Sonnet: default.
- Haiku: simple status/summary/file listing — if available.
- Opus: hard architecture/debug/final risk reasoning — if available.

### Final Report Addition

Every `/delivery` final report must include:

```txt
COST CONTROL:
- Stable project context reused:
- Dynamic context separated:
- Diffs preferred over full files:
- Full repo scan avoided:
- Loop attempts used:
- Same-issue retry count:
- Expensive reasoning used for:
- Cost/token risk: low / medium / high
- What was avoided to save cost:
```

Checkpoint:

- [ ] Same-issue fix loop stops after 3 attempts.
- [ ] Sensitive/destructive operations require explicit approval before proceeding.
- [ ] Stable context is placed first; dynamic context follows.
- [ ] Final report includes COST CONTROL section.

---

## 19. Security Guardrails in Code

Agents must check for accidental secret exposure.

Before PR:

```bash
git diff --cached
git diff
```

Look for:

```txt
API keys
secret tokens
.env values
private URLs
credentials
console.log(secret)
localStorage dumps containing sensitive values
```

Recommended optional tool:

```bash
gitleaks detect --source . --no-git
```

If a secret is found:

- remove it;
- rotate it if it was committed/pushed;
- report `BLOCKED` if user action is required.

Checkpoint:

- [ ] No secrets in code.
- [ ] No secrets in logs.
- [ ] Secret names may be reported; values must not be reported.

---

## 20. Handling No Tests

If the project has no tests, the agent must not pretend tests passed.

Correct report:

```txt
Tests: not available — no test script found in package.json.
Manual check: completed [describe].
```

If the task is risky and no tests exist, agent should add a minimal regression test if practical.

Checkpoint:

- [ ] Missing tests are explicitly reported.
- [ ] Manual verification is described.

---

## 21. Handling Direct-to-Main Projects

Some small projects may not use PRs.

If the project explicitly uses direct-to-main, `/delivery` may adapt:

```txt
implementation -> local checks -> commit to main -> deployment -> live verification
```

But the agent must still verify:

- final commit on target branch;
- deployment for that commit;
- live behavior.

Checkpoint:

- [ ] Direct-to-main is allowed only when project policy confirms it.
- [ ] Direct-to-main does not remove deployment/live checks.

---

## 22. Handling Human Review Requirements

If branch protection requires review:

- agent prepares PR until green and mergeable;
- agent reports exact review requirement;
- final status is `BLOCKED`, not `SUCCESS`.

Example:

```txt
STATUS: BLOCKED
Blocker: Branch protection requires 1 approving review.
Evidence: PR checks are green, mergeable is blocked by required review.
Required user action: approve/merge PR or grant bypass permission.
```

Checkpoint:

- [ ] Human review is treated as an external blocker.
- [ ] User gets a clear next action.

---

## 23. Handling Deployment Delay

If deployment is still pending:

- agent should wait/check if the environment allows it;
- agent should not say `SUCCESS` while pending;
- if timeout or async wait is not possible, return `BLOCKED` with exact pending state.

Correct wording:

```txt
STATUS: BLOCKED
Blocker: Deployment is still pending; live verification cannot be completed yet.
Evidence: Deployment status is queued/building.
Required user action: rerun /delivery or /fix-deploy after deployment completes, or grant access to continue monitoring.
```

Checkpoint:

- [ ] "Should be live soon" never equals success.

---

## 24. Handling Live Cache/Stale Site

If deployment succeeded but live does not show the change, check:

- wrong domain;
- wrong deployment environment;
- wrong branch;
- wrong commit;
- CDN/browser cache;
- app route not rebuilt;
- feature flag/env mismatch;
- runtime error;
- old service worker;
- wrong project linked to domain.

Agent actions:

```txt
verify commit -> verify deployment target -> hard refresh/curl -> check route -> check logs -> fix config or report blocker
```

Checkpoint:

- [ ] Live stale state is investigated, not ignored.

---

## 25. Minimum Implementation Checklist

A project has a minimum viable `/delivery` implementation when:

- [ ] `docs/delivery-loop-program.md` exists.
- [ ] `docs/delivery-loop-technical-details.md` exists.
- [ ] `AGENTS.md` or equivalent references `/delivery`.
- [ ] Build command is known.
- [ ] PR/check policy is known.
- [ ] Deployment provider is known.
- [ ] Live URL is known.
- [ ] Agent final report format is fixed.
- [ ] `SUCCESS` requires live verification.
- [ ] `BLOCKED` requires exact blocker and required action.

---

## 26. Strong Implementation Checklist

A project has a strong `/delivery` implementation when:

- [ ] Minimum checklist is complete.
- [ ] `.delivery/config.example.json` exists.
- [ ] `.delivery/status.schema.json` exists.
- [ ] `.github/pull_request_template.md` exists.
- [ ] `.github/workflows/ci.yml` exists.
- [ ] `scripts/delivery-checks.sh` exists.
- [ ] `scripts/delivery-status.sh` exists.
- [ ] `scripts/live-smoke-test.mjs` exists.
- [ ] `scripts/verify-deployment.mjs` exists.
- [ ] Package scripts expose delivery checks/status/smoke commands.
- [ ] Branch protection and review policy are documented.
- [ ] Deployment fallback instructions are documented.
- [ ] A test `/delivery` task has been completed or ended in a clean `BLOCKED` state.

---

## 27. Final End-State Checklist for Every /delivery Run

At the end of every `/delivery` run, the answer must include:

- [ ] `STATUS: SUCCESS` or `STATUS: BLOCKED`.
- [ ] Project adapter.
- [ ] Original task.
- [ ] Acceptance criteria.
- [ ] Coverage evidence for every criterion.
- [ ] Files changed.
- [ ] Local checks.
- [ ] PR URL or direct-to-main explanation.
- [ ] PR checks and mergeability.
- [ ] Merge status.
- [ ] Final commit on target branch.
- [ ] Deployment provider.
- [ ] Deployment URL/status.
- [ ] Commit deployed.
- [ ] Live URL.
- [ ] Live verification result.
- [ ] Blockers and required action, if any.

If any required item is unknown and blocks proof, the final status must be `BLOCKED`.

---

## 28. One-Line Rule

The final rule for all agents:

```txt
/delivery is not done when code is written. It is done only when the requested change is proven live, or when a precise external blocker is reported.
```
