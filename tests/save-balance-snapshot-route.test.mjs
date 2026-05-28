import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractSnapshotRows,
  parseJsonBody,
  parseOstatkiValues,
} from "../api/save-balance-snapshot.js";

test("save-balance-snapshot parses owner rows with rate and usd amount", () => {
  const rows = extractSnapshotRows({
    rows: [
      {
        date: "2026-05-28",
        channel: "БАНК КАНАДА cad",
        amount: 10538,
        currency: "CAD",
        rate: 0.74,
        usdAmount: 7798.12,
        comment: "owner_confirmed",
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      date: "2026-05-28",
      channel: "БАНК КАНАДА cad",
      currency: "CAD",
      amount: "10538",
      rate: "0,74",
      usdAmount: "7798,12",
      comment: "owner_confirmed",
    },
  ]);
});

test("save-balance-snapshot accepts legacy single-row payload shape", () => {
  const rows = extractSnapshotRows({
    snapshotDate: "28.05.2026",
    accountName: "монобанк грн",
    balanceAmount: "1333,14",
    balanceCurrency: "UAH",
    amount_usd: "31,36",
    source: "manual_fact",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-05-28");
  assert.equal(rows[0].channel, "монобанк грн");
  assert.equal(rows[0].currency, "UAH");
  assert.equal(rows[0].amount, "1333,14");
  assert.equal(rows[0].usdAmount, "31,36");
  assert.equal(rows[0].comment, "manual_fact");
});

test("parseOstatkiValues preserves amount rate usd and comment columns", () => {
  const rows = parseOstatkiValues([
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
    ["2026-05-28", "binance save", "2020", "USDC", "1", "2020", "owner_confirmed"],
  ]);

  assert.deepEqual(rows, [
    {
      date: "2026-05-28",
      channel: "binance save",
      currency: "USDC",
      amount: "2020",
      rate: "1",
      usdAmount: "2020",
      comment: "owner_confirmed",
    },
  ]);
});

test("parseJsonBody supports already parsed and string payloads", () => {
  assert.deepEqual(parseJsonBody({ action: "saveBalanceSnapshot" }), { action: "saveBalanceSnapshot" });
  assert.deepEqual(parseJsonBody('{"action":"saveBalanceSnapshot"}'), { action: "saveBalanceSnapshot" });
});
