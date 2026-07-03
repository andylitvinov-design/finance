# Active Incoming Ledger

## Status

- This is the only active EzoHata incoming-ledger implementation.
- The production source of truth is `https://github.com/andylitvinov-design/finance.git`, this repository root, on a branch based on `origin/main`.
- `https://github.com/andylitvinov-design/ezohata-incoming-ledger.git` is not the production source of truth unless an explicit migration is being performed and verified end-to-end.
- Do not use the legacy `reconcile-v2/` folder as a new source of production commits.
- Production URL: `https://ezohata-incoming-ledger.vercel.app/`

## Global agent settings adapter

This repo uses the shared global agent settings layer for `/audit`, `/audit-fin`, `/delivery`, UI polish, design quality gates, deep technical issue writing, deep numeric implementation trace, and project routing.

Read these shared docs before local command docs:

- `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-settings.md`
- `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-command-protocols.md`
- `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-project-adapters.md`
- `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-skills.md`

This file is the Finance local adapter. Keep finance-specific safety rules here, especially production source proof and formula/accounting do-not-touch rules, but do not duplicate the full shared command protocols in local command files.

## Project Memory

Before production debugging, read the shared project memory:

- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/production-debug-protocol.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/DEBUG_PLAYBOOK.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/CHECKS.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/RISKS.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/DEBUG_LOG.md`

Before creating or optimizing Claude Code prompts for this finance project, read/apply:

- Repo-local: `CLAUDE_CODE_PROMPTS.md`
- Global standard: `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/claude-code-prompt-standard.md`
- Finance-specific standard: `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/CLAUDE_CODE_PROMPTS.md`

After meaningful production work, update the relevant project memory files or explicitly report that a memory update is needed.

## Agent Command Registry

### `/audit`

`/audit` is sufficient by itself for finance-project UI/UX/product/technical diagnosis.

Use it for dashboard/table/report screens, mobile/desktop layout, navigation, filters, data-loading states, visible errors, production/debug endpoint visibility, chart/table/card consistency, and UX around financial values.

For numeric, calculation, balance, total, currency, date-range, or ledger mismatches, prefer `/audit-fin`.

When the user invokes `/audit`, follow these sources:

1. `.claude/commands/audit.md`
2. `AGENTS.md`
3. `CLAUDE_CODE_PROMPTS.md`
4. Shared audit protocol: `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-loop.md`
5. UI polish addendum: `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-ui-polish-skill.md`
6. RY agent audit modes: `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/ry-agent-audit-modes.md`

Required chain:

```txt
understand target -> prove production source when relevant -> inspect project rules -> inspect relevant code/read-only endpoints -> evaluate UX/UI/product/technical layers -> map symptoms to code-level findings -> create/update GitHub issue -> return short /delivery prompt
```

For finance UI, always check whether visible numbers reconcile with machine-readable endpoints and whether loading/error/empty states avoid misleading financial conclusions.

When GitHub access is available, create or update issues in:

```txt
https://github.com/andylitvinov-design/finance/issues
```

Final chat output must include a copy-pasteable handoff prompt starting with
`/delivery` as the first non-empty line, or `/delivery-big` when the issue has
more than 3 independent requirements, more than 2 system areas, or asks for an
autonomous repair loop. Do not start with `/audit -> /delivery handoff`.

### `/audit-fin`

`/audit-fin` is sufficient by itself for finance/numeric diagnostic work.

Use it for every question about balances, totals, ledgers, payments, income/expense, provider/channel breakdowns, exchange/currency, movement tables, periods/date ranges, reconciliation, dashboard values, charts, formulas, numeric UI mismatches, stale production data, and source-of-truth mismatch.

When the user invokes `/audit-fin`, follow these sources:

1. `.claude/commands/audit-fin.md`
2. `AGENTS.md`
3. `CLAUDE_CODE_PROMPTS.md`
4. Shared finance audit protocol: `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-fin-loop.md`
5. Failed-repair addendum: `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-fin-failed-repair.md`
6. RY agent audit modes: `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/ry-agent-audit-modes.md`

Required chain:

```txt
understand numeric target -> prove production source -> extract numeric contract -> inspect visible numbers -> inspect read-only evidence endpoints -> inspect code/data flow -> run source-layer matrix before hypotheses -> compare expected vs actual -> list problems -> generate focused hypotheses only from failing/unverified layers -> evaluate hypotheses -> choose likely root cause -> create/update GitHub issue -> return short /delivery prompt
```

Mandatory finance source-layer matrix before hypotheses:

1. Production source-of-truth: repo/ref/deployed SHA.
2. Raw ledger/data availability.
3. Input parsing/normalization.
4. Provider/channel/source classification.
5. Date range and timezone boundaries.
6. Currency/exchange/precision.
7. State and selection.
8. Formula/business logic.
9. Aggregation helper/code.
10. Persistence/hydration/cache.
11. Formatting/rounding/sign display.
12. Rendering/component binding.
13. Chart/table/card consistency.
14. API/debug endpoint proof.
15. Test fixture/proof.

For each layer:

```txt
Layer status: PASS | ISSUE | NOT VERIFIED | NOT APPLICABLE
Problem level: NONE | LOW | MEDIUM | HIGH | BLOCKER
Evidence:
Gap:
Next verification:
```

Rules:

- Do not patch formulas during `/audit-fin`.
- Do not modify production financial data during `/audit-fin`.
- Do not invent missing financial values.
- Do not treat missing data as zero unless product rules explicitly say so.
- Do not hide real calculation/data errors behind UI empty states.
- Do not generate a huge generic hypothesis list.
- If previous fixes failed, run failed-repair analysis before proposing another fix.
- If production source-of-truth is stale or the wrong repo/ref is deployed, fix deployment/source mismatch before blaming formulas.

When GitHub access is available, create or update issues in:

```txt
https://github.com/andylitvinov-design/finance/issues
```

Issue title format:

```txt
[AUDIT-FIN] <area/metric>: <short numeric problem summary>
```

Final chat output must include a copy-pasteable handoff prompt starting with
`/delivery` as the first non-empty line, or `/delivery-big` when the issue has
more than 3 independent requirements, more than 2 system areas, or asks for an
autonomous repair loop. Do not start with `/audit-fin -> /delivery handoff`.

### `/delivery`

Claude Code must treat `/delivery` as a named repository command, not as an ordinary one-shot giant prompt.

`/delivery` is sufficient by itself. The user must not need to add extra wording such as "I explicitly delegate merge".

When the user invokes `/delivery`, that invocation means full safe delivery delegation:

```txt
implement -> checks -> PR -> PR health -> merge if safe/permitted -> Vercel deploy -> live verification
```

When the user invokes `/delivery`, follow these local source-of-truth files in order:

1. `.claude/commands/delivery.md`
2. `.claude/commands/delivery-big.md` and `docs/global-delivery-big-protocol.md` when the task escalates to `/delivery-big`
3. `docs/delivery-loop-program.md`
4. `docs/delivery-loop-technical-details.md`
5. `docs/delivery-loop-source-patterns-and-live-proof.md`
6. `docs/delivery-design-quality-gate.md`
7. `AGENTS.md`
8. `CLAUDE_CODE_PROMPTS.md`

The user may also invoke `/delivery-big` directly. Treat it as the large-task
delivery mode: it inherits every `/delivery` rule and adds a Task Manifest,
Scope Contract, Verification Matrix, Repair Loop, and strict DONE gate. Codex
discovery paths are `.codex/commands/delivery-big.md` and
`.codex/skills/delivery-big/SKILL.md`.

For UI tasks, `/delivery` must also follow `docs/delivery-design-quality-gate.md`. Build/check/live/API proof is not enough for UI delivery.

Before `STATUS: SUCCESS` on UI tasks, final output must include `DESIGN QUALITY GATE` and `UI POLISH / FEEL-BETTER PASS`. Use `jakubkrehel/make-interfaces-feel-better` when installed, or the fallback checklist from `docs/delivery-design-quality-gate.md` when unavailable.

If any required design item is `FAIL` or `NOT VERIFIED`, `/delivery` must run another improvement loop or report an exact blocker instead of claiming success.

`/delivery` is an explicit exception to the default rule against combining diagnose + patch + tests + PR + deploy + production verification in one ordinary prompt. The exception is allowed because `/delivery` is not a loose giant prompt: it is a staged, checkpointed, finance-safe release-owner loop with hard stop states.

The loop must still obey finance safety:

- diagnose and prove the failing layer before patching;
- minimal patch only;
- no broad repo scan unless justified;
- no unrelated refactor;
- no environment/secrets changes without explicit user approval;
- no destructive data repair, migrations, or backfills;
- no balance/gross/net/fee/source semantic changes without proven root cause and regression tests;
- no Ledger append path may skip duplicate checks before writing rows; this
  applies to OCR/screenshots, manual imports, CSV/statement imports, browser
  imports, and provider imports including PayPal, Wise, Binance, Monobank,
  Privat24, TD, Bank Canada, YooMoney/Yandex, cash/manual, and future providers;
- duplicate checks must run before `ledger save`, using provider/native IDs
  first, transfer group IDs second, and a stable fallback fingerprint from date,
  direction, channels, currency, amount, counterparty/comment, and source when
  provider IDs are missing;
- screenshot/history imports must not treat every visible row as new. High
  confidence duplicates must be skipped with a structured warning, medium
  confidence matches must return `needs_review`, and data repair after a dedupe
  bug must be dry-run-first and exact-match-only;
- every new Ledger import path must include regression coverage for exact ID
  duplicates, fallback fingerprint duplicates, already-present screenshot
  history rows, genuinely new same-amount transactions, and unchanged
  gross/net/fee/source semantics;
- merge to `main` is allowed by the `/delivery` command itself only after release guard, relevant tests/checks, PR health, and task coverage pass;
- if merge is blocked by permissions, branch protection, required review, failed checks, finance-risk, deployment access, or live verification access, stop with `STATUS: BLOCKED` and exact evidence.

Final `/delivery` status must be exactly one of:

- `STATUS: SUCCESS` — task implemented, checked, PR/merge completed if permitted, deployed, and verified on live.
- `STATUS: BLOCKED` — exact blocker, evidence, and required user action.

`STATUS: SUCCESS` also requires the Final Result Verification Gate from
`.claude/commands/delivery.md`: the original request contract must be checked
requirement by requirement, and every required item must be `PASS`.

Do not stop at code, PR, green checks, merge, deploy, or “should be live soon”.

## Claude Code Prompt Rule

When Andrey asks to create a Claude Code prompt for finance, use low-token staged prompts by default:

1. `/clear` for a new task.
2. One task only.
3. Diagnose first, no edits.
4. No broad repo scan.
5. Ask for the 1-3 most relevant files before expanding scope.
6. Minimal patch only after the failing layer/root cause is proven.
7. Tests and production verification are separate prompts when possible.

Never create one giant Claude Code prompt that asks for diagnose + patch + tests + PR + merge + deploy + production verification together **unless the user invokes `/delivery`**.

For `/delivery`, use the staged command protocol above. It is allowed to cover the full release path only because it has strict checkpoints, finance safety rules, and `SUCCESS`/`SUCCESS_WITH_AUTH_LIMITATION`/`BLOCKED` stop states. The `/delivery` command itself is the user's delegation to proceed through safe merge, deployment verification, and live verification.

## Production Debug Preflight

For every production UI/runtime/API/provider/balance bug, run source-of-truth preflight before patching formulas or UI logic:

```bash
node scripts/production-debug-preflight.mjs
```

Report:

1. live URL;
2. `/api/status` HTTP status/content-type/body excerpt if failing;
3. production project/service;
4. production repo slug and canonical production repo (`andylitvinov-design/finance`);
5. deprecated repo marker (`andylitvinov-design/ezohata-incoming-ledger`);
6. production commit SHA;
7. production branch/ref;
8. status source (`/api/status`);
9. relevant open PRs;
10. classification: `source ok`, `deploy/source-of-truth mismatch`, or `needs verification`.

Before rollback or patch, always verify `/api/status` and confirm repo, branch/ref,
and deployed SHA. Do not rollback, patch, deploy, or open production PRs from
`andylitvinov-design/ezohata-incoming-ledger`; it is deprecated unless an
explicit migration is being performed and verified end-to-end.

If production does not contain the intended fix, or production is serving a stale feature branch, do not patch business formulas yet. Resolve deploy/source-of-truth mismatch first.

## Agent Debug Surface

For screenshot/UI aggregate discrepancies, use this read-only evidence chain before patching:

1. `/api/status` — prove deployed commit/source.
2. `/api/audit-snapshot` — prove normalized ledger, balance, provider, exchange, source, and daily-balance state.
3. `/api/debug-ui-state` — prove server-derived UI aggregate inputs and channel breakdowns.
4. Screenshot/user report — use only after the machine-readable evidence above.

`/api/debug-ui-state` is routed through the existing `/api/index` function, so it does not add another Vercel Hobby serverless function. It is observability only and must not become a finance calculation source of truth.

## Movement Table Invariant

For `Движение средства`, the rendered `Итого` row under `BALANCE` must equal the sum of visible numeric `NUMBER` rows for the selected period.

Known regression fixture:

- period: `2026-05-05..2026-05-11`;
- wrong total: `-340.5000`;
- visible rows sum: `218.2244`;
- expected total: `218.2244`.

If this fails, first check production source-of-truth. Then patch the final movement aggregation/render layer.

## Autonomy

Default mode: **Production Debugger Autopilot**.

### No Clarification Bias

Prefer autonomous best-effort execution over asking questions. If the user gives an actionable bug report, screenshot, audit note, or desired UI/business outcome, proceed from the most likely interpretation and document assumptions in the final report instead of pausing for confirmation.

Do not ask clarification questions when a safe next step exists. First inspect repo, live read-only endpoints, recent PRs/commits, and relevant docs; then make the smallest safe patch or produce the most concrete Codex prompt/plan possible.

Use questions only as a last resort when all of these are true:

- the missing detail blocks any safe progress;
- guessing could corrupt money, balances, ledger data, provider credentials, or production source of truth;
- the decision cannot be recovered with a small reversible patch or clear `needs verification` note.

When uncertain, choose the least risky reversible action and label assumptions clearly. Do not stop work merely because multiple implementation paths exist; pick the minimal path that preserves existing finance semantics.

Do not ask the user for confirmation before safe engineering actions:

- inspect repo-local code/docs and project memory;
- check recent PRs/commits and production source-of-truth metadata;
- check live read-only endpoints such as `/api/status`, `/api/audit-snapshot`, and `/api/debug-ui-state`;
- create a branch/worktree from `origin/main`;
- edit/update files for a minimal safe patch;
- add/update regression tests;
- run tests/build/release guard;
- commit, push a working branch, and open/update a PR when repository access allows it.

### Self-Run Checks Before Delegation

Run available verification yourself before delegating checks to Codex. Do not default to prompts like "Codex should run checks" when this session or local environment can run read-only/live checks, repo inspections, tests, build, or release guard.

When you cannot run a check yourself, state the exact blocker, for example: no local checkout, no shell, missing dependency, no browser runner, no write permission, or tool access unavailable. Then provide the smallest concrete fallback.

Codex prompts must ask for implementation work, not only verification. A good Codex prompt should include the intended code/data-report change, target files, failing layer to prove first, regression tests to add or update, commands to run, and live verification. Avoid using Codex as a substitute for work the assistant could already perform directly.

If using Codex after partial assistant work, include what was already checked, what was already changed, what remains unverified, and the exact expected patch or data-repair output. Codex should continue from that state, not restart with generic investigation.


## Expected Auth Boundary

Follow `docs/delivery-auth-boundary-standard.md` when Google OAuth, Supabase auth, private cabinet login, or an owner-only session blocks automated post-login live verification. Expected auth boundaries are not delivery failures by themselves. Use `STATUS: SUCCESS_WITH_AUTH_LIMITATION` when safe public/login/protected-redirect/local-or-code proof passes and the only missing proof is authenticated post-login live verification.

## Agent memory router

Before `/delivery`, `/audit`, `/audit-fin`, `/save`, `/memory`, `/memory-review`, `/learn-pass`, or `/upgrade`:

1. Read `agent-memory/active.md`.
2. Read `agent-memory/index.md`.
3. Identify task scope.
4. Read only relevant topic/component files.
5. Do not load archive unless resolving conflicts or running `/memory-review`.
6. Do not load candidates/metrics unless running `/learn-pass`, `/memory-review`, or `/upgrade`.
7. Do not load harness proposals/tests unless running `/upgrade`.

For `/save`, use `.codex/skills/save/SKILL.md` if present.
For `/memory`, use `.codex/skills/memory/SKILL.md` if present.
For `/memory-review`, use `.codex/skills/memory-review/SKILL.md` if present.
For `/learn-pass`, use `.codex/skills/learn-pass/SKILL.md` if present.
For `/upgrade`, use `.codex/skills/upgrade/SKILL.md` if present.

Do not load the whole instruction tree by default.
