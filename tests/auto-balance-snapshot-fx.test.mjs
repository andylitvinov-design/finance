import test from "node:test";
import assert from "node:assert/strict";

import { buildAutoBalanceSnapshotRow } from "../server/auto-balance-snapshots.js";

test("auto balance snapshot does not invent USD for non-USD native amount without trusted FX", () => {
  const row = buildAutoBalanceSnapshotRow({
    date: "2026-06-01",
    provider: "wise",
    channel: "трансервайз евро",
    amount: "100",
    currency: "EUR",
    status: "ok",
  });

  assert.equal(row.amount, "100");
  assert.equal(row.currency, "EUR");
  assert.equal(row.rate, "");
  assert.equal(row.usdAmount, "");
  assert.equal(row.status, "fx_missing");
  assert.match(row.comment, /FX Rates/i);
});

test("auto balance snapshot treats USD stable currencies native amount as USD when amount_usd is missing", () => {
  const row = buildAutoBalanceSnapshotRow({
    date: "2026-06-01",
    provider: "binance",
    channel: "binance save",
    amount: "125.50",
    currency: "USDT",
    status: "ok",
  });

  assert.equal(row.rate, "1");
  assert.equal(Number(String(row.usdAmount).replace(",", ".")), 125.5);
  assert.equal(row.status, "ok");
});
