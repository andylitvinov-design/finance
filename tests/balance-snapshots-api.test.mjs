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

test("selected-date snapshot hydrates native USD stablecoin rows but keeps non-USD without trusted USD as verification", () => {
  const summary = buildBalanceSnapshotsSummary([
    { date: "2026-06-01", channel: "трансервайз дол", currency: "USD", amount: "1275.42" },
    { date: "2026-06-01", channel: "Бинанс spot", currency: "USDT", amount: "100" },
    { date: "2026-06-01", channel: "монобанк грн", currency: "UAH", amount: "10313" },
  ], { from: "2026-06-01", to: "2026-06-01" });

  const byChannel = new Map(summary.selected_date_rows.map((row) => [row.channel, row]));

  assert.equal(byChannel.get("трансервайз дол")?.amount_usd, 1275.42);
  assert.equal(byChannel.get("Бинанс spot")?.amount_usd, 100);
  assert.equal(byChannel.get("монобанк грн")?.amount_usd, undefined);
  assert.ok(summary.selected_date_diagnostics.some((line) =>
    /native amount without trusted USD equivalent/.test(line)
  ));
});

test("provider matrix marks unsupported and stale channels with last snapshot/import evidence", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-06-01" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-28", channel: "монобанк грн", currency: "UAH", amount: "1333", amount_usd: "31.36", source: "manual screenshot" },
        { date: "2026-05-31", channel: "приват 24-грн", currency: "UAH", amount: "93.27", amount_usd: "2.1068", source: "manual screenshot" },
        { date: "2026-05-31", channel: "REVOLUT евро", currency: "EUR", amount: "110.74", amount_usd: "129.1082", source: "manual screenshot" },
      ],
      operations: [
        {
          date: "2026-05-28",
          operation: "income",
          toChannel: "монобанк грн",
          currency: "UAH",
          ledgerV2: { date: "2026-05-28", operation: "income", to_channel: "монобанк грн", currency: "UAH" },
        },
      ],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
  });

  const matrix = snapshot.balance_snapshots.provider_channel_matrix;
  const mono = matrix.find((row) => row.channel === "монобанк грн" && row.currency === "UAH");
  const privat = matrix.find((row) => row.channel === "приват 24-грн" && row.currency === "UAH");
  const revolut = matrix.find((row) => row.channel === "REVOLUT евро" && row.currency === "EUR");

  assert.equal(mono.supports_current_balance_auto_refresh, true);
  assert.equal(mono.supports_transaction_import, true);
  assert.equal(mono.last_successful_operation_import_date, "2026-05-28");
  assert.equal(mono.last_successful_balance_refresh_date, "2026-05-28");
  assert.equal(mono.stale, true);
  assert.match(mono.action_required, /manual balance needed|refresh token|upload screenshot/);

  assert.equal(privat.supports_current_balance_auto_refresh, false);
  assert.equal(privat.supports_transaction_import, true);
  assert.equal(privat.stale, true);
  assert.match(privat.reason, /current balance auto refresh unsupported/);

  assert.equal(revolut.supports_current_balance_auto_refresh, false);
  assert.equal(revolut.supports_transaction_import, false);
  assert.equal(revolut.provider_token_status, "not_implemented");
  assert.equal(revolut.last_manual_screenshot_snapshot_date, "2026-05-31");
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
      amount_usd: 120,
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
  assert.equal(selected.get("binance save|USDT")?.amount, 5411.6278);
  assert.equal(selected.get("binance save|USDC")?.amount, 3107.3722);
  assert.equal(selected.get("Бинанс spot|USDT")?.amount, 1087.6223);
  assert.equal(selected.get("Бинанс spot|USDC")?.amount, 2.3777);
  assert.equal(selected.get("приват 24-грн|UAH")?.amount, 11239);
  assert.equal(selected.get("binance save|USDT")?.amount + selected.get("binance save|USDC")?.amount, 8519);
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
    { date: "2026-05-17", channel: "wise usd", currency: "USD", amount: 90, amount_usd: 90 },
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

test("balance snapshots selected date carries owner-confirmed May 28 rows over stale derived current rows", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-28", to: "2026-06-01" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-28", channel: "binance save", currency: "USDT", amount: "5412", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-28", channel: "binance save", currency: "USDC", amount: "2020", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-28", channel: "Бинанс spot", currency: "USDT", amount: "1162", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-28", channel: "Бинанс spot", currency: "USDC", amount: "0", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-28", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "10538", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-28", channel: "монобанк грн", currency: "UAH", amount: "1333", amount_usd: "31.36", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-28", channel: "Яндекс руб", currency: "RUB", amount: "104862.88", amount_usd: "1376", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-06-01", channel: "Payoneer - eur", currency: "EUR", amount: "1008.19", amount_usd: "1175.3751", source: "payoneer_derived_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "пейпал дол", currency: "USD", amount: "35.30", amount_usd: "12.07", source: "paypal_derived_balance", sourceSheet: "Авто Остатки" },
      ],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-06-01", channel: "binance save", currency: "USD", amount: "7425", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: "5413.0775", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "binance save", currency: "USDC", amount: "2020.0001", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "Бинанс spot", currency: "USD", amount: "1689", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "Бинанс spot", currency: "USDT", amount: "1262.1523", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "Бинанс spot", currency: "USDC", amount: "50", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "БАНК КАНАДА cad CAD", currency: "CAD", amount: "7351", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
        { date: "2026-06-01", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: "345", source: "provider_auto", status: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
      ],
      warnings: [],
    }),
  });

  const selectedRows = snapshot.balance_snapshots.selected_rows.map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.selected_from}`).sort();
  const selectedDateRows = snapshot.balance_snapshots.selected_date_rows.map((row) => `${row.channel}|${row.currency}|${row.amount}`).sort();
  const selectedText = JSON.stringify({
    selected_rows: snapshot.balance_snapshots.selected_rows,
    selected_date_rows: snapshot.balance_snapshots.selected_date_rows,
  });

  assert.equal(snapshot.balance_snapshots.selected_date, "2026-06-01");
  assert.equal(snapshot.balance_snapshots.selected_date_source, "latest_known");
  assert.deepEqual(selectedDateRows, [
    "Payoneer - eur|EUR|1418.39",
    "binance save|USDC|2020",
    "binance save|USDT|5412",
    "БАНК КАНАДА cad|CAD|10538",
    "Бинанс spot|USDC|0",
    "Бинанс spot|USDT|1162",
    "Яндекс руб|RUB|104862.88",
    "монобанк грн|UAH|11646",
    "пейпал дол|USD|86.89",
  ]);
  assert.deepEqual(selectedRows, [
    "Payoneer - eur|EUR|1418.39|confirmed",
    "binance save|USDC|2020|confirmed",
    "binance save|USDT|5412|confirmed",
    "БАНК КАНАДА cad|CAD|10538|confirmed",
    "Бинанс spot|USDC|0|confirmed",
    "Бинанс spot|USDT|1162|confirmed",
    "Яндекс руб|RUB|104862.88|confirmed",
    "монобанк грн|UAH|11646|confirmed",
    "пейпал дол|USD|86.89|confirmed",
  ]);
  const rows = new Map(snapshot.balance_snapshots.selected_date_rows.map((row) => [`${row.channel}|${row.currency}`, row]));
  assert.equal(rows.get("Payoneer - eur|EUR")?.amount_usd, 1653.5973);
  assert.equal(rows.get("пейпал дол|USD")?.amount_usd, 86.89);
  assert.equal(selectedText.includes("7425"), false);
  assert.equal(selectedText.includes("1689"), false);
  assert.equal(selectedText.includes("7351"), false);
  assert.equal(selectedText.includes("1175.3751"), false);
  assert.equal(selectedText.includes("12.07"), false);
  assert.equal(selectedText.includes("legacy_combined_binance_spot_funding"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("binance save|USDT"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("binance save|USDC"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("Бинанс spot|USDT"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("Бинанс spot|USDC"), false);
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

test("balance snapshots selected date applies owner-confirmed May current snapshot corrections", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-06-01" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-03-10", channel: "деп24-дол", currency: "USD", amount: "0" },
        { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
        { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "603" },
        { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount: "107403.42", amount_usd: "1270.1528" },
        { date: "2026-05-01", channel: "binance save", currency: "USD", amount: "7425", amount_usd: "7425" },
        { date: "2026-05-01", channel: "Бинанс spot", currency: "USD", amount: "1689", amount_usd: "1689" },
        { date: "2026-05-01", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: "345", amount_usd: "345" },
      ],
      autoBalances: [
        { date: "2026-06-01", channel: "Яндекс руб", currency: "RUB", amount: "107403.42", amount_usd: "1270.1528", source: "provider_auto", sourceSheet: "Авто Остатки", comment: "auto daily provider snapshot" },
        { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: "5413.0775", amount_usd: "5413.0775", source: "provider_auto", sourceSheet: "Авто Остатки", comment: "auto daily provider snapshot" },
        { date: "2026-06-01", channel: "Бинанс spot", currency: "USDT", amount: "1262.1523", amount_usd: "1262.1523", source: "provider_auto", sourceSheet: "Авто Остатки", comment: "auto daily provider snapshot" },
      ],
      plannedRows: [],
      warnings: [],
    }),
  });

  const selected = new Map(snapshot.balance_snapshots.selected_date_rows.map((row) => [`${row.channel}|${row.currency}`, row]));
  assert.equal(snapshot.balance_snapshots.selected_date_source, "latest_known");
  assert.equal(selected.get("БАНК КАНАДА cad|CAD").amount, 10538);
  assert.equal(selected.get("БАНК КАНАДА cad|CAD").amount_usd, 7798);
  assert.equal(selected.get("монобанк грн|UAH").amount, 10916);
  assert.equal(selected.get("монобанк грн|UAH").amount_usd, 567.8038);
  assert.equal(selected.get("Яндекс руб|RUB").amount_usd, 1376);
  assert.equal(selected.get("binance save|USDT").amount, 5412);
  assert.equal(selected.get("binance save|USDT").amount_usd, 5412);
  assert.equal(selected.get("binance save|USDC").amount, 2020);
  assert.equal(selected.get("binance save|USDC").amount_usd, 2020);
  assert.equal(selected.get("Бинанс spot|USDT").amount, 1162);
  assert.equal(selected.get("Бинанс spot|USDT").amount_usd, 1162);
  assert.equal(selected.get("Бинанс spot|USDC").amount, 0);
  assert.equal(selected.get("Бинанс spot|USDC").amount_usd, 0);
  assert.equal(selected.has("legacy_combined_binance_spot_funding|USDT"), false);
  assert.equal(selected.has("binance save|USD"), false);
  assert.equal(selected.has("Бинанс spot|USD"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("binance save|USDT"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("binance save|USDC"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("Бинанс spot|USDT"), false);
  assert.equal(snapshot.balance_snapshots.selected_date_coverage.missing_channels.includes("Бинанс spot|USDC"), false);
});

test("balance snapshots selected date hydrates USD from canonical reconciliation values", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { date: "2026-06-01" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
        { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "603" },
        { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount: "107403.42" },
        { date: "2026-05-01", channel: "binance save", currency: "USDC", amount: "3107.3722", amount_usd: "3107.3722" },
        { date: "2026-05-01", channel: "Бинанс spot", currency: "USDT", amount: "1262.1523", amount_usd: "1262.1523" },
        { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435" },
        { date: "2026-05-28", channel: "приват 24-грн", currency: "UAH", amount: "91.849248", amount_usd: "2.1068" },
      ],
      autoBalances: [
        { date: "2026-06-01", channel: "трансервайз дол", currency: "USD", amount: "1275.42" },
        { date: "2026-06-01", channel: "Payoneer - eur", currency: "EUR", amount: "1008.19", rate: "1.16" },
        { date: "2026-06-01", channel: "нал-мам-евро", currency: "EUR", amount: "580", rate: "1.165868" },
        { date: "2026-06-01", channel: "трансервайз евро", currency: "EUR", amount: "148.94", rate: "1.16" },
        { date: "2026-06-01", channel: "REVOLUT евро", currency: "EUR", amount: "110.74", rate: "1.165868" },
        { date: "2026-06-01", channel: "Налично -я-евр", currency: "EUR", amount: "91", rate: "1.165868" },
        { date: "2026-06-01", channel: "приват 24-дол", currency: "USD", amount: "43" },
        { date: "2026-06-01", channel: "REVOLUT франк", currency: "CHF", amount: "15", rate: "1.2760333333333333" },
        { date: "2026-06-01", channel: "REVOLUT дол", currency: "USD", amount: "18.38" },
        { date: "2026-06-01", channel: "пейпал дол", currency: "USD", amount: "35.3" },
        { date: "2026-06-01", channel: "Payoneer - dol", currency: "USD", amount: "3.48" },
        { date: "2026-06-01", channel: "приват 24-евро", currency: "EUR", amount: "1", rate: "1.1659" },
        { date: "2026-06-01", channel: "binance save", currency: "USDC", amount: "3107.3722", amount_usd: "3107.3722" },
        { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: "5413.0775" },
        { date: "2026-06-01", channel: "Бинанс spot", currency: "USDT", amount: "1262.1523" },
      ],
      operations: [],
      fxRates: [],
      plannedRows: [],
      warnings: [],
    }),
  });

  const selected = new Map(snapshot.balance_snapshots.selected_date_rows.map((row) => [`${row.channel}|${row.currency}`, row]));
  const total = snapshot.balance_snapshots.selected_date_rows.reduce((sum, row) => sum + Number(row.amount_usd || 0), 0);

  assert.equal(snapshot.balance_snapshots.selected_date, "2026-06-01");
  assert.equal(selected.get("трансервайз дол|USD").amount_usd, 1275.42);
  assert.equal(selected.get("Яндекс руб|RUB").amount_usd, 1376);
  assert.equal(selected.get("Payoneer - eur|EUR").amount_usd, 1645.3324);
  assert.equal(selected.get("пейпал дол|USD").amount_usd, 86.89);
  assert.equal(selected.get("binance save|USDT").amount_usd, 5412);
  assert.equal(selected.get("binance save|USDC").amount_usd, 2020);
  assert.equal(selected.get("Бинанс spot|USDT").amount_usd, 1162);
  assert.equal(selected.get("Бинанс spot|USDC").amount_usd, 0);
  assert.equal(selected.has("binance save|USD"), false);
  assert.equal(Number(total.toFixed(4)), 21947.0916);
});

test("balance snapshots selected date does not apply May current overrides after the May carry-forward window", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-06-02", to: "2026-06-02" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-06-02", channel: "binance save", currency: "USDT", amount: "12", amount_usd: "12" },
      ],
      autoBalances: [],
      operations: [],
      warnings: [],
    }),
  });

  const selected = new Map(snapshot.balance_snapshots.selected_date_rows.map((row) => [`${row.channel}|${row.currency}`, row]));
  assert.equal(selected.get("binance save|USDT").amount_usd, 12);
  assert.equal(selected.has("binance save|USD"), false);
});
