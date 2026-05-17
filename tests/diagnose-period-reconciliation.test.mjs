import test from "node:test";
import assert from "node:assert/strict";

import { buildPeriodReconciliationDiagnosis } from "../scripts/diagnose-period-reconciliation.mjs";

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
