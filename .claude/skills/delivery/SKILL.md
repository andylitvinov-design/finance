---
name: delivery
description: Run the low-confirmation safe production delivery loop for the finance project: implement, check, PR, merge if safe/permitted, Vercel deploy, and live verification. Use when Andrey invokes /delivery or asks to deliver a task to live.
argument-hint: "[task]"
disable-model-invocation: true
user-invocable: true
---

# /delivery — LOW_CONFIRMATION_DELIVERY_LOOP

`/delivery` is sufficient by itself.

The command is full safe delivery delegation for this repository:

```txt
implement -> checks -> PR -> PR health -> merge when green/permitted -> deploy -> live verification
```

Do not ask the user for extra confirmation merely to:

- inspect repo files/docs;
- create a branch or worktree;
- edit intended files;
- run safe checks/builds/tests;
- create or update a PR;
- inspect PR health and CI;
- fix failed checks when safe;
- merge when green and permitted;
- trigger the repo deployment fallback;
- verify live/API behavior.

Ask or stop only for real blockers:

- missing permission;
- failed checks that cannot be fixed safely;
- required human review or branch protection;
- missing deployment secret/access;
- auth boundary with no safe public/local/code proof;
- requested change touches secrets, billing, auth provider settings, production data, provider credentials, finance semantics, or destructive operations.

## Source of truth

Read local files first:

1. `.claude/commands/delivery.md`
2. `AGENTS.md`
3. `CLAUDE_CODE_PROMPTS.md`
4. `docs/delivery-loop-program.md`
5. `docs/delivery-loop-technical-details.md`
6. `docs/delivery-loop-source-patterns-and-live-proof.md`
7. `docs/delivery-design-quality-gate.md`
8. `docs/delivery-auth-boundary-standard.md`

Global docs in `andylitvinov-design/reiki-yggdrasil` are shared stable context. Do not repeatedly fetch external URLs during one delivery run unless local context is missing and the run truly needs the latest shared protocol.

## Project adapter

- Repository: `andylitvinov-design/finance`
- Default branch: `main`
- Target branch: `main`
- Package manager: `npm`
- Framework: static HTML + Vercel Functions
- Build: `npm run build`
- Test: `node --test tests/*.test.*`
- Release guard: `bash scripts/release-guard.sh`
- Primary live URL: `https://ezohata-incoming-ledger.vercel.app`
- Status URL: `https://ezohata-incoming-ledger.vercel.app/api/status`
- Production verify: `npm run verify:production`

## Completion rule

Implementation is not completion.

Before final success, verify the Original Request Contract requirement by requirement. Use:

```txt
PASS
PARTIAL
FAIL
NOT VERIFIED
```

`STATUS: SUCCESS` requires all required items to pass or documented allowed auth limitation.

For UI tasks, final report must include:

```txt
DESIGN QUALITY GATE
UI POLISH / FEEL-BETTER PASS
```

## Finance safety

Run release guard before PR/merge when product code changed.

Do not change balance/gross/net/fee/source semantics without proven root cause and regression tests.

Do not run destructive data repair, migrations, or backfills unless explicitly requested.

Do not change env/secrets/billing/provider credentials.

## Final statuses

```txt
STATUS: SUCCESS
STATUS: SUCCESS_WITH_AUTH_LIMITATION
STATUS: BLOCKED
```

Do not stop at code, PR, CI, merge, deploy, or “should be live soon”.

Do not print secret values. Report secret names only.
