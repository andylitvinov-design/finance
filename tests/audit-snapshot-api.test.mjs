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

test("audit snapshot accepts explicit period date ranges", async () => {
  const response = await buildFixtureSnapshot({ period: "2026-05-02..2026-05-09" });

  assert.deepEqual(response.period, { from: "2026-05-02", to: "2026-05-09" });
  assert.equal(response.summary.ledger_rows, 6);
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

test("audit snapshot excludes missing amount_net rows even when auto balances exist", async () => {
  const repository = repositoryFixture();
  const response = await buildAuditSnapshot({
    repositoryLoader: async () => ({
      ...repository,
      autoBalances: [
        { date: "2026-05-02", channel: "cash usd", currency: "USD", amount: "410", provider: "manual-test" },
      ],
    }),
  });

  assert.equal(response.balances.fallback_amount_rows, 0);
  assert.equal(response.balances.excluded_missing_amount_net_rows, 1);
  assert.equal(response.daily_balances.summary.excluded_missing_amount_net_rows, 1);
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
    "manual_balance_rows",
    "auto_balance_rows",
    "merged_balance_rows",
    "auto_balance_rows_used_as_fallback",
    "auto_balance_rows_ignored_due_to_manual",
    "auto_balance_rows_ignored_as_stale_current",
    "remainders_rows",
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

test("audit snapshot handoff mode omits large rows but preserves summaries", async () => {
  const response = await buildFixtureSnapshot({ mode: "handoff" });

  assert.equal(response.ok, true);
  assert.equal(response.audit_handoff.compact, true);
  assert.deepEqual(response.period, { from: "2026-05-02", to: "2026-05-02" });
  assert.ok(response.schema);
  assert.ok(response.summary);
  assert.ok(response.balances);
  assert.ok(response.daily_balances.summary);
  assert.equal(Object.prototype.hasOwnProperty.call(response.daily_balances, "rows"), false);
  assert.equal(response.daily_balances.actionable_rows.length, 3);
  assert.ok(response.balance_coverage.summary);
  assert.ok(response.balance_coverage.weekly_summary);
  assert.equal(Object.prototype.hasOwnProperty.call(response.balance_coverage, "accounts"), false);
  assert.ok(response.balance_coverage.actionable_accounts.length <= 10);
  assert.ok(response.paypal);
  assert.ok(response.exchange);
  assert.ok(response.sources);
  assert.ok(Array.isArray(response.warnings));
  assert.ok(Array.isArray(response.audit_checks));
  assert.ok(response.audit_handoff.omitted_paths.includes("daily_balances.rows"));
  assert.ok(response.audit_handoff.omitted_paths.includes("balance_coverage.accounts"));
});

test("default audit snapshot remains backward compatible with detailed daily and coverage rows", async () => {
  const response = await buildFixtureSnapshot();

  assert.ok(Array.isArray(response.daily_balances.rows));
  assert.ok(response.daily_balances.rows.length > 0);
  assert.ok(Array.isArray(response.balance_coverage.accounts));
  assert.ok(response.balance_coverage.accounts.length > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(response, "audit_handoff"), false);
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

test("audit snapshot exposes PayPal manual diagnostics", async () => {
  const response = await buildAuditSnapshot({
    query: { from: "2026-05-11", to: "2026-05-13" },
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          date: "2026-05-13",
          fromChannel: "пейпал евр",
          amount: "27.14",
          amountGross: "-27.14",
          amountFee: "",
          amountNet: "-27.14",
          currency: "EUR",
          source: "paypal_manual",
          rawSourceId: "paypal_manual:2026-05-13:booking-com-bv:-27-14:eur:payment",
          ledgerV2: {
            operation: "expense",
            from_channel: "пейпал евр",
            amount: "27.14",
            amount_gross: "-27.14",
            amount_fee: "",
            amount_net: "-27.14",
            balance_amount: -27.14,
            currency: "EUR",
            source: "paypal_manual",
            external_id: "paypal_manual:2026-05-13:booking-com-bv:-27-14:eur:payment",
            comment: "fee_missing=true; needs_provider_permission=true",
          },
        }),
        ledgerOperation({
          date: "2026-05-11",
          toChannel: "пейпал евр",
          amount: "36",
          amountGross: "36",
          amountFee: "",
          amountNet: "36",
          currency: "EUR",
          category: "business",
          source: "paypal_manual",
          rawSourceId: "paypal_manual:2026-05-11:booking-holdings:36:eur:refund",
          ledgerV2: {
            operation: "income",
            to_channel: "пейпал евр",
            amount: "36",
            amount_gross: "36",
            amount_fee: "",
            amount_net: "36",
            balance_amount: 36,
            currency: "EUR",
            source: "paypal_manual",
            external_id: "paypal_manual:2026-05-11:booking-holdings:36:eur:refund",
            comment: "PayPal manual refund expense correction; fee_missing=true; needs_provider_permission=true",
          },
        }),
      ],
      warnings: [],
    }),
  });

  assert.equal(response.paypal.paypal_manual_rows, 2);
  assert.equal(response.paypal.paypal_fee_missing_rows, 2);
  assert.equal(response.paypal.paypal_refund_rows, 1);
  assert.deepEqual(response.paypal.paypal_currencies, ["EUR"]);
  assert.equal(response.sources.paypal_manual, 2);
});

test("audit snapshot classifies missing PayPal amount_net as provider-permission incomplete", async () => {
  const response = await buildAuditSnapshot({
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          toChannel: "пейпал евр",
          amount: "36",
          amountUsd: "41.76",
          amountGross: "36",
          amountFee: "",
          amountNet: "",
          source: "paypal",
          rawSourceId: "paypal:missing-net",
          ledgerV2: {
            operation: "income",
            to_channel: "пейпал евр",
            amount: "36",
            amount_usd: "41.76",
            amount_gross: "36",
            amount_fee: "",
            amount_net: "",
            source: "paypal",
            external_id: "paypal:missing-net",
          },
        }),
      ],
      balances: [],
      warnings: [],
    }),
  });

  assert.equal(response.balances.missing_amount_net_rows, 1);
  assert.equal(response.balances.excluded_missing_amount_net_rows, 1);
  assert.match(response.warnings.join("\n"), /needs provider permission: 1 PayPal row/);
  assert.doesNotMatch(response.warnings.join("\n"), /1 row\(s\) have empty amount_net; balance was not calculated/);
  assert.equal(response.balance_fixes.missing_amount_net_rows[0].recommended_amount_net, null);
  assert.match(response.balance_fixes.missing_amount_net_rows[0].reason, /PayPal fee\/net is unavailable/);
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

test("audit snapshot counts YooMoney and Binance sources separately from unknown", async () => {
  const response = await buildAuditSnapshot({
    repositoryLoader: async () => ({
      ok: true,
      schema: "ledger-v2-compatible",
      operations: [
        ledgerOperation({
          source: "yoomoney",
          fromChannel: "Яндекс руб",
          ledgerV2: {
            source: "yoomoney",
            from_channel: "Яндекс руб",
          },
        }),
        ledgerOperation({
          source: "binance",
          fromChannel: "Бинанс spot",
          ledgerV2: {
            source: "binance",
            from_channel: "Бинанс spot",
          },
        }),
      ],
      warnings: [],
    }),
  });

  assert.equal(response.sources.yoomoney, 1);
  assert.equal(response.sources.binance, 1);
  assert.equal(response.sources.unknown, 0);
  assert.equal(response.summary.unknown_source_rows, 0);
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
