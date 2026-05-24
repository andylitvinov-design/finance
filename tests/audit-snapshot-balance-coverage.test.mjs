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
      openingUsd: 1000,
      closingUsd: 1206,
      deltaUsd: 206,
      status: "ok",
      source: "balance_coverage.accounts",
      period_start_date: "2026-05-02",
      period_end_date: "2026-05-02",
      row_count: 1,
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
  assert.equal(snapshot.balance_coverage.weekly_summary.accounts_checked, 0);
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

test("audit snapshot reports later Monobank fact context without hiding tiny difference", async () => {
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
          amountNet: "9105",
          currency: "UAH",
          source: "monobank",
          ledgerV2: {
            date: "2026-05-11",
            operation: "income",
            to_channel: "монобанк грн",
            amount: "9105",
            amount_net: "9105",
            currency: "UAH",
            balance_amount: 9105,
            source: "monobank",
          },
        }),
      ],
      balances: [
        { date: "2026-05-06", channel: "монобанк грн", currency: "UAH", amount: "3928", source: "manual_fact", sourceSheet: "Остатки" },
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
  assert.equal(row.status, "missing_provider_balance");
  assert.equal(row.closing_balance, 13033);
  assert.equal(row.difference, null);
  assert.equal(row.missing_provider_balance_context, "later_fact_exists");
  assert.equal(row.nearest_later_provider_fact_date, "2026-05-20");
  assert.equal(row.nearest_later_provider_fact_amount, 13033.14);
  assert.equal(row.later_provider_fact_difference, 0.14);
});
