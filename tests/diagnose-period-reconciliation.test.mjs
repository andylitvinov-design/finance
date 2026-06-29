import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChannelMovementDrilldown,
  buildPeriodReconciliationDiagnosis,
  parseCsv,
} from "../scripts/diagnose-period-reconciliation.mjs";

test("period diagnosis reports Wise verification and remaining blockers without safe auto-apply", () => {
  const diagnosis = buildPeriodReconciliationDiagnosis({
    reconciliationPayload: {
      ok: true,
      generated_at: "2026-05-17T10:00:00.000Z",
      period_balance_reconciliation: {
        period: { from: "2026-05-01", to: "2026-05-17" },
        summary: {
          status: "failed",
          positions_checked: 24,
          blocked: 23,
          status_counts: {
            mismatch: 1,
            missing_provider_balance: 21,
            missing_opening_balance: 1,
            missing_amount_net: 1,
          },
        },
        by_channel_currency: [
          {
            channel: "трансервайз дол",
            currency: "USD",
            status: "ok",
            opening_balance: 1796.61,
            opening_balance_date: "2026-05-14",
            real_delta: -726.13,
            factual_closing_balance: 1070.48,
            factual_closing_balance_date: "2026-05-17",
            real_difference: 0,
            movement_rows: 5,
          },
          {
            channel: "пейпал евр",
            currency: "EUR",
            status: "missing_amount_net",
            missing_amount_net_rows: 1,
          },
          {
            channel: "Бинанс spot",
            currency: "USDT",
            status: "missing_opening_balance",
            real_delta: 103,
            movement_rows: 1,
          },
          {
            channel: "монобанк грн",
            currency: "UAH",
            status: "missing_provider_balance",
            computed_real_closing_balance: 14033,
          },
        ],
      },
    },
    auditSnapshot: {
      daily_balances: {
        rows: [
          {
            date: "2026-05-08",
            channel: "трансервайз дол",
            currency: "USD",
            status: "mismatch",
            opening_balance: 2391.4,
            net_change: 32.23,
            closing_balance: 2423.63,
            provider_reported_balance: 2391.31,
            difference: -32.32,
          },
        ],
      },
    },
  });

  assert.equal(diagnosis.summary.missing_amount_net, 1);
  assert.equal(diagnosis.summary.missing_opening_balance, 1);
  assert.equal(diagnosis.summary.missing_provider_balance, 21);
  assert.equal(diagnosis.summary.mismatch, 1);
  assert.equal(diagnosis.summary.blocked, 23);
  assert.equal(diagnosis.wise_usd.opening_balance, 1796.61);
  assert.equal(diagnosis.wise_usd.real_delta, -726.13);
  assert.equal(diagnosis.wise_usd.real_difference, 0);
  assert.equal(diagnosis.wise_usd.movement_rows, 5);
  assert.equal(diagnosis.paypal_manual_confirmations[0].safe_to_apply, false);
  assert.equal(diagnosis.balance_template_rows.length, 2);
  assert.equal(diagnosis.balance_template_rows[0].safe_to_apply, false);
  assert.equal(diagnosis.historical_wise_diagnostic.dry_run, true);
  assert.equal(diagnosis.historical_wise_diagnostic.safe_corrections_to_apply.length, 0);
  assert.equal(diagnosis.historical_wise_diagnostic.mismatch_rows[0].safe_to_apply, false);
});

test("channel movement drilldown explains CSV gross outflow versus reconciliation movement", () => {
  const reconciliation = {
    period: { from: "2026-05-01", to: "2026-05-20" },
    by_channel_currency: [
      {
        channel: "трансервайз дол",
        currency: "USD",
        opening_balance: 2639,
        opening_balance_date: "2026-05-01",
        real_inflow: 313.3,
        real_outflow: 2120.56,
        real_delta: -1807.26,
        movement_rows: 3,
        calculated_closing_balance: 831.74,
        factual_closing_balance: 827,
        real_difference: -4.74,
      },
    ],
  };
  const dashboardPayload = {
    data: {
      manual: {
        operations: [
          operationRow({
            date: "2026-05-01",
            operation: "business_expense",
            amount: "65.36",
            amountGross: "65.36",
            amountFee: "0.19",
            amountNet: "65.17",
            balanceAmount: -65.17,
            rawSourceId: "CARD-OPENING",
          }),
          operationRow({
            date: "2026-05-03",
            operation: "exchange_out",
            amount: "415",
            amountGross: "415",
            amountNet: "415",
            balanceAmount: -415,
            rawSourceId: "TRANSFER-2110976928",
            comment: "Sent money to Bolieslav Nemish",
          }),
          operationRow({
            date: "2026-05-05",
            operation: "income",
            fromChannel: "",
            toChannel: "трансервайз дол",
            amount: "206",
            amountGross: "206",
            amountNet: "206",
            balanceAmount: 206,
            sheetRowNumber: 163,
            rawSourceId: "TRANSFER-2116313914",
            comment: "Received money from William Michael Bray with reference",
          }),
          operationRow({
            date: "2026-05-08",
            operation: "income",
            fromChannel: "",
            toChannel: "трансервайз дол",
            amount: "103",
            amountGross: "103",
            amountNet: "103",
            balanceAmount: 103,
            sheetRowNumber: 191,
            rawSourceId: "TRANSFER-ROW-191",
          }),
          operationRow({
            date: "2026-05-11",
            operation: "income",
            fromChannel: "",
            toChannel: "трансервайз дол",
            amount: "4.3",
            amountGross: "4.3",
            amountNet: "4.3",
            balanceAmount: 4.3,
            sheetRowNumber: 197,
            rawSourceId: "TRANSFER-ROW-197",
          }),
          operationRow({
            date: "2026-05-17",
            operation: "business_expense",
            amount: "1705.56",
            amountGross: "1706.45",
            amountFee: "0.89",
            amountNet: "1705.56",
            balanceAmount: -1705.56,
            rawSourceId: "CARD-WINDOW",
          }),
        ],
      },
    },
  };
  const csvRows = parseCsv([
    "date,operation,source,from_channel,to_channel,amount,currency,amount_usd,gross,fee,net,category,comment,raw_source_id,external_id",
    "2026-05-01,business_expense,wise,трансервайз дол,,65.36,USD,65.36,65.36,0.19,65.17,business,Opening date card,CARD-OPENING,CARD-OPENING",
    "2026-05-03,exchange_out,wise,трансервайз дол,,415,USD,-415,415,,415,business,Sent money to Bolieslav Nemish,TRANSFER-2110976928,TRANSFER-2110976928",
    "2026-05-17,business_expense,wise,трансервайз дол,,1706.45,USD,1706.45,1706.45,0.89,1705.56,business,Window card,CARD-WINDOW,CARD-WINDOW",
  ].join("\n"));

  const drilldown = buildChannelMovementDrilldown({
    reconciliation,
    dashboardPayload,
    csvRows,
    channel: "трансервайз дол",
    currency: "USD",
  });

  assert.equal(drilldown.opening.movement_start, "2026-05-02");
  assert.equal(drilldown.summaries.csv_period.outflow_gross, 2186.81);
  assert.equal(drilldown.summaries.csv_period.outflow_net, 2185.73);
  assert.equal(drilldown.summaries.reconciliation_window.income, 313.3);
  assert.equal(drilldown.summaries.opening_date_excluded_from_reconciliation.outflow_net, 65.17);
  assert.equal(drilldown.csv_vs_reconciliation_difference.difference, 379.55);
  assert.deepEqual(drilldown.csv_gross_to_net_movement_explanation, {
    csv_gross_outflow: 2186.81,
    live_real_outflow: 2120.56,
    live_real_inflow: 313.3,
    opening_date_excluded_net_outflow: 65.17,
    gross_vs_net_gap: 1.08,
    displayed_net_movement: 1807.26,
    residual: 0,
  });
  assert.match(
    drilldown.explanation,
    /CSV export total is gross outflow\. Reconciliation movement is net movement: real_outflow - real_inflow, from after the opening snapshot date, using amount_net\./
  );
  assert.deepEqual(drilldown.csv_vs_reconciliation_difference.explained_by, {
    live_income_net: 313.3,
    opening_date_outflow_net_excluded: 65.17,
    csv_gross_vs_net_gap: 1.08,
    explained_difference: 379.55,
    residual: 0,
  });
  assert.deepEqual(drilldown.rows.live_extra_not_in_csv.map((row) => [row.sheet_row, row.signed_amount]), [
    [163, 206],
    [191, 103],
    [197, 4.3],
  ]);
  assert.equal(drilldown.rows.csv_missing_from_live.length, 0);
  assert.equal(drilldown.rows.exchange_out[0].signed_amount, -415);
});

function operationRow(overrides = {}) {
  const row = {
    date: "2026-05-02",
    operation: "business_expense",
    fromChannel: "трансервайз дол",
    toChannel: "",
    amount: "10",
    amountUsd: "10",
    amountGross: "10",
    amountFee: "",
    amountNet: "10",
    currency: "USD",
    balanceAmount: -10,
    source: "wise",
    rawSourceId: "CARD-1",
    comment: "Card transaction",
  };
  return {
    ...row,
    ...overrides,
    ledgerV2: {
      date: overrides.date || row.date,
      operation: overrides.operation || row.operation,
      from_channel: overrides.fromChannel ?? row.fromChannel,
      to_channel: overrides.toChannel ?? row.toChannel,
      currency: overrides.currency || row.currency,
      amount_net: overrides.amountNet ?? row.amountNet,
      balance_amount: overrides.balanceAmount ?? row.balanceAmount,
      external_id: overrides.rawSourceId || row.rawSourceId,
    },
  };
}
