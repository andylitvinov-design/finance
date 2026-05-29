const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi() {
  const source = fs.readFileSync(path.join(__dirname, "..", "top-metric-payable-share-fix.js"), "utf8");
  const context = {
    window: {},
    document: {
      getElementById() {
        return null;
      },
    },
    parseLooseNumber(value) {
      const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber(value) {
      return Number(value || 0).toFixed(4).replace(".", ",");
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "top-metric-payable-share-fix.js" });
  return context.window.EzohataTopMetricPayableShareFix;
}

test("payable uses 70 percent of order total plus personal orders minus paid", () => {
  const api = loadApi();
  const summary = api.buildOrdersPaymentSummary({
    totalOrders: 2789.3,
    personalOrdersAfterDiscount: 647.5,
    totalPaid: 2536.7627,
  });

  assert.equal(Number(summary.ordersPayableShare.toFixed(4)), 1952.51);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 2600.01);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 63.2473);
  assert.equal(summary.payableFormula, "ordersAccruedWithPercent * 0.7 + myOrdersDiscounted - abs(totalPaid)");
});

test("paid amount changes payable only after 70 percent share is applied", () => {
  const api = loadApi();
  const summary = api.buildOrdersPaymentSummary({
    totalOrders: 1000,
    personalOrdersAfterDiscount: 0,
    totalPaid: 0,
  });

  assert.equal(summary.ordersPayableShare, 700);
  assert.equal(summary.remainingToPay, 700);
});

test("overpayment can produce negative payable", () => {
  const api = loadApi();
  const summary = api.buildOrdersPaymentSummary({
    totalOrders: 1000,
    personalOrdersAfterDiscount: 0,
    totalPaid: 800,
  });

  assert.equal(summary.remainingToPay, -100);
});

test("patchBuildTopMetricsSummary rewrites payable but keeps visible totalOrders unchanged", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "top-metric-payable-share-fix.js"), "utf8");
  const context = {
    window: {},
    document: { getElementById() { return null; } },
    buildTopMetricsSummary() {
      return { totalOrders: 1000, personalOrdersAfterDiscount: 50, totalPaid: 200 };
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "top-metric-payable-share-fix.js" });

  const summary = context.buildTopMetricsSummary();
  assert.equal(summary.totalOrders, 1000);
  assert.equal(summary.ordersPayableShare, 700);
  assert.equal(summary.totalAccrued, 750);
  assert.equal(summary.payable, 550);
});
