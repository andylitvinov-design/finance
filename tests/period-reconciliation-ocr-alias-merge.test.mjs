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

test("period reconciliation reports deferred OCR alias collisions without folding them", async () => {
  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: { from: "2026-06-26", to: "2026-06-26" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      plannedRows: [],
      balances: [
        { date: "2026-06-26", channel: "binance save", currency: "USDT", amount: "5418.1211" },
        { date: "2026-06-26", channel: "binance save u", currency: "USDT", amount: "5419" },
        { date: "2026-06-26", channel: "Бинанс spot", currency: "USDC", amount: "1.0274" },
        { date: "2026-06-26", channel: "binance spot ц", currency: "USDC", amount: "1" },
        { date: "2026-06-26", channel: "Бинанс spot", currency: "USDT", amount: "2308.78" },
        { date: "2026-06-26", channel: "Бинанс spot us", currency: "USDT", amount: "882" },
        { date: "2026-06-26", channel: "binance save uf", currency: "USDC", amount: "2026" },
      ],
      fxRates: [],
      warnings: [],
    }),
  });

  const reconciliation = snapshot.period_balance_reconciliation;
  const collisions = reconciliation.diagnostics.ocr_alias_collisions;

  assert.equal(collisions.length, 3);
  assert.deepEqual(
    collisions.map((item) => ({
      alias: item.alias_channel,
      canonical: item.candidate_canonical_channel,
      currency: item.currency,
      status: item.status,
    })),
    [
      {
        alias: "binance save u",
        canonical: "binance save",
        currency: "USDT",
        status: "needs_owner_resolution",
      },
      {
        alias: "binance spot ц",
        canonical: "Бинанс spot",
        currency: "USDC",
        status: "needs_owner_resolution",
      },
      {
        alias: "Бинанс spot us",
        canonical: "Бинанс spot",
        currency: "USDT",
        status: "possible_separate_wallet",
      },
    ]
  );

  const positions = reconciliation.by_channel_currency;
  assert.ok(
    positions.some((row) => row.channel === "binance save u" && row.currency === "USDT"),
    "deferred binance save u alias must stay as its own row"
  );
  assert.ok(
    positions.some((row) => row.channel === "binance spot ц" && row.currency === "USDC"),
    "deferred binance spot ц alias must stay as its own row"
  );
  assert.ok(
    positions.some((row) => row.channel === "Бинанс spot us" && row.currency === "USDT"),
    "possible separate wallet must stay as its own row"
  );
  assert.equal(
    positions.some((row) => row.channel === "binance save uf" && row.currency === "USDC"),
    false,
    "confirmed binance save uf alias must still fold"
  );
  assert.ok(
    snapshot.warnings.some((warning) => warning.includes("ocr alias collision")),
    "top-level warnings should include a human-readable OCR collision warning"
  );
});
