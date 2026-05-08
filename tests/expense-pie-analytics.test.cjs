const assert = require("node:assert/strict");
const test = require("node:test");

global.state = {
  expenseAccounting: { expensePieMode: "direction" },
  aggregatedManualRange: { transferRows: [] },
  manualTransfers: { data: { transferRows: [] } },
  manualFinance: { data: { transferRows: [] } },
  data: { tabs: { movement: { values: [] } } }
};
global.MANUAL_FINANCE_TOTAL_LABEL = "Итого";
global.MANUAL_EXPENSE_ACCOUNTING_CATEGORIES = ["business", "flat", "food", "fun", "travel", "study", "exchange"];
global.buildManualFinanceUsdRateLookup = () => ({ byCurrency: { USD: 1, RUB: 0.01 }, byChannel: {} });
global.getManualFinanceFieldUsdNumber = (row, key, rateLookup) => {
  const amount = Number(row[key] || 0);
  if (!amount) return 0;
  const channel = String(row.channel || "");
  const rate = /руб/i.test(channel) ? rateLookup.byCurrency.RUB : 1;
  return amount * rate;
};

const analytics = require("../expense-pie-analytics.js");

test("builds direction segments from manual rows using USD conversion helpers", () => {
  const result = analytics.buildExpensePieSegments({
    mode: "direction",
    manualRows: [
      { channel: "PayPal USD", business: 100, flat: 20, food: 0, fun: 0, travel: 0, study: 0, exchange: 5 },
      { channel: "Яндекс руб", business: 1000, flat: 0, food: 500, fun: 0, travel: 0, study: 0, exchange: 0 },
      { channel: "Итого", business: 9999, flat: 9999 }
    ],
    usdRateLookup: global.buildManualFinanceUsdRateLookup()
  });

  assert.equal(result.mode, "direction");
  assert.equal(result.total, 140);
  assert.deepEqual(
    result.segments.map((segment) => [segment.label, segment.value]),
    [["business", 110], ["flat", 20], ["food", 5], ["exchange", 5]]
  );
});

test("builds channel segments and supports house/travel aliases", () => {
  const result = analytics.buildExpensePieSegments({
    mode: "channel",
    manualRows: [
      { channel: "Mono USD", business: 10, house: 15, food: 0, fun: 0, travelFun: 25, study: 0, exchange: 0 },
      { channel: "Wise USD", business: 5, flat: 5, food: 5, fun: 0, travel: 0, study: 0, exchange: 0 }
    ],
    usdRateLookup: global.buildManualFinanceUsdRateLookup()
  });

  assert.equal(result.mode, "channel");
  assert.equal(result.total, 65);
  assert.deepEqual(
    result.segments.map((segment) => [segment.label, segment.value]),
    [["Mono USD", 50], ["Wise USD", 15]]
  );
});
