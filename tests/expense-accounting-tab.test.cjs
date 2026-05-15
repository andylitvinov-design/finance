"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("sheet-config.json contains expenseAccounting tab", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../sheet-config.json"), "utf8"));
  const tab = (config.tabs || []).find((t) => t.id === "expenseAccounting");
  assert.ok(tab, "expenseAccounting tab must exist in sheet-config.json");
  assert.equal(tab.label, "Учет расходов");
  assert.equal(tab.sheetName, "Расходы");
});

test("sheet-config.json expenseAccounting is between manualFinance and orders", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../sheet-config.json"), "utf8"));
  const ids = (config.tabs || []).map((t) => t.id);
  const factIdx = ids.indexOf("manualFinance");
  const expIdx = ids.indexOf("expenseAccounting");
  const ordIdx = ids.indexOf("orders");
  assert.ok(expIdx !== -1);
  assert.ok(expIdx > factIdx, "must come after fact");
  assert.ok(expIdx < ordIdx, "must come before orders");
});

test("ui.js renderTabs handles expenseAccounting branch", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui.js"), "utf8");
  assert.ok(src.includes('activeTab.id === "expenseAccounting"'));
  assert.ok(src.includes("renderExpenseAccountingBlock()"));
});

test("renderExpenseAccountingBlock creates all three subtabs", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui.js"), "utf8");
  assert.ok(src.includes("список затрат"));
  assert.ok(src.includes("операции"));
  assert.ok(src.includes("анализ финансов"));
});

test("state.js initializes expenseAccounting.activeSubtab", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../state.js"), "utf8");
  assert.ok(src.includes("expenseAccounting"));
  assert.ok(src.includes("activeSubtab"));
});

test("no filter in ui.js excludes expenseAccounting", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui.js"), "utf8");
  const suspects = (src.match(/\.filter\([^)]{0,120}/g) || [])
    .filter((m) => m.includes("expenseAccounting"));
  assert.equal(suspects.length, 0, `Found filter that may hide expenseAccounting: ${suspects.join(", ")}`);
});

test("main.js renders tabs without automatic silent Google OAuth", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8");
  const firstRenderTabs = src.indexOf("renderTabs();");
  const initializeGoogleAuth = src.indexOf("await initializeGoogleAuth();");
  assert.ok(firstRenderTabs !== -1, "init must call renderTabs");
  assert.ok(initializeGoogleAuth !== -1, "init must initialize Google auth");
  assert.equal(src.includes("await trySilentGoogleConnect()"), false, "normal init must not trigger silent Google OAuth");
  assert.ok(firstRenderTabs < initializeGoogleAuth, "tabs must render before Google auth initialization can block");
});

test("renderTabs renders all tab buttons but only one active panel", () => {
  const context = createRenderTabsContext({ activeTab: "movement" });

  context.renderTabs();

  assert.equal(context.elements.tabs.children.length, 7);
  assert.equal(context.elements.tabPanels.children.length, 1);
  assert.equal(context.elements.tabPanels.children[0].className, "tab-panel active");
  assert.deepEqual(context.calls.standard, ["movement"]);
  assert.equal(context.calls.expenseAccounting, 0);
  assert.equal(context.calls.manualFinance, 0);
  assert.equal(context.calls.manualTransfers, 0);
  assert.equal(context.calls.manualOrders, 0);
});

test("renderTabs does not call heavy renderers for inactive tabs", () => {
  const context = createRenderTabsContext({ activeTab: "analytics" });

  context.renderTabs();

  assert.deepEqual(context.calls.standard, ["analytics"]);
  assert.equal(context.calls.expenseAccounting, 0);
  assert.equal(context.calls.manualFinance, 0);
  assert.equal(context.calls.manualTransfers, 0);
  assert.equal(context.calls.manualOrders, 0);
});

test("tab switching renders the selected tab content", async () => {
  const context = createRenderTabsContext({ activeTab: "movement" });

  await context.handleTabClick("expenseAccounting");

  assert.equal(context.state.activeTab, "expenseAccounting");
  assert.equal(context.elements.tabPanels.children.length, 1);
  assert.equal(context.calls.expenseAccounting, 1);
  assert.deepEqual(context.calls.standard, []);
});

test("period recalculation render does not render every tab with large mocked data", () => {
  const context = createRenderTabsContext({ activeTab: "movement", largeRows: 5000 });

  context.renderTabs();

  assert.equal(context.elements.tabPanels.children.length, 1);
  assert.deepEqual(context.calls.standard, ["movement"]);
  assert.equal(context.calls.largeRowsSeen, 5000);
  assert.equal(context.calls.expenseAccounting, 0);
  assert.equal(context.calls.manualFinance, 0);
  assert.equal(context.calls.manualTransfers, 0);
  assert.equal(context.calls.manualOrders, 0);
});

function createRenderTabsContext({ activeTab, largeRows = 0 }) {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui.js"), "utf8");
  const calls = {
    standard: [],
    expenseAccounting: 0,
    manualFinance: 0,
    manualTransfers: 0,
    manualOrders: 0,
    largeRowsSeen: 0,
    refreshGoogleControlsVisibility: 0,
    openManualFinanceToday: 0
  };
  const context = {
    document: createDocumentStub(),
    elements: {
      tabs: createElementStub("div"),
      tabPanels: createElementStub("div")
    },
    state: {
      activeTab,
      config: {
        tabs: [
          { id: "movement", label: "Движение средства" },
          { id: "analytics", label: "Аналитика" },
          { id: "manualFinance", label: "fact" },
          { id: "expenseAccounting", label: "Учет расходов" },
          { id: "orders", label: "Список моих заказы" },
          { id: "savings", label: "Переводы" },
          { id: "payouts", label: "Список выплат" }
        ]
      },
      data: {
        tabs: {
          movement: { rows: Array.from({ length: largeRows }, (_, index) => ({ index })) }
        }
      }
    },
    calls,
    renderStandardTab(tabId) {
      calls.standard.push(tabId);
      calls.largeRowsSeen = largeRows;
      return createElementStub("div");
    },
    renderExpenseAccountingBlock() {
      calls.expenseAccounting += 1;
      return createElementStub("div");
    },
    renderManualFinanceBlock() {
      calls.manualFinance += 1;
      return createElementStub("div");
    },
    renderManualTransfersBlock() {
      calls.manualTransfers += 1;
      return createElementStub("div");
    },
    renderManualOrdersBlock() {
      calls.manualOrders += 1;
      return createElementStub("div");
    },
    refreshGoogleControlsVisibility() {
      calls.refreshGoogleControlsVisibility += 1;
    },
    async openManualFinanceToday() {
      calls.openManualFinanceToday += 1;
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(src, "renderTabs")}\n${extractFunction(src, "handleTabClick")}\nthis.renderTabs = renderTabs;\nthis.handleTabClick = handleTabClick;`,
    context
  );
  return context;
}

function extractFunction(src, name) {
  const start = src.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = src.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < src.length; index += 1) {
    if (src[index] === "{") depth += 1;
    if (src[index] === "}") depth -= 1;
    if (depth === 0) return src.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function createDocumentStub() {
  return {
    createElement(tagName) {
      return createElementStub(tagName);
    }
  };
}

function createElementStub(tagName) {
  let childNodes = [];
  return {
    tagName: String(tagName).toUpperCase(),
    className: "",
    type: "",
    textContent: "",
    listeners: {},
    get children() {
      return childNodes;
    },
    set innerHTML(value) {
      this._innerHTML = value;
      childNodes = [];
    },
    get innerHTML() {
      return this._innerHTML || "";
    },
    appendChild(child) {
      childNodes.push(child);
      return child;
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    }
  };
}
