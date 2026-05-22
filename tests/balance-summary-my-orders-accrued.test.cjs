const test = require("node:test");
const assert = require("node:assert/strict");

function loadApi() {
  delete require.cache[require.resolve("../balance-summary-popup.js")];
  delete global.document;
  delete global.state;
  delete global.elements;
  delete global.buildTopMetricsSummary;
  return require("../balance-summary-popup.js");
}

test("balance popup does not discount myOrders twice", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    orders: 1000,
    percentToOrders: 100,
    myOrders: 200,
    paid: 500,
  });
  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.seventyPercent, 770);
  assert.equal(summary.myOrdersPayable, 200);
  assert.equal(summary.totalAccrued, 970);
  assert.equal(summary.remainingToPay, 470);
});

test("balance popup uses ACCRUED as base and ACCRUED plus percent as total", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
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
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });
  assert.equal(summary.orders, 1000);
  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.percentToOrders, 100);
  assert.equal(summary.remainingToPay, 470);
});

test("top metric fallback treats totalOrders as ACCRUED base and derives non-zero percent", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    totalOrders: 2047.8,
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
  });
  assert.equal(Number(summary.orders.toFixed(4)), 2047.8);
  assert.equal(Number(summary.percentToOrders.toFixed(4)), 61.434);
  assert.equal(Number(summary.totalOrdersPlusPercent.toFixed(4)), 2109.234);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1158.2599);
});