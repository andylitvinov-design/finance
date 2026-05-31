const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "monthly-plan-expense-balance.js"), "utf8");

function loadApi(extra = {}) {
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
    ...extra,
  };
  context.globalThis = context;
  vm.createContext(context);
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
