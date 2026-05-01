const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");

function extractFunction(source, name) {
  let start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`${name} was not found`);
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

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase();
}

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

function hasAnyValue(row) {
  return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
}

function findHeaderIndexByAliases(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}

function splitAnalyticsSections(values) {
  const sections = [];
  let index = 0;
  while (index < values.length) {
    const title = String(values[index]?.[0] || "").trim();
    if (!title) {
      index += 1;
      continue;
    }
    const header = values[index + 1] || [];
    const rows = [];
    let cursor = index + 2;
    while (cursor < values.length && hasAnyValue(values[cursor])) {
      rows.push(values[cursor]);
      cursor += 1;
    }
    if (header.length) sections.push({ title, rows: [header, ...rows] });
    index = cursor + 1;
  }
  return sections;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createContext() {
  const context = {
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_FINANCE_MONEY_CHANNELS: ["Яндекс руб", "пейпал дол"],
    MANUAL_FINANCE_HEADERS: ["канал", "now", "приход от услуг"],
    MANUAL_TRANSFER_HEADERS: [],
    ANALYTICS_PAYMENT_RULES: {},
    ANALYTICS_PAYOUTS_HELPER: {
      buildTransferPayoutRowsWithUsd: () => [],
      buildMovementPaymentSummaryRows: () => ([
        ["Яндекс руб", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000"],
        ["пейпал дол", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000"],
      ]),
      mapAnalyticsTopRows(rows) {
        return rows.map((row) => [
          row.channel || "",
          row.now || "",
          row.serviceIncome || "",
          row.business || "",
          row.flat || "",
          row.food || "",
          row.fun || "",
          row.study || "",
          row.travel || "",
          row.total || "",
          row.exchange || "",
          row.exchangeUsd || "",
          row.totalUsd || "",
          row.nowUsd || "",
        ]);
      },
    },
    clone2dArray(values) {
      return (values || []).map((row) => (row || []).slice());
    },
    normalizeCell,
    parseLooseNumber,
    formatSheetNumber,
    findHeaderIndexByAliases,
    hasAnyValue,
    splitAnalyticsSections,
    extractAnalyticsTopTables(values) {
      return values;
    },
    calculateMovementChannelStats() {
      return {
        localByChannel: {},
        usdByChannel: {},
        accruedPlusByChannel: {},
        localByCurrency: {},
        balanceByChannel: {},
      };
    },
    calculatePayoutChannelStats() {
      return {};
    },
    buildCommissionUsdLookup() {
      return {};
    },
    buildManualFinanceUsdRateLookup() {
      return {};
    },
    buildLatestNowUsdLookup() {
      return {};
    },
    buildManualTotalLookup(rows) {
      return Object.fromEntries((rows || []).map((row) => [row.channel, parseLooseNumber(row.total)]));
    },
    buildManualTotalUsdLookup(rows) {
      return Object.fromEntries((rows || []).map((row) => [row.channel, parseLooseNumber(row.totalUsd || row.total)]));
    },
    buildManualServiceIncomeLookup(rows) {
      return Object.fromEntries((rows || []).map((row) => [row.channel, parseLooseNumber(row.serviceIncome)]));
    },
    buildManualExchangeLookup(rows) {
      return Object.fromEntries((rows || []).map((row) => [row.channel, parseLooseNumber(row.exchange)]));
    },
    buildManualExchangeUsdLookup(rows) {
      return Object.fromEntries((rows || []).map((row) => [row.channel, parseLooseNumber(row.exchangeUsd || row.exchange)]));
    },
    buildManualNowLookup(rows) {
      return Object.fromEntries((rows || []).map((row) => [row.channel, parseLooseNumber(row.nowUsd || row.now)]));
    },
    buildAnalyticsNowUsdLookup() {
      return {};
    },
    buildSavingsLookup() {
      return {};
    },
    sumChannelStat() {
      return 0;
    },
    getMovementTotalsFromTable() {
      return {
        baseAccruedTotal: 0,
        accruedTotal: 0,
        seventyTotal: 0,
        receivedUsdTotal: 0,
        balanceTotal: 0,
      };
    },
    inferManualFinanceChannelCurrency(channel) {
      return /руб/i.test(String(channel || "")) ? "RUB" : "USD";
    },
    getManualFinanceDisplayHeaders() {
      return [
        "канал",
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
        "now_usd",
      ];
    },
    getManualFinanceTotalUsdValue(row) {
      return row.totalUsd || row.total || "";
    },
    getManualFinanceUsdPerLocalRate() {
      return 1;
    },
    getManualFinanceNowUsdValue(row) {
      return row.nowUsd || row.now || "";
    },
    getManualFinanceExchangeUsdValue(row) {
      return row.exchangeUsd || row.exchange || "";
    },
    buildAnalyticsPeriodUsdSummaryRows() {
      return [
        ["Мои услуги", "500,0000"],
        ["Всего расходов", "100,0000"],
      ];
    },
    formatPlanLocalSummary() {
      return "0,0000";
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "isAnalyticsPersonalSection")}\n` +
    `${extractFunction(financeJs, "getAnalyticsPersonalSection")}\n` +
    `${extractFunction(financeJs, "buildFullRangeBasedAnalyticsValuesFromClosedFact")}\n` +
    `${extractFunction(uiJs, "getAnalyticsSectionDisplayTitle")}\n` +
    "this.buildFullRangeBasedAnalyticsValuesFromClosedFact = buildFullRangeBasedAnalyticsValuesFromClosedFact;\n" +
    "this.getAnalyticsSectionDisplayTitle = getAnalyticsSectionDisplayTitle;",
    context
  );
  return context;
}

test("rebuilt analytics uses aggregated manual rows for the factual movement table", () => {
  const context = createContext();
  const values = plain(context.buildFullRangeBasedAnalyticsValuesFromClosedFact(
    [
      ["движение 1"],
      ["канал переводов", "план = ACCRUED"],
      ["Яндекс руб", "0,0000"],
      [],
      ["Личные расходы"],
      ["канал", "now", "приход от услуг", "spent for business", "spent for flat", "spent for food", "spent for fun", "spent for study", "spent for travel", "затраты-мои", "обмен", "обмен_usd", "затраты-мои usd", "now_usd"],
      ["Яндекс руб", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000"],
    ],
    [],
    [],
    [],
    {
      rows: [
        {
          channel: "Яндекс руб",
          now: "1000,0000",
          serviceIncome: "200,0000",
          business: "50,0000",
          flat: "10,0000",
          food: "0,0000",
          fun: "0,0000",
          study: "0,0000",
          travel: "0,0000",
          total: "60,0000",
          totalUsd: "60,0000",
          exchange: "0,0000",
          exchangeUsd: "0,0000",
          nowUsd: "12,0000",
        },
        {
          channel: "пейпал дол",
          now: "500,0000",
          serviceIncome: "300,0000",
          business: "40,0000",
          flat: "0,0000",
          food: "0,0000",
          fun: "0,0000",
          study: "0,0000",
          travel: "0,0000",
          total: "40,0000",
          totalUsd: "40,0000",
          exchange: "0,0000",
          exchangeUsd: "0,0000",
          nowUsd: "500,0000",
        },
      ],
      transferRows: [],
    }
  ));

  const sections = splitAnalyticsSections(values);
  const personalSection = sections.find((section) => context.getAnalyticsSectionDisplayTitle(section) === "Движение 1");

  assert.ok(personalSection);
  assert.deepEqual(personalSection.rows[1], [
    "Яндекс руб",
    "1000,0000",
    "200,0000",
    "50,0000",
    "10,0000",
    "0,0000",
    "0,0000",
    "0,0000",
    "0,0000",
    "60,0000",
    "0,0000",
    "0,0000",
    "60,0000",
    "12,0000",
  ]);
  assert.deepEqual(personalSection.rows[2], [
    "пейпал дол",
    "500,0000",
    "300,0000",
    "40,0000",
    "0,0000",
    "0,0000",
    "0,0000",
    "0,0000",
    "0,0000",
    "40,0000",
    "0,0000",
    "0,0000",
    "40,0000",
    "500,0000",
  ]);
});

test("analytics UI shows one Движение 1 and renames the stale movement summary", () => {
  const context = createContext();
  const sections = [
    {
      title: "движение 1",
      rows: [["канал переводов", "план = ACCRUED"]],
    },
    {
      title: "Личные расходы",
      rows: [["канал", "now", "приход от услуг", "обмен"]],
    },
  ];

  const displayTitles = sections.map((section) => context.getAnalyticsSectionDisplayTitle(section));

  assert.deepEqual(displayTitles, ["Сверка Movement по каналам", "Движение 1"]);
  assert.equal(displayTitles.filter((title) => title === "Движение 1").length, 1);
});
