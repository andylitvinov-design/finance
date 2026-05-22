const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const topMetricPayableShareFixJs = fs.readFileSync(path.join(root, "top-metric-payable-share-fix.js"), "utf8");
const balanceSummaryPopupJs = fs.readFileSync(path.join(root, "balance-summary-popup.js"), "utf8");
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

function runPayablePatch(buildTopMetricsSummary) {
  const context = { buildTopMetricsSummary };
  context.globalThis = context;
  context.window = context;
  context.formatSheetNumber = (value, precision = 4) => Number(value).toFixed(precision).replace(".", ",");
  context.parseLooseNumber = (value) => {
    const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  vm.createContext(context);
  vm.runInContext(topMetricPayableShareFixJs, context);
  return context.buildTopMetricsSummary();
}

test("top order card excludes personal orders and keeps payable total canonical", () => {
  const summary = runPayablePatch(() => ({
    totalOrders: 2047.8,
    ordersAccruedWithPercent: 1400.3,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
    total: 0,
  }));

  assert.equal(Number(summary.totalOrders.toFixed(4)), 1400.3);
  assert.equal(Number(summary.ordersPaymentSummary.ordersAccruedWithPercent.toFixed(4)), 1400.3);
  assert.equal(Number(summary.ordersPaymentSummary.totalAccrued.toFixed(4)), 2047.8);
  assert.equal(Number(summary.payable.toFixed(4)), 1082.0961);
});

test("personal order summary keeps gross orders separate from discounted payable orders", () => {
  const source = [
    extractFunction(ordersJs, "isManualOrdersTotalRow"),
    extractFunction(ordersJs, "buildOrdersSummaryFromClient"),
    "this.buildOrdersSummaryFromClient = buildOrdersSummaryFromClient;",
  ].join("\n");
  const context = {
    findHeaderIndexByAliases(header, aliases) {
      const normalizedAliases = new Set(aliases.map((alias) => String(alias).trim().toLowerCase()));
      return header.findIndex((cell) => normalizedAliases.has(String(cell).trim().toLowerCase()));
    },
    hasAnyValue(row) {
      return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
    },
    isTableTotalRow(row) {
      return String(row?.[0] || "").trim().toLowerCase() === "итого";
    },
    parseLooseNumber(value) {
      const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    roundTo2(value) {
      return Math.round((Number(value) || 0) * 100) / 100;
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const summary = context.buildOrdersSummaryFromClient([
    ["DATE", "CLIENT", "COMMENT", "COST", "DISCOUNT", "TOTAL"],
    ["2026-05-10", "A", "", "1000", "50%", "500"],
    ["2026-05-11", "B", "", "295", "50%", "147.5"],
  ]);

  assert.equal(summary.personalOrdersGross, 1295);
  assert.equal(summary.personalOrdersAfterDiscount, 647.5);
});

test("balance popup labels accrued base and accrued plus percent explicitly", () => {
  const items = [];
  const doc = {
    createElement(tag) {
      const node = {
        tag,
        id: "",
        className: "",
        children: [],
        textContent: "",
        appendChild(child) {
          this.children.push(child);
          if (tag === "ol" && child.tag === "li") items.push(child.textContent);
        },
        setAttribute() {},
      };
      return node;
    },
  };
  const context = {
    document: { readyState: "complete" },
    formatSheetNumber: (value, precision = 4) => Number(value).toFixed(precision).replace(".", ","),
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(balanceSummaryPopupJs, context);

  context.EzohataBalanceSummaryPopup.renderBalanceSummaryBlock({
    ordersBase: 1360,
    orders: 1400.3,
    percentRate: 3,
    totalOrdersPlusPercent: 1400.3,
    myOrders: 1295,
    myOrdersPayable: 647.5,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    remainingToPay: 1082.0961,
    diagnostics: [],
  }, doc);

  assert.match(items.join("\n"), /Сумма заказов за период \(ACCRUED\): 1360,0000/);
  assert.match(items.join("\n"), /Итого: Заказы \+ % \(ACCRUED \+3%\): 1400,3000/);
  assert.match(items.join("\n"), /Мои заказы: 1295,0000/);
  assert.match(items.join("\n"), /Мои заказы к начислению \(уже с учетом скидки\): 647,5000/);
});
