const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const ordersJs = fs.readFileSync(path.join(root, "orders.js"), "utf8");

function extractFunction(source, name) {
  const pattern = new RegExp(`^function ${name}\\(`, "m");
  const match = pattern.exec(source);
  if (!match) throw new Error(`${name} was not found`);
  const next = source.slice(match.index + 1).search(/^function [A-Za-z0-9_]+\(/m);
  return next === -1
    ? source.slice(match.index).trim()
    : source.slice(match.index, match.index + 1 + next).trim();
}

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

function hasAnyValue(row) {
  return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
}

function isTableTotalRow(row) {
  return normalizeCell(row?.[0]) === normalizeCell("Итого");
}

function roundTo2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

test("top metrics balance uses explicit balance columns for movement and orders", () => {
  const context = {
    parseLooseNumber,
    normalizeCell,
    findHeaderIndexByAliases,
    hasAnyValue,
    isTableTotalRow,
    roundTo2,
    calculateCurrentOverallPayoutUsdTotal: () => 0,
    getCurrentFactMetricTotals: () => ({ myServices: 0, myCosts: 0 }),
    buildAnalyticsUpgradeTotals: () => ({ total: 0, profit: 0 }),
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "ACCRUED +3%", "70% OF +3%", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
              ["1", "103", "72,1", "10", "93"],
            ],
            summaryRows: [],
          },
          orders: {
            values: [
              ["NUMBER", "ACCRUED +3%", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
              ["1", "100", "111", "82"],
            ],
          },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(ordersJs, "buildOrdersSummaryFromClient")}\n` +
    `${extractFunction(financeJs, "getMovementTotalsFromTable")}\n` +
    `${extractFunction(financeJs, "getMovementSummaryMetric")}\n` +
    `${extractFunction(financeJs, "buildTopMetricsSummary")}\n` +
    "this.buildTopMetricsSummary = buildTopMetricsSummary;",
    context
  );

  assert.equal(context.buildTopMetricsSummary().balance, 175);
});

test("getMovementTotalsFromTable prefers net received over client-paid gross", () => {
  const context = {
    parseLooseNumber,
    normalizeCell,
    findHeaderIndexByAliases,
    hasAnyValue,
    isTableTotalRow,
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "getMovementTotalsFromTable")}\n` +
    "this.getMovementTotalsFromTable = getMovementTotalsFromTable;",
    context
  );

  const totals = context.getMovementTotalsFromTable([
    ["NUMBER", "ACCRUED +3%", "ОПЛАЧЕНО КЛИЕНТОМ USD", "ДОШЛО ДО НАС USD", "BALANCE"],
    ["1", "103", "120", "110", "7"]
  ]);

  assert.equal(totals.receivedUsdTotal, 110);
  assert.equal(totals.balanceTotal, 7);
});
