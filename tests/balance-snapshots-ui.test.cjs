const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "balance-snapshots-ui.js"), "utf8");

test("balance snapshots inventory UI loads after balance coverage and before main", () => {
  assert.ok(indexHtml.includes("./balance-snapshots-ui.js"));
  assert.ok(indexHtml.indexOf("./balance-coverage-ui.js") < indexHtml.indexOf("./balance-snapshots-ui.js"));
  assert.ok(indexHtml.indexOf("./balance-snapshots-ui.js") < indexHtml.indexOf("./main.js"));
});

test("balance snapshots inventory UI wraps Analytics, not expense financial analysis", () => {
  assert.match(script, /renderAnalyticsSections/);
  assert.doesNotMatch(script, /renderExpenseFinancialAnalysis/);
});

test("balance snapshots inventory UI calls period-scoped endpoint", () => {
  assert.match(script, /\/api\/balance-snapshots/);
  assert.match(script, /q\.set\("from", start\)/);
  assert.match(script, /q\.set\("to", end\)/);
  assert.match(script, /cache: "no-store"/);
});

test("balance snapshots inventory UI renders safe coverage fields only", () => {
  assert.match(script, /Инвентарь остатков/);
  assert.match(script, /by_channel_currency/);
  assert.match(script, /valid_rows/);
  assert.match(script, /incomplete_rows/);
  assert.doesNotMatch(script, /balanceAmount/);
  assert.doesNotMatch(script, /provider_reported_balance/);
});

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this._textContent = "";
    this.children = [];
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
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

  querySelectorAll(tagName) {
    const expected = String(tagName || "").toUpperCase();
    const matches = [];
    const visit = (node) => {
      if (node.tagName === expected) matches.push(node);
      node.children.forEach(visit);
    };
    visit(this);
    return matches;
  }
}

function textRows(table) {
  return table.querySelectorAll("tr").map((row) => row.querySelectorAll("th").concat(row.querySelectorAll("td")).map((cell) => cell.textContent));
}

function createContext() {
  const context = {
    window: {},
    document: {
      scripts: [],
      createElement(tagName) {
        return new FakeNode(tagName);
      },
      getElementById() {
        return { value: "" };
      },
    },
    URLSearchParams,
    fetch() {
      throw new Error("not used");
    },
    renderAnalyticsSections(container) {
      const normal = context.document.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
    renderExpenseFinancialAnalysis: undefined,
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
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

test("balance snapshots UI appends inventory to Analytics and leaves expense analysis unchanged", async () => {
  const context = createContext();
  const analyticsContainer = context.document.createElement("div");
  const expenseBlock = context.document.createElement("div");
  context.fetch = async () => ({
    json: async () => ({ ok: true, balance_snapshots: { dates: [], input_rows: [], rows: [], by_channel_currency: [] } }),
  });
  context.renderExpenseFinancialAnalysis = () => expenseBlock;
  const originalExpenseRenderer = context.renderExpenseFinancialAnalysis;

  assert.equal(context.window.EzohataBalanceSnapshotsUi.install(), false);
  vm.runInContext("window.EzohataBalanceSnapshotsUi.install()", context);
  context.renderAnalyticsSections(analyticsContainer, []);
  const renderedExpense = context.renderExpenseFinancialAnalysis();
  await flushPromises();

  assert.equal(context.renderExpenseFinancialAnalysis, originalExpenseRenderer);
  assert.equal(renderedExpense, expenseBlock);
  assert.equal(findByClass(expenseBlock, "balance-snapshots-section").length, 0);
  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "balance-snapshots-section").length, 1);
});

test("balance snapshots API failure renders non-blocking Analytics error", async () => {
  const context = createContext();
  const analyticsContainer = context.document.createElement("div");
  context.fetch = async () => {
    throw new Error("snapshots unavailable");
  };

  vm.runInContext("window.EzohataBalanceSnapshotsUi.install()", context);
  context.renderAnalyticsSections(analyticsContainer, []);
  await flushPromises();

  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "finance-status error").length, 1);
  assert.match(analyticsContainer.textContent, /Инвентарь остатков недоступен: snapshots unavailable/);
});

test("balance snapshots UI renders input rows first with balance entry headers and statuses", () => {
  const context = createContext();
  const section = context.window.EzohataBalanceSnapshotsUi.renderInventory({
    balance_snapshots: {
      dates: ["2026-05-15"],
      valid_rows: 1,
      incomplete_rows: 0,
      by_channel_currency: [{ channel: "wise usd", currency: "USD", rows: 1, dates: ["2026-05-15"], first_date: "2026-05-15", last_date: "2026-05-15" }],
      input_rows: [
        { date: "2026-05-15", channel: "wise usd", currency: "USD", existing_amount: 1300, needs_input: false },
        { date: "2026-05-15", channel: "paypal eur", currency: "EUR", existing_amount: null, needs_input: true },
      ],
      rows: [{ date: "2026-05-15", channel: "wise usd", currency: "USD", amount: 1300 }],
    },
  });

  const firstTable = section.querySelectorAll("table")[0];
  const rows = textRows(firstTable);
  assert.match(section.textContent, /Остатки для сверки нужно вносить во вкладку Остатки, не во Факт/);
  assert.deepEqual(rows[0], ["Date", "Sheet", "Channel", "Currency", "Balance", "Status"]);
  assert.deepEqual(rows[1], ["2026-05-15", "Остатки", "wise usd", "USD", "1300", "already entered"]);
  assert.deepEqual(rows[2], ["2026-05-15", "Остатки", "paypal eur", "EUR", "—", "needs input"]);
});
