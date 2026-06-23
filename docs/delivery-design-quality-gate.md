# /delivery — Design Quality Gate

Required for `/delivery` tasks that change or verify user-facing UI.

## Rule

Build/check/live proof is not enough for UI delivery.

Before `STATUS: SUCCESS`, prove that the delivered screen matches the user's visual request and feels finished, not merely functional.

## UI polish pass

Run `UI POLISH / FEEL-BETTER PASS`.

External skill:

```txt
jakubkrehel/make-interfaces-feel-better
```

Install/use when supported:

```bash
npx skills add jakubkrehel/make-interfaces-feel-better
```

Reference:

```txt
https://jakub.kr/skills/make-interfaces-feel-better
```

Fallback checklist:

```txt
https://github.com/andylitvinov-design/reiki-yggdrasil/blob/main/docs/audit-ui-polish-skill.md
```

## Check

- Original visual request matched.
- Mobile first screen is complete when requested.
- No accidental next-section cut.
- Primary action is clear.
- No duplicated or cluttered navigation.
- Critical tables and totals remain readable.
- Visual hierarchy is calm.
- Text density is acceptable.
- Desktop is not regressed.
- No raw/debug-looking UI remains outside debug-only areas.

## Failure rule

If any required design item is `FAIL` or `NOT VERIFIED`, do not report `STATUS: SUCCESS`.

Run another improvement loop or report the exact blocker.

## Final report block

```txt
DESIGN QUALITY GATE:
| Check | Status | Evidence | Fix if failed |
|---|---|---|---|

UI POLISH / FEEL-BETTER PASS:
| Check | Status | Evidence | Fix if failed |
|---|---|---|---|
```
