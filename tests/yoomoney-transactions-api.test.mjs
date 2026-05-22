import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  fetchYooMoneyStatementEntries,
  normalizeYooMoneyOperation,
  summarizeYooMoneyStatementEntries,
} from "../api/yoomoney-transactions.js";

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

test("normalizeYooMoneyOperation maps wallet operations to common and site entry fields", () => {
  const income = normalizeYooMoneyOperation({
    operation_id: "YM-1",
    status: "success",
    direction: "in",
    amount: 1500.25,
    datetime: "2026-04-20T14:30:00.000+03:00",
    title: "Пополнение через СБП",
    sender: "Client",
    comment: "Invoice 44",
    type: "deposition"
  }, { currency: "RUB" }, 0);

  assert.equal(income.date, "2026-04-20");
  assert.equal(income.provider, "yoomoney");
  assert.equal(income.operation_id, "YM-1");
  assert.equal(income.direction, "income");
  assert.equal(income.amount, 1500.25);
  assert.equal(income.currency, "RUB");
  assert.equal(income.counterparty, "Client");
  assert.equal(income.comment, "Invoice 44");
  assert.equal(income.status, "success");
  assert.equal(income.raw.type, "deposition");
  assert.equal(income.channel, "Яндекс руб");
  assert.equal(income.localAmount, 1500.25);
  assert.equal(income.source, "yoomoney");
  assert.equal(income.sourceTransactionId, "YM-1");
  assert.equal(income.suggestedCategory, "serviceIncome");
  assert.equal(income.counterpartyLabel, "От: Client");

  const expense = normalizeYooMoneyOperation({
    operation_id: "YM-2",
    status: "success",
    direction: "out",
    amount: "99.90",
    datetime: "2026-04-21T10:00:00.000+03:00",
    title: "Оплата сервиса",
    recipient: "Service LLC",
    type: "payment-shop"
  }, { currency: "RUB" }, 1);

  assert.equal(expense.direction, "expense");
  assert.equal(expense.counterparty, "Service LLC");
  assert.equal(expense.counterpartyLabel, "Кому: Service LLC");
  assert.equal(expense.suggestedCategory, "business");
});

test("summarizeYooMoneyStatementEntries groups income and expense by month and currency", () => {
  const summary = summarizeYooMoneyStatementEntries([
    { date: "2026-04-01", direction: "income", amount: 100, currency: "RUB" },
    { date: "2026-04-02", direction: "expense", amount: 40, currency: "RUB" },
    { date: "2026-05-01", direction: "expense", amount: 7, currency: "USD" }
  ]);

  assert.deepEqual(summary.months, [
    {
      month: "2026-04",
      totalsByCurrency: {
        RUB: { income: 100, expense: 40, net: 60 }
      }
    },
    {
      month: "2026-05",
      totalsByCurrency: {
        USD: { income: 0, expense: 7, net: -7 }
      }
    }
  ]);
});

test("fetchYooMoneyStatementEntries posts operation-history and follows next_record", async () => {
  const requests = [];
  const result = await fetchYooMoneyStatementEntries({
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    accessToken: "wallet-token",
    baseUrl: "https://yoomoney.example",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer wallet-token");
      assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("records"), "100");
      assert.equal(params.get("from"), "2026-04-01T00:00:00Z");
      assert.equal(params.get("till"), "2026-04-02T23:59:59Z");
      if (requests.length === 1) {
        assert.equal(params.get("type"), "deposition payment");
        assert.equal(params.get("start_record"), null);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              next_record: "2",
              operations: [
                {
                  operation_id: "YM-1",
                  status: "success",
                  direction: "in",
                  amount: 10,
                  datetime: "2026-04-01T12:00:00.000+03:00",
                  title: "Top up",
                  type: "deposition"
                }
              ]
            };
          }
        };
      }
      if (requests.length === 2) {
        assert.equal(params.get("type"), "deposition payment");
        assert.equal(params.get("start_record"), "2");
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              operations: [
                {
                  operation_id: "YM-2",
                  status: "success",
                  direction: "out",
                  amount: 4,
                  datetime: "2026-04-02T12:00:00.000+03:00",
                  title: "Payment",
                  type: "payment-shop"
                }
              ]
            };
          }
        };
      }
      assert.equal(params.get("type"), null);
      assert.equal(params.get("start_record"), null);
      return {
        ok: true,
        status: 200,
        async json() {
          return { operations: [] };
        }
      };
    }
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, "https://yoomoney.example/api/operation-history");
  assert.equal(result.entries.length, 2);
  assert.equal(result.transactionCount, 2);
  assert.equal(result.source, "yoomoney");
  assert.deepEqual(result.summary.totalsByCurrency.RUB, { income: 10, expense: 4, net: 6 });
  assert.deepEqual(result.diagnostics.history_types, ["deposition payment", "unfiltered"]);
  assert.equal(result.diagnostics.requests.length, 3);
});

test("fetchYooMoneyStatementEntries adds unfiltered history coverage and dedupes operations", async () => {
  const requests = [];
  const result = await fetchYooMoneyStatementEntries({
    startDate: "2026-05-19",
    endDate: "2026-05-21",
    accessToken: "wallet-token",
    baseUrl: "https://yoomoney.example",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const params = new URLSearchParams(options.body);
      const type = params.get("type") || "unfiltered";

      if (type === "deposition payment") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              operations: [
                {
                  operation_id: "YM-DUP",
                  status: "success",
                  direction: "in",
                  amount: 420.51,
                  datetime: "2026-05-19T13:49:03Z",
                  title: "Сбербанк, пополнение",
                  type: "deposition"
                }
              ]
            };
          }
        };
      }

      assert.equal(params.get("type"), null);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            operations: [
              {
                operation_id: "YM-DUP",
                status: "success",
                direction: "in",
                amount: 420.51,
                datetime: "2026-05-19T13:49:03Z",
                title: "Сбербанк, пополнение",
                type: "deposition"
              },
              {
                operation_id: "YM-275553",
                status: "success",
                direction: "in",
                amount: 2755.53,
                datetime: "2026-05-20T09:00:00Z",
                title: "Пополнение YooMoney",
                type: "incoming-transfer"
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(requests.length, 2);
  assert.equal(new URLSearchParams(requests[0].options.body).get("type"), "deposition payment");
  assert.equal(new URLSearchParams(requests[1].options.body).get("type"), null);
  assert.equal(result.transactionCount, 2);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries.filter((entry) => entry.sourceTransactionId === "YM-DUP").length, 1);
  const missingIncome = result.entries.find((entry) => entry.sourceTransactionId === "YM-275553");
  assert.ok(missingIncome);
  assert.equal(missingIncome.direction, "income");
  assert.equal(missingIncome.amount, 2755.53);
  assert.equal(missingIncome.currency, "RUB");
  assert.equal(missingIncome.channel, "Яндекс руб");
  assert.equal(result.diagnostics.operation_counts["deposition payment"], 1);
  assert.equal(result.diagnostics.operation_counts.unfiltered, 2);
  assert.equal(result.diagnostics.raw_operation_count, 3);
  assert.equal(result.diagnostics.deduped_operation_count, 2);
  assert.equal(result.diagnostics.duplicate_operation_count, 1);
  assert.equal(result.diagnostics.requests.length, 2);
});

test("handler returns graceful YooMoney configuration error when token is missing", async () => {
  const previousToken = process.env.YOOMONEY_ACCESS_TOKEN;
  delete process.env.YOOMONEY_ACCESS_TOKEN;
  try {
    const response = createResponseRecorder();
    await handler(
      { method: "POST", body: { startDate: "2026-04-01", endDate: "2026-04-01" } },
      response
    );

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /YOOMONEY_ACCESS_TOKEN/);
  } finally {
    if (previousToken === undefined) {
      delete process.env.YOOMONEY_ACCESS_TOKEN;
    } else {
      process.env.YOOMONEY_ACCESS_TOKEN = previousToken;
    }
  }
});
