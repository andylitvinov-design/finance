const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi(extraContext = {}) {
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
    ...extraContext,
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "top-metric-payable-share-fix.js" });
  return context.window.EzohataTopMetricPayableShareFix;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
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

test("remainders top chip uses live summary when local state has no remainders rows", async () => {
  const metricProfit = { textContent: "Остатки: 0,0000", dataset: {}, title: "" };
  let liveCalls = 0;
  const api = loadApi({
    document: {
      getElementById(id) {
        return id === "metricProfit" ? metricProfit : null;
      },
      readyState: "complete",
    },
    Date: { now: () => 100000 },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary() {
        return { rows: [], totals: { closingUsd: 0 } };
      },
      async buildLiveRemaindersSummary() {
        liveCalls += 1;
        return { rows: [{ channel: "БАНК КАНАДА cad" }], totals: { closingUsd: 7798 } };
      },
    },
  });

  api.syncRemaindersTopCard();
  await flushPromises();

  assert.equal(liveCalls, 1);
  assert.equal(metricProfit.textContent, "Остатки: 7798,0000");
  assert.equal(metricProfit.dataset.displaySource, "remaindersSummary.live.totals.closingUsd");
});

test("remainders top chip keeps non-zero local summary without waiting for live fetch", () => {
  const metricProfit = { textContent: "Остатки: 0,0000", dataset: {}, title: "" };
  const api = loadApi({
    document: {
      getElementById(id) {
        return id === "metricProfit" ? metricProfit : null;
      },
      readyState: "complete",
    },
    Date: { now: () => 200000 },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary() {
        return { rows: [{ channel: "binance save" }], totals: { closingUsd: 7432 } };
      },
      async buildLiveRemaindersSummary() {
        return { totals: { closingUsd: 9999 } };
      },
    },
  });

  api.syncRemaindersTopCard();

  assert.equal(metricProfit.textContent, "Остатки: 7432,0000");
  assert.equal(metricProfit.dataset.displaySource, "remaindersSummary.local.totals.closingUsd");
});
