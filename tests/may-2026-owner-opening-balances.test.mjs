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

function paypalOperation({ sourceRow, date, channel, currency, balanceAmount, gross = null, fee = null, net = null, rawId = "", description = "" }) {
  const directionKey = balanceAmount < 0 ? "from_channel" : "to_channel";
  return {
    date,
    source: "paypal",
    sheetRowNumber: sourceRow,
    currency,
    amountNet: net,
    gross,
    fee,
    net,
    amountGross: gross,
    amountFee: fee,
    amount_net: net,
    balanceAmount,
    raw_source_id: rawId,
    sourceTransactionId: rawId,
    description,
    counterparty: description,
    ledgerV2: {
      date,
      operation: balanceAmount < 0 ? "expense" : "income",
      [directionKey]: channel,
      currency,
      amount_net: net,
      amount_gross: gross,
      amount_fee: fee,
      balance_amount: balanceAmount,
      raw_source_id: rawId,
      external_id: rawId,
      description,
      counterparty: description,
    },
  };
}

test("owner-confirmed 2026-05-01 opening balances total exactly 24993 USD", () => {
  assert.equal(ownerMayOpeningTotalUsd(), 24993);
  assert.equal(validateOwnerMayOpeningBalances().ok, true);
});

test("Binance spot combined owner input is split into USDT and USDC without changing Binance save", () => {
  const spotUsdt = OWNER_MAY_OPENING_BALANCES.find((row) => row.channel === "Бинанс spot" && row.currency === "USDT");
  const spotUsdc = OWNER_MAY_OPENING_BALANCES.find((row) => row.channel === "Бинанс spot" && row.currency === "USDC");
  const saveUsdt = OWNER_MAY_OPENING_BALANCES.find((row) => row.channel === "binance save" && row.currency === "USDT");

  assert.equal(spotUsdt.amount, 1087.6223);
  assert.equal(spotUsdt.amountUsd, 1087.6223);
  assert.equal(spotUsdc.amount, 2.3777);
  assert.equal(spotUsdc.amountUsd, 2.3777);
  assert.equal(spotUsdt.amount + spotUsdc.amount, 1090);
  assert.equal(spotUsdt.adjustmentReason, "owner_combined_usdt_usdc_split");
  assert.equal(spotUsdc.adjustmentReason, "owner_combined_usdt_usdc_split");
  assert.equal(spotUsdt.confidence, "medium");
  assert.equal(spotUsdc.confidence, "medium");
  assert.equal(saveUsdt.amount, 8519);
  assert.equal(saveUsdt.amountUsd, 8519);
});

test("Revolut combined owner input is superseded by explicit currency openings", () => {
  const combined = OWNER_MAY_OPENING_BALANCES.find((row) => row.inputChannel === "REVOLUT" && row.channel === "REVOLUT дол");
  const usd = OWNER_MAY_OPENING_BALANCES.find((row) => row.channel === "REVOLUT дол" && row.currency === "USD");
  const eur = OWNER_MAY_OPENING_BALANCES.find((row) => row.channel === "REVOLUT евро" && row.currency === "EUR");
  const chf = OWNER_MAY_OPENING_BALANCES.find((row) => row.channel === "REVOLUT франк" && row.currency === "CHF");
  const gbp = OWNER_MAY_OPENING_BALANCES.find((row) => row.channel === "REVOLUT фунт" && row.currency === "GBP");

  assert.equal(combined, undefined);
  assert.equal(usd.amount, 18.38);
  assert.equal(eur.amount, 213.48);
  assert.equal(chf.amount, 15);
  assert.equal(gbp.amount, 0);
  assert.equal(usd.supersededOwnerInput.amount, 378);
  assert.equal(usd.adjustmentReason, "owner_revolut_currency_split_from_new_screenshot");
  assert.equal(eur.confidence, "medium-high");
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
  assert.equal(usdc?.opening_amount_usd ?? null, 2.3777);
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

test("PayPal planned openings are pending movement verification and expose source row diagnostics", () => {
  const operations = [
    paypalOperation({ sourceRow: 501, date: "2026-05-10", channel: "пейпал дол", currency: "USD", balanceAmount: -800, gross: -820, fee: -20, net: -800, rawId: "paypal-usd-501", description: "USD withdrawal" }),
    paypalOperation({ sourceRow: 504, date: "2026-05-11", channel: "пейпал дол", currency: "USD", balanceAmount: -33.39, gross: -34.39, fee: -1, net: -33.39, rawId: "paypal-usd-504", description: "USD fee adjustment" }),
    paypalOperation({ sourceRow: 502, date: "2026-05-12", channel: "пейпал евр", currency: "EUR", balanceAmount: -422.55, gross: -430, fee: -7.45, net: -422.55, rawId: "paypal-eur-502", description: "EUR transfer" }),
    paypalOperation({ sourceRow: 503, date: "2026-05-13", channel: "пейпал сad", currency: "CAD", balanceAmount: -19.5, gross: -19.5, fee: 0, net: -19.5, rawId: "paypal-cad-503", description: "CAD transfer" }),
    paypalOperation({ sourceRow: 777, date: "2026-05-01", channel: "пейпал дол", currency: "USD", balanceAmount: -99, net: -99, rawId: "same-day-not-included" }),
  ];
  const report = buildReconciliationAdjustedMayOpening({
    balanceRows: [
      { date: "2026-05-31", channel: "пейпал дол", currency: "USD", amount: "35.30", amount_usd: "35.30", sourceSheet: "Остатки" },
      { date: "2026-05-31", channel: "пейпал евр", currency: "EUR", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
      { date: "2026-05-31", channel: "пейпал сad", currency: "CAD", amount: "0", amount_usd: "0", sourceSheet: "Остатки" },
    ],
    operations,
    period: { from: "2026-05-01", to: "2026-05-31" },
  });

  const usd = report.rows.find((row) => row.channel === "пейпал дол" && row.currency === "USD");
  const eur = report.rows.find((row) => row.channel === "пейпал евр" && row.currency === "EUR");
  const cad = report.rows.find((row) => row.channel === "пейпал сad" && row.currency === "CAD");

  assert.equal(usd.planned_opening_candidate, 868.69);
  assert.equal(eur.planned_opening_candidate, 422.55);
  assert.equal(cad.planned_opening_candidate, 19.5);
  assert.equal(usd.status, "pending_movement_verification");
  assert.equal(eur.status, "pending_movement_verification");
  assert.equal(cad.status, "pending_movement_verification");
  assert.equal(usd.reason, "planned_from_confirmed_balance_minus_ledger_movements");
  assert.equal(usd.confidence, "medium");
  assert.equal(usd.adjusted_opening, 435);
  assert.equal(eur.adjusted_opening, 0);
  assert.equal(cad.adjusted_opening, 0);

  const diagnostics = report.paypal_movement_diagnostics;
  assert.deepEqual(diagnostics.map((row) => row.source_row), [501, 504, 502, 503]);
  assert.equal(diagnostics.every((row) => row.after_2026_05_01), true);
  assert.equal(diagnostics.every((row) => row.included_in_paypal_movement_sum), true);
  assert.equal(diagnostics.find((row) => row.source_row === 501).gross, -820);
  assert.equal(diagnostics.find((row) => row.source_row === 501).fee, -20);
  assert.equal(diagnostics.find((row) => row.source_row === 501).net, -800);
  assert.equal(diagnostics.find((row) => row.source_row === 501).raw_source_id, "paypal-usd-501");
  assert.equal(diagnostics.find((row) => row.source_row === 501).direction, "outflow");
  assert.equal(diagnostics.find((row) => row.source_row === 777), undefined);
});

test("PayPal screenshot evidence is preserved as report-layer owner evidence", () => {
  const report = buildReconciliationAdjustedMayOpening({
    balanceRows: [
      { date: "2026-05-27", channel: "пейпал дол", currency: "USD", amount: "12.07", amount_usd: "12.07", sourceSheet: "Owner Screenshot" },
      { date: "2026-05-27", channel: "пейпал евр", currency: "EUR", amount: "0", sourceSheet: "Owner Screenshot" },
      { date: "2026-05-27", channel: "пейпал сad", currency: "CAD", amount: "0", sourceSheet: "Owner Screenshot" },
    ],
    operations: [],
    period: { from: "2026-05-01", to: "2026-05-27" },
  });

  const usd = report.rows.find((row) => row.channel === "пейпал дол" && row.currency === "USD");
  const eur = report.rows.find((row) => row.channel === "пейпал евр" && row.currency === "EUR");
  const cad = report.rows.find((row) => row.channel === "пейпал сad" && row.currency === "CAD");

  assert.equal(report.owner_input_opening_total_usd, 24993);
  assert.equal(usd.adjusted_opening, 202.97);
  assert.equal(usd.adjusted_opening_usd, 202.97);
  assert.equal(usd.later_confirmed_balance, 12.07);
  assert.equal(usd.reason, "owner_paypal_screenshot_opening");
  assert.equal(usd.superseded_owner_input.amount, 435);
  assert.equal(eur.adjusted_opening, 175.25);
  assert.equal(eur.adjusted_opening_usd, null);
  assert.equal(eur.later_confirmed_balance, 0);
  assert.equal(eur.reason, "owner_paypal_screenshot_opening");
  assert.equal(cad.adjusted_opening, 19.5);
  assert.equal(cad.adjusted_opening_usd, null);
  assert.equal(cad.later_confirmed_balance, 0);
  assert.equal(cad.reason, "owner_paypal_screenshot_opening");
});

test("Revolut split openings are derived from current screenshots minus post-May-1 movements", () => {
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
        counterparty: "Nataliia Minakova",
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
        counterparty: "Dia",
      },
    },
  ];
  const originalOperations = structuredClone(operations);

  const report = buildReconciliationAdjustedMayOpening({
    balanceRows: [
      { date: "2026-05-21", channel: "REVOLUT дол", currency: "USD", amount: "18.38", amount_usd: "18.38", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT евро", currency: "EUR", amount: "110.74", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT франк", currency: "CHF", amount: "15", sourceSheet: "Остатки" },
      { date: "2026-05-21", channel: "REVOLUT фунт", currency: "GBP", amount: "0", sourceSheet: "Остатки" },
    ],
    operations,
    period: { from: "2026-05-01", to: "2026-05-31" },
  });

  const usd = report.rows.find((row) => row.channel === "REVOLUT дол" && row.currency === "USD");
  const eur = report.rows.find((row) => row.channel === "REVOLUT евро" && row.currency === "EUR");
  const chf = report.rows.find((row) => row.channel === "REVOLUT франк" && row.currency === "CHF");
  const gbp = report.rows.find((row) => row.channel === "REVOLUT фунт" && row.currency === "GBP");

  assert.equal(usd.adjusted_opening, 18.38);
  assert.equal(usd.superseded_owner_input.amount, 378);
  assert.equal(usd.reason, "owner_revolut_currency_split_from_new_screenshot");
  assert.equal(usd.confidence, "high");
  assert.equal(eur.adjusted_opening, 213.48);
  assert.equal(eur.ledger_movement_from_2026_05_02_to_confirmed_date, -102.74);
  assert.equal(eur.confidence, "medium-high");
  assert.equal(chf.adjusted_opening, 15);
  assert.equal(chf.confidence, "high");
  assert.equal(gbp.adjusted_opening, 0);
  assert.equal(gbp.confidence, "high");
  assert.equal(report.needs_verification_rows.some((row) => row.channel.startsWith("REVOLUT")), false);
  assert.deepEqual(operations, originalOperations);
});

test("Revolut EUR keeps screenshot split reason when post-May-1 movements are not in Ledger", () => {
  const report = buildReconciliationAdjustedMayOpening({
    balanceRows: [
      { date: "2026-05-21", channel: "REVOLUT евро", currency: "EUR", amount: "110.74", sourceSheet: "Остатки" },
    ],
    operations: [],
    period: { from: "2026-05-01", to: "2026-05-31" },
  });

  const eur = report.rows.find((row) => row.channel === "REVOLUT евро" && row.currency === "EUR");
  assert.equal(eur.owner_input, 213.48);
  assert.equal(eur.implied_opening, 110.74);
  assert.equal(eur.adjusted_opening, 213.48);
  assert.equal(eur.diff, -102.74);
  assert.equal(eur.reason, "owner_revolut_currency_split_from_new_screenshot");
  assert.equal(eur.confidence, "medium-high");
  assert.equal(eur.status, "adjusted");
  assert.equal(report.needs_verification_rows.some((row) => row.channel === "REVOLUT евро"), false);
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
