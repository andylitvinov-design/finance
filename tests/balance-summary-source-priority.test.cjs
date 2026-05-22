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

test("balance summary uses movement totals instead of adding orders totals", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "ACCRUED", "ACCRUED +3%"],
              ["1", "2026-05-04", "1360", "1400.3"],
            ],
          },
          orders: {
            values: [
              ["DATE", "ACCRUED", "ACCRUED +3%"],
              ["2026-05-04", "647.5", "667"],
            ],
          },
        },
      },
    },
    totalPaid: 965.7039,
    personalOrdersAfterDiscount: 647.5,
  }, { startDate: "2026-05-01", endDate: "2026-05-22" });

  assert.equal(summary.orders, 1360);
  assert.equal(summary.totalOrdersPlusPercent, 1400.3);
  assert.equal(Number(summary.percentToOrders.toFixed(4)), 40.3);
  assert.equal(Number(summary.percentRate.toFixed(4)), 2.9632);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 1627.71);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 662.0061);
});

test("balance summary exposes percent rate separately from percent amount", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({ orders: 1000, percentToOrders: 30, myOrders: 200, paid: 500 });

  assert.equal(summary.percentToOrders, 30);
  assert.equal(summary.percentRate, 3);
  assert.equal(summary.totalOrdersPlusPercent, 1030);
  assert.equal(summary.remainingToPay, 421);
});