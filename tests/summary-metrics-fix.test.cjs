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

function runPayablePatch(buildTopMetricsSummary, extras = {}) {
  const context = { buildTopMetricsSummary, ...extras };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(topMetricPayableShareFixJs, context);
  return context.buildTopMetricsSummary();
}

function renderMetricsWithSummary(summary, extras = {}) {
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
    parseLooseNumber: (value) => {
      const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber: (value, precision = 4) => Number(value).toFixed(precision).replace(".", ","),
    ...extras,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(topMetricPayableShareFixJs, context);
  vm.runInContext(
    `${extractFunction(uiJs, "renderMetrics")}\nthis.renderMetrics = renderMetrics;`,
    context
  );
  vm.runInContext(personalOrdersPayableBadgeJs, context);
  context.renderMetrics();
  return { context, elements };
}

function makeMovementState(accruedPlusTotal) {
  return {
    data: {
      tabs: {
        movement: {
          values: [
            ["NUMBER", "SERVICE", "ACCRUED +3%", "70% OF +3%"],
            ["1", "service", String(accruedPlusTotal), String(accruedPlusTotal * 0.7)],
            ["Итого", "", String(accruedPlusTotal), String(accruedPlusTotal * 0.7)],
          ],
          summaryRows: []
        }
      }
    }
  };
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

  assert.equal(elements.metricOrders.textContent, "-5,7118");
  assert.equal(elements.metricTransfers.textContent, "-102,4382");
  assert.equal(elements.metricMyCosts.textContent, "Мои затраты: 150,0000");
  assert.equal(elements.metricProfit.textContent, "Прибыль: 50,0000");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 0,0000");
});

test("top metrics personal orders badge uses exact payable formula component", () => {
  const { elements } = renderMetricsWithSummary({
    totalOrders: 1407.05,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 32.5,
    balance: 0,
    total: 0,
    myServices: 0,
    myCosts: 0,
    profit: 0,
  });

  assert.equal(elements.metricTransfers.textContent, "51,7311");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 32,5000");
});

test("top metrics personal orders badge falls back to ordersSummary value", () => {
  const { elements } = renderMetricsWithSummary({
    totalOrders: 100,
    totalPaid: 20,
    ordersSummary: { personalOrdersAfterDiscount: 12.3456 },
    balance: 0,
    total: 0,
    myServices: 0,
    myCosts: 0,
    profit: 0,
  });

  assert.equal(elements.metricTransfers.textContent, "62,3456");
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

  assert.equal(elements.metricTransfers.textContent, "50,0000");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 0,0000");
});

test("payable helper calculates 70 percent of service orders minus paid plus discounted personal orders", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 1499.55,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 204.7059,
    total: -515.8389
  }));

  assert.equal(Number(summary.payable.toFixed(4)), 288.6870);
  assert.equal(summary.total, summary.payable);
  assert.equal(summary.payableFormula, "serviceOrdersTotal * 0.7 - abs(totalPaid) + personalOrdersAfterDiscount");
  assert.doesNotMatch(summary.payableFormula, /0\.3/);
});

test("payable helper uses movement accrued total for service orders and keeps personal orders separate", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
    total: -999
  }), { state: makeMovementState(1400.3) });

  assert.equal(Number(summary.totalOrders.toFixed(4)), 1400.3);
  assert.equal(Number(summary.grossTotalOrdersIncludingPersonal.toFixed(4)), 2047.8);
  assert.equal(Number(summary.serviceOrdersTotal.toFixed(4)), 1400.3);
  assert.equal(Number(summary.personalOrdersAfterDiscount.toFixed(4)), 647.5);
  assert.equal(Number(summary.payable.toFixed(4)), 661.0061);
});

test("top card renders service orders total while personal orders stay in the separate badge", () => {
  const { elements } = renderMetricsWithSummary({
    totalOrders: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
    balance: -630.1078,
    total: 0,
    myServices: 204.7059,
    myCosts: 3560.9325,
    profit: -2741.8866,
  }, { state: makeMovementState(1400.3) });

  assert.equal(elements.metricPeriod.textContent, "1400,3000");
  assert.equal(elements.metricPersonalOrdersAfterDiscount.textContent, "Мои личные: 647,5000");
  assert.notEqual(elements.metricPeriod.textContent, "2047,8000");
});

test("payable helper uses the displayed paid amount when internal paid total is negative", () => {
  const summary = runPayablePatch(() => ({ totalOrders: 1499.55, totalPaid: -965.7039, personalOrdersAfterDiscount: 204.7059, total: -515.8389 }));

  assert.equal(Number(summary.payable.toFixed(4)), 288.6870);
  assert.equal(summary.total, summary.payable);
});

test("payable helper uses 70 percent of orders when there are no personal orders", () => {
  const summary = runPayablePatch(() => ({ totalOrders: 1000, totalPaid: 100, total: -999 }));

  assert.equal(summary.payable, 600);
  assert.equal(summary.total, summary.payable);
  assert.equal(summary.payableShareRate, 0.7);
});

test("payable helper adds discounted personal order total, not gross order cost", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 100,
    totalPaid: 0,
    personalOrdersAfterDiscount: 50,
    grossPersonalOrders: 100,
    total: -999
  }));

  assert.equal(summary.payable, 120);
  assert.equal(summary.total, summary.payable);
});