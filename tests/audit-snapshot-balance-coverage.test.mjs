import test from "node:test";
import assert from "node:assert/strict";

import { buildAuditSnapshot } from "../api/audit-snapshot.js";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-02",
    operation: "income",
    fromChannel: "",
    toChannel: "wise usd",
    amount: "206",
    currency: "USD",
    amountUsd: "206",
    amountNet: "206",
    source: "wise",
    ledgerV2: {
      date: "2026-05-02",
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

test("audit snapshot exposes balance coverage for reconciled account currency rows", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_coverage.summary.accounts_with_movement, 1);
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 1);
  assert.equal(snapshot.balance_coverage.summary.mismatch, 0);
  assert.equal(snapshot.balance_coverage.accounts[0].computed_closing_balance, 1206);
  assert.equal(snapshot.balance_coverage.accounts[0].provider_reported_balance, 1206);
  assert.equal(snapshot.balance_coverage.accounts[0].opening_amount_usd, 1000);
  assert.equal(snapshot.balance_coverage.accounts[0].closing_amount_usd, 1206);
  assert.equal(snapshot.balance_coverage.accounts[0].delta_amount_usd, 206);
  assert.deepEqual(snapshot.balances.remainders_rows, [
    {
      channel: "wise usd",
      currency: "USD",
      opening_amount_usd: 1000,
      closing_amount_usd: 1206,
      delta_amount_usd: 206,
      movement_usd: 206,
      planned_closing_amount_usd: 1206,
      planned_balance_computed: true,
      planned_balance_source: "computed_from_opening_plus_ledger_movement",
      planned_balance_reason: "opening_amount_usd + amount_net ledger movement",
      openingUsd: 1000,
      closingUsd: 1206,
      deltaUsd: 206,
      status: "ok",
      source: "manual_may_opening_anchor",
      inclusion_source: "opening_anchor",
      period_start_date: "2026-05-01",
      period_end_date: "2026-05-02",
      row_count: 4,
      needs_verification: false,
    },
  ]);
  assert.equal(snapshot.balance_coverage.accounts[0].status, "ok");
  assert.equal(snapshot.audit_checks.find((check) => check.name === "balance_coverage")?.status, "ok");
});

test("audit snapshot exposes remainders USD fields from explicit balance USD values", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-12", to: "2026-05-12" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-12",
          toChannel: "wise eur",
          currency: "EUR",
          amount: "100",
          amountUsd: "108",
          amountNet: "100",
          ledgerV2: {
            date: "2026-05-12",
            operation: "income",
            to_channel: "wise eur",
            currency: "EUR",
            amount: "100",
            amount_usd: "108",
            amount_net: "100",
            balance_amount: 100,
            source: "wise",
          },
        }),
      ],
      balances: [
        { date: "2026-05-11", channel: "wise eur", currency: "EUR", amount: "500", usdAmount: "540" },
        { date: "2026-05-12", channel: "wise eur", currency: "EUR", amount: "600", usdAmount: "648" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const account = snapshot.balance_coverage.accounts[0];
  assert.equal(account.opening_balance, 500);
  assert.equal(account.provider_reported_balance, 600);
  assert.equal(account.opening_amount_usd, 540);
  assert.equal(account.closing_amount_usd, 648);
  assert.equal(account.delta_amount_usd, 108);
  assert.deepEqual(snapshot.balances.remainders_rows.map((row) => ({
    channel: row.channel,
    currency: row.currency,
    opening_amount_usd: row.opening_amount_usd,
    closing_amount_usd: row.closing_amount_usd,
    delta_amount_usd: row.delta_amount_usd,
    status: row.status,
  })), [
    {
      channel: "wise eur",
      currency: "EUR",
      opening_amount_usd: 540,
      closing_amount_usd: 648,
      delta_amount_usd: 108,
      status: "ok",
    },
  ]);
});

test("audit snapshot keeps RUB remainders needs verification when factual anchors lack USD rate", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-05", to: "2026-05-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-05",
          toChannel: "Яндекс руб",
          currency: "RUB",
          amount: "100",
          amountUsd: "1.2",
          amountNet: "100",
          ledgerV2: {
            date: "2026-05-05",
            operation: "income",
            to_channel: "Яндекс руб",
            currency: "RUB",
            amount: "100",
            amount_usd: "1.2",
            amount_net: "100",
            balance_amount: 100,
            source: "yoomoney",
          },
        }),
      ],
      balances: [
        { date: "2026-05-04", channel: "Яндекс руб", currency: "RUB", amount: "1000" },
        { date: "2026-05-05", channel: "Яндекс руб", currency: "RUB", amount: "1100" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balances.remainders_rows.map((row) => ({
    channel: row.channel,
    currency: row.currency,
    status: row.status,
    reason: row.needs_verification_reason,
    fix_action: row.fix_action,
  })), [
    {
      channel: "Яндекс руб",
      currency: "RUB",
      status: "needs_verification",
      reason: "missing_usd_rate_or_amount_usd",
      fix_action: "Add a trusted rate or amount_usd for the factual RUB anchor date; native RUB alone is not enough for USD remainders.",
    },
  ]);
});

test("audit snapshot carries factual RUB USD fields when trusted rate is present", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-05", to: "2026-05-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-05",
          toChannel: "Яндекс руб",
          currency: "RUB",
          amount: "100",
          amountUsd: "1.2",
          amountNet: "100",
          ledgerV2: {
            date: "2026-05-05",
            operation: "income",
            to_channel: "Яндекс руб",
            currency: "RUB",
            amount: "100",
            amount_usd: "1.2",
            amount_net: "100",
            balance_amount: 100,
            source: "yoomoney",
          },
        }),
      ],
      balances: [
        { date: "2026-05-04", channel: "Яндекс руб", currency: "RUB", amount: "1000", rate: "0.012" },
        { date: "2026-05-05", channel: "Яндекс руб", currency: "RUB", amount: "1100", rate: "0.012" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balances.remainders_rows.map((row) => ({
    channel: row.channel,
    currency: row.currency,
    opening_amount_usd: row.opening_amount_usd,
    closing_amount_usd: row.closing_amount_usd,
    delta_amount_usd: row.delta_amount_usd,
    status: row.status,
  })), [
    {
      channel: "Яндекс руб",
      currency: "RUB",
      opening_amount_usd: 12,
      closing_amount_usd: 13.2,
      delta_amount_usd: 1.2,
      status: "ok",
    },
  ]);
});

test("audit snapshot remainders use Binance backward computed USD coverage", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-23", to: "2026-05-23" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-23",
          operation: "expense",
          fromChannel: "Бинанс spot",
          toChannel: "",
          currency: "USDT",
          amount: "400",
          amountUsd: "-400",
          amountNet: "400",
          ledgerV2: {
            date: "2026-05-23",
            operation: "expense",
            from_channel: "Бинанс spot",
            to_channel: "",
            currency: "USDT",
            amount: "400",
            amount_usd: "-400",
            amount_net: "400",
            balance_amount: -400,
            source: "binance",
          },
        }),
      ],
      balances: [],
      autoBalances: [
        { date: "2026-05-24", provider: "binance", channel: "Бинанс spot", currency: "USDT", amount: "1211.91", source: "user_confirmed_binance_balance" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balances.remainders_rows.map((row) => ({
    channel: row.channel,
    currency: row.currency,
    opening_amount_usd: row.opening_amount_usd,
    closing_amount_usd: row.closing_amount_usd,
    delta_amount_usd: row.delta_amount_usd,
    status: row.status,
    source: row.source,
    computed_balance: row.computed_balance,
    factual_provider_balance: row.factual_provider_balance,
  })), [
    {
      channel: "Бинанс spot",
      currency: "USDT",
      opening_amount_usd: 1611.91,
      closing_amount_usd: 1211.91,
      delta_amount_usd: -400,
      status: "ok",
      source: "computed_backward_from_current_binance_anchor_and_ledger",
      computed_balance: true,
      factual_provider_balance: false,
    },
  ]);
});

test("audit snapshot exposes weekly balance summary when all account currency rows reconcile", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-11", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({ date: "2026-05-11", amount: "206", amountUsd: "206", amountNet: "206" }),
        operation({
          date: "2026-05-12",
          toChannel: "wise eur",
          currency: "EUR",
          amount: "100",
          amountUsd: "108",
          amountNet: "100",
          ledgerV2: {
            date: "2026-05-12",
            operation: "income",
            to_channel: "wise eur",
            currency: "EUR",
            amount: "100",
            amount_usd: "108",
            amount_net: "100",
            balance_amount: 100,
            source: "wise",
          },
        }),
      ],
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "1206" },
        { date: "2026-05-11", channel: "wise eur", currency: "EUR", amount: "500" },
        { date: "2026-05-12", channel: "wise eur", currency: "EUR", amount: "600" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balance_coverage.weekly_summary, {
    period: { from: "2026-05-11", to: "2026-05-17" },
    status: "ok",
    accounts_checked: 2,
    fully_reconciled: 2,
    mismatch: 0,
    missing_opening_balance: 0,
    missing_provider_balance: 0,
    needs_verification: 0,
    missing_amount_net_rows: 0,
    excluded_missing_amount_net_rows: 0,
    actionable_accounts: [],
    copyable_ostatki_rows: "",
  });
});

test("audit snapshot balance coverage flags missing closing balance without changing balances.by_channel", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.by_channel[0].channel, "wise usd");
  assert.equal(snapshot.balances.by_channel[0].balance_amount, 206);
  assert.equal(snapshot.balance_coverage.summary.missing_provider_balance, 1);
  assert.equal(snapshot.balance_coverage.accounts[0].opening_amount_usd, 1000);
  assert.equal(snapshot.balance_coverage.accounts[0].closing_amount_usd, null);
  assert.equal(snapshot.balance_coverage.accounts[0].delta_amount_usd, null);
  assert.equal(snapshot.balances.remainders_rows[0].status, "needs_verification");
  assert.equal(snapshot.balances.remainders_rows[0].opening_amount_usd, 1000);
  assert.equal(snapshot.balances.remainders_rows[0].closing_amount_usd, null);
  assert.equal(snapshot.balance_coverage.weekly_summary.status, "needs_verification");
  assert.equal(snapshot.balance_coverage.weekly_summary.missing_provider_balance, 1);
  assert.match(
    snapshot.balance_coverage.weekly_summary.copyable_ostatki_rows,
    /2026-05-02\twise usd\tUSD\t\t1206\tProvider closing balance for this exact date\/channel\/currency\ttrue/
  );
  assert.equal(snapshot.balance_coverage.actionable_accounts[0].status, "missing_provider_balance");
  assert.match(snapshot.balance_coverage.actionable_accounts[0].diagnosis, /Нет фактического остатка/);
  assert.match(snapshot.balance_coverage.actionable_accounts[0].fix_action, /Добавить фактический остаток закрытия/);
  assert.match(snapshot.balance_coverage.actionable_accounts[0].formula, /opening_balance 1000 \+ inflow 206 - outflow 0/);
  assert.equal(snapshot.audit_checks.find((check) => check.name === "balance_coverage")?.status, "needs verification");
});

test("audit snapshot remainders expose amount-net movement and planned closing without overwriting factual closing", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation({ amount: "25", amountUsd: "25", amountNet: "25", ledgerV2: { amount: "25", amount_usd: "25", amount_net: "25", balance_amount: 25 } })],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1100" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = snapshot.balances.remainders_rows[0];
  assert.equal(row.movement_usd, 25);
  assert.equal(row.planned_closing_amount_usd, 1025);
  assert.equal(row.planned_balance_computed, true);
  assert.equal(row.planned_balance_source, "computed_from_opening_plus_ledger_movement");
  assert.equal(row.closing_amount_usd, 1100);
});

test("audit snapshot remainders keep planned closing uncomputed when amount-net movement is unsafe", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          amount: "25",
          amountUsd: "25",
          amountNet: "",
          ledgerV2: { amount: "25", amount_usd: "25", amount_net: "", balance_amount: 25 },
        }),
      ],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = snapshot.balances.remainders_rows[0];
  assert.equal(row.movement_usd, null);
  assert.equal(row.planned_closing_amount_usd, null);
  assert.equal(row.planned_balance_computed, false);
  assert.equal(row.planned_balance_source, "needs_verification");
  assert.match(row.planned_balance_reason, /amount_net/i);
  assert.equal(row.status, "needs_verification");
});

test("audit snapshot uses auto balance row as fallback when manual balance row is absent", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      autoBalances: [
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206", provider: "wise" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.manual_balance_rows, 1);
  assert.equal(snapshot.balances.auto_balance_rows, 1);
  assert.equal(snapshot.balances.merged_balance_rows, 2);
  assert.equal(snapshot.balances.auto_balance_rows_used_as_fallback, 1);
  assert.equal(snapshot.balances.auto_balance_rows_ignored_due_to_manual, 0);
  assert.equal(snapshot.balance_coverage.summary.missing_provider_balance, 0);
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 1);
  assert.equal(snapshot.balance_coverage.accounts[0].provider_reported_balance, 1206);
  assert.equal(snapshot.balance_coverage.accounts[0].status, "ok");
});

test("audit snapshot remainders include period-start manual anchors without movement", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      balances: [
        { date: "2026-05-01", channel: "manual wallet", currency: "USD", amount: "500", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [
        { date: "2026-05-01", channel: "manual wallet", currency: "USD", amount: "400", source: "provider_auto", sourceSheet: "Авто Остатки" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balances.remainders_rows, [
    {
      channel: "manual wallet",
      currency: "USD",
      opening_amount_usd: 500,
      closing_amount_usd: null,
      delta_amount_usd: null,
      movement_usd: null,
      planned_closing_amount_usd: null,
      planned_balance_computed: false,
      planned_balance_source: "needs_verification",
      planned_balance_reason: "needs_verification: missing_ledger_movement",
      openingUsd: 500,
      closingUsd: null,
      deltaUsd: null,
      status: "needs_verification",
      source: "manual_may_opening_anchor",
      inclusion_source: "opening_anchor",
      period_start_date: "2026-05-01",
      period_end_date: "2026-05-01",
      row_count: 1,
      needs_verification: true,
      needs_verification_reason: "missing_opening_or_closing_anchor",
    },
  ]);
});

test("audit snapshot remainders do not treat same-day snapshot as opening when prior anchor exists", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-12", to: "2026-05-12" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-12",
          toChannel: "wise eur",
          currency: "EUR",
          amount: "100",
          amountUsd: "108",
          amountNet: "100",
          ledgerV2: {
            date: "2026-05-12",
            operation: "income",
            to_channel: "wise eur",
            currency: "EUR",
            amount: "100",
            amount_usd: "108",
            amount_net: "100",
            balance_amount: 100,
            source: "wise",
          },
        }),
      ],
      balances: [
        { date: "2026-05-11", channel: "wise eur", currency: "EUR", amount: "500", usdAmount: "540" },
        { date: "2026-05-12", channel: "wise eur", currency: "EUR", amount: "600", usdAmount: "648" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.remainders_rows[0].opening_amount_usd, 540);
  assert.equal(snapshot.balances.remainders_rows[0].closing_amount_usd, 648);
});

test("audit snapshot remainders keep first-of-month source anchors even when prior rows exist", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      balances: [
        { date: "2026-04-30", channel: "quiet wallet", currency: "USD", amount: "300", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-01", channel: "quiet wallet", currency: "USD", amount: "500", source: "manual_fact", sourceSheet: "Остатки" },
      ],
      autoBalances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.remainders_rows[0].channel, "quiet wallet");
  assert.equal(snapshot.balances.remainders_rows[0].opening_amount_usd, 500);
  assert.equal(snapshot.balances.remainders_rows[0].source, "manual_may_opening_anchor");
});


test("audit snapshot ignores stale current-only auto balance rows on historical dates", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      autoBalances: [
        {
          date: "2026-05-02",
          channel: "wise usd",
          currency: "USD",
          amount: "1206",
          provider: "wise",
          source: "wise_auto",
          fetchedAt: "2026-05-21T03:25:15.489Z",
          comment: "auto daily provider snapshot",
        },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.manual_balance_rows, 1);
  assert.equal(snapshot.balances.auto_balance_rows, 1);
  assert.equal(snapshot.balances.merged_balance_rows, 1);
  assert.equal(snapshot.balances.auto_balance_rows_used_as_fallback, 0);
  assert.equal(snapshot.balances.auto_balance_rows_ignored_as_stale_current, 1);
  assert.equal(snapshot.balance_coverage.summary.missing_provider_balance, 1);
  assert.equal(snapshot.balance_coverage.accounts[0].provider_reported_balance, null);
  assert.equal(snapshot.balance_coverage.accounts[0].status, "missing_provider_balance");
});

test("audit snapshot manual balance row overrides auto balance row for same date channel currency", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { period: "2026-05" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206" },
      ],
      autoBalances: [
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "999", provider: "wise" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.manual_balance_rows, 2);
  assert.equal(snapshot.balances.auto_balance_rows, 1);
  assert.equal(snapshot.balances.merged_balance_rows, 2);
  assert.equal(snapshot.balances.auto_balance_rows_used_as_fallback, 0);
  assert.equal(snapshot.balances.auto_balance_rows_ignored_due_to_manual, 1);
  assert.equal(snapshot.balance_coverage.accounts[0].provider_reported_balance, 1206);
  assert.equal(snapshot.balance_coverage.accounts[0].status, "ok");
});

test("audit snapshot daily balance coverage reduces missing opening balance when prior auto row exists", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-02", to: "2026-05-02" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation()],
      balances: [
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206" },
      ],
      autoBalances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", provider: "wise" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_coverage.summary.missing_opening_balance, 0);
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 1);
  assert.equal(snapshot.balance_coverage.accounts[0].opening_balance, 1000);
  assert.equal(snapshot.balance_coverage.accounts[0].status, "ok");
});

test("audit snapshot exposes missing opening balance fix instructions without inventing amount", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-11", to: "2026-05-11" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation({ date: "2026-05-11" })],
      balances: [
        { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "1206" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const account = snapshot.balance_coverage.actionable_accounts[0];
  assert.equal(account.status, "missing_opening_balance");
  assert.equal(account.opening_balance, null);
  assert.equal(account.computed_closing_balance, null);
  assert.match(account.diagnosis, /Нет начального остатка/);
  assert.match(account.fix_action, /сумму взять из провайдера/);
  assert.match(account.formula, /opening_balance missing/);
  assert.deepEqual(snapshot.balance_fixes.missing_opening_balance_rows, [
    {
      required_date: "2026-05-10",
      movement_date: "2026-05-11",
      channel: "wise usd",
      currency: "USD",
      amount: null,
      diagnosis: account.diagnosis,
      action: "Add a factual opening balance row to Остатки before the movement date; amount must come from provider/manual statement.",
    },
  ]);
  assert.equal(snapshot.balance_fixes.copyable_ostatki_rows, "");
});

test("audit snapshot weekly balance summary fails on mismatched provider balance", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-11", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [operation({ date: "2026-05-11" })],
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "1200" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const weekly = snapshot.balance_coverage.weekly_summary;
  assert.equal(weekly.status, "failed");
  assert.equal(weekly.mismatch, 1);
  assert.equal(weekly.fully_reconciled, 0);
  assert.equal(weekly.actionable_accounts[0].date, "2026-05-11");
  assert.equal(weekly.actionable_accounts[0].channel, "wise usd");
  assert.equal(weekly.actionable_accounts[0].currency, "USD");
  assert.equal(weekly.actionable_accounts[0].difference, -6);
  assert.match(weekly.actionable_accounts[0].fix_action, /Проверить Ledger movement/);
});

test("audit snapshot weekly balance summary blocks ok status when amount_net is missing", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-11", to: "2026-05-17" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-11",
          amountNet: "",
          ledgerV2: {
            date: "2026-05-11",
            operation: "income",
            to_channel: "wise usd",
            currency: "USD",
            amount: "206",
            amount_usd: "206",
            amount_net: "",
            balance_amount: 206,
            source: "wise",
          },
        }),
      ],
      balances: [
        { date: "2026-05-10", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-11", channel: "wise usd", currency: "USD", amount: "1206" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balance_coverage.weekly_summary.status, "failed");
  assert.equal(snapshot.balance_coverage.weekly_summary.accounts_checked, 1);
  assert.equal(snapshot.balance_coverage.weekly_summary.missing_amount_net_rows, 1);
  assert.equal(snapshot.balance_coverage.weekly_summary.excluded_missing_amount_net_rows, 1);
  assert.equal(snapshot.balance_fixes.missing_amount_net_rows[0].channel, "wise usd");
});

test("audit snapshot distinguishes PayPal personal manual net from provider-proven net", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-11", to: "2026-05-11" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-11",
          toChannel: "пейпал евр",
          currency: "EUR",
          amount: "36",
          amountNet: "36",
          amountGross: "36",
          amountFee: "",
          source: "paypal_personal_manual",
          ledgerV2: {
            date: "2026-05-11",
            operation: "income",
            to_channel: "пейпал евр",
            currency: "EUR",
            amount: "36",
            amount_gross: "36",
            amount_fee: "",
            amount_net: "36",
            balance_amount: 36,
            source: "paypal_personal_manual",
            external_id: "5U351082V9506951V",
          },
        }),
      ],
      balances: [
        { date: "2026-05-10", channel: "пейпал евр", currency: "EUR", amount: "0" },
        { date: "2026-05-11", channel: "пейпал евр", currency: "EUR", amount: "36" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.balances.missing_amount_net_rows, 0);
  assert.equal(snapshot.paypal.personal_manual_confirmed_rows, 1);
  assert.equal(snapshot.paypal.warning_status, "fee_unavailable_personal_account");
  assert.equal(snapshot.paypal.net_status, "mixed_provider_and_manual");
  assert.match(snapshot.paypal.warnings[0], /not provider-proven/);
});

test("audit snapshot reconciles today's balance change against same-day closing snapshot", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-06", to: "2026-05-06" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-06",
          toChannel: "wise usd",
          amount: "300",
          amountUsd: "300",
          amountNet: "300",
          ledgerV2: {
            date: "2026-05-06",
            to_channel: "wise usd",
            amount: "300",
            amount_usd: "300",
            amount_net: "300",
            balance_amount: 300,
          },
        }),
        operation({
          date: "2026-05-06",
          operation: "expense",
          fromChannel: "wise usd",
          toChannel: "",
          amount: "40",
          amountUsd: "-40",
          amountNet: "40",
          ledgerV2: {
            date: "2026-05-06",
            operation: "expense",
            from_channel: "wise usd",
            to_channel: "",
            amount: "40",
            amount_usd: "-40",
            amount_net: "40",
            balance_amount: -40,
          },
        }),
      ],
      balances: [
        { date: "2026-05-05", channel: "wise usd", currency: "USD", amount: "1000" },
        { date: "2026-05-06", channel: "wise usd", currency: "USD", amount: "1260" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const account = snapshot.balance_coverage.accounts[0];
  assert.equal(account.date, "2026-05-06");
  assert.equal(account.opening_balance, 1000);
  assert.equal(account.inflow, 300);
  assert.equal(account.outflow, 40);
  assert.equal(account.net_change, 260);
  assert.equal(account.computed_closing_balance, 1260);
  assert.equal(account.provider_reported_balance, 1260);
  assert.equal(account.difference, 0);
  assert.equal(account.status, "ok");
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 1);
});

test("audit snapshot reconciles end-of-April balance change against April 30 closing snapshot", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-04-30", to: "2026-04-30" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-04-30",
          toChannel: "БАНК КАНАДА cad",
          amount: "500",
          amountUsd: "370",
          amountNet: "500",
          currency: "CAD",
          ledgerV2: {
            date: "2026-04-30",
            to_channel: "БАНК КАНАДА cad",
            amount: "500",
            amount_usd: "370",
            amount_net: "500",
            currency: "CAD",
            balance_amount: 500,
          },
        }),
        operation({
          date: "2026-04-30",
          operation: "expense",
          fromChannel: "БАНК КАНАДА cad",
          toChannel: "",
          amount: "120",
          amountUsd: "-88.8",
          amountNet: "120",
          currency: "CAD",
          ledgerV2: {
            date: "2026-04-30",
            operation: "expense",
            from_channel: "БАНК КАНАДА cad",
            to_channel: "",
            amount: "120",
            amount_usd: "-88.8",
            amount_net: "120",
            currency: "CAD",
            balance_amount: -120,
          },
        }),
      ],
      balances: [
        { date: "2026-04-29", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "2000" },
        { date: "2026-04-30", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "2380" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const account = snapshot.balance_coverage.accounts[0];
  assert.equal(account.date, "2026-04-30");
  assert.equal(account.currency, "CAD");
  assert.equal(account.opening_balance, 2000);
  assert.equal(account.inflow, 500);
  assert.equal(account.outflow, 120);
  assert.equal(account.net_change, 380);
  assert.equal(account.computed_closing_balance, 2380);
  assert.equal(account.provider_reported_balance, 2380);
  assert.equal(account.difference, 0);
  assert.equal(account.status, "ok");
  assert.equal(snapshot.audit_checks.find((check) => check.name === "balance_coverage")?.status, "ok");
});

test("audit snapshot uses prior ledger movement after the opening snapshot for single-day coverage", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-04-30", to: "2026-04-30" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-04-27",
          operation: "expense",
          fromChannel: "БАНК КАНАДА cad",
          toChannel: "",
          amount: "39.55",
          amountUsd: "-29.27",
          amountNet: "39.55",
          currency: "CAD",
          ledgerV2: {
            date: "2026-04-27",
            operation: "expense",
            from_channel: "БАНК КАНАДА cad",
            to_channel: "",
            amount: "39.55",
            amount_usd: "-29.27",
            amount_net: "39.55",
            currency: "CAD",
            balance_amount: -39.55,
          },
        }),
        operation({
          date: "2026-04-30",
          operation: "expense",
          fromChannel: "БАНК КАНАДА cad",
          toChannel: "",
          amount: "29.8",
          amountUsd: "-22.05",
          amountNet: "29.8",
          currency: "CAD",
          ledgerV2: {
            date: "2026-04-30",
            operation: "expense",
            from_channel: "БАНК КАНАДА cad",
            to_channel: "",
            amount: "29.8",
            amount_usd: "-22.05",
            amount_net: "29.8",
            currency: "CAD",
            balance_amount: -29.8,
          },
        }),
      ],
      balances: [
        { date: "2026-04-25", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "10078" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(snapshot.daily_balances.rows.length, 1);
  const account = snapshot.balance_coverage.accounts[0];
  assert.equal(account.date, "2026-04-30");
  assert.equal(account.opening_balance, 10038.45);
  assert.equal(account.outflow, 29.8);
  assert.equal(account.computed_closing_balance, 10008.65);
  assert.equal(account.status, "missing_provider_balance");
  assert.deepEqual(snapshot.balances.by_channel.map((row) => row.balance_amount), [-29.8]);
});

test("audit snapshot suggests amount_net fix for simple Monobank rows without changing balances shape", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-06", to: "2026-05-06" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-06",
          toChannel: "монобанк грн",
          amount: "253",
          amountUsd: "5.77",
          amountNet: "",
          currency: "UAH",
          source: "monobank",
          rawSourceId: "EXu_R1-KOv6NC6HsBw",
          ledgerV2: {
            date: "2026-05-06",
            to_channel: "монобанк грн",
            amount: "253",
            amount_usd: "5.77",
            amount_net: "",
            currency: "UAH",
            balance_amount: null,
            source: "monobank",
            raw_source_id: "EXu_R1-KOv6NC6HsBw",
          },
        }),
      ],
      balances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balances.by_channel, []);
  assert.equal(snapshot.balances.missing_amount_net_rows, 1);
  assert.equal(snapshot.balance_fixes.missing_amount_net_rows.length, 1);
  assert.deepEqual(snapshot.balance_fixes.missing_amount_net_rows[0], {
    date: "2026-05-06",
    operation: "income",
    from_channel: "",
    to_channel: "монобанк грн",
    channel: "монобанк грн",
    currency: "UAH",
    amount: 253,
    raw_source_id: "EXu_R1-KOv6NC6HsBw",
    recommended_amount_net: 253,
    reason: "amount_net is empty, so the row is excluded from balance reconciliation.",
    action: "Set amount_net to 253",
  });
});

test("audit snapshot does not recommend PayPal net autofill when fee or net is missing", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-06", to: "2026-05-06" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-06",
          toChannel: "paypal usd",
          amount: "100",
          amountGross: "100",
          amountFee: "",
          amountNet: "",
          currency: "USD",
          source: "paypal",
          rawSourceId: "PAYPAL-MISSING-FEE",
          ledgerV2: {
            date: "2026-05-06",
            to_channel: "paypal usd",
            amount: "100",
            amount_gross: "100",
            amount_fee: "",
            amount_net: "",
            currency: "USD",
            source: "paypal",
            raw_source_id: "PAYPAL-MISSING-FEE",
          },
        }),
      ],
      balances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const fix = snapshot.balance_fixes.missing_amount_net_rows[0];
  assert.equal(fix.raw_source_id, "PAYPAL-MISSING-FEE");
  assert.equal(fix.recommended_amount_net, null);
  assert.equal(fix.action, "verify PayPal fee/net; do not auto-fill");
});

test("audit snapshot returns copyable missing Остатки rows from balance coverage", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-04-30", to: "2026-04-30" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-04-30",
          toChannel: "монобанк грн",
          amount: "1000",
          amountNet: "1000",
          currency: "UAH",
          source: "monobank",
          ledgerV2: {
            date: "2026-04-30",
            to_channel: "монобанк грн",
            amount: "1000",
            amount_net: "1000",
            currency: "UAH",
            balance_amount: 1000,
            source: "monobank",
          },
        }),
      ],
      balances: [
        { date: "2026-04-29", channel: "монобанк грн", currency: "UAH", amount: "16363" },
      ],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.deepEqual(snapshot.balance_fixes.missing_ostatki_rows, [
    {
      date: "2026-04-30",
      channel: "монобанк грн",
      currency: "UAH",
      computed_closing_balance: 17363,
      amount_hint: 17363,
      do_not_apply_automatically: true,
      action: "Confirm provider closing balance, then add factual balance to Остатки",
    },
  ]);
  assert.equal(
    snapshot.balance_fixes.copyable_ostatki_rows,
    "date\tchannel\tcurrency\tcurrent_ostatki_amount\tcomputed_amount_hint\trequired_provider_evidence\tdo_not_apply_automatically\n2026-04-30\tмонобанк грн\tUAH\t\t17363\tProvider closing balance for this exact date/channel/currency\ttrue"
  );
});

test("audit snapshot computes bounded Monobank row with small closing-anchor rounding difference", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-21" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-11",
          toChannel: "монобанк грн",
          amount: "9105",
          amountUsd: "207.52",
          amountNet: "9105",
          currency: "UAH",
          source: "monobank",
          ledgerV2: {
            date: "2026-05-11",
            operation: "income",
            to_channel: "монобанк грн",
            amount: "9105",
            amount_usd: "207.52",
            amount_net: "9105",
            currency: "UAH",
            balance_amount: 9105,
            source: "monobank",
          },
        }),
      ],
      balances: [
        { date: "2026-05-06", channel: "монобанк грн", currency: "UAH", amount: "3928", usdAmount: "89.71", source: "manual_fact", sourceSheet: "Остатки" },
        { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "13033.14", source: "manual_owner_confirmed", sourceSheet: "Остатки" },
      ],
      autoBalances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = snapshot.daily_balances.rows.find((entry) => entry.channel === "монобанк грн");
  assert.equal(row.status, "computed_between_confirmed_anchors");
  assert.equal(row.closing_balance, 13033);
  assert.equal(row.difference, null);
  assert.equal(row.source, "computed_from_opening_and_ledger");
  assert.equal(row.opening_amount_usd, 89.71);
  assert.equal(row.closing_amount_usd, 297.23);
});

test("audit snapshot marks bounded anchor movement rows computed without writing Ostatki fixes", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({ date: "2026-05-02", amount: "300", amountUsd: "300", amountNet: "300", ledgerV2: { date: "2026-05-02", amount: "300", amount_usd: "300", amount_net: "300", balance_amount: 300 } }),
        operation({ date: "2026-05-10", amount: "20", amountUsd: "20", amountNet: "20", ledgerV2: { date: "2026-05-10", amount: "20", amount_usd: "20", amount_net: "20", balance_amount: 20 } }),
        operation({
          date: "2026-05-20",
          operation: "expense",
          fromChannel: "wise usd",
          toChannel: "",
          amount: "10",
          amountUsd: "-10",
          amountNet: "10",
          ledgerV2: {
            date: "2026-05-20",
            operation: "expense",
            from_channel: "wise usd",
            to_channel: "",
            amount: "10",
            amount_usd: "-10",
            amount_net: "10",
            currency: "USD",
            balance_amount: -10,
            source: "wise",
          },
        }),
      ],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", usdAmount: "1000", sourceSheet: "Остатки" },
        { date: "2026-05-20", channel: "wise usd", currency: "USD", amount: "1310", usdAmount: "1310", sourceSheet: "Остатки" },
      ],
      autoBalances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const accounts = snapshot.balance_coverage.accounts;
  assert.deepEqual(accounts.map((row) => ({ date: row.date, status: row.status, source: row.source || row.balance_source })), [
    { date: "2026-05-02", status: "computed_between_confirmed_anchors", source: "computed_from_opening_and_ledger" },
    { date: "2026-05-10", status: "computed_between_confirmed_anchors", source: "computed_from_opening_and_ledger" },
    { date: "2026-05-20", status: "ok", source: "manual" },
  ]);
  assert.equal(snapshot.balance_coverage.summary.missing_provider_balance, 0);
  assert.equal(snapshot.balance_coverage.summary.computed_between_confirmed_anchor_rows, 2);
  assert.equal(snapshot.balance_coverage.summary.fully_reconciled_accounts, 3);
  assert.equal(snapshot.balance_fixes.missing_ostatki_rows.length, 0);
  assert.deepEqual(snapshot.balances.remainders_rows, [
    {
      channel: "wise usd",
      currency: "USD",
      opening_amount_usd: 1000,
      closing_amount_usd: 1310,
      delta_amount_usd: 310,
      movement_usd: 310,
      planned_closing_amount_usd: 1310,
      planned_balance_computed: true,
      planned_balance_source: "computed_from_opening_plus_ledger_movement",
      planned_balance_reason: "opening_amount_usd + amount_net ledger movement",
      openingUsd: 1000,
      closingUsd: 1310,
      deltaUsd: 310,
      status: "ok",
      source: "computed_from_opening_and_ledger",
      inclusion_source: "opening_anchor",
      period_start_date: "2026-05-01",
      period_end_date: "2026-05-20",
      row_count: 6,
      needs_verification: false,
      computed_balance: true,
      factual_provider_balance: false,
    },
  ]);
});

test("audit snapshot remainders include income channel without opening balance", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-09",
          toChannel: "new paypal usd",
          amount: "250",
          amountUsd: "250",
          amountNet: "250",
          ledgerV2: {
            date: "2026-05-09",
            operation: "income",
            to_channel: "new paypal usd",
            amount: "250",
            amount_usd: "250",
            amount_net: "250",
            currency: "USD",
            source: "paypal",
          },
        }),
      ],
      balances: [],
      autoBalances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = snapshot.balances.remainders_rows.find((item) => item.channel === "new paypal usd");
  assert.ok(row);
  assert.equal(row.currency, "USD");
  assert.equal(row.opening_amount_usd, null);
  assert.equal(row.closing_amount_usd, null);
  assert.equal(row.movement_usd, 250);
  assert.equal(row.planned_closing_amount_usd, null);
  assert.equal(row.status, "needs_verification");
  assert.equal(row.inclusion_source, "ledger_movement");
  assert.match(row.planned_balance_reason, /missing opening_amount_usd/);
});

test("audit snapshot remainders include ledger expense movement channel without anchors", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-12",
          operation: "expense",
          fromChannel: "cash usd",
          toChannel: "",
          amount: "70",
          amountUsd: "70",
          amountNet: "70",
          ledgerV2: {
            date: "2026-05-12",
            operation: "expense",
            from_channel: "cash usd",
            to_channel: "",
            amount: "70",
            amount_usd: "70",
            amount_net: "70",
            balance_amount: -70,
            currency: "USD",
            source: "manual",
          },
        }),
      ],
      balances: [],
      autoBalances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = snapshot.balances.remainders_rows.find((item) => item.channel === "cash usd");
  assert.ok(row);
  assert.equal(row.movement_usd, -70);
  assert.equal(row.planned_closing_amount_usd, null);
  assert.equal(row.status, "needs_verification");
  assert.equal(row.inclusion_source, "ledger_movement");
  assert.equal(row.needs_verification_reason, "missing_opening_or_closing_anchor");
});

test("audit snapshot remainders include closing-only channels", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [],
      balances: [
        { date: "2026-05-31", channel: "closing only usd", currency: "USD", amount: "410", sourceSheet: "Остатки" },
      ],
      autoBalances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = snapshot.balances.remainders_rows.find((item) => item.channel === "closing only usd");
  assert.ok(row);
  assert.equal(row.opening_amount_usd, null);
  assert.equal(row.closing_amount_usd, 410);
  assert.equal(row.inclusion_source, "closing_anchor");
  assert.equal(row.status, "needs_verification");
});

test("audit snapshot remainders merge duplicate channel currency inclusions into one row", async () => {
  const snapshot = await buildAuditSnapshot({
    query: { from: "2026-05-01", to: "2026-05-31" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        operation({
          date: "2026-05-10",
          toChannel: "Wise USD",
          amount: "50",
          amountUsd: "50",
          amountNet: "50",
          ledgerV2: {
            date: "2026-05-10",
            operation: "income",
            to_channel: "Wise USD",
            amount: "50",
            amount_usd: "50",
            amount_net: "50",
            currency: "USD",
            source: "wise",
          },
        }),
      ],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "100", sourceSheet: "Остатки" },
        { date: "2026-05-31", channel: "WISE USD", currency: "USD", amount: "150", sourceSheet: "Остатки" },
      ],
      autoBalances: [],
      commissionRows: [],
      transfers: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const rows = snapshot.balances.remainders_rows.filter((item) => item.channel.toLowerCase() === "wise usd");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opening_amount_usd, 100);
  assert.equal(rows[0].closing_amount_usd, 150);
  assert.equal(rows[0].movement_usd, 50);
});
