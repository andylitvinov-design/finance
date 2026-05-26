import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRepairMayDailyBalanceSnapshotsReport,
  parseArgs,
} from "../scripts/repair-may-daily-balance-snapshots.mjs";

const header = ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"];

test("repair May daily balance snapshots dry-run reports duplicates without writing", async () => {
  let writeCalled = false;
  const report = await buildRepairMayDailyBalanceSnapshotsReport({
    from: "2026-05-22",
    to: "2026-05-22",
    readValues: async () => [
      header,
      ["2026-05-22", "paypal", "пейпал дол", "10", "USD", "1", "10", "provider_auto", "2026-05-22T23:00:00.000Z", "paypal:old", "ok", "auto"],
      ["2026-05-22", "derived", " пейпал   дол ", "10", "usd", "1", "10", "derived_from_confirmed_balance", "2026-05-22T22:00:00.000Z", "derived:old", "derived_from_confirmed_balance", "derived"],
      ["2026-05-23", "paypal", "пейпал дол", "11", "USD", "1", "11", "provider_auto", "2026-05-23T23:00:00.000Z", "paypal:next", "ok", "auto"],
    ],
    writeValues: async () => {
      writeCalled = true;
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.equal(writeCalled, false);
  assert.equal(report.duplicate_groups_count, 1);
  assert.equal(report.removed_rows_count, 1);
  assert.equal(report.duplicate_groups[0].key, "2026-05-22|пейпал дол|USD");
  assert.equal(report.duplicate_groups[0].kept.raw_source_id, "paypal:old");
  assert.deepEqual(report.save, { rowCount: 0, skipped: "dry_run" });
});

test("repair May daily balance snapshots apply writes deduped rows and keeps numeric zero", async () => {
  let writtenValues = null;
  const report = await buildRepairMayDailyBalanceSnapshotsReport({
    from: "2026-05-26",
    to: "2026-05-26",
    apply: true,
    confirm: "repair-may-2026-daily-balance-snapshots",
    readValues: async () => [
      header,
      ["2026-05-26", "wise", "REVOLUT фунт", "", "GBP", "", "", "provider_auto", "2026-05-26T20:00:00.000Z", "status-only", "provider_error", "status only"],
      ["2026-05-26", "derived", "REVOLUT фунт", "0", "GBP", "1", "0", "derived_from_confirmed_balance", "2026-05-26T19:00:00.000Z", "numeric-zero", "derived_from_confirmed_balance", "numeric zero"],
    ],
    writeValues: async (values) => {
      writtenValues = values;
      return { updatedRows: values.length };
    },
  });

  assert.equal(report.dryRun, false);
  assert.equal(report.duplicate_groups_count, 1);
  assert.equal(report.removed_rows_count, 1);
  assert.equal(report.duplicate_groups[0].kept.raw_source_id, "numeric-zero");
  assert.equal(writtenValues.length, 2);
  assert.deepEqual(writtenValues[1], ["2026-05-26", "derived", "REVOLUT фунт", "0", "GBP", "1", "0", "derived_from_confirmed_balance", "2026-05-26T19:00:00.000Z", "numeric-zero", "derived_from_confirmed_balance", "numeric zero"]);
  assert.equal(report.save.rowCount, 1);
});

test("repair May daily balance snapshots prefers provider auto rows over derived rows when both are numeric", async () => {
  const report = await buildRepairMayDailyBalanceSnapshotsReport({
    from: "2026-05-17",
    to: "2026-05-17",
    readValues: async () => [
      header,
      ["2026-05-17", "wise", "трансервайз евро", "0", "EUR", "1", "0", "wise_auto", "2026-05-17T23:00:00.000Z", "wise-provider", "zero_balance", "auto daily provider snapshot"],
      ["2026-05-17", "derived", "трансервайз евро", "0", "EUR", "1", "0", "provider_auto", "2026-05-18T00:00:00.000Z", "derived-provider", "derived_from_confirmed_balance", "derived from confirmed balance with extra metadata"],
    ],
  });

  assert.equal(report.duplicate_groups_count, 1);
  assert.equal(report.duplicate_groups[0].kept.raw_source_id, "wise-provider");
  assert.equal(report.duplicate_groups[0].removed[0].raw_source_id, "derived-provider");
});

test("repair May daily balance snapshots refuses apply without confirmation", async () => {
  await assert.rejects(
    () => buildRepairMayDailyBalanceSnapshotsReport({
      from: "2026-05-26",
      to: "2026-05-26",
      apply: true,
      readValues: async () => [header],
      writeValues: async () => {
        throw new Error("must not write");
      },
    }),
    /confirm=repair-may-2026-daily-balance-snapshots/
  );
});

test("repair May daily balance snapshots parses dry-run arguments by default", () => {
  assert.deepEqual(parseArgs(["--from=2026-05-01", "--to", "2026-05-31", "--json"]), {
    from: "2026-05-01",
    to: "2026-05-31",
    apply: false,
    confirm: "",
    json: true,
    help: false,
  });
});
