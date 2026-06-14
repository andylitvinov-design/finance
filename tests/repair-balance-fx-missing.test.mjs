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
  "FX Rates": [
    ["date", "currency", "base_currency", "rate_to_usd", "source", "source_url", "fetched_at", "status", "comment"],
  ],
};

test("dry-run reports zero native balance as safe amount_usd=0 and non-zero missing rate as needs_fx_rate", async () => {
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
  assert.ok(yoomoney.repairs.some((repair) => repair.repair === "needs_fx_rate"));
  assert.ok(yoomoney.repairs.some((repair) => repair.missing_fx_date === "2026-05-27" && repair.missing_fx_currency === "RUB"));
  assert.equal(report.apply_result.skipped, "dry_run");
});

test("dry-run computes safe amount_usd from stored FX Rates and row rates without changing native values", async () => {
  const payload = {
    ok: true,
    period_balance_reconciliation: {
      total_usd_row: {
        excluded_channels: ["cash eur EUR", "bank cad CAD"],
      },
      by_channel_currency: [
        {
          channel: "cash eur",
          currency: "EUR",
          opening_usd: 110,
          confirmed_end_usd: null,
          confirmed_end_native: 90,
          manual_provider_closing_balance_date: "2026-05-31",
          manual_provider_closing_balance_usd: null,
          fx_warnings: ["confirmed_end_usd_fx_missing"],
        },
        {
          channel: "bank cad",
          currency: "CAD",
          opening_usd: 72,
          confirmed_end_usd: null,
          confirmed_end_native: 120,
          manual_provider_closing_balance_date: "2026-05-31",
          manual_provider_closing_balance_usd: null,
          manual_provider_closing_balance_fx_rate_to_usd: 0.75,
          fx_warnings: ["confirmed_end_usd_fx_missing"],
        },
      ],
    },
  };
  const report = await buildBalanceFxMissingRepairReport({
    from: "2026-05-01",
    to: "2026-05-31",
    reconciliationPayload: payload,
    sourceValuesBySheet: {
      "Остатки": [
        ["date", "channel", "amount", "currency", "rate", "amount_usd"],
        ["2026-05-31", "cash eur", "90", "EUR", "", ""],
        ["2026-05-31", "bank cad", "120", "CAD", "0.75", ""],
      ],
      "Авто Остатки": [["date", "provider", "channel", "amount", "currency", "rate", "amount_usd"]],
      "FX Rates": [
        ["date", "currency", "base_currency", "rate_to_usd", "source", "source_url", "fetched_at", "status", "comment"],
        ["2026-05-31", "EUR", "USD", "1.1655", "test", "", "2026-06-01T00:00:00Z", "ok", ""],
      ],
    },
  });

  assert.equal(report.safe_repairs_count, 2);
  assert.deepEqual(
    report.safe_repairs.map((repair) => [repair.channel, repair.repair_value, repair.fx_source]),
    [["cash eur", 104.895, "fx_rates"], ["bank cad", 90, "snapshot_rate"]]
  );
});

test("stable USD currencies and zero UNKNOWN balances are safe, but non-zero UNKNOWN remains needs_owner_fx", async () => {
  const payload = {
    ok: true,
    period_balance_reconciliation: {
      total_usd_row: {
        excluded_channels: ["binance save USDC", "карта май UNKNOWN", "local cash UNKNOWN"],
      },
      by_channel_currency: [
        { channel: "binance save", currency: "USDC", confirmed_end_native: 2020, confirmed_end_usd: null, manual_provider_closing_balance_date: "2026-05-31", fx_warnings: [] },
        { channel: "карта май", currency: "UNKNOWN", confirmed_end_native: 0, confirmed_end_usd: null, manual_provider_closing_balance_date: "2026-05-31", fx_warnings: [] },
        { channel: "local cash", currency: "UNKNOWN", confirmed_end_native: 10, confirmed_end_usd: null, manual_provider_closing_balance_date: "2026-05-31", fx_warnings: [] },
      ],
    },
  };
  const report = await buildBalanceFxMissingRepairReport({
    from: "2026-05-01",
    to: "2026-05-31",
    reconciliationPayload: payload,
    sourceValuesBySheet: {
      "Остатки": [
        ["date", "channel", "amount", "currency", "rate", "amount_usd"],
        ["2026-05-31", "binance save", "2020", "USDC", "", ""],
        ["2026-05-31", "карта май", "0", "UNKNOWN", "", ""],
        ["2026-05-31", "local cash", "10", "UNKNOWN", "", ""],
      ],
      "Авто Остатки": [["date", "provider", "channel", "amount", "currency", "rate", "amount_usd"]],
      "FX Rates": [["date", "currency", "base_currency", "rate_to_usd", "source", "source_url", "fetched_at", "status", "comment"]],
    },
  });

  assert.deepEqual(
    report.safe_repairs.map((repair) => [repair.channel, repair.repair_value, repair.fx_source]),
    [["binance save", 2020, "stable_usd_currency"], ["карта май", 0, "zero_native_balance"]]
  );
  const local = report.usd_coverage_problem_rows.find((row) => row.channel === "local cash");
  assert.ok(local.repairs.some((repair) => repair.repair === "needs_owner_fx"));
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
    /Pass --confirm=repair-balance-fx-missing-usd-equivalents/
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
