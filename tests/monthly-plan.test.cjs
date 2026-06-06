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
          listeners: {},
          style: {},
          dataset: {},
          className: "",
          textContent: "",
          innerHTML: "",
          disabled: false,
          type: "",
          placeholder: "",
          value: "",
          appendChild(child) { this.children.push(child); return child; },
          append(...children) { this.children.push(...children); },
          addEventListener(type, handler) { this.listeners[type] = handler; },
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

function flattenNodes(node) {
  return [node, ...(node.children || []).flatMap(flattenNodes)];
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

test("monthly plan tab renders each month as vertical fields instead of one wide header row", () => {
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
    comment: "base"
  }];

  const block = context.renderMonthlyPlanBlock();
  const nodes = flattenNodes(block);
  const headerCells = nodes.filter((node) => node.tagName === "th");
  const tableRows = nodes.filter((node) => node.tagName === "tr");
  const cards = nodes.filter((node) => node.className === "monthly-plan-card");
  const labels = nodes.filter((node) => node.className === "monthly-plan-field").map((node) => node.children[0]?.textContent);

  assert.equal(headerCells.length, 0);
  assert.equal(tableRows.length, 0);
  assert.equal(cards.length, 1);
  assert.deepEqual(labels, [
    "Месяц",
    "Доход от заказов",
    "Доход от услуг",
    "Расходы на бизнес",
    "Квартира %",
    "Еда %",
    "Развлечения %",
    "Путешествия %",
    "Учеба %",
    "Прочее %",
    "Комментарий"
  ]);
});

test("editing vertical monthly plan inputs marks dirty and save keeps the wide sheet format", async () => {
  let savedBody = null;
  let savedPath = "";
  const context = createContext({
    ensureSheetExists: async () => {},
    clearManualServerCache() {},
    getManualFinanceSpreadsheetId() { return "sheet-123"; },
    googleSheetsFetch: async (pathValue, options) => {
      savedPath = pathValue;
      savedBody = JSON.parse(options.body);
      return { ok: true };
    }
  });
  context.state.monthlyPlan.data = {
    sheetName: "План",
    rows: [context.parseMonthlyPlanSheetValues([
      ["month", "orders_income_plan_usd", "services_income_plan_usd", "business_expense_plan_usd", "flat_pct", "food_pct", "fun_pct", "travel_pct", "study_pct", "extra_pct", "comment"],
      ["2026-05", "1000", "2000", "500", "30", "25", "15", "10", "10", "10", "base"]
    ])[0]]
  };

  const block = context.renderMonthlyPlanBlock();
  const serviceInput = flattenNodes(block).find((node) => node.dataset?.field === "servicesIncomePlanUsd");
  serviceInput.listeners.input({ target: { value: "2500" } });

  assert.equal(context.state.monthlyPlan.data.rows[0].servicesIncomePlanUsd, "2500");
  assert.equal(context.state.monthlyPlan.dirty, true);

  await context.saveMonthlyPlanSheet();

  assert.match(savedPath, /A1%3AK2/);
  assert.deepEqual(savedBody.values[0], [
    "month",
    "orders_income_plan_usd",
    "services_income_plan_usd",
    "business_expense_plan_usd",
    "flat_pct",
    "food_pct",
    "fun_pct",
    "travel_pct",
    "study_pct",
    "extra_pct",
    "comment"
  ]);
  assert.deepEqual(savedBody.values[1], ["2026-05", "1000", "2500", "500", "30", "25", "15", "10", "10", "10", "base"]);
  assert.equal(context.state.monthlyPlan.dirty, false);
});

test("monthly plan period builder reads saved wide-format values for totals and percentages", () => {
  const context = createContext();
  const rows = context.parseMonthlyPlanSheetValues([
    ["month", "orders_income_plan_usd", "services_income_plan_usd", "business_expense_plan_usd", "flat_pct", "food_pct", "fun_pct", "travel_pct", "study_pct", "extra_pct", "comment"],
    ["2026-05", "1000", "2000", "500", "30", "25", "15", "10", "10", "10", "base"]
  ]);

  const plan = context.buildMonthlyPlanForPeriod("2026-05-01", "2026-05-31", rows);

  assert.equal(plan.ordersIncomePlanUsd, 1000);
  assert.equal(plan.servicesIncomePlanUsd, 2000);
  assert.equal(plan.businessExpensePlanUsd, 500);
  assert.equal(plan.personalPct.flat, 30);
  assert.equal(plan.personalPct.food, 25);
  assert.equal(plan.personalPctTotal, 100);
  assert.equal(plan.hasAnyPlan, true);
});

test("quota error during monthly plan load preserves existing rows and mounts expense balance", async () => {
  let mountCalls = 0;
  const existingRows = [{
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
    comment: "existing"
  }];
  const context = createContext({
    hasConfiguredManualFinanceEndpoint() { return true; },
    ensureSheetExists: async () => {},
    getSheetValuesByTitle: async () => {
      throw new Error("Google Sheets quota exceeded. Retry shortly.");
    },
    MonthlyPlanExpenseBalance: {
      mountMonthlyPlanExpenseBalance() {
        mountCalls += 1;
        return true;
      }
    }
  });
  context.state.monthlyPlan.data = { rows: existingRows.slice(), sheetName: "План" };

  const result = await context.loadMonthlyPlanSheetForCurrentRange();

  assert.equal(result, null);
  assert.equal(context.state.monthlyPlan.error, true);
  assert.equal(context.state.monthlyPlan.status, "Google Sheets quota exceeded. Retry shortly.");
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.monthlyPlan.data.rows)), existingRows);
  assert.equal(mountCalls > 0, true);
});
