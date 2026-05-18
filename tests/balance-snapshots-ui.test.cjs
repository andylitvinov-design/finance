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

function createContext(options = {}) {
  const context = {
    window: {
      location: { search: options.debug ? "?debugBalanceSnapshots=1" : "" },
      localStorage: {
        getItem() {
          return "";
        },
      },
    },
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

test("balance snapshots UI does not expose inventory in normal Analytics mode", async () => {
  const context = createContext();
  const analyticsContainer = context.document.createElement("div");
  context.fetch = async () => ({
    json: async () => ({ ok: true, balance_snapshots: { dates: [], input_rows: [], rows: [], by_channel_currency: [] } }),
  });

  assert.equal(context.window.EzohataBalanceSnapshotsUi.install(), false);
  vm.runInContext("window.EzohataBalanceSnapshotsUi.install()", context);
  context.renderAnalyticsSections(analyticsContainer, []);
  await flushPromises();

  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "balance-snapshots-section").length, 0);
  assert.doesNotMatch(analyticsContainer.textContent, /Инвентарь остатков/);
});

test("balance snapshots UI appends inventory only in debug mode", async () => {
  const context = createContext({ debug: true });
  const analyticsContainer = context.document.createElement("div");
  const expenseBlock = context.document.createElement("div");
  context.fetch = async () => ({
    json: async () => ({ ok: true, balance_snapshots: { dates: [], input_rows: [], rows: [], by_channel_currency: [] } }),
  });
  context.renderExpenseFinancialAnalysis = () => expenseBlock;
  const originalExpenseRenderer = context.renderExpenseFinancialAnalysis;

  assert.equal(context.renderAnalyticsSections.__balanceSnapshotsWrapped, true);
  assert.equal(context.window.EzohataBalanceSnapshotsUi.install(), false);
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
  const context = createContext({ debug: true });
  const analyticsContainer = context.document.createElement("div");
  context.fetch = async () => {
    throw new Error("snapshots unavailable");
  };

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
      native_valid_rows: 1,
      usd_only_rows: 1,
      incomplete_rows: 0,
      by_channel_currency: [{ channel: "wise usd", currency: "USD", rows: 1, dates: ["2026-05-15"], first_date: "2026-05-15", last_date: "2026-05-15" }],
      input_rows: [
        { date: "2026-05-15", channel: "wise usd", currency: "USD", existing_amount: 1300, needs_input: false },
        { date: "2026-05-15", channel: "paypal eur", currency: "EUR", existing_amount: null, needs_input: true },
      ],
      rows: [
        { date: "2026-05-15", channel: "wise usd", currency: "USD", amount: 1300, amount_native: 1300, amount_usd: 1300, value_type: "native_and_usd", valid_native_balance: true },
        { date: "2026-05-15", channel: "paypal eur", currency: "EUR", amount_native: null, amount_usd: 100, value_type: "usd_only_needs_native", valid_native_balance: false, needs_native_currency_value: true },
      ],
    },
  });

  const firstTable = section.querySelectorAll("table")[0];
  const balanceRows = textRows(section.querySelectorAll("table")[1]);
  const rows = textRows(firstTable);
  assert.match(section.textContent, /Остатки для сверки нужно вносить во вкладку Остатки, не во Факт/);
  assert.match(section.textContent, /Native valid1/);
  assert.match(section.textContent, /USD-only1/);
  assert.deepEqual(rows[0], ["Date", "Sheet", "Channel", "Currency", "Balance", "Status"]);
  assert.deepEqual(rows[1], ["2026-05-15", "Остатки", "wise usd", "USD", "1300", "already entered"]);
  assert.deepEqual(rows[2], ["2026-05-15", "Остатки", "paypal eur", "EUR", "—", "needs input"]);
  assert.deepEqual(balanceRows[0], ["Дата", "Канал", "Валюта", "Native fact", "USD equivalent", "Value type", "Status"]);
  assert.deepEqual(balanceRows[1], ["2026-05-15", "wise usd", "USD", "1300", "1300", "native + USD", "ok"]);
  assert.deepEqual(balanceRows[2], ["2026-05-15", "paypal eur", "EUR", "—", "100", "USD-only", "needs native amount"]);
});

test("balance snapshots UI labels selected, auto, and confirmed balances distinctly", () => {
  const context = createContext();
  const section = context.window.EzohataBalanceSnapshotsUi.renderInventory({
    balance_snapshots: {
      dates: ["2026-04-01"],
      valid_rows: 1,
      incomplete_rows: 0,
      by_channel_currency: [{ channel: "wise usd", currency: "USD", rows: 1, dates: ["2026-04-01"], first_date: "2026-04-01", last_date: "2026-04-01" }],
      input_rows: [],
      selected_rows: [
        { date: "2026-04-01", channel: "wise usd", currency: "USD", amount: 120, selected_from: "confirmed", source_sheet: "Остатки", status: "confirmed" },
        { date: "2026-04-01", channel: "paypal eur", currency: "EUR", amount: 55, selected_from: "auto", source_sheet: "Авто Остатки", status: "derived_from_confirmed_balance" },
      ],
      auto_balance_rows: [
        { date: "2026-04-01", channel: "wise usd", currency: "USD", amount: 119, source_sheet: "Авто Остатки", status: "derived_from_confirmed_balance" },
      ],
      confirmed_rows: [
        { date: "2026-04-01", channel: "wise usd", currency: "USD", amount: 120, source_sheet: "Остатки", status: "confirmed" },
      ],
    },
  });

  const tables = section.querySelectorAll("table");
  const selectedRows = textRows(tables[0]);
  const visibleConfirmedRows = textRows(tables[1]);
  const autoRows = textRows(tables[2]);

  assert.equal(findByClass(section, "balance-snapshots-diagnostics").length, 1);
  assert.match(section.textContent, /Все строки Остатки \/ подтверждённые остатки/);
  assert.match(section.textContent, /Raw auto rows are diagnostic only/);
  assert.deepEqual(selectedRows[0], ["Дата", "Канал", "Валюта", "Выбранный остаток", "Выбран из", "Статус"]);
  assert.deepEqual(selectedRows[1], ["2026-04-01", "wise usd", "USD", "120", "confirmed", "confirmed"]);
  assert.deepEqual(visibleConfirmedRows[0], ["Дата", "Канал", "Валюта", "Подтвержденный остаток", "Источник", "Статус"]);
  assert.deepEqual(visibleConfirmedRows[1], ["2026-04-01", "wise usd", "USD", "120", "Остатки", "confirmed"]);
  assert.deepEqual(autoRows[0], ["Дата", "Канал", "Валюта", "Автоостаток", "Источник", "Статус"]);
});

test("balance snapshots UI uses selected rows for the main balance table and keeps stale raw auto rows diagnostic-only", () => {
  const context = createContext();
  const section = context.window.EzohataBalanceSnapshotsUi.renderInventory({
    balance_snapshots: {
      dates: ["2026-05-28", "2026-05-31"],
      valid_rows: 4,
      incomplete_rows: 0,
      by_channel_currency: [],
      input_rows: [],
      selected_rows: [
        { date: "2026-05-28", channel: "binance save", currency: "USD", amount: 7432, selected_from: "confirmed", source_sheet: "Остатки", status: "confirmed" },
        { date: "2026-05-28", channel: "Бинанс spot", currency: "USD", amount: 1162, selected_from: "confirmed", source_sheet: "Остатки", status: "confirmed" },
        { date: "2026-05-28", channel: "БАНК КАНАДА cad", currency: "CAD", amount: 10538, selected_from: "confirmed", source_sheet: "Остатки", status: "confirmed" },
        { date: "2026-05-28", channel: "монобанк грн", currency: "UAH", amount: 1333, selected_from: "confirmed", source_sheet: "Остатки", status: "confirmed" },
      ],
      auto_balance_rows: [
        { date: "2026-05-31", channel: "binance save", currency: "USD", amount: 7425, source_sheet: "Авто Остатки", status: "derived_from_confirmed_balance" },
        { date: "2026-05-31", channel: "Бинанс spot", currency: "USD", amount: 1689, source_sheet: "Авто Остатки", status: "derived_from_confirmed_balance" },
        { date: "2026-05-31", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: 345, source_sheet: "Авто Остатки", status: "derived_from_confirmed_balance" },
        { date: "2026-05-31", channel: "БАНК КАНАДА cad CAD", currency: "CAD", amount: 7351, source_sheet: "Авто Остатки", status: "derived_from_confirmed_balance" },
      ],
      confirmed_rows: [
        { date: "2026-05-28", channel: "binance save", currency: "USD", amount: 7432, source_sheet: "Остатки", status: "confirmed" },
        { date: "2026-05-28", channel: "Бинанс spot", currency: "USD", amount: 1162, source_sheet: "Остатки", status: "confirmed" },
      ],
    },
  });

  const tables = section.querySelectorAll("table");
  const mainRowsText = JSON.stringify(textRows(tables[0]));
  const confirmedRowsText = JSON.stringify(textRows(tables[1]));
  const diagnosticsText = findByClass(section, "balance-snapshots-diagnostics")[0].textContent;

  assert.match(mainRowsText, /7432/);
  assert.match(mainRowsText, /1162/);
  assert.match(mainRowsText, /10538/);
  assert.match(mainRowsText, /1333/);
  assert.doesNotMatch(mainRowsText, /7425/);
  assert.doesNotMatch(mainRowsText, /1689/);
  assert.doesNotMatch(mainRowsText, /legacy_combined_binance_spot_funding/);
  assert.doesNotMatch(mainRowsText, /7351/);
  assert.match(confirmedRowsText, /7432/);
  assert.match(confirmedRowsText, /1162/);
  assert.match(diagnosticsText, /7425/);
  assert.match(diagnosticsText, /1689/);
  assert.match(diagnosticsText, /legacy_combined_binance_spot_funding/);
  assert.match(diagnosticsText, /7351/);
});
