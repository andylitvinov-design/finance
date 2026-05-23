# Claude Code Prompt Rules for Finance

Purpose: make Claude Code prompt rules obvious inside the finance repo. Use this file whenever Andrey asks ChatGPT to create a Claude Code prompt for finance / ledger / PayPal / Wise / Яндекс / balance / plan-fact / expenses.

Canonical shared rules:

- Global Claude Code prompt standard: https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/claude-code-prompt-standard.md
- Finance-specific prompt rules: https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/ezohata-incoming-ledger/CLAUDE_CODE_PROMPTS.md

## Mandatory rule

Claude Code prompts for this repo must be short, staged, low-token, and finance-safe.

Default staged workflow:

1. `DIAGNOSE ONLY`
2. `INSPECT ONLY`
3. `MINIMAL PATCH`
4. `TEST ONLY`
5. `PRODUCTION VERIFY`

Do not combine diagnose + patch + tests + PR + deploy + production verification in one huge prompt.

## Default constraints

Include these constraints in most Claude Code prompts for this repo:

```text
Do not scan the whole repo.
Do not inspect unrelated files.
Ask before expanding scope.
Keep output under 300-500 words.
Minimal patch only.
No unrelated refactor.
Do not change environment configuration.
Run only relevant tests.
```

Finance-specific constraints:

```text
Do not change balance/gross/net/fee/source semantics without proven root cause and regression tests.
Do not treat PayPal gross as net when fee is missing.
Do not run destructive data repair, migrations, or backfills.
Do not modify Google Sheets / ledger rows unless explicitly requested.
For production bugs, prove source of truth first via /api/status and relevant debug/audit endpoints.
```

## Failing-layer chain

Every finance Claude Code diagnosis should classify the issue through:

```text
deploy/source-of-truth -> UI -> API route -> provider/import -> normalization -> ledger save -> balance -> analytics
```

## Default prompt

```text
/clear

Task: diagnose only, no edits.

Project: finance / ezohata-incoming-ledger.

Problem:
[1-3 lines]

Expected:
[1 line]

Actual:
[1 line]

Evidence:
- [key fact]
- [key fact]

Scope:
Do not scan the whole repo.
Do not modify files.
Do not run broad tests.
First prove the likely failing layer:
deploy/source-of-truth -> UI -> API route -> provider/import -> normalization -> ledger save -> balance -> analytics.
If files are needed, ask for the 1-3 most relevant paths first.

Finance constraints:
Do not change balance/gross/net/fee/source semantics.
Do not change environment configuration.
Do not run data repair or migrations.

Output under 300 words:
1. likely failing layer
2. evidence needed
3. files needed
4. minimal next step
```
