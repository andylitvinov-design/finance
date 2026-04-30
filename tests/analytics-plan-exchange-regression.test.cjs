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

function findHeaderIndexByAliases(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}

function hasAnyValue(row) {
  return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
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
    clone2dArray(values) {
      return (values || []).map((row) => (row || []).slice());
    },
    normalizeCell,
    parseLooseNumber,
    formatSheetNumber,
    findHeaderIndexByAliases,
    hasAnyValue,
    splitAnalyticsSections,
    normalizePayoutAmount(value) {
      return parseLooseNumber(value);
    },
    inferManualFinanceChannelCurrency(channel) {
      return /руб/i.test(String(channel || "")) ? "RUB" : "USD";
    },
    getCanonicalManualChannelKey(value) {
      return String(value || "").trim();
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "insertAnalyticsColumn")}\n` +
    `${extractFunction(financeJs, "buildAnalyticsExchangeLookup")}\n` +
    `${extractFunction(financeJs, "normalizePlanGrowthFormula")}\n` +
    "this.normalizePlanGrowthFormula = normalizePlanGrowthFormula;",
    context
  );
  return context;
}

test("normalizePlanGrowthFormula preserves precomputed exchange values when legacy commission column is present", () => {
  const context = createContext();
  const values = [
    ["Личные расходы"],
    ["валюта", "now", "приход от услуг", "spent for business", "spent for flat", "spent for food", "spent for fun", "spent for study", "spent for travel", "затраты-мои", "обмен", "обмен_usd", "затраты-мои usd", "now_usd"],
    ["Яндекс руб", "0", "0", "0", "0", "0", "0", "0", "0", "0", "24,0000", "0,2800", "0", "0"],
    ["Бинанс spot", "0", "0", "0", "0", "0", "0", "0", "0", "0", "1,0000", "1,0000", "0", "0"],
    ["binance save", "0", "0", "0", "0", "0", "0", "0", "0", "0", "2,0000", "2,0000", "0", "0"],
    ["Итого", "", "", "", "", "", "", "", "", "0", "27,0000", "3,2800", "0", "0"],
    [],
    ["Plan"],
    ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "комиссии", "обмен_usd", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
    ["Яндекс руб", "0", "0", "0", "-74669,0000", "-884,0000", "-884,0000", "0", "0", "-884,0000"],
    ["Бинанс spot", "0", "0", "0", "874,0000", "874,0000", "874,0000", "0", "0", "874,0000"],
    ["binance save", "0", "0", "0", "-950,0000", "-950,0000", "-950,0000", "0", "0", "-950,0000"],
    ["Итого", "0", "0", "0", "-74745,0000", "-960,0000", "-960,0000", "0", "0", "-960,0000"],
    ["Итого движение", "0", "0"],
  ];

  const planRows = plain(context.normalizePlanGrowthFormula(values)).slice(8, 12);

  assert.deepEqual(planRows, [
    ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "обмен", "обмен_usd", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
    ["Яндекс руб", "0", "0", "0,0000", "-74669,0000", "-884,0000", "-884,0000", "0", "0", "-884,0000"],
    ["Бинанс spot", "0", "0", "0,0000", "874,0000", "874,0000", "874,0000", "0", "0", "874,0000"],
    ["binance save", "0", "0", "0,0000", "-950,0000", "-950,0000", "-950,0000", "0", "0", "-950,0000"],
  ]);
});

test("normalizePlanGrowthFormula still backfills exchange values for empty legacy cells", () => {
  const context = createContext();
  const values = [
    ["Личные расходы"],
    ["валюта", "now", "приход от услуг", "spent for business", "spent for flat", "spent for food", "spent for fun", "spent for study", "spent for travel", "затраты-мои", "обмен", "обмен_usd", "затраты-мои usd", "now_usd"],
    ["Яндекс руб", "0", "0", "0", "0", "0", "0", "0", "0", "0", "-74669,0000", "-884,0000", "0", "0"],
    ["Итого", "", "", "", "", "", "", "", "", "0", "-74669,0000", "-884,0000", "0", "0"],
    [],
    ["Plan"],
    ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "комиссии", "обмен_usd", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
    ["Яндекс руб", "0", "0", "0", "", "", "0", "0", "0", "0"],
    ["Итого", "0", "0", "0", "", "", "0", "0", "0", "0"],
    ["Итого движение", "0", "0"],
  ];

  const planRows = plain(context.normalizePlanGrowthFormula(values)).slice(6, 9);

  assert.deepEqual(planRows, [
    ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "обмен", "обмен_usd", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
    ["Яндекс руб", "0", "0", "0,0000", "-74669,0000", "-884,0000", "-884,0000", "0", "0", "-884,0000"],
    ["Итого", "0", "0", "0,0000", "-74669,0000", "-884,0000", "-884,0000", "0", "0", "-884,0000"],
  ]);
});

test("analytics UI still maps movement summary and personal ledger rows to different Movement 1 displays", () => {
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
