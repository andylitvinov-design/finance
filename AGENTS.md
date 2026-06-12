# Active Incoming Ledger

## Status

- This is the only active EzoHata incoming-ledger implementation.
- The production source of truth is `https://github.com/andylitvinov-design/finance.git`, this repository root, on a branch based on `origin/main`.
- `https://github.com/andylitvinov-design/ezohata-incoming-ledger.git` is not the production source of truth unless an explicit migration is being performed and verified end-to-end.
- Do not use the legacy `reconcile-v2/` folder as a new source of production commits.
- Production URL: `https://ezohata-incoming-ledger.vercel.app/`

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

### `/delivery`

Claude Code must treat `/delivery` as a named repository command, not as an ordinary one-shot giant prompt.

`/delivery` is sufficient by itself. The user must not need to add extra wording such as "I explicitly delegate merge".

When the user invokes `/delivery`, that invocation means full safe delivery delegation:

```txt
implement -> checks -> PR -> PR health -> merge if safe/permitted -> Vercel deploy -> live verification
```

When the user invokes `/delivery`, follow these local source-of-truth files in order:

1. `.claude/commands/delivery.md`
2. `docs/delivery-loop-program.md`
3. `docs/delivery-loop-technical-details.md`
4. `docs/delivery-loop-source-patterns-and-live-proof.md`
5. `AGENTS.md`
6. `CLAUDE_CODE_PROMPTS.md`

`/delivery` is an explicit exception to the default rule against combining diagnose + patch + tests + PR + deploy + production verification in one ordinary prompt. The exception is allowed because `/delivery` is not a loose giant prompt: it is a staged, checkpointed, finance-safe release-owner loop with hard stop states.

The loop must still obey finance safety:

- diagnose and prove the failing layer before patching;
- minimal patch only;
- no broad repo scan unless justified;
- no unrelated refactor;
- no environment/secrets changes without explicit user approval;
- no destructive data repair, migrations, or backfills;
- no balance/gross/net/fee/source semantic changes without proven root cause and regression tests;
- merge to `main` is allowed by the `/delivery` command itself only after release guard, relevant tests/checks, PR health, and task coverage pass;
- if merge is blocked by permissions, branch protection, required review, failed checks, finance-risk, deployment access, or live verification access, stop with `STATUS: BLOCKED` and exact evidence.

Final `/delivery` status must be exactly one of:

- `STATUS: SUCCESS` — task implemented, checked, PR/merge completed if permitted, deployed, and verified on live.
- `STATUS: BLOCKED` — exact blocker, evidence, and required user action.

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

For `/delivery`, use the staged command protocol above. It is allowed to cover the full release path only because it has strict checkpoints, finance safety rules, and `SUCCESS`/`BLOCKED` stop states. The `/delivery` command itself is the user's delegation to proceed through safe merge, deployment verification, and live verification.

## Production Debug Preflight

For every production UI/runtime/API/provider/balance bug, run source-of-truth preflight before patching formulas or UI logic:

```bash
node scripts/production-debug-preflight.mjs
```

Report:

1. live URL;
2. `/api/status` HTTP status/content-type/body excerpt if failing;
3. production project/service;
4. production repo slug;
5. production commit SHA;
6. production branch/ref;
7. relevant open PRs;
8. classification: `source ok`, `deploy/source-of-truth mismatch`, or `needs verification`.

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
