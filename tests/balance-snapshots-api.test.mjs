import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBalanceSnapshotsSnapshot,
  buildBalanceSnapshotsSummary,
} from "../api/balance-snapshots.js";

test("balance snapshots summary returns dates and account-currency coverage without leaking amounts", () => {
  const summary = buildBalanceSnapshotsSummary([
    { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1200" },
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1300" },
    { date: "2026-05-06", accountName: "БАНК КАНАДА cad", currency: "CAD", balanceAmount: "2380" },
  ]);

  assert.equal(summary.total_rows, 3);
  assert.equal(summary.valid_rows, 3);
  assert.equal(summary.incomplete_rows, 0);
  assert.deepEqual(summary.dates, ["2026-04-30", "2026-05-06"]);
  assert.deepEqual(summary.by_date, [
    { date: "2026-04-30", rows: 1, channel_currency_pairs: 1 },
    { date: "2026-05-06", rows: 2, channel_currency_pairs: 2 },
  ]);
  assert.deepEqual(summary.by_channel_currency, [
    {
      channel: "wise usd",
      currency: "USD",
      rows: 2,
      dates: ["2026-04-30", "2026-05-06"],
      first_date: "2026-04-30",
      last_date: "2026-05-06",
    },
    {
      channel: "БАНК КАНАДА cad",
      currency: "CAD",
      rows: 1,
      dates: ["2026-05-06"],
      first_date: "2026-05-06",
      last_date: "2026-05-06",
    },
  ]);
  assert.equal(JSON.stringify(summary).includes("1300"), false);
  assert.equal(JSON.stringify(summary).includes("2380"), false);
});

test("balance snapshots summary counts incomplete Остатки rows", () => {
  const summary = buildBalanceSnapshotsSummary([
    { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1300" },
    { date: "2026-05-06", channel: "wise usd", currency: "", amount: "1300" },
    { date: "2026-05-07", channel: "wise usd", currency: "USD", amount: "" },
    { date: "", channel: "wise usd", currency: "USD", amount: "1300" },
    { date: "2026-05-08", channel: "", currency: "USD", amount: "1300" },
  ]);

  assert.equal(summary.total_rows, 5);
  assert.equal(summary.valid_rows, 1);
  assert.equal(summary.incomplete_rows, 4);
  assert.equal(summary.missing_date_rows, 1);
  assert.equal(summary.missing_channel_rows, 1);
  assert.equal(summary.missing_currency_rows, 1);
  assert.equal(summary.missing_amount_rows, 1);
  assert.deepEqual(summary.incomplete_preview.map((row) => row.reason), [
    "missing_currency",
    "missing_amount",
    "missing_date",
    "missing_channel",
  ]);
});

test("balance snapshots API applies period filter and exposes inventory audit check", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      balances: [
        { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1200" },
        { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1300" },
        { date: "2026-05-07", channel: "wise usd", currency: "", amount: "1400" },
      ],
      warnings: [],
    }),
  });

  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.period, { from: "2026-05-01", to: "2026-05-31" });
  assert.deepEqual(snapshot.balance_snapshots.dates, ["2026-05-06"]);
  assert.equal(snapshot.balance_snapshots.total_rows, 2);
  assert.equal(snapshot.balance_snapshots.valid_rows, 1);
  assert.equal(snapshot.balance_snapshots.incomplete_rows, 1);
  assert.equal(
    snapshot.audit_checks.find((check) => check.name === "balance_snapshots_inventory")?.status,
    "needs verification"
  );
  assert.ok(snapshot.warnings.some((warning) => warning.includes("Остатки row(s) are incomplete")));
});

test("balance snapshots API returns safe empty snapshot when repository access fails", async () => {
  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: false,
      warning: "Manual Google Sheets overlay failed: service account credentials are not configured.",
    }),
  });

  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.period, { from: "2026-05-01", to: "2026-05-31" });
  assert.equal(snapshot.balance_snapshots.total_rows, 0);
  assert.equal(snapshot.audit_checks[0].status, "needs verification");
  assert.ok(snapshot.warnings.every((warning) => !warning.includes("credentials")));
  assert.ok(snapshot.warnings.some((warning) => warning.includes("service account access")));
});
