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
  assert.ok(response.paypal);
  assert.ok(response.exchange);
  assert.ok(response.sources);
  assert.ok(Array.isArray(response.warnings));
  assert.ok(Array.isArray(response.audit_checks));
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

test("audit snapshot counts fallback amount rows and warns when amount_net is missing", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.balances.fallback_amount_rows, 1);
  assert.match(response.warnings.join("\n"), /amount_net.*balance falls back to amount/i);
});

test("audit snapshot warns when exchange amount_usd is missing", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.exchange.rows, 2);
  assert.equal(response.exchange.missing_amount_usd_rows, 1);
  assert.equal(response.exchange.compatibility_mode, true);
  assert.match(response.warnings.join("\n"), /exchange row\(s\).*amount_usd/i);
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

test("audit snapshot counts unknown source rows", async () => {
  const response = await buildFixtureSnapshot();

  assert.equal(response.sources.unknown, 1);
  assert.equal(response.summary.unknown_source_rows, 1);
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
