# Ezohata Ledger UI Recovery Program — 2026-06-01

## 0. Purpose

This document is the working correction program for the current Ezohata Ledger regression cluster.

Use it as the source of truth before creating more patches. Do **not** re-audit from scratch unless live evidence contradicts this document.

Project:

- Repo: `andylitvinov-design/finance`
- Live: `https://ezohata-incoming-ledger.vercel.app`
- Known main after PR #516: `9ed1476afe3462f9c1680aed58cd8daeaeec8fc8`
- Production deploy must always be verified with `/api/status`.

Core instruction:

> First prove the failing layer before patching.

Operational rule:

```text
Do not say “rollback” unless /api/status, Git ancestry, or Vercel deployment source proves it.
Preferred wording until disproven:
Commits are present in main. The regression is caused by internal UI/detail paths bypassing canonical fixes.
```

---

## 1. Executive diagnosis

The current issue is a **split-brain UI state**:

```text
Top cards -> mostly corrected by PR #514/#516
Internal detail blocks -> still using old/raw/parallel calculation paths
```

The user-visible screenshots after PR #516 show that the **top dashboard cards** can be correct while internal detail blocks still display old values.

This means the current recovery is not a blind rollback and not a cherry-pick of old commits. The correction program must reconnect internal detail blocks to the same canonical rules that the top cards already use.

---

## 2. Program overview: correction phases

Work through these phases in order. Do not skip a phase.

| Phase | Name | Goal | Exit criterion |
|---:|---|---|---|
| 0 | Freeze and baseline | Prevent random fixes and capture source of truth | live SHA, main SHA, screenshots/API samples recorded |
| 1 | Prove deploy/source | Decide if this is deploy mismatch or runtime bug | `/api/status` matches latest main or deploy is fixed first |
| 2 | Prove commit ancestry | Check whether “lost commits” are actually missing | historical PR commits are ancestors of `main` |
| 3 | Map failing layer | Split top-card, payout detail, balance popup, remainders table | exact failing layer per symptom documented |
| 4 | Patch only failing layers | Make minimal UI/detail fixes | max 3 key production files unless justified |
| 5 | Regression tests | Protect the exact symptoms | targeted tests + full test suite pass |
| 6 | Deploy | Put new main on production | live `/api/status` equals new main SHA |
| 7 | Acceptance verification | Check user-visible tasks | all success indicators pass, no stop signals remain |

---

## 3. Phase 0 — Freeze and baseline

### 3.1 Required baseline commands

```bash
git checkout main
git pull origin main
git rev-parse HEAD
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)
```

Record:

```text
local main SHA
live commitSha
live deploymentUrl
live deployTime
appVersion/appBuildVersion
commitRef
liveCommitMatchesBuildCommit
```

### 3.2 Required browser baseline

Check both ranges:

```text
2026-05-01..2026-05-31
2026-05-01..2026-06-01
```

Capture exact values for:

```text
Top cards:
- Итоговая сумма заказов
- Баланс
- Сумма оплачена
- Оплатить
- Мои услуги
- Мои заказы
- Остатки

Internal blocks:
- Переводы / Всего выплат
- Balance detail / Мои заказы
- Остатки visible table / ВСЕГО USD / fx_missing
```

### 3.3 Baseline expected current top-card values

For the May acceptance case, the expected top-card contract is:

```text
Итоговая сумма заказов = 2820,2000
Сумма оплачена = 2536,7627
Оплатить = 84,8773
Мои заказы = 647,5000
Мои услуги = 204,7059
Остатки != 0
```

---

## 4. Phase 1 — Prove deploy/source-of-truth first

Before any finance debugging, prove whether production serves latest `main`.

### 4.1 Required checks

```bash
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)
npm run verify:production -- <expected-main-sha>
```

### 4.2 Stop signals: deploy/source

Stop all finance debugging and fix deploy first if any is true:

- `/api/status` `commitSha` is not the expected latest `main` SHA.
- `/api/status` is not JSON.
- `/api/status` has `ok != true` or `status != ok`.
- `/api/status` has `liveCommitMatchesBuildCommit != true`.
- `commitRef` is not `main` in production.
- `npm run verify:production -- <expected-sha>` returns `deploy_pending`.
- Vercel Git Integration is disconnected and fallback deploy is not configured.
- fallback workflow fails at credentials gate.
- required deploy secrets are missing:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`

### 4.3 Deploy recovery command

If production is stale but local main is correct:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/finance
git checkout main
git pull origin main
git rev-parse HEAD
npx vercel@latest --prod --yes
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)
```

---

## 5. Phase 2 — Prove commit ancestry

Before claiming commits disappeared, run ancestry checks.

```bash
git checkout main
git pull origin main

git merge-base --is-ancestor da96e7d657f341bf2cc752a556cd69f5d07f7e25 main && echo 'PR423 present'
git merge-base --is-ancestor 770aedb3a7aacc1eed917da3682e6259fea134b7 main && echo 'PR424 present'
git merge-base --is-ancestor 8e023a97dbae3a0c4542cb4255bbbea419f52215 main && echo 'PR431 present'
git merge-base --is-ancestor 9ed1476afe3462f9c1680aed58cd8daeaeec8fc8 main && echo 'PR516 present'
```

Expected: all are present.

If present:

```text
Do not cherry-pick old commits.
Do not revert main.
Do not restore stale branches.
Root cause is likely a parallel UI/detail path bypassing old fixes.
```

If any is missing:

```text
Stop. Investigate branch/source mismatch before patching.
```

---

## 6. Historical fixes that must be respected

### 6.1 Kovalev / Wise / bolieslavn history

#### PR #423 — `Classify Kovalev Wise orders as transfers`

- Merge commit: `da96e7d657f341bf2cc752a556cd69f5d07f7e25`
- Purpose:
  - Skip Kovalev Wise bolieslavn source rows before generic movement/payout classification.
  - Add repair for order `18179` into `Переводы` / `wise boleslav usd`.
- Scope:
  - normalization/classification
  - movement/payout source rows
- Current limitation:
  - Not enough for current bug because current bug is in **detail payout total aggregation**.

#### PR #424 — `Keep Kovalev Wise order and sync transfer`

- Merge commit: `770aedb3a7aacc1eed917da3682e6259fea134b7`
- Purpose:
  - Keep Kovalev Wise source order visible where needed.
  - Derive stable source-order transfer row on `wise boleslav usd`.
  - Add explicit `Перевод Wise` category bridge.
- Important:
  - Current fix must not delete the row.
  - Current fix must prevent it from counting as a payout total when marked `не мне` / transfer-not-payout.

#### PR #431 — `Exclude Kovalev Wise transfer from service gaps`

- Merge commit: `8e023a97dbae3a0c4542cb4255bbbea419f52215`
- Purpose:
  - Exclude Kovalev Wise `@bolieslavn` rows from service payment summary and service-gap diagnostics.
  - Specifically row `18179`, `Сергей Ковалев`, `Wise @bolieslavn`, clientPaid `597.4`.
- Current limitation:
  - Not enough for current bug because current bug is not service gap diagnostics; it is `Всего выплат` in payout/transfer detail UI.

### 6.2 Personal orders / balance popup history

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
- Current limitation:
  - These fixed the top card, but not every internal popup/detail block.

### 6.3 Остатки / FX / reconciliation history

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

## 7. Phase 3 — Failing layer map

Use this map before patching:

```text
UI top cards -> fixed by PR #514/#516
Payout detail block -> still failing
Balance popup summary -> still failing
Remainders / period reconciliation visible table -> still failing
API/provider/import/ledger semantics -> not currently proven failing
```

### 7.1 Not current root cause unless newly proven

- Provider/import transport
- Ledger save
- `amount_net` formula
- gross/net/fee/source semantics
- PayPal/Wise/Bank import layer
- Google secrets/env
- main branch rollback
- lost Git commits

### 7.2 Current likely failing layers

| Problem | Failing layer | Confidence | Why |
|---|---|---:|---|
| Kovalev `597.4 + 103` visible in `Всего выплат` | payout detail UI aggregation | high | Top-card paid is correct; detail payout sums raw transfer rows |
| `Мои заказы: 0` in balance details | `balance-summary-popup.js` internal metrics | high | Top-card already shows `647.5` |
| `fx_missing` / `ВСЕГО USD 0` in Остатки | `period-balance-reconciliation-ui.js` / `remainders-summary-popup.js` source priority | medium-high | Top remainders are non-zero while table renders diagnostic/fallback rows |

---

## 8. Phase 4 — Correction tasks

### Task A — Kovalev rows in `Всего выплат`

#### Prove first

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

#### Stop signals for Task A

- `Всего выплат` includes `597,4000 + 103,0000` from Kovalev/Nemisha/not-mine rows.
- internal payout total returns to `3234,4949` or `-3234,4949` because of these rows.
- `Сергей Ковалев / Немиша / не мне` is treated as paid order/service payment instead of transfer-not-payout.

#### Do not do

- Do not delete rows.
- Do not mutate Google Sheets.
- Do not change Ledger semantics.
- Do not change provider/import logic.

---

### Task B — `Мои заказы: 0` in balance detail

#### Prove first

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

#### Stop signals for Task B

- Balance popup/detail says `Мои заказы: 0,0000` while top card says `647,5000`.
- popup uses raw `totalPaid = 3234,4949` while top card uses `2536,7627`.
- popup double-counts movement + orders.
- popup applies a second personal-order discount.
- popup ignores May acceptance ranges.

---

### Task C — Остатки `fx_missing` / primary `ВСЕГО USD 0`

#### Prove first

Check live/API:

```bash
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/period-balance-reconciliation?from=2026-05-01&to=2026-06-01' > /tmp/pbr.json
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/balance-snapshots?from=2026-05-28&to=2026-05-31&includeRows=true&ts='$(date +%s) > /tmp/balance-snapshots.json
```

Inspect:

```text
period_balance_reconciliation.by_channel_currency
period_balance_reconciliation.total_usd_row
period_balance_reconciliation.reconciliation_report_summary.total_usd_row
confirmed_end_usd
status
fx diagnostics
selected rows
raw rows
```

#### Required behavior

If visible rows are all `fx_missing` and primary total USD is `0`, but canonical/confirmed/manual total is non-zero, the UI must not present:

```text
ВСЕГО USD 0,0000
```

as authoritative.

Allowed fixes:

- Show canonical/confirmed total row as primary.
- Move all-`fx_missing` rows to diagnostics.
- Render a warning that USD table is incomplete and show the non-zero confirmed/canonical total separately.

#### Stop signals for Task C

- primary table shows all rows as `fx_missing`.
- primary `ВСЕГО USD = 0,0000` while top remainders are non-zero.
- `fx_missing` diagnostic rows are shown as the main/authoritative table.
- selected/confirmed/manual rows are hidden while raw/diagnostic rows are visible.
- stale markers appear in selected rows:
  - `7425`
  - `1689`
  - `7351`
  - `legacy_combined_binance_spot_funding`

#### Do not do

- Do not synthesize fake FX values.
- Do not alter balance math.
- Do not exclude valid `amount_net` rows from balance because `source=unknown`.

---

## 9. Files to inspect

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

Patch constraints:

- Prefer max 3 key production files unless proven necessary.
- Add regression tests.
- Do not change provider/import transport.
- Do not change ledger save.
- Do not change `amount_net`, gross/net/fee/source semantics.
- Do not change secrets/env.
- Do not rewrite architecture.
- Do not delete Google Sheet rows.

---

## 10. Phase 5 — Regression tests

### Required targeted tests

```bash
node --test tests/payout-summary-metrics-fix.test.cjs
node --test tests/balance-summary-popup.test.cjs
node --test tests/period-balance-reconciliation-ui.test.cjs
node --test tests/remainders-summary-popup.test.cjs
```

### Required full checks

```bash
node --test tests/*.test.*
bash scripts/release-guard.sh
npm run build
```

### Required regression cases

1. Kovalev payout detail:

```text
Rows:
2026-05-24 Сергей Ковалев / Немиша / не мне 597.4 USD wise boleslav usd
2026-05-29 Сергей Ковалев / Немиша / не мне 103 USD wise boleslav usd
Expected:
- rows may remain displayable
- excluded from Всего выплат / payout total
```

2. Balance popup:

```text
Range: 2026-05-01..2026-06-01
ordersTotal: 2820.2
bad incoming personalOrdersAfterDiscount: 0
Expected:
Мои заказы: 647,5000
paid: 2536,7627
payable: 84,8773
```

3. Остатки / reconciliation:

```text
Visible rows all fx_missing
primary total_usd_row = 0
canonical/confirmed total non-zero
Expected:
- visible primary result must not say ВСЕГО USD 0 as authoritative
- diagnostics may still show fx_missing rows
```

4. Top-card safety:

```text
paid = 2536,7627
payable = 84,8773
personal orders = 647,5000
remainders != 0
```

---

## 11. Phase 6 — Deploy and production verification

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

---

## 12. Phase 7 — Final acceptance criteria

The update is successful only if all criteria pass on live production after deploy.

### 12.1 Ranges to verify

```text
2026-05-01..2026-05-31
2026-05-01..2026-06-01
```

### 12.2 Top cards must show

```text
Итоговая сумма заказов = 2820,2000
Сумма оплачена = 2536,7627
Оплатить = 84,8773
Мои заказы = 647,5000
Мои услуги = 204,7059
Остатки != 0
```

### 12.3 Detail blocks must show

```text
Всего выплат does not include Kovalev 597.4 + 103
Balance detail does not show Мои заказы: 0,0000
Остатки does not show all-fx_missing / ВСЕГО USD 0 as primary authoritative result
```

### 12.4 Absolute stop signals

The update is not ready if any of these remain:

```text
Сумма оплачена = 3234,4949
Оплатить = -1260,3549
Мои заказы = 0,0000
Остатки = 0,0000
Всего выплат includes Kovalev 597.4 + 103
Primary Остатки table shows all fx_missing / ВСЕГО USD 0
live SHA != latest main SHA
verify:production = deploy_pending
```

---

## 13. Codex execution prompt

```text
Repo: andylitvinov-design/finance
Live URL: https://ezohata-incoming-ledger.vercel.app

Mode: FORENSIC RECOVERY. Do not re-audit blindly.
Use docs/ledger-ui-recovery-program-2026-06-01.md as the source of truth.

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

Before declaring done, check every stop signal and acceptance criterion in docs/ledger-ui-recovery-program-2026-06-01.md.

Output required:
- proof whether commits were lost or not
- root cause per issue
- stop-signal checklist result
- changed files/functions
- tests/checks
- deploy URL
- live SHA before/after
- before/after UI values
- remaining risks
```
