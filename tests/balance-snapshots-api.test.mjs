import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBalanceSnapshotsSnapshot,
  buildBalanceSnapshotsSummary,
} from "../server/balance-snapshots.js";

test("balance snapshots summary returns dates, detailed rows, and account-currency coverage", () => {
  const summary = buildBalanceSnapshotsSummary([
    { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1200" },
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1300" },
    { date: "2026-05-06", accountName: "БАНК КАНАДА cad", currency: "CAD", balanceAmount: "2380" },
  ]);

  assert.equal(summary.total_rows, 3);
  assert.equal(summary.valid_rows, 3);
  assert.equal(summary.incomplete_rows, 0);
  assert.deepEqual(summary.dates, ["2026-04-30", "2026-05-06"]);
  assert.deepEqual(summary.rows, [
    { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: 1200 },
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: 1300 },
    { date: "2026-05-06", channel: "БАНК КАНАДА cad", currency: "CAD", amount: 2380 },
  ]);
  assert.deepEqual(summary.by_date, [
    { date: "2026-04-30", rows: 1, manual_rows: 1, auto_rows: 0, merged_rows: 1, channel_currency_pairs: 1 },
    { date: "2026-05-06", rows: 2, manual_rows: 2, auto_rows: 0, merged_rows: 2, channel_currency_pairs: 2 },
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
  assert.equal(summary.incomplete_rows, 4);
  assert.deepEqual(summary.rows, [
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
  assert.deepEqual(snapshot.balance_snapshots.rows, [
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

  assert.deepEqual(snapshot.balance_snapshots.rows, [
    { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: 1070.48 },
  ]);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics, {
    fact_balance_rows_detected: 2,
    fact_balance_rows_saved_to_ostatki: 1,
    balance_snapshot_rows_loaded: 1,
    manual_balance_snapshot_rows_loaded: 1,
    auto_balance_snapshot_rows_loaded: 0,
    merged_balance_snapshot_rows_loaded: 1,
    manual_balance_dates: ["2026-05-17"],
    auto_balance_dates: [],
    merged_balance_dates: ["2026-05-17"],
    selected_balance_dates: ["2026-05-17"],
    missing_daily_coverage_dates: [],
    stale_current_only_auto_rows: 0,
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

test("balance snapshots API exposes confirmed, auto, and selected balances separately", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-04-01", to: "2026-04-01" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-04-01", channel: "wise usd", currency: "USD", amount: "120", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-04-01", channel: "wise usd", currency: "USD", amount: "119", source: "derived_from_confirmed_balance", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-04-01", channel: "paypal eur", currency: "EUR", amount: "55", source: "derived_from_confirmed_balance", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
      ],
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balance_snapshots.confirmed_rows, [
    {
      date: "2026-04-01",
      channel: "wise usd",
      currency: "USD",
      amount: 120,
      balance_kind: "confirmed",
      source: "manual_fact",
      source_sheet: "Остатки",
      status: "confirmed",
    },
  ]);
  assert.deepEqual(snapshot.balance_snapshots.auto_balance_rows, [
    {
      date: "2026-04-01",
      channel: "paypal eur",
      currency: "EUR",
      amount: 55,
      balance_kind: "auto",
      source: "derived_balance",
      source_sheet: "Авто Остатки",
      status: "derived_from_confirmed_balance",
    },
    {
      date: "2026-04-01",
      channel: "wise usd",
      currency: "USD",
      amount: 119,
      balance_kind: "auto",
      source: "derived_balance",
      source_sheet: "Авто Остатки",
      status: "derived_from_confirmed_balance",
    },
  ]);
  assert.deepEqual(snapshot.balance_snapshots.selected_rows, [
    {
      date: "2026-04-01",
      channel: "paypal eur",
      currency: "EUR",
      amount: 55,
      balance_kind: "selected",
      source: "derived_balance",
      source_sheet: "Авто Остатки",
      status: "derived_from_confirmed_balance",
      selected_from: "auto",
    },
    {
      date: "2026-04-01",
      channel: "wise usd",
      currency: "USD",
      amount: 120,
      balance_kind: "selected",
      source: "manual_fact",
      source_sheet: "Остатки",
      status: "confirmed",
      selected_from: "confirmed",
    },
  ]);
});

test("balance snapshots reports manual, auto, and merged daily inventories", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-05-03" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-03", channel: "wise usd", currency: "USD", amount: "80", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "90", source: "provider_auto", sourceSheet: "Авто Остатки" },
        { date: "2026-05-03", channel: "wise usd", currency: "USD", amount: "79", source: "provider_auto", sourceSheet: "Авто Остатки" },
      ],
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balance_snapshots.diagnostics.manual_balance_dates, ["2026-05-01", "2026-05-03"]);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics.auto_balance_dates, ["2026-05-02", "2026-05-03"]);
  assert.equal(snapshot.balance_snapshots.diagnostics.manual_balance_snapshot_rows_loaded, 2);
  assert.equal(snapshot.balance_snapshots.diagnostics.auto_balance_snapshot_rows_loaded, 2);
  assert.equal(snapshot.balance_snapshots.diagnostics.merged_balance_snapshot_rows_loaded, 3);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics.missing_daily_coverage_dates, []);
  assert.deepEqual(snapshot.balance_snapshots.by_date.map((row) => ({
    date: row.date,
    manual_rows: row.manual_rows,
    auto_rows: row.auto_rows,
    merged_rows: row.merged_rows,
  })), [
    { date: "2026-05-01", manual_rows: 1, auto_rows: 0, merged_rows: 1 },
    { date: "2026-05-02", manual_rows: 0, auto_rows: 1, merged_rows: 1 },
    { date: "2026-05-03", manual_rows: 1, auto_rows: 1, merged_rows: 1 },
  ]);
  assert.equal(snapshot.balance_snapshots.merged_rows.find((row) => row.date === "2026-05-03")?.amount, 80);
});

test("balance snapshots selected date applies owner-confirmed May opening seed", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-05-01" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-01", channel: "binance save", currency: "USD", amount: "7425", amount_usd: "7425", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "7432", amount_usd: "7432", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", amount_usd: "254", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "603", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount: "145614", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "Payoneer - eur", currency: "EUR", amount: "1107", amount_usd: "1284", sourceSheet: "Остатки" },
      ],
      autoBalances: [],
      warnings: [],
    }),
  });

  const selected = new Map(snapshot.balance_snapshots.selected_date_rows.map((row) => [`${row.channel}|${row.currency}`, row]));
  assert.equal(snapshot.balance_snapshots.selected_date, "2026-05-01");
  assert.equal(selected.get("binance save|USDT")?.amount, 8519);
  assert.equal(selected.get("Бинанс spot|USDT")?.amount, 1087.6223);
  assert.equal(selected.get("Бинанс spot|USDC")?.amount, 2.3777);
  assert.equal(selected.get("приват 24-грн|UAH")?.amount, 11239);
  assert.equal(selected.has("binance save|USD"), false);
});

test("balance snapshots selected date returns merged fallback rows when manual rows are empty", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-17", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        {
          date: "2026-05-17",
          channel: "wise usd",
          currency: "USD",
          amount: "90",
          source: "provider_auto",
          sourceSheet: "Авто Остатки",
          fetchedAt: "2026-05-17T23:01:00.000Z",
          status: "ok",
        },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_snapshots.selected_date, "2026-05-17");
  assert.equal(snapshot.balance_snapshots.selected_date_source, "merged");
  assert.deepEqual(snapshot.balance_snapshots.selected_date_rows, [
    { date: "2026-05-17", channel: "wise usd", currency: "USD", amount: 90 },
  ]);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics.selected_balance_dates, ["2026-05-17"]);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics.missing_daily_coverage_dates, []);
});

test("balance snapshots selected date reports expected coverage and duplicate channel rows", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-26", to: "2026-05-26" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-26", channel: "трансервайз дол", currency: "USD", amount: "90", source: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-05-26", channel: "трансервайз дол", currency: "USD", amount: "91", source: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-05-26", channel: "пейпал дол", currency: "USD", amount: "10", source: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_snapshots.selected_date_rows.length, 3);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.canonical_expected_rows, 23);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.expected_rows, 22);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.total_rows, 3);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.unique_channel_currency_count, 2);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.duplicate_channel_currency_count, 1);
  assert.ok(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("Binance funding|USDT"));
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.status, "partial");
});

test("balance snapshots selected date reports explicit inactive expected exclusions", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-20", to: "2026-05-20" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-20", channel: "трансервайз дол", currency: "USD", amount: "90", source: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-05-20", channel: "Binance funding", currency: "USDT", amount: "0", source: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_snapshots.selected_date_coverage.excluded_expected.some((row) => row.key === "Binance funding|USDT"), true);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.excluded_expected.some((row) => row.key === "binance save|USDC"), true);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("Binance funding|USDT"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("binance save|USDC"), false);
});

test("balance snapshots selected date does not trust stale current-only historical auto rows", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-17", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        {
          date: "2026-05-17",
          channel: "трансервайз дол",
          currency: "USD",
          amount: "870.42",
          source: "wise_auto",
          sourceSheet: "Авто Остатки",
          fetchedAt: "2026-05-25T22:23:47.068Z",
          status: "ok",
          comment: "auto daily provider snapshot",
        },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_snapshots.selected_date, "2026-05-17");
  assert.equal(snapshot.balance_snapshots.selected_date_source, "none");
  assert.deepEqual(snapshot.balance_snapshots.selected_date_rows, []);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics.selected_balance_dates, []);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics.missing_daily_coverage_dates, ["2026-05-17"]);
  assert.ok(snapshot.balance_snapshots.selected_date_diagnostics.some((message) =>
    message.includes("No balance snapshot for this date; run guarded May backfill.")
  ));
  assert.ok(snapshot.balance_snapshots.selected_date_diagnostics.some((message) =>
    message.includes("1 stale current-only auto row")
  ));
});

test("balance snapshots May coverage detects missing dates from trusted merged coverage", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-05-03" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        {
          date: "2026-05-02",
          channel: "wise usd",
          currency: "USD",
          amount: "90",
          source: "wise_auto",
          sourceSheet: "Авто Остатки",
          fetchedAt: "2026-05-25T22:23:47.068Z",
          status: "ok",
          comment: "auto daily provider snapshot",
        },
      ],
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balance_snapshots.diagnostics.merged_balance_dates, ["2026-05-01"]);
  assert.deepEqual(snapshot.balance_snapshots.diagnostics.missing_daily_coverage_dates, ["2026-05-02", "2026-05-03"]);
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
