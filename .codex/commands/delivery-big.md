# /delivery-big (Codex)

Use this file as the Codex project-level `/delivery-big` workflow reference.

Codex project slash-command support was not confirmed in this environment. This
repo therefore exposes `/delivery-big` through both Codex project paths:
`.codex/commands/delivery-big.md` and `.codex/skills/delivery-big/SKILL.md`. If
`/delivery-big` is not handled as a project command, use the skill adapter,
`AGENTS.md`, and `docs/global-delivery-big-protocol.md` as the reliable fallback
and treat `/delivery-big` as a workflow marker, not as a shell command.

Canonical behavior lives in `docs/global-delivery-big-protocol.md`. This file is
the Codex adapter: it links to that protocol **and** repeats the non-negotiable
hard gates locally so they can never be dropped.

`/delivery-big` is the autonomous **large-task** delivery mode. It inherits all
normal `/delivery` behavior and adds a Task Manifest, verification matrix, repair
loop, and a strict DONE gate for prompts/issues with 4+ independent requirements.

## Read first (source of truth order)

1. `docs/global-delivery-big-protocol.md` (canonical `/delivery-big` behavior).
2. `.codex/commands/delivery.md` when present; otherwise `.claude/commands/delivery.md` (inherited `/delivery` rules).
3. `docs/global-command-protocols.md`, `docs/global-agent-settings.md`,
   `docs/global-project-adapters.md`.
4. `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, relevant product docs.

## 1. Purpose

- Inherits **all** normal `/delivery` rules.
- Built for **4+ independent requirements or 3+ task clusters**.
- Must **not silently drop requirements**.
- Runs a **verify-and-repair loop** before final reporting.
- Safe to run overnight for safe actions; stops for hard gates.
- Not a replacement for `/planner`. Not a weaker `/delivery`.

## 2. Inherit normal `/delivery`

Includes every local `/delivery` rule (`.codex/commands/delivery.md` when present; otherwise `.claude/commands/delivery.md`): use the linked issue/spec as
source of truth; inspect repo state (`pwd`, `git status`,
`git branch --show-current`, `git remote -v`); prefer existing architecture over
duplicates; preserve the canonical baseline; work in a branch; never commit
secrets/`.env`; run available verification; push branch and create/update PR;
report status, branch, PR, commit, verification, preview URL, limitations, next
steps.

## 3. Project setup discovery (Finance)

- Find `package.json` with `"name": "ezohata-incoming-ledger"`.
- Read `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, `.claude/commands/delivery.md`, finance delivery docs, and command files.
- Canonical repo `andylitvinov-design/finance`, branch `main`, live URL `https://ezohata-incoming-ledger.vercel.app`.
- Use finance safety rules for money, provider, ledger, source-of-truth, and production verification work. If setup docs are missing, add a `PROJECT ADAPTER GAP` section instead of guessing.

## 4. Autonomous no-confirmation mode

Within Codex's approval/sandbox model, do not stop for confirmation for safe
actions: read files; create branch; edit scoped files; install/build/test/lint/
typecheck; start local preview; browser/manual checks; commit; push branch;
open/update PR; write docs/checklists/tests in scope. If the sandbox blocks a
safe action (e.g. network for install), report it as an environment limitation,
not a dropped task.

## 5. Hard gates (must stop)

Secrets/credentials needed; live money/payment actions; destructive production
data changes; deleting user/customer data; changing backend/provider config
outside scope; ambiguity that materially changes product direction; actions
requiring external account-owner approval. Mark the Task ID `BLOCKED`, keep safe
progress on other tasks, report the blocker.

## 6. Big prompt trigger

Use Task Manifest loop mode when: >3 independent tasks; OR >2 system areas; OR
autonomous/overnight loop requested; OR multiple comments/screenshots add
requirements. If invoked as `/delivery-big`, always use loop mode.

## 7. Context consolidation + Working Summary

Consolidate issue body, issue comments, linked PR comments, screenshots, project
docs/memory, and repo state. Do not rely only on the latest short prompt. For
very large issues, first write a compact `Working Summary` by Task ID (not
prose), keeping links to the original issue/comments.

## 8. Task Manifest (critical gate — required)

Extract every requirement into stable, human-readable Task IDs grouped by area,
each with **Source** tracking:

```md
## Task Manifest

TASK-CART-1: Remove phone/email/contact dropdown from Telegram-first cart form
Area: cart/order UX
Source: issue comment 2026-07-02 / screenshot
Status: TODO
Verify: mobile cart screenshot + DOM absence
```

Anti-drift: never silently change the manifest; append newly discovered
requirements as new Task IDs with source; split with parent/child IDs
(`TASK-CART-1a`); do not replace requirements with agent-preferred redesigns;
preserve owner preferences and screenshots over generic best practice.

## 9. Scope Contract (critical gate — required) + risk scoring

```md
## Scope Contract
Included Task IDs: - TASK-... (risk: LOW/MEDIUM/HIGH)
Excluded Task IDs: - TASK-... — reason
Non-goals: - ...
Likely files: - ...
Risk gates: - ...
```

Default: include all safe Task IDs. Exclude only if blocked, unsafe, or
explicitly out of scope — never just because it is time-consuming. Risk: `LOW`
UI/docs/test; `MEDIUM` data/parser/search/cart; `HIGH` payments/auth/backend/
storage/migrations/production data (gate or split HIGH unless explicitly
authorized).

## 10. Phase Plan

1. Low-risk UI/docs → 2. Data/model/parser/search → 3. Integration/backend (only
if scoped and safe) → 4. Regression tests/scripts → 5. Final full verification →
6. Repair iterations. Each phase ends with focused verification.

## 11. Verification Matrix (critical gate — required)

Every Task ID needs concrete evidence:

```md
| Task ID | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
```

Status: `PASS` (verified with evidence) / `PARTIAL` (partial or unverified) /
`BLOCKED` (needs creds/env/decision/hard gate) / `TODO` (not attempted —
unacceptable for DONE).

Evidence quality gate — good: `npm run build ✓`, screenshot filename+viewport+
route, DOM/script/test output, URL/path, redacted API response, file+component.
Weak (not PASS alone): "implemented", "should work", "visually checked" without
viewport/path, "tests pass" with no task-specific check.

State exactly: `Local checks:` / `Preview verification:` /
`Production verification: not run / run / blocked`. Do not claim production
behavior without checking live deploy after merge.

## 12. Repair Loop (critical gate — required)

Audit the manifest after first implementation. For each included `PARTIAL`/`TODO`
Task ID not genuinely blocked: repair → implement missing pieces → rerun focused
verification → update the table. **Default max 4 iterations.** Stop earlier only
when all included Task IDs are `PASS` or remaining ones are truly `BLOCKED`.

Budget behavior when running out of time/context: finish started tasks, keep repo
consistent, commit coherent progress, never hide unfinished tasks, status is
`PARTIAL` if any Task ID is not `PASS`, include the next prompt.

## 13. Self-review (before final report)

Re-read the original prompt/issue and pre-run comments; compare every requirement
to the manifest; check the diff for unintended files; confirm every Task ID has
evidence; run repair or mark `BLOCKED`/`PARTIAL` for anything missing.

## 14. DONE hard rule (critical gate — required)

**Never report `STATUS: DONE` unless every included Task ID is `PASS`.** Otherwise
`STATUS: PARTIAL` (meaningful work, not all passed) or `STATUS: BLOCKED` (no safe
progress). When not DONE, include a ready follow-up `/delivery-big` prompt.

## 15. Branch / PR / main drift

One PR per coherent big issue (split only to reduce risk, with a PR→Task-ID map).
Branch like `codex/delivery-big-<topic>`; phase-oriented commits; no unrelated
changes. Before final report: clean working tree (except documented artifacts),
branch pushed, PR created/updated, mergeability reported. If `main` drifted,
fetch/rebase/merge if safe, rerun checks, resolve in-scope conflicts only else
mark `BLOCKED`/`PARTIAL`.

## 16. Checks

Docs-only: inspect changed files; confirm no product source changed; run
markdown/lint if present, else report none exist. Product tasks: `npm run lint`, `npm run typecheck`, `npm test` if present,
`npm run build`, local browser/manual for UI, Vercel only when safe. Focused
checks per phase; full checks before final report; if full checks fail on
pre-existing issues, prove scope cleanliness with evidence.

## 17. Command discovery verification

```md
Codex:
- [ ] `.codex/commands/delivery-big.md` exists (this file).
- [ ] `.codex/skills/delivery-big/SKILL.md` exists (skill adapter).
- [ ] Filename/skill name is exactly `delivery-big`.
- [ ] References/inherits local `/delivery` rules (`.codex/commands/delivery.md` when present; otherwise `.claude/commands/delivery.md`).
- [ ] Codex setup/router docs (`AGENTS.md`) mention `/delivery-big`.
Claude Code:
- [ ] `.claude/commands/delivery-big.md` exists.
```

## 18. Final status line + report

Start the report with exactly one line: `STATUS: DONE` / `STATUS: PARTIAL` /
`STATUS: BLOCKED`. Then the Task ID table (section 11). Include checkpoints
(branch, latest commit, manifest statuses, remaining tasks, verification done)
and, when not DONE, the follow-up prompt.

## 19. Global rollout

Cross-project rollout, copy vs reference mode, adapter completeness check, and the
`GLOBAL ROLLOUT PROMPT` live in `docs/global-delivery-big-protocol.md`
(sections 26–28). Reference mode is the recommended default.

## Project baseline

Use this repository's current `origin/main` plus `AGENTS.md` and `.claude/commands/delivery.md` as the local baseline. Do not import Psihotavr-specific baseline rules into Finance.
