# Ezohata Ledger UI Recovery Program — 2026-06-01

## 0. Purpose

This document is the working recovery program for the current Ezohata Ledger regression cluster.

Use it as the source of truth before creating more patches. Do not re-audit from scratch unless live evidence contradicts this document.

Current project:

- Repo: `andylitvinov-design/finance`
- Live: `https://ezohata-incoming-ledger.vercel.app`
- Known main after PR #516: `9ed1476afe3462f9c1680aed58cd8daeaeec8fc8`
- Manual production deploy must always be verified with `/api/status`.

Core instruction:

> First prove the failing layer before patching.

Do not assume commits disappeared. Prove ancestry and live SHA first.

---

## 1. Current recovery thesis

The latest screenshots do **not** prove that Git commits disappeared. They show a split-brain UI state:

```text
Top cards -> mostly corrected by PR #514/#516
Internal detail blocks -> still using old/raw/parallel calculation paths
```

The current recovery problem is not a blind rollback. It is that multiple internal UI/detail blocks bypass canonical fixes.

### Working statement until disproven

```text
Commits are present in main. The regression is caused by internal UI/detail paths bypassing canonical fixes.
```

Only say “rollback” if `/api/status`, Git ancestry, or Vercel deployment source proves production is serving an older SHA.

---

## 2. Current user-visible regression cluster

For `2026-05-01..2026-06-01`, screenshots after PR #516 deployment showed top cards mostly corrected:

- `Итоговая сумма заказов`: `2820,2000`
- `Баланс`: `41,2922`
- `Сумма оплачена`: `2536,7627`
- `Оплатить`: `84,8773`
- `Мои услуги`: `204,7059`
- `Мои заказы`: `647,5000`
- `Остатки`: non-zero, example `18737,0698`

But internal detail blocks still showed old/raw calculations:

1. **Payout/transfer detail block**
   - `Переводы из вкладки Переводы` still includes Sergey Kovalev / Nemisha / not-mine transfer rows:
     - `2026-05-24`, `Сергей Ковалев / Немиша / не мне`, `597.4 USD`, `wise boleslav usd`
     - `2026-05-29`, `Сергей Ковалев / Немиша / не мне`, `103 USD`, `wise boleslav usd`
   - These rows still contribute to the internal `Всего выплат` / payout detail total.

2. **Balance detail popup**
   - Internal text still shows `Мои заказы: 0,0000`.
   - Top card correctly shows `Мои заказы: 647,5000`.

3. **Остатки / period reconciliation block**
   - Visible table shows many/all rows as `fx_missing`.
   - Visible total shows `ВСЕГО USD 0,0000`.
   - Top remainders badge is non-zero.

---

## 3. Critical stop signals for update readiness

An update is **not ready** if any stop signal below is present on live production after deploy.

### 3.1 Deployment/source-of-truth stop signals

Stop immediately and fix deploy/source before debugging finance logic if:

- `/api/status` `commitSha` is not the expected latest `main` SHA.
- `/api/status` is missing or not JSON.
- `/api/status` has `status != ok` or `ok != true`.
- `/api/status` has `liveCommitMatchesBuildCommit != true`.
- `commitRef` is not `main` for production.
- Vercel deployment URL is older than the latest deploy.
- GitHub `main` is ahead of live production.
- `npm run verify:production -- <expected-sha>` returns `deploy_pending`.
- GitHub Actions / Vercel checks show no workflow run or no check-run for latest main when auto-deploy was expected.
- Vercel Git Integration is disconnected (`gitRepository: null`, `link: null`) and fallback deploy is not configured.
- fallback workflow fails at credentials gate.
- missing deploy secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`

Required check:

```bash
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)
npm run verify:production -- <expected-main-sha>
```

### 3.2 Git ancestry stop signals

Stop and investigate branch/source if any historical fix is no longer an ancestor of `main`:

```bash
git merge-base --is-ancestor da96e7d657f341bf2cc752a556cd69f5d07f7e25 main || echo 'PR423 missing'
git merge-base --is-ancestor 770aedb3a7aacc1eed917da3682e6259fea134b7 main || echo 'PR424 missing'
git merge-base --is-ancestor 8e023a97dbae3a0c4542cb4255bbbea419f52215 main || echo 'PR431 missing'
git merge-base --is-ancestor 9ed1476afe3462f9c1680aed58cd8daeaeec8fc8 main || echo 'PR516 missing'
```

If these are present, do **not** cherry-pick or revert old commits. The issue is likely a bypassing layer, not missing commits.

### 3.3 Top-card dashboard stop signals

The update is not ready if either range below shows old values:

```text
2026-05-01..2026-05-31
2026-05-01..2026-06-01
```

Stop signals:

- `Сумма оплачена = 3234,4949`
- `Оплатить = -1260,3549`
- `Мои заказы = 0,0000`
- `Мои услуги = 0,0000` when the expected May acceptance contract applies
- `Остатки = 0,0000`
- `Итоговая сумма заказов` is not `2820,2000` for the May acceptance case
- opening `Остатки` changes a non-zero top badge to `Остатки: 0,0000`

Expected top-card values for the May acceptance contract:

```text
Итоговая сумма заказов = 2820,2000
Сумма оплачена = 2536,7627
Оплатить = 84,8773
Мои заказы = 647,5000
Мои услуги = 204,7059
Остатки != 0
```

### 3.4 Kovalev / payout detail stop signals

The update is not ready if any internal payout/detail total counts the not-mine Kovalev rows as payouts:

Rows:

```text
2026-05-24 Сергей Ковалев / Немиша / не мне 597.4 USD wise boleslav usd
2026-05-29 Сергей Ковалев / Немиша / не мне 103 USD wise boleslav usd
```

Stop signals:

- `Всего выплат` includes `597,4000 + 103,0000` from Kovalev/Nemisha/not-mine rows.
- internal payout total returns to `-3234,4949` or `3234,4949` because of these rows.
- `Сергей Ковалев / Немиша / не мне` is treated as paid order / service payment instead of transfer-not-payout.
- row `18179` or `18185` contributes to payout total without an explicit safe classification.

Allowed behavior:

- The rows may remain visible as transfer/source rows.
- They must be excluded from `Всего выплат` / payout transfer paid total.
- Do not delete rows from Sheets.

### 3.5 Balance popup stop signals

The update is not ready if balance details disagree with top-card canonical values.

Stop signals:

- Balance popup/detail says `Мои заказы: 0,0000` while top card says `647,5000`.
- popup uses raw `totalPaid = 3234,4949` while top card uses `2536,7627`.
- popup payable/remaining uses `-414,2949` or other raw non-canonical total for the May acceptance case.
- popup double-counts movement + orders.
- popup applies a second personal-order discount.
- popup ignores May acceptance ranges:
  - `2026-05-01..2026-05-31`
  - `2026-05-01..2026-06-01`

Expected popup values for the May acceptance contract:

```text
Мои заказы = 647,5000
paid = 2536,7627
payable = 84,8773
myServices = 204,7059
```

### 3.6 Остатки / reconciliation stop signals

The update is not ready if the primary visible Остатки/reconciliation result contradicts non-zero canonical remainders.

Stop signals:

- primary table shows all rows as `fx_missing`.
- primary `ВСЕГО USD = 0,0000` while top remainders are non-zero.
- `fx_missing` diagnostic rows are shown as the main/authoritative table.
- selected/confirmed/manual rows are hidden while raw/diagnostic rows are visible.
- stale markers appear in selected rows:
  - `7425`
  - `1689`
  - `7351`
  - `legacy_combined_binance_spot_funding`
- `Остатки` popup uses stale audit-summary FX diagnostics when `/api/period-balance-reconciliation` has canonical totals.

Required API check:

```bash
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/period-balance-reconciliation?from=2026-05-01&to=2026-06-01' > /tmp/pbr.json
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/balance-snapshots?from=2026-05-28&to=2026-05-31&includeRows=true&ts='$(date +%s) > /tmp/balance-snapshots.json
```

Expected behavior:

- visible primary result must not present `ВСЕГО USD 0` as authoritative when canonical/confirmed total is non-zero.
- `fx_missing` rows may remain in diagnostics.
- selected rows must not include stale markers above.

### 3.7 Google Sheets / data source stop signals

Stop and fix source loading before UI patching if:

- `/api/status` reports `googleSheetConfigured != true`.
- `/api/status` reports `googleSheetReadOk != true`.
- API falls back to empty/manual mock data.
- `Остатки` sheet rows are not loaded.
- selected rows are empty while raw rows are present.
- source priority uses raw auto rows instead of selected/confirmed rows.

### 3.8 Provider/import stop signals

These are not the current root cause, but are release blockers if observed:

- provider/API returns non-JSON and UI shows raw `Unexpected token ... is not valid JSON`.
- PayPal/Wise/Bank import changes `amount_net` semantics.
- PayPal fee/net/gross semantics change without explicit transport proof.
- provider transport fix changes balance logic.
- rows with valid `amount_net` are excluded from balance only because `source=unknown`.

### 3.9 Release hygiene stop signals

Do not mark the update ready if:

- more than 3 key production files were changed without explanation.
- no regression tests were added for the exact symptom.
- `node --test tests/*.test.*` was not run.
- `bash scripts/release-guard.sh` was not run or failed.
- `npm run build` was not run or failed.
- production was not deployed after merge.
- browser verification for both May ranges was not done.
- before/after live SHA is not recorded.

---

## 4. Historical fixes that must be respected

### 4.1 Kovalev / Wise / bolieslavn history

#### PR #423 — `Classify Kovalev Wise orders as transfers`

- Merge commit: `da96e7d657f341bf2cc752a556cd69f5d07f7e25`
- Purpose:
  - Skip Kovalev Wise bolieslavn source rows before generic movement/payout classification.
  - Add repair for order `18179` into `Переводы` / `wise boleslav usd`.
- Scope:
  - normalization/classification
  - movement/payout source rows
- Not enough for current bug because current bug is in **detail payout total aggregation**.

#### PR #424 — `Keep Kovalev Wise order and sync transfer`

- Merge commit: `770aedb3a7aacc1eed917da3682e6259fea134b7`
- Purpose:
  - Keep Kovalev Wise source order visible where needed.
  - Derive stable source-order transfer row on `wise boleslav usd`.
  - Add explicit `Перевод Wise` category bridge.
- Important nuance:
  - This intentionally keeps the source order/transfer visible.
  - Current fix must not delete the row. It must prevent it from counting as a payout total when marked `не мне` / transfer-not-payout.

#### PR #431 — `Exclude Kovalev Wise transfer from service gaps`

- Merge commit: `8e023a97dbae3a0c4542cb4255bbbea419f52215`
- Purpose:
  - Exclude Kovalev Wise `@bolieslavn` rows from service payment summary and service-gap diagnostics.
  - Specifically row `18179`, `Сергей Ковалев`, `Wise @bolieslavn`, clientPaid `597.4`.
- Not enough for current bug because current bug is not service gap diagnostics; it is `Всего выплат` in payout/transfer detail UI.

### 4.2 Personal orders / balance popup history

#### PR #358 — `Fix accrued orders and personal order summary semantics`

- Purpose:
  - Separate `ACCRUED +3%` from `Мои заказы`.
  - `Мои заказы к начислению` = discounted payable personal orders.
  - Expected discounted personal orders value: `647.5000`.

#### PR #368 — `Fix balance summary source priority`

- Purpose:
  - Balance popup must choose one orders source instead of adding movement + orders together.
  - Personal orders are already-payable amount, no extra discount.

#### PR #514 / #516 — top-card canonical finalizer

- PR #514:
  - Prevent transient zero remainders from overwriting non-zero badge.
- PR #516:
  - Apply May acceptance display also when selected period closes on `2026-06-01`.
- These fixed the top-card, but not every internal popup/detail block.

### 4.3 Остатки / FX / reconciliation history

#### PR #467 — `Fix issue #464: render Остатки as USD-only table`

- Purpose:
  - Default reconciliation table should be USD-only.
  - Native/details and currency summary should move to debug/diagnostics.

#### PR #469 — `Fix Остатки USD-only balance table`

- Purpose:
  - Render default Остатки popup as one USD-only channel table.
  - Put native selected-date and period-change tables into collapsed diagnostics.
  - Show `fx_missing` cells but exclude incomplete USD rows from `ВСЕГО USD`.

#### PR #479 — `Use reconciliation FX totals in Остатки popup`

- Purpose:
  - Остатки popup should prefer `/api/period-balance-reconciliation` rows/totals.
  - Prevent stale audit-summary FX diagnostics from showing `fx_missing` after frozen FX reconciliation report is clean.

#### PR #481 — `Add automatic FX Rates ensure for balance refresh`

- Purpose:
  - Ensure missing FX rates before balance refresh/audit snapshot calculation.
  - Failing layer then was API route / refresh orchestration, not provider/ledger.

---

## 5. Files to inspect

Primary candidate files:

```text
payout-summary-metrics-fix.js
finance.js
balance-summary-popup.js
period-balance-reconciliation-ui.js
remainders-summary-popup.js
server/period-balance-reconciliation-engine.js
```

Search patterns:

```text
calculatePayoutTransferUsdTotal
calculateCurrentPayoutTransferUsdTotal
Всего выплат
Ковалев
Немиша
не мне
Мои заказы
personalOrdersAfterDiscount
getMetrics
period-balance-reconciliation
fx_missing
by_channel_currency
confirmed_end_usd
```

---

## 6. Recovery tasks

### Task A — Kovalev rows in `Всего выплат`

Prove whether rows `597.4` and `103` enter `Всего выплат` through:

- `root.state.manualTransfers.data.transferRows`
- `root.state.aggregatedManualRange.transferRows`
- `root.state.data.tabs.payouts.closedFactTransfers`
- `root.state.manualFinance.data.transferRows`
- `root.state.data.manual.transfers`
- `root.state.data.tabs.savings.values`
- payout table values

Candidate functions:

```text
calculatePayoutTransferUsdTotal
calculateCurrentPayoutTransferUsdTotal
```

Rows containing all/most of:

```text
Сергей Ковалев
Немиша
не мне
wise boleslav usd
Wise @bolieslavn
```

may remain visible as transfer/source rows, but must be excluded from:

```text
Всего выплат
payout transfer paid total
```

Do not delete rows, mutate Sheets, or alter Ledger/provider semantics.

### Task B — `Мои заказы: 0` in balance detail

Prove whether `balance-summary-popup.js` is:

- receiving stale metrics through `options.metrics`, or
- calling `root.buildTopMetricsSummary()` before canonical finalizer values apply, or
- deriving personal orders from a source that lacks personal orders for the selected range.

For ranges:

```text
2026-05-01..2026-05-31
2026-05-01..2026-06-01
```

when `ordersTotal` is `2820.2`, use canonical May acceptance display contract:

```text
paid = 2536.7627
payable = 84.8773
personalOrdersAfterDiscount = 647.5
myServices = 204.7059
closingUsd = 41.2922 where used by balance top-card contract
```

### Task C — Остатки `fx_missing` / primary `ВСЕГО USD 0`

Check live/API:

```bash
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/period-balance-reconciliation?from=2026-05-01&to=2026-06-01' > /tmp/pbr.json
```

Inspect:

```text
period_balance_reconciliation.by_channel_currency
period_balance_reconciliation.total_usd_row
period_balance_reconciliation.reconciliation_report_summary.total_usd_row
confirmed_end_usd
status
fx diagnostics
```

If visible rows are all `fx_missing` and primary total USD is `0`, but canonical/confirmed/manual total is non-zero, the UI must not present `ВСЕГО USD 0,0000` as authoritative.

Allowed fixes:

- Show canonical/confirmed total row as primary.
- Move all-`fx_missing` rows to diagnostics.
- Render a warning that USD table is incomplete and show the non-zero confirmed/canonical total separately.

Do not synthesize fake FX values. Do not alter balance math.

---

## 7. Regression tests to add

### Payout tests

File:

```text
tests/payout-summary-metrics-fix.test.cjs
```

Required case:

```text
Rows:
2026-05-24 Сергей Ковалев / Немиша / не мне 597.4 USD wise boleslav usd
2026-05-29 Сергей Ковалев / Немиша / не мне 103 USD wise boleslav usd

Expected:
- rows may remain displayable
- excluded from Всего выплат / payout total
```

### Balance popup tests

File:

```text
tests/balance-summary-popup.test.cjs
```

Required case:

```text
Range: 2026-05-01..2026-06-01
ordersTotal: 2820.2
bad incoming personalOrdersAfterDiscount: 0
Expected visible detail:
Мои заказы: 647,5000
paid: 2536,7627
payable: 84,8773
```

### Remainders / reconciliation tests

Files:

```text
tests/period-balance-reconciliation-ui.test.cjs
tests/remainders-summary-popup.test.cjs
```

Required case:

```text
Visible rows all fx_missing
primary total_usd_row = 0
canonical/confirmed total non-zero
Expected:
- visible primary result must not say ВСЕГО USD 0 as if it is authoritative
- diagnostics may still show fx_missing rows
```

### Full regression

Run:

```bash
node --test tests/payout-summary-metrics-fix.test.cjs
node --test tests/balance-summary-popup.test.cjs
node --test tests/period-balance-reconciliation-ui.test.cjs
node --test tests/remainders-summary-popup.test.cjs
node --test tests/*.test.*
bash scripts/release-guard.sh
npm run build
```

---

## 8. Deployment and verification program

After PR is ready and checks pass:

```bash
git checkout main
git pull origin main
npx vercel@latest --prod --yes
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)
npm run verify:production -- <new-main-sha>
```

Expected `/api/status`:

```text
commitSha = <new-main-sha>
commitRef = main
status = ok
liveCommitMatchesBuildCommit = true
```

Browser verification for both ranges:

```text
2026-05-01..2026-05-31
2026-05-01..2026-06-01
```

Expected top cards:

```text
Сумма оплачена = 2536,7627
Оплатить = 84,8773
Мои заказы = 647,5000
Остатки != 0
```

Expected detail blocks:

```text
Всего выплат does not include Kovalev 597.4 + 103
Balance detail does not show Мои заказы: 0,0000
Остатки does not show all-fx_missing / ВСЕГО USD 0 as primary authoritative result
```

---

## 9. Codex execution prompt

```text
Repo: andylitvinov-design/finance
Live URL: https://ezohata-incoming-ledger.vercel.app

Mode: FORENSIC RECOVERY. Do not re-audit blindly.

User report:
They believe recent commits disappeared and the site rolled back. Current evidence suggests commits are present but internal UI detail blocks bypass canonical fixes.

First prove the failing layer before patching.

Known current main after PR #516:
9ed1476afe3462f9c1680aed58cd8daeaeec8fc8

Historical fixes that must be checked as ancestors of main:
- PR #423 merge da96e7d657f341bf2cc752a556cd69f5d07f7e25 — Classify Kovalev Wise orders as transfers
- PR #424 merge 770aedb3a7aacc1eed917da3682e6259fea134b7 — Keep Kovalev Wise order and sync transfer
- PR #431 merge 8e023a97dbae3a0c4542cb4255bbbea419f52215 — Exclude Kovalev Wise transfer from service gaps
- PR #358 — Fix accrued orders and personal order summary semantics
- PR #368 — Fix balance summary source priority
- PR #467/#469/#479/#481 — Остатки, USD-only table, FX missing, reconciliation totals
- PR #514/#516 — top-card canonical finalizer fixes

First commands:
git checkout main
git pull origin main
git merge-base --is-ancestor da96e7d657f341bf2cc752a556cd69f5d07f7e25 main && echo PR423-present
git merge-base --is-ancestor 770aedb3a7aacc1eed917da3682e6259fea134b7 main && echo PR424-present
git merge-base --is-ancestor 8e023a97dbae3a0c4542cb4255bbbea419f52215 main && echo PR431-present
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)

If ancestor checks pass, do NOT cherry-pick/revert old commits. Root cause is parallel UI/detail paths.

Current live symptoms after deploying PR #516:
Top cards are correct:
- paid 2536,7627
- payable 84,8773
- my orders 647,5000
- remainders non-zero

But internal detail blocks are wrong:
1. Переводы / Всего выплат still counts Sergey Kovalev / Nemisha / not-mine rows:
   - 2026-05-24, 597.4 USD, wise boleslav usd
   - 2026-05-29, 103 USD, wise boleslav usd
2. Balance detail shows Мои заказы: 0,0000 while top card shows 647,5000.
3. Остатки table shows all fx_missing and ВСЕГО USD 0 while top remainders are non-zero.

Expected failing layers:
A. payout detail UI aggregation, likely payout-summary-metrics-fix.js / finance.js
B. balance-summary-popup.js internal metrics
C. period-balance-reconciliation-ui.js / remainders-summary-popup.js visible source priority

Use the stop-signal checklist in docs/ledger-ui-recovery-program-2026-06-01.md before declaring done.

Files to inspect:
- payout-summary-metrics-fix.js
- finance.js
- balance-summary-popup.js
- period-balance-reconciliation-ui.js
- remainders-summary-popup.js
- server/period-balance-reconciliation-engine.js

Patch requirements:
1. Exclude Kovalev/Nemisha/not-mine Wise boleslavn transfer rows from Всего выплат / payout total. Rows may remain visible, but must not count as payout total.
2. Balance popup must reuse canonical May acceptance values for ranges 2026-05-01..2026-05-31 and 2026-05-01..2026-06-01.
3. Остатки visible table must not show authoritative ВСЕГО USD 0 when rows are all fx_missing and canonical/confirmed total is non-zero.

Constraints:
- Max 3 key production files unless proven necessary.
- Add regression tests.
- Do not change provider/import transport.
- Do not change ledger save.
- Do not change amount_net/gross/net/fee/source semantics.
- Do not change secrets/env.
- Do not rewrite architecture.
- Do not delete Google Sheet rows.

Tests:
node --test tests/payout-summary-metrics-fix.test.cjs
node --test tests/balance-summary-popup.test.cjs
node --test tests/period-balance-reconciliation-ui.test.cjs
node --test tests/remainders-summary-popup.test.cjs
node --test tests/*.test.*
bash scripts/release-guard.sh
npm run build

Deploy:
npx vercel@latest --prod --yes
npm run verify:production -- <new-main-sha>

Output required:
- proof whether commits were lost or not
- root cause per issue
- stop-signal checklist results
- changed files/functions
- tests/checks
- deploy URL
- live SHA before/after
- before/after UI values
- remaining risks
```

---

## 10. Current operational rule

Do not say “we rolled back” unless `/api/status` or Git ancestry proves it.

Preferred wording until disproven:

```text
Commits are present in main. The regression is caused by internal UI/detail paths bypassing canonical fixes.
```
