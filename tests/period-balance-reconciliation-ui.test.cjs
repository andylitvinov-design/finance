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
  assert.match(analyticsContainer.textContent, /Полная сумма остатков на начало периода/);
  assert.match(analyticsContainer.textContent, /Изменение баланса по валютам/);
});

test("period balance top summary renders required total labels", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const text = block.textContent;

  [
    "Полная сумма остатков на начало периода",
    "Полная сумма остатков на конец периода",
    "Плановая сумма приходов",
    "Плановая сумма расходов",
    "Плановый рост",
    "Фактический рост",
  ].forEach((label) => assert.match(text, new RegExp(escapeRegExp(label))));
});

test("period balance top summary keeps multi-currency totals separated", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const summary = findByClass(block, "period-balance-total-summary")[0];
  const table = findTag(summary, "TABLE")[0];
  const rows = getTableTextRows(table);

  assert.deepEqual(rows[0], ["Показатель", "EUR", "USD"]);
  assert.deepEqual(rows[1], ["Полная сумма остатков на начало периода", "200", "1000"]);
  assert.deepEqual(rows[2], ["Полная сумма остатков на конец периода", "240", "1125"]);
  assert.equal(rows[3][0], "Плановая сумма приходов");
  assert.equal(rows[3][1], "50");
  assert.equal(rows[3][2], "200");
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

function buildSnapshot() {
  return {
    ok: true,
    period_balance_reconciliation: {
      period: { from: "2026-05-11", to: "2026-05-15" },
      summary: {
        status: "ok",
        positions_checked: 2,
        currencies_checked: 2,
        channels_checked: 2,
        planned_rows: 2,
        planned_source_status: "ok",
        missing_amount_net_rows: 0,
        status_counts: { carried_forward_conditional: 0 },
      },
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
      by_channel_currency: [
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
      ],
      actionable_rows: [],
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
