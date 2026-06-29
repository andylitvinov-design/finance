# Active Agent Memory

This file contains only high-value rules that are safe to load before `/delivery`, `/audit`, `/audit-fin`, `/save`, `/memory`, `/memory-review`, `/learn-pass`, or `/upgrade`.

Hard cap: 30–50 active rules. If this file grows beyond the cap, run `/memory-review` before adding more.

Do not store weak candidates, long evidence, or one-time product tweaks here.

---

## 2026-06-28 — Run memory as a compact lifecycle

Type: rule  
Memory type: procedural  
Scope: global / agent-memory  
Priority: high  
Status: active  

User signal:
> Project uses repo-local agent memory with `/save`, `/learn-pass`, `/memory-review`, and `/upgrade`.

Evidence:
- Canonical brain specs: `ai-projects-brain/agent-skills/save.md`, `agent-skills/learn-pass.md`, `agent-skills/memory-review.md`, `agent-skills/upgrade.md`

Lesson:
Agent memory is a compact instruction system, not a transcript. Use `/save` for user-directed durable rules, `/learn-pass` for candidate lessons and metrics, `/memory-review` for merge/replace/archive, and `/upgrade` for safe harness improvements. Always upsert instead of appending duplicates.

Apply when:
- Running `/delivery`, `/audit`, `/audit-fin`, `/save`, `/memory`, `/memory-review`, `/learn-pass`, or `/upgrade`
- Editing `agent-memory/` files
- Updating memory-related command/skill instructions

Check:
- Every active rule has `Apply when`, `Check`, and `Failure if ignored`.
- Similar or conflicting memory items are merged, narrowed, replaced, or archived instead of duplicated.
- Weak or single-signal lessons go to `candidates.md`, not `active.md`.
- Harness changes are recorded in `harness-proposals.md` and validated through `harness-regression-tests.md` before broad promotion.
- `archive.md`, `candidates.md`, `metrics.md`, `harness-proposals.md`, and `harness-regression-tests.md` are not loaded by default.

Failure if ignored:
- Memory can become noisy, causing agents to miss important rules or repeat known mistakes.

Avoid:
- Duplicate rules with different wording
- Contradictory active rules
- One-time visual tweaks in active memory
- Promoting weak candidates without evidence
- Applying broad harness changes without validation

Last applied:
- 2026-06-29 — Memory Upgrade automation pass

Related files/components:
- `agent-memory/index.md`
- `agent-memory/candidates.md`
- `agent-memory/metrics.md`
- `agent-memory/harness-proposals.md`
- `agent-memory/harness-regression-tests.md`
