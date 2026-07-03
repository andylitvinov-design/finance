import test from "node:test";
import assert from "node:assert/strict";

import { buildPeriodBalanceReconciliationSnapshot } from "../server/period-balance-reconciliation-route.js";

// Regression for the July binance save / USDC block: the fresh USDC fact was stored
// under the OCR-truncated alias channel "binance save uf". Before the fix the engine
// grouped it as its own position and left canonical "binance save"/USDC anchored to a
// stale opening fact -> missing_provider_balance (blocked). The route must canonicalize
// alias channels so the fresh fact lands on the canonical wallet and the block clears.
test("period reconciliation folds 'binance save uf' USDC fact into canonical 'binance save' and clears the block", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-07-01", to: "2026-07-03" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      plannedRows: [],
      balances: [
        // Stale canonical opening fact (the pre-fix anchor that caused the block)
        { date: "2026-05-01", channel: "binance save", currency: "USDC", amount: "3107.3722" },
        // Fresh fact stored under the OCR alias channel
        { date: "2026-06-26", channel: "binance save uf", currency: "USDC", amount: "2026" },
      ],
      fxRates: [],
      warnings: [],
    }),
  });

  const positions = snapshot.period_balance_reconciliation.by_channel_currency;
  const usdc = positions.filter((p) => p.currency === "USDC");

  // The alias position must NOT survive as its own row.
  assert.equal(usdc.some((p) => p.channel === "binance save uf"), false, "alias channel should be folded");

  const canonical = usdc.find((p) => p.channel === "binance save");
  assert.ok(canonical, "canonical binance save/USDC position must exist");
  assert.notEqual(canonical.status, "missing_provider_balance", "canonical USDC must no longer be blocked");
});
