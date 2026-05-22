const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function resetBalanceModule() {
  delete require.cache[require.resolve("../balance-summary-popup.js")];
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.elements;
  delete global.buildTopMetricsSummary;
  delete global.EzohataBalanceSummaryPopup;
}

function loadApi() {
  resetBalanceModule();
  return require("../balance-summary-popup.js");
}

test("top balance button replaced old top audit launcher while bottom audit script stays loaded", () => {
  assert.match(indexHtml, /id="balanceLauncherButton"[^>]*>Баланс<\/button>/);
  assert.doesNotMatch(indexHtml, /id="auditLauncherButton"[^>]*>Аудит<\/button>/);
  assert.match(indexHtml, /audit-site-tab\.js/);
});

test("balance summary does not discount myOrders twice", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({ totalOrdersPlusPercent: 1100, myOrders: 200, paid: 500 });

  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.myOrders, 200);
  assert.equal(summary.myOrdersPayable, 200);
  assert.equal(summary.myOrdersHalf, 200);
  assert.equal(summary.totalAccrued, 1300);
  assert.equal(summary.remainingToPay, 800);
  resetBalanceModule();
});

test("orders payment summary uses accrued with percent, discounted personal orders, and paid once", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    totalOrdersPlusPercent: 1400.3,
    myOrders: 647.5,
    paid: 965.7039,
  });

  assert.equal(Number(summary.orders.toFixed(4)), 1400.3);
  assert.equal(Number(summary.myOrdersPayable.toFixed(4)), 647.5);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 2047.8);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1082.0961);
  resetBalanceModule();
});

test("occurred table uses OCCURRED as base and OCCURRED plus percent as total", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "OCCURRED", "OCCURRED +3%", "ACCRUED", "ACCRUED +3%"],
              ["1", "2026-05-04", "432.8", "445.784", "9999", "9999"],
              ["2", "2026-05-10", "1000", "1030", "9999", "9999"],
            ],
          },
          orders: { values: [] },
        },
      },
    },
    totalPaid: 500,
    personalOrdersAfterDiscount: 200,
  }, { startDate: "2026-05-01", endDate: "2026-05-21" });

  assert.equal(summary.orders, 1475.784);
  assert.equal(summary.totalOrdersPlusPercent, 1475.784);
  assert.equal(Number(summary.percentToOrders.toFixed(4)), 42.984);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1175.784);
  assert.doesNotMatch(summary.diagnostics.join("\n"), /source not found for orders|source not found for percentToOrders/);
  resetBalanceModule();
});

test("default summary reads app state table instead of falling back to top metrics", () => {
  resetBalanceModule();
  global.state = {
    data: {
      tabs: {
        movement: {
          values: [
            ["NUMBER", "DATE", "OCCURRED", "OCCURRED +3%"],
            ["1", "2026-05-04", "100", "103"],
          ],
        },
        orders: { values: [] },
      },
    },
  };
  global.elements = { startDate: { value: "2026-05-01" }, endDate: { value: "2026-05-21" } };
  global.buildTopMetricsSummary = () => ({ totalOrders: 9999, totalPaid: 0, personalOrdersAfterDiscount: 0 });

  const api = require("../balance-summary-popup.js");
  const summary = api.buildBalanceTextSummary();

  assert.equal(summary.orders, 103);
  assert.equal(summary.totalOrdersPlusPercent, 103);
  assert.equal(summary.percentToOrders, 3);
  assert.doesNotMatch(summary.diagnostics.join("\n"), /source not found for orders/);
  resetBalanceModule();
});

test("selected period excludes outside occurred rows", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "OCCURRED", "OCCURRED +3%"],
              ["1", "2026-04-30", "1000", "1030"],
              ["2", "2026-05-10", "1000", "1030"],
            ],
          },
          orders: { values: [] },
        },
      },
    },
    totalPaid: 500,
    personalOrdersAfterDiscount: 200,
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(summary.orders, 1030);
  assert.equal(summary.percentToOrders, 30);
  assert.equal(summary.totalOrdersPlusPercent, 1030);
  assert.equal(summary.remainingToPay, 730);
  resetBalanceModule();
});

test("legacy accrued columns still work as fallback", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "ACCRUED", "ACCRUED +3%"],
              ["1", "2026-05-04", "400", "412"],
              ["2", "2026-05-10", "600", "618"],
            ],
          },
          orders: { values: [] },
        },
      },
    },
    totalPaid: 0,
    personalOrdersAfterDiscount: 0,
  }, { startDate: "2026-05-01", endDate: "2026-05-21" });

  assert.equal(summary.orders, 1030);
  assert.equal(summary.totalOrdersPlusPercent, 1030);
  assert.equal(summary.percentToOrders, 30);
  resetBalanceModule();
});

test("top metric fallback treats totalOrders as accrued plus percent", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({ totalOrders: 2047.8, totalPaid: 965.7039, personalOrdersAfterDiscount: 647.5 });

  assert.equal(Number(summary.orders.toFixed(4)), 2047.8);
  assert.equal(Number(summary.percentToOrders.toFixed(4)), 61.434);
  assert.equal(Number(summary.totalOrdersPlusPercent.toFixed(4)), 2047.8);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 2047.8);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1082.0961);
  resetBalanceModule();
});

test("percent rate renders as percent label, not monetary percent amount", () => {
  const api = loadApi();
  const items = [];
  const doc = {
    createElement(tag) {
      const node = {
        tag,
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
  api.renderBalanceSummaryBlock({
    orders: 1400.3,
    percentRate: 3,
    totalOrdersPlusPercent: 1400.3,
    myOrders: 647.5,
    myOrdersPayable: 647.5,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    remainingToPay: 1082.0961,
    diagnostics: [],
  }, doc);

  assert.match(items.join("\n"), /Процент к заказам: 3%/);
  assert.doesNotMatch(items.join("\n"), /63,2632/);
  resetBalanceModule();
});

test("zero orders with plus column returns zero percent amount instead of NaN", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: { data: { tabs: { movement: { values: [["NUMBER", "DATE", "OCCURED", "OCCURED +3%"], ["1", "2026-05-04", "0", "0"]] }, orders: { values: [] } } } },
    totalPaid: 0,
    personalOrdersAfterDiscount: 0,
  }, { startDate: "2026-05-01", endDate: "2026-05-21" });

  assert.equal(Number.isNaN(summary.percentToOrders), false);
  assert.equal(summary.percentToOrders, 0);
  resetBalanceModule();
});
