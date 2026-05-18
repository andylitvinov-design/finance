import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBalanceSnapshotsSnapshot,
  buildBalanceSnapshotsSummary,
} from "../server/balance-snapshots.js";

function rowCore(row) {
  return {
    date: row.date,
    channel: row.channel,
    currency: row.currency,
    amount: row.amount,
  };
}

test("balance snapshots summary returns dates, detailed rows, and account-currency coverage", () => {
  const summary = buildBalanceSnapshotsSummary([
    { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1200" },
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1300" },
    { date: "2026-05-06", accountName: "БАНК КАНАДА cad", currency: "CAD", balanceAmount: "2380" },
  ]);

  assert.equal(summary.total_rows, 3);
  assert.equal(summary.valid_rows, 3);
  assert.equal(summary.native_valid_rows, 3);
  assert.equal(summary.usd_only_rows, 0);
  assert.equal(summary.needs_native_currency_value_rows, 0);
  assert.equal(summary.explicit_zero_rows, 0);
  assert.equal(summary.blank_amount_rows, 0);
  assert.equal(summary.incomplete_rows, 0);
  assert.deepEqual(summary.dates, ["2026-04-30", "2026-05-06"]);
  assert.deepEqual(summary.rows, [
    { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: 1200, amount_native: 1200, amount_usd: 1200, fx_rate_to_usd: 1, value_type: "native_and_usd", valid_native_balance: true, needs_native_currency_value: false },
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: 1300, amount_native: 1300, amount_usd: 1300, fx_rate_to_usd: 1, value_type: "native_and_usd", valid_native_balance: true, needs_native_currency_value: false },
    { date: "2026-05-06", channel: "БАНК КАНАДА cad", currency: "CAD", amount: 2380, amount_native: 2380, amount_usd: null, fx_rate_to_usd: null, value_type: "native_only", valid_native_balance: true, needs_native_currency_value: false },
  ]);
  assert.deepEqual(summary.by_date, [
    { date: "2026-04-30", rows: 1, channel_currency_pairs: 1 },
    { date: "2026-05-06", rows: 2, channel_currency_pairs: 2 },
  ]);
  assert.deepEqual(summary.by_channel_currency, [
    {
      channel: "wise usd",
      currency: "USD",
      rows: 2,
      dates: ["2026-04-30", "2026-05-06"],
      first_date: "2026-04-30",
      last_date: "2026-05-06",
    },
    {
      channel: "БАНК КАНАДА cad",
      currency: "CAD",
      rows: 1,
      dates: ["2026-05-06"],
      first_date: "2026-05-06",
      last_date: "2026-05-06",
    },
  ]);
});

test("balance snapshots summary counts incomplete Остатки rows", () => {
  const summary = buildBalanceSnapshotsSummary([
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1300" },
    { date: "2026-05-06", channel: "wise usd", currency: "", amount: "1300" },
    { date: "2026-05-07", channel: "wise usd", currency: "USD", amount: "" },
    { date: "", channel: "wise usd", currency: "USD", amount: "1300" },
    { date: "2026-05-08", channel: "", currency: "USD", amount: "1300" },
  ]);

  assert.equal(summary.total_rows, 5);
  assert.equal(summary.valid_rows, 1);
  assert.equal(summary.native_valid_rows, 1);
  assert.equal(summary.blank_amount_rows, 1);
  assert.equal(summary.incomplete_rows, 4);
  assert.deepEqual(summary.rows.map(rowCore), [
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: 1300 },
  ]);
  assert.equal(summary.missing_date_rows, 1);
  assert.equal(summary.missing_channel_rows, 1);
  assert.equal(summary.missing_currency_rows, 1);
  assert.equal(summary.missing_amount_rows, 1);
  assert.deepEqual(summary.incomplete_preview.map((row) => row.reason), [
    "missing_currency",
    "missing_amount",
    "missing_date",
    "missing_channel",
  ]);
});

test("balance snapshots summary reports USD-only rows that need native value", () => {
  const summary = buildBalanceSnapshotsSummary([
    { date: "2026-05-06", channel: "paypal eur", currency: "EUR", amount_native: null, amount_usd: 100, value_type: "usd_only_needs_native" },
    { date: "2026-05-06", channel: "paypal cad", currency: "CAD", amount: "0" },
  ]);

  assert.equal(summary.total_rows, 2);
  assert.equal(summary.valid_rows, 1);
  assert.equal(summary.native_valid_rows, 1);
  assert.equal(summary.usd_only_rows, 1);
  assert.equal(summary.needs_native_currency_value_rows, 1);
  assert.equal(summary.explicit_zero_rows, 1);
  assert.equal(summary.blank_amount_rows, 0);
  assert.deepEqual(summary.rows.map(rowCore), [
    { date: "2026-05-06", channel: "paypal cad", currency: "CAD", amount: 0 },
  ]);
  assert.deepEqual(summary.incomplete_preview, [
    {
      date: "2026-05-06",
      channel: "paypal eur",
      currency: "EUR",
      reason: "needs_native_currency_value",
    },
  ]);
});

test("balance snapshots API applies period filter and exposes detailed rows", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1200" },
        { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1300" },
        { date: "2026-05-07", channel: "wise usd", currency: "", amount: "1400" },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.period, { from: "2026-05-01", to: "2026-05-31" });
  assert.deepEqual(snapshot.balance_snapshots.dates, ["2026-05-06"]);
  assert.deepEqual(snapshot.balance_snapshots.rows.map(rowCore), [
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: 1300 },
  ]);
  assert.equal(snapshot.balance_snapshots.total_rows, 2);
  assert.equal(snapshot.balance_snapshots.valid_rows, 1);
  assert.equal(snapshot.balance_snapshots.incomplete_rows, 1);
  assert.equal(
    snapshot.audit_checks.find((check) => check.name === "balance_snapshots_inventory")?.status,
    "needs verification"
  );
  assert.ok(snapshot.warnings.some((warning) => warning.includes("Остатки row(s) are incomplete")));
});

test("balance snapshots API returns input rows for active ledger channels missing Остатки rows", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-05-15" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-15", channel: "wise usd", currency: "USD", amount: "1300" },
      ],
      operations: [
        {
          date: "2026-05-10",
          operation: "income",
          toChannel: "wise usd",
          currency: "USD",
          ledgerV2: { date: "2026-05-10", operation: "income", to_channel: "wise usd", currency: "USD" },
        },
        {
          date: "2026-05-11",
          operation: "expense",
          fromChannel: "paypal eur",
          currency: "EUR",
          ledgerV2: { date: "2026-05-11", operation: "expense", from_channel: "paypal eur", currency: "EUR" },
        },
      ],
      warnings: [],
    }),
  });

  const inputRows = snapshot.balance_snapshots.input_rows;
  assert.ok(inputRows.some((row) =>
    row.date === "2026-05-15"
    && row.channel === "wise usd"
    && row.currency === "USD"
    && row.sheet === "Остатки"
    && row.amount_required === true
    && row.existing_amount === 1300
    && row.needs_input === false
    && row.source === "existing_balance"
    && row.status === "already_entered"
  ));
  assert.ok(inputRows.some((row) =>
    row.date === "2026-05-15"
    && row.channel === "paypal eur"
    && row.currency === "EUR"
    && row.sheet === "Остатки"
    && row.amount_required === true
    && row.existing_amount === null
    && row.needs_input === true
    && row.source === "active_channel_missing_balance"
    && row.status === "needs_input"
  ));
  assert.equal(
    inputRows.filter((row) => row.date === "2026-05-15" && row.channel === "wise usd" && row.currency === "USD").length,
    1
  );
});

test("balance snapshots reads Остатки rows and warns about Факт now rows missing in Остатки", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-17", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "1070.48" },
      ],
      legacyExpenseRows: [
        {
          date: "2026-05-17",
          category: "now",
          amounts: {
            "трансервайз дол": "1070.48",
            "пейпал дол": "55",
          },
        },
      ],
      operations: [],
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balance_snapshots.rows.map(rowCore), [
    { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: 1070.48 },
  ]);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics, {
    fact_balance_rows_detected: 2,
    fact_balance_rows_saved_to_ostatki: 1,
    balance_snapshot_rows_loaded: 1,
    skipped_non_balance_fact_rows: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
  });
  assert.ok(snapshot.warnings.includes("Остатки внесены во вкладку Факт, но сверка использует вкладку Остатки."));
  assert.ok(snapshot.balance_snapshots.fact_balance_rows.some((row) =>
    row.sheet === "Факт"
    && row.expected_sheet === "Остатки"
    && row.channel === "пейпал дол"
    && row.currency === "USD"
    && row.status === "missing_in_ostatki"
  ));
  assert.ok(snapshot.balance_snapshots.fact_balance_rows.some((row) =>
    row.channel === "трансервайз дол"
    && row.currency === "USD"
    && row.status === "matched_ostatki"
  ));
});

test("balance snapshots input rows use selected to date as target date", () => {
  const summary = buildBalanceSnapshotsSummary(
    [{ date: "2026-05-14", channel: "wise usd", currency: "USD", amount: "1200" }],
    { from: "2026-05-01", to: "2026-05-31" },
    {
      operations: [
        { ledgerV2: { date: "2026-05-20", operation: "income", to_channel: "wise usd", currency: "USD" } },
      ],
    }
  );

  assert.ok(summary.input_rows.length > 0);
  assert.ok(summary.input_rows.every((row) => row.date === "2026-05-31"));
  assert.ok(summary.input_rows.some((row) => row.channel === "wise usd" && row.needs_input === true));
});

test("balance snapshots API returns safe empty snapshot when repository access fails", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: false,
      warning: "Manual Google Sheets overlay failed: service account access is not configured.",
    }),
  });

  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.period, { from: "2026-05-01", to: "2026-05-31" });
  assert.equal(snapshot.balance_snapshots.total_rows, 0);
  assert.deepEqual(snapshot.balance_snapshots.rows, []);
  assert.equal(snapshot.audit_checks[0].status, "needs verification");
  assert.ok(snapshot.warnings.some((warning) => warning.includes("service account access")));
});
