const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const mainJs = fs.readFileSync(path.join(root, "main.js"), "utf8");
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
    getRealIncomeUsdForProfit: () => 0,
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
              ["NUMBER", "ACCRUED +3%", "ИТОГО", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
              ["1", "100", "50", "111", "82"],
            ],
          },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(ordersJs, "buildOrdersSummaryFromClient")}\n` +
    `${extractFunction(ordersJs, "isManualOrdersTotalRow")}\n` +
    `${extractFunction(financeJs, "getMovementTotalsFromTable")}\n` +
    `${extractFunction(financeJs, "getMovementSummaryMetric")}\n` +
    `${extractFunction(financeJs, "buildTopMetricsSummary")}\n` +
    "this.buildTopMetricsSummary = buildTopMetricsSummary;",
    context
  );

  const metrics = context.buildTopMetricsSummary();
  assert.equal(metrics.balance, 175);
  assert.equal(metrics.personalOrdersAfterDiscount, 50);
});

test("period-filtered manual orders expose only selected personal discounted total", () => {
  const context = {
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_ORDERS_HEADERS: ["ДАТА", "ИМЯ", "ЗАКАЗ", "СТОИМОСТЬ", "СКИДКА", "ИТОГО"],
    parseLooseNumber,
    normalizeCell,
    findHeaderIndexByAliases,
    hasAnyValue,
    isTableTotalRow,
    roundTo2,
    formatSheetNumber: (value) => Number(value).toFixed(4).replace(".", ","),
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-21" },
    },
    state: {
      manualOrders: {
        data: {
          headers: ["ДАТА", "ИМЯ", "ЗАКАЗ", "СТОИМОСТЬ", "СКИДКА", "ИТОГО"],
          rows: [
            ["30.04.2026", "Outside", "old personal order", "100", "50%", "50"],
            ["21.05.2026", "Inside", "current personal order", "100", "50%", "50"],
          ],
        },
      },
      data: { tabs: { orders: { values: [] } } },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(mainJs, "parseIsoDate")}\n` +
    `${extractFunction(mainJs, "parseDisplayDate")}\n` +
    `${extractFunction(mainJs, "findDateColumnIndex")}\n` +
    `${extractFunction(mainJs, "padRowToWidth")}\n` +
    `${extractFunction(financeJs, "formatSheetNumber")}\n` +
    `${extractFunction(ordersJs, "recalculateManualOrderRow")}\n` +
    `${extractFunction(ordersJs, "appendManualOrdersTotalRow")}\n` +
    `${extractFunction(ordersJs, "buildManualOrdersTotalRow")}\n` +
    `${extractFunction(ordersJs, "isManualOrdersTotalRow")}\n` +
    `${extractFunction(ordersJs, "getVisibleManualOrdersRows")}\n` +
    `${extractFunction(ordersJs, "buildOrdersSummaryFromClient")}\n` +
    "this.getVisibleManualOrdersRows = getVisibleManualOrdersRows;\n" +
    "this.buildOrdersSummaryFromClient = buildOrdersSummaryFromClient;",
    context
  );

  const visible = context.getVisibleManualOrdersRows("2026-05-01", "2026-05-21");
  const summary = context.buildOrdersSummaryFromClient([visible.headers, ...visible.rows]);

  assert.equal(summary.orderRows, 1);
  assert.equal(summary.personalOrdersAfterDiscount, 50);
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
