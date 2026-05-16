const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const monthlyPlanJs = fs.readFileSync(path.join(root, "monthly-plan.js"), "utf8");

function createContext(overrides = {}) {
  const context = {
    console,
    globalThis: null,
    state: {
      activeTab: "movement",
      config: {
        tabs: [{ id: "movement", label: "Движение средства" }],
        manualFinance: { planSheetName: "План", spreadsheetUrl: "https://example.test/sheet" }
      },
      monthlyPlan: null,
      data: { tabs: {} },
      expenseAccounting: { activeSubtab: "analysis" },
      manualTransfers: { data: { transferRows: [] } },
      manualFinance: { data: { transferRows: [] } },
      aggregatedManualRange: null
    },
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-31" },
      tabs: { innerHTML: "", appendChild() {}, querySelector() { return null; } },
      tabPanels: { innerHTML: "", appendChild() {} }
    },
    document: {
      createElement(tagName) {
        return {
          tagName,
          children: [],
          style: {},
          dataset: {},
          className: "",
          textContent: "",
          innerHTML: "",
          disabled: false,
          value: "",
          appendChild(child) { this.children.push(child); return child; },
          append(...children) { this.children.push(...children); },
          addEventListener() {},
          querySelector() { return null; }
        };
      }
    },
    renderTabs() {},
    refreshGoogleControlsVisibility() {},
    escapeHtml(value) { return String(value ?? ""); },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber(value) {
      return String(Math.round((Number(value) || 0) * 100) / 100).replace(/\.0+$/, "");
    },
    parseDisplayDateToIso(value) {
      const raw = String(value || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      return "";
    },
    getExpenseAnalysisChannelSummary() {
      return {
        period: { startDate: "2026-05-01", endDate: "2026-05-31" },
        incomeTotals: { ordersPlanUsd: 10, servicePlanUsd: 20, plannedUsd: 30 },
        expenseTotals: { plannedUsd: 40 },
        rows: [["channel", "plan"]]
      };
    },
    ...overrides
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(monthlyPlanJs, context);
  return context;
}

test("monthly plan parser accepts monthly KPI headers and percentages", () => {
  const context = createContext();
  const rows = context.parseMonthlyPlanSheetValues([
    ["month", "orders_income_plan_usd", "services_income_plan_usd", "business_expense_plan_usd", "flat_pct", "food_pct", "fun_pct", "travel_pct", "study_pct", "extra_pct"],
    ["2026-05", "1000", "2000", "500", "30", "25", "15", "10", "10", "10"]
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0])), {
    month: "2026-05",
    ordersIncomePlanUsd: "1000",
    servicesIncomePlanUsd: "2000",
    businessExpensePlanUsd: "500",
    flatPct: "30",
    foodPct: "25",
    funPct: "15",
    travelPct: "10",
    studyPct: "10",
    extraPct: "10",
    comment: ""
  });
});

test("monthly plan period overlay replaces plan KPI totals without changing real totals", () => {
  const context = createContext();
  context.state.monthlyPlan.data.rows = [{
    month: "2026-05",
    ordersIncomePlanUsd: "1000",
    servicesIncomePlanUsd: "2000",
    businessExpensePlanUsd: "500",
    flatPct: "30",
    foodPct: "25",
    funPct: "15",
    travelPct: "10",
    studyPct: "10",
    extraPct: "10",
    comment: ""
  }];

  const summary = context.applyMonthlyPlanToExpenseAnalysisSummary({
    period: { startDate: "2026-05-01", endDate: "2026-05-31" },
    incomeTotals: { ordersPlanUsd: 10, servicePlanUsd: 20, plannedUsd: 30, realUsd: 777 },
    expenseTotals: { plannedUsd: 40, realUsd: 333 },
    rows: [["channel", "plan"]]
  });

  assert.equal(summary.incomeTotals.ordersPlanUsd, 1000);
  assert.equal(summary.incomeTotals.servicePlanUsd, 2000);
  assert.equal(summary.incomeTotals.plannedUsd, 3000);
  assert.equal(summary.incomeTotals.realUsd, 777);
  assert.equal(summary.expenseTotals.plannedUsd, 500);
  assert.equal(summary.expenseTotals.realUsd, 333);
  assert.ok(summary.rows.some((row) => row.includes("доход от заказов")));
  assert.ok(summary.rows.some((row) => row.includes("дом/квартира")));
});

test("missing monthly plan returns structured warning instead of crashing", () => {
  const context = createContext();
  context.state.monthlyPlan.data.rows = [];
  const summary = context.applyMonthlyPlanToExpenseAnalysisSummary({
    period: { startDate: "2026-05-01", endDate: "2026-05-31" },
    incomeTotals: { ordersPlanUsd: 10, servicePlanUsd: 20, plannedUsd: 30, realUsd: 777 },
    expenseTotals: { plannedUsd: 40, realUsd: 333 },
    rows: [["channel", "plan"]]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary.planWarnings)), ["План за 2026-05 не заполнен"]);
  assert.equal(summary.incomeTotals.plannedUsd, 30);
  assert.equal(summary.expenseTotals.realUsd, 333);
  assert.ok(summary.rows.some((row) => String(row[1]).includes("План за 2026-05 не заполнен")));
});
