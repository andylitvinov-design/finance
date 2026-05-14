const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");

function extractFunction(source, name) {
  const candidates = [`async function ${name}`, `function ${name}`];
  let start = -1;
  for (const candidate of candidates) {
    start = source.indexOf(candidate);
    if (start !== -1) break;
  }
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

function buildFinanceContext() {
  const context = {
    MANUAL_FINANCE_LEDGER_TITLE: "Ledger",
    MANUAL_FINANCE_BALANCE_TITLE: "Остатки",
    MANUAL_FINANCE_HEADERS: [],
    MANUAL_TRANSFER_HEADERS: [],
    MANUAL_BALANCE_HEADERS: [],
    MANUAL_FINANCE_MONEY_TITLE: "расходы по каналам",
    MANUAL_FINANCE_EXPENSE_TITLE: "Расходы",
    MANUAL_INCOMING_TITLE: "fact",
    MANUAL_DATE_RE: /^\d{4}-\d{2}-\d{2}$/,
    state: {
      config: { manualFinance: { spreadsheetUrl: "sheet-url" } },
      manualFinance: { activeInnerTab: "balances", data: null, dirty: false, loading: false },
      data: { tabs: { movement: { values: [] } } },
      analyticsFact: {},
    },
    elements: { startDate: { value: "2026-05-14" }, endDate: { value: "2026-05-14" } },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    },
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    normalizeManualFinancePersistedNumberInput(value) {
      const raw = String(value ?? "").trim();
      return raw ? raw.replace(".", ",") : "";
    },
    inferManualFinanceChannelCurrency(channel) {
      return /евр|eur/i.test(String(channel || "")) ? "EUR" : "USD";
    },
    getManualFinanceChannels() {
      return ["Налично -я-евр", "нал-мам-дол", "трансервайз дол"];
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    normalizeManualFinanceMoneyRows(rows) {
      return rows || [];
    },
    buildLegacyFactMoneyRowsFromExpenseRows() {
      return [];
    },
    normalizeManualFinanceExpenseRows(rows) {
      return rows || [];
    },
    normalizeManualFinanceTransferRows(rows) {
      return rows || [];
    },
    buildManualExpenseHeaders() {
      return [];
    },
    formatSheetNumber(value) {
      return Number(value || 0).toFixed(4).replace(".", ",");
    },
    renderTabs() {},
    renderMetrics() {},
    syncAnalyticsFactFromManualData() {},
    setManualFinanceStatus(message, isError = false) {
      context.lastStatus = { message, isError };
    },
    hasConfiguredManualFinanceEndpoint() {
      return true;
    },
    getManualFinanceUnavailableMessage() {
      return "unavailable";
    },
    async loadDashboardData() {
      context.loadedDashboard = true;
    },
    async syncMainAnalyticsFactImportFromMoneyRows() {
      context.syncedLegacyFact = true;
    },
    async saveBalanceSnapshotRowsDirect(rows) {
      context.savedBalanceRows = rows;
      return { rowCount: rows.length, savedAt: "balance-saved" };
    },
    async saveExpenseAccountingEntriesDirect(entries) {
      context.savedCashEntries = entries;
      return { ledgerRowCount: entries.length, savedAt: "cash-saved" };
    },
    async saveManualSheetDirect() {
      context.legacyFactSaveCalled = true;
      return { savedAt: "legacy-saved" };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "normalizeManualFinanceBalanceRows")}\n` +
      `${extractFunction(financeJs, "isManualFinanceCashChannel")}\n` +
      `${extractFunction(financeJs, "getManualFinanceCashChannels")}\n` +
      `${extractFunction(financeJs, "normalizeManualFinanceCashRows")}\n` +
      `${extractFunction(financeJs, "buildManualFinanceCashRowsFromLedgerRows")}\n` +
      `${extractFunction(financeJs, "buildManualFinanceCashEntries")}\n` +
      `${extractFunction(financeJs, "formatManualFinanceStableIdPart")}\n` +
      `${extractFunction(financeJs, "saveManualFinanceBalanceRows")}\n` +
      `${extractFunction(financeJs, "saveManualFinanceCashRows")}\n` +
      `${extractFunction(financeJs, "saveManualFinanceSheet")}\n` +
      "this.normalizeManualFinanceBalanceRows = normalizeManualFinanceBalanceRows;\n" +
      "this.normalizeManualFinanceCashRows = normalizeManualFinanceCashRows;\n" +
      "this.buildManualFinanceCashEntries = buildManualFinanceCashEntries;\n" +
      "this.saveManualFinanceSheet = saveManualFinanceSheet;",
    context
  );
  return context;
}

test("saving balance snapshot uses Остатки writer and does not call legacy fact Ledger save", async () => {
  const context = buildFinanceContext();
  context.state.manualFinance.activeInnerTab = "balances";
  context.state.manualFinance.data = {
    periodStart: "2026-05-14",
    periodEnd: "2026-05-14",
    balanceRows: [
      { date: "2026-05-14", channel: "трансервайз дол", amount: "120.45", currency: "USD", comment: "actual" },
    ],
    cashRows: [
      { date: "2026-05-14", channel: "Налично -я-евр", direction: "income", amount: "99", currency: "EUR" },
    ],
    moneyRows: [],
    transferRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.deepEqual(plain(context.savedBalanceRows), [
    { date: "2026-05-14", channel: "трансервайз дол", amount: "120,45", currency: "USD", rate: "", usdAmount: "", comment: "actual" },
  ]);
  assert.equal(context.savedCashEntries, undefined);
  assert.equal(context.legacyFactSaveCalled, undefined);
  assert.match(context.lastStatus.message, /Остатки/);
});

test("cash income maps to manual Ledger entry with cash toChannel semantics", () => {
  const context = buildFinanceContext();
  const entries = plain(context.buildManualFinanceCashEntries([
    { date: "2026-05-14", channel: "Налично -я-евр", direction: "income", amount: "75", currency: "EUR", category: "servicein", comment: "cash sale" },
  ]));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "manual");
  assert.equal(entries[0].direction, "income");
  assert.equal(entries[0].channel, "Налично -я-евр");
  assert.equal(entries[0].localAmount, 75);
  assert.equal(entries[0].amountNet, 75);
  assert.equal(entries[0].amount_net, 75);
  assert.equal(entries[0].category, "servicein");
});

test("cash expense maps to manual Ledger entry with cash fromChannel semantics", () => {
  const context = buildFinanceContext();
  const entries = plain(context.buildManualFinanceCashEntries([
    { date: "2026-05-14", channel: "нал-мам-дол", direction: "expense", amount: "42.5", currency: "USD", category: "food", subcategory: "meal", comment: "cash meal" },
  ]));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "manual");
  assert.equal(entries[0].direction, "expense");
  assert.equal(entries[0].channel, "нал-мам-дол");
  assert.equal(entries[0].localAmount, 42.5);
  assert.equal(entries[0].amountNet, 42.5);
  assert.equal(entries[0].amount_net, 42.5);
  assert.equal(entries[0].category, "food");
  assert.equal(entries[0].subcategory, "meal");
});

test("fact UI has separate inner tabs for balances and cash", () => {
  assert.match(uiJs, /Остатки \/ Баланс/);
  assert.match(uiJs, /Наличные/);
  assert.match(uiJs, /renderManualFinanceBalanceEditor/);
  assert.match(uiJs, /renderManualFinanceCashEditor/);
});
