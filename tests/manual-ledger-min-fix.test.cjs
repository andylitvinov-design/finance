const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const configJs = fs.readFileSync(path.join(root, "config.js"), "utf8");
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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("normalizeManualFinanceExpenseRows merges duplicate date-category rows by channel amounts", () => {
  const context = {
    DEFAULT_MANUAL_CHANNEL_MAP: {
      "Бинанс spot": ["binance save"]
    },
    state: {
      config: {
        manualFinance: {}
      }
    },
    createManualFinanceExpenseRow(date, category) {
      return {
        date,
        category,
        amounts: {
          "Яндекс руб": "",
          "Бинанс spot": "",
        }
      };
    },
    buildEmptyExpenseAmounts() {
      return {
        "Яндекс руб": "",
        "Бинанс spot": "",
      };
    },
    buildDefaultManualExpenseRows(startDate, endDate) {
      return [
        context.createManualFinanceExpenseRow(startDate, "exchange"),
        context.createManualFinanceExpenseRow(startDate, "fun"),
      ];
    },
    getManualFinanceChannels() {
      return ["Яндекс руб", "Бинанс spot"];
    },
    normalizeCell(value) {
      return String(value || "").trim().toLowerCase();
    },
    normalizeLookupText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^0-9a-zа-я]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    formatSheetNumber(value, digits = 4) {
      return Number(value || 0).toFixed(digits).replace(".", ",");
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "resolveManualFinanceChannelAlias")}\n` +
    `${extractFunction(financeJs, "canonicalManualFinanceChannel")}\n` +
    `${extractFunction(financeJs, "getCanonicalManualChannelKey")}\n` +
    `${extractFunction(financeJs, "getCanonicalManualExpenseAmounts")}\n` +
    `${extractFunction(financeJs, "normalizeManualFinanceExpenseRows")}\nthis.normalizeManualFinanceExpenseRows = normalizeManualFinanceExpenseRows;`,
    context
  );

  const result = plain(context.normalizeManualFinanceExpenseRows([
    { date: "2026-04-24", category: "exchange", amounts: { "Яндекс руб": "-70000", "Бинанс spot": "" } },
    { date: "2026-04-24", category: "exchange", amounts: { "Яндекс руб": "-4669", "Бинанс spot": "874" } },
    { date: "2026-04-24", category: "fun", amounts: { "Яндекс руб": "100", "Бинанс spot": "" } },
  ], "2026-04-24", "2026-04-24"));

  assert.deepEqual(result, [
    {
      date: "2026-04-24",
      category: "exchange",
      amounts: {
        "Яндекс руб": "-74669,0000",
        "Бинанс spot": "874,0000",
      }
    },
    {
      date: "2026-04-24",
      category: "fun",
      amounts: {
        "Яндекс руб": "100,0000",
        "Бинанс spot": "",
      }
    },
  ]);
});

test("config keeps exchange in expense accounting categories", () => {
  assert.match(configJs, /MANUAL_EXPENSE_ACCOUNTING_CATEGORIES = \[[^\]]*"exchange"/);
});

test("buildExpenseAccountingCategorySelect keeps exchange among expense options", () => {
  const createdOptions = [];
  const context = {
    MANUAL_RECEIVED_ENTRY_TYPES: ["ezofact", "serviceincome", "exchange_in"],
    MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES: ["business", "flat", "food", "fun", "travel", "study", "exchange"],
    MANUAL_EXPENSE_ACCOUNTING_CATEGORIES: ["business", "flat", "food", "fun", "travel", "study", "exchange"],
    normalizeReceivedEntryType(value) {
      return value;
    },
    mapReceivedTypeToAccountingCategory(value) {
      return value;
    },
    document: {
      createElement(tag) {
        if (tag === "select") {
          return {
            className: "",
            options: [],
            appendChild(option) {
              this.options.push(option);
            },
            addEventListener() {},
          };
        }
        if (tag === "option") {
          const option = { value: "", textContent: "", selected: false };
          createdOptions.push(option);
          return option;
        }
        throw new Error(`Unexpected tag: ${tag}`);
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "buildExpenseAccountingCategorySelect")}\nthis.buildExpenseAccountingCategorySelect = buildExpenseAccountingCategorySelect;`,
    context
  );

  const select = context.buildExpenseAccountingCategorySelect({
    direction: "expense",
    category: "exchange"
  });

  assert.deepEqual(
    plain(select.options.map((option) => option.value)),
    ["business", "flat", "food", "fun", "travel", "study", "exchange"]
  );
});

test("getExpenseAnalysisProviderExpenseByChannel counts exchange entries", () => {
  const context = {
    MANUAL_FINANCE_MONEY_CHANNELS: ["Яндекс руб", "Бинанс spot"],
    state: {
      expenseAccounting: {
        entries: [
          { channel: "Яндекс руб", direction: "exchange", usdAmount: 888, localAmount: -74669, currency: "RUB" },
          { channel: "Бинанс spot", direction: "exchange", usdAmount: 874, localAmount: 874, currency: "USD" },
        ]
      }
    },
    canonicalManualFinanceChannel(value) {
      return value;
    },
    parseLooseNumber(value) {
      return Number(value || 0);
    },
    getManualFinanceFieldUsdNumber() {
      return 0;
    },
    roundProviderSummaryAmount(value) {
      return Math.round((Number(value) || 0) * 10000) / 10000;
    },
    getActivePayPalSummary() {
      return null;
    },
    getActiveWiseSummary() {
      return null;
    },
    Object,
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getExpenseAnalysisProviderExpenseByChannel")}\nthis.getExpenseAnalysisProviderExpenseByChannel = getExpenseAnalysisProviderExpenseByChannel;`,
    context
  );

  const result = plain(context.getExpenseAnalysisProviderExpenseByChannel({}));
  assert.deepEqual(result, {
    "Яндекс руб": 888,
    "Бинанс spot": 874,
  });
});
