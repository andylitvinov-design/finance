const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");
const topMetricPayableShareFixJs = fs.readFileSync(path.join(root, "top-metric-payable-share-fix.js"), "utf8");
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

test("summary metrics render directly in the top card flow", () => {
  assert.match(indexHtml, /<div class="metric-label">Оплатить<\/div>/);
  assert.doesNotMatch(indexHtml, /<script[^>]+src=["']\.\/summary-metrics-fix\.js["'][^>]*>/);
  assert.match(indexHtml, /<script[^>]+src=["']\.\/top-metric-payable-share-fix\.js["'][^>]*>/);

  const elements = {
    metricPeriod: makeNode(),
    metricOrders: makeNode(),
    metricBalances: makeNode(),
    metricTransfers: makeNode(),
    metricMyServices: makeNode(),
    metricProfit: makeNode(),
    metricMyCosts: makeNode(),
  };
  const context = {
    elements,
    buildTopMetricsSummary: () => ({
      totalOrders: 360.5,
      balance: 5.7118,
      totalPaid: 354.7882,
      total: -200.8499,
      myServices: 200,
      myCosts: 150,
      profit: 50,
    }),
    formatSheetNumber: (value, precision = 4) => Number(value).toFixed(precision).replace(".", ","),
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(topMetricPayableShareFixJs, context);
  vm.runInContext(
    `${extractFunction(uiJs, "renderMetrics")}\nthis.renderMetrics = renderMetrics;`,
    context
  );

  context.renderMetrics();

  assert.equal(elements.metricOrders.textContent, "-5,7118");
  assert.equal(elements.metricTransfers.textContent, "-246,6382");
  assert.equal(elements.metricMyCosts.textContent, "Мои затраты: 150,0000");
  assert.equal(elements.metricProfit.textContent, "Прибыль: 50,0000");
});

test("payable helper calculates 30 percent of orders minus paid", () => {
  const summary = runPayablePatch(() => ({ totalOrders: 1148.45, totalPaid: 847.7385, total: 43.8235 }));

  assert.equal(Number(summary.payable.toFixed(4)), -503.2035);
  assert.equal(summary.total, summary.payable);
  assert.equal(summary.payableFormula, "totalOrders * 0.3 - totalPaid");
});

test("payable helper uses the displayed paid amount when internal paid total is negative", () => {
  const summary = runPayablePatch(() => ({ totalOrders: 1148.45, totalPaid: -847.7385, total: 43.8235 }));

  assert.equal(Number(summary.payable.toFixed(4)), -503.2035);
  assert.equal(summary.total, summary.payable);
});

test("payable helper leaves a positive amount when paid is below 30 percent", () => {
  const summary = runPayablePatch(() => ({ totalOrders: 1000, totalPaid: 100, total: -999 }));

  assert.equal(summary.payable, 200);
  assert.equal(summary.total, 200);
  assert.equal(summary.payableShareRate, 0.3);
});
