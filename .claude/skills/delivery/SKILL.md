# Skill: /delivery — PRODUCTION_DELIVERY_LOOP

This skill does not define a separate protocol.
It points to the three source-of-truth docs that together define `/delivery` for any project.

Local source of truth (do not fetch external loop repos — use these local docs):
- `docs/delivery-loop-program.md`
- `docs/delivery-loop-technical-details.md`
- `docs/delivery-loop-source-patterns-and-live-proof.md`

If any external loop definition is unavailable, use the embedded local definitions from `docs/delivery-loop-source-patterns-and-live-proof.md`.

Source-of-truth docs (read all three before starting):

1. `docs/delivery-loop-program.md` — full protocol, stop states, final report format
2. `docs/delivery-loop-technical-details.md` — scripts, commands, CI/CD checks, agent decision table
3. `docs/delivery-loop-source-patterns-and-live-proof.md` — embedded loop patterns and live proof contract

Project adapter: see `AGENTS.md` → Agent Command Registry → `/delivery`.

Default live target: `https://ezohata-incoming-ledger.vercel.app`
SUCCESS requires live proof on this URL unless another target is explicitly requested.
Secondary and legacy URLs cannot satisfy SUCCESS for production delivery by default.

---

## Execution Order

Run the embedded loops in this order (from doc 3, section 16):

1. Project Adapter
2. Acceptance Criteria Extraction
3. Task Coverage Audit — initial
4. Implementation
5. Build Until Green
6. Local Checks Until Clean
7. Ship PR Until Green
8. CI Failure Watcher (if CI fails)
9. PR Babysitter
10. Task Coverage Audit — pre-merge
11. Merge Until Confirmed
12. Deploy Verification Loop
13. Fix Deploy (if deployment/live fails)
14. Live Verification Loop
15. Task Coverage Audit — live
16. Final Evidence Report

---

## Stop States

### STATUS: SUCCESS

Allowed only when the task is implemented, merged if required, deployed to the target environment, and the requested behavior is verified live.

Must include completed live proof block:

```txt
LIVE PROOF:
- Live URL:
- Checked route/page:
- Final deployed commit:
- Expected live behavior:
- Actual live behavior:
- Evidence:
```

### STATUS: BLOCKED

Allowed only when a real external blocker prevents completion.

Must include:

```txt
- Where the loop stopped:
- What is complete:
- What is not complete:
- Exact blocker:
- Evidence:
- Required user action:
- Next prompt to run after unblocking:
```

---

## Rules

- Act as release owner, not only a coding assistant.
- Extract acceptance criteria from the original task before coding.
- Create a project adapter at the start of every run.
- Run: code → local checks → PR → PR health → task coverage audit → merge if permitted → deployment verification → live verification.
- Never claim SUCCESS from code, PR, CI, merge, or deployment alone.
- Never say "should be live soon" as a final answer.
- If evidence is missing, status is BLOCKED, not SUCCESS.
- Never disable tests, bypass branch protection, or hide failed checks.
- Never print secret values — report secret names only.

## Finance-Specific Rules

- Run `bash scripts/release-guard.sh` before every PR.
- For production bugs, run `node scripts/production-debug-preflight.mjs` first.
- Never change balance/gross/net/fee/source semantics without proven root cause and regression tests.
- Deploy fallback: `gh workflow run deploy-production.yml --ref main -f ref=main -f expected_sha=<SHA> -f reason="<reason>"`
- After merge, verify: `npm run verify:production -- <SHA>`

## Cost-Control Rules

- Use the stable source-of-truth docs as cached/stable context. Place them first. Do not duplicate the full protocol in dynamic prompts each loop step.
- Put current task / logs / diffs / PR status after the stable protocol context.
- Prefer diffs over full files. Read only relevant files first. Do not scan the full repository unless necessary.
- Stop after **3 failed fix attempts** on the same issue — return `STATUS: BLOCKED` with the 3 attempts described.
- Never touch env vars, secrets, billing, production database, or auth-sensitive settings without explicit user approval. Stop and describe the required action.
- Use cheapest capable model/tooling for routine status checks, file listing, PR body edits, and repetitive summaries.
- Use stronger reasoning only for architecture gate, hard debugging, security-sensitive review, or final delivery-risk review.
- Final report must include:

```txt
COST CONTROL:
- Stable project context reused:
- Dynamic context separated:
- Diffs preferred over full files:
- Full repo scan avoided:
- Loop attempts used:
- Same-issue retry count:
- Expensive reasoning used for:
- Cost/token risk: low / medium / high
- What was avoided to save cost:
```
