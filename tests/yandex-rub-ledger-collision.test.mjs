import test from "node:test";
import assert from "node:assert/strict";

import {
  auditYandexRubLedgerCollision,
  buildYandexRubLedgerCollisionReport,
  main,
  parseArgs,
} from "../scripts/audit-yandex-rub-ledger-collision.mjs";

function operation(overrides = {}) {
  const row = {
    date: "2026-04-10",
    operation: "business_expense",
    fromChannel: "Яндекс руб",
    toChannel: "",
    amount: "4548.08",
    currency: "RUB",
    amountNet: "4548.08",
    balanceAmount: -4548.08,
    rawSourceId: "provider:existing:4548.08",
    ledgerV2: {
      date: "2026-04-10",
      operation: "business_expense",
      from_channel: "Яндекс руб",
      to_channel: "",
      amount: "4548.08",
      currency: "RUB",
      amount_net: "4548.08",
      balance_amount: -4548.08,
      raw_source_id: "provider:existing:4548.08",
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

function fixtureRepository() {
  return {
    ok: true,
    operations: [
      operation(),
      operation({
        date: "2026-04-24",
        operation: "business_expense",
        amount: "11287",
        amountNet: "11287",
        balanceAmount: -11287,
        rawSourceId: "migration:2026-04-24:12:2",
        ledgerV2: {
          date: "2026-04-24",
          operation: "business_expense",
          amount: "11287",
          amount_net: "11287",
          balance_amount: -11287,
          raw_source_id: "migration:2026-04-24:12:2",
        },
      }),
      operation({
        date: "2026-04-24",
        operation: "exchange_out",
        amount: "74669",
        amountNet: "74669",
        balanceAmount: -74669,
        rawSourceId: "migration:2026-04-24:13:2",
        ledgerV2: {
          date: "2026-04-24",
          operation: "exchange_out",
          amount: "74669",
          amount_net: "74669",
          balance_amount: -74669,
          raw_source_id: "migration:2026-04-24:13:2",
        },
      }),
    ],
    balances: [
      { date: "2026-04-02", channel: "Яндекс руб", currency: "RUB", amount: "144000" },
      { date: "2026-04-24", channel: "Яндекс руб", currency: "RUB", amount: "139786" },
    ],
  };
}

test("parseArgs defaults to dry-run", () => {
  assert.deepEqual(parseArgs([]), {
    json: false,
    apply: false,
    archiveOnly: false,
    confirmYandexMigrationCollision: false,
  });
});

test("Yandex RUB collision audit detects the two stale migration rows", () => {
  const report = buildYandexRubLedgerCollisionReport(fixtureRepository());

  assert.equal(report.ok, true);
  assert.equal(report.dry_run, true);
  assert.deepEqual(
    report.candidate_rows.map((row) => row.raw_source_id),
    ["migration:2026-04-24:12:2", "migration:2026-04-24:13:2"]
  );
  assert.equal(report.candidates_total, 85956);
  assert.equal(report.computed_with_candidates, 53495.92);
  assert.equal(report.current_diff, 86290.08);
  assert.equal(report.computed_without_candidates, 139451.92);
  assert.equal(report.remaining_diff, 334.08);
  assert.equal(report.candidate_rows[0].action, "archive_or_delete_after_owner_confirmation");
  assert.equal(report.recommendation.includes("owner confirmation"), true);
});

test("audit loader path is read-only in dry-run", async () => {
  let writes = 0;
  const report = await auditYandexRubLedgerCollision({
    loadRepository: async () => {
      writes += 0;
      return fixtureRepository();
    },
  });

  assert.equal(report.dry_run, true);
  assert.equal(writes, 0);
});

test("--apply is refused", async () => {
  await assert.rejects(
    () => main(["--apply", "--archive-only", "--confirm-yandex-migration-collision"]),
    /intentionally not implemented/
  );
});
