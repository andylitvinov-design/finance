# /delivery Appendix — Source Loop Patterns and Live Proof Contract

Status: reusable appendix for all projects  
Parent protocol: `docs/delivery-loop-program.md`  
Technical companion: `docs/delivery-loop-technical-details.md`  
Command: `/delivery`  
Internal workflow: `PRODUCTION_DELIVERY_LOOP`

---

## 1. Purpose

This appendix makes `/delivery` self-contained.

The agent should not depend on finding external loop catalogs or remembering names from prior conversations.

If the agent cannot access or find the original external loop patterns, it must use the embedded definitions in this document.

The final goal is always clear:

```txt
The requested task must be visible or working on the live target environment.
```

If the agent cannot prove that, the final status must be:

```txt
STATUS: BLOCKED
```

not:

```txt
almost done
merged
probably deployed
should be live soon
```

---

## 2. Non-Negotiable Live Result

`/delivery` has only one success meaning:

```txt
SUCCESS = the original task is implemented, merged if required, deployed to the target environment, and the requested behavior is verified live.
```

The agent must always be able to answer:

```txt
Where can the user see the result live?
What exact route/page was checked?
What exact behavior/text/state proves the task is live?
Which final commit is deployed?
```

If any of these are unknown, the result is not `SUCCESS`.

---

## 3. Final Live Proof Contract

Every `/delivery` run must produce a live proof block.

Required block:

```txt
LIVE PROOF:
- Live URL:
- Checked route/page:
- Final deployed commit:
- Expected live behavior:
- Actual live behavior:
- Evidence:
- Screenshot/log/smoke-test result, if available:
```

Rules:

- HTTP 200 alone is not enough unless the task was only about uptime.
- Deployment success alone is not enough.
- Preview deployment is not enough if the target was production.
- Merge success is not enough.
- The agent must check the same behavior the user asked for.
- If the behavior cannot be checked automatically, the agent must describe the closest manual check it performed.
- If even manual live verification is impossible, return `STATUS: BLOCKED`.

---

## 4. Embedded Source Loop Patterns

The following loop patterns are embedded into `/delivery`.

If an external loop catalog is unavailable, inaccessible, renamed, or incomplete, use these internal definitions.

---

## 5. Pattern: Build Until Green

### Purpose

Make sure the project can build before claiming implementation is usable.

### Trigger

Use after code changes and before PR readiness.

### Loop

```txt
run build
if build passes -> continue
if build fails -> read first meaningful error -> fix root cause -> rerun build
repeat until build passes or real blocker appears
```

### Typical commands

```bash
npm run build
pnpm build
yarn build
python -m pytest
cargo build
go test ./...
```

Use commands appropriate to the project.

### Exit condition

```txt
Build command exits 0.
```

### Blocker condition

```txt
Build requires missing secret/env, unavailable dependency, broken external service, or permission the agent does not have.
```

### Evidence required

```txt
Build: passed — command and result
```

---

## 6. Pattern: Local Checks Until Clean

### Purpose

Make sure local quality checks are not known-broken.

### Trigger

After implementation and before PR readiness.

### Loop

```txt
run lint/typecheck/test/build
if all required checks pass -> continue
if a check fails -> inspect output -> fix root cause -> rerun failed check -> rerun full set
```

### Typical commands

```bash
npm run lint --if-present
npm run typecheck --if-present
npm test --if-present
npm run build
```

### Exit condition

```txt
Required local checks pass, or unavailable checks are explicitly reported as unavailable.
```

### Evidence required

```txt
CHECKS:
- Build: passed / failed / unavailable
- Lint: passed / failed / unavailable
- Typecheck: passed / failed / unavailable
- Tests: passed / failed / unavailable
```

---

## 7. Pattern: Ship PR Until Green

### Purpose

Move implementation into a reviewable, mergeable PR with green checks.

### Trigger

After local checks pass.

### Loop

```txt
create or update branch
commit changes
push branch
create or update PR
check PR checks
if checks fail -> read logs -> fix root cause -> push -> repeat
if PR not mergeable -> fix conflicts/rebase if allowed -> repeat
continue only when PR is green and mergeable or blocked by external policy
```

### Typical commands

```bash
git status
git diff
git checkout -b agent/delivery/YYYYMMDD-task-slug
git add .
git commit -m "Implement task"
git push -u origin branch-name
gh pr create --base main --head branch-name --title "[delivery] Task" --body-file .delivery/pr-body.md
gh pr view --json url,state,mergeable,baseRefName,headRefName,statusCheckRollup
gh pr checks
```

### Exit condition

```txt
PR exists, targets correct branch, has no conflicts, checks are green or explicitly absent, and PR is mergeable.
```

### Evidence required

```txt
GIT / PR:
- Branch:
- PR URL:
- Base branch:
- Mergeable:
- PR checks:
```

---

## 8. Pattern: CI Failure Watcher

### Purpose

When CI fails, the agent must not ask the user to inspect logs manually.

### Trigger

Any failed PR or branch check.

### Loop

```txt
find failed run
read failed logs
identify first root cause
fix root cause
run matching local check
push fix
watch CI again
repeat until green or blocked
```

### Typical commands

```bash
gh run list --limit 10
gh run view RUN_ID --log-failed
gh pr checks
```

### Exit condition

```txt
CI checks pass or exact external blocker is reported.
```

### Evidence required

```txt
CI:
- Failed check name:
- Root cause:
- Fix applied:
- Re-check result:
```

---

## 9. Pattern: PR Babysitter

### Purpose

Keep a PR healthy until it can be merged.

### Trigger

After PR exists and before merge.

### Loop

```txt
check PR state
check base branch
check conflicts
check stale/behind state
check checks
check review/branch protection
fix what agent can fix
report what requires human action
```

### Typical checks

```txt
- PR open?
- correct base branch?
- branch behind target?
- merge conflicts?
- required checks pending/failing?
- required review missing?
- draft PR?
- unrelated files changed?
```

### Exit condition

```txt
PR is healthy, mergeable, task-complete, and ready for merge.
```

### Evidence required

```txt
PR HEALTH:
- State:
- Base:
- Head:
- Conflicts:
- Mergeable:
- Review decision:
- Required checks:
```

---

## 10. Pattern: Task Coverage Audit

### Purpose

Ensure the PR actually matches the original user task, not just some partial interpretation.

### Trigger

Before merge and again after live verification.

### Loop

```txt
extract original acceptance criteria
map each criterion to code/change evidence
map each criterion to live verification evidence
if any criterion missing -> fix -> rerun checks -> update PR
```

### Required audit questions

```txt
- Did we implement every part of the original task?
- Did we skip any edge case?
- Did we introduce unrelated changes?
- Is the user-facing behavior correct?
- Are errors handled clearly?
- Can this be verified on live?
```

### Exit condition

```txt
Every acceptance criterion is marked done with evidence.
```

### Evidence required

```txt
TASK COVERAGE:
- [x] Criterion — code evidence — live evidence
- [x] Criterion — code evidence — live evidence
```

---

## 11. Pattern: Merge Until Confirmed

### Purpose

Prevent the agent from assuming merge happened.

### Trigger

After PR is green and mergeable.

### Loop

```txt
merge PR if allowed
check PR state
fetch target branch
verify final commit exists on target branch
verify intended files/changes are on target branch
if merge fails -> fix if possible or report blocker
```

### Typical commands

```bash
gh pr merge --squash --delete-branch
gh pr view --json state,mergeCommit,url
git fetch origin
git branch -r --contains FINAL_COMMIT
git log origin/main --oneline -n 5
```

### Exit condition

```txt
PR state is merged and final commit is present on target branch.
```

### Evidence required

```txt
MERGE:
- PR state: merged
- Merge commit:
- Target branch:
- Commit present on target branch: yes
```

---

## 12. Pattern: Deploy Verification Loop

### Purpose

Make sure the deployment provider picked up the final commit and deployed successfully.

### Trigger

After merge or direct-to-main commit.

### Loop

```txt
identify deployment provider
find deployment for final commit or target branch
check status
if failed -> inspect logs -> fix through git/PR flow -> repeat
if pending -> wait/check if possible, otherwise BLOCKED with pending evidence
if successful -> continue to live verification
```

### Provider examples

```txt
Vercel: deployment list/inspect/logs, GitHub deployment status, production domain
Netlify: deploy list/status/logs, production domain
Render: service deploy status/logs
Railway: deploy status/logs
Cloudflare Pages: latest production deployment
Fly.io: releases/status/logs
Static host: target branch commit + live URL check
```

### Exit condition

```txt
Deployment for the final commit succeeded on the target environment.
```

### Evidence required

```txt
DEPLOYMENT:
- Provider:
- Deployment URL:
- Deployment status:
- Final commit deployed:
- Target environment:
```

---

## 13. Pattern: Live Verification Loop

### Purpose

Make sure the user can see or use the result live.

### Trigger

After deployment success.

### Loop

```txt
open live URL or run live smoke test
check exact route/page
check exact requested behavior
if behavior missing -> investigate wrong commit/domain/cache/env/route/runtime
fix if possible -> redeploy -> recheck live
if cannot verify -> BLOCKED
```

### Live verification levels

Use the strongest available level:

1. **Behavioral check** — click/form/API/user flow works on live.
2. **UI content check** — expected text/element is visible on live.
3. **Route check** — exact route loads and expected page appears.
4. **HTTP check** — URL returns expected status, only enough for uptime tasks.

### Exit condition

```txt
The requested behavior is visible or working on live.
```

### Evidence required

```txt
LIVE PROOF:
- Live URL:
- Route/page checked:
- Expected behavior:
- Actual behavior:
- Evidence:
```

---

## 14. Pattern: Fix Deploy

### Purpose

Diagnose deployment or live mismatch after merge.

### Trigger

Deployment failed, deployment pending too long, or live does not show expected change.

### Loop

```txt
check final commit
check deployment commit
check deployment logs
check environment variables by name only
check build command/output directory
check target branch/domain
check runtime errors
fix through git/PR flow
repeat deployment verification
```

### Common root causes

```txt
- wrong branch connected to deployment provider
- wrong project linked to domain
- missing env variable
- build command mismatch
- output directory mismatch
- dependency/build error
- runtime error
- stale cache/CDN
- service worker cache
- feature flag mismatch
- deployment provider did not trigger
```

### Exit condition

```txt
Deployment succeeds and live verification passes, or exact blocker is reported.
```

---

## 15. Pattern: Audit Delivery

### Purpose

When the user asks “is it really done?”, the agent audits the whole chain.

### Trigger

User asks to verify existing PR/merge/deploy/live state.

### Audit chain

```txt
original task -> PR -> checks -> merge -> final commit -> deployment -> live behavior
```

### Exit condition

```txt
Audit returns SUCCESS only if live behavior matches original task.
```

### Evidence required

```txt
AUDIT:
- Original task:
- PR:
- Checks:
- Merge:
- Deployment:
- Live behavior:
- Result:
```

---

## 16. Composite /delivery Execution Order

The agent must run the embedded loops in this order:

```txt
1. Project Adapter
2. Acceptance Criteria Extraction
3. Task Coverage Audit — initial
4. Implementation
5. Build Until Green
6. Local Checks Until Clean
7. Ship PR Until Green
8. CI Failure Watcher, if CI fails
9. PR Babysitter
10. Task Coverage Audit — pre-merge
11. Merge Until Confirmed
12. Deploy Verification Loop
13. Fix Deploy, if deployment/live fails
14. Live Verification Loop
15. Task Coverage Audit — live
16. Final Evidence Report
```

If one loop fails due to a fixable problem, the agent fixes it and returns to the right earlier step.

If one loop fails due to an external blocker, the agent stops with `STATUS: BLOCKED`.

---

## 17. Required Final Result Wording

The final answer must never be vague.

Allowed final status names:

```txt
STATUS: SUCCESS
STATUS: BLOCKED
```

For `SUCCESS`, the final answer must include:

```txt
The task is live.
```

And must include the proof:

```txt
- Live URL:
- Route/page checked:
- What changed:
- What I verified:
- Final commit deployed:
```

For `BLOCKED`, the final answer must include:

```txt
The task is not yet proven live.
```

And must include:

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

## 18. Absolute Rule for Live Visibility

The agent must always make the live result obvious to the user.

For every `SUCCESS`, the user should be able to open one URL and see or use the result.

Required phrasing:

```txt
STATUS: SUCCESS
The task is live at: [LIVE_URL]
Verified route/page: [ROUTE]
Verified behavior: [BEHAVIOR]
Final deployed commit: [COMMIT]
```

If the final answer does not tell the user where the task is live, it is not a valid `/delivery` success report.

---

## 19. If External Loop Names Are Not Found

If the agent cannot find external definitions for names like:

```txt
Build Until Green
Ship PR Until Green
CI Failure Watcher
PR Babysitter
Deploy Verification Loop
Live Verification Loop
```

it must not stop or ask the user to provide them.

It must use the embedded definitions in this appendix.

Required behavior:

```txt
External loop definition unavailable. Using embedded /delivery appendix definitions.
```

Then continue the delivery workflow.

---

## 20. End-State Checklist

A valid `/delivery` `SUCCESS` must satisfy all of these:

- [ ] Original task captured.
- [ ] Acceptance criteria extracted.
- [ ] Code implemented.
- [ ] Local checks run.
- [ ] PR created/updated or direct-to-main policy confirmed.
- [ ] PR checks handled.
- [ ] PR mergeability handled.
- [ ] Task coverage audited before merge.
- [ ] PR merged or direct-to-main completed.
- [ ] Final commit confirmed on target branch.
- [ ] Deployment provider checked.
- [ ] Final commit deployed.
- [ ] Live URL checked.
- [ ] Exact requested behavior verified live.
- [ ] User can see where the task is live.
- [ ] Final report says `The task is live at: ...`.

If any item is missing, use `STATUS: BLOCKED` with exact evidence.

---

## 21. Final One-Sentence Contract

```txt
/delivery succeeds only when the user can see or use the requested result live, and the final report clearly shows where and how it was verified.
```

