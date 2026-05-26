import test from "node:test";
import assert from "node:assert/strict";

import { buildAuditSnapshot } from "../api/audit-snapshot.js";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-11",
    operation: "income",
    fromChannel: "",
    toChannel: "wise usd",
    amount: "206",
    currency: "USD",
    amountUsd: "206",
    amountNet: "206",
    source: "wise",
    ledgerV2: {
      date: "2026-05-11",
      operation: "income",
      from_channel: "",
      to_channel: "wise usd",
      amount: "206",
      currency: "USD",
      amount_usd: "206",
      amount_net: "206",
      balance_amount: 206,
      source: "wise",
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

async function snapshotFor({ operations, balances }) {
  return buildAuditSnapshot({
    query: { from: "2026-05-11", to: "2026-05-11" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations,
      balances,
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });
}

test("audit snapshot reports daily balance mismatch rows with formula fields", async () => {
  const snapshot = await snapshotFor({
    operations: [operation()],
    balances: [
      { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
      { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "1200" },
    ],
  });

  assert.equal(snapshot.balance_coverage.summary.mismatch, 1);
  assert.equal(snapshot.balance_coverage.mismatch_rows.length, 1);
  assert.deepEqual(snapshot.balance_coverage.mismatch_rows[0], {
    date: "2026-05-11",
    channel: "wise usd",
    currency: "USD",
    opening_balance: 1000,
    inflow: 206,
    outflow: 0,
    net_change: 206,
    computed_closing_balance: 1206,
    provider_reported_balance: 1200,
    difference: -6,
    formula: "opening_balance 1000 + inflow 206 - outflow 0 = computed_closing_balance 1206 ; provider_reported_balance 1200 ; difference -6",
    diagnosis: "Расхождение: provider_reported_balance отличается от computed_closing_balance на -6.",
    action: "Verify Ledger movement amount_net/balance_amount and factual Остатки row before changing data.",
  });
  assert.equal(snapshot.balances.uses_amount_net, true);
  assert.equal(snapshot.balances.fallback_amount_rows, 0);
});

test("audit snapshot reports missing provider balance rows without inventing provider balances", async () => {
  const snapshot = await snapshotFor({
    operations: [operation()],
    balances: [
      { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
    ],
  });

  assert.equal(snapshot.balance_coverage.summary.missing_provider_balance, 1);
  assert.equal(snapshot.balance_coverage.missing_provider_balance_rows.length, 1);
  assert.equal(snapshot.balance_coverage.missing_provider_balance_rows[0].computed_closing_balance, 1206);
  assert.equal(snapshot.balance_coverage.missing_provider_balance_rows[0].provider_reported_balance, null);
  assert.equal(snapshot.balance_coverage.missing_provider_balance_rows[0].difference, null);
  assert.match(snapshot.balance_coverage.missing_provider_balance_rows[0].action, /do not invent provider balance/);
  assert.match(snapshot.balance_fixes.copyable_ostatki_rows, /2026-05-11\twise usd\tUSD\t1206/);
});

test("audit snapshot keeps unknown source rows in balance when amount_net is valid", async () => {
  const snapshot = await snapshotFor({
    operations: [
      operation({
        source: "unknown",
        ledgerV2: { source: "unknown", amount_net: "206", balance_amount: 206 },
      }),
    ],
    balances: [
      { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
      { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "1206" },
    ],
  });

  assert.equal(snapshot.summary.unknown_source_rows, 1);
  assert.equal(snapshot.balances.by_channel[0].channel, "wise usd");
  assert.equal(snapshot.balances.by_channel[0].balance_amount, 206);
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 1);
});

test("audit snapshot excludes missing amount_net rows and reports the excluded count", async () => {
  const snapshot = await snapshotFor({
    operations: [
      operation({
        amountNet: "",
        ledgerV2: { amount_net: "", balance_amount: 206 },
      }),
    ],
    balances: [
      { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
      { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "1206" },
    ],
  });

  assert.equal(snapshot.balances.uses_amount_net, true);
  assert.equal(snapshot.balances.fallback_amount_rows, 0);
  assert.equal(snapshot.balances.missing_amount_net_rows, 1);
  assert.equal(snapshot.balances.excluded_missing_amount_net_rows, 1);
  assert.equal(snapshot.daily_balances.summary.excluded_missing_amount_net_rows, 1);
  assert.equal(snapshot.balance_coverage.weekly_summary.status, "failed");
  assert.equal(snapshot.balance_coverage.weekly_summary.excluded_missing_amount_net_rows, 1);
  assert.deepEqual(snapshot.balances.by_channel, []);
});

test("audit snapshot keeps exchange rows with amount_usd complete", async () => {
  const snapshot = await snapshotFor({
    operations: [
      operation({
        operation: "exchange",
        fromChannel: "wise usd",
        toChannel: "wise eur",
        amount: "100",
        currency: "USD",
        amountUsd: "-100",
        amountNet: "100",
        source: "wise",
        ledgerV2: {
          operation: "exchange",
          from_channel: "wise usd",
          to_channel: "wise eur",
          amount: "100",
          currency: "USD",
          amount_usd: "-100",
          amount_net: "100",
          balance_amount: -100,
          category: "exchange",
          source: "wise",
        },
      }),
    ],
    balances: [
      { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
      { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "900" },
    ],
  });

  assert.equal(snapshot.exchange.rows, 1);
  assert.equal(snapshot.exchange.missing_amount_usd_rows, 0);
  assert.equal(snapshot.exchange.total_out_usd, -100);
  assert.equal(snapshot.balances.fallback_amount_rows, 0);
});
