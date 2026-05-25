import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBackfillDailyBalanceSnapshotsReport,
  parseArgs,
} from "../scripts/backfill-daily-balance-snapshots.mjs";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-17",
    fromChannel: "wise usd",
    toChannel: "",
    currency: "USD",
    amountNet: "10",
    balanceAmount: -10,
    ledgerV2: {
      date: "2026-05-17",
      operation: "expense",
      from_channel: "wise usd",
      to_channel: "",
      currency: "USD",
      amount_net: "10",
      balance_amount: -10,
    },
  };
  return {
    ...row,
    ...overrides,
    ledgerV2: {
      ...row.ledgerV2,
      ...(overrides.ledgerV2 || {}),
    },
  };
}

test("backfill daily balance snapshots dry-run plans derived rows without writing", async () => {
  let saveCalled = false;
  const report = await buildBackfillDailyBalanceSnapshotsReport({
    from: "2026-05-17",
    to: "2026-05-17",
    apply: false,
    now: new Date("2026-05-26T10:00:00.000Z"),
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-16", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      operations: [operation()],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
    saveRows: async () => {
      saveCalled = true;
      throw new Error("dry-run must not write");
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.target_sheet, "Авто Остатки");
  assert.equal(saveCalled, false);
  assert.equal(report.planned_rows.length, 1);
  assert.deepEqual(report.planned_rows[0], {
    date: "2026-05-17",
    provider: "derived",
    channel: "wise usd",
    amount: 90,
    currency: "USD",
    source: "derived_from_confirmed_balance",
    fetchedAt: "2026-05-26T10:00:00.000Z",
    rawSourceId: "derived_from_confirmed_balance:2026-05-17:wise usd:USD",
    status: "derived_from_confirmed_balance",
    comment: "Derived from confirmed manual_fact balance on 2026-05-16 plus Ledger amount_net movements.",
  });
  assert.deepEqual(report.missing_anchors, []);
});

test("backfill daily balance snapshots reports missing anchors without inventing balances", async () => {
  const report = await buildBackfillDailyBalanceSnapshotsReport({
    from: "2026-05-17",
    to: "2026-05-17",
    apply: false,
    repositoryLoader: async () => ({
      ok: true,
      balances: [],
      operations: [operation({ fromChannel: "paypal usd", ledgerV2: { from_channel: "paypal usd" } })],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
  });

  assert.equal(report.planned_rows.length, 0);
  assert.deepEqual(report.missing_anchors, [
    { channel: "paypal usd", currency: "USD", status: "needs_opening_balance" },
  ]);
});

test("backfill daily balance snapshots apply writes only planned derived rows", async () => {
  const saved = [];
  const report = await buildBackfillDailyBalanceSnapshotsReport({
    from: "2026-05-17",
    to: "2026-05-17",
    apply: true,
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-05-16", channel: "wise usd", currency: "USD", amount: "100", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      operations: [operation()],
      warnings: [],
    }),
    autoBalanceLoader: async () => ({ ok: true, balances: [], warnings: [] }),
    saveRows: async (rows) => {
      saved.push(...rows);
      return { rowCount: rows.length, sheetName: "Авто Остатки" };
    },
  });

  assert.equal(report.dryRun, false);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source, "derived_from_confirmed_balance");
  assert.equal(report.save.rowCount, 1);
});

test("backfill daily balance snapshots parses dry-run arguments by default", () => {
  assert.deepEqual(parseArgs(["--from=2026-05-01", "--to", "2026-05-31", "--json"]), {
    from: "2026-05-01",
    to: "2026-05-31",
    apply: false,
    json: true,
    help: false,
  });
});
