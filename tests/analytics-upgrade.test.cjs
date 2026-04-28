const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");
const stateJs = fs.readFileSync(path.join(root, "state.js"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "main.js"), "utf8");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatSheetNumber(value, digits = 4) {
  return Number(value || 0).toFixed(digits).replace(".", ",");
}

function extractFunction(source, name) {
  let start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`${name} was not found`);
  if (source.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const parenStart = source.indexOf("(", start);
  let parenDepth = 0;
  let braceStart = -1;
  for (let index = parenStart; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      braceStart = source.indexOf("{", index);
      break;
    }
  }
  if (braceStart === -1) throw new Error(`${name} body was not found`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body was not closed`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("top analytics upgrade formula inverts accrued, paid, and services", () => {
  const context = { parseLooseNumber };
  vm.createContext(context);
  vm.runInContext(`${extractFunction(financeJs, "buildAnalyticsUpgradeTotals")}\nthis.buildAnalyticsUpgradeTotals = buildAnalyticsUpgradeTotals;`, context);

  assert.deepEqual(plain(context.buildAnalyticsUpgradeTotals({
    totalOrdersSeventyPct: "70",
    totalPaid: "-25",
    myServicesTotal: "15",
    myCostsTotal: "12"
  })), {
    totalOrdersSeventyPct: 70,
    rawTotal: 60,
    total: -60,
    profit: 73
  });
});

test("period USD summary contains required rows and uses the inverted total", () => {
  const context = {
    parseLooseNumber,
    formatSheetNumber,
    sumManualFinanceFieldUsdNumber: () => 15,
    sumManualFinanceSpendUsdNumber: () => 12,
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "buildAnalyticsUpgradeTotals")}\n` +
    `${extractFunction(financeJs, "buildAnalyticsPeriodUsdSummaryRows")}\n` +
    "this.buildAnalyticsPeriodUsdSummaryRows = buildAnalyticsPeriodUsdSummaryRows;",
    context
  );

  assert.deepEqual(plain(context.buildAnalyticsPeriodUsdSummaryRows([], {}, {
    totalOrdersSeventyPct: 70,
    payoutsUsdTotal: -25
  })), [
    ["Мои услуги", "15,0000"],
    ["Начислено (70% от +3%)", "70,0000"],
    ["Выплаты", "-25,0000"],
    ["Итого", "-60,0000"],
    ["Всего расходов", "12,0000"]
  ]);
});

test("metric UI and rendering hooks are wired", () => {
  assert.match(indexHtml, /id="metricMyServices"/);
  assert.match(indexHtml, /id="metricProfit"/);
  assert.match(indexHtml, /id="metricMyCosts"/);
  assert.match(styleCss, /\.metric-sub-btn\.accent/);
  assert.match(styleCss, /\.metric-sub-btn\.profit/);
  assert.match(styleCss, /\.metric-sub-btn\.costs/);
  assert.match(stateJs, /metricMyServices: document\.getElementById\("metricMyServices"\)/);
  assert.match(uiJs, /elements\.metricMyServices\.textContent = "Мои услуги: " \+ formatSheetNumber\(metrics\.myServices, 4\)/);
});

test("analytics balance and period sections use two mobile columns", () => {
  assert.match(uiJs, /normalizeCell\(section\.title\) === normalizeCell\("ИТОГО ЗА ПЕРИОД USD"\)/);
  assert.match(uiJs, /normalizeCell\(section\.title\) === normalizeCell\("БАЛАНС"\)/);
  assert.match(uiJs, /renderResponsiveDataView\(section\.rows, \{ mobileTableColumnCount: 2 \}\)/);
  assert.match(uiJs, /truncateTableValues\(values, mobileTableColumnCount\)/);
  assert.match(styleCss, /\.mobile-table table \{ min-width: unset; width: 100%; \}/);
});

test("balance analytics appends OSTATOK and VSEGO rows", () => {
  assert.match(financeJs, /"ОСТАТОК"[\s\S]*formatSheetNumber\(totalOpeningBalance\)/);
  assert.match(financeJs, /"ВСЕГО"[\s\S]*formatSheetNumber\(totalClosingBalance \+ totalOpeningBalance\)/);
});

test("today button only updates endDate", () => {
  const setTodaySource = extractFunction(mainJs, "setToday");
  assert.match(setTodaySource, /elements\.endDate\.value = today/);
  assert.doesNotMatch(setTodaySource, /elements\.startDate\.value/);
});

test("live CAD rate fetch falls back safely", async () => {
  const context = {
    parseLooseNumber,
    fetch: async () => ({ ok: false }),
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction(mainJs, "fetchLiveCadUsdRate")}\nthis.fetchLiveCadUsdRate = fetchLiveCadUsdRate;`, context);
  assert.equal(await context.fetchLiveCadUsdRate(), null);

  context.fetch = async () => ({ ok: true, json: async () => ({ rates: { CAD: 1.25 } }) });
  assert.equal(await context.fetchLiveCadUsdRate(), 0.8);
});
