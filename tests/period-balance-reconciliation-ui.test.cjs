const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../period-balance-reconciliation-ui.js");

test("period balance reconciliation UI wraps Analytics, not expense financial analysis", () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const expenseBlock = doc.createElement("div");
  const root = {
    document: doc,
    fetch: createOkFetch(),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
    renderExpenseFinancialAnalysis() {
      return expenseBlock;
    },
  };
  const originalExpenseRenderer = root.renderExpenseFinancialAnalysis;

  assert.equal(ui.installPeriodBalanceReconciliationUi(root), true);

  root.renderAnalyticsSections(analyticsContainer, []);
  const renderedExpense = root.renderExpenseFinancialAnalysis();

  assert.equal(root.renderExpenseFinancialAnalysis, originalExpenseRenderer);
  assert.equal(renderedExpense, expenseBlock);
  assert.equal(findByClass(expenseBlock, "period-balance-reconciliation-section").length, 0);
  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "period-balance-reconciliation-section").length, 1);
  assert.equal(analyticsContainer.children[0].className, "finance-analysis-section period-balance-reconciliation-section");
});

test("period balance reconciliation block replaces Analytics placeholder with API result", async () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const root = {
    document: doc,
    fetch: createOkFetch(),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
  };

  ui.installPeriodBalanceReconciliationUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);
  await flushPromises();

  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "period-balance-reconciliation-section").length, 1);
  assert.match(analyticsContainer.textContent, /ИТОГО: НЕ ОК/);
  assert.match(analyticsContainer.textContent, /OK позиций/);
  assert.doesNotMatch(analyticsContainer.textContent, /Изменение баланса по валютам/);
  assert.match(analyticsContainer.textContent, /Остатки по каналам оплаты/);
});

test("period balance reconciliation prepends Analytics container with DOM children collection", () => {
  const doc = createTestDocument();
  const analyticsContainer = createHtmlCollectionLikeContainer();
  const root = {
    document: doc,
    fetch: () => new Promise(() => {}),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      const coverage = doc.createElement("section");
      coverage.className = "finance-analysis-section balance-coverage-section";
      coverage.textContent = "Сверка остатков по счетам";
      container.appendChild(normal);
      container.appendChild(coverage);
    },
  };

  ui.installPeriodBalanceReconciliationUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);

  assert.deepEqual(
    analyticsContainer.childList.map((node) => node.className),
    [
      "finance-analysis-section period-balance-reconciliation-section",
      "normal-analytics-section",
      "finance-analysis-section balance-coverage-section",
    ]
  );
});

test("period balance verdict renders required total labels", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const text = block.textContent;

  [
    "ИТОГО: НЕ ОК",
    "Проверено позиций",
    "OK позиций",
    "Расхождения",
    "Нет начального",
    "Нет конечного",
    "Нет amount_net",
  ].forEach((label) => assert.match(text, new RegExp(escapeRegExp(label))));
});

test("period balance top summary keeps multi-currency totals separated", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const summary = findByClass(block, "period-balance-total-summary")[0];
  const table = findTag(summary, "TABLE")[0];
  const rows = getTableTextRows(table);

  assert.deepEqual(rows[0], ["Показатель", "EUR", "UAH", "USD"]);
  assert.deepEqual(rows[1], ["Полная сумма остатков на начало периода", "200", "100", "1000"]);
  assert.deepEqual(rows[2], ["Полная сумма остатков на конец периода", "240", "70", "1125"]);
  assert.equal(rows[3][0], "Плановая сумма приходов");
  assert.equal(rows[3][1], "50");
  assert.equal(rows[3][3], "200");
});

test("period balance renders all position rows before currency summary tables", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const subsections = findByClass(block, "period-balance-subsection");
  const titles = subsections.map((section) => section.children[0].textContent);

  assert.deepEqual(titles, [
    "По счетам и валютам",
    "Где исправить",
    "Остатки по каналам оплаты",
  ]);

  const positionRows = getTableTextRows(findTag(subsections[0], "TABLE")[0]);
  assert.equal(positionRows.length, 4);
  assert.deepEqual(positionRows[0], ["Счёт", "Валюта", "Было", "Реал Δ", "Реал должно", "Факт", "Разница", "Статус", "Что сделать"]);
  assert.equal(positionRows[1][0], "wise usd");
  assert.equal(positionRows[1][7], "OK");
  assert.equal(positionRows[2][0], "paypal eur");
  assert.equal(positionRows[3][0], "mono uah");
  assert.equal(positionRows[3][7], "Реальное расхождение");
});

test("period balance channel balances group by channel, currency, warnings, and totals", () => {
  const result = ui.buildPaymentChannelBalanceRows([
    { channel: "PayPal", currency: "USD", factual_closing_balance: 100, status: "ok" },
    { channel: "Wise / TransferWise", currency: "EUR", factual_closing_balance: 200, status: "ok" },
    { channel: "Binance", currency: "USDT", computed_real_closing_balance: 50, status: "missing_opening_balance", fix_action: "Добавить стартовый остаток" },
    { channel: "PayPal", currency: "EUR", computed_real_closing_balance: 0, missing_amount_net_rows: 1, status: "missing_amount_net" },
  ]);

  assert.deepEqual(result.currencies, ["EUR", "USD", "USDT"]);
  const paypal = result.rows.find((row) => row.channel === "PayPal");
  const wise = result.rows.find((row) => row.channel === "Wise / TransferWise");
  const binance = result.rows.find((row) => row.channel === "Binance");
  const total = result.rows.at(-1);

  assert.equal(paypal.balances.USD, 100);
  assert.equal(paypal.balances.EUR, 0);
  assert.match(paypal.statusWarnings, /Нет amount_net/);
  assert.equal(wise.balances.EUR, 200);
  assert.equal(binance.balances.USDT, 50);
  assert.match(binance.statusWarnings, /Добавить стартовый остаток/);
  assert.equal(total.channel, "ИТОГО");
  assert.equal(total.balances.EUR, 200);
  assert.equal(total.balances.USD, 100);
  assert.equal(total.balances.USDT, 50);
  assert.equal(total.totalUsd, 382);
});

test("period balance actionable rows still render under fix section only", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const fixSection = findByClass(block, "period-balance-subsection").find((section) => section.children[0].textContent === "Где исправить");
  const rows = getTableTextRows(findTag(fixSection, "TABLE")[0]);

  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], "mono uah");
  assert.equal(rows[1][6], "Проверить Ledger movements");
});

test("period balance UI shows missing provider balance as blocked, not OK", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    summary: {
      status: "blocked",
      positions_checked: 1,
      currencies_checked: 1,
      channels_checked: 1,
      planned_rows: 0,
      planned_source_status: "available_empty",
      missing_amount_net_rows: 0,
      blocked: 1,
      status_counts: { ok: 0, mismatch: 0, missing_provider_balance: 1 },
    },
    by_channel_currency: [
      {
        channel: "wise usd",
        currency: "USD",
        opening_balance: 1000,
        real_delta: 100,
        computed_real_closing_balance: 1100,
        factual_closing_balance: null,
        real_difference: null,
        closing_balance_source: "missing",
        status: "missing_provider_balance",
        fix_action: "Добавить фактический остаток на дату окончания периода по этому счету/валюте.",
      },
    ],
    actionable_rows: [
      {
        channel: "wise usd",
        currency: "USD",
        status: "missing_provider_balance",
        real_difference: null,
        plan_vs_real_delta: 100,
        diagnosis: "Нет фактического остатка на дату; сверка заблокирована.",
        fix_action: "Добавить фактический остаток на дату окончания периода по этому счету/валюте.",
      },
    ],
  }));
  const text = block.textContent;

  assert.match(text, /Нет факта на дату/);
  assert.match(text, /Нет фактического остатка на дату/);
  assert.match(text, /Добавить фактический остаток на дату окончания периода/);
  const positionRows = getTableTextRows(findByClass(block, "period-balance-subsection")[0].children[1].children[0]);
  assert.equal(positionRows[1][7], "Нет фактического остатка на дату");
});

test("period balance API failure renders non-blocking Analytics error", async () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const root = {
    document: doc,
    fetch: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, error: "service unavailable" }),
    }),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
  };

  ui.installPeriodBalanceReconciliationUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);
  await flushPromises();

  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "finance-status error").length, 1);
  assert.match(analyticsContainer.textContent, /Сверка баланса за период пока недоступна: service unavailable/);
});

function createOkFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => buildSnapshot(),
  });
}

function buildSnapshot(overrides = {}) {
  const summary = overrides.summary || {
    status: "failed",
    positions_checked: 3,
    currencies_checked: 2,
    channels_checked: 3,
    planned_rows: 2,
    planned_source_status: "ok",
    missing_amount_net_rows: 1,
    blocked: 0,
    status_counts: {
      ok: 2,
      mismatch: 1,
      missing_provider_balance: 0,
      missing_opening_balance: 0,
      missing_closing_balance: 0,
      missing_amount_net: 1,
      carried_forward_conditional: 0,
    },
  };
  const byChannelCurrency = overrides.by_channel_currency || [
    {
      channel: "wise usd",
      currency: "USD",
      opening_balance: 1000,
      planned_delta: 150,
      planned_closing_balance: 1150,
      real_delta: 125,
      computed_real_closing_balance: 1125,
      factual_closing_balance: 1125,
      real_difference: 0,
      closing_balance_source: "exact",
      status: "ok",
    },
    {
      channel: "paypal eur",
      currency: "EUR",
      opening_balance: 200,
      planned_delta: 40,
      planned_closing_balance: 240,
      real_delta: 40,
      computed_real_closing_balance: 240,
      factual_closing_balance: 240,
      real_difference: 0,
      closing_balance_source: "exact",
      status: "ok",
    },
    {
      channel: "mono uah",
      currency: "UAH",
      opening_balance: 100,
      planned_delta: 0,
      planned_closing_balance: 100,
      real_delta: -25,
      computed_real_closing_balance: 75,
      factual_closing_balance: 70,
      real_difference: -5,
      closing_balance_source: "exact",
      status: "mismatch",
      diagnosis: "Расхождение",
      fix_action: "Проверить Ledger movements",
    },
  ];
  return {
    ok: true,
    period_balance_reconciliation: {
      period: { from: "2026-05-11", to: "2026-05-15" },
      summary,
      by_currency: [
        {
          currency: "USD",
          planned_inflow: 200,
          planned_outflow: 50,
          planned_delta: 150,
          real_inflow: 175,
          real_outflow: 50,
          real_delta: 125,
          plan_vs_real_delta: -25,
          real_difference: 0,
          status: "ok",
        },
        {
          currency: "EUR",
          planned_inflow: 50,
          planned_outflow: 10,
          planned_delta: 40,
          real_inflow: 60,
          real_outflow: 20,
          real_delta: 40,
          plan_vs_real_delta: 0,
          real_difference: 0,
          status: "ok",
        },
      ],
      by_channel_currency: byChannelCurrency,
      actionable_rows: overrides.actionable_rows || [
        {
          channel: "mono uah",
          currency: "UAH",
          real_difference: -5,
          plan_vs_real_delta: -25,
          status: "mismatch",
          diagnosis: "Расхождение",
          fix_action: "Проверить Ledger movements",
        },
      ],
    },
  };
}

function createTestDocument() {
  return {
    createElement(tagName) {
      return new TestElement(tagName);
    },
    getElementById() {
      return null;
    },
  };
}

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this._textContent = "";
    this._innerHTML = "";
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  insertBefore(child, reference) {
    child.parentElement = this;
    const index = this.children.indexOf(reference);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  replaceWith(replacement) {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index === -1) return;
    replacement.parentElement = this.parentElement;
    this.parentElement = null;
    siblings.splice(index, 1, replacement);
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, "");
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function createHtmlCollectionLikeContainer() {
  const container = {
    childList: [],
    get children() {
      return this.childList.reduce((collection, child, index) => {
        collection[index] = child;
        return collection;
      }, { length: this.childList.length });
    },
    appendChild(child) {
      child.parentElement = this;
      this.childList.push(child);
      return child;
    },
    insertBefore(child, reference) {
      child.parentElement = this;
      const index = this.childList.indexOf(reference);
      if (index === -1) {
        this.childList.push(child);
      } else {
        this.childList.splice(index, 0, child);
      }
      return child;
    },
  };
  return container;
}

function findByClass(root, className) {
  const expected = String(className).split(/\s+/).filter(Boolean);
  const result = [];
  visit(root, (node) => {
    const classes = String(node.className || "").split(/\s+/).filter(Boolean);
    if (expected.every((item) => classes.includes(item))) result.push(node);
  });
  return result;
}

function findTag(root, tagName) {
  const expected = String(tagName).toUpperCase();
  const result = [];
  visit(root, (node) => {
    if (node.tagName === expected) result.push(node);
  });
  return result;
}

function visit(node, visitor) {
  if (!node) return;
  visitor(node);
  (node.children || []).forEach((child) => visit(child, visitor));
}

function getTableTextRows(table) {
  return findTag(table, "TR").map((row) => row.children.map((cell) => cell.textContent));
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
