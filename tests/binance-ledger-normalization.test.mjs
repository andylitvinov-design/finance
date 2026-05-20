import test from "node:test";
import assert from "node:assert/strict";

import {
  MANUAL_LEDGER_SOURCES,
  normalizeManualLedgerChannel,
  normalizeManualLedgerSource,
  resolveManualLedgerSource,
} from "../server/manual-ledger-maps.js";

const CHANNELS = [
  "Бинанс spot",
  "Binance funding",
  "binance save",
  "пейпал дол",
  "трансервайз дол",
];

test("server ledger source vocabulary includes Binance as a first-class manual source", () => {
  assert.equal(MANUAL_LEDGER_SOURCES.includes("binance"), true);
  assert.equal(normalizeManualLedgerSource("binance"), "binance");
  assert.equal(normalizeManualLedgerSource("binance spot"), "binance");
  assert.equal(normalizeManualLedgerSource("binance save"), "binance");
  assert.equal(normalizeManualLedgerSource("USDT TRC20"), "binance");
  assert.equal(normalizeManualLedgerSource("USDC ERC20"), "binance");
});

test("server ledger infers Binance source from raw_source_id and channels", () => {
  assert.equal(resolveManualLedgerSource("", "binance:txn-1"), "binance");
  assert.equal(resolveManualLedgerSource("binance_pay", "binance_pay_send:1"), "binance_pay");
  assert.equal(resolveManualLedgerSource("", "usdt:txn-1"), "binance");
  assert.equal(resolveManualLedgerSource("", "", "", { to_channel: "Бинанс spot" }), "binance");
  assert.equal(resolveManualLedgerSource("", "", "", { from_channel: "Binance funding" }), "binance");
  assert.equal(resolveManualLedgerSource("", "", "", { from_channel: "binance save" }), "binance");
});

test("server ledger keeps existing channel precedence when exchange rows mention Binance", () => {
  assert.equal(resolveManualLedgerSource("mcp", "", "", {
    from_channel: "Яндекс руб",
    to_channel: "Бинанс spot",
  }), "yoomoney");
});

test("server ledger keeps Binance spot and Binance save as distinct balance channels", () => {
  assert.equal(normalizeManualLedgerChannel("binance spot", CHANNELS), "Бинанс spot");
  assert.equal(normalizeManualLedgerChannel("бинанс", CHANNELS), "Бинанс spot");
  assert.equal(normalizeManualLedgerChannel("funding wallet", CHANNELS), "Binance funding");
  assert.equal(normalizeManualLedgerChannel("binance save", CHANNELS), "binance save");
  assert.equal(normalizeManualLedgerChannel("binance savings", CHANNELS), "binance save");
});
