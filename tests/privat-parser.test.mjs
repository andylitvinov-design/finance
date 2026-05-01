import test from "node:test";
import assert from "node:assert/strict";

import { parsePrivatStatement } from "../privat-parser.js";

test("parsePrivatStatement maps JSON UAH rows with fallback USD", () => {
  const rows = parsePrivatStatement([
    {
      id: "PB-JSON-1",
      date: "2026-04-20",
      amount: "-4386",
      currency: "UAH",
      description: "Оплата сервісу",
      counterparty: "ТОВ Сервіс"
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, "business_expense");
  assert.equal(rows[0].from_channel, "приват 24-грн");
  assert.equal(rows[0].amount_usd, "100");
  assert.equal(rows[0].counterparty, "ТОВ Сервіс");
  assert.equal(rows[0].external_id, "PB-JSON-1");
});

test("parsePrivatStatement maps CSV rows with decimal comma", () => {
  const rows = parsePrivatStatement("date;amount;currency;description;counterparty;external_id\n20.04.2026;4517,60;UAH;Оплата кави;Cafe;PB-CSV-1");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-04-20");
  assert.equal(rows[0].amount, "4517.6");
  assert.equal(rows[0].amount_usd, "103.0005");
  assert.equal(rows[0].description, "Оплата кави");
});

test("parsePrivatStatement maps fallback text rows", () => {
  const rows = parsePrivatStatement("20.04.2026 Оплата сервісу -4386 UAH");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-04-20");
  assert.equal(rows[0].currency, "UAH");
  assert.equal(rows[0].amount_usd, "100");
});

test("parsePrivatStatement splits exchange into out and in ledger rows", () => {
  const rows = parsePrivatStatement([
    {
      id: "PB-EX-1",
      date: "2026-04-21",
      type: "exchange",
      amount: "-4300",
      currency: "UAH",
      toAmount: "100",
      toCurrency: "USD",
      description: "Обмін валюти"
    }
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.operation), ["exchange_out", "exchange_in"]);
  assert.equal(rows[0].from_channel, "приват 24-грн");
  assert.equal(rows[1].to_channel, "приват 24-дол");
  assert.equal(rows[0].transfer_group_id, "PB-EX-1");
  assert.equal(rows[1].transfer_group_id, "PB-EX-1");
  assert.equal(rows[0].amount_usd, "-98.0392");
  assert.equal(rows[1].amount_usd, "100");
});
