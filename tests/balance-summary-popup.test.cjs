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

test("balance summary uses myOrders as already payable and does not apply another discount", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    orders: 1000,
    percentToOrders: 100,
    myOrders: 200,
    paid: 500,
  });

  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.seventyPercent, 770);
  assert.equal(summary.myOrders, 200);
  assert.equal(summary.myOrdersPayable, 200);
  assert.equal(summary.totalAccrued, 970);
  assert.equal(summary.remainingToPay, 470);
  resetBalanceModule();
});

test("missing myOrders source emits diagnostic and never NaN", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({ orders: 1000, percentToOrders: 100, paid: 500 });

  assert.equal(Number.isNaN(summary.myOrders), false);
  assert.equal(summary.myOrders, 0);
  assert.match(summary.diagnostics.join("\n"), /needs verification: source not found for myOrders/);
  resetBalanceModule();
});

test("selected period uses ACCRUED as base and ACCRUED plus percent as total", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary(
    {
      state: {
        data: {
          tabs: {
            movement: {
              values: [
                ["NUMBER", "DATE", "ACCRUED", "ACCRUED +3%"],
                ["1", "2026-04-30", "1000", "1100"],
                ["2", "2026-05-10", "1000", "1100"],
              ],
            },
            orders: { values: [] },
          },
        },
      },
      totalPaid: 500,
      personalOrdersAfterDiscount: 200,
    },
    { startDate: "2026-05-01", endDate: "2026-05-31" }
  );

  assert.equal(summary.orders, 1000);
  assert.equal(summary.percentToOrders, 100);
  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.totalPaid, 500);
  assert.equal(summary.remainingToPay, 470);
  resetBalanceModule();
});

test("top metrics fallback treats totalOrders as ACCRUED plus percent and derives non-zero percent", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    totalOrders: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
  });

  assert.equal(Number(summary.totalOrdersPlusPercent.toFixed(4)), 2047.8);
  assert.equal(Number(summary.orders.toFixed(4)), 1988.1553);
  assert.equal(Number(summary.percentToOrders.toFixed(4)), 59.6447);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1115.2561);
  resetBalanceModule();
});