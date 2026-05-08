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

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
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

function roundTo4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

test("top analytics upgrade formula keeps payout total but uses owner share for profit", () => {
  const context = { parseLooseNumber };
  vm.createContext(context);
  vm.runInContext(`${extractFunction(financeJs, "buildAnalyticsUpgradeTotals")}\nthis.buildAnalyticsUpgradeTotals = buildAnalyticsUpgradeTotals;`, context);

  assert.deepEqual(plain(context.buildAnalyticsUpgradeTotals({
    totalOrdersSeventyPct: "70",
    ownerOrderShare30Pct: "30",
    totalPaid: "-25",
    realIncomeTotal: "40",
    myServicesTotal: "15",
    myCostsTotal: "12"
  })), {
    totalOrdersSeventyPct: 70,
    ownerOrderShare30Pct: 30,
    rawTotal: 60,
    total: -60,
    realIncomeTotal: 40,
    incomeForProfit: 45,
    profit: 33
  });
});

test("top metrics profit uses selected-period owner order share, not provider real income", () => {
  const context = {
    parseLooseNumber,
    getMovementTotalsFromTable: () => ({
      accruedTotal: 1000,
      seventyTotal: 700,
      receivedUsdTotal: 468.65,
      balanceTotal: -205.9943
    }),
    getMovementSummaryMetric: () => 0,
    buildOrdersSummaryFromClient: () => ({
      totalAccruedPlus3Pct: 0,
      totalReceivedUsd: 0,
      totalBalanceUsd: 0
    }),
    calculateCurrentOverallPayoutUsdTotal: () => 0,
    getCurrentFactMetricTotals: () => ({ myServices: 0, myCosts: 2393.2409 }),
    state: {
      data: {
        realIncome: {
          summaryByChannel: {
            paypal: { realNetUsd: 113.87 },
            wise: { realNetUsd: 206 }
          }
        },
        tabs: {
          movement: { values: [], summaryRows: [] },
          orders: { values: [] }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "getProviderRealIncomeUsdForProfit")}\n` +
    `${extractFunction(financeJs, "getRealIncomeUsdForProfit")}\n` +
    `${extractFunction(financeJs, "buildAnalyticsUpgradeTotals")}\n` +
    `${extractFunction(financeJs, "buildTopMetricsSummary")}\n` +
    "this.buildTopMetricsSummary = buildTopMetricsSummary;",
    context
  );

  const metrics = context.buildTopMetricsSummary();

  assert.equal(metrics.totalOrders, 1000);
  assert.equal(metrics.balance, -205.9943);
  assert.equal(metrics.total, -700);
  assert.equal(roundTo4(metrics.ownerOrderShare30Pct), 300);
  assert.equal(roundTo4(metrics.profit), -2093.2409);
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
  assert.match(uiJs, /renderResponsiveDataView\(sectionRows, \{ mobileTableColumnCount: 2 \}\)/);
  assert.match(uiJs, /truncateTableValues\(values, mobileTableColumnCount\)/);
  assert.match(styleCss, /\.mobile-table table \{ min-width: unset; width: 100%; \}/);
});

test("analytics renderer can rebuild visible sections from aggregated manual rows", () => {
  assert.match(uiJs, /function getAggregatedManualAnalyticsSections\(sourceValues\)/);
  assert.match(uiJs, /buildFullRangeBasedAnalyticsValuesFromClosedFact/);
  assert.match(uiJs, /const aggregateSections = getAggregatedManualAnalyticsSections\(values\)/);
  assert.match(uiJs, /function findAggregatedManualAnalyticsSection\(section, aggregateSections = \[\]\)/);
  assert.match(uiJs, /getAnalyticsSectionRenderRows\(section, aggregateSections\)/);
});

test("analytics UI shows explicit authorization warning instead of misleading Plan and Balance zeros", () => {
  assert.match(uiJs, /function getManualOverlayUnavailableMessage\(\)/);
  assert.match(uiJs, /Plan \/ Balance \/ Fact требуют авторизацию или server-side manual overlay/);
  assert.match(uiJs, /shouldShowManualOverlayWarningInsteadOfSection\(section\.title\)/);
  assert.match(uiJs, /warning\.textContent = manualOverlayWarning/);
});

test("analytics UI keeps Movement summary and personal ledger table under different display titles", () => {
  const context = {
    normalizeCell,
    findHeaderIndexByAliases(header, aliases) {
      return header.findIndex((cell) => aliases.some((alias) => normalizeCell(cell) === normalizeCell(alias)));
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "isAnalyticsPersonalSection")}\n` +
    `${extractFunction(uiJs, "getAnalyticsSectionDisplayTitle")}\n` +
    "this.isAnalyticsPersonalSection = isAnalyticsPersonalSection;\n" +
    "this.getAnalyticsSectionDisplayTitle = getAnalyticsSectionDisplayTitle;",
    context
  );

  const movementSummarySection = {
    title: "движение 1",
    rows: [[
      "канал переводов",
      "план = ACCRUED",
      "план плюс процент начислено = ACCRUED +3%",
      "70% OF +3%",
      "ДОШЛО ДО НАС USD",
      "BALANCE"
    ]]
  };
  const personalSection = {
    title: "Личные расходы",
    rows: [[
      "валюта",
      "now",
      "приход от услуг",
      "spent for business",
      "spent for flat",
      "spent for food",
      "spent for fun",
      "spent for study",
      "spent for travel",
      "затраты-мои",
      "обмен",
      "обмен_usd",
      "затраты-мои usd",
      "now_usd"
    ]]
  };

  assert.equal(context.isAnalyticsPersonalSection(movementSummarySection), false);
  assert.equal(context.isAnalyticsPersonalSection(personalSection), true);
  assert.equal(context.getAnalyticsSectionDisplayTitle(movementSummarySection), "Сверка Movement по каналам");
  assert.equal(context.getAnalyticsSectionDisplayTitle(personalSection), "Движение 1");
});

test("analytics manual row fallback selects personal ledger section instead of the first analytics section", () => {
  const context = {
    state: {
      aggregatedManualRange: null,
      manualFinance: { data: {} },
      analyticsFact: {}
    },
    getAnalyticsMergedValues() {
      return [["ignored"]];
    },
    splitAnalyticsSections() {
      return [
        {
          title: "Сверка Movement по каналам",
          rows: [[
            "канал переводов",
            "план = ACCRUED",
            "план плюс процент начислено = ACCRUED +3%",
            "70% OF +3%",
            "ДОШЛО ДО НАС USD",
            "BALANCE"
          ], ["paypal", "1", "2", "3", "4", "5"]]
        },
        {
          title: "Личные расходы",
          rows: [[
            "валюта",
            "now",
            "приход от услуг",
            "spent for business",
            "spent for flat",
            "spent for food",
            "spent for fun",
            "spent for study",
            "spent for travel",
            "затраты-мои",
            "обмен",
            "обмен_usd",
            "затраты-мои usd",
            "now_usd"
          ], ["Яндекс руб", "139786", "200", "11287", "", "", "", "", "", "11287", "-74669", "-883", "133", "1653"]]
        }
      ];
    },
    extractAnalyticsTopTables(values) {
      return values;
    },
    findHeaderIndexByAliases(header, aliases) {
      return header.findIndex((cell) => aliases.some((alias) => normalizeCell(cell) === normalizeCell(alias)));
    },
    hasAnyValue(row) {
      return (row || []).some((cell) => String(cell || "").trim());
    },
    normalizeCell
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "isAnalyticsPersonalSection")}\n` +
    `${extractFunction(financeJs, "getAnalyticsPersonalSection")}\n` +
    `${extractFunction(uiJs, "getCurrentAnalyticsManualRows")}\n` +
    "this.getCurrentAnalyticsManualRows = getCurrentAnalyticsManualRows;",
    context
  );

  assert.deepEqual(plain(context.getCurrentAnalyticsManualRows()), [{
    channel: "Яндекс руб",
    now: "139786",
    serviceIncome: "200",
    business: "11287",
    flat: "",
    food: "",
    fun: "",
    study: "",
    travel: "",
    total: "11287",
    exchange: "-74669",
    exchangeUsd: "-883",
    totalUsd: "133",
    nowUsd: "1653"
  }]);
});

test("fact metrics use the same personal ledger rows for my services and my costs", () => {
  const context = {
    elements: { endDate: { value: "2026-04-30" } },
    state: { data: { tabs: { movement: { values: [] } } }, analyticsFact: { periodEnd: "2026-04-30" } },
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    parseLooseNumber,
    getCurrentAnalyticsManualRows() {
      return [
        { channel: "Яндекс руб", serviceIncome: "200", business: "11287", flat: "", food: "", fun: "", study: "", travel: "" },
        { channel: "пейпал евр", serviceIncome: "300", business: "", flat: "239", food: "", fun: "", study: "", travel: "780" },
        { channel: "Итого", serviceIncome: "500", business: "11287", flat: "239", food: "", fun: "", study: "", travel: "780" }
      ];
    },
    getCurrentFactMetricTransfers() {
      return [];
    },
    buildManualFinanceUsdRateLookup() {
      return {};
    },
    getManualFinanceFieldUsdNumber(row, key) {
      return parseLooseNumber(row?.[key]);
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "getCurrentFactMetricTotals")}\n` +
    "this.getCurrentFactMetricTotals = getCurrentFactMetricTotals;",
    context
  );

  assert.deepEqual(plain(context.getCurrentFactMetricTotals()), {
    myServices: 500,
    myCosts: 12306
  });
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

test("manual finance rate display includes CAD row", () => {
  const context = {
    parseLooseNumber,
    MANUAL_FINANCE_FALLBACK_USD_RATES: {
      RUB: 1 / 84.5563,
      UAH: 1 / 43.86,
      EUR: 1.16,
      CAD: 0.74,
      LOCAL: 1 / 18,
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "getLocalPerUsdRate")}\n` +
    `${extractFunction(financeJs, "getManualFinanceDisplayRates")}\n` +
    "this.getManualFinanceDisplayRates = getManualFinanceDisplayRates;",
    context
  );

  const rows = plain(context.getManualFinanceDisplayRates({
    byCurrency: { CAD: 0.8 }
  }));
  assert.deepEqual(rows[3], {
    label: "канадский доллар",
    currency: "CAD",
    rate: 1.25
  });
});
