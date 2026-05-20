const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const financeJs = fs.readFileSync(path.join(__dirname, "..", "finance.js"), "utf8");
const configJs = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
const mainJs = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

function extractFunction(name) {
  const pattern = new RegExp(`^function ${name}\\(`, "m");
  const match = pattern.exec(financeJs);
  if (!match) throw new Error(`${name} was not found in finance.js`);
  const next = financeJs.slice(match.index + 1).search(/^function [A-Za-z0-9_]+\(/m);
  return next === -1
    ? financeJs.slice(match.index).trim()
    : financeJs.slice(match.index, match.index + 1 + next).trim();
}

const match = [extractFunction("buildLatestNowByChannel")];
const entriesMatch = [extractFunction("buildLatestNowEntriesByChannel")];
const balanceEntriesMatch = [extractFunction("buildLatestBalanceEntriesByChannel")];
const categoryMatch = [extractFunction("normalizeManualExpenseCategory")];
const flowExpenseRowsMatch = [extractFunction("filterManualFlowExpenseRows")];
const movementRateMatch = [extractFunction("buildLatestMovementUsdRateLookup")];
const financeRateMatch = [extractFunction("buildManualFinanceUsdRateLookup")];
const summaryRowsMatch = [extractFunction("buildManualFinanceSummaryRows")];
const usdPerLocalMatch = [extractFunction("getManualFinanceUsdPerLocalRate")];
const nowUsdMatch = [extractFunction("getManualFinanceNowUsdValue")];
const latestNowUsdMatch = [extractFunction("buildLatestNowUsdLookup")];
const aliasMatch = [extractFunction("resolveManualFinanceChannelAlias")];
const canonicalChannelMatch = [extractFunction("canonicalManualFinanceChannel")];
const canonicalKeyMatch = [extractFunction("getCanonicalManualChannelKey")];
const emptyAmountsMatch = [extractFunction("buildEmptyExpenseAmounts")];
const canonicalAmountsMatch = [extractFunction("getCanonicalManualExpenseAmounts")];
const canonicalRawAmountsMatch = [extractFunction("getCanonicalManualExpenseRawAmounts")];
const normalizeLookupTextMatch = [extractFunction("normalizeLookupText")];

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase();
}

function hasAnyValue(row) {
  return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
}

function findHeaderIndexByAliases(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}

function parseDisplayDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`);
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split(".");
    return new Date(`${year}-${month}-${day}T00:00:00Z`);
  }
  return null;
}

function normalizeManualFinanceTransferRows(rows) {
  return (rows || []).map((row) => ({
    transferDate: row?.transferDate ?? row?.date ?? "",
    amount: row?.amount ?? "",
    currency: row?.currency ?? row?.localCurrency ?? "",
    channel: row?.channel ?? row?.destination ?? "",
    usdAmount: row?.usdAmount ?? "",
  }));
}

function inferManualFinanceChannelCurrency(channel) {
  return /руб/i.test(String(channel || "")) ? "RUB" : "USD";
}

function getManualFinanceChannels() {
  return context.MANUAL_FINANCE_MONEY_CHANNELS.slice();
}

function getManualStoredExpenseTypes() {
  return ["now", "serviceIncome", "business", "flat", "food", "fun", "study", "travel", "exchange"];
}

function getManualFinanceComputedAmount(value) {
  return parseLooseNumber(value);
}

function formatSheetNumber(value, digits = 4) {
  return Number(value || 0).toFixed(digits).replace(".", ",");
}

const context = {
  MANUAL_NOW_CATEGORY: "now",
  MANUAL_EXCHANGE_CATEGORY: "exchange",
  MANUAL_FINANCE_TOTAL_LABEL: "Итого",
  MANUAL_FINANCE_MONEY_CHANNELS: ["Яндекс руб", "пейпал дол"],
  MANUAL_FINANCE_FALLBACK_USD_RATES: { RUB: 1 / 84.5563 },
  parseLooseNumber,
  normalizeCell,
  hasAnyValue,
  findHeaderIndexByAliases,
  parseDisplayDate,
  normalizeManualFinanceTransferRows,
  inferManualFinanceChannelCurrency,
  getManualFinanceChannels,
  getManualStoredExpenseTypes,
  getManualFinanceComputedAmount,
  formatSheetNumber,
};
vm.createContext(context);
vm.runInContext(`${normalizeLookupTextMatch[0]}\n${aliasMatch[0]}\n${canonicalChannelMatch[0]}\n${canonicalKeyMatch[0]}\n${emptyAmountsMatch[0]}\n${canonicalAmountsMatch[0]}\n${canonicalRawAmountsMatch[0]}\n${categoryMatch[0]}\n${flowExpenseRowsMatch[0]}\n${entriesMatch[0]}\n${balanceEntriesMatch[0]}\n${match[0]}\n${movementRateMatch[0]}\n${financeRateMatch[0]}\n${summaryRowsMatch[0]}\n${usdPerLocalMatch[0]}\n${nowUsdMatch[0]}\n${latestNowUsdMatch[0]}\nthis.filterManualFlowExpenseRows = filterManualFlowExpenseRows;\nthis.buildLatestNowByChannel = buildLatestNowByChannel;\nthis.buildLatestNowEntriesByChannel = buildLatestNowEntriesByChannel;\nthis.buildLatestBalanceEntriesByChannel = buildLatestBalanceEntriesByChannel;\nthis.buildManualFinanceUsdRateLookup = buildManualFinanceUsdRateLookup;\nthis.buildManualFinanceSummaryRows = buildManualFinanceSummaryRows;\nthis.buildLatestNowUsdLookup = buildLatestNowUsdLookup;`, context);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("buildLatestNowByChannel ignores zero placeholders and keeps previous values by channel", () => {
  const rows = [
    {
      date: "2026-04-24",
      category: "now",
      amounts: { "Яндекс руб": "1000", "пейпал дол": "50" },
    },
    {
      date: "2026-04-25",
      category: "now",
      amounts: { "Яндекс руб": "0", "пейпал дол": "0,0000" },
    },
  ];

  assert.deepEqual(plain(context.buildLatestNowByChannel(rows, "2026-04-25")), {
    "Яндекс руб": "1000",
    "пейпал дол": "50",
  });
});

test("buildLatestNowByChannel uses a newer non-zero value independently per channel", () => {
  const rows = [
    {
      date: "2026-04-24",
      category: "now",
      amounts: { "Яндекс руб": "1000", "пейпал дол": "50" },
    },
    {
      date: "2026-04-25",
      category: "now",
      amounts: { "Яндекс руб": "1200", "пейпал дол": "" },
    },
  ];

  assert.deepEqual(plain(context.buildLatestNowByChannel(rows, "2026-04-25")), {
    "Яндекс руб": "1200",
    "пейпал дол": "50",
  });
  assert.deepEqual(plain(context.buildLatestNowEntriesByChannel(rows, "2026-04-25")), {
    "Яндекс руб": { value: "1200", date: "2026-04-25" },
    "пейпал дол": { value: "50", date: "2026-04-24" },
  });
});

test("buildLatestNowByChannel ignores spent for business when loading closing balance", () => {
  const rows = [
    {
      date: "2026-04-24",
      category: "now",
      amounts: { "Яндекс руб": "1000", "пейпал дол": "50" },
    },
    {
      date: "2026-04-25",
      category: "spent for business",
      amounts: { "Яндекс руб": "9000", "пейпал дол": "700" },
    },
  ];

  assert.deepEqual(plain(context.buildLatestNowByChannel(rows, "2026-04-25")), {
    "Яндекс руб": "1000",
    "пейпал дол": "50",
  });
});

test("buildManualFinanceUsdRateLookup uses the latest movement rate on or before the requested date", () => {
  const values = [
    ["DATE", "RUB RATE"],
    ["2026-04-24", "80"],
    ["2026-04-25", "100"],
  ];

  assert.equal(context.buildManualFinanceUsdRateLookup([], values, { endDate: "2026-04-24" }).byCurrency.RUB, 1 / 80);
  assert.equal(context.buildManualFinanceUsdRateLookup([], values, { endDate: "2026-04-25" }).byCurrency.RUB, 1 / 100);
});

test("buildManualFinanceSummaryRows uses latest now instead of summing now rows", () => {
  const rows = [
    { date: "2026-04-24", category: "now", amounts: { "Яндекс руб": "1000", "пейпал дол": "50" } },
    { date: "2026-04-25", category: "now", amounts: { "Яндекс руб": "1200", "пейпал дол": "" } },
    { date: "2026-04-24", category: "business", amounts: { "Яндекс руб": "10", "пейпал дол": "5" } },
    { date: "2026-04-25", category: "business", amounts: { "Яндекс руб": "20", "пейпал дол": "7" } },
    { date: "2026-04-25", category: "food", amounts: { "Яндекс руб": "3", "пейпал дол": "4" } },
  ];

  const latest = context.buildLatestNowEntriesByChannel(rows, "2026-04-25");
  const summary = context.buildManualFinanceSummaryRows(rows, latest);

  assert.equal(summary[0].channel, "Яндекс руб");
  assert.equal(summary[0].now, "1200,0000");
  assert.equal(summary[0].business, "30,0000");
  assert.equal(summary[0].food, "3,0000");
  assert.equal(summary[0].total, "33,0000");
  assert.equal(summary[1].channel, "пейпал дол");
  assert.equal(summary[1].now, "50,0000");
  assert.equal(summary[1].business, "12,0000");
  assert.equal(summary[1].food, "4,0000");
  assert.equal(summary[1].total, "16,0000");
});

test("buildManualFinanceSummaryRows keeps Binance spot and binance save exchange totals separate", () => {
  const previousChannels = context.MANUAL_FINANCE_MONEY_CHANNELS;
  context.MANUAL_FINANCE_MONEY_CHANNELS = ["Бинанс spot", "binance save"];
  try {
    const rows = [
      { date: "2026-04-24", category: "exchange", amounts: { "Бинанс spot": "874", "binance save": "-950", "бинанс сейв": "-25" } },
      { date: "2026-04-25", category: "exchange", amounts: { "binance spot": "126", "binance save": "-75" } },
    ];

    const summary = context.buildManualFinanceSummaryRows(rows, {});
    assert.equal(summary[0].channel, "Бинанс spot");
    assert.equal(summary[0].exchange, "1000,0000");
    assert.equal(summary[1].channel, "binance save");
    assert.equal(summary[1].exchange, "-1050,0000");
    assert.equal(summary[2].channel, "Итого");
    assert.equal(summary[2].exchange, "-50,0000");
  } finally {
    context.MANUAL_FINANCE_MONEY_CHANNELS = previousChannels;
  }
});

test("buildLatestNowUsdLookup converts RUB now with the rate from the now date", () => {
  const latest = {
    "Яндекс руб": { value: "1000", date: "2026-04-24" },
  };
  const movementValues = [
    ["DATE", "RUB RATE"],
    ["2026-04-24", "80"],
    ["2026-04-25", "100"],
  ];
  const periodRateLookup = context.buildManualFinanceUsdRateLookup([], movementValues, { endDate: "2026-04-25" });

  assert.equal(
    context.buildLatestNowUsdLookup(latest, periodRateLookup, { movementValues })["Яндекс руб"],
    12.5
  );
});

test("buildLatestBalanceEntriesByChannel uses Остатки instead of spent for food", () => {
  const balances = [
    {
      date: "2026-04-24",
      channel: "Яндекс руб",
      amount: "139786",
      currency: "RUB",
      rate: "84.5563",
      usdAmount: "",
    },
  ];
  const expenses = [
    { date: "2026-04-24", category: "food", amounts: { "Яндекс руб": "11287", "пейпал дол": "" } },
  ];

  const latest = context.buildLatestBalanceEntriesByChannel(balances, "2026-04-25");
  const summary = context.buildManualFinanceSummaryRows(expenses, latest);
  const usd = context.buildLatestNowUsdLookup(latest, { byCurrency: { RUB: 1 / 100 }, byChannel: {} });

  assert.equal(summary[0].now, "139786,0000");
  assert.equal(summary[0].food, "11287,0000");
  assert.equal(Number(usd["Яндекс руб"].toFixed(4)), 1653.1707);
});

test("buildLatestBalanceEntriesByChannel falls back to previous non-zero balance", () => {
  const balances = [
    { date: "2026-04-24", channel: "Яндекс руб", amount: "139786", currency: "RUB", rate: "84.5563" },
    { date: "2026-04-25", channel: "Яндекс руб", amount: "0", currency: "RUB", rate: "84.5563" },
  ];

  assert.deepEqual(plain(context.buildLatestBalanceEntriesByChannel(balances, "2026-04-25")), {
    "Яндекс руб": {
      value: "139786",
      date: "2026-04-24",
      currency: "RUB",
      rate: "84.5563",
      usdAmount: "",
    },
  });
});

test("filterManualFlowExpenseRows keeps Расходы free of now rows for new saves", () => {
  const rows = [
    { date: "2026-04-24", category: "now", amounts: { "Яндекс руб": "139786" } },
    { date: "2026-04-24", category: "food", amounts: { "Яндекс руб": "11287" } },
    { date: "2026-04-24", category: "exchange", amounts: { "Яндекс руб": "-1000" } },
  ];

  assert.deepEqual(context.filterManualFlowExpenseRows(rows).map((row) => row.category), ["food", "exchange"]);
});

test("normalizeManualExpenseCategory maps study into travel and keeps fun separate", () => {
  assert.equal(context.normalizeManualExpenseCategory("spent for study"), "travel");
  assert.equal(context.normalizeManualExpenseCategory("учеба"), "travel");
  assert.equal(context.normalizeManualExpenseCategory("spent for fun"), "fun");
});

test("provider accounting save keeps income and exchange categories", () => {
  assert.match(configJs, /const MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES = MANUAL_INPUT_CATEGORIES\.slice\(\);/);
  assert.match(uiJs, /MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES\.forEach\(\(category\) =>/);
  assert.match(uiJs, /\["income", "exchange", "transfer", "neutral"\]\.includes\(entry\.direction\)/);
  assert.doesNotMatch(
    uiJs,
    /state\.expenseAccounting\.entries\.filter\(\(entry\) => entry\.direction !== "income"/
  );
  assert.match(uiJs, /if \(!MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES\.includes\(category\)\) return;/);
});

test("server manual payload is preserved for analytics without browser OAuth", () => {
  assert.match(mainJs, /manual: data\?\.manual \|\| null/);
  assert.match(mainJs, /buildAggregatedManualDataFromServerPayload\(state\.data\.manual, startDate, endDate\)/);
  assert.match(financeJs, /function buildAggregatedManualDataFromServerPayload\(manual, startDate, endDate\)/);
  assert.match(financeJs, /normalizeServerExpenseRows\(manual\?\.expenseRows \|\| \[\]\)/);
  assert.match(financeJs, /normalizeServerBalanceRows\(manual\?\.balanceRows \|\| manual\?\.balances \|\| \[\]\)/);
  assert.match(financeJs, /normalizeServerCommissionRows\(manual\?\.commissionRows \|\| \[\]\)/);
});
