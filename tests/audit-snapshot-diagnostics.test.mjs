import test from "node:test";
import assert from "node:assert/strict";

import { buildAuditSnapshot } from "../api/audit-snapshot.js";

function ledgerOperation(overrides = {}) {
  const row = {
    date: "2026-05-02",
    operation: "income",
    fromChannel: "",
    toChannel: "cash usd",
    amount: "100",
    currency: "USD",
    amountUsd: "100",
    amountGross: "100",
    amountFee: "",
    amountNet: "100",
    source: "other",
    rawSourceId: "SHOULD_NOT_EXPOSE",
    sourceTransactionId: "SHOULD_NOT_EXPOSE",
    counterparty: "SHOULD_NOT_EXPOSE",
    comment: "SHOULD_NOT_EXPOSE",
    ledgerV2: {
      date: "2026-05-02",
      operation: "income",
      from_channel: "",
      to_channel: "cash usd",
      amount: "100",
      currency: "USD",
      amount_usd: "100",
      amount_gross: "100",
      amount_fee: "",
      amount_net: "100",
      balance_amount: 100,
      category: "service",
      source: "other",
      external_id: "SHOULD_NOT_EXPOSE",
      raw_source_id: "SHOULD_NOT_EXPOSE",
      comment: "SHOULD_NOT_EXPOSE",
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

function repositoryFixture() {
  return {
    ok: true,
    schema: "ledger-v2-compatible",
    operations: [ledgerOperation()],
    transfers: [],
    balances: [],
    commissionRows: [],
    views: { byDateChannel: [], byCategory: [] },
    warnings: [],
  };
}

async function buildFixtureSnapshot(query = {}) {
  return await buildAuditSnapshot({
    query,
    repositoryLoader: async () => repositoryFixture(),
  });
}

test("audit snapshot exposes sanitized unknown source diagnostics", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.summary.unknown_source_rows, 1);
  assert.ok(response.diagnostics);
  assert.equal(response.diagnostics.unknown_source_row_samples.length, 1);

  const sample = response.diagnostics.unknown_source_row_samples[0];
  assert.deepEqual(Object.keys(sample).sort(), [
    "amount_net_present",
    "amount_usd_present",
    "category",
    "classification",
    "currency",
    "date",
    "from_channel",
    "ledger_source",
    "operation",
    "raw_source",
    "to_channel",
  ].sort());

  assert.equal(sample.date, "2026-05-02");
  assert.equal(sample.operation, "income");
  assert.equal(sample.to_channel, "cash usd");
  assert.equal(sample.currency, "USD");
  assert.equal(sample.raw_source, "other");
  assert.equal(sample.ledger_source, "other");
  assert.equal(sample.classification, "unknown");
  assert.equal(sample.amount_usd_present, true);
  assert.equal(sample.amount_net_present, true);

  const serialized = JSON.stringify(sample).toLowerCase();
  for (const forbidden of [
    "raw_source_id",
    "external_id",
    "sourcetransactionid",
    "counterparty",
    "comment",
    "should_not_expose",
    "access_token",
    "refresh_token",
    "client_secret",
    "private_key",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `sample exposed ${forbidden}`);
  }
});

test("audit snapshot handoff mode preserves unknown source diagnostics", async () => {
  const response = await buildFixtureSnapshot({ mode: "handoff" });

  assert.equal(response.audit_handoff.compact, true);
  assert.ok(response.diagnostics);
  assert.equal(response.diagnostics.unknown_source_row_samples.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(response.daily_balances, "rows"), false);
});
