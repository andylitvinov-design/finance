# /upgrade — Safe Agent Harness Upgrade

Use this skill when the user wants to improve the agent system itself: prompts, command adapters, routing rules, memory schemas, validation gates, installer templates, or tool-use workflows.

Canonical brain specs:

```txt
agent-skills/upgrade.md
agent-skills/self-harness.md
```

## Trigger

```txt
/upgrade
upgrade harness
улучши обвязку
улучши систему агентов
```

## Behavior

1. Read relevant memory:
   - `agent-memory/active.md`
   - `agent-memory/index.md`
   - `agent-memory/candidates.md`
   - `agent-memory/metrics.md`
   - `agent-memory/harness-proposals.md`
   - `agent-memory/harness-regression-tests.md`
2. Mine recurring weaknesses.
3. Propose the smallest harness change.
4. Validate with a smoke test, replay, checklist, or user confirmation.
5. Apply only safe Markdown harness changes.
6. For high-risk/global changes, create an issue/PR handoff.
7. Check rollout files in this project:
   - `.claude/commands/upgrade.md`
   - `.codex/skills/upgrade/SKILL.md`
   - `agent-memory/harness-proposals.md`
   - `agent-memory/harness-regression-tests.md`
   - `lessons/fable-agent-lessons.md`
8. If using a frontier orchestrator such as Fable, let it plan, delegate, verify, synthesize, and update lessons instead of doing mechanical copy/paste.
9. If asked for broad project improvement, run Project Upgrade Sweep:
   - check repo/live mapping confidence;
   - check missing adapters and project memory docs;
   - check repeated user pain, stale PRs, verification gaps, UI/default-state risks, and finance/auth/payment/data risks;
   - score Live confidence, Delivery confidence, Data/payment risk control, UX regression control, and Agent readiness from 0-3;
   - apply only safe docs/adapters/memory/runbook/checklist fixes;
   - produce exact `/delivery`, `/audit-fin`, `/audit-ui`, `/safe`, or Claude Code handoff prompts for risky/product work.
10. Report `Upgrade` with weakness, proposal, validation, project scores when relevant, changes, risk, lessons, handoffs, and next check.

Do not change product code unless explicitly requested.

## Fable handoff

```md
/upgrade

You are the frontier orchestrator for this project. Find the highest-leverage weakness in the project/agent loop, delegate implementation safely, verify with tool evidence, and leave durable lessons.

Check `.claude/commands/upgrade.md`, `.codex/skills/upgrade/SKILL.md`, `agent-memory/harness-proposals.md`, `agent-memory/harness-regression-tests.md`, and `lessons/fable-agent-lessons.md`.

Do not change product code during `/upgrade` unless explicitly requested. For product-code fixes, create a `/delivery` handoff.

Before reporting status, verify every factual claim against tool output. If not verified, say `needs verification`.

Update `lessons/fable-agent-lessons.md` with 1-3 short lessons.
```

## Project sweep handoff

```md
/upgrade

Run Project Upgrade Sweep for this project or active project set.

Find the highest-leverage weakness. Safely auto-fix only docs, adapters, memory, runbooks, and checklists. Do not change product code unless explicitly requested.

Score each project 0-3: Live confidence, Delivery confidence, Data/payment risk control, UX regression control, Agent readiness.

For anything risky or product-code-facing, create an exact `/delivery`, `/audit-fin`, `/audit-ui`, `/safe`, or Claude Code prompt with project/repo/live, goal, evidence, files/areas, non-goals, safe constraints, checks, stop condition, and final report format.

Verify factual claims with tool output or mark `needs verification`.
```
