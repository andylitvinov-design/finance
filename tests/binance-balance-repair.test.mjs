import assert from "node:assert/strict";
import test from "node:test";

import {
  BINANCE_LEGACY_COMBINED_CHANNEL,
  buildUserConfirmedBinanceRows,
  classifyBinanceRepairRows,
  evaluateSimpleExpression,
  summarizeBinanceRepairPlan,
} from "../scripts/repair-binance-current-balances.mjs";

test("user-confirmed Binance historical expressions resolve to anchor amounts", () => {
  assert.equal(evaluateSimpleExpression("6754 + 2017 - 896"), 7875);
  assert.equal(evaluateSimpleExpression("356 + 1074 - 95 - 990"), 345);

  const rows = buildUserConfirmedBinanceRows({ targetDate: "2026-05-24" });
  const save = rows.find((row) => row.date === "2026-03-25" && row.channel === "binance save");
  const legacy = rows.find((row) => row.channel === BINANCE_LEGACY_COMBINED_CHANNEL);

  assert.equal(save.amount, 7875);
  assert.equal(save.currency, "USDT");
  assert.equal(save.rate, 1);
  assert.equal(save.usdAmount, 7875);
  assert.equal(save.legacy_combined, true);
  assert.equal(save.split_solvability, "underdetermined");
  assert.equal(legacy.amount, 345);
  assert.equal(legacy.legacy_combined, true);
  assert.equal(legacy.split_solvability, "underdetermined");
});

test("legacy combined Binance anchor does not create factual separate spot or funding rows", () => {
  const rows = buildUserConfirmedBinanceRows({ targetDate: "2026-05-24" })
    .filter((row) => row.date === "2026-03-25");

  assert.deepEqual(rows.map((row) => row.channel).sort(), [
    "binance save",
    BINANCE_LEGACY_COMBINED_CHANNEL,
  ]);
  assert.equal(rows.some((row) => row.channel === "Бинанс spot" && row.date === "2026-03-25"), false);
  assert.equal(rows.some((row) => row.channel === "Binance funding" && row.date === "2026-03-25"), false);
});

test("current Binance split anchors remain separate and factual", () => {
  const rows = buildUserConfirmedBinanceRows({ targetDate: "2026-05-24" });
  const current = rows
    .filter((row) => row.date === "2026-05-24")
    .map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.usdAmount}|${row.status}|${row.computed_balance}|${row.factual_provider_balance}`)
    .sort();

  assert.deepEqual(current, [
    "Binance funding|USDT|0|0|zero_balance|false|true",
    "binance save|USDC|2019.822684|2019.822684|ok|false|true",
    "binance save|USDT|5411.3694|5411.3694|ok|false|true",
    "Бинанс spot|USDT|1211.91|1211.91|ok|false|true",
  ]);
});

test("current Binance save split does not include approximate combined save total", () => {
  const rows = buildUserConfirmedBinanceRows({ targetDate: "2026-05-24" });
  const currentSave = rows.filter((row) => row.date === "2026-05-24" && row.channel === "binance save");

  assert.equal(currentSave.some((row) => row.amount === 7433.55), false);
  assert.deepEqual(currentSave.map((row) => row.currency).sort(), ["USDC", "USDT"]);
  assert.equal(currentSave.every((row) => row.rate === 1 && row.usdAmount === row.amount), true);
});

test("Binance repair classification is idempotent and reports underdetermined split", () => {
  const rows = buildUserConfirmedBinanceRows({ targetDate: "2026-05-24" });
  const plan = classifyBinanceRepairRows([
    {
      date: "2026-05-24",
      provider: "binance",
      channel: "Бинанс spot",
      currency: "USDT",
      amount: "1211,91",
      usdAmount: "1211,91",
    },
  ], rows);
  const summary = summarizeBinanceRepairPlan(plan, { targetDate: "2026-05-24" });

  assert.equal(summary.historical_split_solvability, "underdetermined");
  assert.equal(summary.legacy_combined_channel_used, true);
  assert.equal(summary.skipped_rows.length, 1);
  assert.equal(summary.skipped_rows[0].safe_action, "skip_existing_same_value");
  assert.equal(summary.rows_to_write.some((row) => row.channel === "Бинанс spot" && row.date === "2026-03-25"), false);
});

test("Binance repair updates rows when repository parser omits amount_usd", () => {
  const rows = buildUserConfirmedBinanceRows({ targetDate: "2026-05-24" });
  const existing = rows.map((row) => ({
    date: row.date,
    provider: row.provider,
    channel: row.channel,
    currency: row.currency,
    amount: row.amount,
  }));
  const plan = classifyBinanceRepairRows(existing, rows);

  assert.equal(plan.rowsToWrite.length, 6);
  assert.equal(plan.skippedRows.length, 0);
  assert.equal(plan.rowsToWrite.every((row) => row.safeAction !== "skip_existing_same_value"), true);
});
