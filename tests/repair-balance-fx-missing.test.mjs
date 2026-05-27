import test from "node:test";
import assert from "node:assert/strict";

import {
  FX_REPAIR_CONFIRMATION,
  buildBalanceFxMissingRepairReport,
  parseArgs,
} from "../scripts/repair-balance-fx-missing.mjs";

const reconciliationPayload = {
  ok: true,
  period_balance_reconciliation: {
    total_usd_row: {
      excluded_fx_missing_rows: 2,
      fx_missing_start_rows: 1,
      fx_missing_end_rows: 2,
      fx_missing_change_rows: 2,
      fx_missing_movement_rows: 0,
      fx_missing_diff_rows: 2,
    },
    warnings: ["fx_missing: 2 row(s) have missing frozen USD equivalents."],
    by_channel_currency: [
      {
        channel: "пейпал евр",
        currency: "EUR",
        opening_native: 175.25,
        opening_balance_date: "2026-05-01",
        opening_amount_usd: null,
        opening_fx_rate_to_usd: null,
        confirmed_end_native: 0,
        manual_provider_closing_balance_date: "2026-05-27",
        manual_provider_closing_balance_usd: null,
        manual_provider_closing_balance_fx_rate_to_usd: null,
        fx_warnings: [
          "opening_usd_fx_missing",
          "planned_end_usd_fx_missing",
          "confirmed_end_usd_fx_missing",
          "diff_usd_fx_missing",
        ],
      },
      {
        channel: "Яндекс руб",
        currency: "RUB",
        opening_native: 142858.88,
        opening_balance_date: "2026-04-30",
        opening_amount_usd: null,
        opening_fx_rate_to_usd: null,
        confirmed_end_native: 104862.88,
        manual_provider_closing_balance_date: "2026-05-27",
        manual_provider_closing_balance_usd: null,
        manual_provider_closing_balance_fx_rate_to_usd: null,
        fx_warnings: [
          "opening_usd_fx_missing",
          "planned_end_usd_fx_missing",
          "confirmed_end_usd_fx_missing",
          "diff_usd_fx_missing",
        ],
      },
    ],
  },
};

const sourceValuesBySheet = {
  "Остатки": [
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
    ["2026-05-01", "пейпал евр", "175.25", "EUR", "", "", ""],
    ["2026-04-30", "Яндекс руб", "142858.88", "RUB", "", "", ""],
  ],
  "Авто Остатки": [
    ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"],
    ["2026-05-27", "paypal", "пейпал евр", "0", "EUR", "", "", "provider_auto", "2026-05-27T00:00:00Z", "", "derived_pending", ""],
    ["2026-05-27", "yoomoney", "Яндекс руб", "104862.88", "RUB", "", "", "provider_auto", "2026-05-27T00:00:00Z", "", "derived_pending", ""],
  ],
};

test("dry-run reports zero native balance as safe amount_usd=0 and leaves non-zero local balance needs_owner_fx", async () => {
  const report = await buildBalanceFxMissingRepairReport({
    from: "2026-05-01",
    to: "2026-05-27",
    reconciliationPayload,
    sourceValuesBySheet,
  });

  assert.equal(report.dry_run, true);
  assert.equal(report.fx_missing_rows_count, 2);
  assert.equal(report.safe_repairs_count, 1);
  assert.equal(report.safe_repairs[0].channel, "пейпал евр");
  assert.equal(report.safe_repairs[0].repair, "balance_usd");
  assert.equal(report.safe_repairs[0].repair_value, 0);
  assert.equal(report.safe_repairs[0].fx_source, "zero_native_balance");

  const yoomoney = report.fx_missing_rows.find((row) => row.channel === "Яндекс руб");
  assert.ok(yoomoney.repairs.some((repair) => repair.repair === "needs_owner_fx"));
  assert.equal(report.apply_result.skipped, "dry_run");
});

test("apply only writes safe zero amount_usd cells and never writes owner FX guesses", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      async json() {
        return { totalUpdatedCells: 1 };
      },
    };
  };

  const report = await buildBalanceFxMissingRepairReport({
    from: "2026-05-01",
    to: "2026-05-27",
    apply: true,
    confirm: FX_REPAIR_CONFIRMATION,
    accessToken: "test-token",
    fetchImpl,
    reconciliationPayload,
    sourceValuesBySheet,
  });

  assert.equal(report.dry_run, false);
  assert.equal(report.apply_result.applied, true);
  assert.deepEqual(report.apply_result.updated_cells, ["'Авто Остатки'!G2"]);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.data, [{ range: "'Авто Остатки'!G2", values: [["0"]] }]);
});

test("parseArgs requires explicit confirmation before applying sheet repair", () => {
  assert.throws(
    () => parseArgs(["--from=2026-05-01", "--to=2026-05-27", "--apply"]),
    /Pass --confirm=repair-balance-fx-missing-zero-usd/
  );
  const options = parseArgs([
    "--from=2026-05-01",
    "--to=2026-05-27",
    "--apply",
    `--confirm=${FX_REPAIR_CONFIRMATION}`,
  ]);
  assert.equal(options.apply, true);
  assert.equal(options.dryRun, false);
});
