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
      "amount_gross",
      "amount_fee",
      "amount_net",
      "category",
      "subcategory",
      "direction",
      "comment",
      "counterparty",
      "description",
      "source",
      "external_id",
      "raw_source_id",
      "transfer_group_id",
      "created_at",
      "updated_at"
    ],
    MANUAL_FINANCE_CHANNELS: ["Яндекс руб", "пейпал дол", "Бинанс spot", "binance save", "монобанк грн", "приват 24-грн", "трансервайз дол", "трансервайз евро", "REVOLUT дол", "REVOLUT евро", "REVOLUT фунт"],
    MANUAL_FINANCE_FALLBACK_USD_RATES: { UAH: 1 / 43.86, RUB: 1 / 84.5563, LOCAL: 1 / 18 },
    MANUAL_NOW_CATEGORY: "now",
    canonicalManualFinanceChannel(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "paypal usd" || normalized === "пейпал дол") return "пейпал дол";
      if (normalized === "binance save" || normalized === "бинанс save") return "binance save";
      if (normalized === "бинанс spot" || normalized === "binance spot") return "Бинанс spot";
      if (normalized === "яндекс руб") return "Яндекс руб";
      if (normalized === "приват 24-грн") return "приват 24-грн";
      if (normalized === "монобанк грн") return "монобанк грн";
      if (normalized === "revolut usd" || normalized === "revolut dol" || normalized === "revolut дол" || normalized === "револют дол") return "REVOLUT дол";
      if (normalized === "revolut eur" || normalized === "revolut евро" || normalized === "револют евро") return "REVOLUT евро";
      if (normalized === "revolut gbp" || normalized === "revolut фунт" || normalized === "револют фунт") return "REVOLUT фунт";
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
        "трансервайз дол": "USD",
        "трансервайз евро": "EUR",
        "REVOLUT дол": "USD",
        "REVOLUT евро": "EUR",
        "REVOLUT фунт": "GBP",
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
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerSourceToken")}\n` +
    `${extractFunction(googleSheetsJs, "inferManualLedgerSourceFromRawSourceId")}\n` +
    `${extractFunction(googleSheetsJs, "inferManualLedgerSourceFromChannels")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerSource")}\n` +
    `${extractFunction(googleSheetsJs, "resolveManualLedgerSource")}\n` +
    `${extractFunction(googleSheetsJs, "getManualLedgerDisplaySource")}\n` +
    `${extractFunction(googleSheetsJs, "assertManualLedgerHeaders")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeLedgerRowForContract")}\n` +
    `${extractFunction(googleSheetsJs, "parseManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "buildManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeLedgerAmountUsdForSave")}\n` +
    `${extractFunction(googleSheetsJs, "firstNonEmpty")}\n` +
    `${extractFunction(googleSheetsJs, "getLedgerUsdPerLocalRate")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeLedgerExchangeUsdSign")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerRowsForSave")}\n` +
    `${extractFunction(googleSheetsJs, "trimTrailingEmptySheetRows")}\n` +
    `${extractFunction(googleSheetsJs, "buildUpdatedManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "buildDeletedManualLedgerSheetValues")}\n` +
    `${extractFunction(googleSheetsJs, "buildLedgerRowsFromExpenseRows")}\n` +
    `${extractFunction(googleSheetsJs, "formatStableSourceIdPart")}\n` +
    `${extractFunction(googleSheetsJs, "buildStableScreenshotIncomeSourceId")}\n` +
    `${extractFunction(googleSheetsJs, "isScreenshotAccountingEntry")}\n` +
    `${extractFunction(googleSheetsJs, "buildLedgerRowsFromAccountingEntries")}\n` +
    `this.parseManualLedgerSheetValues = parseManualLedgerSheetValues;\n` +
    `this.buildManualLedgerSheetValues = buildManualLedgerSheetValues;\n` +
    `this.buildUpdatedManualLedgerSheetValues = buildUpdatedManualLedgerSheetValues;\n` +
    `this.buildDeletedManualLedgerSheetValues = buildDeletedManualLedgerSheetValues;\n` +
    `this.buildLedgerRowsFromExpenseRows = buildLedgerRowsFromExpenseRows;\n` +
    `this.buildLedgerRowsFromAccountingEntries = buildLedgerRowsFromAccountingEntries;\n`,
    context
  );
  return context;
}

const CURRENT_LEDGER_HEADER = [
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
  "updated_at",
  "amount_gross",
  "amount_fee",
  "amount_net"
];

test("parseManualLedgerSheetValues accepts current, legacy, and canonical Ledger headers", () => {
  const context = buildLedgerTestContext();
  const legacyHeader = [
    "date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd",
    "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"
  ];
  const canonicalHeader = context.MANUAL_LEDGER_HEADERS.slice();

  for (const header of [CURRENT_LEDGER_HEADER, legacyHeader, canonicalHeader]) {
    const row = new Array(header.length).fill("");
    row[header.indexOf("date")] = "2026-05-01";
    row[header.indexOf("operation")] = "income";
    row[header.indexOf("to_channel")] = "paypal usd";
    row[header.indexOf("amount")] = "120";
    row[header.indexOf("currency")] = "USD";
    row[header.indexOf("amount_usd")] = "120";
    if (header.includes("category")) row[header.indexOf("category")] = "serviceIncome";
    if (header.includes("direction")) row[header.indexOf("direction")] = "in";
    if (header.includes("raw_source_id")) row[header.indexOf("raw_source_id")] = `raw-${header.length}`;
    if (header.includes("amount_gross")) row[header.indexOf("amount_gross")] = "120";
    if (header.includes("amount_fee")) row[header.indexOf("amount_fee")] = "5";
    if (header.includes("amount_net")) row[header.indexOf("amount_net")] = "115";

    const parsed = plain(context.parseManualLedgerSheetValues([header, row]));

    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].amount, "120");
    if (header.includes("amount_gross")) assert.equal(parsed.rows[0].amountGross, "120");
    if (header.includes("amount_fee")) assert.equal(parsed.rows[0].amountFee, "5");
    if (header.includes("amount_net")) assert.equal(parsed.rows[0].amountNet, "115");
  }
});

test("buildManualLedgerSheetValues maps rows by the provided Ledger header", () => {
  const context = buildLedgerTestContext();
  const values = plain(context.buildManualLedgerSheetValues([{
    date: "2026-05-01",
    operation: "income",
    toChannel: "трансервайз дол",
    amount: "120",
    currency: "USD",
    amountUsd: "120",
    amountGross: "120",
    amountFee: "5",
    amountNet: "115",
    category: "servicein",
    direction: "in",
    source: "wise",
    externalId: "WISE-TXN-1",
    rawSourceId: "wise:WISE-TXN-1"
  }], CURRENT_LEDGER_HEADER));

  assert.deepEqual(values[0], CURRENT_LEDGER_HEADER);
  assert.equal(values[1][CURRENT_LEDGER_HEADER.indexOf("source")], "wise");
  assert.equal(values[1][CURRENT_LEDGER_HEADER.indexOf("raw_source_id")], "wise:WISE-TXN-1");
  assert.equal(values[1][CURRENT_LEDGER_HEADER.indexOf("amount_gross")], "120");
  assert.equal(values[1][CURRENT_LEDGER_HEADER.indexOf("amount_fee")], "5");
  assert.equal(values[1][CURRENT_LEDGER_HEADER.indexOf("amount_net")], "115");
});

test("parseManualLedgerSheetValues infers provider source from channel when source column is missing", () => {
  const context = buildLedgerTestContext();
  const parsed = plain(context.parseManualLedgerSheetValues([
    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
    ["2026-05-01", "income", "", "paypal usd", "120", "USD", "120", "serviceIncome", "", "in", "legacy row", "raw-1", "", "2026-05-01T09:00:00.000Z", "2026-05-01T09:00:00.000Z"],
  ]));

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].sheetRowNumber, 2);
  assert.equal(parsed.rows[0].source, "paypal");
  assert.equal(parsed.rows[0].displaySource, "paypal");
});

test("parseManualLedgerSheetValues normalizes migration raw_source_id rows as migration", () => {
  const context = buildLedgerTestContext();
  const parsed = plain(context.parseManualLedgerSheetValues([
    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
    ["2026-05-01", "personal_expense", "Яндекс руб", "", "1000", "RUB", "12", "food", "", "out", "migrated row", "migration:2026-04-25:19:8", "", "2026-05-01T09:00:00.000Z", "2026-05-01T09:00:00.000Z"],
  ]));

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].source, "migration");
  assert.equal(parsed.rows[0].displaySource, "migration");
});

test("buildUpdatedManualLedgerSheetValues updates the correct physical Ledger row only", () => {
  const context = buildLedgerTestContext();
  const values = [
    context.MANUAL_LEDGER_HEADERS.slice(),
    ["2026-05-01", "income", "", "пейпал дол", "120", "USD", "120", "120", "", "120", "servicein", "", "in", "keep me", "", "", "manual", "raw-1", "raw-1", "", "2026-05-01T09:00:00.000Z", "2026-05-01T09:00:00.000Z"],
    ["2026-05-02", "personal_expense", "Яндекс руб", "", "500", "RUB", "6", "500", "", "500", "food", "", "out", "edit me", "", "", "other", "raw-2", "raw-2", "", "2026-05-02T09:00:00.000Z", "2026-05-02T09:00:00.000Z"],
  ];

  const updated = plain(context.buildUpdatedManualLedgerSheetValues(values, {
    sheetRowNumber: 3,
    amount: "700",
    comment: "updated row",
    source: "other",
  }));

  assert.equal(updated[1][13], "keep me");
  assert.equal(updated[1][16], "manual");
  assert.equal(updated[2][4], "700");
  assert.equal(updated[2][13], "updated row");
  assert.equal(updated[2][16], "other");
});

test("buildDeletedManualLedgerSheetValues deletes the correct physical Ledger row", () => {
  const context = buildLedgerTestContext();
  const values = [
    context.MANUAL_LEDGER_HEADERS.slice(),
    ["2026-05-01", "income", "", "пейпал дол", "120", "USD", "120", "120", "", "120", "servicein", "", "in", "keep me", "", "", "manual", "raw-1", "raw-1", "", "2026-05-01T09:00:00.000Z", "2026-05-01T09:00:00.000Z"],
    ["2026-05-02", "personal_expense", "Яндекс руб", "", "500", "RUB", "6", "500", "", "500", "food", "", "out", "remove me", "", "", "other", "raw-2", "raw-2", "", "2026-05-02T09:00:00.000Z", "2026-05-02T09:00:00.000Z"],
    ["2026-05-03", "income", "", "Бинанс spot", "87", "USD", "87", "87", "", "87", "servicein", "", "in", "keep me too", "", "", "other", "raw-3", "raw-3", "", "2026-05-03T09:00:00.000Z", "2026-05-03T09:00:00.000Z"],
  ];

  const updated = plain(context.buildDeletedManualLedgerSheetValues(values, 3));

  assert.equal(updated.length, 3);
  assert.equal(updated[1][13], "keep me");
  assert.equal(updated[2][13], "keep me too");
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
  assert.ok(!rows[0].rawSourceId.startsWith("migration:"));
});

test("manual Fact save writes Ledger only and does not update legacy Расходы", () => {
  const saveFunction = extractFunction(googleSheetsJs, "saveManualSheetDirect");
  assert.match(saveFunction, /buildLedgerRowsFromExpenseRows\(rawExpenseRows/);
  assert.match(saveFunction, /ledgerSource:\s*"manual"/);
  assert.doesNotMatch(saveFunction, /overwriteSheetValues\(getManualExpensesSheetName\(\)/);
  assert.doesNotMatch(saveFunction, /parseIncomingExpenseSheetValues\(await getSheetValuesByTitle\(getManualExpensesSheetName\(\)\)/);
});

test("expense accounting imports write Ledger only and do not update legacy Расходы", () => {
  const saveFunction = extractFunction(uiJs, "saveExpenseAccountingEntriesDirect");
  assert.match(saveFunction, /buildLedgerRowsFromAccountingEntries\(entries\)/);
  assert.match(saveFunction, /existingLedgerValues/);
  assert.match(saveFunction, /buildManualLedgerSheetValues\(\[\.\.\.\(existingLedgerParse\.rows \|\| \[\]\), \.\.\.ledgerSave\.rows\], existingLedgerValues\[0\]\)/);
  assert.doesNotMatch(saveFunction, /overwriteSheetValues\(getManualExpensesSheetName\(\)/);
  assert.doesNotMatch(saveFunction, /parseIncomingExpenseSheetValues\(await getSheetValuesByTitle\(getManualExpensesSheetName\(\)\)/);
});

test("expense accounting direction counts show Wise import spent and received tabs separately", () => {
  const context = {
    state: {
      expenseAccounting: {
        entries: [
          ...Array.from({ length: 21 }, (_, index) => ({ id: `wise-expense-${index}`, direction: "expense" })),
          { id: "CARD-3806683062", direction: "income" },
          { id: "CARD-3806680329", direction: "income" }
        ]
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getExpenseAccountingDirectionCounts")}\n` +
    "this.getExpenseAccountingDirectionCounts = getExpenseAccountingDirectionCounts;",
    context
  );

  assert.deepEqual(plain(context.getExpenseAccountingDirectionCounts()), {
    spent: 21,
    received: 2
  });
});

test("manual cash income creates Ledger income row with cash toChannel and amount_net", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-14",
      channel: "Налично -я-евр",
      direction: "income",
      localAmount: 75,
      currency: "EUR",
      category: "servicein",
      source: "manual",
      netAmount: 75,
      sourceTransactionId: "manual-cash-income-1"
    }
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, "income");
  assert.equal(rows[0].fromChannel, "");
  assert.equal(rows[0].toChannel, "Налично -я-евр");
  assert.equal(rows[0].direction, "in");
  assert.equal(rows[0].source, "manual");
  assert.equal(rows[0].amountNet, "75,0000");
});

test("manual cash expense creates Ledger expense row with cash fromChannel and amount_net", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-14",
      channel: "нал-мам-дол",
      direction: "expense",
      localAmount: 42.5,
      currency: "USD",
      category: "food",
      source: "manual",
      netAmount: 42.5,
      sourceTransactionId: "manual-cash-expense-1"
    }
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, "personal_expense");
  assert.equal(rows[0].fromChannel, "нал-мам-дол");
  assert.equal(rows[0].toChannel, "");
  assert.equal(rows[0].direction, "out");
  assert.equal(rows[0].source, "manual");
  assert.equal(rows[0].amountNet, "42,5000");
});

test("buildLedgerRowsFromAccountingEntries maps provider rows to provider sources and OCR rows to screenshot sources", () => {
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
  assert.equal(rows[0].source, "paypal");
  assert.equal(rows[1].source, "photo");
});

test("buildLedgerRowsFromAccountingEntries preserves Wise source and stable ids", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-01",
      channel: "wise usd",
      localAmount: 120,
      currency: "USD",
      usdAmount: 120,
      category: "business",
      direction: "expense",
      source: "wise",
      externalId: "WISE-TXN-1",
      sourceTransactionId: "wise:WISE-TXN-1",
      description: "Wise expense"
    }
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "wise");
  assert.equal(rows[0].externalId, "WISE-TXN-1");
  assert.equal(rows[0].rawSourceId, "wise:WISE-TXN-1");
});

test("buildLedgerRowsFromAccountingEntries preserves Payoneer gross fee net and ids", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-14",
      channel: "Payoneer - dol",
      localAmount: 970,
      currency: "USD",
      usdAmount: 970,
      amountGross: 1000,
      amountFee: 30,
      amountNet: 970,
      feeAmount: 30,
      netAmount: 970,
      category: "servicein",
      direction: "income",
      source: "payoneer",
      sourceTransactionId: "PYO-REAL-1",
      externalId: "PYO-REAL-1",
      description: "Payment from client"
    }
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "payoneer");
  assert.equal(rows[0].toChannel, "Payoneer - dol");
  assert.equal(rows[0].amount, "970,0000");
  assert.equal(rows[0].amountGross, "1000,0000");
  assert.equal(rows[0].amountFee, "30,0000");
  assert.equal(rows[0].amountNet, "970,0000");
  assert.equal(rows[0].rawSourceId, "PYO-REAL-1");
  assert.equal(rows[0].externalId, "PYO-REAL-1");
});

test("buildLedgerRowsFromAccountingEntries keeps Wise expense net equal to balance debit when fee is informational", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-16",
      channel: "wise usd",
      localAmount: 142.71,
      currency: "USD",
      usdAmount: 142.71,
      netAmount: 142.71,
      feeAmount: 0.41,
      category: "business",
      direction: "expense",
      source: "wise",
      sourceTransactionId: "CARD-3800823225",
      description: "Wise card expense"
    }
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "wise");
  assert.equal(rows[0].amountGross, "142,7100");
  assert.equal(rows[0].amountFee, "0,4100");
  assert.equal(rows[0].amountNet, "142,7100");
  assert.equal(rows[0].rawSourceId, "CARD-3800823225");
});

test("buildLedgerRowsFromAccountingEntries saves Wise card account amount while preserving local metadata in comment", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-09",
      channel: "трансервайз дол",
      localAmount: 108.36,
      localCurrency: "EUR",
      accountAmount: 128.08,
      currency: "USD",
      usdAmount: 128.08,
      amountNet: 128.08,
      category: "business",
      direction: "expense",
      source: "wise",
      externalId: "CARD-3771546317",
      sourceTransactionId: "CARD-3771546317",
      description: "Card transaction of 108.36 EUR issued by YellowSquare"
    }
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-05-09");
  assert.equal(rows[0].source, "wise");
  assert.equal(rows[0].fromChannel, "трансервайз дол");
  assert.equal(rows[0].amount, "128,0800");
  assert.equal(rows[0].currency, "USD");
  assert.equal(rows[0].amountUsd, "128,0800");
  assert.equal(rows[0].amountNet, "128,0800");
  assert.equal(rows[0].direction, "out");
  assert.equal(rows[0].comment, "Card transaction of 108.36 EUR issued by YellowSquare");
});

test("Wise refund income saves as Ledger income into Wise channel", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-19",
      channel: "трансервайз евро",
      direction: "income",
      localAmount: 55.6,
      currency: "EUR",
      usdAmount: null,
      netAmount: 55.6,
      category: "servicein",
      source: "wise",
      sourceTransactionId: "CARD-3806683062",
      description: "Card transaction of -55.60 EUR issued by Yellowsquare Greece Ike Athens"
    }
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, "income");
  assert.equal(rows[0].fromChannel, "");
  assert.equal(rows[0].toChannel, "трансервайз евро");
  assert.equal(rows[0].direction, "in");
  assert.equal(rows[0].source, "wise");
  assert.equal(rows[0].amount, "55,6000");
  assert.equal(rows[0].amountNet, "55,6000");
  assert.equal(rows[0].rawSourceId, "CARD-3806683062");
});

test("duplicate screenshot income is skipped and reported in save summary", () => {
  const context = buildLedgerTestContext();
  const entries = [
    {
      date: "2026-05-01",
      channel: "paypal usd",
      localAmount: 120,
      currency: "USD",
      usdAmount: 120,
      category: "serviceIncome",
      direction: "income",
      source: "browser_ocr",
      counterparty: "Client A",
      description: "Client A"
    },
    {
      date: "2026-05-01",
      channel: "paypal usd",
      localAmount: 120,
      currency: "USD",
      usdAmount: 120,
      category: "serviceIncome",
      direction: "income",
      source: "browser_ocr",
      counterparty: "Client A",
      description: "Client A"
    }
  ];
  const ledgerRows = plain(context.buildLedgerRowsFromAccountingEntries(entries));
  assert.equal(ledgerRows[0].rawSourceId, ledgerRows[1].rawSourceId);

  const saved = plain(context.normalizeManualLedgerRowsForSave(ledgerRows, []));
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.added_count, 1);
  assert.equal(saved.duplicate_count, 1);
  assert.equal(saved.skipped_count, 0);
});

test("duplicate generic file income is skipped and import sources are preserved", () => {
  const context = buildLedgerTestContext();
  const entries = [
    {
      date: "2026-05-01",
      channel: "пейпал дол",
      localAmount: 100,
      currency: "USD",
      usdAmount: null,
      category: "serviceIncome",
      direction: "income",
      source: "csv_import",
      sourceTransactionId: "csv_import:statement:0:2026-05-01:100:USD:client",
      externalId: "csv_import:statement:0:2026-05-01:100:USD:client",
      description: "Client"
    },
    {
      date: "2026-05-01",
      channel: "пейпал дол",
      localAmount: 100,
      currency: "USD",
      usdAmount: null,
      category: "serviceIncome",
      direction: "income",
      source: "csv_import",
      sourceTransactionId: "csv_import:statement:0:2026-05-01:100:USD:client",
      externalId: "csv_import:statement:0:2026-05-01:100:USD:client",
      description: "Client"
    }
  ];
  const ledgerRows = plain(context.buildLedgerRowsFromAccountingEntries(entries));
  assert.equal(ledgerRows[0].source, "csv_import");
  assert.equal(ledgerRows[1].source, "csv_import");

  const saved = plain(context.normalizeManualLedgerRowsForSave(ledgerRows, []));
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].source, "csv_import");
  assert.equal(saved.added_count, 1);
  assert.equal(saved.duplicate_count, 1);
  assert.equal(saved.skipped_count, 0);
});

test("repeated Revolut statement import keeps source and dedupes by revolut raw_source_id", () => {
  const context = buildLedgerTestContext();
  const entries = [
    {
      date: "2026-05-01",
      channel: "REVOLUT дол",
      localAmount: 100,
      currency: "USD",
      category: "serviceIncome",
      direction: "income",
      source: "revolut",
      sourceTransactionId: "rev-in-1",
      externalId: "rev-in-1",
      rawSourceId: "revolut:rev-in-1",
      raw_source_id: "revolut:rev-in-1",
      amountNet: 100,
      description: "Client"
    },
    {
      date: "2026-05-01",
      channel: "REVOLUT дол",
      localAmount: 100,
      currency: "USD",
      category: "serviceIncome",
      direction: "income",
      source: "revolut",
      sourceTransactionId: "rev-in-1",
      externalId: "rev-in-1",
      rawSourceId: "revolut:rev-in-1",
      raw_source_id: "revolut:rev-in-1",
      amountNet: 100,
      description: "Client"
    }
  ];
  const ledgerRows = plain(context.buildLedgerRowsFromAccountingEntries(entries));
  assert.equal(ledgerRows[0].source, "revolut");
  assert.equal(ledgerRows[0].externalId, "rev-in-1");
  assert.equal(ledgerRows[0].rawSourceId, "revolut:rev-in-1");

  const saved = plain(context.normalizeManualLedgerRowsForSave(ledgerRows, []));
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].source, "revolut");
  assert.equal(saved.rows[0].rawSourceId, "revolut:rev-in-1");
  assert.equal(saved.added_count, 1);
  assert.equal(saved.duplicate_count, 1);
});

test("Revolut EUR and GBP ledger rows use canonical channels without changing provider semantics", () => {
  const context = buildLedgerTestContext();
  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-05-02",
      channel: "REVOLUT евро",
      localAmount: 10,
      currency: "EUR",
      category: "serviceIncome",
      direction: "income",
      source: "revolut",
      rawSourceId: "revolut:rev-eur",
      amountNet: 10
    },
    {
      date: "2026-05-03",
      channel: "REVOLUT фунт",
      localAmount: 7,
      currency: "GBP",
      category: "business",
      direction: "expense",
      source: "revolut",
      rawSourceId: "revolut:rev-gbp",
      amountNet: -7
    }
  ]));

  assert.deepEqual(rows.map((row) => row.source), ["revolut", "revolut"]);
  assert.deepEqual(rows.map((row) => row.toChannel || row.fromChannel), ["REVOLUT евро", "REVOLUT фунт"]);
  assert.deepEqual(rows.map((row) => row.currency), ["EUR", "GBP"]);
});

test("normalizeManualLedgerRowsForSave reports added duplicate and skipped counts", () => {
  const context = buildLedgerTestContext();
  const saved = plain(context.normalizeManualLedgerRowsForSave([
    {
      date: "2026-05-01",
      operation: "income",
      toChannel: "пейпал дол",
      amount: "120",
      currency: "USD",
      category: "servicein",
      source: "ocr",
      externalId: "ocr:row-1",
      rawSourceId: "ocr:row-1"
    },
    {
      date: "2026-05-01",
      operation: "income",
      toChannel: "пейпал дол",
      amount: "120",
      currency: "USD",
      category: "servicein",
      source: "ocr",
      externalId: "ocr:row-1",
      rawSourceId: "ocr:row-1"
    },
    {
      date: "",
      operation: "income",
      toChannel: "пейпал дол",
      amount: "20",
      currency: "USD",
      category: "servicein",
      source: "ocr"
    }
  ], []));

  assert.equal(saved.added_count, 1);
  assert.equal(saved.duplicate_count, 1);
  assert.equal(saved.skipped_count, 1);
});

test("normalizeManualLedgerRowsForSave fills UAH amount_usd and preserves detail fields", () => {
  const context = buildLedgerTestContext();
  const normalized = plain(context.normalizeManualLedgerRowsForSave([
    {
      date: "2026-05-01",
      operation: "business_expense",
      fromChannel: "приват 24-грн",
      amount: "4386",
      currency: "UAH",
      category: "business",
      counterparty: "ТОВ Сервіс",
      description: "Privat payment",
      externalId: "PB-DETAIL-1",
      source: "privatbank"
    }
  ]));

  assert.equal(normalized.warnings.length, 0);
  assert.equal(normalized.rows[0].amountUsd, "100,0000");
  assert.equal(normalized.rows[0].counterparty, "ТОВ Сервіс");
  assert.equal(normalized.rows[0].description, "Privat payment");
  assert.equal(normalized.rows[0].externalId, "PB-DETAIL-1");
  assert.equal(normalized.rows[0].source, "privatbank");
});

test("normalizeManualLedgerRowsForSave derives non-PayPal net when incoming net is blank", () => {
  const context = buildLedgerTestContext();
  const saved = plain(context.normalizeManualLedgerRowsForSave([
    {
      date: "2026-05-06",
      operation: "income",
      toChannel: "монобанк грн",
      amount: "253",
      currency: "UAH",
      amountNet: "",
      category: "servicein",
      direction: "in",
      source: "monobank",
      externalId: "mono-blank-net",
      rawSourceId: "mono-blank-net"
    },
    {
      date: "2026-05-06",
      operation: "income",
      toChannel: "Яндекс руб",
      amount: "438.98",
      currency: "RUB",
      amount_net: "",
      category: "servicein",
      direction: "in",
      source: "yoomoney",
      externalId: "yoomoney-blank-net",
      rawSourceId: "yoomoney-blank-net"
    }
  ]));

  assert.equal(saved.rows.length, 2);
  assert.equal(saved.rows[0].amountNet, "253,0000");
  assert.equal(saved.rows[1].amountNet, "438,9800");
});

test("normalizeManualLedgerRowsForSave keeps PayPal net blank when fee is unavailable", () => {
  const context = buildLedgerTestContext();
  const saved = plain(context.normalizeManualLedgerRowsForSave([
    {
      date: "2026-05-06",
      operation: "income",
      toChannel: "пейпал дол",
      amount: "200",
      currency: "USD",
      amountNet: "",
      category: "servicein",
      direction: "in",
      source: "paypal",
      externalId: "paypal-blank-net",
      rawSourceId: "paypal-blank-net"
    }
  ]));

  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].amountNet, "");
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
    { date: "2026-05-02", source: "other", displaySource: "other", operation: "personal_expense", fromChannel: "Яндекс руб", toChannel: "" },
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

test("detectExpenseAccountingLedgerConflicts warns about near manual TD duplicate without deleting entry", () => {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    },
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    inferManualFinanceChannelCurrency(channel) {
      return channel === "БАНК КАНАДА cad" ? "CAD" : "USD";
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
    `${extractFunction(uiJs, "getNormalizedLedgerFactOperation")}\n` +
    `${extractFunction(uiJs, "isTdBankExpenseSource")}\n` +
    `${extractFunction(uiJs, "getExpenseAccountingEntryConflictChannel")}\n` +
    `${extractFunction(uiJs, "getLedgerConflictChannel")}\n` +
    `${extractFunction(uiJs, "getIsoDateDistanceDays")}\n` +
    `${extractFunction(uiJs, "detectExpenseAccountingLedgerConflicts")}\n` +
    "this.detectExpenseAccountingLedgerConflicts = detectExpenseAccountingLedgerConflicts;",
    context
  );

  const conflicts = plain(context.detectExpenseAccountingLedgerConflicts([
    {
      date: "2026-04-16",
      channel: "БАНК КАНАДА cad",
      localAmount: 1000,
      currency: "CAD",
      source: "tdbank_csv"
    }
  ], [
    {
      date: "2026-04-25",
      operation: "personal_expense",
      source: "manual",
      fromChannel: "БАНК КАНАДА cad",
      amount: "1000",
      currency: "CAD"
    }
  ]));

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "near_manual_duplicate");
  assert.match(conflicts[0].message, /Похоже, эта TD операция уже внесена вручную/);
});

test("expense operations export includes TD rows and visible columns", () => {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getExpenseOperationsExportRows")}\n` +
    `${extractFunction(uiJs, "buildExpenseOperationsExportFileName")}\n` +
    "this.getExpenseOperationsExportRows = getExpenseOperationsExportRows;\n" +
    "this.buildExpenseOperationsExportFileName = buildExpenseOperationsExportFileName;",
    context
  );

  const exportRows = plain(context.getExpenseOperationsExportRows([
    {
      date: "2026-04-30",
      operation: "business_expense",
      displaySource: "td_bank",
      fromChannel: "БАНК КАНАДА cad",
      toChannel: "",
      amount: "17.95",
      currency: "CAD",
      amountUsd: "13.283",
      amountGross: "17.95",
      amountFee: "",
      amountNet: "17.95",
      category: "business",
      comment: "MONTHLY ACCOUNT FEE",
      rawSourceId: "tdbank_csv-2026-04-30-MONTHLY ACCOUNT FEE-17.95-25",
      externalId: "tdbank_csv-2026-04-30-MONTHLY ACCOUNT FEE-17.95-25"
    }
  ]));

  assert.deepEqual(exportRows[0], [
    "date", "operation", "source", "from_channel", "to_channel", "amount", "currency", "amount_usd", "gross", "fee", "net", "category", "comment", "raw_source_id", "external_id"
  ]);
  assert.deepEqual(exportRows[1], [
    "2026-04-30", "business_expense", "td_bank", "БАНК КАНАДА cad", "", "17.95", "CAD", "13.283", "17.95", "", "17.95", "business", "MONTHLY ACCOUNT FEE", "tdbank_csv-2026-04-30-MONTHLY ACCOUNT FEE-17.95-25", "tdbank_csv-2026-04-30-MONTHLY ACCOUNT FEE-17.95-25"
  ]);
  assert.equal(context.buildExpenseOperationsExportFileName({ startDate: "2026-04-01", endDate: "2026-04-30" }), "ledger-operations-2026-04-01-to-2026-04-30.csv");
});

test("saveExpenseAccountingEntries reloads ledger-backed analysis before clearing temporary entries", async () => {
  const calls = [];
  const context = {
    state: {
      expenseAccounting: {
        entries: [
          { date: "2026-05-01", channel: "БАНК КАНАДА cad", localAmount: 12.34 }
        ],
        loading: false,
        paypalSummary: { provider: "paypal" },
        wiseSummary: { provider: "wise" },
        yoomoneySummary: { provider: "yoomoney" },
        monobankSummary: { provider: "mono" },
        privatBankSummary: { provider: "pb" },
        tdBankSummary: { provider: "td" }
      },
      data: { manual: { operations: [] } },
      manualFinance: { data: { ledgerRows: [] } }
    },
    hasConfiguredManualFinanceEndpoint() {
      return true;
    },
    hasManualFinanceEndpointConfig() {
      return true;
    },
    ensureGoogleAccess: async () => {
      calls.push("ensureGoogleAccess");
    },
    getManualFinanceUnavailableMessage() {
      return "unavailable";
    },
    detectExpenseAccountingLedgerConflicts() {
      return [];
    },
    saveExpenseAccountingEntriesDirect: async (entries) => {
      calls.push(`save:${entries.length}`);
      assert.equal(context.state.expenseAccounting.entries.length, 1);
      return { rowCount: 1, savedAt: "saved-now" };
    },
    loadDashboardData: async () => {
      calls.push(`reload:entries=${context.state.expenseAccounting.entries.length}`);
      assert.equal(context.state.expenseAccounting.entries.length, 1);
    },
    setExpenseAccountingStatus(message, isError) {
      calls.push(`status:${isError ? "error" : "ok"}`);
      context.status = { message, isError };
    },
    renderTabs() {
      calls.push(`render:loading=${context.state.expenseAccounting.loading}`);
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `async ${extractFunction(uiJs, "saveExpenseAccountingEntries")}\nthis.saveExpenseAccountingEntries = saveExpenseAccountingEntries;`,
    context
  );

  await context.saveExpenseAccountingEntries();

  assert.deepEqual(calls.slice(0, 4), [
    "render:loading=true",
    "save:1",
    "reload:entries=1",
    "status:ok"
  ]);
  assert.deepEqual(context.status, {
    message: "Значения внесены: 1 агрегированных строк. saved-now",
    isError: false
  });
  assert.deepEqual(plain(context.state.expenseAccounting.entries), []);
  assert.equal(context.state.expenseAccounting.paypalSummary, null);
  assert.equal(context.state.expenseAccounting.wiseSummary, null);
  assert.equal(context.state.expenseAccounting.yoomoneySummary, null);
  assert.equal(context.state.expenseAccounting.monobankSummary, null);
  assert.equal(context.state.expenseAccounting.privatBankSummary, null);
  assert.equal(context.state.expenseAccounting.tdBankSummary, null);
  assert.equal(context.state.expenseAccounting.loading, false);
  assert.equal(calls.at(-1), "render:loading=false");
});
