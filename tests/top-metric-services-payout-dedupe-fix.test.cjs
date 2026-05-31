const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const fixJs = fs.readFileSync(path.join(root, "top-metric-services-payout-dedupe-fix.js"), "utf8");

function makeContext(extra = {}) {
  const nodes = {
    metricMyServices: { textContent: "Мои услуги: 0", dataset: {} },
  };
  const context = {
    state: {
      data: {
        tabs: {
          payouts: { values: [] },
        },
      },
    },
    document: {
      readyState: "complete",
      getElementById(id) {
        return nodes[id] || null;
      },
      addEventListener() {},
    },
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-31" },
    },
    setTimeout(callback) {
      if (typeof callback === "function") callback();
    },
    parseLooseNumber(value) {
      const parsed = Number(String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber(value, precision = 4) {
      return Number(value || 0).toFixed(precision).replace(".", ",");
    },
    findHeaderIndexByAliases(header, aliases) {
      const normalized = new Set((aliases || []).map((item) => String(item).trim().toLowerCase()));
      return (header || []).findIndex((cell) => normalized.has(String(cell || "").trim().toLowerCase()));
    },
    nodes,
    ...extra,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fixJs, context, { filename: "top-metric-services-payout-dedupe-fix.js" });
  return context;
}

test("services_me restores visible badge without changing canonical summary totals", () => {
  const originalSummary = {
    totalOrders: 2047.8,
    ordersAccruedWithPercent: 1400.3,
    ordersPayableShare: 980.21,
    payableOrderShareRate: 0.7,
    personalOrdersAfterDiscount: 647.5,
    totalPaid: 965.7039,
    payable: 1082.0961,
    total: 1082.0961,
    myServices: 0,
    profit: 50,
  };
  const context = makeContext({
    buildTopMetricsSummary: () => ({ ...originalSummary }),
    EzohataServiceInLayer: {
      collectLedgerRows: () => [
        {
          date: "2026-05-12",
          category: "servicein",
          operation: "income",
          direction: "in",
          subcategory: "services_me",
          amount_usd: "204.7059",
          to_channel: "Wise",
        },
      ],
      buildServiceInIncomeLookup: (rows) => ({
        total: rows.reduce((sum, row) => sum + Number(row.amount_usd), 0),
        byChannel: { Wise: 204.7059 },
      }),
    },
  });

  const summary = context.buildTopMetricsSummary();
  context.EzohataTopMetricServicesPayoutDedupeFix.syncServicesBadgeFromSummary();

  assert.deepEqual(summary, originalSummary);
  assert.equal(context.nodes.metricMyServices.textContent, "Мои услуги: 204,7059");
  assert.equal(context.nodes.metricMyServices.dataset.displaySource, "services_me_ledger");
});

test("Kovalev Wise transfers already present in payouts are not added again", () => {
  const context = makeContext({
    state: {
      data: {
        tabs: {
          payouts: {
            values: [
              ["DATE", "CLIENT", "PAYMENT METHOD", "AMOUNT (USD)"],
              ["2026-05-10", "Kovalev", "Wise", "597.4"],
              ["2026-05-11", "Kovalev", "Wise", "103"],
            ],
          },
        },
        manual: {
          transfers: [
            { transferDate: "2026-05-10", who: "Kovalev", channel: "Wise", usdAmount: "597.4" },
            { transferDate: "2026-05-11", who: "Kovalev", channel: "Wise", usdAmount: "103" },
          ],
        },
      },
    },
  });

  assert.equal(context.calculateCurrentPayoutTransferUsdTotal(), 0);
});
