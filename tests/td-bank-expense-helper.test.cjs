const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
const importerJs = fs.readFileSync(path.join(__dirname, "..", "td-easyweb-importer.js"), "utf8");
const tdAccountActivityFixture = [
  "\"2026-04-06\",\"E-TRANSFER ***PzG\",,\"150\",\"10924.33\"",
  "\"2026-04-07\",\"CITY LIFE PHARM\",\"18.45\",,\"10905.88\"",
  "\"2026-04-08\",\"E-TRANSFER ***KpQ\",,\"450\",\"11355.88\"",
  "\"2026-04-08\",\"FOODS FOR LIFE\",\"49.88\",,\"11306\"",
  "\"2026-04-08\",\"HUA SHENG SUPER   _F\",\"27.25\",,\"11278.75\"",
  "\"2026-04-08\",\"BULK BARN #700    _F\",\"9.87\",,\"11268.88\"",
  "\"2026-04-08\",\"DOLLARAMA # 666   _F\",\"2.26\",,\"11266.62\"",
  "\"2026-04-09\",\"COLLEGE STREET    _F\",\"115\",,\"11151.62\"",
  "\"2026-04-13\",\"APPLE.COM/BILL    _V\",\"40.66\",,\"11110.96\"",
  "\"2026-04-13\",\"SEND E-TFR ***eMs\",\"150\",,\"10960.96\"",
  "\"2026-04-16\",\"TD ATM W/D    004164\",\"1000\",,\"9960.96\"",
  "\"2026-04-20\",\"SDM 1393\",\"158.99\",,\"9801.97\"",
  "\"2026-04-20\",\"LU190 TFR-TO C/C\",\"344\",,\"9457.97\"",
  "\"2026-04-20\",\"E-TRANSFER ***sMX\",,\"300\",\"9757.97\"",
  "\"2026-04-21\",\"E-TRANSFER ***vpd\",,\"100\",\"9857.97\"",
  "\"2026-04-22\",\"APPLE.COM/BILL    _V\",\"1.46\",,\"9856.51\"",
  "\"2026-04-22\",\"CITY OF TORONTO   _F\",\"235\",,\"9621.51\"",
  "\"2026-04-23\",\"PRES/RLLS8LMPHF   _T\",\"3.3\",,\"9618.21\"",
  "\"2026-04-24\",\"APPLE.COM/BILL    _V\",\"40.66\",,\"9577.55\"",
  "\"2026-04-27\",\"FREEDOM MOBILE    _V\",\"39.55\",,\"9538\"",
  "\"2026-04-27\",\"APPLE.COM/BILL    _V\",,\"20.33\",\"9558.33\"",
  "\"2026-04-28\",\"APPLE.COM/BILL    _V\",,\"20.33\",\"9578.66\"",
  "\"2026-04-28\",\"APPLE.COM/BILL    _V\",,\"20.33\",\"9598.99\"",
  "\"2026-04-29\",\"APPLE.COM/BILL    _V\",,\"20.33\",\"9619.32\"",
  "\"2026-04-30\",\"APPLE.COM/BILL    _V\",\"11.85\",,\"9607.47\"",
  "\"2026-04-30\",\"MONTHLY ACCOUNT FEE\",\"17.95\",,\"9589.52\"",
  "\"2026-04-30\",\"ACCT BAL REBATE\",,\"17.95\",\"9607.47\"",
  "\"2026-05-01\",\"PRES/RN58V2SPQ9   _T\",\"3.3\",,\"9604.17\"",
  "\"2026-05-01\",\"SEND E-TFR ***bwX\",\"170\",,\"9434.17\"",
].join("\n");

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

function makeTdActivityDocument() {
  function cell(text, tagName = "td") {
    return {
      tagName: tagName.toUpperCase(),
      textContent: text,
      innerText: text,
      children: [],
      querySelectorAll(selector) {
        if (selector === "th, td, [role='cell'], [role='columnheader']") return [];
        return [];
      },
    };
  }
  function row(cells) {
    return {
      tagName: "TR",
      textContent: cells.map((item) => item.textContent).join(" "),
      innerText: cells.map((item) => item.textContent).join("\n"),
      children: cells,
      querySelectorAll(selector) {
        if (selector === "th, td, [role='cell'], [role='columnheader']") return cells;
        return [];
      },
    };
  }
  const headerRow = row([
    cell("Date", "th"),
    cell("Transaction Description", "th"),
    cell("Withdrawals", "th"),
    cell("Deposits", "th"),
    cell("Balance", "th"),
  ]);
  const withdrawalRow = row([
    cell("May 1, 2026"),
    cell("SEND E-TFR ***bwX"),
    cell("$170.00"),
    cell(""),
    cell("$9,434.17"),
  ]);
  const depositRow = row([
    cell("Apr 30, 2026"),
    cell("ACCT BAL REBATE"),
    cell(""),
    cell("$17.95"),
    cell("$9,607.47"),
  ]);
  const rows = [headerRow, withdrawalRow, depositRow];
  const table = {
    tagName: "TABLE",
    textContent: rows.map((item) => item.textContent).join(" "),
    innerText: rows.map((item) => item.innerText).join("\n"),
    querySelectorAll(selector) {
      if (selector === "tr, [role='row']") return rows;
      if (selector === "th, td, [role='cell'], [role='columnheader']") return rows.flatMap((item) => item.children);
      return [];
    },
  };
  return {
    body: { textContent: "TD EasyWeb Activity" },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "table") return [table];
      if (selector === "tr, [role='row']") return rows;
      return [];
    },
  };
}

function runTdEasyWebImporter(document) {
  const context = { document, window: {} };
  vm.createContext(context);
  vm.runInContext(importerJs, context);
  return plain(context.window.TD_EASYWEB_IMPORTER.collect());
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
      data: { manual: { operations: [] } },
      manualFinance: { data: { ledgerRows: [] } },
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
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    inferManualFinanceChannelCurrency(channel) {
      return channel === "БАНК КАНАДА cad" ? "CAD" : "USD";
    },
    parseLooseNumber(value) {
      const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber(value, digits = 4) {
      return Number(value || 0).toFixed(digits).replace(".", ",");
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
  assert.match(uiJs, /state\.expenseAccounting\.activeSubtab = "operations"/);
  assert.match(uiJs, /TD строки импортированы, но ещё не внесены в Ledger/);
  assert.match(uiJs, /Внести значения и обновить анализ/);
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

test("TD import creates unsaved entries and switches to operations with warning", async () => {
  const context = {
    state: {
      expenseAccounting: {
        tdBankLoading: false,
        entries: [{ source: "paypal", id: "keep" }],
        tdBankSummary: null,
        warnings: ["old"],
        resultTab: "received",
        activeSubtab: "list",
        tdImportStep: "waiting",
        tdImportClipboardRetry: false,
      }
    },
    readTdBankPayloadText: async () => "payload",
    parseTdBankClipboardPayload(raw) {
      assert.equal(raw, "payload");
      return { items: [{ id: 1 }] };
    },
    normalizeTdBankClipboardEntries() {
      return [{ source: "tdbank", id: "td-1" }];
    },
    applyTdBankExpenseEntries(entries, options = {}) {
      context.state.expenseAccounting.entries = [
        ...context.state.expenseAccounting.entries.filter((entry) => entry.source !== "tdbank"),
        ...entries
      ];
      context.state.expenseAccounting.tdBankSummary = { count: entries.length };
      context.state.expenseAccounting.warnings = [];
      context.state.expenseAccounting.resultTab = "spent";
      context.state.expenseAccounting.activeSubtab = "operations";
      context.status = { message: options.message, isError: false };
    },
    renderTabs() {
      context.renderCount = (context.renderCount || 0) + 1;
    },
    setExpenseAccountingStatus(message, isError) {
      context.status = { message, isError };
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getUnsavedExpenseAccountingNoticeMessage")}\n` +
    `async ${extractFunction(uiJs, "loadTdBankExpenseStatementFromClipboard")}\n` +
    "this.loadTdBankExpenseStatementFromClipboard = loadTdBankExpenseStatementFromClipboard;",
    context
  );

  await context.loadTdBankExpenseStatementFromClipboard();

  assert.deepEqual(plain(context.state.expenseAccounting.entries), [
    { source: "paypal", id: "keep" },
    { source: "tdbank", id: "td-1" }
  ]);
  assert.equal(context.state.expenseAccounting.activeSubtab, "operations");
  assert.equal(context.state.expenseAccounting.resultTab, "spent");
  assert.deepEqual(plain(context.state.expenseAccounting.warnings), []);
  assert.deepEqual(context.status, {
    message: "TD строки импортированы, но ещё не внесены в Ledger. Нажмите ‘внести значения’, чтобы они появились в анализе финансов.",
    isError: false
  });
});

test("analysis tab warns when unsaved TD entries exist", () => {
  function createNode(tagName) {
    return {
      tagName,
      children: [],
      style: {},
      className: "",
      textContent: "",
      disabled: false,
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      append(...items) {
        this.children.push(...items);
      },
      addEventListener() {}
    };
  }

  const context = {
    state: {
      expenseAccounting: {
        loading: false,
        entries: [{ source: "tdbank", id: "td-1" }]
      }
    },
    document: {
      createElement(tagName) {
        return createNode(tagName);
      }
    },
    saveExpenseAccountingEntries() {}
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "hasUnsavedExpenseAccountingEntries")}\n` +
    `${extractFunction(uiJs, "getUnsavedExpenseAccountingNoticeMessage")}\n` +
    `${extractFunction(uiJs, "renderUnsavedExpenseAccountingNotice")}\n` +
    "this.renderUnsavedExpenseAccountingNotice = renderUnsavedExpenseAccountingNotice;",
    context
  );

  const notice = context.renderUnsavedExpenseAccountingNotice({ includeAction: true });
  assert.equal(notice.className, "finance-status expense-unsaved-notice");
  assert.equal(notice.children[0].textContent, "TD строки импортированы, но ещё не внесены в Ledger. Нажмите ‘внести значения’, чтобы они появились в анализе финансов.");
  assert.equal(notice.children[1].children[0].textContent, "Внести значения и обновить анализ");
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
      rawMetadata: "balance 2400.00 CAD",
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
      rawMetadata: "balance 2500.00 CAD",
      confidence: 0.9,
      source: "tdbank_csv",
      sourceTransactionId: "tdbank_csv-2026-04-12-Client deposit-100-1",
    },
  ]);
});

test("parseTdBankCsvEntries accepts TD CSV without headers and keeps balance out of amount", () => {
  const context = buildTdBankRuntimeContext({ tdImportStep: "ready" });
  const rows = plain(context.parseTdBankCsvEntries([
    "\"2026-04-06\",\"E-TRANSFER ***PzG\",,\"150\",\"10924.33\"",
    "\"2026-04-07\",\"CITY LIFE PHARM\",\"18.45\",,\"10905.88\"",
  ].join("\n")));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].direction, "income");
  assert.equal(rows[0].localAmount, 150);
  assert.equal(rows[0].currency, "CAD");
  assert.equal(rows[1].direction, "expense");
  assert.equal(rows[1].localAmount, 18.45);
  assert.equal(rows[1].currency, "CAD");
  assert.match(rows[0].rawMetadata, /balance 10924\.33 CAD/);
  assert.equal(rows[1].sourceTransactionId, "tdbank_csv-2026-04-07-CITY LIFE PHARM-18.45-1");
});

test("TD account activity fixture keeps expected debit and credit totals with one 1000 CAD ATM withdrawal", () => {
  const context = buildTdBankRuntimeContext({ tdImportStep: "ready" });
  context.elements.endDate.value = "2026-05-31";
  const rows = plain(context.parseTdBankCsvEntries(tdAccountActivityFixture));
  const totals = rows.reduce((summary, row) => {
    if (row.direction === "income") summary.deposits += row.localAmount;
    if (row.direction === "expense") summary.withdrawals += row.localAmount;
    if (row.localAmount === 1000 && /TD ATM W\/D/i.test(row.organization || "")) summary.atmRows += 1;
    return summary;
  }, { withdrawals: 0, deposits: 0, atmRows: 0 });

  assert.equal(rows.length, 29);
  assert.equal(Number(totals.withdrawals.toFixed(2)), 2439.43);
  assert.equal(Number(totals.deposits.toFixed(2)), 1099.27);
  assert.equal(totals.atmRows, 1);
});

test("browser OCR parser keeps amount rows with upload date fallback", () => {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    isPrivat24ExpenseOcrContext() {
      return false;
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
      source: "browser_ocr",
      sourceImageIndex: 2,
    },
  ]);
});

test("td easyweb importer exposes collect helper", () => {
  assert.match(importerJs, /window\.TD_EASYWEB_IMPORTER = \{ collect \}/);
  assert.match(importerJs, /provider: "tdbank"/);
});

test("td easyweb importer parses current Activity table columns", () => {
  const payload = runTdEasyWebImporter(makeTdActivityDocument());

  assert.equal(payload.debug.tdActivityTableFound, true);
  assert.equal(payload.debug.rowsFound, 2);
  assert.equal(payload.debug.parsedRows, 2);
  assert.equal(payload.items.length, 2);
  assert.deepEqual(payload.items.map((item) => ({
    occurredAt: item.occurredAt,
    name: item.name,
    amount: item.amount,
    direction: item.direction,
    cashFlowDirection: item.cashFlowDirection,
    runningBalance: item.runningBalance,
  })), [
    {
      occurredAt: "2026-05-01",
      name: "SEND E-TFR ***bwX",
      amount: 170,
      direction: "expense",
      cashFlowDirection: "out",
      runningBalance: 9434.17,
    },
    {
      occurredAt: "2026-04-30",
      name: "ACCT BAL REBATE",
      amount: 17.95,
      direction: "income",
      cashFlowDirection: "in",
      runningBalance: 9607.47,
    },
  ]);
});
