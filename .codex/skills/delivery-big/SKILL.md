# /delivery-big — Codex Skill Adapter

Use this skill when the user invokes `/delivery-big`, asks for a large autonomous
delivery loop, or gives a delivery task with more than 3 independent requirements
or more than 2 system areas.

This is a thin Codex skill adapter. Canonical behavior lives in
`docs/global-delivery-big-protocol.md`; the project command reference lives in
`.codex/commands/delivery-big.md`. Read both before acting.

## Required source order

1. `docs/global-delivery-big-protocol.md`
2. `.codex/commands/delivery-big.md`
3. `.codex/commands/delivery.md` when present; otherwise `.claude/commands/delivery.md`
4. `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, and relevant docs

## Critical gates

- Task Manifest is required before coding. Every requirement gets a stable Task
  ID with source tracking and verification evidence needed.
- Scope Contract is required before coding. Include Task IDs, excluded Task IDs
  with reasons, non-goals, likely files, and risk gates.
- Repair Loop is required after initial implementation and checks. Default max:
  4 repair iterations.
- DONE is allowed only if every included Task ID is `PASS`.
- If any included Task ID is `PARTIAL`, `TODO`, or `BLOCKED`, final status must
  be `STATUS: PARTIAL` or `STATUS: BLOCKED`, with a follow-up prompt.
- Final report must include this table:

```md
| Task ID | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
```

## Codex discovery paths

Codex should be able to discover `/delivery-big` through both project paths:

- `.codex/commands/delivery-big.md`
- `.codex/skills/delivery-big/SKILL.md`

Keep this skill in sync with the command file if the critical gates change.
