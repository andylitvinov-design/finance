const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");
const topMetricPayableShareFixJs = fs.readFileSync(path.join(root, "top-metric-payable-share-fix.js"), "utf8");
const personalOrdersPayableBadgeJs = fs.readFileSync(path.join(root, "personal-orders-payable-badge.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(source, name) {
  const pattern = new RegExp(`^function ${name}\\(`, "m");
  const match = pattern.exec(source);
  if (!match) throw new Error(`${name} was not found`);
  const next = source.slice(match.index + 1).search(/^function [A-Za-z0-9_]+\(/m);
  return next === -1
    ? source.slice(match.index).trim()
    : source.slice(match.index, match.index + 1 + next).trim();
}

function makeNode(text = "") {
  return { textContent: text };
}

function runPayablePatch(buildTopMetricsSummary) {
  const context = { buildTopMetricsSummary };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(topMetricPayableShareFixJs, context);
  return context.buildTopMetricsSummary();
}

function renderMetricsWithSummary(summary, options = {}) {
  const elements = {
    metricPeriod: makeNode(),
    metricOrders: makeNode(),
    metricBalances: makeNode(),
    metricTransfers: makeNode(),
    metricMyServices: makeNode(),
    metricProfit: makeNode(),
    metricMyCosts: makeNode(),
    metricPersonalOrdersAfterDiscount: makeNode(),
  };
  const context = {
    elements,
    buildTopMetricsSummary: () => ({ ...summary }),
    state: options.state || { data: { tabs: {} } },
    getMovementTotalsFromTable: options.getMovementTotalsFromTable,
    parseLooseNumber: (value) => {
      const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber: (value, precision = 4) => Number(value).toFixed(precision).replace(".", ","),
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(topMetricPayableShareFixJs, context);
  vm.runInContext(
    `${extractFunction(uiJs, "getTopMetricMovementBalance")}\n${extractFunction(uiJs, "renderMetrics")}\nthis.renderMetrics = renderMetrics;`,
    context
  );
  vm.runInContext(personalOrdersPayableBadgeJs, context);
  context.renderMetrics();
  return { context, elements };
}

test("summary metrics render directly in the top card flow", () => {
  assert.match(indexHtml, /<div class="metric-label">Оплатить<\/div>/);
  assert.match(indexHtml, /id="metricPersonalOrdersAfterDiscount"/);
  assert.doesNotMatch(indexHtml, /<script[^>]+src=["']\.\/summary-metrics-fix\.js["'][^>]*>/);
  assert.match(indexHtml, /<script[^>]+src=["']\.\/top-metric-payable-share-fix\.js["'][^>]*>/);
  assert.match(indexHtml, /<script[^>]+src=["']\.\/personal-orders-payable-badge\.js["'][^>]*>/);

  const { elements } = renderMetricsWithSummary({
    totalOrders: 360.5,
    balance: 5.7118,
    totalPaid: 354.7882,
    total: -200.8499,
    myServices: 200,
    myCosts: 150,
    profit: 50,
  });

  assert.equal(elements.metricOrders.textContent, "5,7118");
  assert.equal(elements.metricTransfers.textContent, "5,7118");
  assert.equal(elements.metricMyCosts.textContent, "Мои затраты: 150,0000");
  assert.equal(elements.metricProfit.textContent, "Прибыль: 50,0000");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 0,0000");
});

test("top balance uses movement table total without changing payable or paid metrics", () => {
  const { elements } = renderMetricsWithSummary(
    {
      totalOrders: 1400.3,
      totalAccrued: 2047.8,
      balance: -630.1078,
      movementBalance: 212.9422,
      ordersBalanceTotal: -843.05,
      legacyCombinedBalance: -630.1078,
      totalPaid: 965.7039,
      total: 1082.0961,
      personalOrdersAfterDiscount: 647.5,
      myServices: 204.7059,
      myCosts: 0,
      profit: 0,
    },
    {
      state: {
        data: {
          tabs: {
            movement: {
              values: [
                ["NUMBER", "BALANCE"],
                [1, "100,0000"],
                [2, "112,9422"],
                ["Итого", "212,9422"],
              ],
            },
          },
        },
      },
      getMovementTotalsFromTable: () => ({ balanceTotal: 212.9422 }),
    }
  );

  assert.equal(elements.metricOrders.textContent, "212,9422");
  assert.notEqual(elements.metricOrders.textContent, "-630,1078");
  assert.notEqual(elements.metricOrders.textContent, "630,1078");
  assert.equal(elements.metricTransfers.textContent, "1082,0961");
  assert.equal(elements.metricBalances.textContent, "965,7039");
});

test("top metrics personal orders badge uses exact payable formula component", () => {
  const { elements } = renderMetricsWithSummary({
    totalOrders: 1407.05,
    totalAccrued: 1407.05,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 32.5,
    balance: 0,
    total: 0,
    myServices: 0,
    myCosts: 0,
    profit: 0,
  });

  assert.equal(elements.metricTransfers.textContent, "441,3461");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 32,5000");
});

test("top metric card uses the same canonical orders payment total as balance popup", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 2047.8,
    ordersAccruedWithPercent: 1400.3,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
    total: 0,
  }));

  assert.equal(Number(summary.ordersPaymentSummary.ordersAccruedWithPercent.toFixed(4)), 1400.3);
  assert.equal(Number(summary.ordersPaymentSummary.myOrdersDiscounted.toFixed(4)), 647.5);
  assert.equal(Number(summary.ordersPaymentSummary.totalAccrued.toFixed(4)), 2047.8);
  assert.equal(Number(summary.payable.toFixed(4)), 1082.0961);
  assert.equal(summary.total, summary.payable);
});

test("top metric percent rate stays a rate instead of percent amount", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 2047.8,
    ordersAccruedWithPercent: 1400.3,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
    percentRate: 3,
    percentAmount: 63.2632,
    total: 0,
  }));

  assert.equal(summary.ordersPaymentSummary.percentRate, 3);
  assert.notEqual(summary.ordersPaymentSummary.percentRate, 63.2632);
});

test("discounted personal orders are not halved again in payable", () => {
  const summary = runPayablePatch(() => ({
    ordersAccruedWithPercent: 1400.3,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
    total: 0,
  }));

  assert.equal(Number(summary.ordersPaymentSummary.myOrdersDiscounted.toFixed(4)), 647.5);
  assert.equal(Number(summary.payable.toFixed(4)), 1082.0961);
});

test("top metrics personal orders badge falls back to ordersSummary value", () => {
  const { elements } = renderMetricsWithSummary({
    totalOrders: 100,
    totalAccrued: 100,
    totalPaid: 20,
    ordersSummary: { personalOrdersAfterDiscount: 12.3456 },
    balance: 0,
    total: 0,
    myServices: 0,
    myCosts: 0,
    profit: 0,
  });

  assert.equal(elements.metricTransfers.textContent, "80,0000");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 12,3456");
});

test("top metrics personal orders badge shows zero when field is missing", () => {
  const { elements } = renderMetricsWithSummary({
    totalOrders: 100,
    totalPaid: 20,
    balance: 0,
    total: 0,
    myServices: 0,
    myCosts: 0,
    profit: 0,
  });

  assert.equal(elements.metricTransfers.textContent, "80,0000");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 0,0000");
});

test("payable helper calculates accrued total minus paid", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 1499.55,
    totalAccrued: 1704.2559,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 204.7059,
    total: -515.8389
  }));

  assert.equal(Number(summary.payable.toFixed(4)), 738.5520);
  assert.equal(summary.total, summary.payable);
  assert.equal(summary.payableFormula, "totalAccrued - abs(totalPaid)");
  assert.doesNotMatch(summary.payableFormula, /0\.3/);
});

test("payable helper uses the displayed paid amount when internal paid total is negative", () => {
  const summary = runPayablePatch(() => ({ totalOrders: 1499.55, totalAccrued: 1704.2559, totalPaid: -965.7039, personalOrdersAfterDiscount: 204.7059, total: -515.8389 }));

  assert.equal(Number(summary.payable.toFixed(4)), 738.5520);
  assert.equal(summary.total, summary.payable);
});

test("payable helper uses full accrued total when there are no personal orders", () => {
  const summary = runPayablePatch(() => ({ totalOrders: 1000, totalPaid: 100, total: -999 }));

  assert.equal(summary.payable, 900);
  assert.equal(summary.total, summary.payable);
});

test("payable helper adds discounted personal order total, not gross order cost", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 100,
    totalPaid: 0,
    personalOrdersAfterDiscount: 50,
    grossPersonalOrders: 100,
    total: -999
  }));

  assert.equal(summary.payable, 150);
  assert.equal(summary.total, summary.payable);
});
