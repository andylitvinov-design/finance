import test from "node:test";
import assert from "node:assert/strict";

import {
  APPLY_CONFIRMATION_TEXT,
  buildRemainingUsdDiffReport,
  parseArgs,
  validateApplyGuard,
} from "../scripts/reconcile-remaining-usd-diff.mjs";

const reconciliationPayload = {
  ok: true,
  generated_at: "2026-05-27T09:25:57.475Z",
  period_balance_reconciliation: {
    period: { from: "2026-05-01", to: "2026-05-27" },
    summary: {
      status: "failed",
      status_counts: { ok: 25, mismatch: 7, needs_verification: 1 },
      missing_amount_net_rows: 0,
      balance_source_counts: { manual_fact: 24, provider_auto: 10, missing: 1 },
    },
    total_usd_row: {
      label: "ВСЕГО USD",
      channel: "ВСЕГО USD",
      currency: "USD",
      opening_usd: 30542.5075,
      movement_usd: -2935.8651,
      planned_end_usd: 28654.8167,
      confirmed_end_usd: 17193.6127,
      diff_usd: -2147.6884,
      excluded_fx_missing_rows: 2,
      status: "fx_missing",
    },
    by_channel_currency: [
      {
        channel: "Бинанс spot",
        currency: "USDT",
        opening_native: 1087.6223,
        movement_native: 618.86,
        planned_end_native: 1706.4823,
        confirmed_end_native: 1159.0372,
        diff_native: -547.4451,
        opening_usd: 1087.6223,
        movement_usd: -245.7789,
        planned_end_usd: 841.8434,
        confirmed_end_usd: 1159.0372,
        diff_usd: 317.1938,
        status: "mismatch",
        balance_source: "provider_auto",
        opening_balance_source: "exact",
        closing_balance_source: "exact",
        movement_rows: 23,
      },
      {
        channel: "binance save",
        currency: "USDT",
        opening_native: 8519,
        movement_native: 0,
        planned_end_native: 8519,
        confirmed_end_native: 5411.6278,
        diff_native: -3107.3722,
        opening_usd: 8519,
        movement_usd: 0,
        planned_end_usd: 8519,
        confirmed_end_usd: 5411.6278,
        diff_usd: -3107.3722,
        status: "needs_verification",
        balance_source: "provider_auto",
        opening_balance_source: "exact",
        closing_balance_source: "exact",
        movement_rows: 0,
      },
      {
        channel: "пейпал дол",
        currency: "USD",
        opening_native: 202.97,
        movement_native: -833.39,
        planned_end_native: -630.42,
        confirmed_end_native: 12.07,
        diff_native: 642.49,
        opening_usd: 202.97,
        movement_usd: -833.39,
        planned_end_usd: -630.42,
        confirmed_end_usd: 12.07,
        diff_usd: 642.49,
        status: "mismatch",
        balance_source: "manual_fact",
        opening_balance_source: "owner_evidence",
        closing_balance_source: "owner_evidence",
        movement_rows: 4,
      },
      {
        channel: "Яндекс руб",
        currency: "RUB",
        opening_native: 142858.88,
        movement_native: -71386.33,
        planned_end_native: 71472.55,
        confirmed_end_native: 104862.88,
        diff_native: 33390.33,
        opening_usd: null,
        movement_usd: -844.2463,
        planned_end_usd: null,
        confirmed_end_usd: null,
        diff_usd: null,
        status: "mismatch",
        balance_source: "provider_auto",
        fx_warnings: [
          "opening_usd_fx_missing",
          "planned_end_usd_fx_missing",
          "confirmed_end_usd_fx_missing",
          "diff_usd_fx_missing",
        ],
      },
      {
        channel: "монобанк грн",
        currency: "UAH",
        opening_native: 26670.14,
        movement_native: -13637,
        planned_end_native: 13033.14,
        confirmed_end_native: 13033.14,
        diff_native: 0,
        opening_usd: 603.0032,
        movement_usd: -310.9258,
        planned_end_usd: 292.0774,
        confirmed_end_usd: null,
        diff_usd: null,
        status: "ok",
        balance_source: "manual_fact",
        fx_warnings: ["confirmed_end_usd_fx_missing", "diff_usd_fx_missing"],
      },
    ],
  },
  warnings: [
    "fx_missing: 2 row(s) have missing frozen USD equivalents and are excluded from ВСЕГО USD where unavailable.",
  ],
};

test("buildRemainingUsdDiffReport preserves total row and ranks finite USD mismatches", () => {
  const report = buildRemainingUsdDiffReport({
    period: { from: "2026-05-01", to: "2026-05-27" },
    statusPayload: {
      ok: true,
      commitSha: "eccc122a5e3f6e397015868572d85d5155cfdf3b",
      commitRef: "main",
      gitRepoSlug: "andylitvinov-design/finance",
      status: "ok",
    },
    auditSnapshotPayload: {
      ok: true,
      balances: { uses_amount_net: true, fallback_amount_rows: 0, missing_amount_net_rows: 0 },
    },
    reconciliationPayload,
  });

  assert.equal(report.dry_run, true);
  assert.equal(report.mutates_data, false);
  assert.equal(report.failing_layer.primary, "balance");
  assert.equal(report.production.commitSha, "eccc122a5e3f6e397015868572d85d5155cfdf3b");
  assert.deepEqual(report.amount_net, { uses_amount_net: true, fallback_amount_rows: 0, missing_amount_net_rows: 0 });
  assert.equal(report.total_usd_row.diff_usd, -2147.6884);
  assert.equal(report.top_mismatches[0].channel, "binance save");
  assert.equal(report.top_mismatches[0].currency, "USDT");
  assert.equal(report.top_mismatches[0].status, "needs_verification");
  assert.equal(report.top_mismatches[0].candidate_repair_type, "provider_confirmation_required");
  assert.equal(report.top_mismatches[1].channel, "пейпал дол");
  assert.equal(report.top_mismatches[1].candidate_repair_type, "owner_confirmation_required");
  assert.equal(report.top_mismatches[2].channel, "Бинанс spot");
  assert.equal(report.top_mismatches[2].candidate_repair_type, "possible_binance_spot_save_funding_transition");
});

test("buildRemainingUsdDiffReport lists FX-missing rows as excluded dry-run actions", () => {
  const report = buildRemainingUsdDiffReport({ reconciliationPayload });

  assert.equal(report.fx_missing_rows.length, 2);
  assert.deepEqual(report.fx_missing_summary, {
    count: 2,
    action: "keep_excluded_until_frozen_usd_evidence_exists",
    live_floating_fx_allowed: false,
  });
  assert.equal(report.fx_missing_rows[0].channel, "Яндекс руб");
  assert.equal(report.fx_missing_rows[0].candidate_repair_type, "fx_missing");
  assert.equal(report.fx_missing_rows[0].action, "keep excluded from ВСЕГО USD until frozen USD evidence exists");
});

test("buildRemainingUsdDiffReport keeps Binance Save USDT unresolved", () => {
  const report = buildRemainingUsdDiffReport({ reconciliationPayload });

  assert.equal(report.binance_save_conclusion.status, "still_needs_owner_or_provider_confirmation");
  assert.equal(report.binance_save_conclusion.fixed, false);
  assert.equal(report.binance_save_conclusion.row.diff_usd, -3107.3722);
});

test("parseArgs defaults to dry-run and validateApplyGuard requires explicit confirmation file", () => {
  assert.deepEqual(parseArgs(["--from=2026-05-01", "--to", "2026-05-27"]).period, {
    from: "2026-05-01",
    to: "2026-05-27",
  });
  assert.equal(parseArgs(["--from=2026-05-01"]).dryRun, true);

  assert.throws(
    () => validateApplyGuard({ apply: true, confirmFile: "" }),
    /--apply requires --confirm-file/
  );
  assert.throws(
    () => validateApplyGuard({ apply: true, confirmFile: "/tmp/confirm.txt" }, () => "wrong"),
    /confirmation file must contain exactly/
  );
  assert.doesNotThrow(() =>
    validateApplyGuard(
      { apply: true, confirmFile: "/tmp/confirm.txt" },
      () => APPLY_CONFIRMATION_TEXT
    )
  );
});
