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

test("payable uses accrued total minus paid", () => {
  const api = loadApi();
  const summary = api.buildOrdersPaymentSummary({ totalOrders: 2789.3, totalAccrued: 3436.8, personalOrdersAfterDiscount: 647.5, totalPaid: 2536.7627 });
  assert.equal(Number(summary.ordersPayableShare.toFixed(4)), 1952.51);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 3436.8);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 900.0373);
  assert.equal(summary.payableFormula, "totalAccrued - abs(totalPaid)");
});

test("paid amount is subtracted from full accrued total when no personal orders exist", () => {
  const api = loadApi();
  const summary = api.buildOrdersPaymentSummary({ totalOrders: 1000, personalOrdersAfterDiscount: 0, totalPaid: 0 });
  assert.equal(summary.ordersPayableShare, 700);
  assert.equal(summary.remainingToPay, 1000);
});

test("overpayment can produce negative payable", () => {
  const api = loadApi();
  const summary = api.buildOrdersPaymentSummary({ totalOrders: 1000, personalOrdersAfterDiscount: 0, totalPaid: 1200 });
  assert.equal(summary.remainingToPay, -200);
});

test("patchBuildTopMetricsSummary rewrites payable but keeps visible totalOrders unchanged", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "top-metric-payable-share-fix.js"), "utf8");
  const context = {
    window: {},
    document: { getElementById() { return null; } },
    buildTopMetricsSummary() { return { totalOrders: 1000, personalOrdersAfterDiscount: 50, totalPaid: 200 }; },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "top-metric-payable-share-fix.js" });
  const summary = context.buildTopMetricsSummary();
  assert.equal(summary.totalOrders, 1000);
  assert.equal(summary.ordersPayableShare, 700);
  assert.equal(summary.totalAccrued, 1050);
  assert.equal(summary.payable, 850);
});

test("remainders top chip uses live canonical summary when local state has no remainders rows", async () => {
  const metricProfit = { textContent: "Остатки: 0,0000", dataset: {}, title: "" };
  let liveCalls = 0;
  const api = loadApi({
    document: {
      getElementById(id) { return id === "metricProfit" ? metricProfit : null; },
      readyState: "complete",
    },
    Date: { now: () => 100000 },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary() { return { rows: [], totals: { closingUsd: 0 } }; },
      async buildLiveRemaindersSummary() {
        liveCalls += 1;
        return { rows: [{ channel: "БАНК КАНАДА cad" }], periodReconciliation: { total_usd_row: { confirmed_end_usd: 7798 } } };
      },
    },
  });
  api.syncRemaindersTopCard();
  await flushPromises();
  assert.equal(liveCalls, 1);
  assert.equal(metricProfit.textContent, "Остатки: 7798,0000");
  assert.equal(metricProfit.dataset.displaySource, "remaindersSummary.live.canonical");
});

test("remainders top chip does not write local totals as authoritative", () => {
  const metricProfit = { textContent: "Остатки: 0,0000", dataset: {}, title: "" };
  const api = loadApi({
    document: {
      getElementById(id) { return id === "metricProfit" ? metricProfit : null; },
      readyState: "complete",
    },
    Date: { now: () => 200000 },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary() { return { rows: [{ channel: "binance save" }], totals: { closingUsd: 27837.7141 } }; },
      async buildLiveRemaindersSummary() { return { totals: { closingUsd: 27837.7141 } }; },
    },
  });
  api.syncRemaindersTopCard();
  assert.equal(metricProfit.textContent, "Остатки: 0,0000");
  assert.equal(metricProfit.dataset.remaindersLocalTotal, "27837,7141");
  assert.equal(metricProfit.dataset.displaySource, undefined);
});

test("remainders total falls back to selected date snapshot USD rows", () => {
  const api = loadApi();
  const total = api.extractRemaindersClosingUsd({
    totals: { closingUsd: 0 },
    selectedDateSnapshot: {
      selected_date_rows: [
        { channel: "binance save", currency: "USD", amount: "7432" },
        { channel: "Бинанс spot", currency: "USDT", amount: "1162" },
        { channel: "БАНК КАНАДА cad", currency: "CAD", amount: "10538", amount_usd: "7798" },
        { channel: "монобанк грн", currency: "UAH", amount: "1333", amount_usd: "31.36" },
      ],
    },
  });
  assert.equal(Number(total.toFixed(2)), 16423.36);
});

test("remainders total prefers reconciliation confirmed_end_usd over zero local total", () => {
  const api = loadApi();
  const total = api.extractRemaindersClosingUsd({
    totals: { closingUsd: 0 },
    periodReconciliation: { total_usd_row: { confirmed_end_usd: "20345.67" } },
    selectedDateSnapshot: { selected_date_rows: [{ channel: "binance save", currency: "USD", amount: "7432" }] },
  });
  assert.equal(total, 20345.67);
});

test("remainders total prefers canonical reconciliation over non-zero local totals", () => {
  const api = loadApi();
  const result = api.extractRemaindersClosingUsdWithSource({
    totals: { closingUsd: 27837.7141 },
    periodReconciliation: { total_usd_row: { confirmed_end_usd: "20345.67" } },
    selectedDateSnapshot: { selected_date_rows: [{ channel: "binance save", currency: "USD", amount: "7432" }] },
  });
  assert.deepEqual(result, { total: 20345.67, source: "canonical" });
});

test("remainders total does not add non-USD native amounts without explicit USD fields", () => {
  const api = loadApi();
  const total = api.extractRemaindersClosingUsd({
    totals: { closingUsd: 0 },
    selectedDateSnapshot: {
      selected_date_rows: [
        { channel: "binance save", currency: "USD", amount: "7432" },
        { channel: "Бинанс spot", currency: "USDT", amount: "1162" },
        { channel: "БАНК КАНАДА cad", currency: "CAD", amount: "10538" },
        { channel: "монобанк грн", currency: "UAH", amount: "1333" },
      ],
    },
  });
  assert.equal(total, 8594);
});
