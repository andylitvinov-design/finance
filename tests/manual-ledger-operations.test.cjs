const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const googleSheetsJs = fs.readFileSync(path.join(root, "google-sheets.js"), "utf8");
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

function buildLedgerTestContext() {
  const context = {
    state: {
      config: {
        manualFinance: {
          ledgerSheetName: "Ledger"
        }
      }
    },
    MANUAL_FINANCE_LEDGER_TITLE: "Ledger",
    MANUAL_LEDGER_HEADERS: [
      "date",
      "operation",
      "from_channel",
      "to_channel",
      "amount",
      "currency",
      "amount_usd",
      "category",
      "subcategory",
      "direction",
      "comment",
      "source",
      "raw_source_id",
      "transfer_group_id",
      "created_at",
      "updated_at"
    ],
    MANUAL_FINANCE_CHANNELS: ["Яндекс руб", "пейпал дол", "Бинанс spot", "binance save", "монобанк грн", "приват 24-грн"],
    MANUAL_NOW_CATEGORY: "now",
    canonicalManualFinanceChannel(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "paypal usd" || normalized === "пейпал дол") return "пейпал дол";
      if (normalized === "binance save" || normalized === "бинанс save") return "binance save";
      if (normalized === "бинанс spot" || normalized === "binance spot") return "Бинанс spot";
      if (normalized === "яндекс руб") return "Яндекс руб";
      if (normalized === "приват 24-грн") return "приват 24-грн";
      if (normalized === "монобанк грн") return "монобанк грн";
      return String(value || "").trim();
    },
    getManualFinanceChannels() {
      return context.MANUAL_FINANCE_CHANNELS.slice();
    },
    normalizeCell(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    },
    normalizeIncomingSheetDateValue(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
      return raw;
    },
    normalizeManualFinancePersistedNumberInput(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return "";
      return raw.replace(".", ",");
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    inferManualFinanceChannelCurrency(channel) {
      const map = {
        "Яндекс руб": "RUB",
        "пейпал дол": "USD",
        "Бинанс spot": "USD",
        "binance save": "USD",
        "монобанк грн": "UAH",
        "приват 24-грн": "UAH",
      };
      return map[channel] || "USD";
    },
    normalizeManualLedgerCategoryForStorage(value, fallback = "extra") {
      const raw = String(value || "").trim().toLowerCase();
      if (!raw) return fallback;
      if (raw === "serviceincome" || raw === "servicein") return "servicein";
      if (raw === "business") return "business";
      if (raw === "exchange") return "exchange";
      if (raw === "food") return "food";
      return raw;
    },
    normalizeManualExpenseCategory(value) {
      return String(value || "").trim().toLowerCase();
    },
    normalizeManualLedgerOperation(value, category = "") {
      const raw = String(value || "").trim();
      if (raw) return raw;
      if (category === "business") return "business_expense";
      return "personal_expense";
    },
    normalizeManualLedgerDirection(value, operation = "") {
      const raw = String(value || "").trim();
      if (raw) return raw;
      return operation === "income" || operation === "exchange_in" ? "in" : "out";
    },
    findHeaderIndexByAliases(header, aliases) {
      const normalized = new Set((aliases || []).map((item) => String(item || "").trim().toLowerCase()));
      return (header || []).findIndex((cell) => normalized.has(String(cell || "").trim().toLowerCase()));
    },
    formatSheetNumber(value, digits = 4) {
      return Number(value || 0).toFixed(digits).replace(".", ",");
    },
    getCanonicalManualExpenseAmounts(amounts = {}) {
      return { ...(amounts || {}) };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerSource")}\n` +
    `${extractFunction(googleSheetsJs, "getManualLedgerDisplaySource")}\n` +
    `${extractFunction(googleSheetsJs, "assertManualLedgerHeaders")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeLedgerRowForContract")}\n` +
    `${extractFunction(googleSheetsJs, "parseManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "buildManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerRowsForSave")}\n` +
    `${extractFunction(googleSheetsJs, "trimTrailingEmptySheetRows")}\n` +
    `${extractFunction(googleSheetsJs, "buildUpdatedManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "buildDeletedManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "buildLedgerRowsFromExpenseRows")}\n` +
    `${extractFunction(googleSheetsJs, "buildLedgerRowsFromAccountingEntries")}\n` +
    `this.parseManualLedgerSheetValues = parseManualLedgerSheetValues;\n` +
    `this.buildUpdatedManualLedgerSheetValues = buildUpdatedManualLedgerSheetValues;\n` +
    `this.buildDeletedManualLedgerSheetValues = buildDeletedManualLedgerSheetValues;\n` +
    `this.buildLedgerRowsFromExpenseRows = buildLedgerRowsFromExpenseRows;\n` +
    `this.buildLedgerRowsFromAccountingEntries = buildLedgerRowsFromAccountingEntries;\n`,
    context
  );
  return context;
}

test("parseManualLedgerSheetValues tolerates missing source and exposes sheetRowNumber plus unknown display source", () => {
  const context = buildLedgerTestContext();
  const parsed = plain(context.parseManualLedgerSheetValues([
    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
    ["2026-05-01", "income", "", "paypal usd", "120", "USD", "120", "serviceIncome", "", "in", "legacy row", "raw-1", "", "2026-05-01T09:00:00.000Z", "2026-05-01T09:00:00.000Z"],
  ]));

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].sheetRowNumber, 2);
  assert.equal(parsed.rows[0].source, "");
  assert.equal(parsed.rows[0].displaySource, "unknown");
});

test("buildUpdatedManualLedgerSheetValues updates the correct physical Ledger row only", () => {
  const context = buildLedgerTestContext();
  const values = [
    context.MANUAL_LEDGER_HEADERS.slice(),
    ["2026-05-01", "income", "", "пейпал дол", "120", "USD", "120", "servicein", "", "in", "keep me", "manual", "raw-1", "", "2026-05-01T09:00:00.000Z", "2026-05-01T09:00:00.000Z"],
    ["2026-05-02", "personal_expense", "Яндекс руб", "", "500", "RUB", "6", "food", "", "out", "edit me", "photo", "raw-2", "", "2026-05-02T09:00:00.000Z", "2026-05-02T09:00:00.000Z"],
  ];

  const updated = plain(context.buildUpdatedManualLedgerSheetValues(values, {
    sheetRowNumber: 3,
    amount: "700",
    comment: "updated row",
    source: "mcp",
  }));

  assert.equal(updated[1][10], "keep me");
  assert.equal(updated[1][11], "manual");
  assert.equal(updated[2][4], "700");
  assert.equal(updated[2][10], "updated row");
  assert.equal(updated[2][11], "mcp");
});

test("buildDeletedManualLedgerSheetValues deletes the correct physical Ledger row", () => {
  const context = buildLedgerTestContext();
  const values = [
    context.MANUAL_LEDGER_HEADERS.slice(),
    ["2026-05-01", "income", "", "пейпал дол", "120", "USD", "120", "servicein", "", "in", "keep me", "manual", "raw-1", "", "2026-05-01T09:00:00.000Z", "2026-05-01T09:00:00.000Z"],
    ["2026-05-02", "personal_expense", "Яндекс руб", "", "500", "RUB", "6", "food", "", "out", "remove me", "photo", "raw-2", "", "2026-05-02T09:00:00.000Z", "2026-05-02T09:00:00.000Z"],
    ["2026-05-03", "income", "", "Бинанс spot", "87", "USD", "87", "servicein", "", "in", "keep me too", "mcp", "raw-3", "", "2026-05-03T09:00:00.000Z", "2026-05-03T09:00:00.000Z"],
  ];

  const updated = plain(context.buildDeletedManualLedgerSheetValues(values, 3));

  assert.equal(updated.length, 3);
  assert.equal(updated[1][10], "keep me");
  assert.equal(updated[2][10], "keep me too");
});

test("buildLedgerRowsFromExpenseRows marks fact-created rows as source=manual", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromExpenseRows([
    {
      date: "2026-05-01",
      category: "business",
      amounts: { "Яндекс руб": "1000", "пейпал дол": "" }
    }
  ], {
    date: "2026-05-01",
    source: "fact",
    ledgerSource: "manual",
    comment: "fact 2026-05-01"
  }));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "manual");
});

test("buildLedgerRowsFromAccountingEntries maps provider rows to mcp and OCR rows to photo", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-01",
      channel: "paypal usd",
      localAmount: 120,
      currency: "USD",
      usdAmount: 120,
      category: "business",
      direction: "expense",
      source: "paypal",
      sourceTransactionId: "pp-1",
      description: "provider expense"
    },
    {
      date: "2026-05-01",
      channel: "Яндекс руб",
      localAmount: 500,
      currency: "RUB",
      usdAmount: 6,
      category: "food",
      direction: "expense",
      sourceImageIndex: 0,
      description: "ocr expense"
    }
  ]));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "mcp");
  assert.equal(rows[1].source, "photo");
});

test("filterExpenseOperationsRows filters by period, channels, and source", () => {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "filterExpenseOperationsRows")}\nthis.filterExpenseOperationsRows = filterExpenseOperationsRows;`,
    context
  );

  const rows = [
    { date: "2026-05-01", source: "manual", displaySource: "manual", operation: "income", fromChannel: "", toChannel: "пейпал дол" },
    { date: "2026-05-02", source: "mcp", displaySource: "mcp", operation: "personal_expense", fromChannel: "Яндекс руб", toChannel: "" },
    { date: "2026-05-03", source: "", displaySource: "unknown", operation: "business_expense", fromChannel: "монобанк грн", toChannel: "" },
  ];

  const filtered = plain(context.filterExpenseOperationsRows(rows, {
    startDate: "2026-05-02",
    endDate: "2026-05-03",
    source: "unknown",
    operation: "all",
    fromChannel: "монобанк грн",
    toChannel: "all"
  }));

  assert.deepEqual(filtered, [
    { date: "2026-05-03", source: "", displaySource: "unknown", operation: "business_expense", fromChannel: "монобанк грн", toChannel: "" },
  ]);
});
