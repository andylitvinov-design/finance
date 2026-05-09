const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "expense-analysis-period-fix.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("expense analysis period guard is loaded after ui.js and before main.js", () => {
  assert.ok(indexHtml.indexOf("./ui.js") < indexHtml.indexOf("./expense-analysis-period-fix.js"));
  assert.ok(indexHtml.indexOf("./expense-analysis-period-fix.js") < indexHtml.indexOf("./main.js"));
});

test("expense analysis period guard filters out-of-range provider expense rows", () => {
  const seenRows = [];
  const context = {
    window: {
      buildLedgerProviderExpenseByChannel(rows) {
        seenRows.push(...rows);
        return Object.fromEntries(rows.map((row) => [row.id, row.amountUsd]));
      },
    },
    document: {
      getElementById(id) {
        return { value: id === "startDate" ? "2026-05-01" : "2026-05-05" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  const result = context.window.buildLedgerProviderExpenseByChannel([
    { id: "before", date: "2026-04-30", amountUsd: 2247.3385, source: "yoomoney", fromChannel: "Яндекс руб" },
    { id: "inside", date: "2026-05-03", amountUsd: 884.2807, source: "yoomoney", fromChannel: "Яндекс руб" },
    { id: "after", date: "2026-05-06", amountUsd: 25, source: "yoomoney", fromChannel: "Яндекс руб" },
  ], {}, {});

  assert.deepEqual(Object.keys(result), ["inside"]);
  assert.deepEqual(seenRows.map((row) => row.id), ["inside"]);
});

test("expense analysis period guard filters out-of-range real income rows", () => {
  const seenRows = [];
  const context = {
    window: {
      buildLedgerRealIncomeSummaryByChannel(rows) {
        seenRows.push(...rows);
        return Object.fromEntries(rows.map((row) => [row.id, row.amountUsd]));
      },
      buildLedgerProviderExpenseByChannel(rows) {
        return rows;
      },
    },
    document: {
      getElementById(id) {
        return { value: id === "startDate" ? "2026-05-01" : "2026-05-05" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  const result = context.window.buildLedgerRealIncomeSummaryByChannel([
    { id: "wise-before", date: "2026-04-30", amountUsd: 206, source: "wise", toChannel: "трансервайз дол" },
    { id: "wise-inside", date: "2026-05-03", amountUsd: 113.87, source: "wise", toChannel: "трансервайз дол" },
    { id: "wise-after", date: "2026-05-06", amountUsd: 25, source: "wise", toChannel: "трансервайз дол" },
  ], {}, {});

  assert.deepEqual(Object.keys(result), ["wise-inside"]);
  assert.deepEqual(seenRows.map((row) => row.id), ["wise-inside"]);
});

test("expense analysis period guard prefers explicit options over DOM dates for income and expense", () => {
  const context = {
    window: {
      buildLedgerProviderExpenseByChannel(rows) {
        return rows.map((row) => row.id);
      },
      buildLedgerRealIncomeSummaryByChannel(rows) {
        return rows.map((row) => row.id);
      },
    },
    document: {
      getElementById() {
        return { value: "2026-05-01" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  const rows = [
    { id: "dom-period", date: "2026-05-01" },
    { id: "explicit-period", date: "2026-04-30" },
  ];
  const options = { startDate: "2026-04-29", endDate: "2026-04-30" };

  assert.deepEqual(context.window.buildLedgerProviderExpenseByChannel(rows, {}, options), ["explicit-period"]);
  assert.deepEqual(context.window.buildLedgerRealIncomeSummaryByChannel(rows, {}, options), ["explicit-period"]);
});

test("expense analysis period guard exposes helper and supports alternate date fields", () => {
  const context = {
    window: {
      buildLedgerProviderExpenseByChannel(rows) {
        return rows.map((row) => row.id);
      },
      buildLedgerRealIncomeSummaryByChannel(rows) {
        return rows.map((row) => row.id);
      },
    },
    document: {
      getElementById(id) {
        return { value: id === "startDate" ? "2026-05-01" : "2026-05-05" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  assert.deepEqual(context.window.buildLedgerProviderExpenseByChannel([
    { id: "snake", operation_date: "2026-05-02" },
    { id: "posted", posted_date: "2026-05-06" },
  ], {}, {}), ["snake"]);
  assert.equal(typeof context.window.EzohataExpenseAnalysisPeriodFix.scopeRowsToPeriod, "function");
});

test("expense analysis period guard can filter server savings rows by selected period", () => {
  const context = {
    window: {},
    document: {
      getElementById(id) {
        return { value: id === "startDate" ? "2026-05-03" : "2026-05-09" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  const values = [
    ["Переводы"],
    ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
    ["02.05.2026", "old", "100", "USD", "пейпал дол", "1", "100"],
    ["03.05.2026", "start", "10", "USD", "пейпал дол", "1", "10"],
    ["09.05.2026", "end", "20", "USD", "пейпал дол", "1", "20"],
    ["10.05.2026", "future", "200", "USD", "пейпал дол", "1", "200"],
    ["Итого", "", "330", "", "", "", "330"],
  ];

  assert.deepEqual(
    context.window.EzohataExpenseAnalysisPeriodFix.prepareSavingsValuesForSelectedPeriod(values, "2026-05-03", "2026-05-09"),
    [
      ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
      ["03.05.2026", "start", "10", "USD", "пейпал дол", "1", "10"],
      ["09.05.2026", "end", "20", "USD", "пейпал дол", "1", "20"],
    ]
  );
});

test("expense analysis period guard wraps buildPreparedDashboardData savings tab", () => {
  const context = {
    window: {
      buildPreparedDashboardData(data) {
        return {
          tabs: {
            savings: { values: data.tabs.savings.values, sourceType: "server" },
            movement: { values: [] },
          },
        };
      },
    },
    document: {
      getElementById(id) {
        return { value: id === "startDate" ? "2026-05-03" : "2026-05-09" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  const installed = context.window.EzohataExpenseAnalysisPeriodFix.installMainDashboardPeriodGuards();
  assert.equal(installed.buildPreparedDashboardData, true);

  const prepared = context.window.buildPreparedDashboardData({
    tabs: {
      savings: {
        values: [
          ["дата перевода", "кто", "сумма"],
          ["2026-05-02", "old", "100"],
          ["2026-05-04", "inside", "10"],
          ["2026-05-10", "future", "200"],
        ],
      },
    },
  }, "2026-05-03", "2026-05-09");

  assert.equal(prepared.tabs.savings.periodScoped, true);
  assert.deepEqual(prepared.tabs.savings.values, [
    ["дата перевода", "кто", "сумма"],
    ["2026-05-04", "inside", "10"],
  ]);
});
