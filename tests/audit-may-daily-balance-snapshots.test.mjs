import test from "node:test";
import assert from "node:assert/strict";

import {
  auditDailyBalanceSnapshotCoverage,
  inspectRemaindersPopupSource,
} from "../scripts/audit-may-daily-balance-snapshots.mjs";

const expectedPairs = [
  { channel: "wise usd", currency: "USD" },
  { channel: "paypal usd", currency: "USD" },
];

test("May coverage audit detects missing dates", () => {
  const audit = auditDailyBalanceSnapshotCoverage({
    balanceSnapshots: {
      period: { from: "2026-05-01", to: "2026-05-03" },
      balance_snapshots: {
        selected_rows: [
          { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: 10 },
          { date: "2026-05-01", channel: "paypal usd", currency: "USD", amount: 20 },
        ],
      },
    },
    expectedPairs,
    from: "2026-05-01",
    to: "2026-05-03",
  });

  assert.deepEqual(audit.date_coverage.map((row) => [row.date, row.total_rows, row.status]), [
    ["2026-05-01", 2, "ok"],
    ["2026-05-02", 0, "missing"],
    ["2026-05-03", 0, "missing"],
  ]);
  assert.equal(audit.summary.missing_dates, 2);
});

test("May coverage audit detects channel count mismatch between 2026-05-20 and 2026-05-26", () => {
  const audit = auditDailyBalanceSnapshotCoverage({
    balanceSnapshots: {
      period: { from: "2026-05-20", to: "2026-05-26" },
      balance_snapshots: {
        selected_rows: [
          { date: "2026-05-20", channel: "wise usd", currency: "USD", amount: 10 },
          { date: "2026-05-24", channel: "wise usd", currency: "USD", amount: 10 },
          { date: "2026-05-26", channel: "wise usd", currency: "USD", amount: 11 },
          { date: "2026-05-26", channel: "paypal usd", currency: "USD", amount: 21 },
          { date: "2026-05-26", channel: "paypal usd", currency: "USD", amount: 21 },
        ],
      },
    },
    expectedPairs,
    from: "2026-05-20",
    to: "2026-05-26",
  });

  assert.equal(audit.key_date_comparison.left.date, "2026-05-20");
  assert.equal(audit.key_date_comparison.left.total_rows, 1);
  assert.equal(audit.key_date_comparison.right.date, "2026-05-26");
  assert.equal(audit.key_date_comparison.right.total_rows, 3);
  assert.deepEqual(audit.key_date_comparison.present_on_right_missing_on_left, ["paypal usd|USD"]);
  assert.deepEqual(audit.key_date_comparison.duplicates.right, [{ key: "paypal usd|USD", count: 2 }]);
  assert.match(audit.key_date_comparison.explanation, /duplicate/);
});

test("May coverage audit respects explicit expected pair active windows", () => {
  const audit = auditDailyBalanceSnapshotCoverage({
    balanceSnapshots: {
      balance_snapshots: {
        selected_rows: [
          { date: "2026-05-20", channel: "wise usd", currency: "USD", amount: 10 },
          { date: "2026-05-24", channel: "wise usd", currency: "USD", amount: 10 },
        ],
      },
    },
    expectedPairs: [
      { channel: "wise usd", currency: "USD" },
      { channel: "funding", currency: "USDT", active_from: "2026-05-24", inactive_reason: "trusted zero anchor starts 2026-05-24" },
      { channel: "save", currency: "USDC", active: false, inactive_reason: "provider returned missing_provider_balance" },
    ],
    from: "2026-05-20",
    to: "2026-05-24",
  });

  const may20 = audit.date_coverage.find((row) => row.date === "2026-05-20");
  const may24 = audit.date_coverage.find((row) => row.date === "2026-05-24");
  assert.equal(may20.status, "ok");
  assert.equal(may20.missing_expected_count, 0);
  assert.deepEqual(may20.excluded_expected.map((row) => row.key).sort(), ["funding|USDT", "save|USDC"]);
  assert.equal(may24.status, "partial");
  assert.deepEqual(may24.missing_channels, ["funding|USDT"]);
});

test("UI source check identifies saved snapshots and primary diagnostics table", () => {
  const result = inspectRemaindersPopupSource(`
    fetch("./api/balance-snapshots").then(() => selected_date_rows);
    renderSelectedDateSnapshotBlock(summary.selectedDateSnapshot);
    const details = doc.createElement("details");
    summary.rows.forEach((row) => row.needsVerification);
    "Частичное покрытие";
  `);

  assert.equal(result.uses_balance_snapshots_selected_date_rows, true);
  assert.equal(result.renders_reconciliation_table_as_primary, false);
  assert.equal(result.has_collapsed_diagnostics, true);
  assert.equal(result.has_partial_coverage_warning, true);
});
