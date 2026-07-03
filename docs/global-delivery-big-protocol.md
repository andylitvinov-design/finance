# Global /delivery-big Protocol

Status: canonical, cross-project source of truth for the `/delivery-big` command.

This document is the single canonical specification for `/delivery-big`. Both the
Claude Code adapter (`.claude/commands/delivery-big.md`) and the Codex adapter
(`.codex/commands/delivery-big.md`) reference this file for full behavior and
repeat the non-negotiable hard gates locally so a stub can never drop them.

If this document and a command adapter disagree, this document wins, except where
a project-local `AGENTS.md` / adapter is intentionally more specific about that
project's repo, commands, or gates.

---

## 1. Purpose

`/delivery-big` is an autonomous large-task delivery mode.

- It **inherits all normal `/delivery` rules** (see section 3).
- It is designed for **4+ independent requirements or 3+ task clusters**.
- It **must not silently drop requirements**.
- It runs a **verify-and-repair loop** before final reporting.
- It is safe to run **overnight/autonomously** for safe actions, but stops for
  hard gates (section 5).

`/delivery-big` is **not** a replacement for `/planner`:

- `/planner` creates/refines the issue and phase plan.
- `/delivery-big` executes a large issue with a Task Manifest + repair loop.

`/delivery-big` is **not** a weaker `/delivery`: every normal `/delivery` rule
still applies; `/delivery-big` only adds structure on top.

---

## 2. When to use `/delivery-big` vs `/delivery`

### Normal `/delivery`

Use for focused tasks with:

- 1–3 independent requirements;
- one primary system area;
- straightforward verification;
- low risk of losing subtasks.

### `/delivery-big`

Use for large autonomous delivery with any of:

- more than 3 independent requirements; OR
- more than 2 system areas; OR
- user says "на ночь", "сам перепроверь", "loop", "доделай всё по списку",
  "не теряй задачи", or asks for autonomous/overnight work; OR
- issue contains a long checklist, screenshots, multiple follow-up comments, or
  several unrelated acceptance criteria.

If a command is invoked explicitly as `/delivery-big`, **always** use Task
Manifest loop mode even if the task count is borderline.

### System area examples

Treat these as separate system areas:

- homepage/catalog UI;
- product detail pages;
- cart/order/payment;
- parser/data/search;
- admin/auth/storage;
- backend/API/provider integrations;
- CI/tests/build/deploy;
- docs/agent commands/runbooks.

---

## 3. Inherit normal `/delivery`

`/delivery-big` explicitly includes all normal `/delivery` behavior:

- locate the repo root correctly;
- read project setup instructions first;
- inspect repo state (`pwd`, `git status`, `git branch --show-current`,
  `git remote -v`, relevant files/docs);
- branch from the current canonical base;
- respect scope and non-goals;
- do **not** commit secrets, tokens, `.env`, cookies, private dumps, or user
  data, and do not print secret values;
- implement scoped changes only; prefer editing existing architecture over
  duplicating components/data models/routes;
- preserve the project's canonical baseline; do not swap it for an older
  alternative;
- run project checks;
- push the branch and create/update a PR;
- report branch, PR, commits, changed files, and verification.

See `.claude/commands/delivery.md`, `.codex/commands/delivery.md`, and the
`/delivery` section of `docs/global-command-protocols.md` for the base rules.

---

## 4. Project setup discovery

Before coding, `/delivery-big` reads the **same setup files as `/delivery`** for
that project, plus this protocol.

Read order:

1. Repo-local command adapter (`.claude/commands/` or `.codex/commands/`).
2. `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`.
3. `docs/global-command-protocols.md`, `docs/global-agent-settings.md`,
   `docs/global-project-adapters.md`, this file.
4. Relevant product docs, memory, tests, and linked issues/specs.

For Psihotavr specifically, preserve the existing discovery protocol:

- find `package.json` with `"name": "ezohata-mandala-store"`;
- read `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, global docs, and
  command files;
- use canonical repo `andylitvinov-design/psihotavr`, branch `main`, live URL
  `https://psihotavr.vercel.app`.

For other projects, use their project-specific setup docs and canonical
repo/deploy source. If they are missing, infer minimally and report the gap in a
`PROJECT ADAPTER GAP` section (section 20) — do not guess silently.

---

## 5. Autonomous no-confirmation mode + hard gates

`/delivery-big` is intended for autonomous overnight work. It should **not stop
for confirmation** for normal safe actions:

- reading files;
- creating a branch;
- editing scoped files;
- running install/build/test/lint/typecheck;
- starting a local preview;
- using browser/manual checks;
- committing;
- pushing the branch;
- opening/updating a PR;
- writing docs/checklists/tests inside scope.

It **must still stop** for hard gates:

- secrets/credentials needed;
- live money/payment actions;
- destructive production data changes;
- deleting user or customer data;
- changing backend/provider config outside explicit scope;
- ambiguity that can materially change product direction;
- actions requiring external account-owner approval.

When a hard gate is hit, mark the affected Task ID `BLOCKED`, keep making safe
progress on other tasks, and report the blocker.

---

## 6. Big prompt trigger / split gate

Before coding, count requirements and system areas. Switch into Task Manifest
loop mode when:

- the prompt/issue has more than 3 independent tasks; OR
- the prompt/issue touches more than 2 system areas; OR
- the user asks for an autonomous/overnight loop; OR
- the issue contains multiple comments/screenshots that add requirements.

If invoked explicitly as `/delivery-big`, always use Task Manifest loop mode.

---

## 7. Context consolidation + Working Summary

Before coding, consolidate context from:

- issue body;
- issue comments;
- linked PR comments if referenced;
- screenshots attached or described by the user;
- project docs/memory relevant to delivery;
- current repo state.

Do not rely only on the latest short prompt when the issue is the source of
truth.

For very large issues/comments, first create a compact **Working Summary** — a
by-Task-ID summary, not prose paragraphs:

```md
## Working Summary
Source of truth: Issue #...
Task IDs: ...
Non-goals: ...
Hard gates: ...
Verification commands: ...
```

Rules:

- do not drop requirements because the prompt is long;
- if context is too large, summarize by Task ID, not by paragraph;
- keep links/references to the original issue/comments so another agent can
  audit.

---

## 8. Task Manifest (with source tracking)

Before coding, extract **every** requirement into stable Task IDs. Every Task ID
must be traceable to its source.

```md
## Task Manifest

TASK-HOME-1: Restore video/question near top
Area: homepage UI
Source: issue body
Status: TODO
Verify: mobile + desktop screenshot

TASK-CART-1: Remove phone/email/contact dropdown from Telegram-first cart form
Area: cart/order UX
Source: issue comment 2026-07-02 / screenshot
Status: TODO
Verify: mobile cart screenshot + DOM absence
```

Rules:

- every user requirement gets a Task ID;
- IDs must be stable and human-readable;
- group IDs by system area;
- each Task ID records its **Source** (issue body / issue comment / screenshot /
  linked PR / user prompt);
- include the verification evidence needed for each task;
- include non-goals separately;
- include blockers only when genuine.

---

## 9. Anti-drift controls

`/delivery-big` must protect against scope drift during long autonomous work:

- create the initial Task Manifest and **never silently change it**;
- if new requirements are discovered in comments/screenshots, **append** them as
  new Task IDs and mark the source (e.g. `Source: issue comment 2026-07-02`);
- if a Task ID needs to be split, keep the original parent ID and add child IDs
  (e.g. `TASK-CART-1a`, `TASK-CART-1b`);
- do **not** replace user requirements with agent-preferred redesigns;
- do **not** mark a task `PASS` based only on "looks okay" when the task has a
  specific verification requirement.

### Owner preference preservation

- if the owner rejected a previous agent design, do not reintroduce that design
  without explicit approval;
- document owner preferences as Task IDs or constraints;
- for UI work, prioritize matching owner screenshots/text over generic best
  practice, unless it conflicts with explicit acceptance criteria.

---

## 10. Scope Contract (with risk scoring)

Before implementation, write a Scope Contract in notes and in the final report:

```md
## Scope Contract

Included Task IDs:
- TASK-... (risk: LOW/MEDIUM/HIGH)

Excluded Task IDs:
- TASK-... — reason

Non-goals:
- ...

Likely files:
- ...

Risk gates:
- ...
```

Default for `/delivery-big`: **include all safe Task IDs** from the prompt/issue.
Do not exclude a task only because it is time-consuming. Exclude only if blocked,
unsafe, or explicitly out of scope.

### Risk scoring per Task ID

- `LOW`: UI/docs/test-only, easy rollback;
- `MEDIUM`: data normalization, parser/search, cart/order behavior;
- `HIGH`: payments, auth, backend, storage, migrations, production data.

High-risk tasks need explicit gates and may be excluded or split unless the issue
explicitly authorizes them.

---

## 11. Phase Plan

Implement by phases, but continue through all safe phases in the same autonomous
run. Recommended order:

1. Low-risk UI/docs changes.
2. Data/model/parser/search changes.
3. Integration/backend changes only when explicitly scoped and safe.
4. Regression tests/scripts.
5. Final full verification.
6. Repair iterations.

Each phase ends with focused verification before moving on.

---

## 12. Verification Matrix

Every Task ID must have evidence. The final report must include:

```md
| Task ID | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| TASK-... | ... | issue body/comment/screenshot | PASS/PARTIAL/BLOCKED/TODO | ... |
```

### Status definitions

- `PASS`: implemented and verified with evidence.
- `PARTIAL`: implemented partly or not fully verified.
- `BLOCKED`: impossible without credentials/env/product decision/hard gate.
- `TODO`: not attempted; **unacceptable for `STATUS: DONE`**.

### Evidence quality gate

Evidence must be concrete enough for the owner or another agent to verify
quickly.

Good evidence:

- command output summary: `npm run build ✓`, `npm run typecheck ✓`;
- screenshot filename/link **and viewport/route**;
- DOM assertion, script output, or test name;
- URL/path checked;
- exact API endpoint response with secrets redacted;
- file + component changed for that Task ID.

Weak evidence that must **not** count as `PASS` by itself:

- "implemented";
- "should work";
- "visually checked" without viewport/path;
- "tests pass" when no task-specific test/manual check was run.

### Local / preview / production distinction

The final report must state exactly:

- `Local checks: ...`
- `Preview verification: ...`
- `Production verification: not run / run / blocked`

Do not claim production behavior unless current deployment metadata and the live
page/API were checked after merge/deploy.

---

## 13. Repair Loop

After the first implementation and checks, audit the Task Manifest. If any
included Task ID is `PARTIAL` or `TODO` and not genuinely blocked:

1. run a repair iteration;
2. implement the missing pieces;
3. rerun focused verification;
4. update the Task Manifest table.

**Default max repair iterations: 4.** Stop earlier only when all included Task
IDs are `PASS` or the remaining items are truly `BLOCKED`.

### Time / iteration budget behavior

When time or context is running out:

- prioritize completing already-started tasks and preserving repo consistency;
- commit coherent progress only if checks are not catastrophically broken;
- never hide unfinished tasks;
- final status must be `PARTIAL` if any included Task ID is not `PASS`;
- include the exact next prompt for continuation.

---

## 14. Self-review pass (before final report)

Before the final report, run a self-review step:

```md
## Self-review

1. Re-read original prompt/issue.
2. Re-read issue comments added before this run started.
3. Compare every user requirement to Task Manifest.
4. Check final diff for unintended files.
5. Check every Task ID has evidence.
6. If any requirement is missing, run repair loop or mark BLOCKED/PARTIAL.
```

---

## 15. DONE hard rule

Hard rule: **`/delivery-big` must not report `STATUS: DONE` unless every included
Task ID is `PASS`.**

If any included Task ID is `PARTIAL`, `TODO`, or `BLOCKED`, the final status must
be:

- `STATUS: PARTIAL` if meaningful work was completed but not all tasks passed;
- `STATUS: BLOCKED` if no safe progress can be made.

When not `DONE`, the final report must include a ready follow-up `/delivery` or
`/delivery-big` prompt for the remaining work (section 18).

---

## 16. Final status line + report table

The final report must **start with exactly one status line**:

```text
STATUS: DONE
```

or

```text
STATUS: PARTIAL
```

or

```text
STATUS: BLOCKED
```

Immediately after the status line, include the Task ID table (section 12) so
automation/owner scanning is easy.

---

## 17. Regression coverage preference

For every bug fixed, prefer adding one of:

- unit test;
- integration test;
- script assertion;
- browser smoke check;
- documented manual verification step.

If no automated test is practical, the final report must say why and include a
manual regression step.

---

## 18. Required failure follow-up prompt

If the final status is `PARTIAL`/`BLOCKED`, `/delivery-big` **must** provide a
ready-to-paste continuation prompt that includes:

- repo;
- issue;
- branch/PR to continue from;
- remaining Task IDs;
- exact blockers;
- checks already passed;
- next recommended actions.

Example:

```text
/delivery-big
Repo: <repo>
Issue: <issue URL>
Continue from branch: <branch> (PR <#>)
Remaining Task IDs: TASK-SEARCH-2 (PARTIAL), TASK-PAY-1 (BLOCKED: needs live keys)
Blockers: TASK-PAY-1 requires production payment credentials (hard gate).
Already passed: npm run build ✓, npm run typecheck ✓, TASK-HOME-*, TASK-CART-*.
Next: finish TASK-SEARCH-2 parser normalization, add regression test, re-verify.
```

---

## 19. Checkpointing for overnight runs

For long runs, include local/checkpoint notes in the final report. Recommended
checkpoints:

- after context consolidation;
- after implementation phase 1;
- after full checks;
- after each repair iteration.

If the agent crashes or context is lost, another agent should be able to resume
from: branch name, latest commit, Task Manifest statuses, remaining tasks, and
verification already completed.

---

## 20. PR / branch strategy + main drift

### PR strategy

Default: **one PR for one coherent big issue.** Split PRs only when:

- tasks become independent enough to reduce risk;
- one phase is blocked but others are complete;
- product code and docs changes are safer separated;
- a PR would become too large to review.

If split PRs are created, produce a PR map:

```md
| PR | Task IDs | Status | Why split |
|---|---|---|---|
| #123 | TASK-HOME-*, TASK-CART-* | PASS | UX-only low-risk |
| #124 | TASK-SEARCH-* | PARTIAL | Parser/search required separate regression |
```

### Branch and commit strategy

Use clear branch names such as `codex/delivery-big-command` or
`claude/delivery-big-<topic>`. Use phase-oriented commits (e.g.
`Add delivery-big command docs`, `Document delivery-big global rollout`). Do not
commit unrelated changes.

### Clean working tree / merge readiness

Before the final report:

- the working tree must be clean except for intentionally untracked
  artifacts/screenshots documented in the report;
- the branch must be pushed;
- a PR must exist or be updated;
- PR mergeability/check state should be reported if available;
- if a PR cannot be created due to auth/tooling, report the exact blocker plus
  branch/commit.

### Unrelated PR / main drift handling

For overnight work, `main` may move while the agent works. `/delivery-big`
should:

- start from the current canonical base;
- before the final report, fetch/rebase/merge `main` if required and safe;
- rerun relevant checks after rebase;
- resolve conflicts only if within scope; otherwise mark `BLOCKED`/`PARTIAL`.

---

## 21. Test selection discipline

For big tasks, full checks can be expensive:

1. run focused checks after each phase;
2. run full checks before the final report;
3. if full checks fail due to unrelated pre-existing issues, prove scope
   cleanliness and report the pre-existing failure clearly.

Do not use "pre-existing" as an excuse without evidence.

---

## 22. Artifact / screenshot handling

When user screenshots are part of the issue:

- list each screenshot-derived requirement in the Task Manifest;
- include the intended viewport/device;
- verify with a matching viewport when possible;
- preserve owner visual preferences unless they conflict with explicit acceptance
  criteria.

If browser screenshots are produced:

- store them in a temporary/report location or report paths as supported by
  tooling;
- do not commit large screenshots unless the repo convention allows it;
- include viewport and route in the evidence table.

---

## 23. Update issue / PR checklist when possible

When safe and supported by tools, `/delivery-big` should update the GitHub issue
or PR comment with:

- the Task Manifest;
- the final Task ID table;
- remaining `PARTIAL`/`BLOCKED` items;
- the follow-up prompt if not `DONE`.

Do not spam multiple comments during normal progress. Prefer one final structured
comment unless the run is long and needs a checkpoint.

---

## 24. Required checks

Default checks include normal `/delivery` checks plus project-specific checks.

For docs-only command changes:

- inspect changed files;
- confirm no product source files changed;
- run markdown/lint checks if present;
- if no markdown checks exist, report that explicitly.

For product `/delivery-big` tasks, include project-specific build/test commands.
For Psihotavr when applicable:

- `npm run lint`
- `npm run typecheck`
- `npm test` if available;
- `npm run build`;
- local browser/manual verification for UI changes;
- Vercel verification only when relevant and safe.

---

## 25. Compatibility with existing commands

- `/delivery-big` does **not** weaken `/delivery`.
- `/delivery-big` does **not** replace `/planner`.
- `/planner` may recommend `/delivery-big` when the generated issue has more than
  3 Task IDs or more than 2 system areas.
- `/delivery` may **escalate** to `/delivery-big` behavior when the prompt/issue
  clearly has more than 3 independent tasks or asks for an overnight loop, and
  must report: `Escalated to /delivery-big mode because: <reason>`.
- Existing automations may choose `/delivery-big` for overnight multi-task runs.

### Agent memory / router integration

Register `/delivery-big` where project agents actually read commands:

- project command files (`.claude/commands`, `.codex/commands`);
- Codex skill adapters (`.codex/skills`) when the repo uses skill-style
  registration;
- project `AGENTS.md` / `CLAUDE.md` if they route command usage;
- global command protocol docs;
- project adapter docs;
- lessons/memory if the project uses persistent agent memory.

Do not assume a command file alone is enough if the project's router docs are
read first.

---

## 26. Dual-agent parity: Claude Code + Codex

The command exists for both agent systems:

- `.claude/commands/delivery-big.md`
- `.codex/commands/delivery-big.md`
- `.codex/skills/delivery-big/SKILL.md` when the project uses Codex skills

Both must be functionally equivalent and include the same protocol sections:
Purpose; Inherit `/delivery`; Project setup discovery; Autonomous safe-action
mode; Hard gates; Big prompt trigger; Context consolidation; Task Manifest; Scope
Contract; Phase Plan; Verification Matrix; Repair Loop; DONE hard rule; Final
report table; Global rollout notes.

Differences are allowed only where the agent runtime differs:

- Claude Code may reference `.claude/commands/delivery.md` and Claude-specific
  startup/setup behavior.
- Codex may reference `.codex/commands/delivery.md`, Codex skills, and its own
  approval/sandbox model.

Neither file may be a weak stub unless it clearly references this shared protocol
and still contains the critical gates locally (Task Manifest required; Scope
Contract required; Repair Loop required; DONE hard rule; PASS evidence required).

### Cross-agent source-of-truth pattern

- this shared protocol doc = full canonical behavior;
- `.claude/commands/delivery-big.md` = agent-specific adapter + critical gates +
  link to this protocol;
- `.codex/commands/delivery-big.md` = agent-specific adapter + critical gates +
  link to this protocol.
- `.codex/skills/delivery-big/SKILL.md` = thin Codex skill adapter + critical
  gates + links to this protocol and the Codex command file, when `.codex/skills`
  is used.

---

## 27. Command discovery verification

Prove both systems can discover the command.

```md
## Command discovery verification

Claude Code:
- [ ] `.claude/commands/delivery-big.md` exists.
- [ ] Filename uses the exact command name: `delivery-big.md`.
- [ ] Command references/inherits `.claude/commands/delivery.md`.
- [ ] Project setup discovery points to the correct project root.
- [ ] If a Claude session does not see the command, restart Claude Code and
      verify the project root.

Codex:
- [ ] `.codex/commands/delivery-big.md` exists.
- [ ] `.codex/skills/delivery-big/SKILL.md` exists if the project uses
      skill-style registration.
- [ ] Filename/skill name uses the exact command name: `delivery-big`.
- [ ] Command references/inherits `.codex/commands/delivery.md`.
- [ ] Codex setup/router docs mention `/delivery-big` as available.
```

If a repo uses `.codex/skills/` for any command or workflow registration, add a
small `.codex/skills/delivery-big/SKILL.md` adapter pointing to this shared
protocol and the Codex command file.

---

## 28. Cross-project rollout

### Local Finance adapter

- Canonical repo: `andylitvinov-design/finance`.
- Default branch: `main`.
- Project root detection: `package.json` with `"name": "ezohata-incoming-ledger"`.
- Live target: `https://ezohata-incoming-ledger.vercel.app`.
- Source docs: `AGENTS.md`, `CLAUDE.md`, `.claude/commands/delivery.md`,
  finance delivery-loop docs, `README.md`, and `package.json`.
- Verification commands: `npm run build`, `node --test tests/*.test.*`,
  `bash scripts/release-guard.sh`, and `npm run verify:production` when the
  task touches runtime behavior and the required environment is available.
- Hard gates: no secrets, env/provider settings, billing, destructive
  production data changes, or finance formula/source semantics unless explicitly
  scoped and backed by source-layer proof and regression tests.
- Preferred branch prefix: `codex/delivery-big-<topic>`.

### Installation modes

1. **Copy mode** — each repo gets its own `.claude/commands/delivery-big.md` and
   `.codex/commands/delivery-big.md` with full content.
2. **Reference mode** — each repo has a short command file that references this
   shared global protocol plus the project adapter, while still repeating the
   non-negotiable hard gates locally.

**Recommended default: reference mode** where agents can reliably follow shared
docs; **copy mode** where they cannot.

### Rollout checklist per project

```md
## /delivery-big rollout checklist per project

- [ ] Project has normal `/delivery` command docs.
- [ ] Project has `/delivery-big` command docs or a shared command reference.
- [ ] Project has canonical repo/default branch/deploy source documented.
- [ ] Project has setup commands documented.
- [ ] Project has verification commands documented.
- [ ] Project has hard gates documented.
- [ ] `/delivery-big` final report table is required.
- [ ] DONE hard rule is present.
```

### Project adapter requirements

Each project should define an adapter with:

- canonical repo;
- default branch;
- production/deploy source;
- package/project root detection;
- setup docs to read;
- install/build/test/lint/typecheck commands;
- local preview command;
- deployment verification method;
- protected areas/secrets/backend gates;
- preferred PR/branch conventions.

For Psihotavr, keep the existing adapter details in
`docs/global-project-adapters.md`.

### Project adapter completeness check

When rolling `/delivery-big` into another project, check adapter completeness
against the list above. If the adapter is incomplete, add a `PROJECT ADAPTER GAP`
section instead of guessing silently.

### Active projects strategy

Do not modify every repo unless explicitly instructed. Instead, install the
protocol in one repo and hand off a reusable rollout prompt. Roll out per repo as
separate PRs, not one giant cross-repo change, unless the owner explicitly asks
for a multi-repo run.

### Rollout validation command

After installation in a repo, run a docs-only validation:

- confirm the Claude command path exists;
- confirm the Codex command/skill path exists;
- confirm this shared protocol is referenced;
- confirm `/planner` can recommend `/delivery-big` for large issues;
- confirm `/delivery` can escalate to `/delivery-big` behavior;
- confirm the project adapter has no critical gaps.

### GLOBAL ROLLOUT PROMPT

Paste this into another active project to install `/delivery-big` there:

```text
/delivery-big
Repo: <target repo>
Goal: Install the /delivery-big command for both Claude Code and Codex, consistent
with the global /delivery-big protocol, without changing product code.

Before editing, run an adapter completeness check:
- canonical repo, default branch, production/deploy source;
- project root detection;
- setup docs to read;
- install/build/test/lint/typecheck commands;
- local preview command;
- deployment verification method;
- protected data/secrets/hard gates;
- PR/branch conventions.
If any are missing, add a PROJECT ADAPTER GAP section instead of guessing.

Install (reference mode preferred, copy mode if agents cannot follow shared docs):
- .claude/commands/delivery-big.md (Claude adapter + critical gates + link to shared protocol);
- .codex/commands/delivery-big.md or .codex/skills/delivery-big/SKILL.md if the repo uses skills
  (Codex adapter + critical gates + link to shared protocol);
- docs/global-delivery-big-protocol.md (copy this canonical protocol) OR reference it;
- update project adapter docs;
- if AGENTS.md / CLAUDE.md route commands, register /delivery-big there;
- update /planner to recommend /delivery-big for large issues (>3 Task IDs or >2 areas);
- update /delivery to allow escalation to /delivery-big mode.

Preserve project-specific commands and gates. Do not weaken existing /delivery or /planner.

Verify (docs-only):
- confirm no product source files changed;
- run markdown/lint checks if present, else report none exist;
- confirm .claude and .codex command/skill paths exist;
- run the rollout validation command above.

Final report:
- STATUS: DONE/PARTIAL/BLOCKED;
- branch, PR, commits, changed files;
- Claude Code availability (command path, inherits, discovery notes);
- Codex availability (command/skill path, inherits, discovery notes);
- recommended mode: copy/reference;
- confirmation product code was not changed;
- Task ID table: | Task ID | Requirement | Source | Status | Evidence |.
```

---

## 29. Examples

### Invocation

```text
/delivery-big
Repo: andylitvinov-design/psihotavr
Issue: <large issue link>
Mode: overnight autonomous loop
Goal: complete all safe Task IDs, repair until PASS or BLOCKED.
```

### Smoke-test scenario

```md
Example: issue has 6 tasks across homepage, cart, and search.
Expected: /delivery-big extracts TASK-HOME-*, TASK-CART-*, TASK-SEARCH-*; creates
Scope Contract; implements safe tasks; verifies each; repairs missing items;
reports DONE only when all PASS.
```

### Final report example

```text
STATUS: PARTIAL

| Task ID | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| TASK-HOME-1 | Restore video near top | issue body | PASS | mobile+desktop screenshot, route / |
| TASK-CART-1 | Remove phone/email field | issue comment 2026-07-02 | PASS | DOM absence, mobile cart screenshot |
| TASK-SEARCH-2 | Normalize parser output | screenshot | PARTIAL | build ✓, regression test still TODO |

Local checks: npm run build ✓, npm run typecheck ✓
Preview verification: preview deploy opened, cart route checked
Production verification: not run

Follow-up prompt: <see section 18>
```
