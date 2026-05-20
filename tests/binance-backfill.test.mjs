import test from "node:test";
import assert from "node:assert/strict";

import { buildLedgerRow, LEDGER_HEADERS } from "../scripts/binance-backfill.mjs";

test("Binance backfill rows match the live Ledger header order", () => {
  assert.deepEqual(LEDGER_HEADERS, [
    "date",
    "operation",
    "from_channel",
    "to_channel",
    "amount",
    "currency",
    "amount_usd",
    "category",
    "subcategory",
    "direction",
    "comment",
    "source",
    "raw_source_id",
    "transfer_group_id",
    "created_at",
    "updated_at",
    "amount_gross",
    "amount_fee",
    "amount_net",
  ]);

  const row = buildLedgerRow({
    date: "2026-05-10",
    operation: "income",
    toChannel: "Бинанс spot",
    localAmount: 0.016438,
    currency: "USDT",
    netAmount: 0.016438,
    feeAmount: 0,
    suggestedCategory: "servicein",
    direction: "in",
    comment: "wallet evidence",
    source: "binance_earn_interest",
    rawSourceId: "binance_earn_interest:1",
  }, "2026-05-20T22:26:06.157Z");

  const object = Object.fromEntries(LEDGER_HEADERS.map((header, index) => [header, row[index]]));
  assert.equal(object.category, "servicein");
  assert.equal(object.direction, "in");
  assert.equal(object.source, "binance");
  assert.equal(object.raw_source_id, "binance_earn_interest:1");
  assert.equal(object.amount_gross, "0.016438");
  assert.equal(object.amount_fee, "0");
  assert.equal(object.amount_net, "0.016438");
});
