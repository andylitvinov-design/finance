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
      if (/сad|cad/i.test(String(channel || ""))) return "CAD";
      return /евр|eur/i.test(String(channel || "")) ? "EUR" : "USD";
    },
    getManualFinanceChannels() {
      return ["Налично -я-евр", "нал-мам-дол", "пейпал сad", "трансервайз дол"];
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
    async saveManualSheetDirect(payload) {
      context.legacyFactSaveCalled = true;
      context.savedManualPayload = payload;
      return { savedAt: "legacy-saved" };
    },
  };
  vm.createContext(context);
  vm.runInContext(
      `${extractFunction(financeJs, "normalizeManualFinanceBalanceRows")}\n` +
      `${extractFunction(financeJs, "ensureManualFinanceBalanceInputRows")}\n` +
      `${extractFunction(financeJs, "buildManualFinanceActiveBalancePairs")}\n` +
      `${extractFunction(financeJs, "isManualFinanceCashChannel")}\n` +
      `${extractFunction(financeJs, "getManualFinanceCashChannels")}\n` +
      `${extractFunction(financeJs, "normalizeManualFinanceCashRows")}\n` +
      `${extractFunction(financeJs, "buildManualFinanceCashRowsFromLedgerRows")}\n` +
      `${extractFunction(financeJs, "buildManualFinanceCashEntries")}\n` +
      `${extractFunction(financeJs, "formatManualFinanceStableIdPart")}\n` +
      `${extractFunction(financeJs, "isSavableManualFinanceBalanceRow")}\n` +
      `${extractFunction(financeJs, "countSavableManualFinanceBalanceRows")}\n` +
      `${extractFunction(financeJs, "hasManualFinanceBalanceValue")}\n` +
      `${extractFunction(financeJs, "resolveManualFinanceBalanceSavedCount")}\n` +
      `${extractFunction(financeJs, "collectManualFinanceBalanceRowsFromEditor")}\n` +
      `${extractFunction(financeJs, "saveManualFinanceBalanceRows")}\n` +
      `${extractFunction(financeJs, "saveManualFinanceCashRows")}\n` +
      `${extractFunction(financeJs, "saveManualFinanceSheet")}\n` +
      "this.normalizeManualFinanceBalanceRows = normalizeManualFinanceBalanceRows;\n" +
      "this.ensureManualFinanceBalanceInputRows = ensureManualFinanceBalanceInputRows;\n" +
      "this.buildManualFinanceActiveBalancePairs = buildManualFinanceActiveBalancePairs;\n" +
      "this.normalizeManualFinanceCashRows = normalizeManualFinanceCashRows;\n" +
      "this.buildManualFinanceCashEntries = buildManualFinanceCashEntries;\n" +
      "this.collectManualFinanceBalanceRowsFromEditor = collectManualFinanceBalanceRowsFromEditor;\n" +
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
      { date: "2026-05-14", channel: "Налично -я-евр", amount: "0", currency: "EUR", comment: "zero actual" },
      { date: "2026-05-14", channel: "нал-мам-дол", amount: "10", currency: "USD", comment: "" },
      { date: "2026-05-14", channel: "пейпал сad", amount: "1", currency: "CAD", comment: "" },
    ],
    cashRows: [
      { date: "2026-05-14", channel: "Налично -я-евр", direction: "income", amount: "99", currency: "EUR" },
    ],
    moneyRows: [],
    transferRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.deepEqual(plain(context.savedBalanceRows), [
    { date: "2026-05-14", channel: "Налично -я-евр", amount: "0", currency: "EUR", rate: "", usdAmount: "", comment: "zero actual" },
    { date: "2026-05-14", channel: "нал-мам-дол", amount: "10", currency: "USD", rate: "", usdAmount: "", comment: "" },
    { date: "2026-05-14", channel: "пейпал сad", amount: "1", currency: "CAD", rate: "", usdAmount: "", comment: "" },
    { date: "2026-05-14", channel: "трансервайз дол", amount: "120,45", currency: "USD", rate: "", usdAmount: "", comment: "actual" },
  ]);
  assert.equal(context.savedCashEntries, undefined);
  assert.equal(context.legacyFactSaveCalled, undefined);
  assert.equal(context.lastStatus.message, "Остатки сохранены: 4 из 4 строк. balance-saved");
  assert.equal(context.lastStatus.isError, false);
});

test("saving balance snapshot reads current editor DOM values before writing", async () => {
  const context = buildFinanceContext();
  const domRows = [
    {
      date: "2026-05-17",
      channel: "Налично -я-евр",
      currency: "EUR",
      amount: "0",
      rate: "",
      usdAmount: "",
      comment: "zero typed"
    },
    {
      date: "2026-05-17",
      channel: "нал-мам-дол",
      currency: "USD",
      amount: "10",
      rate: "",
      usdAmount: "",
      comment: ""
    },
    {
      date: "2026-05-17",
      channel: "пейпал сad",
      currency: "CAD",
      amount: "1",
      rate: "",
      usdAmount: "",
      comment: ""
    },
    {
      date: "2026-05-17",
      channel: "Яндекс руб",
      currency: "RUB",
      amount: "70203.51",
      rate: "",
      usdAmount: "",
      comment: "typed before save"
    },
    {
      date: "2026-05-17",
      channel: "монобанк грн",
      currency: "UAH",
      amount: "14033",
      rate: "",
      usdAmount: "",
      comment: ""
    }
  ];
  context.document = {
    querySelector(selector) {
      if (selector !== "[data-manual-balance-editor]") return null;
      return {
        querySelectorAll(rowSelector) {
          assert.equal(rowSelector, "tr[data-manual-balance-row]");
          return domRows.map((row) => ({
            querySelector(fieldSelector) {
              const field = fieldSelector.match(/"([^"]+)"/)?.[1];
              return { value: row[field] || "" };
            }
          }));
        }
      };
    }
  };
  context.state.manualFinance.activeInnerTab = "balances";
  context.state.manualFinance.data = {
    periodStart: "2026-05-17",
    periodEnd: "2026-05-17",
    balanceRows: [
      { date: "2026-05-17", channel: "Яндекс руб", amount: "", currency: "RUB", comment: "" },
    ],
    cashRows: [],
    moneyRows: [],
    transferRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.deepEqual(plain(context.savedBalanceRows), [
    { date: "2026-05-17", channel: "Налично -я-евр", amount: "0", currency: "EUR", rate: "", usdAmount: "", comment: "zero typed" },
    { date: "2026-05-17", channel: "нал-мам-дол", amount: "10", currency: "USD", rate: "", usdAmount: "", comment: "" },
    { date: "2026-05-17", channel: "пейпал сad", amount: "1", currency: "CAD", rate: "", usdAmount: "", comment: "" },
    { date: "2026-05-17", channel: "Яндекс руб", amount: "70203,51", currency: "RUB", rate: "", usdAmount: "", comment: "typed before save" },
    { date: "2026-05-17", channel: "монобанк грн", amount: "14033", currency: "UAH", rate: "", usdAmount: "", comment: "" },
  ]);
  assert.match(context.lastStatus.message, /5 из 5 строк/);
});

test("saving balance snapshot reports partial save when only one of many expected rows is saved", async () => {
  const context = buildFinanceContext();
  context.saveBalanceSnapshotRowsDirect = async (rows) => {
    context.savedBalanceRows = rows;
    return { rowCount: 1, savedAt: "partial" };
  };
  context.state.manualFinance.activeInnerTab = "balances";
  context.state.manualFinance.data = {
    periodStart: "2026-05-17",
    periodEnd: "2026-05-17",
    balanceRows: [
      { date: "2026-05-17", channel: "Налично -я-евр", amount: "1", currency: "EUR", comment: "" },
      { date: "2026-05-17", channel: "нал-мам-дол", amount: "2", currency: "USD", comment: "" },
      { date: "2026-05-17", channel: "пейпал сad", amount: "3", currency: "CAD", comment: "" },
      { date: "2026-05-17", channel: "трансервайз дол", amount: "4", currency: "USD", comment: "" },
    ],
    cashRows: [],
    moneyRows: [],
    transferRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.equal(context.lastStatus.isError, true);
  assert.match(context.lastStatus.message, /Остатки сохранены не полностью: сохранено 1 из 4 строк/);
});

test("balance snapshot save blocks suspicious one-row partial editor collection", async () => {
  const context = buildFinanceContext();
  context.getManualFinanceChannels = () => Array.from({ length: 24 }, (_, index) => `канал ${index + 1}`);
  context.document = {
    querySelector(selector) {
      if (selector !== "[data-manual-balance-editor]") return null;
      return {
        querySelectorAll() {
          return [{
            querySelector(fieldSelector) {
              const field = fieldSelector.match(/"([^"]+)"/)?.[1];
              const row = { date: "2026-05-17", channel: "канал 1", currency: "USD", amount: "1", rate: "", usdAmount: "", comment: "" };
              return { value: row[field] || "" };
            }
          }];
        }
      };
    }
  };
  context.state.manualFinance.activeInnerTab = "balances";
  context.state.manualFinance.data = {
    periodStart: "2026-05-17",
    periodEnd: "2026-05-17",
    balanceRows: [],
    ledgerRows: [],
    cashRows: [],
    moneyRows: [],
    transferRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.equal(context.savedBalanceRows, undefined);
  assert.equal(context.lastStatus.isError, true);
  assert.equal(context.lastStatus.message, "Остатки сохранены не полностью: собрано 1 из 24 строк. Проверьте таблицу Факт.");
});

test("balance snapshot save preserves explicit zero rows", async () => {
  const context = buildFinanceContext();
  context.state.manualFinance.activeInnerTab = "balances";
  context.state.manualFinance.data = {
    periodStart: "2026-05-17",
    periodEnd: "2026-05-17",
    balanceRows: [
      { date: "2026-05-17", channel: "Налично -я-евр", amount: "0", currency: "EUR", comment: "zero" },
      { date: "2026-05-17", channel: "нал-мам-дол", amount: "0", currency: "USD", comment: "zero" },
      { date: "2026-05-17", channel: "пейпал сad", amount: "0", currency: "CAD", comment: "zero" },
      { date: "2026-05-17", channel: "трансервайз дол", amount: "0", currency: "USD", comment: "zero" },
    ],
    ledgerRows: [],
    cashRows: [],
    moneyRows: [],
    transferRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.deepEqual(plain(context.savedBalanceRows).map((row) => [row.channel, row.amount]), [
    ["Налично -я-евр", "0"],
    ["нал-мам-дол", "0"],
    ["пейпал сad", "0"],
    ["трансервайз дол", "0"],
  ]);
  assert.equal(context.lastStatus.message, "Остатки сохранены: 4 из 4 строк. balance-saved");
});

test("balance snapshot save reports server partial write response as error", async () => {
  const context = buildFinanceContext();
  context.saveBalanceSnapshotRowsDirect = async (rows) => {
    context.savedBalanceRows = rows;
    return { rowCount: 1, savedAt: "partial-save" };
  };
  context.state.manualFinance.activeInnerTab = "balances";
  context.state.manualFinance.data = {
    periodStart: "2026-05-17",
    periodEnd: "2026-05-17",
    balanceRows: [
      { date: "2026-05-17", channel: "Налично -я-евр", amount: "2", currency: "EUR", comment: "" },
      { date: "2026-05-17", channel: "нал-мам-дол", amount: "3", currency: "USD", comment: "" },
      { date: "2026-05-17", channel: "пейпал сad", amount: "4", currency: "CAD", comment: "" },
      { date: "2026-05-17", channel: "трансервайз дол", amount: "5", currency: "USD", comment: "" },
    ],
    ledgerRows: [],
    cashRows: [],
    moneyRows: [],
    transferRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.equal(context.savedBalanceRows.length, 4);
  assert.equal(context.lastStatus.isError, true);
  assert.equal(context.lastStatus.message, "Остатки сохранены не полностью: сохранено 1 из 4 строк.");
});

test("saving legacy fact range carries current balance rows into manual finance payload", async () => {
  const context = buildFinanceContext();
  context.state.manualFinance.activeInnerTab = "legacy";
  context.state.manualFinance.data = {
    periodStart: "2026-05-17",
    periodEnd: "2026-05-17",
    moneyRows: [
      { channel: "трансервайз дол", now: "1070.48", serviceIncome: "", business: "", food: "", house: "", fun: "", study: "", travelFun: "", exchange: "" },
    ],
    transferRows: [],
    balanceRows: [
      { date: "2026-05-17", channel: "трансервайз дол", amount: "1070.48", currency: "USD", comment: "typed in fact balance table" },
      { date: "2026-05-17", channel: "монобанк грн", amount: "", currency: "UAH", comment: "" },
    ],
    cashRows: [],
    expenseRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.deepEqual(plain(context.savedManualPayload.balanceRows), [
    { date: "2026-05-17", channel: "трансервайз дол", amount: "1070,48", currency: "USD", rate: "", usdAmount: "", comment: "typed in fact balance table" },
  ]);
});

test("saving legacy fact range also writes non-empty balance rows to Остатки", async () => {
  const context = buildFinanceContext();
  context.state.manualFinance.activeInnerTab = "legacy";
  context.state.manualFinance.data = {
    periodStart: "2026-05-01",
    periodEnd: "2026-05-19",
    moneyRows: [],
    transferRows: [],
    balanceRows: [
      { date: "2026-05-19", channel: "Яндекс руб", amount: "70203.51", currency: "RUB", comment: "typed via legacy fact" },
      { date: "2026-05-19", channel: "монобанк грн", amount: "", currency: "UAH", comment: "" },
    ],
    cashRows: [],
    expenseRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.deepEqual(plain(context.savedBalanceRows), [
    { date: "2026-05-19", channel: "Яндекс руб", amount: "70203,51", currency: "RUB", rate: "", usdAmount: "", comment: "typed via legacy fact" },
  ]);
  assert.equal(context.lastStatus.isError, false);
});

test("saving legacy fact range reports partial Остатки write as an error", async () => {
  const context = buildFinanceContext();
  context.saveBalanceSnapshotRowsDirect = async (rows) => {
    context.savedBalanceRows = rows;
    return { rowCount: 0, savedAt: "partial" };
  };
  context.state.manualFinance.activeInnerTab = "legacy";
  context.state.manualFinance.data = {
    periodStart: "2026-05-01",
    periodEnd: "2026-05-19",
    moneyRows: [],
    transferRows: [],
    balanceRows: [
      { date: "2026-05-19", channel: "Яндекс руб", amount: "70203.51", currency: "RUB", comment: "typed via legacy fact" },
    ],
    cashRows: [],
    expenseRows: [],
  };

  await context.saveManualFinanceSheet();

  assert.equal(context.lastStatus.isError, true);
  assert.equal(context.lastStatus.message, "Остатки сохранены не полностью: сохранено 0 из 1 строк.");
});

test("balance snapshot editor expands every configured channel as target-date input rows", () => {
  const context = buildFinanceContext();
  context.state.manualFinance.data = {
    periodStart: "2026-05-14",
    periodEnd: "2026-05-15",
    balanceRows: [
      { date: "2026-05-15", channel: "трансервайз дол", amount: "120.45", currency: "USD", comment: "actual" },
    ],
    ledgerRows: [
      { date: "2026-05-10", operation: "income", toChannel: "приват-фоп", currency: "UAH" },
      { date: "2026-05-11", operation: "exchange_in", toChannel: "Бинанс spot", currency: "USDT" },
    ],
    cashRows: [],
    moneyRows: [],
    transferRows: [],
  };

  const rows = plain(context.ensureManualFinanceBalanceInputRows());

  assert.deepEqual(rows.map((row) => [row.date, row.channel, row.currency, row.amount]), [
    ["2026-05-15", "Налично -я-евр", "EUR", ""],
    ["2026-05-15", "нал-мам-дол", "USD", ""],
    ["2026-05-15", "пейпал сad", "CAD", ""],
    ["2026-05-15", "трансервайз дол", "USD", "120,45"],
    ["2026-05-15", "приват-фоп", "UAH", ""],
    ["2026-05-15", "Бинанс spot", "USDT", ""],
  ]);
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
  assert.match(uiJs, /Date", "Channel", "Currency", "Balance", "Status/);
  assert.match(uiJs, /ensureManualFinanceBalanceInputRows/);
  assert.match(uiJs, /manualBalanceEditor/);
  assert.match(uiJs, /manualBalanceField/);
});

test("fact tab opens the selected period instead of forcing today", () => {
  const source = extractFunction(uiJs, "openManualFinanceToday");
  assert.doesNotMatch(source, /setToday\(\)/);
  assert.match(source, /loadManualFinanceSheet\(elements\.startDate\.value, elements\.endDate\.value, true\)/);
});
