const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const binanceOneClickJs = fs.readFileSync(path.join(repoRoot, "binance-one-click.js"), "utf8");

function createElement(tag) {
  return {
    tag,
    children: [],
    dataset: {},
    textContent: "",
    disabled: false,
    className: "",
    listeners: {},
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    querySelector(selector) {
      if (selector === ".expense-actions") return findNode(this, (node) => node.className === "expense-actions");
      if (selector === '[data-provider="binance"]') {
        return findNode(this, (node) => node.dataset?.provider === "binance");
      }
      return null;
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
  };
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function createContext(fetchImpl) {
  const context = {
    console,
    document: { createElement },
    fetch: fetchImpl
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`
    const state = {
      expenseAccounting: {
        entries: [{ source: "binance", sourceTransactionId: "old" }, { source: "paypal", sourceTransactionId: "keep" }],
        activeSubtab: "list",
        warnings: []
      }
    };
    const elements = {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-03" }
    };
    function renderTabs() { globalThis.renderCount = (globalThis.renderCount || 0) + 1; }
    function setExpenseAccountingStatus(message, isError) {
      state.expenseAccounting.status = message;
      state.expenseAccounting.error = Boolean(isError);
    }
    function normalizeIncomingSheetDateValue(value) { return String(value || "").trim(); }
    function normalizeExpenseAccountingEntry(entry) { return { ...entry, source: entry.source || "binance" }; }
    function hasProviderSummaryData(summary) { return Boolean(summary && Object.keys(summary).length); }
    function buildProviderExpenseSummary(entries) { return { rows: entries.length }; }
    function getExpenseAccountingDirectionCounts() { return { spent: 1, received: 0 }; }
    function renderExpenseAccountingBlock() {
      const shell = document.createElement("div");
      const actions = document.createElement("div");
      actions.className = "expense-actions";
      shell.appendChild(actions);
      return shell;
    }
  `, context);
  vm.runInContext(binanceOneClickJs, context);
  return context;
}

test("Binance one-click helper injects button when app state is lexical", () => {
  const context = createContext(async () => ({ ok: true, text: async () => "{\"ok\":true,\"entries\":[]}" }));

  const shell = context.renderExpenseAccountingBlock();
  const button = shell.querySelector('[data-provider="binance"]');

  assert.ok(button);
  assert.equal(button.textContent, "Подтянуть Binance");
});

test("Binance one-click posts selected dates and merges Binance entries into expense accounting state", async () => {
  const requests = [];
  const context = createContext(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        transactionCount: 1,
        warnings: ["sample warning"],
        summary: { rows: 1 },
        entries: [{ source: "binance", sourceTransactionId: "new", amount: 12 }]
      })
    };
  });

  const shell = context.renderExpenseAccountingBlock();
  const button = shell.querySelector('[data-provider="binance"]');
  await button.listeners.click();
  const appState = JSON.parse(vm.runInContext("JSON.stringify(state.expenseAccounting)", context));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "./api/binance-transactions");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    startDate: "2026-05-01",
    endDate: "2026-05-03"
  });
  assert.deepEqual(appState.entries.map((entry) => entry.sourceTransactionId), ["keep", "new"]);
  assert.equal(appState.entries[1].source, "binance");
  assert.deepEqual(appState.warnings, ["sample warning"]);
  assert.equal(appState.resultTab, "spent");
  assert.equal(appState.binanceLoading, false);
});
