const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const fixJs = fs.readFileSync(path.join(root, "payout-summary-metrics-fix.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase();
}

function findHeaderIndexByAliases(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function makeContext(initialMetrics, savingsValues) {
  const context = {
    parseLooseNumber,
    findHeaderIndexByAliases,
    buildTopMetricsSummary: () => ({ ...initialMetrics }),
    state: {
      data: {
        tabs: {
          payouts: {
            values: [
              ["POSITION", "DATE", "CLIENT", "SERVICE", "PAYMENT METHOD", "CURRENCY", "CURRENT AMOUNT", "AMOUNT (USD)", "RATE"],
              ["1", "2026-05-04", "Client", "Service", "Bank", "UAH", "2278,88", "51,5001", "44,25"],
              ["2", "2026-05-06", "Client", "Service", "Bank", "UAH", "4537,15", "103", "44,05"],
              ["Итого", "", "", "", "", "", "6816,0300", "154,5001", ""],
            ],
          },
          savings: { values: savingsValues },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fixJs, context);
  return context;
}

const savingsWithPayoutTransfer = [
  ["DATE", "WHO", "AMOUNT", "CURRENCY", "DESTINATION", "RATE", "AMOUNT (USD)"],
  ["2026-05-05", "me", "26000", "UAH", "fop", "44,05", "590,2384"],
  ["Итого", "", "", "", "", "", "590,2384"],
  ["Всего выплат", "", "", "", "", "", "-744,7385"],
];

test("top summary paid amount includes payout transfers", () => {
  const context = makeContext(
    { totalOrders: 360.4944, balance: 205.9943, totalPaid: -154.5001, total: -205.9943 },
    savingsWithPayoutTransfer
  );

  assert.equal(round4(context.calculateCurrentPayoutTransferUsdTotal()), 590.2384);
  const metrics = context.buildTopMetricsSummary();

  assert.equal(round4(metrics.totalPaid), -744.7385);
  assert.equal(round4(metrics.balance), -384.2441);
});

test("top summary wrapper does not double-count when transfers are already included", () => {
  const context = makeContext(
    { totalOrders: 360.4944, balance: -384.2441, totalPaid: -744.7385, total: -796.2327 },
    savingsWithPayoutTransfer
  );

  const metrics = context.buildTopMetricsSummary();

  assert.equal(round4(metrics.totalPaid), -744.7385);
  assert.equal(round4(metrics.balance), -384.2441);
});

test("blank-destination transfer rows are ignored for payout summary", () => {
  const context = makeContext(
    { totalOrders: 360.4944, balance: 205.9943, totalPaid: -154.5001, total: -205.9943 },
    [
      ["DATE", "WHO", "AMOUNT", "CURRENCY", "DESTINATION", "RATE", "AMOUNT (USD)"],
      ["2026-05-05", "me", "26000", "UAH", "", "44,05", "590,2384"],
    ]
  );

  assert.equal(context.calculateCurrentPayoutTransferUsdTotal(), 0);
  assert.equal(round4(context.buildTopMetricsSummary().totalPaid), -154.5001);
});

test("payout summary fix loads after finance and before ui", () => {
  assert.match(indexHtml, /finance\.js[\s\S]*orders\.js[\s\S]*payout-summary-metrics-fix\.js[\s\S]*ui\.js/);
});
