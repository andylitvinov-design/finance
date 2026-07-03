import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalOstatkiChannel, buildOstatkiKey } from "../api/save-balance-snapshot.js";

// Regression: the 2026-06-26 OCR snapshot stored the binance save wallet under the
// truncated alias "binance save uf". canonicalOstatkiChannel must fold it back to
// "binance save" so the period reconciliation sees the fresh USDC fact under the
// canonical wallet instead of blocking on the stale 2026-05-01 fact.
test("canonicalOstatkiChannel folds OCR alias 'binance save uf' into 'binance save'", () => {
  assert.equal(canonicalOstatkiChannel("binance save uf"), "binance save");
  assert.equal(canonicalOstatkiChannel("binance save uf usdc"), "binance save");
  assert.equal(canonicalOstatkiChannel("Binance Save UF"), "binance save");
});

test("canonicalOstatkiChannel keeps the canonical wallet and unrelated channels intact", () => {
  assert.equal(canonicalOstatkiChannel("binance save"), "binance save");
  assert.equal(canonicalOstatkiChannel("binance save usdc"), "binance save");
  // Deferred aliases must NOT be folded by this change (they collide with canonical facts).
  assert.equal(canonicalOstatkiChannel("binance save u"), "binance save u");
  assert.equal(canonicalOstatkiChannel("binance spot ц"), "binance spot ц");
  assert.equal(canonicalOstatkiChannel("Бинанс spot us"), "Бинанс spot us");
});

test("buildOstatkiKey groups the alias row with the canonical binance save USDC position", () => {
  const canonical = buildOstatkiKey({ date: "2026-06-26", channel: "binance save", currency: "USDC" });
  const alias = buildOstatkiKey({ date: "2026-06-26", channel: "binance save uf", currency: "USDC" });
  assert.equal(alias, canonical);
});
