"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("expense ledger channel filter options are built from period expense rows", () => {
  const context = createExpenseLedgerFeedContext();

  assert.deepEqual([...context.window.__expenseLedgerFeed.getExpenseLedgerChannelOptions(context.rows)], [
    "пейпал дол",
    "трансервайз дол"
  ]);
});

test("expense ledger channel filter limits visible rows and recalculates day totals", () => {
  const context = createExpenseLedgerFeedContext();

  let block = context.renderExpenseAccountingBlock();
  assert.match(collectText(block), /Ledger expense rows: 2; visible: 2/);
  assert.match(collectText(block), /2026-05-13 · 52\.44 USD/);

  const channelSelect = findElement(block, (node) => node.dataset?.expenseLedgerChannelFilter === "true");
  channelSelect.listeners.change({ target: { value: "пейпал дол" } });

  block = context.renderExpenseAccountingBlock();
  const text = collectText(block);
  assert.match(text, /Ledger expense rows: 2; visible: 1/);
  assert.match(text, /2026-05-13 · 42\.44 USD/);
  assert.doesNotMatch(text, /10\.00 USD/);
  assert.equal(context.state.expenseAccounting.expenseLedgerChannelFilter, "пейпал дол");
});

test("expense ledger category save after channel filtering updates the correct row", async () => {
  const context = createExpenseLedgerFeedContext();
  let block = context.renderExpenseAccountingBlock();

  findElement(block, (node) => node.dataset?.expenseLedgerChannelFilter === "true")
    .listeners.change({ target: { value: "пейпал дол" } });
  block = context.renderExpenseAccountingBlock();

  const categorySelect = findElement(block, (node) => node.className === "expense-select" && !node.dataset?.expenseLedgerChannelFilter);
  categorySelect.listeners.change({ target: { value: "travel" } });
  block = context.renderExpenseAccountingBlock();

  const saveButton = findElement(block, (node) => node.tagName === "BUTTON" && /Сохранить категории/.test(node.textContent));
  assert.equal(saveButton.disabled, false);
  await saveButton.listeners.click();

  assert.deepEqual(context.savedRows.map((row) => ({ sheetRowNumber: row.sheetRowNumber, category: row.category })), [
    { sheetRowNumber: 101, category: "travel" }
  ]);
});

function createExpenseLedgerFeedContext() {
  const rows = [
    {
      sheetRowNumber: 101,
      date: "2026-05-13",
      operation: "expense",
      fromChannel: "пейпал дол",
      amountNet: -42.44,
      amount: -42.44,
      amountGross: -42.44,
      amountUsd: -42.44,
      currency: "USD",
      category: "business",
      comment: "paypal debit",
      source: "paypal",
      rawSourceId: "7S399229WP363332P"
    },
    {
      sheetRowNumber: 202,
      date: "2026-05-13",
      operation: "expense",
      fromChannel: "трансервайз дол",
      amountNet: -10,
      amount: -10,
      amountGross: -10,
      amountUsd: -10,
      currency: "USD",
      category: "food",
      comment: "wise debit",
      source: "wise",
      rawSourceId: "WISE-1"
    }
  ];
  const savedRows = [];
  const context = {
    window: {},
    document: createDocumentStub(),
    state: {
      expenseAccounting: {
        activeSubtab: "expenses",
        expenseCategoryDrafts: {},
        expenseLedgerChannelFilter: "all",
        loading: false,
        status: ""
      }
    },
    elements: {
      startDate: { value: "2026-05-13" },
      endDate: { value: "2026-05-13" }
    },
    rows,
    savedRows,
    MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES: ["business", "food", "travel"],
    getExpenseOperationsRows() {
      return rows;
    },
    filterExpenseOperationsRows(inputRows) {
      return inputRows;
    },
    parseLooseNumber(value) {
      const parsed = Number(String(value ?? "0").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    escapeHtml(value) {
      return String(value ?? "");
    },
    buildManualFinancePeriodLabel(start, end) {
      return `${start}..${end}`;
    },
    formatSheetNumber(value) {
      return Number(value).toFixed(2);
    },
    canEditExpenseOperationRow() {
      return true;
    },
    async updateManualLedgerRowDirect(payload) {
      savedRows.push(payload);
    },
    async loadDashboardData() {},
    setExpenseAccountingStatus() {},
    renderExpenseAccountingWarnings() {
      return null;
    },
    renderExpenseAccountingBlock() {
      return createElementStub("div");
    },
    renderTabs() {},
  };
  context.setExpenseAccountingStatus = (message) => {
    context.state.expenseAccounting.status = message;
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../expense-ledger-feed.js"), "utf8"), context);
  return context;
}

function createDocumentStub() {
  return {
    createElement(tagName) {
      return createElementStub(tagName);
    }
  };
}

function createElementStub(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    className: "",
    type: "",
    textContent: "",
    disabled: false,
    dataset: {},
    listeners: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...items) {
      this.children.push(...items);
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    querySelector() {
      return null;
    },
    set innerHTML(value) {
      this._innerHTML = String(value || "");
      this.children = [];
    },
    get innerHTML() {
      return this._innerHTML || "";
    }
  };
  return node;
}

function findElement(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function collectText(node) {
  return [
    node.textContent || "",
    node.innerHTML || "",
    ...(node.children || []).map(collectText)
  ].join(" ");
}
