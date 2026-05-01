import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  fetchMonobankClientInfo,
  summarizeMonobankClientAccounts,
  fetchMonobankStatementEntries,
  normalizeMonobankStatementItem,
  summarizeMonobankStatementEntries,
} from "../api/monobank-transactions.js";

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
    }
  };
}

test("normalizeMonobankStatementItem maps UAH card statement rows to ledger entries", () => {
  const entry = normalizeMonobankStatementItem(
    {
      id: "MONO-1",
      time: 1776679200,
      description: "Оплата курсу",
      mcc: 8299,
      amount: -451760,
      operationAmount: -451760,
      currencyCode: 980,
      commissionRate: -1500,
      balance: 1000000,
      counterName: "ФОП Ковалев",
      counterIban: "UA123",
      comment: "навчання"
    },
    { id: "acc-uah", currencyCode: 980, type: "black", maskedPan: ["444111******2222"] },
    0
  );

  assert.equal(entry.date, "2026-04-20");
  assert.equal(entry.channel, "монобанк грн");
  assert.equal(entry.direction, "expense");
  assert.equal(entry.localAmount, 4517.6);
  assert.equal(entry.currency, "UAH");
  assert.equal(entry.suggestedCategory, "study");
  assert.equal(entry.organization, "Оплата курсу | навчання | mcc 8299 | account black ****2222");
  assert.equal(entry.counterpartyName, "ФОП Ковалев");
  assert.equal(entry.counterpartyLabel, "Кому: ФОП Ковалев");
  assert.equal(entry.counterIban, "UA123");
  assert.equal(entry.feeAmount, 15);
  assert.equal(entry.operationType, "expense");
  assert.equal(entry.source, "monobank");
  assert.equal(entry.sourceTransactionId, "MONO-1");
});

test("normalizeMonobankStatementItem marks exchange-like outflows for ledger mapping", () => {
  const entry = normalizeMonobankStatementItem(
    {
      id: "MONO-EX-1",
      time: 1776679200,
      description: "P2P Binance top up",
      comment: "crypto exchange",
      amount: -100000,
      currencyCode: 980
    },
    { id: "acc-uah", currencyCode: 980, type: "black", maskedPan: ["444111******2222"] },
    0
  );

  assert.equal(entry.direction, "exchange");
  assert.equal(entry.suggestedCategory, "exchange");
  assert.equal(entry.operationType, "exchange");
});

test("summarizeMonobankStatementEntries groups income and expenses by month", () => {
  const summary = summarizeMonobankStatementEntries([
    { date: "2026-04-01", direction: "income", localAmount: 100, currency: "UAH" },
    { date: "2026-04-02", direction: "expense", localAmount: 40, currency: "UAH" }
  ]);

  assert.deepEqual(summary.totalsByCurrency.UAH, { income: 100, expense: 40, net: 60 });
});

test("summarizeMonobankClientAccounts masks cards and keeps ids for account selection", () => {
  const accounts = summarizeMonobankClientAccounts({
    accounts: [
      {
        id: "acc-uah",
        currencyCode: 980,
        type: "black",
        maskedPan: ["444111******2222"],
        iban: "UA123456789012345678901234567",
      }
    ]
  });

  assert.deepEqual(accounts, [
    {
      id: "acc-uah",
      currency: "UAH",
      type: "black",
      label: "UAH black ****2222",
      maskedPan: "****2222",
      maskedIban: "UA12...4567",
    }
  ]);
});

test("fetchMonobankClientInfo validates token and returns masked account summaries", async () => {
  const result = await fetchMonobankClientInfo({
    apiToken: "mono-token",
    baseUrl: "https://mono.example.com",
    fetchImpl: async (url, options) => {
      assert.equal(String(url), "https://mono.example.com/personal/client-info");
      assert.equal(options.headers["X-Token"], "mono-token");
      return {
        ok: true,
        async json() {
          return {
            name: "Mono User",
            accounts: [
              { id: "acc-uah", currencyCode: 980, type: "black", maskedPan: ["444111******2222"] }
            ]
          };
        }
      };
    }
  });

  assert.equal(result.client.name, "Mono User");
  assert.deepEqual(result.accounts, [
    {
      id: "acc-uah",
      currency: "UAH",
      type: "black",
      label: "UAH black ****2222",
      maskedPan: "****2222",
      maskedIban: "",
    }
  ]);
});

test("fetchMonobankClientInfo surfaces invalid-token failures", async () => {
  await assert.rejects(
    () => fetchMonobankClientInfo({
      apiToken: "mono-token",
      baseUrl: "https://mono.example.com",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        async json() {
          return { errorDescription: "invalid token" };
        }
      })
    }),
    /invalid token/i
  );
});

test("fetchMonobankStatementEntries loads client accounts and statements", async () => {
  const urls = [];
  const result = await fetchMonobankStatementEntries({
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    apiToken: "mono-token",
    baseUrl: "https://mono.example.com",
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      assert.equal(options.headers["X-Token"], "mono-token");
      if (String(url).endsWith("/personal/client-info")) {
        return {
          ok: true,
          async json() {
            return {
              accounts: [
                { id: "acc-uah", currencyCode: 980, type: "black", maskedPan: ["444111******2222"] }
              ]
            };
          }
        };
      }
      assert.match(String(url), /\/personal\/statement\/acc-uah\/1775001600\/1775174399$/);
      return {
        ok: true,
        async json() {
          return [
            {
              id: "MONO-2",
              time: 1775041200,
              description: "Client transfer",
              amount: 10000,
              currencyCode: 980
            }
          ];
        }
      };
    }
  });

  assert.equal(urls.length, 2);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].direction, "income");
  assert.equal(result.transactionCount, 1);
  assert.equal(result.source, "monobank");
});

test("handler validate action redacts token from error responses", async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return { errorDescription: "Token mono-secret-token is invalid." };
    }
  });

  try {
    const request = {
      method: "POST",
      body: {
        action: "validate",
        apiToken: "mono-secret-token"
      }
    };
    const response = createResponseRecorder();
    await handler(request, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body?.ok, false);
    assert.doesNotMatch(response.body?.error || "", /mono-secret-token/);
    assert.match(response.body?.error || "", /invalid/i);
  } finally {
    global.fetch = previousFetch;
  }
});
