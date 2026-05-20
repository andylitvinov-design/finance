import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  buildBinanceSignedUrl,
  fetchBinanceStatementEntries,
  fetchBinanceSignedJson,
  getBinanceProviderConfigFromEnv,
  normalizeBinanceCsvTransaction,
  normalizeBinanceDeposit,
  normalizeBinancePayTransaction,
  normalizeBinanceWithdrawal,
  parseBinanceTransactionHistoryCsv,
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

test("GET /api/binance-transactions is routed through index and returns 405", async () => {
  const response = createResponseRecorder();
  await apiHandler({ method: "GET", query: { action: "binanceTransactions" }, body: null }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.body?.ok, false);
  assert.equal(response.body?.error, "Unsupported method: GET");
  assert.equal(response.headers["access-control-allow-methods"], "POST, OPTIONS");
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
    { ok: false, status: 418, body: JSON.stringify({ code: -1003, msg: "Too many requests" }) },
    { ok: false, status: 403, body: JSON.stringify({ code: -2015, msg: "Pay unavailable" }) }
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
  assert.match(result.warnings.join("\n"), /Binance Pay operations may be missing; use Gmail\/CSV fallback/);
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

  assert.equal(entry.source, "binance_deposit");
  assert.match(entry.sourceTransactionId, /^binance_deposit:2026-05-01T04:01:00Z:125.5:USDT:dep-1$/);
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

  assert.equal(entry.source, "binance_withdrawal");
  assert.match(entry.sourceTransactionId, /^binance_withdrawal:2026-05-02T05:33:20Z:24:USDT:wd-1$/);
  assert.equal(entry.direction, "out");
  assert.equal(entry.localAmount, 25);
  assert.equal(entry.feeAmount, 1);
  assert.equal(entry.netAmount, 24);
  assert.equal(entry.realNetUsd, 24);
});

test("Binance Pay receive normalizes to Funding income with deterministic source id", () => {
  const entry = normalizeBinancePayTransaction({
    orderType: "C2C",
    transactionId: "pay-receive-1",
    transactionTime: 1778247050000,
    amount: "915.5",
    currency: "USDT",
    walletType: 2,
    payerInfo: { name: "Arsenchios", binanceId: "payer-1" },
    receiverInfo: { binanceId: "me" }
  });

  assert.equal(entry.source, "binance_pay");
  assert.equal(entry.sourceTransactionId, "binance_pay_receive:2026-05-08T13:30:50Z:915.5:USDT:Arsenchios");
  assert.equal(entry.date, "2026-05-08");
  assert.equal(entry.channel, "Binance funding");
  assert.equal(entry.toChannel, "Binance funding");
  assert.equal(entry.direction, "income");
  assert.equal(entry.counterparty, "Arsenchios");
  assert.equal(entry.localAmount, 915.5);
  assert.equal(entry.netAmount, 915.5);
  assert.equal(entry.realNetUsd, 915.5);
  assert.equal(entry.suggestedCategory, "serviceIncome");
  assert.match(entry.description, /Binance Pay Receive Crypto from Arsenchios/);
});

test("Binance Pay send normalizes to funding outflow when wallet evidence says Funding", () => {
  const entry = normalizeBinancePayTransaction({
    orderType: "C2C",
    transactionId: "pay-send-1",
    transactionTime: 1777645137000,
    amount: "-700",
    currency: "USDT",
    walletType: "Funding",
    payerInfo: { binanceId: "me" },
    receiverInfo: { name: "RudGard", binanceId: "receiver-1" }
  });

  assert.equal(entry.source, "binance_pay");
  assert.equal(entry.sourceTransactionId, "binance_pay_send:2026-05-01T14:18:57Z:700:USDT:RudGard");
  assert.equal(entry.date, "2026-05-01");
  assert.equal(entry.channel, "Binance funding");
  assert.equal(entry.fromChannel, "Binance funding");
  assert.equal(entry.direction, "out");
  assert.equal(entry.counterparty, "RudGard");
  assert.equal(entry.localAmount, 700);
  assert.equal(entry.netAmount, -700);
  assert.equal(entry.realNetUsd, null);
  assert.equal(entry.suggestedCategory, "business");
  assert.match(entry.description, /Binance Pay Send Crypto to RudGard/);
});

test("fetchBinanceStatementEntries reads account, deposits, withdrawals, and pay endpoints", async () => {
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
      if (pathname === "/sapi/v1/pay/transactions") {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              code: "000000",
              message: "success",
              success: true,
              data: [
                {
                  transactionId: "pay-in",
                  transactionTime: 1778247050000,
                  amount: "915.5",
                  currency: "USDT",
                  walletType: 2,
                  payerInfo: { name: "Arsenchios" },
                  receiverInfo: { binanceId: "me" }
                },
                {
                  transactionId: "pay-out",
                  transactionTime: 1777645137000,
                  amount: "-700",
                  currency: "USDT",
                  walletType: 2,
                  payerInfo: { binanceId: "me" },
                  receiverInfo: { name: "RudGard" }
                }
              ]
            });
          }
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });

  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    "/api/v3/account",
    "/sapi/v1/capital/deposit/hisrec",
    "/sapi/v1/capital/withdraw/history",
    "/sapi/v1/pay/transactions"
  ]);
  assert.equal(result.transactionCount, 4);
  assert.equal(result.entries.length, 4);
  assert.equal(result.entries[0].source, "binance_deposit");
  assert.equal(result.entries[0].direction, "income");
  assert.equal(result.entries[1].direction, "out");
  assert.equal(result.entries[2].source, "binance_pay");
  assert.equal(result.entries[2].sourceTransactionId, "binance_pay_receive:2026-05-08T13:30:50Z:915.5:USDT:Arsenchios");
  assert.equal(result.entries[3].sourceTransactionId, "binance_pay_send:2026-05-01T14:18:57Z:700:USDT:RudGard");
  assert.deepEqual(result.endpointStatus, { account: "ok", deposits: "ok", withdrawals: "ok", pay: "ok", csv: "not_provided", email: "not_provided" });
  assert.equal(result.summary.totalsByCurrency.USDT.income, 925.5);
  assert.equal(result.summary.totalsByCurrency.USDT.out, 703);
  assert.equal(result.summary.totalsByCurrency.USDT.net, 222.5);
});

test("Binance Pay duplicate imports are idempotent by raw source id and do not duplicate deposits", async () => {
  const responseByPath = {
    "/api/v3/account": { balances: [] },
    "/sapi/v1/capital/deposit/hisrec": [
      { id: "dep-103", amount: "103", coin: "USDT", insertTime: 1778763453000, status: 1 }
    ],
    "/sapi/v1/capital/withdraw/history": [],
    "/sapi/v1/pay/transactions": {
      data: [
        {
          transactionId: "pay-in",
          transactionTime: 1778247050000,
          amount: "915.5",
          currency: "USDT",
          payerInfo: { name: "Arsenchios" }
        },
        {
          transactionId: "pay-in-duplicate",
          transactionTime: 1778247050000,
          amount: "915.5",
          currency: "USDT",
          payerInfo: { name: "Arsenchios" }
        }
      ]
    }
  };
  const result = await fetchBinanceStatementEntries({
    startDate: "2026-05-01",
    endDate: "2026-05-20",
    apiKey: "api-key",
    apiSecret: "api-secret",
    baseUrl: "https://binance.example",
    now: () => 1710000000000,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(responseByPath[new URL(url).pathname]);
      }
    })
  });

  const sourceIds = result.entries.map((entry) => entry.sourceTransactionId);
  assert.equal(sourceIds.filter((id) => /^binance_deposit:/.test(id)).length, 1);
  assert.equal(
    sourceIds.filter((id) => id === "binance_pay_receive:2026-05-08T13:30:50Z:915.5:USDT:Arsenchios").length,
    1
  );
});

test("Binance transaction history CSV maps Pay, Deposit, Earn transfers, and interest by wallet", () => {
  const rows = parseBinanceTransactionHistoryCsv([
    "UTC Time,Account,Operation,Coin,Change,Remark,Status",
    "2026-05-08 13:30:50,Funding,Binance Pay,USDT,915.5,from Arsenchios,Completed",
    "2026-05-01 14:18:57,Funding,Binance Pay,USDT,-700,to RudGard,Completed",
    "2026-05-14 13:37:33,Spot,Deposit,USDT,103,tx 0xabc,Completed",
    "2026-03-28 10:00:00,Spot,Simple Earn Flexible Subscription,USDT,-896,subscribe,Completed",
    "2026-03-29 10:00:00,Spot,Simple Earn Flexible Redemption,USDT,896,redeem,Completed",
    "2026-03-30 10:00:00,Earn,Simple Earn Flexible Interest,USDT,1.25,interest,Completed",
  ].join("\n"));

  const entries = rows.flatMap((row, index) => normalizeBinanceCsvTransaction(row, index));
  assert.equal(entries.find((entry) => entry.rawSourceId.startsWith("binance_pay_receive:"))?.toChannel, "Binance funding");
  assert.equal(entries.find((entry) => entry.rawSourceId.startsWith("binance_pay_send:"))?.fromChannel, "Binance funding");
  assert.equal(entries.find((entry) => entry.rawSourceId.startsWith("binance_deposit:"))?.toChannel, "Бинанс spot");

  const subscribe = entries.filter((entry) => entry.transferGroupId?.startsWith("binance_earn_subscribe:"));
  assert.equal(subscribe.length, 2);
  assert.equal(subscribe.find((entry) => entry.direction === "out")?.fromChannel, "Бинанс spot");
  assert.equal(subscribe.find((entry) => entry.direction === "income")?.toChannel, "binance save");
  assert.equal(subscribe.reduce((sum, entry) => sum + Number(entry.netAmount || 0), 0), 0);

  const redemption = entries.filter((entry) => entry.transferGroupId?.startsWith("binance_earn_redemption:"));
  assert.equal(redemption.length, 2);
  assert.equal(redemption.find((entry) => entry.direction === "out")?.fromChannel, "binance save");
  assert.equal(redemption.find((entry) => entry.direction === "income")?.toChannel, "Бинанс spot");
  assert.equal(redemption.reduce((sum, entry) => sum + Number(entry.netAmount || 0), 0), 0);

  const interest = entries.find((entry) => entry.rawSourceId.startsWith("binance_earn_interest:"));
  assert.equal(interest.toChannel, "binance save");
  assert.equal(interest.source, "binance_earn_interest");
  assert.match(interest.comment, /wallet evidence/);
});
