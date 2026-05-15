import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  buildBinanceSignedUrl,
  fetchBinanceStatementEntries,
  fetchBinanceSignedJson,
  getBinanceProviderConfigFromEnv,
  getBinanceProviderStatusFromEnv,
  normalizeBinanceDeposit,
  normalizeBinanceWithdrawal,
} from "../server/binance-transactions.js";
import apiHandler from "../api/index.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
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

test("missing Binance env returns no provider config", () => {
  assert.equal(getBinanceProviderConfigFromEnv({}), null);
  assert.equal(getBinanceProviderConfigFromEnv({ BINANCE_API_KEY: "key" }), null);
  assert.deepEqual(
    getBinanceProviderConfigFromEnv({
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET: "secret"
    }),
    {
      apiKey: "key",
      apiSecret: "secret",
      baseUrl: "https://api.binance.com"
    }
  );
});

test("Binance health status is browser-safe and redacts configured secrets", () => {
  const status = getBinanceProviderStatusFromEnv({
    BINANCE_API_KEY: "key-should-not-leak",
    BINANCE_API_SECRET: "secret-should-not-leak",
    BINANCE_API_BASE_URL: "https://api.binance.com"
  });

  assert.equal(status.ok, true);
  assert.equal(status.provider, "binance");
  assert.equal(status.configured, true);
  assert.equal(status.ready, true);
  assert.equal(status.env.BINANCE_API_KEY, "configured");
  assert.equal(status.env.BINANCE_API_SECRET, "configured");
  assert.equal(status.env.BINANCE_API_BASE_URL, "configured");
  assert.equal(JSON.stringify(status).includes("key-should-not-leak"), false);
  assert.equal(JSON.stringify(status).includes("secret-should-not-leak"), false);
});

test("GET /api/binance-transactions is routed through index and returns safe health status", async () => {
  const previousKey = process.env.BINANCE_API_KEY;
  const previousSecret = process.env.BINANCE_API_SECRET;
  const previousBase = process.env.BINANCE_API_BASE_URL;
  process.env.BINANCE_API_KEY = "live-key-should-not-leak";
  process.env.BINANCE_API_SECRET = "live-secret-should-not-leak";
  process.env.BINANCE_API_BASE_URL = "https://api.binance.com";

  try {
    const response = createResponseRecorder();
    await apiHandler({ method: "GET", query: { action: "binanceTransactions" }, body: null }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.provider, "binance");
    assert.equal(response.body?.configured, true);
    assert.equal(response.body?.env?.BINANCE_API_KEY, "configured");
    assert.equal(response.body?.env?.BINANCE_API_SECRET, "configured");
    assert.equal(response.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
    assert.equal(JSON.stringify(response.body).includes("live-key-should-not-leak"), false);
    assert.equal(JSON.stringify(response.body).includes("live-secret-should-not-leak"), false);
  } finally {
    if (previousKey === undefined) delete process.env.BINANCE_API_KEY;
    else process.env.BINANCE_API_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.BINANCE_API_SECRET;
    else process.env.BINANCE_API_SECRET = previousSecret;
    if (previousBase === undefined) delete process.env.BINANCE_API_BASE_URL;
    else process.env.BINANCE_API_BASE_URL = previousBase;
  }
});

test("Binance signed request uses timestamp signature and X-MBX-APIKEY header", async () => {
  const requests = [];
  await fetchBinanceSignedJson({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true });
        }
      };
    },
    baseUrl: "https://binance.example",
    path: "/api/v3/account",
    query: { omitZeroBalances: "true" },
    apiKey: "api-key",
    apiSecret: "api-secret",
    now: () => 1710000000000
  });

  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin, "https://binance.example");
  assert.equal(requestUrl.pathname, "/api/v3/account");
  assert.equal(requestUrl.searchParams.get("omitZeroBalances"), "true");
  assert.equal(requestUrl.searchParams.get("recvWindow"), "5000");
  assert.equal(requestUrl.searchParams.get("timestamp"), "1710000000000");
  const queryWithoutSignature = requestUrl.search.slice(1).replace(/&signature=[^&]+$/, "");
  const expectedSignature = createHmac("sha256", "api-secret").update(queryWithoutSignature).digest("hex");
  assert.equal(requestUrl.searchParams.get("signature"), expectedSignature);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers["X-MBX-APIKEY"], "api-key");
  assert.equal(requests[0].options.headers.Accept, "application/json");
});

test("buildBinanceSignedUrl keeps a deterministic HMAC signature", () => {
  const url = buildBinanceSignedUrl({
    baseUrl: "https://binance.example",
    path: "/sapi/v1/capital/deposit/hisrec",
    query: { startTime: "1000", endTime: "2000" },
    apiSecret: "secret",
    now: () => 3000
  });
  const queryWithoutSignature = url.search.slice(1).replace(/&signature=[^&]+$/, "");
  assert.equal(
    url.searchParams.get("signature"),
    createHmac("sha256", "secret").update(queryWithoutSignature).digest("hex")
  );
});

test("Binance API error and non-JSON response become structured warnings", async () => {
  const responses = [
    { ok: false, status: 401, body: JSON.stringify({ code: -2015, msg: "Invalid API-key" }) },
    { ok: false, status: 403, body: "<html>blocked</html>" },
    { ok: false, status: 418, body: JSON.stringify({ code: -1003, msg: "Too many requests" }) }
  ];
  const result = await fetchBinanceStatementEntries({
    startDate: "2026-05-01",
    endDate: "2026-05-02",
    apiKey: "api-key",
    apiSecret: "api-secret",
    baseUrl: "https://binance.example",
    now: () => 1710000000000,
    fetchImpl: async () => {
      const response = responses.shift();
      return {
        ok: response.ok,
        status: response.status,
        async text() {
          return response.body;
        }
      };
    }
  });

  assert.deepEqual(result.entries, []);
  assert.equal(result.endpointStatus.account, "warning");
  assert.match(result.warnings.join("\n"), /endpoint\/permission needs verification/);
  assert.match(result.warnings.join("\n"), /Invalid API-key/);
  assert.match(result.warnings.join("\n"), /non-JSON response/);
});

test("Binance deposit response normalizes to spot income with positive net USD", () => {
  const entry = normalizeBinanceDeposit({
    id: "dep-1",
    amount: "125.50",
    coin: "USDT",
    network: "TRX",
    status: 1,
    insertTime: 1777608000000,
    completeTime: 1777608060000,
    txId: "0xdeposit"
  });

  assert.equal(entry.source, "binance");
  assert.equal(entry.sourceTransactionId, "dep-1");
  assert.equal(entry.date, "2026-05-01");
  assert.equal(entry.channel, "Бинанс spot");
  assert.equal(entry.direction, "income");
  assert.equal(entry.currency, "USDT");
  assert.equal(entry.localAmount, 125.5);
  assert.equal(entry.grossAmount, 125.5);
  assert.equal(entry.netAmount, 125.5);
  assert.equal(entry.realNetUsd, 125.5);
  assert.equal(entry.feeAmount, 0);
  assert.equal(entry.needsVerification, false);
});

test("Binance withdrawal response normalizes to out direction and is excluded from real income", () => {
  const entry = normalizeBinanceWithdrawal({
    id: "wd-1",
    amount: "25",
    transactionFee: "1",
    coin: "USDT",
    network: "ETH",
    status: 6,
    applyTime: "2026-05-02 11:20:00",
    completeTime: 1777700000000,
    txId: "0xwithdrawal"
  });

  assert.equal(entry.source, "binance");
  assert.equal(entry.sourceTransactionId, "wd-1");
  assert.equal(entry.direction, "out");
  assert.equal(entry.localAmount, 25);
  assert.equal(entry.feeAmount, 1);
  assert.equal(entry.netAmount, 24);
  assert.equal(entry.realNetUsd, 24);
});

test("fetchBinanceStatementEntries reads account, deposits, and withdrawals endpoints", async () => {
  const requests = [];
  const result = await fetchBinanceStatementEntries({
    startDate: "2026-05-01",
    endDate: "2026-05-02",
    apiKey: "api-key",
    apiSecret: "api-secret",
    baseUrl: "https://binance.example",
    now: () => 1710000000000,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const pathname = new URL(url).pathname;
      if (pathname === "/api/v3/account") {
        return { ok: true, status: 200, async text() { return JSON.stringify({ balances: [] }); } };
      }
      if (pathname === "/sapi/v1/capital/deposit/hisrec") {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify([{ id: "dep-1", amount: "10", coin: "USDT", insertTime: 1777608000000, status: 1 }]);
          }
        };
      }
      if (pathname === "/sapi/v1/capital/withdraw/history") {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify([{ id: "wd-1", amount: "3", transactionFee: "0.5", coin: "USDT", completeTime: 1777700000000, status: 6 }]);
          }
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    "/api/v3/account",
    "/sapi/v1/capital/deposit/hisrec",
    "/sapi/v1/capital/withdraw/history"
  ]);
  assert.equal(result.transactionCount, 2);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].source, "binance");
  assert.equal(result.entries[0].direction, "income");
  assert.equal(result.entries[1].direction, "out");
  assert.deepEqual(result.endpointStatus, { account: "ok", deposits: "ok", withdrawals: "ok" });
});
