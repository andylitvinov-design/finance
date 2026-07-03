# /delivery

`/delivery` is full finance-safe delivery delegation: implement minimal proven fix, check, PR, merge when green/permitted, deploy, and verify live behavior or documented auth-safe substitute.

## Source of truth

Read in order:

1. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-settings.md`
2. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-command-protocols.md`
3. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-project-adapters.md`
4. `https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/global-agent-skills.md`
5. `AGENTS.md` - Finance local adapter and safety rules
6. `CLAUDE_CODE_PROMPTS.md`
7. `docs/delivery-auth-boundary-standard.md`
8. `docs/global-delivery-big-protocol.md` when the task escalates to `/delivery-big`
9. `docs/delivery-loop-program.md`
10. `docs/delivery-loop-technical-details.md`
11. `docs/delivery-loop-source-patterns-and-live-proof.md`
12. `docs/delivery-design-quality-gate.md`

## Finance project adapter

- Repository: `andylitvinov-design/finance`
- Default branch: `main`
- Package manager: `npm`
- Framework: static HTML + Vercel Functions on Node 20+
- Build: `npm run build`
- Test: `node --test tests/*.test.*`
- Release guard: `bash scripts/release-guard.sh`
- Production verify: `npm run verify:production`
- CI: GitHub Actions
- Deployment: Vercel auto-deploy from `main`
- Primary live URL: `https://ezohata-incoming-ledger.vercel.app`
- Status URL: `https://ezohata-incoming-ledger.vercel.app/api/status`

## Required behavior

Follow the shared `/delivery` chain and finance safety rules:

- prove the failing layer before patching;
- use minimal patches only;
- do not touch env/secrets/billing/provider settings;
- do not mutate production data;
- do not change balance/gross/net/fee/source/formula semantics without proven root cause and regression tests;
- use read-only API/source evidence for numeric claims;
- for UI tasks, include `DESIGN QUALITY GATE` and `UI POLISH / FEEL-BETTER PASS`.

## Escalation to /delivery-big

If the prompt or source issue has more than 3 independent requirements, touches
more than 2 system areas, or asks for an autonomous/overnight repair loop,
escalate internally to `/delivery-big` behavior. Read
`.claude/commands/delivery-big.md` and `docs/global-delivery-big-protocol.md`,
then use the Task Manifest, Scope Contract, Verification Matrix, and Repair Loop.
Report the escalation explicitly:

```txt
Escalated to /delivery-big mode because: <reason>
```

Final status must be exactly one of:

```txt
STATUS: SUCCESS
STATUS: SUCCESS_WITH_AUTH_LIMITATION
STATUS: BLOCKED
```
