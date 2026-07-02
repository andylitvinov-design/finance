import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOstatkiUpsertPlan,
  parseOstatkiValues,
} from "../api/save-balance-snapshot.js";
import { buildPeriodBalanceReconciliation } from "../server/period-balance-reconciliation-engine.js";

const HEADER = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"];

function toSheetValues(rows) {
  return [
    HEADER,
    ...rows.map((row) => [
      row.date || "",
      row.channel || "",
      row.amount || "",
      row.currency || "",
      row.rate || "",
      row.usdAmount || "",
      row.comment || "",
    ]),
  ];
}

test("saved balance row survives save -> load -> reconciliation round trip with amount, rate and usdAmount", async () => {
  const existingValues = toSheetValues([
    { date: "2026-05-31", channel: "БАНК КАНАДА cad", amount: "10538", currency: "CAD", rate: "0,74", usdAmount: "7798,12", comment: "owner_confirmed" },
  ]);
  const plan = await buildOstatkiUpsertPlan({
    rows: [
      { date: "2026-06-30", channel: "БАНК КАНАДА cad", amount: 10638, currency: "CAD", rate: 0.74, usdAmount: 7872.12, comment: "owner_confirmed" },
    ],
    existingValues,
  });

  assert.equal(plan.inserted.length, 1);
  assert.equal(plan.updated.length, 0);
  // saving a new date must not overwrite the other date
  const dates = plan.outputRows.map((row) => row.date).sort();
  assert.deepEqual(dates, ["2026-05-31", "2026-06-30"]);

  const loaded = parseOstatkiValues(toSheetValues(plan.outputRows));
  assert.equal(loaded.length, 2);
  const saved = loaded.find((row) => row.date === "2026-06-30");
  assert.equal(saved.channel, "БАНК КАНАДА cad");
  assert.equal(saved.currency, "CAD");
  assert.equal(saved.amount, "10638");
  assert.equal(saved.rate, "0,74");
  assert.equal(saved.usdAmount, "7872,12");

  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [],
    balanceRows: loaded.map((row) => ({ ...row, sourceSheet: "Остатки" })),
  });
  const row = result.by_channel_currency.find(
    (entry) => entry.channel === "БАНК КАНАДА cad" && entry.currency === "CAD"
  );
  assert.ok(row, "reconciliation must see the saved balance row");
  assert.equal(row.opening_fact_balance, 10538);
  assert.equal(row.manual_provider_closing_balance, 10638);
  assert.equal(row.manual_provider_closing_balance_date, "2026-06-30");
  // rate/usdAmount must stay USD, not native
  assert.equal(row.manual_provider_closing_balance_usd, 7872.12);
  assert.equal(row.fact_source, "manual");
});

test("saving a USD row does not overwrite same-channel USDC row on the same date", async () => {
  const existingValues = toSheetValues([
    { date: "2026-06-30", channel: "binance save", amount: "3107,3722", currency: "USDC", rate: "1", usdAmount: "3107,3722", comment: "owner_confirmed" },
  ]);
  const plan = await buildOstatkiUpsertPlan({
    rows: [
      { date: "2026-06-30", channel: "binance save", amount: 7432, currency: "USD", rate: 1, usdAmount: 7432, comment: "owner_confirmed" },
    ],
    existingValues,
  });

  assert.equal(plan.inserted.length, 1);
  assert.equal(plan.updated.length, 0);
  const loaded = parseOstatkiValues(toSheetValues(plan.outputRows));
  const usdc = loaded.find((row) => row.currency === "USDC");
  const usd = loaded.find((row) => row.currency === "USD");
  assert.ok(usdc, "USDC row must survive USD save");
  assert.ok(usd, "USD row must be saved");
  assert.equal(usdc.amount, "3107,3722");
  assert.equal(usd.amount, "7432");
});

test("zero and negative factual balances are valid facts, not missing", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [
      {
        date: "2026-06-10",
        fromChannel: "пейпал евр",
        currency: "EUR",
        ledgerV2: { date: "2026-06-10", operation: "expense", from_channel: "пейпал евр", currency: "EUR", amount_net: "50", balance_amount: -50 },
      },
    ],
    balanceRows: [
      { date: "2026-05-31", channel: "пейпал евр", currency: "EUR", amount: "-100", sourceSheet: "Остатки" },
      { date: "2026-06-30", channel: "пейпал евр", currency: "EUR", amount: "-150", sourceSheet: "Остатки" },
      { date: "2026-05-31", channel: "нал-мам-евро", currency: "EUR", amount: "0", sourceSheet: "Остатки" },
      { date: "2026-06-30", channel: "нал-мам-евро", currency: "EUR", amount: "0", sourceSheet: "Остатки" },
    ],
  });

  const negative = result.by_channel_currency.find((row) => row.channel === "пейпал евр");
  assert.equal(negative.status, "ok");
  assert.equal(negative.opening_fact_balance, -100);
  assert.equal(negative.calculated_closing_balance, -150);
  assert.equal(negative.manual_provider_closing_balance, -150);

  const zero = result.by_channel_currency.find((row) => row.channel === "нал-мам-евро");
  assert.equal(zero.status, "ok");
  assert.equal(zero.opening_fact_balance, 0);
  assert.equal(zero.manual_provider_closing_balance, 0);
});

test("source=unknown ledger row with valid amount_net still counts as balance movement", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [
      {
        date: "2026-06-05",
        toChannel: "wise usd",
        currency: "USD",
        source: "unknown",
        ledgerV2: { date: "2026-06-05", operation: "income", to_channel: "wise usd", currency: "USD", amount_net: "50", balance_amount: 50, source: "unknown" },
      },
    ],
    balanceRows: [
      { date: "2026-05-31", channel: "wise usd", currency: "USD", amount: "1000", sourceSheet: "Остатки" },
      { date: "2026-06-30", channel: "wise usd", currency: "USD", amount: "1050", sourceSheet: "Остатки" },
    ],
  });
  const row = result.by_channel_currency.find((entry) => entry.channel === "wise usd");
  assert.equal(row.real_delta, 50);
  assert.equal(row.status, "ok");
});

test("blocked row does not drop other rows from by_channel_currency", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [
      {
        date: "2026-06-15",
        fromChannel: "пейпал дол",
        currency: "RUB",
        ledgerV2: { date: "2026-06-15", operation: "expense", from_channel: "пейпал дол", currency: "RUB", amount_net: "8487", balance_amount: -8487 },
      },
    ],
    balanceRows: [
      { date: "2026-05-31", channel: "wise usd", currency: "USD", amount: "1000", sourceSheet: "Остатки" },
      { date: "2026-06-30", channel: "wise usd", currency: "USD", amount: "1000", sourceSheet: "Остатки" },
    ],
  });

  assert.equal(result.by_channel_currency.length, 2);
  const blocked = result.by_channel_currency.find((row) => row.currency === "RUB");
  const healthy = result.by_channel_currency.find((row) => row.currency === "USD");
  assert.equal(blocked.status, "missing_opening_balance");
  assert.equal(healthy.status, "ok");
  assert.equal(result.summary.positions_checked, 2);
  assert.equal(result.summary.blocked, 1);
  // blocked row must not silently enter the exact USD total
  assert.equal(result.total_usd_row.partial, true);
  assert.ok(result.total_usd_row.excluded_channels.includes("пейпал дол RUB"));
});
