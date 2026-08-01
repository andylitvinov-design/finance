const test = require("node:test");
const assert = require("node:assert/strict");

const helper = require("../ledger-dashboard-helper.js");

function buildRows() {
  return [
    {
      date: "2026-04-01",
      operation: "income",
      source: "wise",
      to_channel: "трансервайз дол",
      currency: "USD",
      amount_usd: "100",
      amount_net: "100",
      amount_gross: "100",
      raw_source_id: "wise:income-1",
    },
    {
      date: "2026-04-02",
      operation: "business_expense",
      source: "wise",
      from_channel: "трансервайз дол",
      currency: "USD",
      amount_usd: "25",
      amount_net: "25",
      category: "business",
      raw_source_id: "wise:expense-1",
    },
    {
      date: "2026-04-03",
      operation: "income",
      source: "paypal",
      to_channel: "пейпал дол",
      currency: "USD",
      amount_usd: "50",
      amount_net: "",
      amount_gross: "50",
      raw_source_id: "paypal:missing-fee",
    },
    {
      date: "2026-04-04",
      operation: "business_expense",
      source: "csv_import",
      from_channel: "монобанк грн",
      currency: "USD",
      amount_usd: "0",
      amount_net: "0",
      category: "travel",
      raw_source_id: "csv_import:zero-expense",
    },
    {
      date: "2026-04-05",
      operation: "income",
      source: "unknown",
      to_channel: "трансервайз дол",
      currency: "USD",
      amount_usd: "10",
      amount_net: "10",
      raw_source_id: "unknown:income-1",
    },
    {
      date: "2026-04-06",
      operation: "exchange_out",
      source: "provider",
      from_channel: "пейпал дол",
      currency: "USD",
      amount_usd: "40",
      amount_net: "40",
      raw_source_id: "provider:exchange-out",
    },
    {
      date: "2026-04-06",
      operation: "exchange_in",
      source: "mcp",
      to_channel: "трансервайз дол",
      currency: "USD",
      amount_usd: "35",
      amount_net: "35",
      raw_source_id: "mcp:exchange-in",
    },
  ];
}

test("Provider Health counts Wise income and expense from Ledger rows", () => {
  const model = helper.buildLedgerDashboardModel(buildRows());
  const wise = model.providerHealthRows.find((row) => row.provider === "wise");
  assert.equal(wise.rows, 2);
  assert.equal(wise.income, 100);
  assert.equal(wise.expenses, 25);
  assert.equal(wise.net, 75);
});

test("Provider Health shows PayPal missing fee warning without inventing net", () => {
  const model = helper.buildLedgerDashboardModel(buildRows());
  const paypal = model.providerHealthRows.find((row) => row.provider === "paypal");
  assert.match(paypal.warnings, /PayPal missing fee/);
  assert.equal(paypal.fees, 0);
  assert.equal(paypal.income, 50);
});

test("unknown source row appears in warnings", () => {
  const model = helper.buildLedgerDashboardModel(buildRows());
  const unknown = model.warningsRows.find((row) => row.warning === "unknown source rows");
  assert.equal(unknown.count, 1);
  assert.equal(unknown.status, "CHECK");
});

test("amount_usd zero is explicit and not counted as missing", () => {
  const zeroRow = buildRows().find((row) => row.raw_source_id === "csv_import:zero-expense");
  assert.equal(helper.hasLedgerValue(zeroRow, "amountUsd", "amount_usd"), true);
  assert.equal(helper.getLedgerDashboardAmountUsd(zeroRow), 0);
  const model = helper.buildLedgerDashboardModel([zeroRow]);
  const missingAmountUsd = model.warningsRows.find((row) => row.warning === "missing amount_usd");
  assert.equal(missingAmountUsd.count, 0);
});

test("Expense Categories include provider and import expenses", () => {
  const model = helper.buildLedgerDashboardModel(buildRows());
  const business = model.expenseCategoryRows.find((row) => row.category === "business");
  const travel = model.expenseCategoryRows.find((row) => row.category === "travel");
  assert.equal(business.amountUsd, 25);
  assert.equal(travel.amountUsd, 0);
});

test("Exchange Control detects imbalance", () => {
  const model = helper.buildLedgerDashboardModel(buildRows());
  const exchange = model.exchangeControlRows[0];
  assert.equal(exchange.exchangeOut, 40);
  assert.equal(exchange.exchangeIn, 35);
  assert.equal(exchange.difference, -5);
  assert.equal(exchange.warning, "exchange imbalance");
  assert.equal(model.warningsRows.find((row) => row.warning === "exchange imbalance").count, 1);
});

test("mcp and provider sources stay explicit instead of becoming Manual", () => {
  const model = helper.buildLedgerDashboardModel(buildRows());
  assert.ok(model.providerHealthRows.some((row) => row.provider === "mcp"));
  assert.ok(model.providerHealthRows.some((row) => row.provider === "provider"));
});
