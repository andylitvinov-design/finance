const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const googleSheetsJs = fs.readFileSync(path.join(root, "google-sheets.js"), "utf8");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");

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

test("expense analysis UI keeps refresh action and scrollable tables", () => {
  assert.match(uiJs, /refreshExpenseFinancialAnalysis/);
  assert.match(uiJs, /refreshButton\.textContent = state\.expenseAccounting\.loading \? "Обновляю\.\.\." : "Обновить"/);
  assert.match(uiJs, /analysis-table-wrap/);
  assert.match(uiJs, /renderPlainTable\(rows\)/);
  assert.doesNotMatch(uiJs, /renderResponsiveDataView\(rows, \{ mobileTableColumnCount: 2 \}\)/);
  assert.match(styleCss, /\.analysis-table-wrap table \{ min-width: 640px; \}/);
});

test("expense accounting UI renders dedicated counterparty column that stays visible on mobile", () => {
  assert.match(uiJs, /textContent = "От кого \/ Кому"/);
  assert.match(uiJs, /buildExpenseAccountingCounterpartyLabel\(entry\)/);
  assert.match(uiJs, /buildExpenseAccountingReadableCounterparty\(entry\)/);
  assert.match(uiJs, /buildExpenseAccountingTechnicalDetails\(entry\)/);
  assert.match(uiJs, /summary\.textContent = "технические детали"/);
  assert.match(uiJs, /button\.textContent = "Указать вручную"/);
  assert.match(uiJs, /→/);
  assert.match(styleCss, /\.expense-table-counterparty/);
  assert.match(styleCss, /\.expense-counterparty-label/);
  assert.match(styleCss, /\.expense-counterparty-hint/);
  assert.match(styleCss, /\.expense-counterparty-details/);
  assert.match(styleCss, /\.expense-counterparty-manual/);
  assert.match(styleCss, /\.expense-table-mobile-card/);
});

test("PayPal counterparty UI hides technical metadata from the main label", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "normalizeExpenseAccountingEntityLabel")}\n` +
    `${extractFunction(uiJs, "buildExpenseAccountingCounterpartyLabel")}\n` +
    `${extractFunction(uiJs, "buildExpenseAccountingFromToLabel")}\n` +
    `${extractFunction(uiJs, "isPayPalExchangeEntry")}\n` +
    `${extractFunction(uiJs, "isTechnicalPayPalCounterpartyValue")}\n` +
    `${extractFunction(uiJs, "getReadablePayPalCounterpartyName")}\n` +
    `${extractFunction(uiJs, "isUnknownPayPalCounterparty")}\n` +
    `${extractFunction(uiJs, "buildExpenseAccountingReadableCounterparty")}\n` +
    `${extractFunction(uiJs, "buildExpenseAccountingTechnicalDetails")}\n` +
    "this.buildExpenseAccountingReadableCounterparty = buildExpenseAccountingReadableCounterparty;\n" +
    "this.buildExpenseAccountingTechnicalDetails = buildExpenseAccountingTechnicalDetails;",
    context
  );

  const unknown = {
    source: "paypal",
    direction: "expense",
    displayFromTo: "Me → :5sLyij!q6Kz\\z72hU8j",
    counterpartyLabel: "Кому: :5sLyij!q6Kz\\z72hU8j",
    operationType: "payout",
    externalId: "2202611623284821200_1",
    exchangeGroupId: "2202611623284821200_1",
    rawMetadata: "2202611623284821200_1 | invoice 2202611623284821200_1 | event T0200",
    description: "2202611623284821200_1 | invoice 2202611623284821200_1 | event T0200",
  };
  assert.equal(context.buildExpenseAccountingReadableCounterparty(unknown), "Получатель не распознан");
  assert.doesNotMatch(context.buildExpenseAccountingReadableCounterparty(unknown), /invoice|event|external|raw|220261/i);
  assert.match(context.buildExpenseAccountingTechnicalDetails(unknown), /external id: 2202611623284821200_1/);
  assert.match(context.buildExpenseAccountingTechnicalDetails(unknown), /event T0200/);

  assert.equal(context.buildExpenseAccountingReadableCounterparty({
    source: "paypal",
    direction: "exchange",
    operationType: "exchange",
    displayFromTo: "PayPal CAD → PayPal EUR",
  }), "Обмен: PayPal CAD → PayPal EUR");
});

test("PayPal manual counterparty override maps stable provider ids to readable labels", () => {
  const store = {};
  const context = {
    localStorage: {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => {
        store[key] = value;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    "const PAYPAL_COUNTERPARTY_OVERRIDES_STORAGE_KEY = \"ezohata:paypal-counterparty-overrides:v1\";\n" +
    `${extractFunction(uiJs, "getPayPalCounterpartyOverrideKey")}\n` +
    `${extractFunction(uiJs, "loadPayPalCounterpartyOverrides")}\n` +
    `${extractFunction(uiJs, "applyPayPalCounterpartyOverride")}\n` +
    `${extractFunction(uiJs, "savePayPalCounterpartyOverride")}\n` +
    "this.savePayPalCounterpartyOverride = savePayPalCounterpartyOverride;\n" +
    "this.applyPayPalCounterpartyOverride = applyPayPalCounterpartyOverride;",
    context
  );

  const entry = {
    source: "paypal",
    direction: "expense",
    sourceTransactionId: "TXN-1",
    toEntity: "counterparty unavailable",
    displayFromTo: "Me → counterparty unavailable",
  };
  assert.equal(context.savePayPalCounterpartyOverride(entry, "Manual Name"), true);
  assert.equal(entry.counterpartyName, "Manual Name");
  assert.equal(entry.counterpartyLabel, "Кому: Manual Name");
  assert.equal(entry.displayFromTo, "Me → Manual Name");
  assert.equal(entry.manualCounterpartyOverride, true);
  assert.match(store["ezohata:paypal-counterparty-overrides:v1"], /paypal:TXN-1/);
});

function buildLedgerAnalysisTestContext(extra = {}) {
  return {
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол", "трансервайз дол", "монобанк грн"],
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
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
    roundProviderSummaryAmount(value) {
      return Math.round((Number(value) || 0) * 10000) / 10000;
    },
    canonicalManualFinanceChannel(value) {
      const normalized = String(value || "").trim().toLowerCase();
      return ({
        "paypal usd": "пейпал дол",
        "пейпал дол": "пейпал дол",
        "wise": "трансервайз дол",
        "wise usd": "трансервайз дол",
        "transferwise": "трансервайз дол",
        "трансервайз дол": "трансервайз дол",
        "monobank": "монобанк грн",
        "mono": "монобанк грн",
        "монобанк грн": "монобанк грн",
      })[normalized] || String(value || "").trim();
    },
    ...extra,
  };
}

function loadLedgerAnalysisHelpers(context) {
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getLedgerFactAmountUsd")}\n` +
    `${extractFunction(uiJs, "getNormalizedLedgerFactOperation")}\n` +
    `${extractFunction(uiJs, "isExpenseAnalysisKnownChannel")}\n` +
    `${extractFunction(uiJs, "getLedgerIncomeChannel")}\n` +
    `${extractFunction(uiJs, "isLedgerProviderIncomeSource")}\n` +
    `${extractFunction(uiJs, "getLedgerExpenseChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerRealIncomeSummaryByChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerProviderExpenseByChannel")}\n` +
    "this.buildLedgerRealIncomeSummaryByChannel = buildLedgerRealIncomeSummaryByChannel;\n" +
    "this.buildLedgerProviderExpenseByChannel = buildLedgerProviderExpenseByChannel;",
    context
  );
}

test("ledger expense analysis uses amount_usd before amount_net and does not treat RUB or UAH local net as USD", () => {
  const context = buildLedgerAnalysisTestContext();
  loadLedgerAnalysisHelpers(context);

  const rows = [
    { operation: "income", source: "manual", toChannel: "paypal usd", amountUsd: "100", amountNet: "96", currency: "USD" },
    { operation: "income", source: "fact", toChannel: "wise usd", amountUsd: "80", amountNet: "81", currency: "USD" },
    { operation: "income", source: "migration", toChannel: "paypal usd", amountUsd: "75", amountNet: "75", currency: "USD" },
    { operation: "servicein", source: "wise", toChannel: "wise usd", amountUsd: "200", amountNet: "1210.25", currency: "USD" },
    { operation: "ezoin", source: "mcp", to_channel: "wise", amount_usd: "50", amount_net: "48.5", currency: "USD" },
    { operation: "business_expense", source: "mcp", fromChannel: "monobank", amountUsd: "942", amountNet: "85956", currency: "RUB" },
    { operation: "expense", source: "paypal", fromChannel: "monobank", amount_usd: "51", amount_net: "2100", currency: "UAH" },
    { operation: "exchange_out", source: "mcp", from_channel: "paypal usd", amount_usd: "-12", amount_net: "", currency: "USD" },
  ];

  assert.deepEqual(plain(context.buildLedgerRealIncomeSummaryByChannel(rows)), {
    "пейпал дол": { realNetUsd: 0 },
    "трансервайз дол": { realNetUsd: 250 },
    "монобанк грн": { realNetUsd: 0 },
  });
  assert.deepEqual(plain(context.buildLedgerProviderExpenseByChannel(rows)), {
    "пейпал дол": 12,
    "трансервайз дол": 0,
    "монобанк грн": 993,
  });
});

test("expense analysis summary keeps Wise real income 978.5 when Ledger rows exist", () => {
  const ledgerRows = [
    { operation: "income", source: "manual", toChannel: "paypal usd", amountUsd: "100", amountNet: "96", currency: "USD" },
    { operation: "servicein", source: "fact", toChannel: "wise usd", amountUsd: "200", amountNet: "0", currency: "USD" },
    { operation: "business_expense", source: "mcp", fromChannel: "monobank", amountUsd: "30", amountNet: "85956", currency: "RUB" },
  ];
  const context = buildLedgerAnalysisTestContext({
    state: {
      aggregatedManualRange: null,
      manualTransfers: { data: null },
      manualFinance: { data: null },
      expenseAccounting: {
        entries: [],
        paypalSummary: { totalsByCurrency: { USD: { expense: 999 } }, months: [{ totalsByCurrency: { USD: {} } }] },
      },
      data: {
        realIncome: { summaryByChannel: { "пейпал дол": { realNetUsd: 999 }, "трансервайз дол": { realNetUsd: 978.5 } } },
        tabs: { movement: { values: [] } },
      },
    },
    getCurrentAnalyticsManualRows() {
      return [];
    },
    buildManualFinanceUsdRateLookup() {
      return {};
    },
    getExpenseOperationsRows() {
      return ledgerRows;
    },
    calculateMovementChannelStats() {
      return { accruedPlusByChannel: {} };
    },
    sumManualFinanceFieldUsdNumber() {
      return 0;
    },
    getManualFinanceFieldUsdNumber() {
      return 0;
    },
    getActivePayPalSummary() {
      throw new Error("provider summaries should not be used when Ledger rows exist");
    },
  });
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "roundExpenseAnalysisAmount")}\n` +
    `${extractFunction(financeJs, "getManualFinancePlannedExpenseUsdNumber")}\n` +
    `${extractFunction(financeJs, "buildExpenseAnalysisChannelSummary")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisLedgerRows")}\n` +
    `${extractFunction(uiJs, "getLedgerFactAmountUsd")}\n` +
    `${extractFunction(uiJs, "getNormalizedLedgerFactOperation")}\n` +
    `${extractFunction(uiJs, "isExpenseAnalysisKnownChannel")}\n` +
    `${extractFunction(uiJs, "getLedgerIncomeChannel")}\n` +
    `${extractFunction(uiJs, "isLedgerProviderIncomeSource")}\n` +
    `${extractFunction(uiJs, "getLedgerExpenseChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerRealIncomeSummaryByChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerProviderExpenseByChannel")}\n` +
    `${extractFunction(uiJs, "getProviderEntryExpenseAmountUsd")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisProviderExpenseByChannel")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisChannelSummary")}\n` +
    "this.getExpenseAnalysisChannelSummary = getExpenseAnalysisChannelSummary;",
    context
  );

  const summary = plain(context.getExpenseAnalysisChannelSummary());
  assert.equal(summary.incomeTotals.realUsd, 1977.5);
  assert.equal(summary.expenseTotals.realUsd, 30);
  assert.equal(summary.rows.find((row) => row[0] === "пейпал дол")[4], "999,0000");
  assert.equal(summary.rows.find((row) => row[0] === "трансервайз дол")[4], "978,5000");
  assert.equal(summary.rows.find((row) => row[0] === "монобанк грн")[7], "30,0000");
});

test("aggregated manual service plan excludes provider, wise, paypal, and mcp income rows", () => {
  const context = {
    MANUAL_NOW_CATEGORY: "now",
    MANUAL_EXCHANGE_CATEGORY: "exchange",
    MANUAL_FINANCE_MONEY_CHANNELS: ["трансервайз дол", "пейпал дол"],
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
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    },
    normalizeCell(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    },
    getManualFinanceChannels() {
      return context.MANUAL_FINANCE_MONEY_CHANNELS.slice();
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "normalizeLookupText")}\n` +
    `${extractFunction(financeJs, "resolveManualFinanceChannelAlias")}\n` +
    `${extractFunction(financeJs, "canonicalManualFinanceChannel")}\n` +
    `${extractFunction(financeJs, "buildEmptyExpenseAmounts")}\n` +
    `${extractFunction(financeJs, "createManualFinanceExpenseRow")}\n` +
    `${extractFunction(financeJs, "mapLedgerV2CategoryToManualExpenseCategory")}\n` +
    `${extractFunction(financeJs, "normalizeLedgerServicePlanSource")}\n` +
    `${extractFunction(financeJs, "shouldIncludeLedgerRowInManualServicePlan")}\n` +
    `${extractFunction(financeJs, "getLedgerBalanceAmountForFinance")}\n` +
    `${extractFunction(financeJs, "getLedgerV2ManualChannel")}\n` +
    `${extractFunction(financeJs, "buildServerExpenseRowsFromLedgerV2")}\n` +
    "this.buildServerExpenseRowsFromLedgerV2 = buildServerExpenseRowsFromLedgerV2;",
    context
  );

  const rows = plain(context.buildServerExpenseRowsFromLedgerV2([
    { date: "2026-05-01", operation: "income", category: "servicein", source: "wise", toChannel: "трансервайз дол", amountUsd: "978.5", amountNet: "1210.25", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "paypal", toChannel: "пейпал дол", amountUsd: "20", amountNet: "20", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "provider", toChannel: "трансервайз дол", amountUsd: "30", amountNet: "30", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "mcp", toChannel: "трансервайз дол", amountUsd: "40", amountNet: "40", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "manual", toChannel: "трансервайз дол", amountUsd: "25", amountNet: "25", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "fact", toChannel: "пейпал дол", amountUsd: "15", amountNet: "15", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "migration", toChannel: "трансервайз дол", amountUsd: "5", amountNet: "5", currency: "USD" },
    { date: "2026-05-01", operation: "business_expense", category: "business", source: "mcp", fromChannel: "трансервайз дол", amountUsd: "10", amountNet: "10", currency: "USD" },
  ], "2026-05-01", "2026-05-31"));

  assert.deepEqual(rows, [
    {
      date: "2026-05-01",
      category: "business",
      amounts: {
        "трансервайз дол": "10,0000",
        "пейпал дол": "",
      },
    },
    {
      date: "2026-05-01",
      category: "serviceIncome",
      amounts: {
        "трансервайз дол": "30,0000",
        "пейпал дол": "15,0000",
      },
    },
  ]);
});

test("repository ledger expense rows also exclude provider, wise, paypal, and mcp from manual service plan", () => {
  const context = {
    MANUAL_NOW_CATEGORY: "now",
    MANUAL_FINANCE_MONEY_CHANNELS: ["трансервайз дол", "пейпал дол"],
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
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    },
    getManualFinanceChannels() {
      return context.MANUAL_FINANCE_MONEY_CHANNELS.slice();
    },
    normalizeCell(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "normalizeLookupText")}\n` +
    `${extractFunction(financeJs, "normalizeManualLedgerCategoryForStorage")}\n` +
    `${extractFunction(financeJs, "mapManualLedgerCategoryToLegacy")}\n` +
    `${extractFunction(financeJs, "normalizeManualLedgerOperation")}\n` +
    `${extractFunction(financeJs, "resolveManualFinanceChannelAlias")}\n` +
    `${extractFunction(financeJs, "canonicalManualFinanceChannel")}\n` +
    `${extractFunction(financeJs, "buildEmptyExpenseAmounts")}\n` +
    `${extractFunction(financeJs, "createManualFinanceExpenseRow")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerSource")}\n` +
    `${extractFunction(googleSheetsJs, "shouldIncludeLedgerRowInManualServicePlan")}\n` +
    `${extractFunction(googleSheetsJs, "buildExpenseRowsFromLedgerRows")}\n` +
    "this.buildExpenseRowsFromLedgerRows = buildExpenseRowsFromLedgerRows;",
    context
  );

  const rows = plain(context.buildExpenseRowsFromLedgerRows([
    { date: "2026-05-01", operation: "income", category: "servicein", source: "wise", toChannel: "трансервайз дол", amount: "1210.25", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "paypal", toChannel: "пейпал дол", amount: "20", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "provider", toChannel: "трансервайз дол", amount: "30", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "mcp", toChannel: "трансервайз дол", amount: "40", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "manual", toChannel: "трансервайз дол", amount: "25", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "fact", toChannel: "пейпал дол", amount: "15", currency: "USD" },
    { date: "2026-05-01", operation: "income", category: "servicein", source: "migration", toChannel: "трансервайз дол", amount: "5", currency: "USD" },
  ], "2026-05-01", "2026-05-31"));

  assert.deepEqual(rows, [
    {
      date: "2026-05-01",
      category: "serviceIncome",
      amounts: {
        "трансервайз дол": "30,0000",
        "пейпал дол": "15,0000",
      },
    },
  ]);
});

test("expense analysis falls back to existing summaries when Ledger is empty", () => {
  const context = buildLedgerAnalysisTestContext({
    state: {
      aggregatedManualRange: null,
      manualTransfers: { data: null },
      manualFinance: { data: null },
      expenseAccounting: {
        entries: [],
        paypalSummary: {
          months: [{ totalsByCurrency: { USD: { expense: 12, exchange: 3 } } }],
          totalsByCurrency: { USD: { expense: 12, exchange: 3 } },
        },
        wiseSummary: {
          months: [{ totalsByCurrency: { USD: { expense: 7 } } }],
          totalsByCurrency: { USD: { expense: 7 } },
        },
        yoomoneySummary: null,
        monobankSummary: null,
        privatBankSummary: null,
      },
      data: {
        realIncome: { summaryByChannel: { "пейпал дол": { realNetUsd: 123 } } },
        tabs: { movement: { values: [] } },
      },
    },
    getCurrentAnalyticsManualRows() {
      return [];
    },
    buildManualFinanceUsdRateLookup() {
      return {};
    },
    getExpenseOperationsRows() {
      return [];
    },
    calculateMovementChannelStats() {
      return { accruedPlusByChannel: {} };
    },
    sumManualFinanceFieldUsdNumber() {
      return 0;
    },
    getManualFinanceFieldUsdNumber() {
      return 0;
    },
    getActivePayPalSummary() {
      return context.state.expenseAccounting.paypalSummary;
    },
    getActiveWiseSummary() {
      return context.state.expenseAccounting.wiseSummary;
    },
    getActiveYooMoneySummary() {
      return null;
    },
    getActiveMonobankSummary() {
      return null;
    },
    getActivePrivatBankSummary() {
      return null;
    },
  });
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "roundExpenseAnalysisAmount")}\n` +
    `${extractFunction(financeJs, "getManualFinancePlannedExpenseUsdNumber")}\n` +
    `${extractFunction(financeJs, "buildExpenseAnalysisChannelSummary")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisLedgerRows")}\n` +
    `${extractFunction(uiJs, "getLedgerFactAmountUsd")}\n` +
    `${extractFunction(uiJs, "getNormalizedLedgerFactOperation")}\n` +
    `${extractFunction(uiJs, "isExpenseAnalysisKnownChannel")}\n` +
    `${extractFunction(uiJs, "getLedgerIncomeChannel")}\n` +
    `${extractFunction(uiJs, "isLedgerProviderIncomeSource")}\n` +
    `${extractFunction(uiJs, "getLedgerExpenseChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerRealIncomeSummaryByChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerProviderExpenseByChannel")}\n` +
    `${extractFunction(uiJs, "getProviderEntryExpenseAmountUsd")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisProviderExpenseByChannel")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisChannelSummary")}\n` +
    "this.getExpenseAnalysisProviderExpenseByChannel = getExpenseAnalysisProviderExpenseByChannel;\n" +
    "this.getExpenseAnalysisChannelSummary = getExpenseAnalysisChannelSummary;",
    context
  );

  assert.deepEqual(plain(context.getExpenseAnalysisProviderExpenseByChannel({})), {
    "пейпал дол": 15,
    "трансервайз дол": 7,
    "монобанк грн": 0,
  });
  const summary = plain(context.getExpenseAnalysisChannelSummary());
  assert.equal(summary.incomeTotals.realUsd, 123);
  assert.equal(summary.rows.find((row) => row[0] === "пейпал дол")[4], "123,0000");
});

test("provider expense entries use explicit USD and never treat local RUB net as USD", () => {
  const context = buildLedgerAnalysisTestContext({
    state: {
      expenseAccounting: {
        entries: [
          { direction: "expense", channel: "monobank", currency: "RUB", localAmount: 85956, amountNet: 85956, usdAmount: 942 },
        ],
      },
    },
    getExpenseAnalysisLedgerRows() {
      return [];
    },
  });
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getProviderEntryExpenseAmountUsd")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisProviderExpenseByChannel")}\n` +
    "this.getExpenseAnalysisProviderExpenseByChannel = getExpenseAnalysisProviderExpenseByChannel;",
    context
  );

  assert.equal(context.getExpenseAnalysisProviderExpenseByChannel({})["монобанк грн"], 942);
});

test("buildExpenseAnalysisProviderRows uses ACCRUED +3 as plan orders and manual rows for services/spend", () => {
  const context = {
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол", "пейпал евр", "пейпал сad"],
    ANALYTICS_PAYMENT_RULES: {},
    ANALYTICS_PAYOUTS_HELPER: {
      buildMovementPaymentSummaryRows: () => ([
        ["пейпал дол", "340,0000", "350,0000", "245,0000", "311,0600", "38,9400"],
        ["пейпал евр", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000"],
      ])
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
    `${extractFunction(financeJs, "getManualRowLocalSpendTotal")}\n` +
    `${extractFunction(financeJs, "buildExpenseAnalysisProviderRows")}\n` +
    "this.buildExpenseAnalysisProviderRows = buildExpenseAnalysisProviderRows;",
    context
  );

  const rows = plain(context.buildExpenseAnalysisProviderRows(
    {
      totalsByCurrency: {
        USD: { income: 311.06, expense: 120.5 },
        EUR: { income: 222.75, expense: 80.25 },
      }
    },
    [
      { channel: "пейпал дол", serviceIncome: "360,5000", business: "10,0000", flat: "15,0000", food: "0", fun: "0", study: "5,0000", travel: "0" },
      { channel: "пейпал евр", serviceIncome: "222,7500", business: "20,0000", flat: "0", food: "0", fun: "0", study: "0", travel: "12,5000" },
    ],
    [],
    { USD: "пейпал дол", EUR: "пейпал евр", CAD: "пейпал сad" }
  ));

  assert.deepEqual(rows, [
    ["пейпал дол", "350,0000", "360,5000", "710,5000", "311,0600", "30,0000", "120,5000"],
    ["пейпал евр", "0,0000", "222,7500", "222,7500", "222,7500", "32,5000", "80,2500"],
  ]);
});

test("buildExpenseAnalysisChannelSummary restores full channel reconciliation table with difference columns", () => {
  const context = {
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол", "пейпал евр"],
    calculateMovementChannelStats: () => ({
      accruedPlusByChannel: {
        "пейпал дол": 350,
        "пейпал евр": 0
      }
    }),
    sumManualFinanceFieldUsdNumber(rows, key) {
      return rows.reduce((sum, row) => sum + context.getManualFinanceFieldUsdNumber(row, key), 0);
    },
    getManualFinanceFieldUsdNumber(row, key) {
      const value = row?.[key];
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      return Number(raw.replace(",", "."));
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
    `${extractFunction(financeJs, "roundExpenseAnalysisAmount")}\n` +
    `${extractFunction(financeJs, "getManualFinancePlannedExpenseUsdNumber")}\n` +
    `${extractFunction(financeJs, "buildExpenseAnalysisChannelSummary")}\n` +
    "this.buildExpenseAnalysisChannelSummary = buildExpenseAnalysisChannelSummary;",
    context
  );

  const summary = plain(context.buildExpenseAnalysisChannelSummary({
    manualRows: [
      { channel: "пейпал дол", serviceIncome: "360,5000", business: "10,0000", flat: "15,0000", food: "0", fun: "0", study: "5,0000", travel: "0" },
      { channel: "пейпал евр", serviceIncome: "222,7500", business: "20,0000", flat: "0", food: "0", fun: "0", study: "0", travel: "12,5000" },
    ],
    movementValues: [],
    realIncomeSummaryByChannel: {
      "пейпал дол": { realNetUsd: 311.06 },
      "пейпал евр": { realNetUsd: 222.75 },
    },
    providerExpenseByChannel: {
      "пейпал дол": 120.5,
      "пейпал евр": 80.25,
    },
    usdRateLookup: {}
  }));

  assert.deepEqual(summary.rows, [
    ["канал", "план заказы", "план услуги", "план всего", "пришло реально", "разница", "потрачено план", "потрачено реал", "разница"],
    ["пейпал дол", "350,0000", "360,5000", "710,5000", "311,0600", "399,4400", "30,0000", "120,5000", "-90,5000"],
    ["пейпал евр", "0,0000", "222,7500", "222,7500", "222,7500", "0,0000", "32,5000", "80,2500", "-47,7500"],
    ["Итого", "350,0000", "583,2500", "933,2500", "533,8100", "399,4400", "62,5000", "200,7500", "-138,2500"],
  ]);
});

test("buildBalanceReconciliationByChannel uses latest balance snapshots on or before period bounds", () => {
  const context = {
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол", "Яндекс руб", "трансервайз евро"],
    MANUAL_FINANCE_FALLBACK_USD_RATES: { RUB: 1 / 84.5563, EUR: 1.16, LOCAL: 1 / 18 },
    getCanonicalManualChannelKey(value) {
      return String(value || "").trim();
    },
    normalizeCell(value) {
      return String(value || "").trim().toLowerCase();
    },
    inferManualFinanceChannelCurrency(channel) {
      if (channel === "Яндекс руб") return "RUB";
      if (channel === "трансервайз евро") return "EUR";
      return "USD";
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    roundExpenseAnalysisAmount(value) {
      return Math.round((Number(value) || 0) * 10000) / 10000;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "getBalanceReconciliationBalanceUsdAmount")}\n` +
    `${extractFunction(financeJs, "getBalanceReconciliationOperationChannel")}\n` +
    `${extractFunction(financeJs, "getBalanceReconciliationOperationUsdDelta")}\n` +
    `${extractFunction(financeJs, "buildLatestBalanceReconciliationSnapshotLookup")}\n` +
    `${extractFunction(financeJs, "buildBalanceReconciliationByChannel")}\n` +
    "this.buildBalanceReconciliationByChannel = buildBalanceReconciliationByChannel;",
    context
  );

  const summary = plain(context.buildBalanceReconciliationByChannel({
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    balances: [
      { date: "2026-04-29", channel: "пейпал дол", amount: "1000", currency: "USD", usdAmount: "1000" },
      { date: "2026-05-31", channel: "пейпал дол", amount: "1778.5", currency: "USD", usdAmount: "1778.5" },
      { date: "2026-04-28", channel: "Яндекс руб", amount: "84000", currency: "RUB", usdAmount: "1000" },
      { date: "2026-05-30", channel: "Яндекс руб", amount: "100000", currency: "RUB", usdAmount: "1200" },
      { date: "2026-05-31", channel: "трансервайз евро", amount: "200", currency: "EUR", usdAmount: "230" }
    ],
    operations: [
      { date: "2026-05-10", operation: "income", toChannel: "пейпал дол", currency: "USD", amount_usd: "778.5" },
      { date: "2026-05-15", operation: "business_expense", fromChannel: "Яндекс руб", currency: "RUB", amount_net: "85956", amount_usd: "942" }
    ]
  }));

  assert.equal(summary.rows.find((row) => row.channel === "пейпал дол").status, "OK");
  assert.equal(summary.rows.find((row) => row.channel === "Яндекс руб").status, "MISMATCH");
  assert.equal(summary.rows.find((row) => row.channel === "Яндекс руб").ledgerDelta, -942);
  assert.equal(summary.rows.find((row) => row.channel === "трансервайз евро").status, "NO_BALANCE");
});

test("buildBalanceReconciliationByChannel applies mixed operation signs in ledger delta", () => {
  const context = {
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол"],
    MANUAL_FINANCE_FALLBACK_USD_RATES: { LOCAL: 1 / 18 },
    getCanonicalManualChannelKey(value) {
      return String(value || "").trim();
    },
    normalizeCell(value) {
      return String(value || "").trim().toLowerCase();
    },
    inferManualFinanceChannelCurrency() {
      return "USD";
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    roundExpenseAnalysisAmount(value) {
      return Math.round((Number(value) || 0) * 10000) / 10000;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "getBalanceReconciliationBalanceUsdAmount")}\n` +
    `${extractFunction(financeJs, "getBalanceReconciliationOperationChannel")}\n` +
    `${extractFunction(financeJs, "getBalanceReconciliationOperationUsdDelta")}\n` +
    `${extractFunction(financeJs, "buildLatestBalanceReconciliationSnapshotLookup")}\n` +
    `${extractFunction(financeJs, "buildBalanceReconciliationByChannel")}\n` +
    "this.buildBalanceReconciliationByChannel = buildBalanceReconciliationByChannel;",
    context
  );

  const summary = plain(context.buildBalanceReconciliationByChannel({
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    balances: [
      { date: "2026-05-01", channel: "пейпал дол", amount: "100", currency: "USD", usdAmount: "100" },
      { date: "2026-05-31", channel: "пейпал дол", amount: "180", currency: "USD", usdAmount: "180" }
    ],
    operations: [
      { date: "2026-05-03", operation: "income", toChannel: "пейпал дол", currency: "USD", amount_usd: "100" },
      { date: "2026-05-04", operation: "expense", fromChannel: "пейпал дол", currency: "USD", amount_usd: "10" },
      { date: "2026-05-05", operation: "exchange_in", toChannel: "пейпал дол", currency: "USD", amount_net: "20" },
      { date: "2026-05-06", operation: "exchange_out", fromChannel: "пейпал дол", currency: "USD", amount_net: "5" },
      { date: "2026-05-07", operation: "partner_transfer", fromChannel: "пейпал дол", currency: "USD", amount_usd: "25" }
    ]
  }));

  const row = summary.rows.find((entry) => entry.channel === "пейпал дол");
  assert.equal(row.ledgerDelta, 80);
  assert.equal(row.realDelta, 80);
  assert.equal(row.status, "OK");
});

test("calculateMovementChannelStats returns accrued plus totals by channel for expense analysis plan orders", () => {
  const context = {
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол", "пейпал евр", "пейпал сad"],
    findHeaderIndexByAliases(header, aliases) {
      const normalizedAliases = aliases.map((value) => String(value).trim().toLowerCase());
      return header.findIndex((cell) => normalizedAliases.includes(String(cell || "").trim().toLowerCase()));
    },
    hasAnyValue(row) {
      return (row || []).some((cell) => String(cell || "").trim());
    },
    isTableTotalRow(row) {
      return String(row?.[0] || "").trim().toLowerCase() === "итого";
    },
    getClientPaymentLookupKeys(client) {
      return [String(client || "").trim().toLowerCase()];
    },
    inferFallbackPaymentChannelFromClient() {
      return "";
    },
    isAmbiguousPersonalCardPayment() {
      return false;
    },
    resolvePaymentChannel(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "paypal usd") return "пейпал дол";
      if (normalized === "paypal eur") return "пейпал евр";
      return "";
    },
    inferManualFinanceChannelCurrency(channel) {
      if (channel === "пейпал евр") return "EUR";
      return "USD";
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "calculateMovementChannelStats")}\n` +
    "this.calculateMovementChannelStats = calculateMovementChannelStats;",
    context
  );

  const stats = plain(context.calculateMovementChannelStats([
    ["NUMBER", "CLIENT", "PAYMENT METHOD", "ACCRUED +3%", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
    ["1", "Client A", "paypal usd", "103", "100", "-3"],
    ["2", "Client B", "paypal eur", "206", "200", "-6"],
    ["ИТОГО", "", "", "309", "300", "-9"],
  ]));

  assert.deepEqual(stats.accruedPlusByChannel, {
    "пейпал дол": 103,
    "пейпал евр": 206,
    "пейпал сad": 0,
  });
});

test("buildPreparedDashboardData keeps real income payload for expense analysis", () => {
  const mainJs = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const context = {
    state: {
      config: {
        tabs: [
          { id: "movement", sheetName: "movement" }
        ]
      }
    },
    formatDisplayDate(value) {
      return value;
    },
    prepareTabValues(_id, values) {
      return { values, summaryRows: [], headerRowIndex: 0 };
    },
    Date,
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(mainJs, "buildPreparedDashboardData")}\n` +
    "this.buildPreparedDashboardData = buildPreparedDashboardData;",
    context
  );

  const result = plain(context.buildPreparedDashboardData({
    realIncome: { summaryByChannel: { "пейпал дол": { realNetUsd: 123 } } },
    tabs: {
      movement: {
        values: [["header"], ["row"]]
      }
    }
  }, "2026-04-01", "2026-04-30"));

  assert.equal(result.realIncome.summaryByChannel["пейпал дол"].realNetUsd, 123);
});

test("getCurrentAnalyticsManualRows prefers aggregated period rows over end-date fact snapshot", () => {
  const context = {
    state: {
      aggregatedManualRange: {
        rows: [
          { channel: "пейпал евр", now: "0", serviceIncome: "222,7500", business: "20,0000", flat: "0", food: "0", fun: "0", study: "0", travel: "12,5000", total: "32,5000" }
        ]
      },
      manualFinance: {
        data: {
          moneyRows: [{ channel: "пейпал евр", serviceIncome: "0,0000" }],
          transferRows: []
        }
      }
    },
    buildAnalyticsManualRowsFromFactMoneyRows() {
      throw new Error("snapshot rows should not be used when aggregated range rows exist");
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getCurrentAnalyticsManualRows")}\n` +
    "this.getCurrentAnalyticsManualRows = getCurrentAnalyticsManualRows;",
    context
  );

  assert.deepEqual(plain(context.getCurrentAnalyticsManualRows()), [
    { channel: "пейпал евр", now: "0", serviceIncome: "222,7500", business: "20,0000", flat: "0", food: "0", fun: "0", study: "0", travel: "12,5000", total: "32,5000", exchange: "", exchangeUsd: "", totalUsd: "", nowUsd: "" }
  ]);
});

test("getCurrentFactMetricTotals uses aggregated period rows instead of stale fact snapshot rows", () => {
  const context = {
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    state: {
      aggregatedManualRange: {
        rows: [
          { channel: "Яндекс руб", serviceIncome: "200,0000", business: "50,0000", flat: "10,0000", food: "0", fun: "0", study: "0", travel: "0" },
          { channel: "пейпал дол", serviceIncome: "300,0000", business: "40,0000", flat: "0", food: "0", fun: "0", study: "0", travel: "0" },
        ],
        transferRows: [],
      },
      manualFinance: {
        data: {
          moneyRows: [{ channel: "Яндекс руб", serviceIncome: "0,0000", business: "0,0000" }],
          transferRows: [],
        },
      },
      analyticsFact: {
        periodEnd: "2026-04-30",
      },
      data: {
        tabs: {
          movement: {
            values: [],
          },
        },
      },
    },
    elements: {
      endDate: {
        value: "2026-04-30",
      },
    },
    getCurrentAnalyticsManualRows() {
      return context.state.aggregatedManualRange.rows;
    },
    getCurrentFactMetricTransfers() {
      return context.state.aggregatedManualRange.transferRows;
    },
    buildManualFinanceUsdRateLookup() {
      return {};
    },
    getManualFinanceFieldUsdNumber(row, key) {
      const value = String(row?.[key] ?? "").trim();
      return value ? Number(value.replace(",", ".")) : 0;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "getCurrentFactMetricTotals")}\n` +
    "this.getCurrentFactMetricTotals = getCurrentFactMetricTotals;",
    context
  );

  assert.deepEqual(plain(context.getCurrentFactMetricTotals()), {
    myServices: 500,
    myCosts: 100,
  });
});
