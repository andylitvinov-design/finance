const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const fixJs = fs.readFileSync(path.join(root, "payout-summary-metrics-fix.js"), "utf8");

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumManualFinanceFieldUsdNumber(rows, key) {
  return (rows || []).reduce((sum, row) => sum + parseLooseNumber(row?.[key]), 0);
}

function sumManualFinanceSpendUsdNumber(rows) {
  return (rows || []).reduce((sum, row) => {
    return sum + ["business", "house", "food", "fun", "study", "travelFun"].reduce(
      (subtotal, key) => subtotal + parseLooseNumber(row?.[key]),
      0
    );
  }, 0);
}

function makeContext(options = {}) {
  const context = {
    parseLooseNumber,
    findHeaderIndexByAliases(header, aliases) {
      const normalizedAliases = new Set((aliases || []).map((alias) => String(alias || "").trim().toLowerCase()));
      return (header || []).findIndex((cell) => normalizedAliases.has(String(cell || "").trim().toLowerCase()));
    },
    sumManualFinanceFieldUsdNumber,
    sumManualFinanceSpendUsdNumber,
    buildManualFinanceUsdRateLookup() {
      return { byChannel: {}, byCurrency: {} };
    },
    buildTopMetricsSummary() {
      return {
        totalOrders: 1000,
        totalPaid: -100,
        balance: 900,
        total: -700,
        myServices: 500,
        myCosts: 2500,
        profit: -2000,
        ...(options.initialMetrics || {}),
      };
    },
    elements: {
      startDate: { value: options.startDate || "2026-05-01" },
      endDate: { value: options.endDate || "2026-05-08" },
    },
    state: {
      aggregatedManualRange: options.aggregatedManualRange || { moneyRows: [], transferRows: [] },
      analyticsFact: options.analyticsFact || {},
      manualFinance: { data: options.manualFinanceData || {} },
      manualTransfers: { data: { transferRows: [] } },
      data: {
        tabs: {
          movement: { values: [] },
          payouts: { values: [], closedFactTransfers: [] },
          savings: { values: [] },
        },
        manual: { transfers: [] },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fixJs, context);
  return context;
}

test("top metric myCosts and profit use only rows inside the selected date range", () => {
  const context = makeContext({
    aggregatedManualRange: {
      transferRows: [],
      moneyRows: [
        { date: "2026-04-30", channel: "Яндекс руб", serviceIncome: "90", business: "900" },
        { date: "2026-05-02", channel: "Яндекс руб", serviceIncome: "10", business: "100" },
      ],
    },
  });

  const metrics = context.buildTopMetricsSummary();

  assert.equal(metrics.myServices, 10);
  assert.equal(metrics.myCosts, 100);
  assert.equal(metrics.profit, -90);
  assert.equal(metrics.topMetricsPeriodScoped, true);
  assert.equal(metrics.topMetricsPeriodScopedRows, 1);
});

test("top metrics do not silently use full-range undated analytics fallback", () => {
  const context = makeContext({
    analyticsFact: {
      moneyRows: [
        { channel: "Яндекс руб", serviceIncome: "10", business: "100" },
      ],
    },
  });

  const metrics = context.buildTopMetricsSummary();

  assert.equal(metrics.myServices, 500);
  assert.equal(metrics.myCosts, 2500);
  assert.equal(metrics.profit, -2000);
  assert.equal(metrics.topMetricsPeriodScoped, undefined);
});

test("explicit selected-period analyticsFact rows without per-row dates are accepted", () => {
  const context = makeContext({
    analyticsFact: {
      periodStart: "2026-05-01",
      periodEnd: "2026-05-08",
      transferRows: [],
      moneyRows: [
        { channel: "Яндекс руб", serviceIncome: "25", business: "40", house: "60" },
      ],
    },
  });

  const metrics = context.buildTopMetricsSummary();

  assert.equal(metrics.myServices, 25);
  assert.equal(metrics.myCosts, 100);
  assert.equal(metrics.profit, -75);
  assert.equal(metrics.topMetricsPeriodScoped, true);
});
