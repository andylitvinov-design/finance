const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const contractJs = fs.readFileSync(path.join(root, "manual-ledger-contract.js"), "utf8");
const helperJs = fs.readFileSync(path.join(root, "ledger-analytics-helper.js"), "utf8");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createContext() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(contractJs, context);
  vm.runInContext(helperJs, context);
  return context;
}

test("ledger analytics uses amount_net for balance and profit instead of amount_gross", () => {
  const context = createContext();
  const model = context.EzohataLedgerAnalyticsHelper.buildFinancialModel([
    {
      date: "2026-05-01",
      operation: "income",
      source: "paypal",
      to_channel: "пейпал дол",
      amount: "100",
      currency: "USD",
      amount_usd: "90",
      amount_gross: "100",
      amount_fee: "10",
      amount_net: "90",
      category: "service"
    }
  ]);

  assert.equal(model.totals.grossRevenue, 100);
  assert.equal(model.totals.netRevenue, 90);
  assert.equal(model.totals.netBalance, 90);
  assert.equal(model.totals.profit, 90);
});

test("PayPal gross fee and net are separate and profit uses net", () => {
  const context = createContext();
  const model = context.EzohataLedgerAnalyticsHelper.buildFinancialModel([
    {
      date: "2026-05-01",
      operation: "income",
      source: "paypal",
      to_channel: "пейпал дол",
      amount: "324",
      currency: "USD",
      amount_usd: "311.06",
      amount_gross: "324",
      amount_fee: "12.94",
      amount_net: "311.06",
      category: "service"
    }
  ]);

  assert.deepEqual(plain(model.pnlRows), [
    ["Gross Revenue", 324],
    ["Provider Fees", 12.94],
    ["Net Revenue", 311.06],
    ["Expenses", 0],
    ["Profit", 311.06]
  ]);
  assert.equal(model.providerHealthRows.find((row) => row.provider === "PayPal").fees, 12.94);
});

test("Wise rows appear in real income and expense totals", () => {
  const context = createContext();
  const model = context.EzohataLedgerAnalyticsHelper.buildFinancialModel([
    {
      date: "2026-05-01",
      operation: "income",
      source: "wise",
      to_channel: "трансервайз дол",
      amount: "978.5",
      currency: "USD",
      amount_usd: "978.5",
      amount_gross: "978.5",
      amount_fee: "0",
      amount_net: "978.5",
      category: "service"
    },
    {
      date: "2026-05-02",
      operation: "expense",
      source: "wise",
      from_channel: "трансервайз дол",
      amount: "21.25",
      currency: "USD",
      amount_usd: "21.25",
      amount_gross: "21.25",
      amount_fee: "0",
      amount_net: "21.25",
      category: "business"
    }
  ]);
  const wise = model.providerHealthRows.find((row) => row.provider === "Wise");

  assert.equal(wise.income, 978.5);
  assert.equal(wise.expenses, 21.25);
  assert.equal(model.totals.netRevenue, 978.5);
  assert.equal(model.totals.expenses, 21.25);
});

test("Data Quality includes unknown source and missing amount fields", () => {
  const context = createContext();
  const model = context.EzohataLedgerAnalyticsHelper.buildFinancialModel([
    {
      date: "2026-05-01",
      operation: "income",
      source: "unknown",
      to_channel: "пейпал дол",
      amount: "100",
      currency: "USD",
      amount_gross: "100",
      category: "service"
    }
  ]);
  const warnings = Object.fromEntries(model.warningRows.map((row) => [row.name, row.count]));

  assert.equal(warnings["unknown source"], 1);
  assert.equal(warnings["missing amount_net"], 1);
  assert.equal(warnings["missing amount_usd"], 1);
});

test("exchange rows do not inflate income expense or profit", () => {
  const context = createContext();
  const model = context.EzohataLedgerAnalyticsHelper.buildFinancialModel([
    {
      date: "2026-05-01",
      operation: "exchange_out",
      source: "manual",
      from_channel: "Яндекс руб",
      to_channel: "Бинанс spot",
      amount: "-1000",
      currency: "RUB",
      amount_usd: "-12",
      amount_net: "1000",
      category: "exchange"
    },
    {
      date: "2026-05-01",
      operation: "exchange_in",
      source: "manual",
      from_channel: "Яндекс руб",
      to_channel: "Бинанс spot",
      amount: "11.5",
      currency: "USD",
      amount_usd: "11.5",
      amount_net: "11.5",
      category: "exchange"
    }
  ]);

  assert.equal(model.totals.netRevenue, 0);
  assert.equal(model.totals.expenses, 0);
  assert.equal(model.totals.profit, 0);
  assert.equal(model.exchangeControlRows[0][3], -0.5);
});

test("Plan vs Fact delta and delta percent are calculated from summary", () => {
  const context = createContext();
  const model = context.EzohataLedgerAnalyticsHelper.buildFinancialModel([], {
    planFactSummary: {
      incomeTotals: { plannedUsd: 1000, realUsd: 750 },
      expenseTotals: { plannedUsd: 200, realUsd: 250 }
    }
  });
  const income = model.planVsFactRows.find((row) => row.metric === "Income");
  const expense = model.planVsFactRows.find((row) => row.metric === "Expenses");

  assert.equal(income.delta, 250);
  assert.equal(income.deltaPercent, 25);
  assert.equal(income.status, "CHECK");
  assert.equal(expense.delta, -50);
  assert.equal(expense.deltaPercent, -25);
});

test("strategic analytics UI is wired to normalized Ledger rows instead of stale analytics values", () => {
  assert.match(indexHtml, /ledger-analytics-helper\.js/);
  assert.match(uiJs, /renderLedgerStrategicDashboard/);
  assert.match(uiJs, /getLedgerAnalyticsRawRows/);
  assert.match(uiJs, /state\.data\?\.manual\?\.operations/);
  assert.doesNotMatch(uiJs, /buildFinancialModel\(values/);
});
