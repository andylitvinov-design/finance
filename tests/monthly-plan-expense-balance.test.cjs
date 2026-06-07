const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "monthly-plan-expense-balance.js"), "utf8");

function loadApi(extra = {}) {
  const { lexicalState, lexicalElements, ...globals } = extra;
  const context = {
    module: { exports: {} },
    exports: {},
    setTimeout() {},
    parseLooseNumber(value) {
      const parsed = Number(String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber(value) {
      return Number(value || 0).toFixed(4).replace(".", ",");
    },
    ...globals,
  };
  context.globalThis = context;
  vm.createContext(context);
  if (lexicalState) {
    context.__monthlyPlanLexicalState = lexicalState;
    vm.runInContext("const state = globalThis.__monthlyPlanLexicalState;", context);
  }
  if (lexicalElements) {
    context.__monthlyPlanLexicalElements = lexicalElements;
    vm.runInContext("const elements = globalThis.__monthlyPlanLexicalElements;", context);
  }
  vm.runInContext(source, context, { filename: "monthly-plan-expense-balance.js" });
  return context.module.exports;
}

test("summarizeExpenseBreakdown groups real expenses by category and channel", () => {
  const api = loadApi();
  const summary = api.summarizeExpenseBreakdown(
    { startDate: "2026-05-01", endDate: "2026-05-31" },
    {
      breakdownByChannel: {
        "трансервайз дол": {
          total: 1776.11,
          byCategory: { business: 1614.56, house: 150.67, food: 10.88 },
        },
        "пейпал дол": {
          total: 473.12,
          byCategory: { business: 473.12 },
        },
      },
    }
  );

  assert.equal(summary.total, 2249.23);
  assert.deepEqual(Array.from(summary.categoryRows, (row) => [row.category, row.amount]), [
    ["business", 2087.68],
    ["house", 150.67],
    ["food", 10.88],
  ]);
  assert.deepEqual(Array.from(summary.channelRows, (row) => [row.channel, row.amount]), [
    ["трансервайз дол", 1776.11],
    ["пейпал дол", 473.12],
  ]);
});

test("summarizeExpenseBreakdown falls back to business totals when byCategory is missing", () => {
  const api = loadApi();
  const summary = api.summarizeExpenseBreakdown(
    { startDate: "2026-05-01", endDate: "2026-05-31" },
    {
      breakdownByChannel: {
        "пейпал евр": { total: 729.408, business: 729.408, personal: 0, byCategory: {} },
      },
    }
  );

  assert.equal(summary.total, 729.408);
  assert.deepEqual(Array.from(summary.categoryRows, (row) => [row.category, row.amount, row.percent]), [
    ["business", 729.408, 100],
  ]);
});

test("getPreviousEqualPeriod returns the same number of days before selected period", () => {
  const api = loadApi();
  const previous = api.getPreviousEqualPeriod({ startDate: "2026-05-10", endDate: "2026-05-20" });

  assert.equal(previous.dayCount, 11);
  assert.equal(previous.startDate, "2026-04-29");
  assert.equal(previous.endDate, "2026-05-09");
});

test("buildComparisonRows calculates current vs previous category deltas", () => {
  const api = loadApi();
  const current = api.summarizeExpenseBreakdown(
    { startDate: "2026-05-01", endDate: "2026-05-31" },
    { breakdownByChannel: { Wise: { total: 300, byCategory: { business: 250, food: 50 } } } }
  );
  const previous = api.summarizeExpenseBreakdown(
    { startDate: "2026-03-31", endDate: "2026-04-30" },
    { breakdownByChannel: { Wise: { total: 200, byCategory: { business: 100, house: 100 } } } }
  );
  const rows = api.buildComparisonRows(current, previous);
  const byCategory = new Map(rows.map((row) => [row.category, row]));

  assert.equal(byCategory.get("business").delta, 150);
  assert.equal(byCategory.get("business").deltaPercent, 150);
  assert.equal(byCategory.get("food").previousAmount, 0);
  assert.equal(byCategory.get("house").amount, 0);
  assert.equal(byCategory.get("house").delta, -100);
});

test("mountMonthlyPlanExpenseBalance is exported on MonthlyPlanExpenseBalance API", () => {
  const api = loadApi();
  assert.equal(typeof api.mountMonthlyPlanExpenseBalance, "function", "mountMonthlyPlanExpenseBalance must be exported for patchMonthlyPlanUi to call");
});

test("renderMonthlyPlanExpenseBalance renders pie, legend, total, and comparison table", () => {
  const created = [];
  function createElement(tagName) {
    const node = {
      tagName,
      id: "",
      className: "",
      textContent: "",
      innerHTML: "",
      children: [],
      style: { setProperty(name, value) { this[name] = value; } },
      attributes: {},
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    created.push(node);
    return node;
  }
  const api = loadApi({
    document: { createElement },
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-31" },
    },
    getExpenseAnalysisProviderExpenseBreakdownByChannel(_rateLookup, period) {
      if (period.startDate === "2026-05-01") {
        return {
          Wise: { total: 300, byCategory: { business: 250, food: 50 } },
          PayPal: { total: 100, byCategory: { house: 100 } },
        };
      }
      return {
        Wise: { total: 200, byCategory: { business: 100, house: 100 } },
      };
    },
  });

  const section = api.renderMonthlyPlanExpenseBalance();
  const all = [section, ...created];

  assert.equal(section.id, "monthly-plan-expense-balance");
  assert.ok(all.some((node) => String(node.className).includes("monthly-plan-expense-balance-chart")));
  assert.ok(all.some((node) => String(node.className).includes("expense-pie-legend")));
  assert.ok(all.some((node) => String(node.className).includes("expense-pie-total")));
  assert.equal(all.filter((node) => String(node.className).includes("monthly-plan-expense-balance-table")).length, 2);
  assert.ok(all.some((node) => String(node.textContent).includes("Сравнение с предыдущим равным периодом")));
});

test("renderMonthlyPlanExpenseBalance reads lexical app state and date elements", () => {
  const created = [];
  function createElement(tagName) {
    const node = {
      tagName,
      id: "",
      className: "",
      textContent: "",
      innerHTML: "",
      children: [],
      style: { setProperty(name, value) { this[name] = value; } },
      attributes: {},
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    created.push(node);
    return node;
  }
  const api = loadApi({
    lexicalState: {
      activeTab: "monthlyPlan",
      data: { tabs: { movement: { values: [] } } },
      aggregatedManualRange: { transferRows: [] },
      manualTransfers: { data: { transferRows: [] } },
      manualFinance: { data: { transferRows: [] } },
    },
    lexicalElements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-31" },
    },
    document: { createElement },
    getExpenseAnalysisProviderExpenseBreakdownByChannel(_rateLookup, period) {
      assert.equal(period.startDate, "2026-05-01");
      assert.equal(period.endDate, "2026-05-31");
      return { Wise: { total: 100, byCategory: { business: 100 } } };
    },
  });

  const section = api.renderMonthlyPlanExpenseBalance();
  const all = [section, ...created];

  assert.equal(section.id, "monthly-plan-expense-balance");
  assert.ok(all.some((node) => String(node.className).includes("monthly-plan-expense-balance-chart")));
  assert.ok(all.some((node) => String(node.textContent).includes("2026-05-01")));
});

test("monthly plan expense balance pie chart and legend render with provider expense breakdown", () => {
  const api = loadApi();
  const summary = api.summarizeExpenseBreakdown(
    { startDate: "2026-05-01", endDate: "2026-05-31" },
    {
      breakdownByChannel: {
        "трансервайз дол": { total: 1200, byCategory: { business: 900, house: 200, food: 100 } },
      },
    }
  );

  assert.equal(summary.total, 1200);
  assert.ok(summary.categoryRows.length >= 3, "should have at least 3 category rows");
  const byCategory = new Map(summary.categoryRows.map((row) => [row.category, row]));
  assert.equal(byCategory.get("business").amount, 900);
  assert.equal(byCategory.get("business").percent, 75);
  assert.equal(byCategory.get("house").amount, 200);
  assert.equal(byCategory.get("food").amount, 100);
  assert.equal(summary.channelRows.length, 1);
  assert.equal(summary.channelRows[0].channel, "трансервайз дол");
});
