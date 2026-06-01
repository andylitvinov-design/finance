import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalBalanceTotal,
  buildCanonicalBalanceTotalFromSnapshots,
} from "../server/canonical-balance-total.js";

test("canonical balance total refuses mismatched selected-date and period totals", () => {
  const result = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: 7985.2535,
    selectedDateStatus: "ok",
    periodTotalUsd: 27322.5439,
    periodStatus: "ok",
  });

  assert.deepEqual(result, {
    source: "needs_verification",
    selected_date_total_usd: 7985.2535,
    period_total_usd: 27322.5439,
    canonical_total_usd: null,
    delta_usd: -19337.2904,
    totals_match: false,
    status: "mismatch",
    explanation: "Selected-date and period USD totals differ beyond tolerance; canonical total needs verification.",
  });
});

test("canonical balance total refuses incomplete selected-date coverage as canonical", () => {
  const result = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: 7985.2535,
    selectedDateStatus: "partial",
    periodTotalUsd: 27322.5439,
    periodStatus: "ok",
  });

  assert.equal(result.source, "needs_verification");
  assert.equal(result.canonical_total_usd, null);
  assert.equal(result.status, "needs_verification");
  assert.equal(result.selected_date_total_usd, 7985.2535);
  assert.equal(result.period_total_usd, 27322.5439);
  assert.equal(result.totals_match, false);
});

test("canonical balance total refuses fx_missing period total as canonical", () => {
  const result = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: null,
    selectedDateStatus: "needs_verification",
    periodTotalUsd: 987.65,
    periodStatus: "fx_missing",
  });

  assert.equal(result.source, "needs_verification");
  assert.equal(result.canonical_total_usd, null);
  assert.equal(result.status, "fx_missing");
  assert.equal(result.totals_match, false);
  assert.match(result.explanation, /period reconciliation/i);
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

test("canonical balance total returns ok when selected-date and period totals match", () => {
  const result = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: 20655.1234,
    selectedDateStatus: "ok",
    periodTotalUsd: 20655.12,
    periodStatus: "ok",
  });

  assert.equal(result.source, "selected_date_snapshot");
  assert.equal(result.canonical_total_usd, 20655.1234);
  assert.equal(result.status, "ok");
  assert.equal(result.totals_match, true);
});
