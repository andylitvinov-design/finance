import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBalanceRepairPlan,
  buildBalanceRepairPlanText,
} from "../scripts/balance-repair-plan.mjs";

const snapshot = {
  period: { from: "2026-05-11", to: "2026-05-17" },
  balance_coverage: {
    weekly_summary: {
      status: "failed",
      accounts_checked: 11,
      fully_reconciled: 0,
      mismatch: 2,
      missing_provider_balance: 9,
      missing_opening_balance: 0,
      missing_amount_net_rows: 1,
      excluded_missing_amount_net_rows: 1,
      copyable_ostatki_rows: "",
    },
    actionable_accounts: [
      {
        date: "2026-05-12",
        channel: "трансервайз дол",
        currency: "USD",
        status: "mismatch",
        opening_balance: 2217.41,
        inflow: 0,
        outflow: 52.79,
        difference: -138.59,
        computed_closing_balance: 2164.62,
        provider_reported_balance: 2026.03,
        diagnosis: "Расхождение: provider_reported_balance отличается от computed_closing_balance на -138.59.",
        fix_action: "Проверить Ledger movement, amount_net и строку Остатки: фактический остаток не равен расчетному.",
        formula: "opening_balance 2217.41 + inflow 0 - outflow 52.79 = computed_closing_balance 2164.62 ; provider_reported_balance 2026.03 ; difference -138.59",
      },
    ],
  },
  balance_fixes: {
    missing_amount_net_rows: [
      {
        date: "2026-05-11",
        operation: "expense",
        channel: "пейпал евр",
        currency: "EUR",
        amount: 216,
        recommended_amount_net: null,
        raw_source_id: "PAYPAL-1",
        reason: "PayPal fee/net is unavailable, so amount_net is intentionally empty and the row is excluded from balance reconciliation.",
        action: "verify PayPal fee/net; do not auto-fill",
      },
    ],
    missing_opening_balance_rows: [
      {
        required_date: "2026-05-10",
        movement_date: "2026-05-11",
        channel: "wise eur",
        currency: "EUR",
        amount: null,
        diagnosis: "Нет начального остатка.",
        action: "Add a factual opening balance row to Остатки before the movement date; amount must come from provider/manual statement.",
      },
    ],
    missing_ostatki_rows: [
      {
        date: "2026-05-11",
        channel: "монобанк грн",
        currency: "UAH",
        expected_closing_hint: 14033,
        action: "Confirm provider closing balance, then add factual balance to Остатки; do not copy expected_closing_hint as fact.",
      },
    ],
  },
};

test("balance repair plan orders blocking fixes before missing Остатки rows", () => {
  const plan = buildBalanceRepairPlan(snapshot);
  assert.equal(plan.status, "failed");
  assert.deepEqual(plan.actions.map((row) => row.problem), [
    "missing_amount_net",
    "balance_mismatch",
    "missing_opening_balance",
    "missing_provider_balance",
  ]);
  assert.equal(plan.actions[0].safe_to_apply, false);
  assert.equal(plan.actions[0].operation, "expense");
  assert.equal(plan.actions[1].safe_to_apply, false);
  assert.equal(plan.actions[1].opening_balance, 2217.41);
  assert.equal(plan.actions[1].inflow, 0);
  assert.equal(plan.actions[1].outflow, 52.79);
  assert.equal(plan.actions[1].provider_reported_balance, 2026.03);
  assert.equal(plan.actions[3].verification_required, true);
  assert.equal(plan.paypal_manual_confirmations.length, 1);
  assert.equal(plan.paypal_manual_confirmations[0].confirmed_amount_net, "");
  assert.equal(plan.paypal_manual_confirmations[0].safe_to_apply, false);
  assert.equal(plan.balance_template_rows.length, 2);
  assert.match(plan.balance_template_tsv, /confirmed_balance/);
  assert.match(plan.tsv, /priority\tseverity\tproblem\tdate\tmovement_date\toperation/);
  assert.match(plan.tsv, /opening_balance\tinflow\toutflow\tcomputed_closing_balance\texpected_closing_hint\tprovider_reported_balance/);
  assert.equal(plan.copyable_ostatki_rows, "");
});

test("balance repair plan text warns against writing computed balances as facts", () => {
  const plan = buildBalanceRepairPlan(snapshot);
  const text = buildBalanceRepairPlanText(plan);
  assert.match(text, /Balance repair plan/);
  assert.match(text, /P1 \| missing_amount_net/);
  assert.match(text, /P2 \| balance_mismatch/);
  assert.match(text, /PayPal manual confirmations/);
  assert.match(text, /Blank balance templates/);
  assert.match(text, /Do not write computed Остатки rows as factual balances/);
  assert.match(text, /gross amount must not be copied into amount_net/);
});
