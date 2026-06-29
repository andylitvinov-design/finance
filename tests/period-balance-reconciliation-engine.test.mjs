import test from "node:test";
import assert from "node:assert/strict";
import { buildPeriodBalanceReconciliation } from "../server/period-balance-reconciliation-engine.js";

const period = { from: "2026-05-11", to: "2026-05-15" };
const balances = (closing = "1200") => [
  { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
  ...(closing === null ? [] : [{ date: "2026-05-15", channel: "wise usd", currency: "USD", amount: closing }]),
];
const income = (extra = {}) => ({
  date: "2026-05-11",
  toChannel: "wise usd",
  currency: "USD",
  amountNet: "300",
  balanceAmount: 300,
  ledgerV2: { date: "2026-05-11", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "300", balance_amount: 300 },
  ...extra,
  ledgerV2: { date: "2026-05-11", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "300", balance_amount: 300, ...(extra.ledgerV2 || {}) },
});
const expense = {
  date: "2026-05-12",
  fromChannel: "wise usd",
  currency: "USD",
  amountNet: "100",
  balanceAmount: -100,
  ledgerV2: { date: "2026-05-12", operation: "expense", from_channel: "wise usd", currency: "USD", amount_net: "100", balance_amount: -100 },
};

test("real period balance reconciles when fact equals opening plus real delta", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income(), expense], balanceRows: balances("1200") });
  const row = result.by_channel_currency[0];
  const reportRow = result.reconciliation_report[0];
  assert.equal(result.summary.status, "ok");
  assert.equal(row.status, "ok");
  assert.equal(row.real_delta, 200);
  assert.equal(row.opening_fact_balance, 1000);
  assert.equal(row.calculated_closing_balance, 1200);
  assert.equal(row.computed_real_closing_balance, 1200);
  assert.equal(row.manual_provider_closing_balance, 1200);
  assert.equal(row.manual_provider_closing_balance_date, "2026-05-15");
  assert.equal(row.manual_provider_fact_lookup_key, "2026-05-15|wise usd|USD");
  assert.equal(row.carried_forward_balance, null);
  assert.equal(row.displayed_fact_balance, 1200);
  assert.equal(row.factual_closing_balance, 1200);
  assert.equal(row.fact_source, "manual");
  assert.equal(row.can_write_to_ostatki, true);
  assert.equal(row.repair_action, "none");
  assert.equal(reportRow.channel, "wise usd");
  assert.equal(reportRow.currency, "USD");
  assert.equal(reportRow.opening_2026_05_01, 1000);
  assert.equal(reportRow.income_amount_net, 300);
  assert.equal(reportRow.expense_amount_net, 100);
  assert.equal(reportRow.transfer_in, 0);
  assert.equal(reportRow.transfer_out, 0);
  assert.equal(reportRow.exchange_delta, 0);
  assert.equal(reportRow.provider_adjustments, 0);
  assert.equal(reportRow.expected_later_balance, 1200);
  assert.equal(reportRow.confirmed_later_balance, 1200);
  assert.equal(reportRow.diff, 0);
  assert.equal(reportRow.status, "ok");
  assert.equal(reportRow.suspected_cause, "none");
});

test("canonical report fields use opening plus Ledger movement as planned end", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-21",
        fromChannel: "пейпал сad",
        currency: "CAD",
        amountNet: "19.50",
        balanceAmount: -19.5,
        ledgerV2: {
          date: "2026-05-21",
          operation: "expense",
          from_channel: "пейпал сad",
          currency: "CAD",
          amount_net: "19.50",
          balance_amount: -19.5,
        },
      },
      {
        date: "2026-05-10",
        toChannel: "Бинанс spot",
        currency: "USDC",
        amountNet: "0.54",
        amountUsd: "0.54",
        balanceAmount: 0.54,
        ledgerV2: {
          date: "2026-05-10",
          operation: "income",
          to_channel: "Бинанс spot",
          currency: "USDC",
          amount_net: "0.54",
          amount_usd: "0.54",
          balance_amount: 0.54,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "пейпал сad", currency: "CAD", amount: "19.50", sourceSheet: "Owner Evidence" },
      { date: "2026-05-27", channel: "пейпал сad", currency: "CAD", amount: "0", sourceSheet: "Owner Evidence" },
      { date: "2026-05-01", channel: "REVOLUT франк", currency: "CHF", amount: "15", amount_usd: "15", sourceSheet: "Owner Evidence" },
      { date: "2026-05-27", channel: "REVOLUT франк", currency: "CHF", amount: "15", sourceSheet: "Owner Evidence" },
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USDC", amount: "2.3777", amount_usd: "2.3777", sourceSheet: "Owner Evidence" },
      { date: "2026-05-27", channel: "Бинанс spot", currency: "USDC", amount: "2.9177", amount_usd: "2.9177", sourceSheet: "Owner Evidence" },
    ],
  });

  const cad = result.by_channel_currency.find((row) => row.channel === "пейпал сad");
  const chf = result.by_channel_currency.find((row) => row.channel === "REVOLUT франк");
  const usdc = result.by_channel_currency.find((row) => row.channel === "Бинанс spot");

  assert.equal(cad.opening_native, 19.5);
  assert.equal(cad.movement_native, -19.5);
  assert.equal(cad.planned_end_native, 0);
  assert.equal(cad.confirmed_end_native, 0);
  assert.equal(cad.diff_native, 0);
  assert.equal(cad.opening_usd, null);
  assert.equal(cad.movement_usd, null);
  assert.equal(cad.planned_end_usd, null);
  assert.equal(cad.confirmed_end_usd, 0);
  assert.equal(cad.diff_usd, null);
  assert.deepEqual(cad.fx_warnings, ["opening_usd_fx_missing", "movement_usd_fx_missing", "planned_end_usd_fx_missing", "diff_usd_fx_missing"]);

  assert.equal(chf.opening_native, 15);
  assert.equal(chf.movement_native, 0);
  assert.equal(chf.planned_end_native, 15);
  assert.equal(chf.confirmed_end_native, 15);
  assert.equal(chf.diff_native, 0);

  assert.equal(usdc.opening_native, 2.3777);
  assert.equal(usdc.movement_native, 0.54);
  assert.equal(usdc.planned_end_native, 2.9177);
  assert.equal(usdc.confirmed_end_native, 2.9177);
  assert.equal(usdc.diff_native, 0);
  assert.equal(usdc.opening_usd, 2.3777);
  assert.equal(usdc.movement_usd, 0.54);
  assert.equal(usdc.planned_end_usd, 2.9177);
  assert.equal(usdc.confirmed_end_usd, 2.9177);
  assert.equal(usdc.diff_usd, 0);
});

test("total USD row sums finite cells column-wise and counts fx_missing per column", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-10",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "20",
        amountUsd: "20",
        balanceAmount: 20,
        ledgerV2: {
          date: "2026-05-10",
          operation: "income",
          to_channel: "wise usd",
          currency: "USD",
          amount_net: "20",
          amount_usd: "20",
          balance_amount: 20,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", amount_usd: "7351" },
      { date: "2026-05-27", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100" },
      { date: "2026-05-27", channel: "wise usd", currency: "USD", amount: "120" },
    ],
  });

  const bankCanada = result.by_channel_currency.find((row) => row.channel === "БАНК КАНАДА cad");
  assert.equal(bankCanada.opening_usd, 7351);
  assert.equal(bankCanada.confirmed_end_usd, null);
  assert.equal(bankCanada.movement_usd, 0);
  assert.equal(bankCanada.diff_usd, null);
  assert.deepEqual(bankCanada.fx_warnings, ["confirmed_end_usd_fx_missing", "diff_usd_fx_missing"]);

  assert.equal(result.total_usd_row.opening_usd, 7451);
  assert.equal(result.total_usd_row.confirmed_end_usd, 120);
  assert.equal(result.total_usd_row.change_usd, 20);
  assert.equal(result.total_usd_row.movement_usd, 20);
  assert.equal(result.total_usd_row.diff_usd, 0);
  assert.equal(result.total_usd_row.fx_missing_start_rows, 0);
  assert.equal(result.total_usd_row.fx_missing_end_rows, 1);
  assert.equal(result.total_usd_row.fx_missing_change_rows, 1);
  assert.equal(result.total_usd_row.fx_missing_movement_rows, 0);
  assert.equal(result.total_usd_row.fx_missing_diff_rows, 1);
});

test("May owner evidence feeds PayPal screenshot openings and keeps Binance Save unresolved", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-05",
        fromChannel: "пейпал дол",
        currency: "USD",
        amountNet: "190.90",
        amountUsd: "190.90",
        balanceAmount: -190.9,
        ledgerV2: { date: "2026-05-05", operation: "expense", from_channel: "пейпал дол", currency: "USD", amount_net: "190.90", amount_usd: "190.90", balance_amount: -190.9 },
      },
      {
        date: "2026-05-08",
        fromChannel: "пейпал евр",
        currency: "EUR",
        amountNet: "175.25",
        balanceAmount: -175.25,
        ledgerV2: { date: "2026-05-08", operation: "expense", from_channel: "пейпал евр", currency: "EUR", amount_net: "175.25", balance_amount: -175.25 },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "пейпал евр", currency: "EUR", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "пейпал сad", currency: "CAD", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "8519", amount_usd: "8519", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", amount_usd: "254", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "603", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", amount_usd: "7351", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount: "145614", amount_usd: "1722", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "Payoneer - eur", currency: "EUR", amount: "1107", amount_usd: "1284", sourceSheet: "Остатки" },
      { date: "2026-05-27", channel: "пейпал дол", currency: "USD", amount: "35.30", amount_usd: "35.30", sourceSheet: "Остатки" },
      { date: "2026-05-27", channel: "пейпал евр", currency: "EUR", amount: "0", sourceSheet: "Остатки" },
      { date: "2026-05-27", channel: "пейпал сad", currency: "CAD", amount: "0", sourceSheet: "Остатки" },
      { date: "2026-05-27", channel: "binance save", currency: "USDT", amount: "5411.6278", amount_usd: "5411.6278", sourceSheet: "Авто Остатки" },
      { date: "2026-05-01", channel: "binance save", currency: "USDC", amount: "3107.3722", amount_usd: "3107.3722", sourceSheet: "Остатки" },
      { date: "2026-05-27", channel: "binance save", currency: "USDC", amount: "3107.3722", amount_usd: "3107.3722", sourceSheet: "Авто Остатки" },
    ],
  });

  const usd = result.by_channel_currency.find((row) => row.channel === "пейпал дол" && row.currency === "USD");
  const eur = result.by_channel_currency.find((row) => row.channel === "пейпал евр" && row.currency === "EUR");
  const cad = result.by_channel_currency.find((row) => row.channel === "пейпал сad" && row.currency === "CAD");
  const saveUsdt = result.by_channel_currency.find((row) => row.channel === "binance save" && row.currency === "USDT");
  const saveUsdc = result.by_channel_currency.find((row) => row.channel === "binance save" && row.currency === "USDC");

  assert.equal(usd.opening_native, 202.97);
  assert.equal(usd.confirmed_end_native, 12.07);
  assert.equal(usd.planned_end_native, 12.07);
  assert.equal(eur.opening_native, 175.25);
  assert.equal(eur.confirmed_end_native, 0);
  assert.equal(eur.planned_end_native, 0);
  assert.equal(cad.opening_native, 19.5);
  assert.equal(cad.confirmed_end_native, 0);
  assert.equal(saveUsdt.opening_native, 5411.6278);
  assert.equal(saveUsdt.confirmed_end_native, 5411.6278);
  assert.equal(saveUsdc.opening_native, 3107.3722);
  assert.equal(saveUsdc.confirmed_end_native, 3107.3722);
  assert.equal(saveUsdc.confirmed_end_usd, 3107.3722);
  assert.equal(saveUsdc.fx_warnings.includes("confirmed_end_usd_fx_missing"), false);
  assert.equal(Number.isFinite(saveUsdc.confirmed_end_usd), true);
  assert.equal(saveUsdt.opening_native + saveUsdc.opening_native, 8519);
});

test("May owner evidence keeps zero PayPal local closing balances as frozen USD zero", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-12",
        fromChannel: "пейпал евр",
        currency: "EUR",
        amountNet: "422.55",
        balanceAmount: -422.55,
        ledgerV2: { date: "2026-05-12", operation: "expense", from_channel: "пейпал евр", currency: "EUR", amount_net: "422.55", balance_amount: -422.55 },
      },
      {
        date: "2026-05-13",
        fromChannel: "пейпал сad",
        currency: "CAD",
        amountNet: "19.50",
        balanceAmount: -19.5,
        ledgerV2: { date: "2026-05-13", operation: "expense", from_channel: "пейпал сad", currency: "CAD", amount_net: "19.50", balance_amount: -19.5 },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "пейпал евр", currency: "EUR", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "пейпал сad", currency: "CAD", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
      { date: "2026-05-27", channel: "пейпал евр", currency: "EUR", amount: "0", sourceSheet: "Остатки" },
      { date: "2026-05-27", channel: "пейпал сad", currency: "CAD", amount: "0", sourceSheet: "Остатки" },
    ],
  });

  const eur = result.by_channel_currency.find((row) => row.channel === "пейпал евр" && row.currency === "EUR");
  const cad = result.by_channel_currency.find((row) => row.channel === "пейпал сad" && row.currency === "CAD");

  assert.equal(eur.confirmed_end_native, 0);
  assert.equal(eur.confirmed_end_usd, 0);
  assert.equal(cad.confirmed_end_native, 0);
  assert.equal(cad.confirmed_end_usd, 0);
  assert.equal(eur.fx_warnings.includes("confirmed_end_usd_fx_missing"), false);
  assert.equal(cad.fx_warnings.includes("confirmed_end_usd_fx_missing"), false);
});

test("total USD row sums only available frozen USD equivalents", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-02",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "25",
        amountUsd: "25",
        balanceAmount: 25,
        ledgerV2: { date: "2026-05-02", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "25", amount_usd: "25", balance_amount: 25 },
      },
      {
        date: "2026-05-02",
        toChannel: "cash cad",
        currency: "CAD",
        amountNet: "10",
        balanceAmount: 10,
        ledgerV2: { date: "2026-05-02", operation: "income", to_channel: "cash cad", currency: "CAD", amount_net: "10", balance_amount: 10 },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", amount_usd: "100" },
      { date: "2026-05-27", channel: "wise usd", currency: "USD", amount: "125", amount_usd: "125" },
      { date: "2026-05-01", channel: "cash cad", currency: "CAD", amount: "50" },
      { date: "2026-05-27", channel: "cash cad", currency: "CAD", amount: "60" },
    ],
  });

  assert.equal(result.total_usd_row.label, "ВСЕГО USD (partial)");
  assert.equal(result.total_usd_row.opening_usd, 100);
  assert.equal(result.total_usd_row.movement_usd, 25);
  assert.equal(result.total_usd_row.planned_end_usd, 125);
  assert.equal(result.total_usd_row.confirmed_end_usd, 125);
  assert.equal(result.total_usd_row.diff_usd, 0);
  assert.equal(result.total_usd_row.excluded_fx_missing_rows, 1);
  assert.equal(result.total_usd_row.total_coverage_status, "partial");
  assert.equal(result.total_usd_row.rows_excluded_from_usd_total, 1);
  assert.match(result.warnings.join("\n"), /fx_missing/);
  assert.deepEqual(result.reconciliation_report_summary.total_usd_row, result.total_usd_row);
});

test("balance snapshot rates provide frozen USD equivalents without recalculating movement USD", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-10",
        toChannel: "wise eur",
        currency: "EUR",
        amountNet: "10",
        amountUsd: "13",
        balanceAmount: 10,
        ledgerV2: {
          date: "2026-05-10",
          operation: "income",
          to_channel: "wise eur",
          currency: "EUR",
          amount_net: "10",
          amount_usd: "13",
          balance_amount: 10,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "wise eur", currency: "EUR", amount: "100", rate: "1.10" },
      { date: "2026-05-27", channel: "wise eur", currency: "EUR", amount: "120", rate: "1.20" },
      { date: "2026-05-01", channel: "cash cad", currency: "CAD", amount: "50", rate: "0.70" },
      { date: "2026-05-27", channel: "cash cad", currency: "CAD", amount: "50", rate: "0.75" },
      { date: "2026-05-01", channel: "mono uah", currency: "UAH", amount: "4300", rate: "0.025" },
      { date: "2026-05-27", channel: "mono uah", currency: "UAH", amount: "4300", rate: "0.026" },
      { date: "2026-05-01", channel: "yandex rub", currency: "RUB", amount: "10000", rate: "0.011" },
      { date: "2026-05-27", channel: "yandex rub", currency: "RUB", amount: "10000", rate: "0.012" },
      { date: "2026-05-01", channel: "revolut chf", currency: "CHF", amount: "20", rate: "1.25" },
      { date: "2026-05-27", channel: "revolut chf", currency: "CHF", amount: "20", rate: "1.30" },
      { date: "2026-05-01", channel: "explicit eur", currency: "EUR", amount: "10", rate: "9", amount_usd: "11" },
      { date: "2026-05-27", channel: "explicit eur", currency: "EUR", amount: "10", rate: "9", amount_usd: "12" },
      { date: "2026-05-01", channel: "missing eur", currency: "EUR", amount: "7" },
      { date: "2026-05-27", channel: "missing eur", currency: "EUR", amount: "7" },
      { date: "2026-05-01", channel: "stable usdt", currency: "USDT", amount: "3" },
      { date: "2026-05-27", channel: "stable usdt", currency: "USDT", amount: "3" },
    ],
  });

  const eur = result.by_channel_currency.find((row) => row.channel === "wise eur");
  assert.equal(eur.opening_usd, 110);
  assert.equal(eur.opening_fx_rate_to_usd, 1.1);
  assert.equal(eur.opening_fx_source, "snapshot_rate");
  assert.equal(eur.movement_usd, 13);
  assert.equal(eur.planned_end_usd, 123);
  assert.equal(eur.confirmed_end_usd, 144);
  assert.equal(eur.manual_provider_closing_balance_fx_rate_to_usd, 1.2);
  assert.equal(eur.manual_provider_closing_balance_fx_source, "snapshot_rate");
  assert.equal(eur.diff_usd, 21);
  assert.deepEqual(eur.fx_warnings, []);

  const cad = result.by_channel_currency.find((row) => row.channel === "cash cad");
  assert.equal(cad.opening_usd, 35);
  assert.equal(cad.confirmed_end_usd, 37.5);
  assert.deepEqual(cad.fx_warnings, []);

  const uah = result.by_channel_currency.find((row) => row.channel === "mono uah");
  assert.equal(uah.opening_usd, 107.5);
  assert.equal(uah.confirmed_end_usd, 111.8);

  const rub = result.by_channel_currency.find((row) => row.channel === "yandex rub");
  assert.equal(rub.opening_usd, 110);
  assert.equal(rub.confirmed_end_usd, 120);

  const chf = result.by_channel_currency.find((row) => row.channel === "revolut chf");
  assert.equal(chf.opening_usd, 25);
  assert.equal(chf.confirmed_end_usd, 26);

  const explicit = result.by_channel_currency.find((row) => row.channel === "explicit eur");
  assert.equal(explicit.opening_usd, 11);
  assert.equal(explicit.opening_fx_source, "explicit_snapshot_usd");
  assert.equal(explicit.confirmed_end_usd, 12);
  assert.equal(explicit.manual_provider_closing_balance_fx_source, "explicit_snapshot_usd");

  const missing = result.by_channel_currency.find((row) => row.channel === "missing eur");
  assert.equal(missing.opening_usd, null);
  assert.equal(missing.confirmed_end_usd, null);
  assert.deepEqual(missing.fx_warnings, ["opening_usd_fx_missing", "planned_end_usd_fx_missing", "confirmed_end_usd_fx_missing", "diff_usd_fx_missing"]);

  const stable = result.by_channel_currency.find((row) => row.channel === "stable usdt");
  assert.equal(stable.opening_usd, 3);
  assert.equal(stable.confirmed_end_usd, 3);

  assert.equal(result.total_usd_row.excluded_fx_missing_rows, 1);
  assert.equal(result.total_usd_row.fx_missing_start_rows, 1);
  assert.equal(result.total_usd_row.fx_missing_end_rows, 1);
  assert.equal(result.total_usd_row.movement_usd, 13);
});

test("FX Rates table provides frozen USD equivalents for exact balance dates", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-10",
        toChannel: "wise eur",
        currency: "EUR",
        amountNet: "10",
        amountUsd: "13",
        balanceAmount: 10,
        ledgerV2: {
          date: "2026-05-10",
          operation: "income",
          to_channel: "wise eur",
          currency: "EUR",
          amount_net: "10",
          amount_usd: "13",
          balance_amount: 10,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "wise eur", currency: "EUR", amount: "100" },
      { date: "2026-05-27", channel: "wise eur", currency: "EUR", amount: "120" },
      { date: "2026-05-01", channel: "missing cad", currency: "CAD", amount: "50" },
      { date: "2026-05-27", channel: "missing cad", currency: "CAD", amount: "50" },
    ],
    fxRates: [
      { date: "2026-05-01", currency: "EUR", base_currency: "USD", rate_to_usd: 1.1, source: "frankfurter", status: "ok" },
      { date: "2026-05-27", currency: "EUR", base_currency: "USD", rate_to_usd: 1.2, source: "frankfurter", status: "ok" },
      { date: "2026-05-26", currency: "CAD", base_currency: "USD", rate_to_usd: 0.72, source: "frankfurter", status: "ok" },
    ],
  });

  const eur = result.by_channel_currency.find((row) => row.channel === "wise eur");
  assert.equal(eur.opening_usd, 110);
  assert.equal(eur.movement_usd, 13);
  assert.equal(eur.planned_end_usd, 123);
  assert.equal(eur.confirmed_end_usd, 144);
  assert.equal(eur.diff_usd, 21);
  assert.equal(eur.opening_fx_source, "fx_rates");
  assert.equal(eur.opening_fx_rate_to_usd, 1.1);
  assert.equal(eur.opening_fx_rate_date, "2026-05-01");
  assert.equal(eur.manual_provider_closing_balance_fx_source, "fx_rates");
  assert.equal(eur.manual_provider_closing_balance_fx_rate_to_usd, 1.2);
  assert.equal(eur.manual_provider_closing_balance_fx_rate_date, "2026-05-27");
  assert.equal(eur.needs_fx_rate, false);
  assert.deepEqual(eur.fx_warnings, []);

  const missing = result.by_channel_currency.find((row) => row.channel === "missing cad");
  assert.equal(missing.opening_usd, null);
  assert.equal(missing.confirmed_end_usd, null);
  assert.equal(missing.needs_fx_rate, true);
  assert.equal(missing.opening_fx_status, "needs_fx_rate");
  assert.equal(missing.manual_provider_closing_balance_fx_status, "needs_fx_rate");
  assert.deepEqual(missing.fx_warnings, ["opening_usd_fx_missing", "planned_end_usd_fx_missing", "confirmed_end_usd_fx_missing", "diff_usd_fx_missing"]);
});

test("owner opening evidence uses frozen FX Rates instead of staying fx_missing", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-27" },
    operations: [
      {
        date: "2026-05-10",
        fromChannel: "пейпал евр",
        currency: "EUR",
        amountNet: "422.55",
        amountUsd: "490.158",
        balanceAmount: -422.55,
        ledgerV2: {
          date: "2026-05-10",
          operation: "expense",
          from_channel: "пейпал евр",
          currency: "EUR",
          amount_net: "422.55",
          amount_usd: "490.158",
          balance_amount: -422.55,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "пейпал евр", currency: "EUR", amount: "0", amount_usd: "0" },
      { date: "2026-05-27", channel: "пейпал евр", currency: "EUR", amount: "0", amount_usd: "0" },
    ],
    fxRates: [
      { date: "2026-05-01", currency: "EUR", base_currency: "USD", rate_to_usd: 1.1, source: "frankfurter", status: "ok" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "пейпал евр");
  assert.equal(row.opening_native, 175.25);
  assert.equal(row.opening_usd, 192.775);
  assert.equal(row.opening_fx_source, "fx_rates");
  assert.equal(row.opening_fx_rate_to_usd, 1.1);
  assert.equal(row.opening_fx_status, "ok");
  assert.equal(row.needs_fx_rate, false);
  assert.deepEqual(row.fx_warnings, []);
});

test("planned and real deltas are shown separately", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [income()],
    plannedRows: [
      { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: 500, operation: "income" },
      { date: "2026-05-12", channel: "wise usd", currency: "USD", amount: 100, operation: "expense" },
    ],
    balanceRows: balances("1300"),
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.planned_source_status, "ok");
  assert.equal(row.planned_delta, 400);
  assert.equal(row.real_delta, 300);
  assert.equal(row.plan_vs_real_delta, -100);
  assert.equal(result.by_currency[0].planned_delta, 400);
});

test("no movement with old observed balance requires target-date fact instead of using carry-forward as fact", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [], balanceRows: balances(null) });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.status_counts.ok, 0);
  assert.equal(result.summary.status_counts.mismatch, 0);
  assert.equal(result.summary.status_counts.carried_forward_conditional, 0);
  assert.equal(result.summary.status_counts.missing_provider_balance, 1);
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.carried_forward_balance, 1000);
  assert.equal(row.displayed_fact_balance, null);
  assert.equal(row.factual_closing_balance, null);
  assert.equal(row.factual_closing_balance_date, null);
  assert.equal(row.closing_balance_source, "missing");
  assert.equal(row.fact_source, "missing");
  assert.equal(row.factStatus, "missing");
  assert.match(row.repairHint, /add fact balance/);
  assert.equal(row.can_write_to_ostatki, false);
  assert.equal(row.repair_action, "enter_manual_provider_fact");
  assert.equal(row.real_difference, null);
  assert.equal(row.last_observed_closing_balance, 1000);
  assert.equal(row.last_observed_closing_balance_date, "2026-05-10");
  assert.match(row.fix_action, /фактический остаток/);
});

test("old in-period balance is reference-only when target-date fact is missing", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [],
    balanceRows: [
      { date: "2026-05-09", channel: "wise usd", currency: "USD", amount: "900" },
      { date: "2026-05-12", channel: "wise usd", currency: "USD", amount: "1000" },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.calculated_closing_balance, 900);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.carried_forward_balance, 1000);
  assert.equal(row.displayed_fact_balance, null);
  assert.equal(row.fact_source, "missing");
  assert.equal(row.real_difference, null);
  assert.equal(row.can_write_to_ostatki, false);
  assert.equal(row.repair_action, "enter_manual_provider_fact");
});

test("missing exact target-date provider balance with movements is blocked, not mismatch", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income()], balanceRows: balances(null) });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.status_counts.ok, 0);
  assert.equal(result.summary.status_counts.mismatch, 0);
  assert.equal(result.summary.status_counts.missing_provider_balance, 1);
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.calculated_closing_balance, 1300);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.manual_provider_fact_lookup_key, "2026-05-15|wise usd|USD");
  assert.equal(row.nearest_manual_provider_fact_date, "2026-05-10");
  assert.equal(row.nearest_manual_provider_fact_amount, 1000);
  assert.match(row.missing_fact_reason, /period end is 2026-05-15/);
  assert.equal(row.carried_forward_balance, null);
  assert.equal(row.displayed_fact_balance, null);
  assert.equal(row.factual_closing_balance, null);
  assert.equal(row.fact_source, "missing");
  assert.equal(row.can_write_to_ostatki, false);
  assert.equal(row.repair_action, "enter_manual_provider_fact");
  assert.match(row.diagnosis, /Нет фактического остатка на дату/);
});

test("USD-only Остатки row is not used as native provider fact", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [{
      date: "2026-05-12",
      toChannel: "paypal eur",
      currency: "EUR",
      amountNet: "20",
      balanceAmount: 20,
      ledgerV2: { date: "2026-05-12", operation: "income", to_channel: "paypal eur", currency: "EUR", amount_net: "20", balance_amount: 20 },
    }],
    balanceRows: [
      { date: "2026-05-10", channel: "paypal eur", currency: "EUR", amount_native: 100, amount_usd: 110, value_type: "native_and_usd" },
      { date: "2026-05-15", channel: "paypal eur", currency: "EUR", amount_native: null, amount_usd: 132, value_type: "usd_only_needs_native" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.opening_fact_balance, 100);
  assert.equal(row.calculated_closing_balance, 120);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.needs_native_currency_value, true);
  assert.equal(row.opening_fact_value_type, "native_and_usd");
  assert.equal(row.manual_provider_fact_value_type, "usd_only_needs_native");
  assert.match(row.native_fact_missing_reason, /USD equivalent only/);
  assert.equal(row.missing_fact_reason, row.native_fact_missing_reason);
  assert.equal(row.diagnostics.needs_native_currency_value, true);
  assert.equal(row.diagnostics.manual_provider_fact_value_type, "usd_only_needs_native");
  assert.equal(row.diagnostics.native_fact_missing_reason, row.native_fact_missing_reason);
  assert(row.diagnostics.categories.includes("missing native currency balance"));
});

test("explicit zero Остатки row is a valid native provider fact", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [{
      date: "2026-05-12",
      fromChannel: "paypal eur",
      currency: "EUR",
      amountNet: "100",
      balanceAmount: -100,
      ledgerV2: { date: "2026-05-12", operation: "expense", from_channel: "paypal eur", currency: "EUR", amount_net: "100", balance_amount: -100 },
    }],
    balanceRows: [
      { date: "2026-05-10", channel: "paypal eur", currency: "EUR", amount: "100" },
      { date: "2026-05-15", channel: "paypal eur", currency: "EUR", amount: "0" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.manual_provider_closing_balance, 0);
  assert.equal(row.manual_provider_fact_value_type, "explicit_zero");
  assert.equal(row.needs_native_currency_value, false);
});

test("calculated balance fallback fills period-end fact when exact manual/provider fact is missing", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-04-22", to: "2026-05-21" },
    operations: [
      {
        date: "2026-05-21",
        fromChannel: "монобанк грн",
        currency: "UAH",
        amountNet: "1330",
        balanceAmount: -1330,
        ledgerV2: {
          date: "2026-05-21",
          operation: "expense",
          from_channel: "монобанк грн",
          currency: "UAH",
          amount_net: "1330",
          balance_amount: -1330,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "13033.14", balanceSource: "manual_fact" },
    ],
    calculatedBalanceRows: [
      { date: "2026-05-21", channel: "монобанк грн", currency: "UAH", amount: "11703.14", balanceSource: "calculated_balance", source: "calculated", sourceSheet: "Расчетные Остатки" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "calculated_from_previous");
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.factual_closing_balance, 11703.14);
  assert.equal(row.fact_source, "calculated");
  assert.equal(row.fact_status, "calculated_from_previous");
  assert.equal(row.balanceSource, "calculated_balance");
  assert.equal(row.needsManualConfirmation, false);
  assert.equal(row.missing_amount_net_rows, 0);
});

test("manual period-end fact wins over calculated balance fallback", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [income()],
    balanceRows: [
      { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000", balanceSource: "manual_fact" },
      { date: "2026-05-15", channel: "wise usd", currency: "USD", amount: "1300", balanceSource: "manual_fact" },
    ],
    calculatedBalanceRows: [
      { date: "2026-05-15", channel: "wise usd", currency: "USD", amount: "9999", balanceSource: "calculated_balance", source: "calculated" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.manual_provider_closing_balance, 1300);
  assert.equal(row.factual_closing_balance, 1300);
  assert.equal(row.fact_source, "manual");
  assert.equal(row.balanceSource, "manual_fact");
});

test("no opening, no movement, no fact, and no plan is ignored as no data", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [],
    plannedRows: [],
    balanceRows: [{ date: "2026-05-12", channel: "empty usd", currency: "USD", amount: "100" }],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "ok");
  assert.equal(result.summary.status_counts.no_data, 1);
  assert.equal(result.summary.status_counts.missing_provider_balance, 0);
  assert.equal(result.actionable_rows.length, 0);
  assert.equal(row.status, "no_data");
  assert.equal(row.fact_source, "missing");
  assert.equal(row.repair_action, "ignore_no_data");
});

test("exact closing balance remains authoritative over carried-forward fallback", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [], balanceRows: balances("1001") });
  const row = result.by_channel_currency[0];
  assert.equal(row.status, "mismatch");
  assert.equal(row.factual_closing_balance, 1001);
  assert.equal(row.factual_closing_balance_date, "2026-05-15");
  assert.equal(row.closing_balance_source, "exact");
  assert.equal(row.real_difference, 1);
});

test("mismatch shows factual minus computed real difference", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income()], balanceRows: balances("1290") });
  const row = result.by_channel_currency[0];
  const reportRow = result.reconciliation_report[0];
  assert.equal(result.summary.status, "failed");
  assert.equal(row.status, "mismatch");
  assert.equal(row.computed_real_closing_balance, 1300);
  assert.equal(row.real_difference, -10);
  assert.equal(reportRow.expected_later_balance, 1300);
  assert.equal(reportRow.confirmed_later_balance, 1290);
  assert.equal(reportRow.diff, -10);
  assert.equal(reportRow.suspected_cause, "missing_or_extra_ledger_movement");
});

test("reconciliation report classifies transfers per channel while keeping total neutral", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [
      {
        date: "2026-05-10",
        fromChannel: "wise usd",
        toChannel: "paypal usd",
        currency: "USD",
        amountNet: "100",
        balanceAmount: -100,
        ledgerV2: {
          date: "2026-05-10",
          operation: "transfer",
          from_channel: "wise usd",
          to_channel: "paypal usd",
          currency: "USD",
          amount_net: "100",
          balance_amount: -100,
        },
      },
      {
        date: "2026-05-10",
        fromChannel: "wise usd",
        toChannel: "paypal usd",
        currency: "USD",
        amountNet: "100",
        balanceAmount: 100,
        ledgerV2: {
          date: "2026-05-10",
          operation: "transfer",
          from_channel: "wise usd",
          to_channel: "paypal usd",
          currency: "USD",
          amount_net: "100",
          balance_amount: 100,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "500" },
      { date: "2026-05-31", channel: "wise usd", currency: "USD", amount: "400" },
      { date: "2026-05-01", channel: "paypal usd", currency: "USD", amount: "50" },
      { date: "2026-05-31", channel: "paypal usd", currency: "USD", amount: "150" },
    ],
  });

  const wise = result.reconciliation_report.find((row) => row.channel === "wise usd");
  const paypal = result.reconciliation_report.find((row) => row.channel === "paypal usd");
  assert.equal(wise.transfer_out, 100);
  assert.equal(wise.transfer_in, 0);
  assert.equal(wise.expected_later_balance, 400);
  assert.equal(paypal.transfer_in, 100);
  assert.equal(paypal.transfer_out, 0);
  assert.equal(paypal.expected_later_balance, 150);
  assert.equal(result.reconciliation_report_summary.transfer_net, 0);
  assert.equal(result.reconciliation_report_summary.owner_confirmed_opening_2026_05_01_total_usd, 24993);
});

test("single-row transfers synthesize the receiving channel in the report", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [
      {
        date: "2026-05-10",
        fromChannel: "wise usd",
        toChannel: "paypal usd",
        currency: "USD",
        amountNet: "100",
        balanceAmount: -100,
        ledgerV2: {
          date: "2026-05-10",
          operation: "transfer",
          from_channel: "wise usd",
          to_channel: "paypal usd",
          currency: "USD",
          amount_net: "100",
          amount_usd: "100",
          balance_amount: -100,
          transfer_group_id: "transfer-1",
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "500" },
      { date: "2026-05-31", channel: "wise usd", currency: "USD", amount: "400" },
      { date: "2026-05-01", channel: "paypal usd", currency: "USD", amount: "50" },
      { date: "2026-05-31", channel: "paypal usd", currency: "USD", amount: "150" },
    ],
  });

  const wise = result.reconciliation_report.find((row) => row.channel === "wise usd");
  const paypal = result.reconciliation_report.find((row) => row.channel === "paypal usd");
  assert.equal(wise.transfer_out, 100);
  assert.equal(wise.expected_later_balance, 400);
  assert.equal(paypal.transfer_in, 100);
  assert.equal(paypal.expected_later_balance, 150);
  assert.equal(result.reconciliation_report_summary.transfer_net, 0);
});

test("May reconciliation report exposes owner input and adjusted opening totals", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
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
    balanceRows: [
      { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "603", sourceSheet: "Owner Confirmed" },
      { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "26680.14", amount_usd: "603.0032", sourceSheet: "Остатки" },
    ],
  });

  const summary = result.reconciliation_report_summary;
  const mono = summary.opening_adjustment_rows.find((row) => row.channel === "монобанк грн");
  assert.equal(summary.owner_input_opening_total_usd, 24993);
  assert.equal(summary.reconciliation_adjusted_opening_total_usd > 24993, true);
  assert.equal(mono.owner_input, 26670);
  assert.equal(mono.implied_opening, 26670.14);
  assert.equal(mono.adjusted_opening, 26670.14);
  assert.equal(mono.reason, "rounding_or_fx");
});

test("May reconciliation summary exposes PayPal pending candidates and movement row diagnostics", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [
      {
        date: "2026-05-10",
        source: "paypal",
        sourceRow: 501,
        fromChannel: "пейпал дол",
        currency: "USD",
        amountNet: "-833.39",
        balanceAmount: -833.39,
        raw_source_id: "paypal-usd-501",
        counterparty: "PayPal USD movement",
        description: "PayPal USD movement",
        ledgerV2: {
          date: "2026-05-10",
          operation: "expense",
          from_channel: "пейпал дол",
          currency: "USD",
          amount_net: "-833.39",
          amount_gross: "-850",
          amount_fee: "-16.61",
          balance_amount: -833.39,
          raw_source_id: "paypal-usd-501",
          counterparty: "PayPal USD movement",
          description: "PayPal USD movement",
        },
      },
      {
        date: "2026-05-11",
        source: "paypal",
        sourceRow: 502,
        fromChannel: "пейпал евр",
        currency: "EUR",
        amountNet: "-422.55",
        balanceAmount: -422.55,
        raw_source_id: "paypal-eur-502",
        ledgerV2: {
          date: "2026-05-11",
          operation: "expense",
          from_channel: "пейпал евр",
          currency: "EUR",
          amount_net: "-422.55",
          balance_amount: -422.55,
          raw_source_id: "paypal-eur-502",
        },
      },
      {
        date: "2026-05-12",
        source: "paypal",
        sourceRow: 503,
        fromChannel: "пейпал сad",
        currency: "CAD",
        amountNet: "-19.50",
        balanceAmount: -19.5,
        raw_source_id: "paypal-cad-503",
        ledgerV2: {
          date: "2026-05-12",
          operation: "expense",
          from_channel: "пейпал сad",
          currency: "CAD",
          amount_net: "-19.50",
          balance_amount: -19.5,
          raw_source_id: "paypal-cad-503",
        },
      },
      {
        date: "2026-05-13",
        source: "paypal",
        sourceRow: 504,
        fromChannel: "пейпал дол",
        currency: "USD",
        amountNet: "0",
        balanceAmount: 0,
        raw_source_id: "paypal-usd-504",
        ledgerV2: {
          date: "2026-05-13",
          operation: "expense",
          from_channel: "пейпал дол",
          currency: "USD",
          amount_net: "0",
          balance_amount: 0,
          raw_source_id: "paypal-usd-504",
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-31", channel: "пейпал дол", currency: "USD", amount: "35.30", amount_usd: "35.30", sourceSheet: "Остатки" },
      { date: "2026-05-31", channel: "пейпал евр", currency: "EUR", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
      { date: "2026-05-31", channel: "пейпал сad", currency: "CAD", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
    ],
  });

  const summary = result.reconciliation_report_summary;
  const usd = summary.opening_adjustment_rows.find((row) => row.channel === "пейпал дол" && row.currency === "USD");

  assert.equal(usd.planned_opening_candidate, 868.69);
  assert.equal(usd.status, "pending_movement_verification");
  assert.equal(usd.adjusted_opening, 435);
  assert.deepEqual(summary.paypal_movement_diagnostics.map((row) => row.source_row), [501, 504, 502, 503]);
  assert.equal(summary.paypal_movement_diagnostics.find((row) => row.source_row === 501).included_in_paypal_movement_sum, true);
  assert.equal(summary.paypal_movement_diagnostics.find((row) => row.source_row === 501).gross, -850);
  assert.equal(summary.paypal_movement_diagnostics.find((row) => row.source_row === 501).fee, -16.61);
  assert.equal(summary.paypal_movement_diagnostics.find((row) => row.source_row === 501).net, -833.39);
});

test("reconciliation report detects likely channel alias mismatch", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [
      {
        date: "2026-05-11",
        toChannel: "Wise USD",
        currency: "USD",
        amountNet: "50",
        balanceAmount: 50,
        ledgerV2: {
          date: "2026-05-11",
          operation: "income",
          to_channel: "Wise USD",
          currency: "USD",
          amount_net: "50",
          balance_amount: 50,
        },
      },
    ],
    balanceRows: balances("1050"),
  });

  const row = result.reconciliation_report.find((entry) => entry.channel === "Wise USD");
  assert.equal(row.status, "missing_opening_balance");
  assert.equal(row.suspected_cause, "channel_alias_mismatch");
  assert.equal(row.alias_candidate, "wise usd");
});

test("reconciliation report keeps native balances separate from USD equivalents", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [
      {
        date: "2026-05-02",
        fromChannel: "монобанк грн",
        currency: "UAH",
        amountNet: "100",
        amountUsd: "2.5",
        balanceAmount: -100,
        ledgerV2: {
          date: "2026-05-02",
          operation: "expense",
          from_channel: "монобанк грн",
          currency: "UAH",
          amount_net: "100",
          amount_usd: "2.5",
          balance_amount: -100,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "1000", amount_usd: "25" },
      { date: "2026-05-31", channel: "монобанк грн", currency: "UAH", amount: "900", amount_usd: "22.5" },
    ],
  });

  const row = result.reconciliation_report[0];
  assert.equal(row.opening_2026_05_01, 1000);
  assert.equal(row.opening_2026_05_01_usd, 25);
  assert.equal(row.expense_amount_net, 100);
  assert.equal(row.expense_amount_usd, 2.5);
  assert.equal(row.expected_later_balance, 900);
  assert.equal(row.expected_later_balance_usd, 22.5);
  assert.equal(row.confirmed_later_balance, 900);
  assert.equal(row.confirmed_later_balance_usd, 22.5);
});

test("real reconciliation includes movements after the opening snapshot even when selected period starts later", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-17", to: "2026-05-17" },
    operations: [
      {
        date: "2026-05-16",
        fromChannel: "трансервайз дол",
        currency: "USD",
        amountNet: "726.13",
        balanceAmount: -726.13,
        ledgerV2: {
          date: "2026-05-16",
          operation: "expense",
          from_channel: "трансервайз дол",
          currency: "USD",
          amount_net: "726.13",
          balance_amount: -726.13,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-15", channel: "трансервайз дол", currency: "USD", amount: "1796.61" },
      { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "1070.48" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.opening_balance_date, "2026-05-15");
  assert.equal(row.real_outflow, 726.13);
  assert.equal(row.movement_rows, 1);
  assert.equal(row.computed_real_closing_balance, 1070.48);
  assert.equal(row.real_difference, 0);
});

test("period-start snapshot is opening balance and same-day movement is excluded", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-03" },
    operations: [
      {
        date: "2026-05-01",
        toChannel: "трансервайз евро",
        currency: "EUR",
        amountNet: "200",
        balanceAmount: 200,
        ledgerV2: {
          date: "2026-05-01",
          operation: "income",
          to_channel: "трансервайз евро",
          currency: "EUR",
          amount_net: "200",
          balance_amount: 200,
        },
      },
      {
        date: "2026-05-02",
        toChannel: "трансервайз евро",
        currency: "EUR",
        amountNet: "50",
        balanceAmount: 50,
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "трансервайз евро",
          currency: "EUR",
          amount_net: "50",
          balance_amount: 50,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "трансервайз евро", currency: "EUR", amount: "1000" },
      { date: "2026-05-03", channel: "трансервайз евро", currency: "EUR", amount: "1050" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.opening_balance, 1000);
  assert.equal(row.opening_balance_date, "2026-05-01");
  assert.equal(row.real_delta, 50);
  assert.equal(row.movement_rows, 1);
  assert.equal(row.calculated_closing_balance, 1050);
  assert.equal(row.real_difference, 0);
});

test("EOD opening excludes same-day Binance Pay movement after snapshot", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-20" },
    operations: [
      {
        date: "2026-05-01",
        fromChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "700",
        balanceAmount: -700,
        ledgerV2: {
          date: "2026-05-01",
          operation: "expense",
          from_channel: "Бинанс spot",
          currency: "USDT",
          amount_net: "700",
          balance_amount: -700,
        },
      },
      {
        date: "2026-05-02",
        toChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "100",
        balanceAmount: 100,
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "Бинанс spot",
          currency: "USDT",
          amount_net: "100",
          balance_amount: 100,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USDT", amount: "1093", source: "manual_confirmed_balance" },
      { date: "2026-05-20", channel: "Бинанс spot", currency: "USDT", amount: "1193", source: "manual_confirmed_balance" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.opening_balance_date, "2026-05-01");
  assert.equal(row.opening_balance, 1093);
  assert.equal(row.real_delta, 100);
  assert.equal(row.movement_rows, 1);
  assert.equal(row.calculated_closing_balance, 1193);
});

test("same-day period uses previous EOD opening and target date as EOD closing", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-01" },
    operations: [
      {
        date: "2026-05-01",
        fromChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "700",
        balanceAmount: -700,
        ledgerV2: {
          date: "2026-05-01",
          operation: "expense",
          from_channel: "Бинанс spot",
          currency: "USDT",
          amount_net: "700",
          balance_amount: -700,
        },
      },
    ],
    balanceRows: [
      { date: "2026-04-30", channel: "Бинанс spot", currency: "USDT", amount: "1793", source: "manual_confirmed_balance" },
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USDT", amount: "1093", source: "manual_confirmed_balance" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.opening_balance_date, "2026-04-30");
  assert.equal(row.opening_balance, 1793);
  assert.equal(row.real_delta, -700);
  assert.equal(row.calculated_closing_balance, 1093);
  assert.equal(row.factual_closing_balance, 1093);
});

test("Binance USDT opening facts do not use USD rows as USDT facts", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-20" },
    operations: [
      {
        date: "2026-05-02",
        toChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "100",
        balanceAmount: 100,
        ledgerV2: { date: "2026-05-02", operation: "income", to_channel: "Бинанс spot", currency: "USDT", amount_net: "100", balance_amount: 100 },
      },
      {
        date: "2026-05-02",
        toChannel: "binance save",
        currency: "USDT",
        amountNet: "10",
        balanceAmount: 10,
        ledgerV2: { date: "2026-05-02", operation: "income", to_channel: "binance save", currency: "USDT", amount_net: "10", balance_amount: 10 },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USD", amount: "9999", source: "stale" },
      { date: "2026-05-01", channel: "binance save", currency: "USD", amount: "8769", source: "stale" },
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USDT", amount: "1093", source: "manual_confirmed_balance" },
      { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "7432", source: "manual_confirmed_balance" },
      { date: "2026-05-20", channel: "Бинанс spot", currency: "USDT", amount: "1193", source: "manual_confirmed_balance" },
      { date: "2026-05-20", channel: "binance save", currency: "USDT", amount: "7442", source: "manual_confirmed_balance" },
    ],
  });

  const spot = result.by_channel_currency.find((row) => row.channel === "Бинанс spot" && row.currency === "USDT");
  const save = result.by_channel_currency.find((row) => row.channel === "binance save" && row.currency === "USDT");

  assert.equal(spot.opening_balance_date, "2026-05-01");
  assert.equal(spot.opening_balance, 1093);
  assert.equal(spot.status, "ok");
  assert.equal(save.opening_balance_date, "2026-05-01");
  assert.equal(save.opening_balance, 7432);
  assert.equal(save.status, "ok");
});

test("manual confirmed opening outranks stale same-date balance rows", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-20" },
    operations: [
      {
        date: "2026-05-02",
        toChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "100",
        balanceAmount: 100,
        ledgerV2: { date: "2026-05-02", operation: "income", to_channel: "Бинанс spot", currency: "USDT", amount_net: "100", balance_amount: 100 },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USDT", amount: "1093", source: "manual_confirmed_balance" },
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USDT", amount: "1090", source: "provider_auto", sourceSheet: "Авто Остатки" },
      { date: "2026-05-20", channel: "Бинанс spot", currency: "USDT", amount: "1193", source: "manual_confirmed_balance" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.opening_balance, 1093);
  assert.equal(row.calculated_closing_balance, 1193);
  assert.equal(row.status, "ok");
});

test("day-after period still uses previous-day snapshot and includes period movement", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-02", to: "2026-05-03" },
    operations: [
      {
        date: "2026-05-01",
        toChannel: "трансервайз евро",
        currency: "EUR",
        amountNet: "200",
        balanceAmount: 200,
        ledgerV2: {
          date: "2026-05-01",
          operation: "income",
          to_channel: "трансервайз евро",
          currency: "EUR",
          amount_net: "200",
          balance_amount: 200,
        },
      },
      {
        date: "2026-05-02",
        toChannel: "трансервайз евро",
        currency: "EUR",
        amountNet: "50",
        balanceAmount: 50,
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "трансервайз евро",
          currency: "EUR",
          amount_net: "50",
          balance_amount: 50,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "трансервайз евро", currency: "EUR", amount: "1000" },
      { date: "2026-05-03", channel: "трансервайз евро", currency: "EUR", amount: "1050" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.opening_balance, 1000);
  assert.equal(row.opening_balance_date, "2026-05-01");
  assert.equal(row.real_delta, 50);
  assert.equal(row.movement_rows, 1);
  assert.equal(row.calculated_closing_balance, 1050);
});

test("missing period-start opening still reports missing opening balance", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-03" },
    operations: [
      {
        date: "2026-05-02",
        toChannel: "трансервайз евро",
        currency: "EUR",
        amountNet: "50",
        balanceAmount: 50,
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "трансервайз евро",
          currency: "EUR",
          amount_net: "50",
          balance_amount: 50,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-03", channel: "трансервайз евро", currency: "EUR", amount: "1050" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.status, "missing_opening_balance");
  assert.equal(row.opening_balance, null);
  assert.equal(row.opening_balance_date, null);
  assert.equal(row.computed_status, "missing_opening_balance");
});

test("empty amount_net makes reconciliation failed", () => {
  const result = buildPeriodBalanceReconciliation({ period, operations: [income({ amountNet: "", ledgerV2: { amount_net: "" } })], balanceRows: balances("1300") });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.missing_amount_net_rows, 1);
  assert.equal(row.status, "missing_amount_net");
  assert.match(row.fix_action, /amount_net/);
  assert(row.diagnostics.categories.includes("amount_net issue"));
});

test("Wise USD true mismatch remains visible when exact target provider balance exists", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-17" },
    operations: [
      {
        date: "2026-05-03",
        toChannel: "трансервайз дол",
        currency: "USD",
        amountNet: "313.30",
        balanceAmount: 313.3,
        ledgerV2: { date: "2026-05-03", operation: "income", to_channel: "трансервайз дол", currency: "USD", amount_net: "313.30", balance_amount: 313.3 },
      },
      {
        date: "2026-05-10",
        fromChannel: "трансервайз дол",
        currency: "USD",
        amountNet: "1939.21",
        balanceAmount: -1939.21,
        ledgerV2: { date: "2026-05-10", operation: "expense", from_channel: "трансервайз дол", currency: "USD", amount_net: "1939.21", balance_amount: -1939.21 },
      },
    ],
    balanceRows: [
      { date: "2026-04-30", channel: "трансервайз дол", currency: "USD", amount: "2704.25" },
      { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "1070.48" },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "failed");
  assert.equal(row.status, "mismatch");
  assert.equal(row.computed_real_closing_balance, 1078.34);
  assert.equal(row.factual_closing_balance, 1070.48);
  assert.equal(row.real_difference, -7.86);
  assert.deepEqual(row.diagnostics.categories, ["missing ledger movement", "fee/net mismatch", "sign/direction issue", "amount_net issue"]);
});

test("auto fact on target date is auto_pending and preserves mismatch diff", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-19" },
    operations: [
      {
        date: "2026-05-03",
        fromChannel: "трансервайз дол",
        currency: "USD",
        amountNet: "1848.82",
        balanceAmount: -1848.82,
        ledgerV2: { date: "2026-05-03", operation: "expense", from_channel: "трансервайз дол", currency: "USD", amount_net: "1848.82", balance_amount: -1848.82 },
      },
    ],
    balanceRows: [
      { date: "2026-04-30", channel: "трансервайз дол", currency: "USD", amount: "2704.25", source: "manual_fact" },
      { date: "2026-05-19", channel: "трансервайз дол", currency: "USD", amount: "849.66", source: "provider_auto", sourceSheet: "Авто Остатки", sourceRow: 12 },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(row.status, "mismatch");
  assert.equal(row.factStatus, "auto_pending");
  assert.equal(row.fact_balance.warning, "needs manual confirmation");
  assert.equal(row.computed_real_closing_balance, 855.43);
  assert.equal(row.factual_closing_balance, 849.66);
  assert.equal(row.real_difference, -5.77);
});

test("manual fact on target date wins over old opening/start balance", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-19" },
    operations: [],
    balanceRows: [
      { date: "2026-04-30", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "10107.92", source: "manual_fact" },
      { date: "2026-05-19", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "10107.92", source: "manual_fact" },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(row.status, "ok");
  assert.equal(row.factStatus, "confirmed");
  assert.equal(row.factual_closing_balance, 10107.92);
  assert.equal(row.factual_closing_balance_date, "2026-05-19");
  assert.equal(row.real_difference, 0);
});

test("PayPal EUR missing amount_net blocks without gross-as-net substitution", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [
      {
        date: "2026-05-12",
        fromChannel: "пейпал евр",
        currency: "EUR",
        amountGross: "100",
        amountNet: "",
        balanceAmount: -100,
        source: "paypal",
        ledgerV2: { date: "2026-05-12", operation: "expense", source: "paypal", from_channel: "пейпал евр", currency: "EUR", amount_gross: "100", amount_fee: "", amount_net: "", balance_amount: -100 },
      },
    ],
    balanceRows: [
      { date: "2026-05-10", channel: "пейпал евр", currency: "EUR", amount: "0" },
      { date: "2026-05-15", channel: "пейпал евр", currency: "EUR", amount: "-100" },
    ],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(row.status, "missing_amount_net");
  assert.equal(row.real_outflow, 0);
  assert.equal(row.missing_amount_net_rows, 1);
  assert.match(result.warnings.join(" "), /provider permission/);
});

test("Binance spot USDT movement without manual/provider fact reports missing provider balance", () => {
  const result = buildPeriodBalanceReconciliation({
    period,
    operations: [
      {
        date: "2026-05-12",
        toChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "103",
        balanceAmount: 103,
        ledgerV2: { date: "2026-05-12", operation: "income", to_channel: "Бинанс spot", currency: "USDT", amount_net: "103", balance_amount: 103 },
      },
    ],
    balanceRows: [],
  });
  const row = result.by_channel_currency[0];
  assert.equal(result.summary.status, "blocked");
  assert.equal(row.status, "missing_opening_balance");
  assert.equal(row.computedStatus, "missing_opening_balance");
  assert.equal(row.factStatus, "missing");
  assert.equal(row.opening_fact_balance, null);
  assert.equal(row.manual_provider_closing_balance, null);
  assert.equal(row.fact_source, "missing");
  assert.match(row.fix_action, /Остатки до начала/);
});

test("opening and closing reconciliation use native amount, not amount_usd", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-02", to: "2026-05-03" },
    operations: [
      {
        date: "2026-05-02",
        fromChannel: "приват 24-грн",
        currency: "UAH",
        amountNet: "239",
        balanceAmount: -239,
        ledgerV2: {
          date: "2026-05-02",
          operation: "expense",
          from_channel: "приват 24-грн",
          currency: "UAH",
          amount_net: "239",
          balance_amount: -239,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", usdAmount: "254" },
      { date: "2026-05-03", channel: "приват 24-грн", currency: "UAH", amount: "11000", usdAmount: "248" },
    ],
  });

  const row = result.by_channel_currency[0];
  assert.equal(row.opening_fact_balance, 11239);
  assert.equal(row.real_outflow, 239);
  assert.equal(row.computed_real_closing_balance, 11000);
  assert.equal(row.factual_closing_balance, 11000);
  assert.equal(row.status, "ok");
});

test("Revolut 2026-05-21 reconciliation includes USD EUR GBP and CHF manual balances", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-21", to: "2026-05-21" },
    operations: [],
    balanceRows: [
      { date: "2026-05-21", channel: "REVOLUT фунт", currency: "GBP", amount: "0", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT евро", currency: "EUR", amount: "110.74", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT франк", currency: "CHF", amount: "15", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT дол", currency: "USD", amount: "18.38", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
    ],
  });

  assert.deepEqual(
    result.by_channel_currency.map((row) => `${row.channel}|${row.currency}|${row.factual_closing_balance}|${row.factStatus}`).sort(),
    [
      "REVOLUT дол|USD|18.38|confirmed",
      "REVOLUT евро|EUR|110.74|confirmed",
      "REVOLUT франк|CHF|15|confirmed",
      "REVOLUT фунт|GBP|0|confirmed",
    ]
  );
});

test("May reconciliation summary uses Revolut currency-split openings instead of old combined 378", () => {
  const operations = [
    {
      date: "2026-05-05",
      fromChannel: "REVOLUT евро",
      currency: "EUR",
      amountNet: "100",
      balanceAmount: -100,
      ledgerV2: {
        date: "2026-05-05",
        operation: "expense",
        from_channel: "REVOLUT евро",
        currency: "EUR",
        amount_net: "100",
        balance_amount: -100,
      },
    },
    {
      date: "2026-05-20",
      fromChannel: "REVOLUT евро",
      currency: "EUR",
      amountNet: "2.74",
      balanceAmount: -2.74,
      ledgerV2: {
        date: "2026-05-20",
        operation: "expense",
        from_channel: "REVOLUT евро",
        currency: "EUR",
        amount_net: "2.74",
        balance_amount: -2.74,
      },
    },
  ];
  const originalOperations = structuredClone(operations);
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations,
    balanceRows: [
      { date: "2026-05-21", channel: "REVOLUT дол", currency: "USD", amount: "18.38", amount_usd: "18.38", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT евро", currency: "EUR", amount: "110.74", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT франк", currency: "CHF", amount: "15", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT фунт", currency: "GBP", amount: "0", source: "manual_confirmed_balance", sourceSheet: "Остатки" },
    ],
  });

  const rows = result.reconciliation_report_summary.opening_adjustment_rows;
  const usd = rows.find((row) => row.channel === "REVOLUT дол" && row.currency === "USD");
  const eur = rows.find((row) => row.channel === "REVOLUT евро" && row.currency === "EUR");
  const chf = rows.find((row) => row.channel === "REVOLUT франк" && row.currency === "CHF");
  const gbp = rows.find((row) => row.channel === "REVOLUT фунт" && row.currency === "GBP");

  assert.equal(usd.owner_input, 18.38);
  assert.equal(usd.adjusted_opening, 18.38);
  assert.equal(usd.diff, 0);
  assert.equal(usd.superseded_owner_input.amount, 378);
  assert.equal(eur.adjusted_opening, 213.48);
  assert.equal(chf.adjusted_opening, 15);
  assert.equal(gbp.adjusted_opening, 0);
  assert.equal(rows.some((row) => row.channel === "REVOLUT дол" && row.owner_input === 378), false);
  assert.deepEqual(operations, originalOperations);
});

test("May period reconciliation uses owner Revolut split opening instead of stale combined USD fact", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "REVOLUT дол", currency: "USD", amount: "378", amount_usd: "378", sourceSheet: "Остатки" },
      { date: "2026-05-31", channel: "REVOLUT дол", currency: "USD", amount: "18.38", amount_usd: "18.38", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", amount_usd: "254", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "603", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "8519", amount_usd: "8519", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount_usd: "1722", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "Payoneer - eur", currency: "EUR", amount_usd: "1284", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "трансервайз дол", currency: "USD", amount: "2639", amount_usd: "2639", sourceSheet: "Остатки" },
    ],
  });

  const row = result.by_channel_currency.find((entry) => entry.channel === "REVOLUT дол" && entry.currency === "USD");
  assert.equal(row.opening_balance, 18.38);
  assert.equal(row.computed_real_closing_balance, 18.38);
  assert.equal(row.factual_closing_balance, 18.38);
  assert.equal(row.real_difference, 0);
  assert.equal(row.status, "ok");
});

test("does not synthesize Binance internal wallet transfers", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [{
      date: "2026-06-10",
      fromChannel: "Binance funding",
      toChannel: "binance save",
      currency: "USDT",
      amountNet: "500",
      balanceAmount: -500,
      comment: "funding transfer simple earn redemption",
      ledgerV2: { date: "2026-06-10", operation: "transfer", from_channel: "Binance funding", to_channel: "binance save", currency: "USDT", amount_net: "500", balance_amount: -500, comment: "funding transfer simple earn redemption" },
    }],
    balanceRows: [
      { date: "2026-06-01", channel: "Binance funding", currency: "USDT", amount: 500, amount_usd: 500 },
      { date: "2026-06-30", channel: "Binance funding", currency: "USDT", amount: 0, amount_usd: 0 },
      { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: 1000, amount_usd: 1000 },
      { date: "2026-06-30", channel: "binance save", currency: "USDT", amount: 1000, amount_usd: 1000 },
    ],
  });
  const save = result.by_channel_currency.find((row) => row.channel === "binance save" && row.currency === "USDT");
  assert.equal(save.transfer_in, 0);
});

test("total USD excludes legacy combined Binance row when split rows exist", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [],
    balanceRows: [
      { date: "2026-06-01", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: 345, amount_usd: 345, source: "legacy_combined_binance_spot_funding" },
      { date: "2026-06-30", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: 345, amount_usd: 345, source: "legacy_combined_binance_spot_funding" },
      { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: 7432, amount_usd: 7432 },
      { date: "2026-06-30", channel: "binance save", currency: "USDT", amount: 5412, amount_usd: 5412 },
      { date: "2026-06-30", channel: "binance save", currency: "USDC", amount: 2020, amount_usd: 2020 },
      { date: "2026-06-01", channel: "Бинанс spot", currency: "USDT", amount: 1093, amount_usd: 1093 },
      { date: "2026-06-30", channel: "Бинанс spot", currency: "USDT", amount: 1162, amount_usd: 1162 },
    ],
  });
  assert.equal(result.total_usd_row.confirmed_end_usd, 8594);
});

test("May current owner-confirmed snapshot wins over stale current rows in period reconciliation", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-06-01" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
      { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "603", amount_usd: "31.36" },
      { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount: "107403.42", amount_usd: "1270.1528" },
      { date: "2026-05-01", channel: "binance save", currency: "USD", amount: "7425", amount_usd: "7425" },
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USD", amount: "1689", amount_usd: "1689" },
      { date: "2026-05-01", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: "345", amount_usd: "345" },
    ],
    calculatedBalanceRows: [
      { date: "2026-06-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", balanceSource: "calculated_balance" },
      { date: "2026-06-01", channel: "монобанк грн", currency: "UAH", amount: "603", amount_usd: "31.36", balanceSource: "calculated_balance" },
      { date: "2026-06-01", channel: "Яндекс руб", currency: "RUB", amount: "107403.42", amount_usd: "1270.1528", balanceSource: "provider_auto" },
      { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: "5413.0775", amount_usd: "5413.0775", balanceSource: "provider_auto" },
      { date: "2026-06-01", channel: "Бинанс spot", currency: "USDT", amount: "1262.1523", amount_usd: "1262.1523", balanceSource: "provider_auto" },
      { date: "2026-06-01", channel: "Payoneer - eur", currency: "EUR", amount: "1008.19", amount_usd: "1175.3751", balanceSource: "payoneer_derived_balance" },
      { date: "2026-06-01", channel: "пейпал дол", currency: "USD", amount: "35.30", amount_usd: "12.07", balanceSource: "paypal_derived_balance" },
    ],
  });

  const rows = new Map(result.by_channel_currency.map((row) => [`${row.channel}|${row.currency}`, row]));
  assert.equal(rows.get("БАНК КАНАДА cad|CAD").confirmed_end_native, 10538);
  assert.equal(rows.get("БАНК КАНАДА cad|CAD").confirmed_end_usd, 7798);
  assert.equal(rows.get("монобанк грн|UAH").confirmed_end_native, 10916);
  assert.equal(rows.get("монобанк грн|UAH").confirmed_end_usd, 567.7044);
  assert.equal(rows.get("Яндекс руб|RUB").confirmed_end_usd, 1376);
  assert.equal(rows.get("Payoneer - eur|EUR").confirmed_end_native, 1418.39);
  assert.equal(rows.get("Payoneer - eur|EUR").confirmed_end_usd, 1653.5973);
  assert.equal(rows.get("пейпал дол|USD").confirmed_end_native, 86.89);
  assert.equal(rows.get("пейпал дол|USD").confirmed_end_usd, 86.89);
  assert.equal(rows.get("binance save|USDT").confirmed_end_native, 5412);
  assert.equal(rows.get("binance save|USDT").confirmed_end_usd, 5412);
  assert.equal(rows.get("binance save|USDC").confirmed_end_native, 2020);
  assert.equal(rows.get("binance save|USDC").confirmed_end_usd, 2020);
  assert.equal(rows.get("Бинанс spot|USDT").confirmed_end_native, 1162);
  assert.equal(rows.get("Бинанс spot|USDT").confirmed_end_usd, 1162);
  assert.equal(rows.get("Бинанс spot|USDC").confirmed_end_native, 0);
  assert.equal(rows.get("Бинанс spot|USDC").confirmed_end_usd, 0);
  assert.equal(rows.get("Бинанс spot|USDC").status, "ok");
  assert.equal(rows.has("legacy_combined_binance_spot_funding|USDT"), false);
  assert.equal(rows.has("binance save|USD"), false);
  assert.equal(rows.has("Бинанс spot|USD"), false);
});

test("closing non-USD amount_usd reaches canonical confirmed_end_usd", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "трансервайз евро", currency: "EUR", amount: "100", amount_usd: "110" },
      { date: "2026-05-31", channel: "трансервайз евро", currency: "EUR", amount: "90", amount_usd: "99" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "трансервайз евро");
  assert.equal(row.confirmed_end_native, 90);
  assert.equal(row.confirmed_end_usd, 99);
  assert.equal(row.change_usd, -11);
  assert.ok(!row.fx_warnings.includes("confirmed_end_usd_fx_missing"));
});

test("closing non-USD rate_to_usd derives canonical confirmed_end_usd", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "100", amount_usd: "72" },
      { date: "2026-05-31", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "120", rate_to_usd: "0.75" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "БАНК КАНАДА cad");
  assert.equal(row.confirmed_end_usd, 90);
  assert.equal(row.manual_provider_closing_balance_fx_rate_to_usd, 0.75);
  assert.equal(row.manual_provider_closing_balance_fx_source, "snapshot_rate");
  assert.ok(!row.fx_warnings.includes("confirmed_end_usd_fx_missing"));
});

test("USDC closing native amount resolves to finite USD without fx_missing", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "binance save", currency: "USDC", amount: "3107.3722" },
      { date: "2026-05-31", channel: "binance save", currency: "USDC", amount: "2020" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "binance save" && item.currency === "USDC");
  assert.equal(row.opening_usd, 3107.3722);
  assert.equal(row.confirmed_end_usd, 2020);
  assert.deepEqual(row.fx_warnings, []);
});

test("true missing FX keeps native values visible and reports date/currency diagnostics", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "нал-мам-евро", currency: "EUR", amount: "580", amount_usd: "676.0062", sourceSheet: "Остатки", sourceRow: 10 },
      { date: "2026-05-31", channel: "нал-мам-евро", currency: "EUR", amount: "580", sourceSheet: "Остатки", sourceRow: 20 },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "нал-мам-евро");
  assert.equal(row.confirmed_end_native, 580);
  assert.equal(row.confirmed_end_usd, null);
  assert.ok(row.fx_warnings.includes("confirmed_end_usd_fx_missing"));
  assert.match(row.fx_diagnostics.join(" | "), /missing FX rate: EUR on 2026-05-31/);
  assert.match(row.fx_diagnostics.join(" | "), /Остатки row #20/);
});

test("total USD row is partial when column coverage differs and lists excluded channels", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [
      {
        date: "2026-05-10",
        fromChannel: "cash eur",
        currency: "EUR",
        amountNet: "10",
        amountUsd: "11",
        balanceAmount: -10,
        ledgerV2: {
          date: "2026-05-10",
          operation: "expense",
          from_channel: "cash eur",
          currency: "EUR",
          amount_net: "10",
          amount_usd: "11",
          balance_amount: -10,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100" },
      { date: "2026-05-31", channel: "wise usd", currency: "USD", amount: "120" },
      { date: "2026-05-01", channel: "cash eur", currency: "EUR", amount: "50", amount_usd: "55" },
      { date: "2026-05-31", channel: "cash eur", currency: "EUR", amount: "40" },
    ],
  });

  assert.equal(result.total_usd_row.label, "ВСЕГО USD (partial)");
  assert.equal(result.total_usd_row.total_coverage_status, "partial");
  assert.equal(result.total_usd_row.rows_excluded_from_usd_total, 1);
  assert.deepEqual(result.total_usd_row.excluded_channels, ["cash eur EUR"]);
  assert.deepEqual(result.total_usd_row.excluded_rows.map((row) => ({
    channel: row.channel,
    currency: row.currency,
    missing_fields: row.missing_fields,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    reason: row.reason,
  })), [{
    channel: "cash eur",
    currency: "EUR",
    missing_fields: ["confirmed_end_usd", "change_usd", "diff_usd"],
    sourceSheet: "Остатки",
    sourceRow: null,
    reason: "missing USD equivalent",
  }]);
  assert.match(result.total_usd_row.excluded_rows[0].suggested_repair_action, /Backfill amount_usd/);
  assert.equal(result.total_usd_row.finite_start_rows, 2);
  assert.equal(result.total_usd_row.finite_end_rows, 1);
  assert.equal(result.total_usd_row.finite_movement_rows, 2);
  assert.notEqual(result.total_usd_row.finite_change_rows, result.total_usd_row.finite_movement_rows);
});

test("USD-only opening facts are diagnostic while no-movement rows derive comparable totals from exact closing", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "Налично -я-евр", currency: "EUR", amount: "", amount_usd: "91", sourceSheet: "Owner Confirmed" },
      { date: "2026-05-31", channel: "Налично -я-евр", currency: "EUR", amount: "91", amount_usd: "106.063", sourceSheet: "Остатки" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "Налично -я-евр");
  assert.equal(row.opening_native, 91);
  assert.equal(row.opening_usd, 106.063);
  assert.equal(row.confirmed_end_native, 91);
  assert.equal(row.confirmed_end_usd, 106.063);
  assert.equal(row.change_usd, 0);
  assert.equal(row.needs_native_currency_value, true);
  assert.equal(row.opening_fact_value_type, "usd_only_needs_native");
  assert.match(row.native_fact_missing_reason, /opening balance has USD equivalent only/);
  assert.equal(result.total_usd_row.label, "ВСЕГО USD");
  assert.equal(result.total_usd_row.total_coverage_status, "full");
  assert.equal(result.total_usd_row.rows_excluded_from_usd_total, 0);
});

test("no-movement exact closing facts derive opening USD for comparable total coverage", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-31", channel: "карта май", currency: "UNKNOWN", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "карта май");
  assert.equal(row.opening_native, 0);
  assert.equal(row.opening_usd, 0);
  assert.equal(row.confirmed_end_native, 0);
  assert.equal(row.confirmed_end_usd, 0);
  assert.equal(row.change_usd, 0);
  assert.equal(result.total_usd_row.total_coverage_status, "full");
  assert.equal(result.total_usd_row.rows_excluded_from_usd_total, 0);
});

test("no-movement native zero closing derives USD zero even without explicit USD amount", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-31", channel: "карта май", currency: "UNKNOWN", amount: "0", source: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "карта май");
  assert.equal(row.opening_native, 0);
  assert.equal(row.opening_usd, 0);
  assert.equal(row.confirmed_end_native, 0);
  assert.equal(row.confirmed_end_usd, 0);
  assert.equal(row.change_usd, 0);
  assert.equal(result.total_usd_row.total_coverage_status, "full");
  assert.equal(result.total_usd_row.rows_excluded_from_usd_total, 0);
});

test("stable zero closing facts can keep movement rows comparable without hiding mismatch", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [
      {
        date: "2026-05-08",
        operation: "income",
        toChannel: "Binance funding",
        currency: "USDT",
        balanceAmount: 415.5,
        ledgerV2: {
          date: "2026-05-08",
          operation: "income",
          to_channel: "Binance funding",
          currency: "USDT",
          amount_net: "415.5",
          amount_usd: "415.5",
          balance_amount: 415.5,
        },
      },
    ],
    balanceRows: [
      { date: "2026-05-31", channel: "Binance funding", currency: "USDT", amount: "0", amount_usd: "0", source: "derived_from_confirmed_balance", sourceSheet: "Авто Остатки" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "Binance funding");
  assert.equal(row.opening_native, 0);
  assert.equal(row.opening_usd, 0);
  assert.equal(row.movement_usd, 415.5);
  assert.equal(row.confirmed_end_usd, 0);
  assert.equal(row.diff_usd, -415.5);
  assert.equal(row.status, "mismatch");
  assert.equal(result.total_usd_row.total_coverage_status, "full");
  assert.equal(result.total_usd_row.rows_excluded_from_usd_total, 0);
});

test("May owner current corrections can supply May 31 Binance Save USDC closing fact", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-05-01", to: "2026-05-31" },
    operations: [],
    balanceRows: [
      { date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "435", amount_usd: "435", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "приват 24-грн", currency: "UAH", amount: "11239", amount_usd: "254", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "монобанк грн", currency: "UAH", amount: "26670", amount_usd: "603", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351", amount_usd: "7351", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "5411.6278", amount_usd: "5411.6278", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount_usd: "1722", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "Payoneer - eur", currency: "EUR", amount_usd: "1284", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "трансервайз дол", currency: "USD", amount: "2639", amount_usd: "2639", sourceSheet: "Остатки" },
      { date: "2026-05-01", channel: "binance save", currency: "USDC", amount: "3107.3722", amount_usd: "3107.3722", sourceSheet: "Остатки" },
    ],
  });

  const row = result.by_channel_currency.find((item) => item.channel === "binance save" && item.currency === "USDC");
  assert.equal(row.opening_usd, 3107.3722);
  assert.equal(row.confirmed_end_native, 2020);
  assert.equal(row.confirmed_end_usd, 2020);
  assert.equal(row.manual_provider_closing_balance_date, "2026-05-31");
  assert.equal(result.total_usd_row.excluded_channels.includes("binance save USDC"), false);
});
