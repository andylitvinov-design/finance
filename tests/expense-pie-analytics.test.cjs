const assert = require("node:assert/strict");
const test = require("node:test");

global.state = {
  expenseAccounting: { expensePieMode: "direction" },
  aggregatedManualRange: { transferRows: [] },
  manualTransfers: { data: { transferRows: [] } },
  manualFinance: { data: { transferRows: [] } },
  data: { tabs: { movement: { values: [] } } }
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
      if (selector !== ".expense-summary-grid") return null;
      return this.children.find((child) => child.className === "expense-summary-grid") || null;
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

test("installs into the active expense financial analysis renderer", () => {
  global.document = { createElement: createTestElement };
  global.getCurrentAnalyticsManualRows = () => [
    { channel: "PayPal USD", business: 25, flat: 0, food: 0, fun: 0, travel: 0, study: 0, exchange: 0 }
  ];
  global.renderExpenseFinancialAnalysis = () => {
    const block = createTestElement("div");
    const cards = createTestElement("div");
    cards.className = "expense-summary-grid";
    block.appendChild(cards);
    return block;
  };

  assert.equal(analytics.installExpensePieAnalytics(), true);
  const block = global.renderExpenseFinancialAnalysis();
  assert.deepEqual(
    block.children.map((child) => child.className),
    ["expense-summary-grid", "analytics-section expense-pie-section"]
  );
});
