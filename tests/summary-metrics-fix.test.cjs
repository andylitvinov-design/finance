const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const patchJs = fs.readFileSync(path.join(root, "summary-metrics-fix.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function makeNode(text = "") {
  return { textContent: text };
}

function createContext({ rows = [], startDate = "2026-04-29", endDate = "2026-05-05" } = {}) {
  const elements = {
    startDate: { value: startDate },
    endDate: { value: endDate },
    metricPeriod: makeNode("360,5000"),
    metricOrders: makeNode("5,7118"),
    metricBalances: makeNode("354,7882"),
    metricTransfers: makeNode("-200,8499"),
    metricMyServices: makeNode("Мои услуги: 0"),
    metricProfit: makeNode("Прибыль: -1115,6407"),
    metricMyCosts: makeNode("Мои затраты: 1367,9907"),
  };
  const context = {
    window: null,
    globalThis: null,
    elements,
    state: {
      data: {
        manual: {
          ledgerV2Rows: rows,
        },
      },
      manualFinance: {
        data: null,
      },
    },
    renderMetrics() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(patchJs, context);
  return context;
}

test("summary metrics patch is loaded after ui.js and before main.js", () => {
  assert.match(indexHtml, /<div class="metric-label">Оплатить<\/div>/);
  assert.ok(indexHtml.indexOf("./ui.js") < indexHtml.indexOf("./summary-metrics-fix.js"));
  assert.ok(indexHtml.indexOf("./summary-metrics-fix.js") < indexHtml.indexOf("./main.js"));
});

test("underpayment to me is displayed as negative without mutating source rows", () => {
  const context = createContext();
  context.EzohataSummaryMetricsPatch.applySummaryMetricCorrections();

  assert.equal(context.elements.metricOrders.textContent, "-5,7118");
  assert.equal(context.elements.metricTransfers.textContent, "-5,7118");
});

test("summary cost/profit fallback uses selected period only", () => {
  const context = createContext({
    rows: [
      { date: "2026-04-30", operation: "business_expense", amountUsd: "100", source: "td_bank" },
      { date: "2026-05-03", operation: "personal_expense", amount_usd: "50", source: "manual" },
      { date: "2026-04-20", operation: "business_expense", amountUsd: "1367.9907", source: "td_bank" },
      { date: "2026-05-02", operation: "income", amountUsd: "200", source: "manual" },
      { date: "2026-05-02", operation: "income", amountUsd: "500", source: "wise" },
    ],
  });

  const totals = context.EzohataSummaryMetricsPatch.buildSummaryMetricFallbackTotals();
  assert.equal(totals.myCosts, 150);
  assert.equal(totals.myServices, 200);

  context.EzohataSummaryMetricsPatch.applySummaryMetricCorrections();
  assert.equal(context.elements.metricMyCosts.textContent, "Мои затраты: 150");
  assert.equal(context.elements.metricMyServices.textContent, "Мои услуги: 200");
  assert.equal(context.elements.metricProfit.textContent, "Прибыль: 50");
});
