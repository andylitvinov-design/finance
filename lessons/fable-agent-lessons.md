# Fable Agent Lessons

Use this file for short lessons from frontier-orchestrated `/upgrade` runs.

Rules:

- Add only 1-3 lessons per run.
- Keep each lesson short and reusable.
- Prefer evidence-backed checks over general advice.
- Do not store secrets, personal data, transcripts, or long logs.

Template:

```md
## YYYY-MM-DD — <project/task>

- Failed/fragile:
- Check next time:
- Prompt/workflow that worked:
```

## 2026-07-03 — finance / delivery upgrade run

- Failed/fragile: JS regex `\b` is ASCII-only — `[цu]\b` never matches after Cyrillic "ц", so an OCR channel-currency replacement silently no-oped while its detection regex matched (PR #610 shipped with this test red on main).
- Check next time: run `npm test` on origin/main before starting any work; a red main means the previous PR merged without green CI.
- Prompt/workflow that worked: audit live data via `/api/audit-snapshot?period=YYYY-MM` — default period is derived from min/max ledger operation dates, so "period.to in the past" means missing ledger data (e.g. July had 0 rows), not a date bug.
