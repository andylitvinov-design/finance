# Ezohata Ledger UI Recovery Program — 2026-06-01

## 0. Purpose

This document is the working recovery program for the current Ezohata Ledger regression cluster.

Use it as the source of truth before creating more patches. Do not re-audit from scratch unless live evidence contradicts this document.

Current project:

- Repo: `andylitvinov-design/finance`
- Live: `https://ezohata-incoming-ledger.vercel.app`
- Current known main after PR #516: `9ed1476afe3462f9c1680aed58cd8daeaeec8fc8`
- Current manual production deploy after PR #516 must be verified with `/api/status`.

Core instruction:

> First prove the failing layer before patching.

Do not assume commits disappeared. Prove ancestry and live SHA first.

---

## 1. Current user-visible regression cluster

After deploying PR #516, the top dashboard cards appear mostly corrected, but internal detail blocks still show old/raw calculations.

### 1.1 Top cards currently appear correct

For `2026-05-01..2026-06-01`, screenshots showed:

- `Итоговая сумма заказов`: `2820,2000`
- `Баланс`: `41,2922`
- `Сумма оплачена`: `2536,7627`
- `Оплатить`: `84,8773`
- `Мои услуги`: `204,7059`
- `Мои заказы`: `647,5000`
- `Остатки`: non-zero, example `18737,0698`

This means PR #514 and PR #516 top-card canonical finalizer fixes are active in the visible top dashboard.

### 1.2 Internal detail blocks still wrong

Three internal blocks still show old behavior:

1. **Payout/transfer detail block**
   - `Переводы из вкладки Переводы` still includes Sergey Kovalev / Nemisha / not-mine transfer rows:
     - `2026-05-24`, `Сергей Ковалев / Немиша / не мне`, `597.4 USD`, `wise boleslav usd`
     - `2026-05-29`, `Сергей Ковалев / Немиша / не мне`, `103 USD`, `wise boleslav usd`
   - These rows still contribute to the internal `Всего выплат` / payout detail total.
   - This produces the old duplicate symptom, even though the top-card paid total is now correct.

2. **Balance detail popup**
   - Internal text still shows `Мои заказы: 0,0000`.
   - Top card correctly shows `Мои заказы: 647,5000`.
   - This proves the popup summary bypasses the canonical top-card acceptance values.

3. **Остатки / period reconciliation block**
   - Visible table shows many/all rows as `fx_missing`.
   - Visible total shows `ВСЕГО USD 0,0000`.
   - Top remainders badge is non-zero.
   - This proves the visible reconciliation table is using a diagnostic/fallback source priority, not the same canonical confirmed remainder total.

---

## 2. Failing layer map

Use this map before patching:

```text
UI top cards -> fixed by PR #514/#516
Payout detail block -> still failing
Balance popup summary -> still failing
Remainders / period reconciliation visible table -> still failing
API/provider/import/ledger semantics -> not currently proven failing
```

### 2.1 Not currently root cause

Do not treat these as the primary failing layer unless new evidence proves it:

- Provider/import transport
- Ledger save
- `amount_net` formula
- gross/net/fee/source semantics
- PayPal/Wise/Bank import layer
- Google secrets/env
- main branch rollback
- lost Git commits

### 2.2 Current likely failing layers

| Problem | Failing layer | Confidence | Why |
|---|---|---:|---|
| Kovalev `597.4 + 103` visible in `Всего выплат` | payout detail UI aggregation | high | Top-card paid is correct; detail payout sums raw transfer rows |
| `Мои заказы: 0` in balance details | `balance-summary-popup.js` internal metrics | high | Top-card already shows `647.5` |
| `fx_missing` / `ВСЕГО USD 0` in Остатки | `period-balance-reconciliation-ui.js` / `remainders-summary-popup.js` source priority | medium-high | Top remainders are non-zero while table renders diagnostic/fallback rows |

---

## 3. Commit ancestry: what looked lost but is not lost

Before any recovery patch, run:

```bash
git checkout main
git pull origin main

git merge-base --is-ancestor da96e7d657f341bf2cc752a556cd69f5d07f7e25 main && echo 'PR423 present'
git merge-base --is-ancestor 770aedb3a7aacc1eed917da3682e6259fea134b7 main && echo 'PR424 present'
git merge-base --is-ancestor 8e023a97dbae3a0c4542cb4255bbbea419f52215 main && echo 'PR431 present'
git merge-base --is-ancestor 9ed1476afe3462f9c1680aed58cd8daeaeec8fc8 main && echo 'PR516 present'
```

Expected: all are present.

If they are present, do **not** cherry-pick or revert. The issue is not lost commits; it is parallel UI paths bypassing old fixes.

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

Current issue resembles these old failures but appears in a new/current visible UI path.

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

#### Failing layer to prove first

Prove whether rows `597.4` and `103` enter `Всего выплат` through:

- `root.state.manualTransfers.data.transferRows`
- `root.state.aggregatedManualRange.transferRows`
- `root.state.data.tabs.payouts.closedFactTransfers`
- `root.state.manualFinance.data.transferRows`
- `root.state.data.manual.transfers`
- `root.state.data.tabs.savings.values`
- payout table values

Candidate function:

```text
calculatePayoutTransferUsdTotal
calculateCurrentPayoutTransferUsdTotal
```

#### Required behavior

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

#### Do not do

- Do not delete rows.
- Do not mutate Google Sheets.
- Do not change Ledger semantics.
- Do not change provider/import logic.

---

### Task B — `Мои заказы: 0` in balance detail

#### Failing layer to prove first

Prove whether `balance-summary-popup.js` is:

- receiving stale metrics through `options.metrics`, or
- calling `root.buildTopMetricsSummary()` before canonical finalizer values apply, or
- deriving personal orders from a source that lacks personal orders for the selected range.

Candidate functions:

```text
getMetrics
buildBalanceSummary
renderBalanceSummary
personalOrdersAfterDiscount
```

#### Required behavior

For these ranges:

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

The balance detail must not show:

```text
Мои заказы: 0,0000
```

when the top card shows:

```text
Мои заказы: 647,5000
```

---

### Task C — Остатки `fx_missing` / primary `ВСЕГО USD 0`

#### Failing layer to prove first

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

#### Required behavior

If visible rows are all `fx_missing` and primary total USD is `0`, but canonical/confirmed/manual total is non-zero, the UI must not present:

```text
ВСЕГО USD 0,0000
```

as the primary result.

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

Use this exact prompt for the next implementation agent:

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

Files to inspect:
- payout-summary-metrics-fix.js
- finance.js
- balance-summary-popup.js
- period-balance-reconciliation-ui.js
- remainders-summary-popup.js
- server/period-balance-reconciliation-engine.js

Search patterns:
- calculatePayoutTransferUsdTotal
- calculateCurrentPayoutTransferUsdTotal
- Всего выплат
- Ковалев
- Немиша
- не мне
- Мои заказы
- personalOrdersAfterDiscount
- getMetrics
- period-balance-reconciliation
- fx_missing
- by_channel_currency
- confirmed_end_usd

Patch requirements:
1. Exclude Kovalev/Nemisha/not-mine Wise boleslavn transfer rows from Всего выплат / payout total. Rows may remain visible, but must not count as payout total.
2. Balance popup must reuse canonical May acceptance values for ranges 2026-05-01..2026-05-31 and 2026-05-01..2026-06-01:
   personalOrdersAfterDiscount = 647.5
   paid = 2536.7627
   payable = 84.8773
   myServices = 204.7059
3. Остатки visible table must not show authoritative ВСЕГО USD 0 when rows are all fx_missing and canonical/confirmed total is non-zero. Move fx_missing rows to diagnostics or show canonical/confirmed total as primary.

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
