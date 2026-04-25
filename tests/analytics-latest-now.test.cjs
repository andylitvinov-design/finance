const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const match = indexHtml.match(/function buildLatestNowByChannel\(expenseRows, endDate\) \{[\s\S]*?\n      \}/);
if (!match) throw new Error("buildLatestNowByChannel was not found in index.html");
const entriesMatch = indexHtml.match(/function buildLatestNowEntriesByChannel\(expenseRows, endDate\) \{[\s\S]*?\n      \}/);
if (!entriesMatch) throw new Error("buildLatestNowEntriesByChannel was not found in index.html");
const balanceEntriesMatch = indexHtml.match(/function buildLatestBalanceEntriesByChannel\(balanceRows, endDate\) \{[\s\S]*?\n      \}/);
if (!balanceEntriesMatch) throw new Error("buildLatestBalanceEntriesByChannel was not found in index.html");
const categoryMatch = indexHtml.match(/function normalizeManualExpenseCategory\(value\) \{[\s\S]*?\n      \}/);
if (!categoryMatch) throw new Error("normalizeManualExpenseCategory was not found in index.html");
const flowExpenseRowsMatch = indexHtml.match(/function filterManualFlowExpenseRows\(rows\) \{[\s\S]*?\n      \}/);
if (!flowExpenseRowsMatch) throw new Error("filterManualFlowExpenseRows was not found in index.html");
const movementRateMatch = indexHtml.match(/function buildLatestMovementUsdRateLookup\(movementValues = \[\], endDate = ""\) \{[\s\S]*?\n      \}/);
if (!movementRateMatch) throw new Error("buildLatestMovementUsdRateLookup was not found in index.html");
const financeRateMatch = indexHtml.match(/function buildManualFinanceUsdRateLookup\(transferRows = \[\], movementValues = \[\], options = \{\}\) \{[\s\S]*?\n      \}/);
if (!financeRateMatch) throw new Error("buildManualFinanceUsdRateLookup was not found in index.html");
const summaryRowsMatch = indexHtml.match(/function buildManualFinanceSummaryRows\(expenseRows, latestNowByChannel = \{\}\) \{[\s\S]*?\n      \}/);
if (!summaryRowsMatch) throw new Error("buildManualFinanceSummaryRows was not found in index.html");
const usdPerLocalMatch = indexHtml.match(/function getManualFinanceUsdPerLocalRate\(row, rateLookup = \{ byChannel: \{\}, byCurrency: \{\} \}\) \{[\s\S]*?\n      \}/);
if (!usdPerLocalMatch) throw new Error("getManualFinanceUsdPerLocalRate was not found in index.html");
const nowUsdMatch = indexHtml.match(/function getManualFinanceNowUsdValue\(row, rateLookup = \{ byChannel: \{\}, byCurrency: \{\} \}\) \{[\s\S]*?\n      \}/);
if (!nowUsdMatch) throw new Error("getManualFinanceNowUsdValue was not found in index.html");
const latestNowUsdMatch = indexHtml.match(/function buildLatestNowUsdLookup\(latestNowByChannel, rateLookup, options = \{\}\) \{[\s\S]*?\n      \}/);
if (!latestNowUsdMatch) throw new Error("buildLatestNowUsdLookup was not found in index.html");

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
  return ["Яндекс руб", "пейпал дол"];
}

function getManualStoredExpenseTypes() {
  return ["now", "serviceIncome", "business", "flat", "food", "fun", "travel", "exchange"];
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
vm.runInContext(`${categoryMatch[0]}\n${flowExpenseRowsMatch[0]}\n${entriesMatch[0]}\n${balanceEntriesMatch[0]}\n${match[0]}\n${movementRateMatch[0]}\n${financeRateMatch[0]}\n${summaryRowsMatch[0]}\n${usdPerLocalMatch[0]}\n${nowUsdMatch[0]}\n${latestNowUsdMatch[0]}\nthis.filterManualFlowExpenseRows = filterManualFlowExpenseRows;\nthis.buildLatestNowByChannel = buildLatestNowByChannel;\nthis.buildLatestNowEntriesByChannel = buildLatestNowEntriesByChannel;\nthis.buildLatestBalanceEntriesByChannel = buildLatestBalanceEntriesByChannel;\nthis.buildManualFinanceUsdRateLookup = buildManualFinanceUsdRateLookup;\nthis.buildManualFinanceSummaryRows = buildManualFinanceSummaryRows;\nthis.buildLatestNowUsdLookup = buildLatestNowUsdLookup;`, context);

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
