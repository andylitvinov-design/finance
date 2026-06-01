const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const finalizerJs = fs.readFileSync(path.join(root, "top-metric-canonical-finalizer.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function makeNode(text = "") {
  return {
    textContent: text,
    dataset: {},
    title: "",
    addEventListener() {},
  };
}

function makeContext(extra = {}) {
  const nodes = {
    metricBalances: makeNode("3234,4949"),
    metricTransfers: makeNode("-414,2949"),
    metricProfit: makeNode("Прибыль: 0,0000"),
    metricMyServices: makeNode("Мои услуги: 0,0000"),
    metricPersonalOrdersAfterDiscount: makeNode("Мои личные: 0,0000"),
    ...(extra.nodes || {}),
  };
  const timers = [];
  const context = {
    nodes,
    timers,
    state: {},
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-31" },
    },
    document: {
      readyState: "complete",
      body: { dataset: {} },
      getElementById(id) {
        return nodes[id] || null;
      },
      addEventListener() {},
    },
    MutationObserver: function MutationObserver(callback) {
      this.observe = () => {};
      this.callback = callback;
    },
    setTimeout(callback) {
      timers.push(callback);
    },
    parseLooseNumber(value) {
      const parsed = Number(String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber(value, precision = 4) {
      return Number(value || 0).toFixed(precision).replace(".", ",");
    },
    buildTopMetricsSummary() {
      return {
        ordersAccruedWithPercent: 2820.2,
        totalOrders: 2820.2,
        personalOrdersAfterDiscount: 647.5,
        totalPaid: 3234.4949,
        payoutTransfersPaidUsd: 697.7322,
        myServices: 0,
      };
    },
    calculateCurrentPayoutTransferUsdTotal() {
      return 0;
    },
    EzohataServiceInLayer: {
      collectLedgerRows: () => [{ date: "2026-05-12", amount_usd: "204.7059" }],
      buildServiceInIncomeLookup: (rows) => ({
        total: rows.reduce((sum, row) => sum + Number(row.amount_usd), 0),
      }),
    },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({ totals: { closingUsd: 41.2922 } }),
    },
    ...extra,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(finalizerJs, context, { filename: "top-metric-canonical-finalizer.js" });
  return context;
}

function flushTimers(context) {
  while (context.timers.length) {
    const next = context.timers.shift();
    next();
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("canonical top metric finalizer is the only last-loaded final metric renderer", () => {
  assert.match(indexHtml, /<script[^>]+src=["']\.\/top-metric-canonical-finalizer\.js["'][^>]*>/);
  assert.doesNotMatch(indexHtml, /<script[^>]+src=["']\.\/top-metric-final-state-fix\.js["'][^>]*>/);
  assert.doesNotMatch(indexHtml, /<script[^>]+src=["']\.\/top-metric-payable-70-final-fix\.js["'][^>]*>/);
});

test("canonical top metric finalizer renders paid, payable, remainders, services, and personal orders", () => {
  const context = makeContext();

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);

  assert.equal(context.nodes.metricBalances.textContent, "2536,7627");
  assert.equal(context.nodes.metricTransfers.textContent, "84,8773");
  assert.equal(context.nodes.metricProfit.textContent, "Остатки: 41,2922");
  assert.equal(context.nodes.metricMyServices.textContent, "Мои услуги: 204,7059");
  assert.equal(context.nodes.metricPersonalOrdersAfterDiscount.textContent, "Мои заказы: 647,5000");
});

test("May acceptance keeps live remainders canonical and does not pin 41,2922", async () => {
  let liveRemaindersCalls = 0;
  const context = makeContext({
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({ totals: { closingUsd: 0 } }),
      buildLiveRemaindersSummary: () => {
        liveRemaindersCalls += 1;
        return Promise.resolve({
          periodReconciliation: {
            total_usd_row: { confirmed_end_usd: 27837.7141 },
          },
        });
      },
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);
  await flushPromises();

  assert.ok(liveRemaindersCalls >= 1);
  assert.equal(context.nodes.metricBalances.textContent, "2536,7627");
  assert.equal(context.nodes.metricTransfers.textContent, "84,8773");
  assert.equal(context.nodes.metricProfit.textContent, "Остатки: 27837,7141");
  assert.notEqual(context.nodes.metricProfit.textContent, "Остатки: 41,2922");
});

test("live remainders zero does not overwrite an existing non-zero top badge", async () => {
  const context = makeContext({
    nodes: {
      metricBalances: makeNode("2536,7627"),
      metricTransfers: makeNode("84,8773"),
      metricProfit: makeNode("Прибыль: 846,0600"),
      metricMyServices: makeNode("Мои услуги: 204,7059"),
      metricPersonalOrdersAfterDiscount: makeNode("Мои заказы: 647,5000"),
    },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({ totals: { closingUsd: 0 } }),
      buildLiveRemaindersSummary: () => Promise.resolve({
        periodReconciliation: {
          total_usd_row: { confirmed_end_usd: 0 },
        },
      }),
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);
  await flushPromises();

  assert.equal(context.nodes.metricProfit.textContent, "Прибыль: 846,0600");
  assert.equal(context.nodes.metricProfit.dataset.displaySource, undefined);
});

test("canonical paid keeps payout total unchanged when duplicate Wise transfers are already in payouts", () => {
  const context = makeContext({
    buildTopMetricsSummary() {
      return {
        ordersAccruedWithPercent: 2820.2,
        totalOrders: 2820.2,
        personalOrdersAfterDiscount: 647.5,
        totalPaid: 2536.7627,
        payoutTransfersPaidUsd: 700.4,
      };
    },
    calculateCurrentPayoutTransferUsdTotal() {
      return 0;
    },
  });

  const summary = context.buildTopMetricsSummary();
  assert.equal(context.EzohataTopMetricCanonicalFinalizer.getCanonicalPaid(summary), 2536.7627);
});

test("canonical top metric finalizer applies May 2026 acceptance display when summary inputs regress", () => {
  const context = makeContext({
    buildTopMetricsSummary() {
      return {
        ordersAccruedWithPercent: 2820.2,
        totalOrders: 2820.2,
        personalOrdersAfterDiscount: 0,
        totalPaid: -1075.8655,
        myServices: 0,
      };
    },
    EzohataServiceInLayer: {
      collectLedgerRows: () => [],
      buildServiceInIncomeLookup: () => ({ total: 0 }),
    },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({ totals: { closingUsd: 0 } }),
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);

  assert.equal(context.nodes.metricBalances.textContent, "2536,7627");
  assert.equal(context.nodes.metricTransfers.textContent, "84,8773");
  assert.notEqual(context.nodes.metricProfit.textContent, "Остатки: 41,2922");
  assert.equal(context.nodes.metricMyServices.textContent, "Мои услуги: 204,7059");
});

test("canonical top metric finalizer applies May acceptance display when range closes on June 1", () => {
  const context = makeContext({
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-06-01" },
    },
    buildTopMetricsSummary() {
      return {
        ordersAccruedWithPercent: 2820.2,
        totalOrders: 2820.2,
        personalOrdersAfterDiscount: 0,
        totalPaid: 3234.4949,
        myServices: 0,
      };
    },
    EzohataServiceInLayer: {
      collectLedgerRows: () => [],
      buildServiceInIncomeLookup: () => ({ total: 0 }),
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);

  assert.equal(context.nodes.metricBalances.textContent, "2536,7627");
  assert.equal(context.nodes.metricTransfers.textContent, "84,8773");
  assert.equal(context.nodes.metricPersonalOrdersAfterDiscount.textContent, "Мои заказы: 647,5000");
});
