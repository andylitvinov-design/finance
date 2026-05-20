import test from "node:test";
import assert from "node:assert/strict";

import { generateDailyPlannedBalanceRows } from "../server/daily-planned-balances.js";
import { mergeBalanceRowsByDateChannelCurrency } from "../server/auto-balance-snapshots.js";

function op({ date, channel = "wise usd", currency = "USD", amountNet, balanceAmount, operation = "income" }) {
  const signed = Number(balanceAmount);
  return {
    date,
    fromChannel: signed < 0 ? channel : "",
    toChannel: signed >= 0 ? channel : "",
    currency,
    amountNet,
    balanceAmount,
    ledgerV2: {
      date,
      operation,
      from_channel: signed < 0 ? channel : "",
      to_channel: signed >= 0 ? channel : "",
      currency,
      amount_net: amountNet,
      balance_amount: balanceAmount,
    },
  };
}

test("generates planned balance from previous manual fact", () => {
  const result = generateDailyPlannedBalanceRows({
    from: "2026-05-02",
    to: "2026-05-02",
    balanceRows: [{ date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact" }],
    operations: [op({ date: "2026-05-02", amountNet: "20", balanceAmount: -20, operation: "expense" })],
    generatedAt: "2026-05-02T00:00:00.000Z",
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amount, 80);
  assert.equal(result.rows[0].source, "planned_daily_balance");
  assert.equal(result.rows[0].status, "planned");
  assert.equal(result.rows[0].rawSourceId, "planned_daily_balance:2026-05-02:wise_usd:USD");
  assert.match(result.rows[0].comment, /basis_date=2026-05-01/);
  assert.match(result.rows[0].comment, /basis_source=manual_fact/);
  assert.match(result.rows[0].comment, /ledger_delta=-20/);
});

test("chains planned balances from previous planned day", () => {
  const result = generateDailyPlannedBalanceRows({
    from: "2026-05-02",
    to: "2026-05-03",
    balanceRows: [{ date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact" }],
    operations: [
      op({ date: "2026-05-02", amountNet: "20", balanceAmount: -20, operation: "expense" }),
      op({ date: "2026-05-03", amountNet: "50", balanceAmount: 50 }),
    ],
  });

  assert.deepEqual(result.rows.map((row) => `${row.date}|${row.amount}`), [
    "2026-05-02|80",
    "2026-05-03|130",
  ]);
  assert.match(result.rows[1].comment, /basis_source=planned/);
});

test("missing amount_net blocks planned generation and does not use gross or amount fallback", () => {
  const result = generateDailyPlannedBalanceRows({
    from: "2026-05-02",
    to: "2026-05-02",
    balanceRows: [{ date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact" }],
    operations: [{
      date: "2026-05-02",
      fromChannel: "wise usd",
      currency: "USD",
      amount: "999",
      amountGross: "999",
      amountNet: "",
      balanceAmount: -20,
      rawSourceId: "missing-net-row",
      ledgerV2: {
        date: "2026-05-02",
        operation: "expense",
        from_channel: "wise usd",
        currency: "USD",
        amount: "999",
        amount_gross: "999",
        amount_net: "",
        balance_amount: -20,
        raw_source_id: "missing-net-row",
      },
    }],
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.blocked_missing_amount_net, 1);
  assert.equal(result.report[0].status, "missing_amount_net");
});

test("planned row idempotency uses raw_source_id and does not overwrite factual rows", () => {
  const factual = { date: "2026-05-02", provider: "wise", channel: "wise usd", currency: "USD", amount: "82", source: "wise_auto", rawSourceId: "wise-fact", status: "ok" };
  const planned80 = { date: "2026-05-02", provider: "planned", channel: "wise usd", currency: "USD", amount: "80", source: "planned_daily_balance", rawSourceId: "planned_daily_balance:2026-05-02:wise_usd:USD", status: "planned" };
  const planned85 = { ...planned80, amount: "85" };
  const first = mergeBalanceRowsByDateChannelCurrency([factual], [planned80]);
  const second = mergeBalanceRowsByDateChannelCurrency(first, [planned85]);

  assert.equal(second.filter((row) => row.source === "planned_daily_balance").length, 1);
  assert.equal(second.find((row) => row.source === "planned_daily_balance")?.amount, "85");
  assert.equal(second.some((row) => row.rawSourceId === "wise-fact" && row.amount === "82"), true);
});

test("Binance wallet split generates per wallet and not a fake aggregate", () => {
  const result = generateDailyPlannedBalanceRows({
    from: "2026-05-02",
    to: "2026-05-02",
    balanceRows: [
      { date: "2026-05-01", channel: "Бинанс spot", currency: "USDT", amount: "100", source: "binance_auto", status: "ok" },
      { date: "2026-05-01", channel: "Binance funding", currency: "USDT", amount: "50", source: "binance_auto", status: "ok" },
      { date: "2026-05-01", channel: "binance save", currency: "USDT", amount: "20", source: "binance_auto", status: "ok" },
    ],
    operations: [
      op({ date: "2026-05-02", channel: "Бинанс spot", currency: "USDT", amountNet: "10", balanceAmount: 10 }),
      op({ date: "2026-05-02", channel: "Binance funding", currency: "USDT", amountNet: "5", balanceAmount: -5, operation: "expense" }),
      op({ date: "2026-05-02", channel: "binance save", currency: "USDT", amountNet: "2", balanceAmount: 2 }),
    ],
  });

  assert.deepEqual(result.rows.map((row) => `${row.channel}|${row.amount}`).sort(), [
    "Binance funding|45",
    "binance save|22",
    "Бинанс spot|110",
  ]);
  assert.equal(result.rows.some((row) => /combined|total|итог/i.test(row.channel)), false);
});

test("PayPal planned fallback stays planned_daily_balance after manual opening", () => {
  const result = generateDailyPlannedBalanceRows({
    from: "2026-05-02",
    to: "2026-05-02",
    balanceRows: [{ date: "2026-05-01", channel: "пейпал дол", currency: "USD", amount: "100", source: "paypal_manual_balance" }],
    operations: [op({ date: "2026-05-02", channel: "пейпал дол", currency: "USD", amountNet: "25", balanceAmount: -25, operation: "expense" })],
  });

  assert.equal(result.rows[0].amount, 75);
  assert.equal(result.rows[0].provider, "planned");
  assert.equal(result.rows[0].source, "planned_daily_balance");
  assert.notEqual(result.rows[0].source, "paypal_auto");
});

test("generator reports fallback_amount_rows as zero through the run result contract", () => {
  const result = generateDailyPlannedBalanceRows({
    from: "2026-05-02",
    to: "2026-05-02",
    balanceRows: [{ date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact" }],
    operations: [op({ date: "2026-05-02", amountNet: "20", balanceAmount: -20, operation: "expense" })],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows.some((row) => row.amount === 999), false);
});
