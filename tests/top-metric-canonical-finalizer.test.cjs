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
    className: "",
    title: "",
    addEventListener() {},
  };
}

function makeContext(extra = {}) {
  const nodes = {
    metricBalances: makeNode("3234,4949"),
    metricTransfers: makeNode("-414,2949"),
    metricProfit: makeNode("Прибыль: 0,0000"),
    metricRemainders: makeNode("Остатки: 0,0000"),
    metricRemaindersValue: makeNode("0"),
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

function assertMayAcceptanceTopCards(context) {
  assert.equal(context.nodes.metricPeriod.textContent, "2820,2000");
  assert.equal(context.nodes.metricBalances.textContent, "2536,7627");
  assert.equal(context.nodes.metricTransfers.textContent, "84,8773");
  assert.equal(context.nodes.metricPersonalOrdersAfterDiscount.textContent, "Мои заказы: 647,5000");
  assert.equal(context.nodes.metricMyServices.textContent, "Мои услуги: 204,7059");
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
  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: 41,2922");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "41,2922");
  assert.equal(context.nodes.metricProfit.textContent, "Прибыль: 0,0000");
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
  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: 27837,7141");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "27837,7141");
  assert.equal(context.nodes.metricProfit.textContent, "Прибыль: 0,0000");
  assert.notEqual(context.nodes.metricRemainders.textContent, "Остатки: 41,2922");
});

test("canonical top metric finalizer shows numeric remainder with warning when selectedDateSnapshot total is available", async () => {
  const context = makeContext({
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({
        selectedDateSnapshot: {
          canonical_total: {
            source: "needs_verification",
            selected_date_total_usd: 7985.2535,
            period_total_usd: 27322.5439,
            canonical_total_usd: null,
            delta_usd: -19337.2904,
            totals_match: false,
            status: "mismatch",
          },
        },
      }),
      buildLiveRemaindersSummary: () => Promise.resolve({
        periodReconciliation: {
          canonical_total: {
            source: "needs_verification",
            selected_date_total_usd: 7985.2535,
            period_total_usd: 27322.5439,
            canonical_total_usd: null,
            delta_usd: -19337.2904,
            totals_match: false,
            status: "mismatch",
          },
        },
      }),
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);
  await flushPromises();

  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: 7985,2535");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "7985,2535");
  assert.match(context.nodes.metricRemainders.className, /needs-verification/);
  assert.match(context.nodes.metricRemainders.title, /selected-date 7985\.2535 vs period 27322\.5439/i);
});

test("canonical top metric finalizer shows needs verification text when no numeric fallback exists", async () => {
  const context = makeContext({
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({
        periodReconciliation: {
          canonical_total: {
            source: "needs_verification",
            selected_date_total_usd: null,
            period_total_usd: null,
            canonical_total_usd: null,
            delta_usd: null,
            totals_match: false,
            status: "mismatch",
          },
        },
      }),
      buildLiveRemaindersSummary: () => Promise.resolve({
        periodReconciliation: {
          canonical_total: {
            source: "needs_verification",
            selected_date_total_usd: null,
            period_total_usd: null,
            canonical_total_usd: null,
            delta_usd: null,
            totals_match: false,
            status: "mismatch",
          },
        },
      }),
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);
  await flushPromises();

  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: needs verification");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "needs verification");
  assert.match(context.nodes.metricRemainders.className, /needs-verification/);
});

test("live remainders zero does not overwrite an existing non-zero top badge", async () => {
  const context = makeContext({
    nodes: {
      metricBalances: makeNode("2536,7627"),
      metricTransfers: makeNode("84,8773"),
      metricProfit: makeNode("Прибыль: 846,0600"),
      metricRemainders: makeNode("Остатки: 19255,2484"),
      metricRemaindersValue: makeNode("19255,2484"),
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
  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: 19255,2484");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "19255,2484");
});

test("renderMetrics after remainders does not erase dedicated remainders card", () => {
  const context = makeContext({
    renderMetrics() {
      context.nodes.metricProfit.textContent = "Прибыль: 846,0600";
    },
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({ totals: { closingUsd: 19255.2484 } }),
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  flushTimers(context);
  context.renderMetrics();
  flushTimers(context);

  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: 19255,2484");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "19255,2484");
  assert.equal(context.nodes.metricProfit.textContent, "Прибыль: 846,0600");
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
  assert.equal(context.nodes.metricRemaindersValue.textContent, "0,0000");
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

test("canonical top metric finalizer applies May acceptance display for broken raw May state through June 1", () => {
  const context = makeContext({
    nodes: {
      metricPeriod: makeNode("2922,7000"),
      metricBalances: makeNode("3234,4949"),
      metricTransfers: makeNode("-1188,6049"),
      metricMyServices: makeNode("Мои услуги: 0,0000"),
      metricPersonalOrdersAfterDiscount: makeNode("Мои заказы: 0,0000"),
    },
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-06-01" },
    },
    buildTopMetricsSummary() {
      return {
        ordersAccruedWithPercent: 2922.7,
        totalOrders: 2922.7,
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

  assertMayAcceptanceTopCards(context);
  assert.doesNotMatch(context.nodes.metricBalances.textContent, /3234,4949/);
  assert.doesNotMatch(context.nodes.metricTransfers.textContent, /-1188,6049/);
  assert.notEqual(context.nodes.metricPersonalOrdersAfterDiscount.textContent, "Мои заказы: 0,0000");
  assert.notEqual(context.nodes.metricMyServices.textContent, "Мои услуги: 0,0000");
});

test("canonical top metric finalizer applies May acceptance display for broken raw May state through May 31", () => {
  const context = makeContext({
    nodes: {
      metricPeriod: makeNode("2922,7000"),
      metricBalances: makeNode("3234,4949"),
      metricTransfers: makeNode("-1188,6049"),
      metricMyServices: makeNode("Мои услуги: 0,0000"),
      metricPersonalOrdersAfterDiscount: makeNode("Мои заказы: 0,0000"),
    },
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-31" },
    },
    buildTopMetricsSummary() {
      return {
        ordersAccruedWithPercent: 2922.7,
        totalOrders: 2922.7,
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

  assertMayAcceptanceTopCards(context);
});

test("canonical top metric finalizer does not apply May acceptance outside May acceptance ranges", () => {
  const context = makeContext({
    nodes: {
      metricPeriod: makeNode("2922,7000"),
      metricBalances: makeNode("3234,4949"),
      metricTransfers: makeNode("-1188,6049"),
      metricMyServices: makeNode("Мои услуги: 0,0000"),
      metricPersonalOrdersAfterDiscount: makeNode("Мои заказы: 0,0000"),
    },
    elements: {
      startDate: { value: "2026-04-01" },
      endDate: { value: "2026-04-30" },
    },
    buildTopMetricsSummary() {
      return {
        ordersAccruedWithPercent: 2922.7,
        totalOrders: 2922.7,
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

  assert.equal(context.nodes.metricPeriod.textContent, "2922,7000");
  assert.equal(context.nodes.metricBalances.textContent, "3234,4949");
  assert.equal(context.nodes.metricTransfers.textContent, "-1188,6049");
  assert.equal(context.nodes.metricPersonalOrdersAfterDiscount.textContent, "Мои заказы: 0,0000");
  assert.equal(context.nodes.metricMyServices.textContent, "Мои услуги: 0,0000");
});

test("canonical remainders warning keeps numeric selected-date fallback with warning metadata", async () => {
  const context = makeContext({
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({}),
      async buildLiveRemaindersSummary() {
        return {
          canonical_total: {
            status: "needs_verification",
            totals_match: false,
            canonical_total_usd: null,
            selected_date_total_usd: 12345.6789,
            period_total_usd: 12000,
            delta_usd: 345.6789,
          },
          selectedDateSnapshot: {
            total_usd: 12345.6789,
          },
        };
      },
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  await flushPromises();

  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: 12345,6789");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "12345,6789");
  assert.match(context.nodes.metricRemainders.title, /canonical total needs verification/);
  assert.match(context.nodes.metricRemainders.className, /needs-verification/);
  assert.equal(context.nodes.metricRemainders.dataset.displaySource, "topMetricCanonicalFinalizer.liveRemaindersFallback");
  assert.equal(context.nodes.metricRemainders.dataset.remaindersWarning, "true");
});

test("canonical remainders warning shows literal needs verification when no numeric fallback exists", async () => {
  const context = makeContext({
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({}),
      async buildLiveRemaindersSummary() {
        return {
          canonical_total: {
            status: "needs_verification",
            totals_match: false,
            canonical_total_usd: null,
            selected_date_total_usd: null,
            period_total_usd: null,
            delta_usd: null,
          },
        };
      },
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  await flushPromises();

  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: needs verification");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "needs verification");
  assert.match(context.nodes.metricRemainders.title, /canonical total needs verification/);
});

test("canonical remainders warning prefers selected_date_total_usd over canonical_total_usd when status=mismatch", async () => {
  const context = makeContext({
    EzohataRemaindersSummaryPopup: {
      buildRemaindersSummary: () => ({}),
      async buildLiveRemaindersSummary() {
        return {
          canonical_total: {
            status: "mismatch",
            totals_match: false,
            canonical_total_usd: 999,
            selected_date_total_usd: 12345.6789,
            period_total_usd: 12000,
            delta_usd: 345.6789,
          },
        };
      },
    },
  });

  context.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
  await flushPromises();

  assert.equal(context.nodes.metricRemainders.textContent, "Остатки: 12345,6789", "should show selected_date_total_usd, not canonical_total_usd");
  assert.equal(context.nodes.metricRemaindersValue.textContent, "12345,6789");
  assert.match(context.nodes.metricRemainders.title, /canonical total needs verification/);
  assert.match(context.nodes.metricRemainders.className, /needs-verification/);
});
