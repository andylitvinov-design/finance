import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOwnerMayOpeningBalanceSeed,
  isOwnerCombinedBinanceSaveRow,
} from "../server/may-2026-owner-opening-balances.js";

function ownerMayOpeningTotalUsd(rows = []) {
  return (rows || []).reduce((sum, row) => sum + Number(row.usdAmount || row.amount || 0), 0);
}

test("applyOwnerMayOpeningBalanceSeed splits owner combined binance save row into USDT and USDC", () => {
  const rows = [
    {
      date: "2026-05-01",
      channel: "binance save",
      amount: "8519",
      balanceAmount: "8519",
      currency: "USD",
      usdAmount: "8519",
    },
    {
      date: "2026-05-01",
      channel: "binance save",
      amount: "100",
      balanceAmount: "100",
      currency: "USDC",
    },
  ];

  const next = applyOwnerMayOpeningBalanceSeed(rows);
  const usdt = next.filter((row) => row.channel === "binance save" && String(row.currency).toUpperCase() === "USDT");
  const usdc = next.filter((row) => row.channel === "binance save" && String(row.currency).toUpperCase() === "USDC");
  const usd = next.filter((row) => row.channel === "binance save" && String(row.currency).toUpperCase() === "USD");

  assert.equal(usd.length, 0);
  assert.equal(usdt.length, 1);
  assert.equal(usdc.length, 1);
  assert.equal(Number(usdt[0].amount), 5411.6278);
  assert.equal(Number(usdc[0].amount), 3107.3722);
  assert.equal(Number(usdt[0].amount) + Number(usdc[0].amount), 8519);
  assert.equal(usdt[0].adjustmentReason, "owner_combined_usdt_usdc_split");
  assert.equal(usdc[0].adjustmentReason, "owner_combined_usdt_usdc_split");
  assert.deepEqual(rows[1].amount, "100");

  const total = ownerMayOpeningTotalUsd([
    ...next,
    { date: "2026-05-01", channel: "binance spot", currency: "USD", amount: "16474", usdAmount: "16474" },
  ]);
  assert.equal(total, 24993);
});

test("applyOwnerMayOpeningBalanceSeed replaces stale May opening anchors when combined anchor is present", () => {
  const rows = [
    { date: "2026-05-01", channel: "binance save", amount: "8519", balanceAmount: "8519", currency: "USD", usdAmount: "8519" },
    { date: "2026-05-01", channel: "binance save", amount: "100", balanceAmount: "100", currency: "USDT", usdAmount: "100", comment: "stale" },
    { date: "2026-05-01", channel: "binance save", amount: "200", balanceAmount: "200", currency: "USDC", usdAmount: "200", comment: "stale" },
    { date: "2026-05-01", channel: "other", amount: "1", balanceAmount: "1", currency: "USD", usdAmount: "1" },
  ];

  const next = applyOwnerMayOpeningBalanceSeed(rows);
  const usdt = next.filter((row) => row.channel === "binance save" && String(row.currency).toUpperCase() === "USDT");
  const usdc = next.filter((row) => row.channel === "binance save" && String(row.currency).toUpperCase() === "USDC");
  const usd = next.filter((row) => row.channel === "binance save" && String(row.currency).toUpperCase() === "USD");
  const other = next.filter((row) => row.channel === "other");

  assert.equal(usd.length, 0);
  assert.equal(usdt.length, 1);
  assert.equal(usdc.length, 1);
  assert.equal(Number(usdt[0].amount), 5411.6278);
  assert.equal(Number(usdc[0].amount), 3107.3722);
  const saveTotal = ownerMayOpeningTotalUsd(next.filter((row) => row.channel === "binance save"));
  assert.equal(saveTotal, 8519);
  assert.equal(other.length, 1);
});

test("applyOwnerMayOpeningBalanceSeed is no-op when no owner combined row exists", () => {
  const rows = [{ date: "2026-05-01", channel: "binance save", amount: "5000", balanceAmount: "5000", currency: "USDT" }];
  const next = applyOwnerMayOpeningBalanceSeed(rows);
  assert.equal(next.length, 1);
  assert.equal(next[0].currency, "USDT");
});

test("isOwnerCombinedBinanceSaveRow detects combined USD opening row", () => {
  const row = {
    date: "2026-05-01",
    channel: "binance save",
    currency: "USD",
    amount: "8519",
    usdAmount: "8519",
  };
  const notMatch = {
    date: "2026-05-02",
    channel: "binance save",
    currency: "USD",
    amount: "8519",
    usdAmount: "8519",
  };
  assert.equal(isOwnerCombinedBinanceSaveRow(row), true);
  assert.equal(isOwnerCombinedBinanceSaveRow(notMatch), false);
});
