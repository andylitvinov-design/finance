const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ui = require("../balance-coverage-ui.js");
const script = fs.readFileSync(path.join(__dirname, "..", "balance-coverage-ui.js"), "utf8");

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.eventListeners = {};
    this._textContent = "";
    this._innerHTML = "";
    this.type = "";
    this.disabled = false;
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

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener;
  }
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

function findByClass(root, className) {
  const expected = String(className).split(/\s+/).filter(Boolean);
  const matches = [];
  const visit = (node) => {
    const classes = String(node.className || "").split(/\s+/).filter(Boolean);
    if (expected.every((item) => classes.includes(item))) matches.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return matches;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("balance coverage UI wraps renderAnalyticsSections instead of expense financial analysis", () => {
  assert.match(script, /renderAnalyticsSections/);
  assert.doesNotMatch(script, /renderExpenseFinancialAnalysis/);
});

test("balance coverage UI wraps Analytics, not expense financial analysis", () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const expenseBlock = doc.createElement("div");
  const root = {
    document: doc,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, balance_coverage: { summary: {}, accounts: [], actionable_accounts: [] } }) }),
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

  assert.equal(ui.installBalanceCoverageUi(root), true);

  root.renderAnalyticsSections(analyticsContainer, []);
  const renderedExpense = root.renderExpenseFinancialAnalysis();

  assert.equal(root.renderExpenseFinancialAnalysis, originalExpenseRenderer);
  assert.equal(renderedExpense, expenseBlock);
  assert.equal(findByClass(expenseBlock, "balance-coverage-section").length, 0);
  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "balance-coverage-section").length, 1);
});

test("balance coverage API failure renders non-blocking Analytics error", async () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const root = {
    document: doc,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: "audit unavailable" }) }),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
  };

  ui.installBalanceCoverageUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);
  await flushPromises();

  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "finance-status error").length, 1);
  assert.match(analyticsContainer.textContent, /Сверка остатков пока недоступна: audit unavailable/);
});

test("balance coverage UI maps statuses to user-facing labels and actions", () => {
  assert.equal(ui.getStatusLabel("ok"), "OK");
  assert.equal(ui.getStatusLabel("mismatch"), "Расхождение");
  assert.equal(ui.getStatusLabel("missing_opening_balance"), "Нет начального остатка");
  assert.equal(ui.getStatusLabel("missing_provider_balance"), "Нет фактического остатка");
  assert.equal(ui.getStatusAction("mismatch"), "Проверить выписку / Ledger / amount_net / Остатки");
  assert.equal(ui.getStatusAction("missing_opening_balance"), "Добавить остаток на начало периода");
  assert.equal(ui.getStatusAction("missing_provider_balance"), "Добавить фактический остаток в Остатки");
});

test("balance coverage UI builds table with actionable rows first", () => {
  const rows = ui.buildBalanceCoverageTableValues({
    balance_coverage: {
      accounts: [
        {
          date: "2026-05-02",
          channel: "wise usd",
          currency: "USD",
          opening_balance: 1000,
          inflow: 206,
          outflow: 0,
          computed_closing_balance: 1206,
          provider_reported_balance: 1206,
          difference: 0,
          status: "ok",
        },
        {
          date: "2026-05-03",
          channel: "wise usd",
          currency: "USD",
          opening_balance: 1206,
          inflow: 0,
          outflow: 5,
          computed_closing_balance: 1201,
          provider_reported_balance: 1199,
          difference: -2,
          status: "mismatch",
          diagnosis: "Расхождение: provider_reported_balance отличается от computed_closing_balance на -2.",
          fix_action: "Проверить Ledger movement, amount_net и строку Остатки.",
          formula: "opening_balance 1206 + inflow 0 - outflow 5 = computed_closing_balance 1201 ; provider_reported_balance 1199 ; difference -2",
          fix_priority: 1,
        },
      ],
      actionable_accounts: [
        {
          date: "2026-05-03",
          channel: "wise usd",
          currency: "USD",
          opening_balance: 1206,
          inflow: 0,
          outflow: 5,
          computed_closing_balance: 1201,
          provider_reported_balance: 1199,
          difference: -2,
          status: "mismatch",
          diagnosis: "Расхождение: provider_reported_balance отличается от computed_closing_balance на -2.",
          fix_action: "Проверить Ledger movement, amount_net и строку Остатки.",
          formula: "opening_balance 1206 + inflow 0 - outflow 5 = computed_closing_balance 1201 ; provider_reported_balance 1199 ; difference -2",
          fix_priority: 1,
        },
      ],
    },
  });

  assert.equal(rows[0][0], "Дата");
  assert.equal(rows[1][9], "Расхождение");
  assert.match(rows[1][10], /Расхождение/);
  assert.equal(rows[1][11], "Проверить Ledger movement, amount_net и строку Остатки.");
  assert.match(rows[1][12], /computed_closing_balance 1201/);
  assert.equal(rows[1][13], "1");
  assert.equal(rows[2][9], "OK");
});

test("balance coverage UI renders missing opening/provider balances as text, not blanks", () => {
  const rows = ui.buildBalanceCoverageTableValues({
    balance_coverage: {
      accounts: [
        {
          date: "2026-05-11",
          channel: "монобанк грн",
          currency: "UAH",
          opening_balance: null,
          inflow: 100,
          outflow: 0,
          computed_closing_balance: null,
          provider_reported_balance: 120,
          difference: null,
          status: "missing_opening_balance",
        },
        {
          date: "2026-05-11",
          channel: "пейпал дол",
          currency: "USD",
          opening_balance: 10,
          inflow: 0,
          outflow: 5,
          computed_closing_balance: 5,
          provider_reported_balance: null,
          difference: null,
          status: "missing_provider_balance",
        },
      ],
      actionable_accounts: [],
    },
  });

  assert.equal(rows[1][3], "—");
  assert.equal(rows[1][9], "Нет начального остатка");
  assert.equal(rows[1][11], "Добавить остаток на начало периода");
  assert.equal(rows[2][7], "—");
  assert.equal(rows[2][9], "Нет фактического остатка");
  assert.equal(rows[2][11], "Добавить фактический остаток в Остатки");
});

test("balance coverage UI keeps same channel with multiple currencies separate", () => {
  const rows = ui.buildBalanceCoverageTableValues({
    balance_coverage: {
      accounts: [
        { date: "2026-05-02", channel: "wise", currency: "USD", net_change: 100, status: "ok" },
        { date: "2026-05-02", channel: "wise", currency: "EUR", net_change: 50, status: "ok" },
      ],
      actionable_accounts: [],
    },
  });

  assert.deepEqual(
    rows.slice(1).map((row) => ({ channel: row[1], currency: row[2], netChange: row[6] })),
    [
      { channel: "wise", currency: "USD", netChange: "—" },
      { channel: "wise", currency: "EUR", netChange: "—" },
    ]
  );
  assert.equal(rows.length, 3);
});

test("balance coverage UI renders actionable fixes and copy button", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [
        {
          date: "2026-05-06",
          channel: "монобанк грн",
          currency: "UAH",
          amount: 253,
          raw_source_id: "EXu_R1-KOv6NC6HsBw",
          recommended_amount_net: 253,
          action: "Set amount_net to 253",
        },
      ],
      missing_opening_balance_rows: [
        {
          required_date: "2026-04-29",
          movement_date: "2026-04-30",
          channel: "wise usd",
          currency: "USD",
          amount: null,
          action: "Add a factual opening balance row to Остатки before the movement date; amount must come from provider/manual statement.",
        },
      ],
      missing_ostatki_rows: [
        {
          date: "2026-04-30",
          channel: "монобанк грн",
          currency: "UAH",
          expected_closing_hint: 17363,
          action: "Confirm provider closing balance, then add factual balance to Остатки; do not copy expected_closing_hint as fact.",
        },
      ],
      copyable_ostatki_rows: "",
    },
  });

  assert.match(block.textContent, /Что нужно исправить/);
  assert.doesNotMatch(block.textContent, /Скопировать строки для Остатки/);
  assert.match(block.textContent, /EXu_R1-KOv6NC6HsBw/);
  assert.match(block.textContent, /Missing opening Остатки rows/);
  assert.match(block.textContent, /2026-04-29/);
  assert.match(block.textContent, /17363/);
});

test("balance coverage UI renders weekly not-ok summary with exact action rows", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      weekly_summary: {
        period: { from: "2026-05-11", to: "2026-05-17" },
        status: "failed",
        accounts_checked: 5,
        fully_reconciled: 0,
        mismatch: 1,
        missing_opening_balance: 0,
        missing_provider_balance: 4,
        needs_verification: 0,
        missing_amount_net_rows: 1,
        excluded_missing_amount_net_rows: 1,
        actionable_accounts: [
          {
            date: "2026-05-12",
            channel: "трансервайз дол",
            currency: "USD",
            difference: -138.59,
            status: "mismatch",
            diagnosis: "Расхождение: provider_reported_balance отличается от computed_closing_balance на -138.59.",
            fix_action: "Проверить Ledger movement, amount_net и строку Остатки.",
            formula: "opening_balance 2217.41 + inflow 0 - outflow 52.79 = computed_closing_balance 2164.62 ; provider_reported_balance 2026.03 ; difference -138.59",
          },
          {
            date: "2026-05-11",
            channel: "монобанк грн",
            currency: "UAH",
            computed_closing_balance: 14033,
            status: "missing_provider_balance",
            diagnosis: "Нет фактического остатка: не найдена строка Остатки за 2026-05-11.",
            fix_action: "Добавить фактический остаток закрытия в Остатки за дату движения.",
            formula: "opening_balance 4928 + inflow 9105 - outflow 0 = computed_closing_balance 14033 ; provider_reported_balance missing ; difference missing",
          },
        ],
      },
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_ostatki_rows: [],
      copyable_ostatki_rows: "",
    },
  });

  assert.match(block.textContent, /Сверка остатков за неделю/);
  assert.match(block.textContent, /НЕ ОК/);
  assert.match(block.textContent, /2026-05-12/);
  assert.match(block.textContent, /трансервайз дол/);
  assert.match(block.textContent, /-138\.59/);
  assert.match(block.textContent, /Расхождение: provider_reported_balance/);
  assert.match(block.textContent, /Проверить Ledger movement, amount_net/);
  assert.match(block.textContent, /provider_reported_balance missing/);
});

test("balance coverage UI renders weekly ok summary only when blocking counters are zero", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      weekly_summary: {
        period: { from: "2026-05-11", to: "2026-05-17" },
        status: "ok",
        accounts_checked: 2,
        fully_reconciled: 2,
        mismatch: 0,
        missing_opening_balance: 0,
        missing_provider_balance: 0,
        needs_verification: 0,
        missing_amount_net_rows: 0,
        excluded_missing_amount_net_rows: 0,
        actionable_accounts: [],
      },
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_ostatki_rows: [],
      copyable_ostatki_rows: "",
    },
  });

  assert.match(block.textContent, /Сверка остатков за неделю/);
  assert.match(block.textContent, /OK/);
  assert.match(block.textContent, /Все счета за неделю сверены/);
});

test("balance coverage UI shows empty success message when there are no required fixes", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_ostatki_rows: [],
      copyable_ostatki_rows: "",
    },
  });

  assert.match(block.textContent, /Нет обязательных исправлений для сверки остатков\./);
});
