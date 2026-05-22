import test from "node:test";
import assert from "node:assert/strict";

import {
  default as privatBankTransactionsHandler,
  fetchPrivatBankStatementEntries,
  normalizePrivatBankStatementItem,
  parsePrivat24PersonalStatementPayload,
  summarizePrivatBankStatementEntries,
} from "../api/privatbank-transactions.js";

test("normalizePrivatBankStatementItem maps common statement rows to ledger entries", () => {
  const entry = normalizePrivatBankStatementItem(
    {
      id: "PB-1",
      date: "20.04.2026",
      amount: "-4517.60",
      currency: "UAH",
      description: "Оплата сервісу",
      counterparty: "ТОВ Сервіс",
      counterpartyIban: "UA999",
      purpose: "рахунок 44"
    },
    { accountId: "UA111", currency: "UAH" },
    0
  );

  assert.equal(entry.date, "2026-04-20");
  assert.equal(entry.channel, "приват 24-грн");
  assert.equal(entry.direction, "expense");
  assert.equal(entry.localAmount, 4517.6);
  assert.equal(entry.currency, "UAH");
  assert.equal(entry.usdAmount, 103.0005);
  assert.equal(entry.organization, "Оплата сервісу | рахунок 44 | account UA111");
  assert.equal(entry.counterpartyName, "ТОВ Сервіс");
  assert.equal(entry.counterpartyLabel, "Кому: ТОВ Сервіс");
  assert.equal(entry.counterIban, "UA999");
  assert.equal(entry.source, "privatbank");
  assert.equal(entry.sourceTransactionId, "PB-1");
  assert.equal(entry.externalId, "PB-1");
});

test("normalizePrivatBankStatementItem keeps exchange details for ledger dual-row save", () => {
  const entry = normalizePrivatBankStatementItem({
    id: "PB-EX-1",
    date: "2026-04-21",
    amount: "-4300",
    currency: "UAH",
    toAmount: "100",
    toCurrency: "USD",
    description: "Обмін валюти"
  });

  assert.equal(entry.direction, "exchange");
  assert.equal(entry.suggestedCategory, "exchange");
  assert.equal(entry.usdAmount, 98.0392);
  assert.equal(entry.toChannel, "приват 24-дол");
  assert.equal(entry.toAmount, 100);
  assert.equal(entry.toCurrency, "USD");
  assert.equal(entry.exchangeGroupId, "PB-EX-1");
});

test("summarizePrivatBankStatementEntries groups totals by currency", () => {
  const summary = summarizePrivatBankStatementEntries([
    { date: "2026-04-01", direction: "income", localAmount: 10, currency: "UAH" },
    { date: "2026-04-02", direction: "expense", localAmount: 3, currency: "UAH" }
  ]);

  assert.deepEqual(summary.totalsByCurrency.UAH, { income: 10, expense: 3, net: 7 });
});

test("fetchPrivatBankStatementEntries calls configured endpoint with date range", async () => {
  const result = await fetchPrivatBankStatementEntries({
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    apiToken: "privat-token",
    accountId: "UA111",
    baseUrl: "https://privat.example.com/statements",
    fetchImpl: async (url, options) => {
      assert.match(String(url), /^https:\/\/privat\.example\.com\/statements\?/);
      assert.match(String(url), /startDate=2026-04-01/);
      assert.match(String(url), /endDate=2026-04-02/);
      assert.match(String(url), /account=UA111/);
      assert.equal(options.headers.Authorization, "Bearer privat-token");
      return {
        ok: true,
        async json() {
          return {
            statements: [
              {
                id: "PB-2",
                date: "2026-04-01",
                amount: "100.00",
                currency: "UAH",
                description: "Incoming payment"
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].direction, "income");
  assert.equal(result.entries[0].usdAmount, 2.28);
  assert.equal(result.ledgerRows.length, 1);
  assert.equal(result.ledgerRows[0].amount_usd, "2.28");
  assert.equal(result.transactionCount, 1);
  assert.equal(result.source, "privatbank");
});

test("parsePrivat24PersonalStatementPayload imports personal CSV without business credentials", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    statementText: "Дата операции;Сумма операции;Валюта карты;Детали операции;Получатель;Комиссия;Номер операции\n24.04.2026;-123,45;UAH;Невідомий тип операції;Сервіс;1,50;PB-PERSONAL-1"
  });

  assert.equal(result.source, "privat24");
  assert.equal(result.mode, "personal-statement-import");
  assert.equal(result.transactionCount, 1);
  assert.equal(result.ledgerRows[0].source, "privat24");
  assert.equal(result.ledgerRows[0].external_id, "PB-PERSONAL-1");
  assert.equal(result.ledgerRows[0].fee_amount, "1.5");
  assert.equal(result.ledgerRows[0].review_status, "needs_review");
  assert.equal(result.entries[0].source, "privat24");
  assert.equal(result.entries[0].provider, "privatbank");
  assert.equal(result.entries[0].reviewStatus, "needs_review");
  assert.deepEqual(result.warnings, ["PB-PERSONAL-1: needs_review"]);
});

test("parsePrivat24PersonalStatementPayload accepts Privat24 exported headers after title row", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    statementText: [
      "Історія операцій за період 22.02.2026 - 22.05.2026",
      "Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Сума в валюті транзакції;Валюта транзакції;Залишок на кінець періоду;Валюта залишку",
      "22.05.2026 15:01:35;Платежі за реквізитами;4149 **** **** 8858;НЕМІШ БОГДАН ЮРІЙОВИЧ ФОП. Коментар: Splata za informatsiini posluhy;-20003;UAH;20003;UAH;93.27;UAH",
      "16.05.2026 00:03:34;Зарахування переказу;4149 **** **** 8858;Урсул Г.;8700;UAH;8700;UAH;20096.27;UAH",
      "12.05.2026 04:06:51;Цифрові товари;4149 **** **** 8858;GOOGLE *Meetup Social, g.co/helppay#;-4842.92;UAH;4799.99;UAH;11396.27;UAH",
      "04.05.2026 15:28:41;Зарахування переказу;4149 **** **** 8858;Литвиненко В.;5000;UAH;5000;UAH;16239.19;UAH"
    ].join("\n")
  });

  assert.equal(result.transactionCount, 4);
  assert.equal(result.ledgerRows.length, 4);
  assert.deepEqual(
    result.ledgerRows.map((row) => [row.date, row.operation, row.from_channel, row.to_channel, row.amount, row.currency, row.direction]),
    [
      ["2026-05-22", "business_expense", "приват 24-грн", "", "20003", "UAH", "out"],
      ["2026-05-16", "income", "", "приват 24-грн", "8700", "UAH", "in"],
      ["2026-05-12", "business_expense", "приват 24-грн", "", "4842.92", "UAH", "out"],
      ["2026-05-04", "income", "", "приват 24-грн", "5000", "UAH", "in"]
    ]
  );
  assert.match(result.ledgerRows[0].comment, /statement balance after: 93.27 UAH/);
  assert.match(result.ledgerRows[1].comment, /statement balance after: 20096.27 UAH/);
  assert.equal(result.diagnostics.coverage.input_rows_count, 4);
  assert.equal(result.diagnostics.coverage.ledger_rows_count, 4);
  assert.equal(result.diagnostics.coverage.hard_fail, false);
});

test("parsePrivat24PersonalStatementPayload skips title-only lines instead of dropping statement rows", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    statementText: "Some exported statement title\nДата;Опис операції;Сума в валюті картки;Валюта картки\n04.05.2026 15:28:41;Литвиненко В.;5000;UAH"
  });

  assert.equal(result.transactionCount, 1);
  assert.equal(result.ledgerRows[0].date, "2026-05-04");
  assert.equal(result.ledgerRows[0].amount, "5000");
  assert.equal(result.ledgerRows[0].operation, "income");
});

test("parsePrivat24PersonalStatementPayload validates Privat24 balance-after chain", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    previousBalance: "11239.19",
    statementText: [
      "Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку",
      "22.05.2026 15:01:35;Платежі за реквізитами;4149;НЕМІШ БОГДАН ЮРІЙОВИЧ ФОП;-20003;UAH;93.27;UAH",
      "16.05.2026 00:03:34;Зарахування переказу;4149;Урсул Г.;8700;UAH;20096.27;UAH",
      "12.05.2026 04:06:51;Цифрові товари;4149;GOOGLE *Meetup Social;-4842.92;UAH;11396.27;UAH",
      "04.05.2026 15:28:41;Зарахування переказу;4149;Литвиненко В.;5000;UAH;16239.19;UAH"
    ].join("\n")
  });

  assert.equal(result.diagnostics.balance_chain.balance_chain_ok, true);
  assert.equal(result.diagnostics.balance_chain.balance_chain_gap, false);
  assert.equal(result.diagnostics.coverage.parser_warnings.length, 0);
});

test("parsePrivat24PersonalStatementPayload catches missed +5000 row through balance-after diagnostics", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    previousBalance: "11239.19",
    statementText: [
      "Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку",
      "16.05.2026 00:03:34;Зарахування переказу;4149;Урсул Г.;8700;UAH;20096.27;UAH",
      "12.05.2026 04:06:51;Цифрові товари;4149;GOOGLE *Meetup Social;-4842.92;UAH;11396.27;UAH"
    ].join("\n")
  });

  assert.equal(result.diagnostics.balance_chain.balance_chain_gap, true);
  assert.equal(result.diagnostics.balance_chain.first_gap_row.date, "2026-05-12");
  assert.match(result.warnings.join(" | "), /balance chain gap/);
});

test("parsePrivat24PersonalStatementPayload catches missed -4842.92 row through balance-after diagnostics", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    previousBalance: "11239.19",
    statementText: [
      "Дата;Категорія;Картка;Опис операції;Сума в валюті картки;Валюта картки;Залишок на кінець періоду;Валюта залишку",
      "16.05.2026 00:03:34;Зарахування переказу;4149;Урсул Г.;8700;UAH;20096.27;UAH",
      "04.05.2026 15:28:41;Зарахування переказу;4149;Литвиненко В.;5000;UAH;16239.19;UAH"
    ].join("\n")
  });

  assert.equal(result.diagnostics.balance_chain.balance_chain_gap, true);
  assert.equal(result.diagnostics.balance_chain.first_gap_row.date, "2026-05-16");
  assert.equal(result.diagnostics.balance_chain.expected_balance_after, 24939.19);
  assert.equal(result.diagnostics.balance_chain.provider_balance_after, 20096.27);
});

test("parsePrivat24PersonalStatementPayload flags possible fee double-count rows", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    statementRows: [
      { date: "2026-05-22", amount: "-20003", currency: "UAH", description: "Total payment", external_id: "PB-TOTAL" },
      { date: "2026-05-22", amount: "-20000", currency: "UAH", description: "Payment principal", external_id: "PB-PRINCIPAL" },
      { date: "2026-05-22", amount: "-3", currency: "UAH", description: "Payment fee", external_id: "PB-FEE" }
    ]
  });

  assert.equal(result.diagnostics.fee_double_count.likely_fee_double_count, true);
  assert.match(result.warnings.join(" | "), /possible fee double-count/);
});

test("parsePrivat24PersonalStatementPayload exposes hard fail when input rows produce zero ledger rows", () => {
  const result = parsePrivat24PersonalStatementPayload({
    action: "parseStatement",
    statementRows: [{ unexpected: "operation-like row with no recognized fields" }]
  });

  assert.equal(result.transactionCount, 0);
  assert.equal(result.diagnostics.coverage.input_rows_count, 1);
  assert.equal(result.diagnostics.coverage.ledger_rows_count, 0);
  assert.equal(result.diagnostics.coverage.hard_fail, true);
});

test("handler returns failed import response when Privat24 input has rows but zero ledger rows", async () => {
  const response = createMockResponse();
  await privatBankTransactionsHandler(
    {
      method: "POST",
      body: {
        action: "parseStatement",
        statementRows: [{ unexpected: "operation-like row with no recognized fields" }]
      }
    },
    response
  );

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.diagnostics.coverage.hard_fail, true);
});

function createMockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
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
