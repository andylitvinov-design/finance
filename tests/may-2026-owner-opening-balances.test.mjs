import test from "node:test";
import assert from "node:assert/strict";

import { buildAuditSnapshot } from "../api/audit-snapshot.js";
import {
  OWNER_MAY_OPENING_BALANCES,
  applyOwnerMayOpeningBalanceSeed,
  buildReconciliationAdjustedMayOpening,
  buildOwnerMayOpeningBalanceRows,
  ownerMayOpeningTotalUsd,
  validateOwnerMayOpeningBalances,
} from "../server/may-2026-owner-opening-balances.js";
import { buildBackfillDailyBalanceSnapshotsReport } from "../scripts/backfill-daily-balance-snapshots.mjs";

test("owner-confirmed 2026-05-01 opening balances total exactly 24993 USD", () => {
  assert.equal(ownerMayOpeningTotalUsd(), 24993);
  assert.equal(validateOwnerMayOpeningBalances().ok, true);
});

test("native UAH balances keep owner-provided USD equivalents", () => {
  const rows = buildOwnerMayOpeningBalanceRows();
  const privat = rows.find((row) => row.channel === "приват 24-грн");
  const mono = rows.find((row) => row.channel === "монобанк грн");

  assert.equal(privat.amount, 11239);
  assert.equal(privat.amount_usd, 254);
  assert.equal(mono.amount, 26670);
  assert.equal(mono.amount_usd, 603);
});

test("unmapped owner balance channel fails validation instead of becoming silent zero", () => {
  const invalid = validateOwnerMayOpeningBalances([
    ...OWNER_MAY_OPENING_BALANCES,
    { inputChannel: "новый канал", channel: "", currency: "", amount: 0, amountUsd: 0 },
  ]);

  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /unmapped owner balance channel: новый канал/);
});

test("owner seed replaces stale May opening anchors and preserves exact owner total", () => {
  const seed = applyOwnerMayOpeningBalanceSeed([
    { date: "2026-05-01", channel: "binance save", currency: "USD", amount: "7425", amount_usd: "7425", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "7432", amount_usd: "7432", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: "345", amount_usd: "345", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239,19", amount_usd: "256,2535", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "608,0711", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount: "145614", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "Payoneer - eur", currency: "EUR", amount: "1107", amount_usd: "1284", sourceSheet: "Остатки" },
    { date: "2026-05-01", channel: "трансервайз дол", currency: "USD", amount: "2639,05", amount_usd: "2639,05", sourceSheet: "Остатки" },
  ]);

  const mayRows = seed.rows.filter((row) => row.date === "2026-05-01");
  const total = mayRows.reduce((sum, row) => sum + Number(row.amount_usd ?? row.amountUsd ?? 0), 0);

  assert.equal(seed.applied, true);
  assert.equal(Math.round(total * 10000) / 10000, 24993);
  assert.equal(mayRows.some((row) => row.channel === "legacy_combined_binance_spot_funding"), false);
  assert.equal(mayRows.find((row) => row.channel === "binance save").amount_usd, 8519);
  assert.equal(mayRows.find((row) => row.channel === "приват 24-грн").amount, 11239);
  assert.equal(mayRows.find((row) => row.channel === "приват 24-грн").amount_usd, 254);
});

test("audit snapshot exposes owner-confirmed May 1 opening total", async () => {
  const response = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-01" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [{
        date: "2026-05-01",
        fromChannel: "",
        toChannel: "Бинанс spot",
        currency: "USDC",
        amountUsd: "0.03",
        amountNet: "0.03",
        balanceAmount: 0.03,
        ledgerV2: {
          date: "2026-05-01",
          operation: "income",
          to_channel: "Бинанс spot",
          currency: "USDC",
          amount_usd: "0.03",
          amount_net: "0.03",
          balance_amount: 0.03,
        },
      }],
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
      autoBalances: [
        { date: "2026-05-24", channel: "Бинанс spot", currency: "USDC", amount: "2.8903", amount_usd: "2.8903", provider: "binance", source: "provider_auto" },
      ],
      commissionRows: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const total = response.balances.remainders_rows.reduce((sum, row) => sum + Number(row.opening_amount_usd || 0), 0);
  assert.equal(response.balances.owner_confirmed_may_opening_balance_seed_applied, true);
  assert.equal(response.balances.owner_confirmed_may_opening_total_usd, 24993);
  assert.equal(total, 24993);
  const usdc = response.balances.remainders_rows.find((row) => row.channel === "Бинанс spot" && row.currency === "USDC");
  assert.equal(usdc?.opening_amount_usd ?? null, null);
});

test("May daily balance backfill uses 2026-05-01 opening snapshot, not ledger-only reconstruction", async () => {
  const report = await buildBackfillDailyBalanceSnapshotsReport({
    from: "2026-05-01",
    to: "2026-05-03",
    now: new Date("2026-05-26T10:00:00.000Z"),
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
      operations: [{
        date: "2026-05-02",
        toChannel: "binance save",
        currency: "USDT",
        amountNet: "10",
        balanceAmount: 10,
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "binance save",
          currency: "USDT",
          amount_net: "10",
          balance_amount: 10,
        },
      }],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
  });

  const row = report.planned_rows.find((entry) => entry.date === "2026-05-02" && entry.channel === "binance save" && entry.currency === "USDT");
  assert.equal(report.merge_summary.owner_confirmed_may_opening_balance_seed_applied, true);
  assert.equal(row.amount, 8529);
  assert.equal(row.comment.includes("2026-05-01"), true);
});

test("reconciliation-adjusted May opening keeps owner input visible and adjusts small UAH rounding diff", () => {
  const report = buildReconciliationAdjustedMayOpening({
    balanceRows: [
      { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "26680.14", amount_usd: "603.0032", sourceSheet: "Остатки" },
    ],
    operations: [{
      date: "2026-05-02",
      toChannel: "монобанк грн",
      currency: "UAH",
      amountNet: "10",
      balanceAmount: 10,
      amountUsd: "0.23",
      ledgerV2: {
        date: "2026-05-02",
        operation: "income",
        to_channel: "монобанк грн",
        currency: "UAH",
        amount_net: "10",
        balance_amount: 10,
        amount_usd: "0.23",
      },
    }],
    period: { from: "2026-05-01", to: "2026-05-31" },
  });

  const row = report.rows.find((entry) => entry.channel === "монобанк грн" && entry.currency === "UAH");
  assert.equal(report.owner_input_opening_total_usd, 24993);
  assert.equal(row.owner_input, 26670);
  assert.equal(row.implied_opening, 26670.14);
  assert.equal(row.adjusted_opening, 26670.14);
  assert.equal(row.reason, "rounding_or_fx");
  assert.equal(row.confidence, "high");
  assert.equal(report.adjusted_rows.some((entry) => entry.channel === "монобанк грн"), true);
});

test("reconciliation-adjusted May opening flags large Binance diff without auto-adjusting", () => {
  const report = buildReconciliationAdjustedMayOpening({
    ownerRows: [
      { inputChannel: "binance save", channel: "binance save", currency: "USDT", amount: 8519, amountUsd: 8519 },
    ],
    balanceRows: [
      { date: "2026-05-31", channel: "binance save", currency: "USDT", amount: "5411", amount_usd: "5411", sourceSheet: "Остатки" },
    ],
    operations: [],
    period: { from: "2026-05-01", to: "2026-05-31" },
  });

  const row = report.rows.find((entry) => entry.channel === "binance save" && entry.currency === "USDT");
  assert.equal(row.owner_input, 8519);
  assert.equal(row.implied_opening, 5411);
  assert.equal(row.adjusted_opening, 8519);
  assert.equal(row.reason, "needs_verification");
  assert.equal(row.confidence, "low");
  assert.equal(report.needs_verification_rows.length, 1);
});

test("May daily balance backfill uses reconciliation-adjusted opening when justified", async () => {
  const report = await buildBackfillDailyBalanceSnapshotsReport({
    from: "2026-05-01",
    to: "2026-05-03",
    now: new Date("2026-05-26T10:00:00.000Z"),
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", amount_usd: "254", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "603", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "8519", amount_usd: "8519", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount_usd: "1722", sourceSheet: "Остатки" },
        { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "26680.14", amount_usd: "603.0032", sourceSheet: "Остатки" },
      ],
      operations: [{
        date: "2026-05-02",
        toChannel: "монобанк грн",
        currency: "UAH",
        amountNet: "10",
        balanceAmount: 10,
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "монобанк грн",
          currency: "UAH",
          amount_net: "10",
          balance_amount: 10,
        },
      }],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
  });

  const row = report.planned_rows.find((entry) => entry.date === "2026-05-02" && entry.channel === "монобанк грн" && entry.currency === "UAH");
  assert.equal(report.merge_summary.owner_input_opening_total_usd, 24993);
  assert.equal(report.merge_summary.reconciliation_adjusted_opening.adjusted_rows.length, 1);
  assert.equal(row.amount, 26680.14);
});

test("audit snapshot exposes owner input total and adjusted opening total separately", async () => {
  const response = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [{
        date: "2026-05-02",
        toChannel: "монобанк грн",
        currency: "UAH",
        amountNet: "10",
        balanceAmount: 10,
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "монобанк грн",
          currency: "UAH",
          amount_net: "10",
          balance_amount: 10,
        },
      }],
      balances: [
        { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", amount_usd: "254", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "603", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "8519", amount_usd: "8519", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount_usd: "1722", sourceSheet: "Остатки" },
        { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "26680.14", amount_usd: "603.0032", sourceSheet: "Остатки" },
      ],
      autoBalances: [],
      commissionRows: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(response.balances.owner_confirmed_may_opening_total_usd, 24993);
  assert.equal(response.balances.owner_input_opening_total_usd, 24993);
  assert.equal(response.balances.reconciliation_adjusted_opening_total_usd > 24993, true);
  assert.equal(response.balances.adjusted_rows[0].reason, "rounding_or_fx");
});
