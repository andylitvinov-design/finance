import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalBalanceTotal,
  buildCanonicalBalanceTotalFromSnapshots,
} from "../server/canonical-balance-total.js";

test("canonical balance total prefers valid selected-date snapshot over period reconciliation", () => {
  const result = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: 1250.25,
    selectedDateStatus: "ok",
    periodTotalUsd: 1249,
  });

  assert.deepEqual(result, {
    source: "selected_date_snapshot",
    selected_date_total_usd: 1250.25,
    period_total_usd: 1249,
    canonical_total_usd: 1250.25,
    delta_usd: 1.25,
    totals_match: false,
    status: "ok",
    explanation: "Using selected-date balance snapshot as canonical total.",
  });
});

test("canonical balance total falls back to period reconciliation when selected date is unavailable", () => {
  const result = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: null,
    selectedDateStatus: "needs_verification",
    periodTotalUsd: 987.65,
    periodStatus: "fx_missing",
  });

  assert.equal(result.source, "period_reconciliation");
  assert.equal(result.canonical_total_usd, 987.65);
  assert.equal(result.status, "fx_missing");
  assert.equal(result.totals_match, false);
  assert.match(result.explanation, /selected-date/i);
});

test("canonical balance total returns needs_verification when no trusted total exists", () => {
  const result = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: null,
    periodTotalUsd: null,
  });

  assert.equal(result.source, "needs_verification");
  assert.equal(result.canonical_total_usd, null);
  assert.equal(result.status, "needs_verification");
  assert.equal(result.totals_match, false);
});

test("canonical balance total can be derived from snapshot payloads", () => {
  const result = buildCanonicalBalanceTotalFromSnapshots({
    selectedDateSnapshot: {
      canonical_total_usd: 300,
      selected_date_coverage: { status: "ok" },
    },
    periodReconciliation: {
      total_usd_row: { confirmed_end_usd: 300.004, status: "ok" },
    },
  });

  assert.equal(result.source, "selected_date_snapshot");
  assert.equal(result.canonical_total_usd, 300);
  assert.equal(result.totals_match, true);
});
