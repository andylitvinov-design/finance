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
      copyable_ostatki_rows: "date\tchannel\tcurrency\tamount\n2026-05-11\tмонобанк грн\tUAH\t14033",
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
        channel: "wise usd",
        currency: "USD",
        amount: 52.79,
        recommended_amount_net: 52.79,
        raw_source_id: "WISE-1",
        reason: "amount_net is empty, so the row is excluded from balance reconciliation.",
        action: "Set amount_net to 52.79",
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
        computed_closing_balance: 14033,
        action: "Add factual closing balance to Остатки",
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
  assert.equal(plan.actions[0].safe_to_apply, true);
  assert.equal(plan.actions[0].operation, "expense");
  assert.equal(plan.actions[1].safe_to_apply, false);
  assert.equal(plan.actions[1].opening_balance, 2217.41);
  assert.equal(plan.actions[1].inflow, 0);
  assert.equal(plan.actions[1].outflow, 52.79);
  assert.equal(plan.actions[1].provider_reported_balance, 2026.03);
  assert.equal(plan.actions[3].verification_required, true);
  assert.match(plan.tsv, /priority\tseverity\tproblem\tdate\tmovement_date\toperation/);
  assert.match(plan.tsv, /opening_balance\tinflow\toutflow\tcomputed_closing_balance\tprovider_reported_balance/);
  assert.match(plan.copyable_ostatki_rows, /монобанк грн/);
});

test("balance repair plan text warns against writing computed balances as facts", () => {
  const plan = buildBalanceRepairPlan(snapshot);
  const text = buildBalanceRepairPlanText(plan);
  assert.match(text, /Balance repair plan/);
  assert.match(text, /P1 \| missing_amount_net/);
  assert.match(text, /P2 \| balance_mismatch/);
  assert.match(text, /Do not write computed Остатки rows as factual balances/);
});
