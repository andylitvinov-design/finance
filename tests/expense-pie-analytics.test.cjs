const assert = require("node:assert/strict");
const test = require("node:test");

global.state = {
  expenseAccounting: { activeSubtab: "list", resultTab: "spent", expensePieMode: "direction" },
  aggregatedManualRange: { transferRows: [] },
  manualTransfers: { data: { transferRows: [] } },
  manualFinance: { data: { transferRows: [] } },
  data: { tabs: { movement: { values: [] } } }
};
global.elements = {
  startDate: { value: "2026-05-10" },
  endDate: { value: "2026-05-16" }
};
global.MANUAL_FINANCE_TOTAL_LABEL = "Итого";
global.MANUAL_EXPENSE_ACCOUNTING_CATEGORIES = ["business", "flat", "food", "fun", "travel", "study", "exchange"];
global.buildManualFinanceUsdRateLookup = () => ({ byCurrency: { USD: 1, RUB: 0.01 }, byChannel: {} });
global.getManualFinanceFieldUsdNumber = (row, key, rateLookup) => {
  const amount = Number(row[key] || 0);
  if (!amount) return 0;
  const channel = String(row.channel || "");
  const rate = /руб/i.test(channel) ? rateLookup.byCurrency.RUB : 1;
  return amount * rate;
};
global.formatSheetNumber = (value) => String(Math.round((Number(value) || 0) * 10000) / 10000);
global.parseLooseNumber = (value) => {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const analytics = require("../expense-pie-analytics.js");

function createTestElement(tagName) {
  return {
    tagName,
    children: [],
    className: "",
    textContent: "",
    style: { setProperty(key, value) { this[key] = value; } },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    append(...items) {
      items.forEach((item) => this.appendChild(item));
    },
    prepend(child) {
      child.parentNode = this;
      this.children.unshift(child);
      return child;
    },
    insertBefore(child, nextChild) {
      child.parentNode = this;
      const index = this.children.indexOf(nextChild);
      if (index === -1) this.children.push(child);
      else this.children.splice(index, 0, child);
      return child;
    },
    setAttribute() {},
    addEventListener() {},
    querySelector(selector) {
      const className = selector.startsWith(".") ? selector.slice(1) : selector;
      const stack = [...this.children];
      while (stack.length) {
        const node = stack.shift();
        const classes = String(node.className || "").split(/\s+/);
        if (classes.includes(className)) return node;
        stack.push(...(node.children || []));
      }
      return null;
    }
  };
}

test("builds direction segments from manual rows using USD conversion helpers", () => {
  const result = analytics.buildExpensePieSegments({
    mode: "direction",
    manualRows: [
      { channel: "PayPal USD", business: 100, flat: 20, food: 0, fun: 0, travel: 0, study: 0, exchange: 5 },
      { channel: "Яндекс руб", business: 1000, flat: 0, food: 500, fun: 0, travel: 0, study: 0, exchange: 0 },
      { channel: "Итого", business: 9999, flat: 9999 }
    ],
    usdRateLookup: global.buildManualFinanceUsdRateLookup()
  });

  assert.equal(result.mode, "direction");
  assert.equal(result.total, 140);
  assert.deepEqual(
    result.segments.map((segment) => [segment.label, segment.value]),
    [["business", 110], ["flat", 20], ["food", 5], ["exchange", 5]]
  );
});

test("builds channel segments and supports house/travel aliases", () => {
  const result = analytics.buildExpensePieSegments({
    mode: "channel",
    manualRows: [
      { channel: "Mono USD", business: 10, house: 15, food: 0, fun: 0, travelFun: 25, study: 0, exchange: 0 },
      { channel: "Wise USD", business: 5, flat: 5, food: 5, fun: 0, travel: 0, study: 0, exchange: 0 }
    ],
    usdRateLookup: global.buildManualFinanceUsdRateLookup()
  });

  assert.equal(result.mode, "channel");
  assert.equal(result.total, 65);
  assert.deepEqual(
    result.segments.map((segment) => [segment.label, segment.value]),
    [["Mono USD", 50], ["Wise USD", 15]]
  );
});

test("direction and channel totals use the same positive expense contributions", () => {
  const rows = [
    { channel: "монобанк грн", business: 1104.4334, flat: -258.9931, food: 0, fun: 0, travel: 0, study: 0, exchange: 0 },
    { channel: "Итого", business: 9999, flat: 9999 }
  ];

  const byDirection = analytics.buildExpensePieSegments({
    mode: "direction",
    manualRows: rows,
    usdRateLookup: global.buildManualFinanceUsdRateLookup()
  });
  const byChannel = analytics.buildExpensePieSegments({
    mode: "channel",
    manualRows: rows,
    usdRateLookup: global.buildManualFinanceUsdRateLookup()
  });

  assert.equal(Number(byDirection.total.toFixed(4)), 1104.4334);
  assert.equal(Number(byChannel.total.toFixed(4)), 1104.4334);
  assert.deepEqual(
    byDirection.segments.map((segment) => [segment.label, segment.value]),
    [["business", 1104.4334]]
  );
  assert.deepEqual(
    byChannel.segments.map((segment) => [segment.label, segment.value]),
    [["монобанк грн", 1104.4334]]
  );
});

test("expense pie contribution rows drop non-positive category cells before grouping", () => {
  const contributions = analytics.getExpensePieContributionRows([
    { channel: "PayPal", business: 100, flat: -40, food: 0, fun: 0, travel: 0, study: 0, exchange: 0 },
    { channel: "Wise", business: 25, flat: 0, food: 0, fun: 0, travel: 0, study: 0, exchange: 0 }
  ], global.buildManualFinanceUsdRateLookup());

  assert.deepEqual(contributions, [
    { channel: "PayPal", category: "business", amount: 100 },
    { channel: "Wise", category: "business", amount: 25 }
  ]);
});

test("builds plan dashboard with fixed monthly targets and weekly prorated plans", () => {
  const groups = analytics.buildExpensePlanDashboardGroups({
    endDate: "2026-05-16",
    actuals: {
      realIncomeWeekUsd: 3100,
      realExpenseWeekUsd: 600,
      realProfitWeekUsd: 2500
    }
  });
  const income = groups.find((group) => group.id === "income");
  const expense = groups.find((group) => group.id === "expense");
  const profit = groups.find((group) => group.id === "profit");

  assert.equal(income.rows.find((row) => row.kind === "plan-month").value, 10000);
  assert.equal(expense.rows.find((row) => row.kind === "plan-month").value, 2000);
  assert.equal(profit.rows.find((row) => row.kind === "plan-month").value, 2500);
  assert.equal(
    Number(expense.rows.find((row) => row.kind === "plan-week").value.toFixed(4)),
    Number(((2000 * 7) / 31).toFixed(4))
  );
  assert.equal(
    Number(profit.rows.find((row) => row.kind === "plan-week").value.toFixed(4)),
    Number(((2500 * 7) / 31).toFixed(4))
  );
});

test("plan dashboard real profit uses real weekly income minus real weekly expense", () => {
  global.getExpenseAnalysisChannelSummary = () => ({
    incomeTotals: { realUsd: 1800 },
    expenseTotals: { realTotalUsd: 450 }
  });

  const groups = analytics.buildExpensePlanDashboardGroups({ endDate: "2026-05-16" });
  const profit = groups.find((group) => group.id === "profit");
  assert.equal(profit.rows.find((row) => row.kind === "actual-week").value, 1350);
});

test("analysis renderer gets the new plan dashboard instead of the old expense pie", () => {
  global.document = { createElement: createTestElement };
  global.getExpenseAnalysisChannelSummary = () => ({
    incomeTotals: { realUsd: 2000 },
    expenseTotals: { realTotalUsd: 700 }
  });
  global.renderExpenseFinancialAnalysis = () => {
    const block = createTestElement("div");
    const cards = createTestElement("div");
    cards.className = "expense-summary-grid";
    block.appendChild(cards);
    return block;
  };

  assert.equal(analytics.installExpensePlanDashboardIntoAnalysis(), true);
  const block = global.renderExpenseFinancialAnalysis();
  assert.deepEqual(
    block.children.map((child) => child.className),
    ["expense-summary-grid", "analytics-section expense-plan-section"]
  );
});

test("expense pie is inserted into the expense list spent view", () => {
  global.document = { createElement: createTestElement };
  global.getCurrentAnalyticsManualRows = () => [
    { channel: "PayPal USD", business: 25, flat: 0, food: 0, fun: 0, travel: 0, study: 0, exchange: 0 }
  ];
  global.state.expenseAccounting.activeSubtab = "list";
  global.state.expenseAccounting.resultTab = "spent";
  global.renderExpenseAccountingBlock = () => {
    const block = createTestElement("div");
    const tabs = createTestElement("div");
    tabs.className = "expense-result-tabs";
    const feed = createTestElement("div");
    feed.className = "expense-feed";
    block.appendChild(tabs);
    block.appendChild(feed);
    return block;
  };

  assert.equal(analytics.installExpensePieIntoExpenseList(), true);
  const block = global.renderExpenseAccountingBlock();
  assert.deepEqual(
    block.children.map((child) => child.className),
    ["expense-result-tabs", "analytics-section expense-pie-section", "expense-feed"]
  );
});
