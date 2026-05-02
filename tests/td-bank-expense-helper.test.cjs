const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
const importerJs = fs.readFileSync(path.join(__dirname, "..", "td-easyweb-importer.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
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

function buildTdBankRuntimeContext(options = {}) {
  const context = {
    state: {
      expenseAccounting: {
        tdBankLoading: false,
        tdImportStep: options.tdImportStep || "ready",
        tdImportClipboardRetry: false,
        entries: [],
        warnings: [],
        resultTab: "spent",
        tdBankSummary: null,
      },
    },
    elements: {
      startDate: { value: "2026-04-01" },
      endDate: { value: "2026-04-30" },
    },
    navigator: {
      clipboard: {
        readText: async () => options.clipboardText || "",
        writeText: async () => true,
      },
    },
    window: {
      open() {},
      prompt() { return ""; },
    },
    normalizeIncomingSheetDateValue(value) {
      const raw = String(value || "").trim();
      const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slash) return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
      return raw;
    },
    normalizeExpenseAccountingEntry(entry) {
      return entry;
    },
    parseLooseNumber(value) {
      const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    buildProviderExpenseSummary(entries) {
      return { months: [], totalsByCurrency: {}, entryCount: entries.length };
    },
    getExpenseAccountingDirectionCounts() {
      return { spent: 1, received: 0 };
    },
    setExpenseAccountingStatus(message, isError = false) {
      context.lastStatus = { message, isError };
    },
    renderTabs() {},
    lastStatus: { message: "", isError: false },
  };
  vm.createContext(context);
  vm.runInContext(
    `${uiJs}\n` +
    "renderTabs = function() {};\n" +
    "normalizeExpenseAccountingEntry = function(entry) { return entry; };\n" +
    "setExpenseAccountingStatus = function(message, isError) { globalThis.lastStatus = { message, isError: Boolean(isError) }; };\n" +
    "buildProviderExpenseSummary = function(entries) { return { months: [], totalsByCurrency: {}, entryCount: entries.length }; };\n" +
    "getExpenseAccountingDirectionCounts = function() { return { spent: 1, received: 0 }; };\n" +
    "this.tryAutoImportTdBankFromClipboard = tryAutoImportTdBankFromClipboard;\n" +
    "this.parseTdBankCsvEntries = parseTdBankCsvEntries;",
    context
  );
  return context;
}

test("expense UI exposes TD Bank helper wiring", () => {
  assert.match(uiJs, /TD Bank import/);
  assert.match(uiJs, /Начать TD импорт/);
  assert.match(uiJs, /startOrContinueTdImport/);
  assert.match(uiJs, /tryAutoImportTdBankFromClipboard/);
  assert.match(uiJs, /handleTdBankWindowFocus/);
  assert.match(uiJs, /importTdBankCsvStatementFile/);
  assert.match(uiJs, /tdImportStep/);
  assert.match(uiJs, /loadTdBankExpenseStatementFromClipboard/);
  assert.match(uiJs, /parseTdBankClipboardPayload/);
  assert.match(uiJs, /readTdBankPayloadText/);
  assert.match(uiJs, /window\.prompt\("Вставьте TD Bank JSON из буфера обмена"/);
  assert.match(uiJs, /td-easyweb-importer\.js/);
  assert.match(uiJs, /https:\/\/easyweb\.td\.com\//);
  assert.match(uiJs, /state\.expenseAccounting\.tdBankLoading/);
  assert.match(uiJs, /state\.expenseAccounting\.tdBankSummary/);
  assert.match(uiJs, /tdBankCsvInput\.accept = "\.csv,text\/csv"/);
});

test("parseTdBankClipboardPayload rejects non-json clipboard text with a friendly TD Bank error", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "parseTdBankClipboardPayload")}\n` +
    "this.parseTdBankClipboardPayload = parseTdBankClipboardPayload;",
    context
  );

  assert.throws(
    () => context.parseTdBankClipboardPayload("Задача: проверить TD Bank импорт"),
    (error) => {
      assert.match(error.message, /В буфере обмена не TD Bank JSON/);
      assert.doesNotMatch(error.message, /Unexpected token|SyntaxError/);
      assert.doesNotMatch(error.message, /Скопировать TD bookmarklet|Импортировать TD из буфера/);
      return true;
    }
  );
});

test("parseTdBankClipboardPayload accepts TD Bank JSON payload", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "parseTdBankClipboardPayload")}\n` +
    "this.parseTdBankClipboardPayload = parseTdBankClipboardPayload;",
    context
  );

  assert.deepEqual(
    plain(context.parseTdBankClipboardPayload('{ "source": { "provider": "tdbank" }, "items": [] }')),
    { source: { provider: "tdbank" }, items: [] }
  );
});

test("parseTdBankClipboardPayload rejects JSON from another provider with a friendly TD Bank error", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "parseTdBankClipboardPayload")}\n` +
    "this.parseTdBankClipboardPayload = parseTdBankClipboardPayload;",
    context
  );

  assert.throws(
    () => context.parseTdBankClipboardPayload('{ "source": { "provider": "paypal" }, "items": [] }'),
    /В буфере нет TD Bank payload/
  );
});

test("normalizeTdBankClipboardEntries maps clipboard payload into ledger entries", () => {
  const context = {
    elements: {
      startDate: { value: "2026-04-01" },
      endDate: { value: "2026-04-30" },
    },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    normalizeExpenseAccountingEntry(entry) {
      return entry;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "compactTdBankDescription")}\n` +
    `${extractFunction(uiJs, "normalizeTdBankClipboardEntries")}\n` +
    "this.normalizeTdBankClipboardEntries = normalizeTdBankClipboardEntries;",
    context
  );

  const rows = plain(context.normalizeTdBankClipboardEntries({
    source: { provider: "tdbank", requestedStartDate: "2026-04-01", requestedEndDate: "2026-04-30" },
    items: [
      {
        occurredAt: "2026-04-11",
        direction: "expense",
        amount: 12.34,
        currency: "CAD",
        name: "Coffee",
        accountName: "TD Bank Chequing",
        runningBalance: 2400,
        runningBalanceCurrency: "CAD",
        providerTransactionId: "txn-1",
      },
      {
        occurredAt: "2026-05-01",
        direction: "expense",
        amount: 9.99,
        currency: "CAD",
      },
    ],
  }));

  assert.deepEqual(rows, [
    {
      date: "2026-04-11",
      channel: "БАНК КАНАДА cad",
      direction: "expense",
      localAmount: 12.34,
      currency: "CAD",
      usdAmount: null,
      suggestedCategory: "business",
      organization: "Coffee | account TD Bank Chequing | balance 2400 CAD",
      confidence: 0.95,
      source: "tdbank",
      sourceTransactionId: "txn-1",
    },
  ]);
});

test("tryAutoImportTdBankFromClipboard imports valid TD JSON on focus", async () => {
  const context = buildTdBankRuntimeContext({
    clipboardText: JSON.stringify({
      source: { provider: "tdbank", requestedStartDate: "2026-04-01", requestedEndDate: "2026-04-30" },
      items: [{ occurredAt: "2026-04-11", direction: "expense", amount: 12.34, currency: "CAD", name: "Coffee" }],
    }),
    tdImportStep: "waiting",
  });

  assert.equal(await context.tryAutoImportTdBankFromClipboard(), true);
  assert.equal(context.state.expenseAccounting.tdImportStep, "ready");
  assert.equal(context.state.expenseAccounting.tdImportClipboardRetry, false);
  assert.equal(context.state.expenseAccounting.entries.length, 1);
  assert.equal(context.state.expenseAccounting.entries[0].source, "tdbank");
  assert.match(context.lastStatus.message, /автоматически: 1 строк/);
});

test("tryAutoImportTdBankFromClipboard handles non-TD clipboard without raw errors", async () => {
  const context = buildTdBankRuntimeContext({
    clipboardText: "not a td payload",
    tdImportStep: "waiting",
  });

  assert.equal(await context.tryAutoImportTdBankFromClipboard(), false);
  assert.equal(context.state.expenseAccounting.tdImportStep, "ready");
  assert.equal(context.state.expenseAccounting.tdImportClipboardRetry, true);
  assert.equal(context.state.expenseAccounting.entries.length, 0);
  assert.match(context.lastStatus.message, /TD JSON не найден/);
  assert.doesNotMatch(context.lastStatus.message, /Unexpected token|SyntaxError/);
});

test("parseTdBankCsvEntries maps TD CSV rows into ledger entries", () => {
  const context = buildTdBankRuntimeContext({ tdImportStep: "ready" });
  const rows = plain(context.parseTdBankCsvEntries([
    "Transaction Date,Description,Debit,Credit,Currency,Balance",
    "04/11/2026,Coffee,12.34,,CAD,2400.00",
    "04/12/2026,Client deposit,,100.00,CAD,2500.00",
    "05/01/2026,Outside period,9.99,,CAD,2490.01",
  ].join("\n")));

  assert.deepEqual(rows, [
    {
      date: "2026-04-11",
      channel: "БАНК КАНАДА cad",
      direction: "expense",
      localAmount: 12.34,
      currency: "CAD",
      usdAmount: null,
      suggestedCategory: "business",
      organization: "Coffee",
      counterparty: "Coffee",
      confidence: 0.9,
      source: "tdbank_csv",
      sourceTransactionId: "tdbank_csv-2026-04-11-Coffee-12.34-0",
    },
    {
      date: "2026-04-12",
      channel: "БАНК КАНАДА cad",
      direction: "income",
      localAmount: 100,
      currency: "CAD",
      usdAmount: null,
      suggestedCategory: "serviceIncome",
      organization: "Client deposit",
      counterparty: "Client deposit",
      confidence: 0.9,
      source: "tdbank_csv",
      sourceTransactionId: "tdbank_csv-2026-04-12-Client deposit-100-1",
    },
  ]);
});

test("browser OCR parser keeps amount rows with upload date fallback", () => {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    extractExpenseOcrDate(line) {
      const match = String(line || "").match(/^DATE:(.+)$/);
      return match ? match[1].trim() : "";
    },
    extractExpenseOcrAmount(line) {
      const match = String(line || "").match(/^AMOUNT:(\d+(?:\.\d+)?)\s+([A-Z]{3})$/);
      return match ? { amount: Number(match[1]), currency: match[2] } : null;
    },
    inferExpenseOcrChannel() {
      return "монобанк грн";
    },
    inferExpenseOcrDirection() {
      return "expense";
    },
    inferExpenseOcrCategory() {
      return "business";
    },
    cleanupExpenseOcrOrganization(line) {
      return String(line || "").trim();
    },
    normalizeExpenseAccountingEntry(entry) {
      return entry;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "parseExpenseOcrText")}\n` +
    "this.parseExpenseOcrText = parseExpenseOcrText;",
    context
  );

  const parsed = plain(context.parseExpenseOcrText("AMOUNT:120.5 USD", 2, "2026-04-30"));
  assert.deepEqual(parsed.entries, [
    {
      date: "2026-04-30",
      dateSource: "upload_fallback",
      uploadedAtDate: "2026-04-30",
      channel: "монобанк грн",
      direction: "expense",
      localAmount: 120.5,
      currency: "USD",
      usdAmount: null,
      suggestedCategory: "business",
      organization: "AMOUNT:120.5 USD",
      counterparty: "AMOUNT:120.5 USD",
      confidence: 0.45,
      sourceImageIndex: 2,
    },
  ]);
});

test("td easyweb importer exposes collect helper", () => {
  assert.match(importerJs, /window\.TD_EASYWEB_IMPORTER = \{ collect \}/);
  assert.match(importerJs, /provider: "tdbank"/);
});
