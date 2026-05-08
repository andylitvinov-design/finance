import test from "node:test";
import assert from "node:assert/strict";

import { buildBalanceClose } from "../server/balance-close-engine.js";

test("balance close is blocked when missing amount_net fixes exist", () => {
  const result = buildBalanceClose({
    period: { from: "2026-05-06", to: "2026-05-06" },
    balanceCoverage: { summary: { mismatch: 0, needs_verification: 0, accounts_with_movement: 1 } },
    balanceFixes: { missing_amount_net_rows: [{}], missing_ostatki_rows: [] },
  });

  assert.equal(result.can_close, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.blocking_counts.missing_amount_net_rows, 1);
  assert.equal(result.steps[0].status, "blocked");
});

test("balance close is blocked when missing factual balance rows exist", () => {
  const result = buildBalanceClose({
    balanceCoverage: { summary: { mismatch: 0, needs_verification: 0, accounts_with_movement: 4 } },
    balanceFixes: { missing_amount_net_rows: [], missing_ostatki_rows: [{}, {}, {}, {}] },
  });

  assert.equal(result.can_close, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.blocking_counts.missing_ostatki_rows, 4);
  assert.equal(result.steps[1].status, "blocked");
});

test("balance close is blocked when mismatches exist", () => {
  const result = buildBalanceClose({
    balanceCoverage: { summary: { mismatch: 2, needs_verification: 0, accounts_with_movement: 2 } },
    balanceFixes: { missing_amount_net_rows: [], missing_ostatki_rows: [] },
  });

  assert.equal(result.can_close, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.blocking_counts.mismatch_rows, 2);
  assert.equal(result.steps[2].status, "blocked");
});

test("balance close needs verification when only verification rows exist", () => {
  const result = buildBalanceClose({
    balanceCoverage: { summary: { mismatch: 0, needs_verification: 1, accounts_with_movement: 1 } },
    balanceFixes: { missing_amount_net_rows: [], missing_ostatki_rows: [] },
  });

  assert.equal(result.can_close, false);
  assert.equal(result.status, "needs_verification");
  assert.equal(result.blocking_counts.needs_verification_rows, 1);
});

test("balance close is closable when all blockers are absent", () => {
  const result = buildBalanceClose({
    period: { from: "2026-04-30", to: "2026-04-30" },
    balanceCoverage: { summary: { mismatch: 0, needs_verification: 0, accounts_with_movement: 4 } },
    balanceFixes: { missing_amount_net_rows: [], missing_ostatki_rows: [] },
  });

  assert.equal(result.can_close, true);
  assert.equal(result.status, "closable");
  assert.equal(result.blocking_counts.missing_amount_net_rows, 0);
  assert.equal(result.blocking_counts.missing_ostatki_rows, 0);
  assert.match(result.message, /Можно закрыть/);
});
