import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRepairPlanToValues,
  buildMissingLedgerAmountNetRepairPlan,
} from "../scripts/repair-missing-ledger-amount-net.mjs";
import { buildPeriodBalanceReconciliation } from "../server/period-balance-reconciliation-engine.js";

const HEADER = [
  "date",
  "operation",
  "from_channel",
  "to_channel",
  "amount",
  "currency",
  "amount_usd",
  "amount_gross",
  "amount_fee",
  "amount_net",
  "category",
  "subcategory",
  "direction",
  "comment",
  "source",
  "raw_source_id",
];

test("missing Ledger amount_net row is detected and safely repaired for simple manual source", () => {
  const values = [
    HEADER,
    ["2026-05-10", "expense", "cash usd", "", "42", "USD", "-42", "42", "", "", "business", "", "out", "manual receipt", "manual", "manual-1"],
    ["2026-05-11", "income", "", "cash usd", "12", "USD", "12", "12", "", "12", "service", "", "in", "already ok", "manual", "manual-2"],
  ];

  const plan = buildMissingLedgerAmountNetRepairPlan(values);
  const repaired = applyRepairPlanToValues(values, plan);

  assert.equal(plan.ok, true);
  assert.equal(plan.summary.detected_rows, 1);
  assert.equal(plan.changes[0].rowNumber, 2);
  assert.equal(plan.changes[0].raw_source_id, "manual-1");
  assert.equal(plan.changes[0].old_amount_net, "");
  assert.equal(plan.changes[0].new_amount_net, "42");
  assert.equal(repaired[1][HEADER.indexOf("amount_net")], "42");
  assert.equal(repaired[2][HEADER.indexOf("amount_net")], "12");
});

test("PayPal missing fee returns structured warning and does not set false net from gross", () => {
  const values = [
    HEADER,
    ["2026-05-11", "income", "", "пейпал евр", "36", "EUR", "", "36", "", "", "service", "", "in", "fee_unavailable_personal_account", "paypal", "5U351082V9506951V"],
  ];

  const plan = buildMissingLedgerAmountNetRepairPlan(values);
  const repaired = applyRepairPlanToValues(values, plan);
  const confirmedPlan = buildMissingLedgerAmountNetRepairPlan(values, {
    confirmations: [{ raw_source_id: "5U351082V9506951V", amount_net: "35.12" }],
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.summary.detected_rows, 1);
  assert.equal(plan.summary.change_rows, 0);
  assert.equal(plan.skipped[0].status, "needs_verification");
  assert.equal(plan.skipped[0].confirmation_required, true);
  assert.match(plan.skipped[0].warning, /Gross was not used as net/);
  assert.equal(repaired[1][HEADER.indexOf("amount_net")] || "", "");
  assert.equal(confirmedPlan.summary.change_rows, 1);
  assert.equal(confirmedPlan.changes[0].new_amount_net, "35.12");
});

test("valid source=unknown row with amount_net is still included in period balance", () => {
  const result = buildPeriodBalanceReconciliation({
    operations: [
      {
        date: "2026-05-11",
        ledgerV2: {
          date: "2026-05-11",
          operation: "income",
          from_channel: "",
          to_channel: "cash usd",
          amount: "50",
          amount_net: "50",
          balance_amount: 50,
          currency: "USD",
          source: "unknown",
        },
      },
    ],
    balanceRows: [
      { date: "2026-04-30", channel: "cash usd", currency: "USD", amount: 0 },
      { date: "2026-05-20", channel: "cash usd", currency: "USD", amount: 50 },
    ],
    period: { from: "2026-05-01", to: "2026-05-20" },
    plannedSourceStatus: "available",
  });

  const row = result.by_channel_currency.find((entry) => entry.channel === "cash usd" && entry.currency === "USD");
  assert.equal(row.real_inflow, 50);
  assert.equal(row.real_delta, 50);
  assert.equal(row.missing_amount_net_rows, 0);
  assert.equal(row.status, "ok");
  assert.equal(result.summary.missing_amount_net_rows, 0);
});
