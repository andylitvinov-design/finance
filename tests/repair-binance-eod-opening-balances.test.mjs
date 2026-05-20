import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRepairPlanToValues,
  buildBinanceEodOpeningBalanceRepairPlan,
} from "../scripts/repair-binance-eod-opening-balances.mjs";

const header = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий", "source", "status", "raw_source_id"];

test("Binance EOD repair dry-run targets only confirmed 2026-05-01 USDT rows", () => {
  const values = [
    header,
    ["2026-05-01", "binance save", "8519", "USDT", "1", "8519", "old"],
    ["2026-05-01", "Бинанс spot", "1090", "USDT", "1", "1090", "old"],
    ["2026-05-01", "Бинанс spot", "1090", "USD", "1", "1090", "old USD row"],
  ];

  const plan = buildBinanceEodOpeningBalanceRepairPlan(values);

  assert.equal(plan.ok, true);
  assert.equal(plan.summary.change_rows, 2);
  assert.equal(plan.summary.unrelated_binance_rows_listed, 1);
  assert.deepEqual(plan.changes.map((row) => [row.rowNumber, row.channel, row.currency, row.old_amount, row.new_amount]).sort((a, b) => a[0] - b[0]), [
    [2, "binance save", "USDT", "8519", "7432"],
    [3, "Бинанс spot", "USDT", "1090", "1093"],
  ]);
  assert.equal(plan.unrelatedBinanceRows[0].currency, "USD");
});

test("Binance EOD repair apply helper is idempotent and preserves metadata headers", () => {
  const values = [
    header,
    ["2026-05-01", "binance save", "8519", "USDT", "1", "8519", "old"],
    ["2026-05-01", "Бинанс spot", "1090", "USDT", "1", "1090", "old"],
  ];

  const firstPlan = buildBinanceEodOpeningBalanceRepairPlan(values);
  const repaired = applyRepairPlanToValues(values, firstPlan);
  const secondPlan = buildBinanceEodOpeningBalanceRepairPlan(repaired);
  const repairedAgain = applyRepairPlanToValues(repaired, secondPlan);

  assert.deepEqual(repaired[1], [
    "2026-05-01",
    "binance save",
    "7432",
    "USDT",
    "1",
    "7432",
    "EOD 23:59; Simple Earn / Save.",
    "manual_confirmed_balance",
    "ok",
    "manual_confirmed_balance:2026-05-01:binance-save:USDT",
  ]);
  assert.deepEqual(repaired[2], [
    "2026-05-01",
    "Бинанс spot",
    "1093",
    "USDT",
    "1",
    "1093",
    "EOD 23:59; includes Spot + Funding until Binance funding channel split; after Binance Pay -700.",
    "manual_confirmed_balance",
    "ok",
    "manual_confirmed_balance:2026-05-01:binance-spot:USDT",
  ]);
  assert.equal(secondPlan.summary.change_rows, 0);
  assert.equal(secondPlan.summary.unchanged_rows, 2);
  assert.deepEqual(repairedAgain, repaired);
});

test("Binance EOD repair appends missing target without duplicating existing target", () => {
  const values = [
    header,
    ["2026-05-01", "Бинанс spot", "1093", "USDT", "1", "1093", "EOD 23:59; includes Spot + Funding until Binance funding channel split; after Binance Pay -700.", "manual_confirmed_balance", "ok", "manual_confirmed_balance:2026-05-01:binance-spot:USDT"],
  ];

  const plan = buildBinanceEodOpeningBalanceRepairPlan(values);
  const repaired = applyRepairPlanToValues(values, plan);
  const secondPlan = buildBinanceEodOpeningBalanceRepairPlan(repaired);

  assert.equal(plan.summary.append_rows, 1);
  assert.equal(repaired.length, 3);
  assert.equal(repaired[2][1], "binance save");
  assert.equal(repaired[2][2], "7432");
  assert.equal(secondPlan.summary.change_rows, 0);
});

test("Binance EOD repair refuses ambiguous target rows", () => {
  const values = [
    header,
    ["2026-05-01", "binance save", "8519", "USDT", "1", "8519", "one"],
    ["2026-05-01", "binance save", "7432", "USDT", "1", "7432", "two"],
    ["2026-05-01", "Бинанс spot", "1093", "USDT", "1", "1093", "ok"],
  ];

  const plan = buildBinanceEodOpeningBalanceRepairPlan(values);

  assert.equal(plan.ok, false);
  assert.match(plan.errors.join(" | "), /Ambiguous Остатки rows/);
});
