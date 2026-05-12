import test from "node:test";
import assert from "node:assert/strict";

import handler, { buildAuditSnapshot } from "../api/audit-snapshot.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function ledgerOperation(overrides = {}) {
  const row = {
    date: "2026-05-02",
    operation: "income",
    fromChannel: "",
    toChannel: "пейпал дол",
    amount: "324",
    currency: "USD",
    amountUsd: "311.06",
    amountGross: "324",
    amountFee: "12.94",
    amountNet: "311.06",
    category: "service",
    source: "paypal",
    comment: "",
    counterparty: "",
    ledgerV2: {
      date: "2026-05-02",
      operation: "income",
      from_channel: "",
      to_channel: "пейпал дол",
      amount: "324",
      currency: "USD",
      amount_usd: "311.06",
      amount_gross: "324",
      amount_fee: "12.94",
      amount_net: "311.06",
      balance_amount: 311.06,
      category: "service",
      source: "paypal",
      warnings: [],
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
    operations: [
      ledgerOperation(),
      ledgerOperation({
        operation: "income",
        toChannel: "cash usd",
        amount: "100",
        amountUsd: "100",
        amountGross: "",
        amountFee: "",
        amountNet: "",
        source: "",
        ledgerV2: {
          operation: "income",
          to_channel: "cash usd",
          amount: "100",
          amount_usd: "100",
          amount_gross: "100",
          amount_fee: "",
          amount_net: "",
          balance_amount: 100,
          source: "other",
        },
      }),
      ledgerOperation({
        operation: "personal_expense",
        fromChannel: "Яндекс руб",
        toChannel: "",
        amount: "20",
        amountUsd: "-20",
        amountGross: "20",
        amountFee: "",
        amountNet: "20",
        source: "manual",
        ledgerV2: {
          operation: "expense",
          from_channel: "Яндекс руб",
          to_channel: "",
          amount: "20",
          amount_usd: "-20",
          amount_net: "20",
          balance_amount: -20,
          source: "manual",
        },
      }),
      ledgerOperation({
        operation: "exchange_out",
        fromChannel: "Яндекс руб",
        toChannel: "Бинанс spot",
        amount: "100",
        amountUsd: "",
        amountNet: "100",
        category: "exchange",
        source: "manual",
        ledgerV2: {
          operation: "exchange",
          from_channel: "Яндекс руб",
          to_channel: "Бинанс spot",
          amount: "100",
          amount_usd: "",
          amount_net: "100",
          balance_amount: -100,
          category: "exchange",
          source: "manual",
        },
      }),
      ledgerOperation({
        operation: "exchange_in",
        fromChannel: "Яндекс руб",
        toChannel: "Бинанс spot",
        amount: "99",
        amountUsd: "99",
        amountNet: "99",
        category: "exchange",
        source: "manual",
        ledgerV2: {
          operation: "exchange",
          from_channel: "Яндекс руб",
          to_channel: "Бинанс spot",
          amount: "99",
          amount_usd: "99",
          amount_net: "99",
          balance_amount: 99,
          category: "exchange",
          source: "manual",
        },
      }),
      ledgerOperation({
        operation: "transfer",
        fromChannel: "monobank грн",
        toChannel: "cash usd",
        amount: "10",
        amountUsd: "10",
        amountNet: "10",
        source: "monobank",
        ledgerV2: {
          operation: "transfer",
          from_channel: "monobank грн",
          to_channel: "cash usd",
          amount: "10",
          amount_usd: "10",
          amount_net: "10",
          balance_amount: -10,
          source: "monobank",
        },
      }),
    ],
    transfers: [{ transferDate: "2026-05-02", channel: "cash usd", amount: "10" }],
    balances: [
      { date: "2026-05-01", channel: "пейпал дол", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "пейпал дол", amount: "1311.06", currency: "USD" },
      { date: "2026-05-01", channel: "Яндекс руб", amount: "1000", currency: "RUB" },
      { date: "2026-05-01", channel: "Бинанс spot", amount: "500", currency: "USD" },
      { date: "2026-05-01", channel: "monobank грн", amount: "300", currency: "UAH" },
    ],
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

test("audit snapshot returns ok JSON with required top-level fields", async () => {
  const response = await buildFixtureSnapshot({ period: "2026-05" });

  assert.equal(response.ok, true);
  assert.match(response.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.project, "ezohata-incoming-ledger");
  assert.deepEqual(response.period, { from: "2026-05-01", to: "2026-05-31" });
  assert.ok(response.schema);
  assert.ok(response.summary);
  assert.ok(response.balances);
  assert.ok(response.daily_balances);
  assert.ok(response.paypal);
  assert.ok(response.exchange);
  assert.ok(response.sources);
  assert.ok(Array.isArray(response.warnings));
  assert.ok(Array.isArray(response.audit_checks));
});

test("audit snapshot accepts dashboard startDate/endDate aliases and DD/MM/YYYY dates", async () => {
  const response = await buildFixtureSnapshot({ startDate: "02/05/2026", endDate: "09/05/2026" });

  assert.deepEqual(response.period, { from: "2026-05-02", to: "2026-05-09" });
  assert.equal(response.summary.ledger_rows, 6);
  const excluded = await buildFixtureSnapshot({ startDate: "03/05/2026", endDate: "09/05/2026" });
  assert.deepEqual(excluded.period, { from: "2026-05-03", to: "2026-05-09" });
  assert.equal(excluded.summary.ledger_rows, 0);
});

test("audit snapshot does not expose secret-looking fields or values", async () => {
  const response = await buildFixtureSnapshot({ includeRows: "1" });
  const serialized = JSON.stringify(response).toLowerCase();

  for (const forbidden of ["access_token", "refresh_token", "client_secret", "private_key", "cookie", "bearer "]) {
    assert.equal(serialized.includes(forbidden), false, `response exposed ${forbidden}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(response, "rows"), false);
});

test("audit snapshot reports ledger v2 compatibility metadata", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.schema.ledger_contract, "v2-compatible");
  assert.equal(response.schema.source_of_truth, "ledger");
  assert.equal(response.schema.physical_sheet_migration, false);
});

test("audit snapshot never falls back to amount when amount_net is missing", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.balances.fallback_amount_rows, 0);
  assert.equal(response.balances.missing_amount_net_rows, 1);
  assert.equal(response.balances.excluded_missing_amount_net_rows, 1);
  assert.equal(response.daily_balances.uses_amount_net, true);
  assert.equal(response.daily_balances.summary.excluded_missing_amount_net_rows, 1);
  assert.match(response.warnings.join("\n"), /amount_net.*balance was not calculated/i);
});

test("audit snapshot exposes additive daily currency balances without changing by_channel", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.daily_balances.uses_amount_net, true);
  assert.equal(response.daily_balances.summary.rows, response.daily_balances.rows.length);
  assert.equal(response.daily_balances.actionable_rows.length, 3);
  assert.equal(response.daily_balances.actionable_rows[0].status, "missing_opening_balance");
  assert.equal(response.daily_balances.summary.status_counts.ok, 1);
  assert.equal(response.daily_balances.summary.status_counts.missing_opening_balance, 2);
  assert.deepEqual(Object.keys(response.balances), [
    "by_channel",
    "total_usd",
    "uses_amount_net",
    "fallback_amount_rows",
    "missing_amount_net_rows",
    "excluded_missing_amount_net_rows",
  ]);
  assert.ok(response.balances.by_channel.some((row) => row.channel === "пейпал дол" && row.balance_amount === 311.06));
  assert.ok(response.daily_balances.rows.some((row) =>
    row.date === "2026-05-02" &&
    row.channel === "пейпал дол" &&
    row.currency === "USD" &&
    row.opening_balance === 1000 &&
    row.closing_balance === 1311.06 &&
    row.status === "ok"
  ));
});

test("audit snapshot warns when exchange amount_usd is missing", async () => {
  const response = await buildFixtureSnapshot();

  assert.ok(response.summary.ledger_rows > 0);
  assert.equal(response.exchange.rows, 2);
  assert.equal(response.exchange.missing_amount_usd_rows, 1);
  assert.equal(response.exchange.compatibility_mode, false);
  const exchangeWarnings = response.warnings.filter((warning) => /exchange row\(s\).*amount_usd/i.test(warning));
  assert.equal(exchangeWarnings.length, 1);
  assert.match(exchangeWarnings[0], /^Ledger v2 warning: 1 exchange row\(s\)/);
});

test("audit snapshot accepts normalized exchange amount_usd when raw sheet cell is blank", async () => {
  const response = await buildAuditSnapshot({
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          operation: "exchange_out",
          fromChannel: "пейпал евр",
          toChannel: "",
          amount: "1.82",
          currency: "EUR",
          amountUsd: "",
          amountNet: "1.82",
          category: "exchange",
          source: "paypal",
          ledgerV2: {
            operation: "exchange",
            from_channel: "пейпал евр",
            to_channel: "",
            amount: "1.82",
            currency: "EUR",
            amount_usd: "-2.1112",
            amount_net: "1.82",
            balance_amount: -1.82,
            category: "exchange",
            source: "paypal",
          },
        }),
      ],
      transfers: [],
      balances: [],
      commissionRows: [],
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(response.exchange.rows, 1);
  assert.equal(response.exchange.missing_amount_usd_rows, 0);
  assert.equal(response.exchange.total_out_usd, -2.1112);
  assert.equal(response.warnings.some((warning) => /exchange row\(s\).*amount_usd/i.test(warning)), false);
});

test("audit snapshot summarizes PayPal gross fee and net from normalized rows", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.paypal.rows, 1);
  assert.equal(response.paypal.gross_total_usd, 324);
  assert.equal(response.paypal.fee_total_usd, 12.94);
  assert.equal(response.paypal.net_total_usd, 311.06);
  assert.equal(response.paypal.missing_counterparty_rows, 1);
  assert.equal(response.paypal.permission_status, "needs verification");
});

test("audit snapshot does not count PayPal net as exact when fee is missing", async () => {
  const response = await buildAuditSnapshot({
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          amount: "100",
          amountUsd: "100",
          amountGross: "100",
          amountFee: "",
          amountNet: "100",
          source: "paypal",
          rawSourceId: "TXN-NOFEE",
          ledgerV2: {
            amount: "100",
            amount_usd: "100",
            amount_gross: "100",
            amount_fee: "",
            amount_net: "100",
            balance_amount: 100,
            source: "paypal",
            external_id: "TXN-NOFEE",
          },
        }),
      ],
      warnings: [],
    }),
  });

  assert.equal(response.paypal.rows, 1);
  assert.equal(response.paypal.gross_total_usd, 100);
  assert.equal(response.paypal.fee_total_usd, null);
  assert.equal(response.paypal.net_total_usd, null);
  assert.equal(response.paypal.missing_fee_rows, 1);
  assert.match(response.warnings.join("\n"), /PayPal warning: missing fee for TXN-NOFEE/);
});

test("audit snapshot counts unknown source rows in balance when amount_net is valid", async () => {
  const response = await buildAuditSnapshot({
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          toChannel: "cash usd",
          amount: "50",
          amountUsd: "50",
          amountGross: "50",
          amountFee: "",
          amountNet: "50",
          source: "other",
          ledgerV2: {
            amount: "50",
            amount_usd: "50",
            amount_gross: "50",
            amount_fee: "",
            amount_net: "50",
            balance_amount: 50,
            source: "other",
            to_channel: "cash usd",
          },
        }),
      ],
      warnings: [],
    }),
  });

  assert.equal(response.sources.unknown, 1);
  assert.equal(response.balances.by_channel[0].channel, "cash usd");
  assert.equal(response.balances.by_channel[0].balance_amount, 50);
  assert.equal(response.balances.total_usd, 50);
});

test("audit snapshot counts unknown source rows", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.sources.unknown, 1);
  assert.equal(response.summary.unknown_source_rows, 1);
});

test("audit snapshot exposes finance analysis planned vs auto/MCP breakdown without forcing equality", async () => {
  const response = await buildAuditSnapshot({
    query: { startDate: "2026-05-05", endDate: "2026-05-11" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          date: "2026-05-08",
          toChannel: "Яндекс руб",
          amount: "50",
          amountUsd: "50",
          amountNet: "50",
          source: "mcp",
          ledgerV2: { date: "2026-05-08", to_channel: "Яндекс руб", amount: "50", amount_usd: "50", amount_net: "50", balance_amount: 50, source: "mcp", external_id: "YANDEX-1" },
        }),
        ledgerOperation({
          date: "2026-05-09",
          toChannel: "Яндекс руб",
          amount: "40",
          amountUsd: "40",
          amountNet: "40",
          source: "yoomoney",
          ledgerV2: { date: "2026-05-09", to_channel: "Яндекс руб", amount: "40", amount_usd: "40", amount_net: "40", balance_amount: 40, source: "yoomoney", external_id: "YANDEX-2" },
        }),
        ledgerOperation({
          date: "2026-05-10",
          toChannel: "Яндекс руб",
          amount: "30",
          amountUsd: "30",
          amountNet: "30",
          source: "mcp",
          ledgerV2: { date: "2026-05-10", to_channel: "Яндекс руб", amount: "30", amount_usd: "30", amount_net: "30", balance_amount: 30, source: "mcp", external_id: "YANDEX-3" },
        }),
      ],
      financeAnalysis: {
        plannedRows: [
          { orderId: "18101", date: "2026-05-05", paymentMethod: "Яндекс руб", accruedPlus: "10" },
          { orderId: "18102", date: "2026-05-06", paymentMethod: "yoomoney rub", accruedPlus: "20" },
          { orderId: "18103", date: "2026-05-07", paymentMethod: "сайт,рубли", accruedPlus: "30" },
          { orderId: "18104", date: "2026-05-08", paymentMethod: "Яндекс руб", accruedPlus: "40" },
        ],
      },
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = response.finance_analysis.channels.find((item) => item.channel === "Яндекс руб");
  assert.equal(row.planned_count, 4);
  assert.equal(row.actual_auto_mcp_count, 3);
  assert.equal(row.planned_total, 100);
  assert.equal(row.actual_total, 120);
  assert.equal(row.unmatched_planned.length, 4);
  assert.equal(row.unmatched_actual.length, 3);
});

test("audit snapshot flags planned Yandex order paid through PayPal EUR as channel mismatch diagnostic", async () => {
  const response = await buildAuditSnapshot({
    query: { startDate: "2026-05-05", endDate: "2026-05-11" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          date: "2026-05-08",
          toChannel: "пейпал евр",
          amount: "36",
          currency: "EUR",
          amountUsd: "41.76",
          amountNet: "36",
          source: "paypal_mcp",
          ledgerV2: { date: "2026-05-08", to_channel: "пейпал евр", amount: "36", currency: "EUR", amount_usd: "41.76", amount_net: "36", balance_amount: 36, source: "paypal_mcp", external_id: "PAYPAL-EUR-1" },
        }),
      ],
      financeAnalysis: {
        plannedRows: [
          { orderId: "18105", date: "2026-05-08", paymentMethod: "Яндекс руб", accruedPlus: "40" },
        ],
      },
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const yandex = response.finance_analysis.channels.find((item) => item.channel === "Яндекс руб");
  const paypal = response.finance_analysis.channels.find((item) => item.channel === "пейпал евр");
  assert.equal(yandex.planned_total, 40);
  assert.equal(paypal.actual_total, 41.76);
  assert.equal(yandex.possible_channel_mismatches.length, 1);
  assert.equal(yandex.possible_channel_mismatches[0].actual_channel, "пейпал евр");
});

test("audit snapshot finance analysis excludes auto/MCP income outside selected period", async () => {
  const response = await buildAuditSnapshot({
    query: { startDate: "2026-05-05", endDate: "2026-05-11" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          date: "2026-05-08",
          toChannel: "Яндекс руб",
          amount: "25",
          amountUsd: "25",
          amountNet: "25",
          source: "mcp",
          ledgerV2: { date: "2026-05-08", to_channel: "Яндекс руб", amount: "25", amount_usd: "25", amount_net: "25", balance_amount: 25, source: "mcp" },
        }),
        ledgerOperation({
          date: "2026-05-12",
          toChannel: "Яндекс руб",
          amount: "99",
          amountUsd: "99",
          amountNet: "99",
          source: "mcp",
          ledgerV2: { date: "2026-05-12", to_channel: "Яндекс руб", amount: "99", amount_usd: "99", amount_net: "99", balance_amount: 99, source: "mcp" },
        }),
      ],
      financeAnalysis: {
        plannedRows: [
          { orderId: "18106", date: "2026-05-08", paymentMethod: "Яндекс руб", accruedPlus: "25" },
        ],
      },
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  const row = response.finance_analysis.channels.find((item) => item.channel === "Яндекс руб");
  assert.equal(row.actual_auto_mcp_count, 1);
  assert.equal(row.actual_total, 25);
});

test("audit snapshot finance analysis does not count PayPal USD expense as income", async () => {
  const response = await buildAuditSnapshot({
    query: { startDate: "2026-05-05", endDate: "2026-05-11" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          date: "2026-05-08",
          operation: "business_expense",
          fromChannel: "пейпал дол",
          toChannel: "",
          amount: "12",
          amountUsd: "-12",
          amountNet: "12",
          source: "paypal_mcp",
          ledgerV2: { date: "2026-05-08", operation: "expense", from_channel: "пейпал дол", to_channel: "", amount: "12", amount_usd: "-12", amount_net: "12", balance_amount: -12, source: "paypal_mcp" },
        }),
      ],
      financeAnalysis: { plannedRows: [] },
      views: { byDateChannel: [], byCategory: [] },
      warnings: [],
    }),
  });

  assert.equal(response.finance_analysis.totals.actual_auto_mcp_count, 0);
  assert.equal(response.finance_analysis.totals.actual_total, 0);
});

test("audit snapshot counts migration rows separately from unknown", async () => {
  const response = await buildAuditSnapshot({
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          source: "migration",
          rawSourceId: "migration:2026-04-24:1:1",
          ledgerV2: {
            source: "migration",
            external_id: "migration:2026-04-24:1:1",
          },
        }),
      ],
      warnings: [],
    }),
  });

  assert.equal(response.sources.migration, 1);
  assert.equal(response.sources.unknown, 0);
});

test("audit snapshot includeRows=false does not expose raw rows", async () => {
  const response = await buildFixtureSnapshot({ includeRows: "0" });

  assert.equal(Object.prototype.hasOwnProperty.call(response, "rows"), false);
  assert.equal(JSON.stringify(response).includes("sourceTransactionId"), false);
});

test("audit snapshot includeRows=true still omits rows in public summary mode", async () => {
  const response = await buildFixtureSnapshot({ includeRows: "1" });

  assert.equal(Object.prototype.hasOwnProperty.call(response, "rows"), false);
  assert.match(response.warnings.join("\n"), /includeRows is disabled/i);
});

test("audit snapshot handler returns needs verification when Google access is unavailable", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  try {
    const request = { method: "GET", query: { period: "2026-05" } };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.summary.ledger_rows, 0);
    assert.match(response.body.warnings.join("\n"), /needs verification/i);
    assert.equal(JSON.stringify(response.body).toLowerCase().includes("private_key"), false);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});
