const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const apiIndex = fs.readFileSync(path.join(root, "api", "index.js"), "utf8");
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

function createApiLedgerRealIncomeContext() {
  const context = {
    REAL_INCOME_CHANNELS: [
      "Яндекс руб",
      "пейпал дол",
      "пейпал евр",
      "пейпал сad",
      "приват 24-дол",
      "приват 24-евро",
      "приват 24-грн",
      "монобанк грн",
      "БАНК КАНАДА cad",
      "трансервайз дол",
      "трансервайз евро",
    ],
    REAL_INCOME_CHANNEL_CURRENCY: {
      "Яндекс руб": "RUB",
      "пейпал дол": "USD",
      "пейпал евр": "EUR",
      "пейпал сad": "CAD",
      "приват 24-дол": "USD",
      "приват 24-евро": "EUR",
      "приват 24-грн": "UAH",
      "монобанк грн": "UAH",
      "БАНК КАНАДА cad": "CAD",
      "трансервайз дол": "USD",
      "трансервайз евро": "EUR",
    },
    REAL_INCOME_FALLBACK_USD_RATES: { RUB: 1 / 84.5563, UAH: 1 / 43.86, EUR: 1.16, CAD: 0.74 },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(apiIndex, "normalizeSummaryText")}\n` +
    `${extractFunction(apiIndex, "normalizeLookupText")}\n` +
    `${extractFunction(apiIndex, "normalizeIsoDate")}\n` +
    `${extractFunction(apiIndex, "parseLooseNumber")}\n` +
    `${extractFunction(apiIndex, "roundNumber")}\n` +
    `${extractFunction(apiIndex, "hasAnyValue")}\n` +
    `${extractFunction(apiIndex, "parseDisplayDate")}\n` +
    `${extractFunction(apiIndex, "addMovementRate")}\n` +
    `${extractFunction(apiIndex, "buildMovementUsdRateLookup")}\n` +
    `${extractFunction(apiIndex, "convertLocalAmountToUsd")}\n` +
    `${extractFunction(apiIndex, "calculateDifferencePct")}\n` +
    `${extractFunction(apiIndex, "sumBy")}\n` +
    `${extractFunction(apiIndex, "inferChannelCurrency")}\n` +
    `${extractFunction(apiIndex, "resolvePaymentChannel")}\n` +
    `${extractFunction(apiIndex, "summarizeMovementChannels")}\n` +
    `${extractFunction(apiIndex, "summarizeRealIncomeByChannel")}\n` +
    `${extractFunction(apiIndex, "getRealIncomeSummaryTotalsFromSummary")}\n` +
    `${extractFunction(apiIndex, "isLedgerProviderIncomeSource")}\n` +
    `${extractFunction(apiIndex, "getNormalizedLedgerFactOperation")}\n` +
    `${extractFunction(apiIndex, "getLedgerIncomeChannel")}\n` +
    `${extractFunction(apiIndex, "getLedgerFactAmountUsd")}\n` +
    `${extractFunction(apiIndex, "buildLedgerRealIncomeSummaryByChannel")}\n` +
    `${extractFunction(apiIndex, "mergeLedgerRealIncomeFallback")}\n` +
    "this.buildLedgerRealIncomeSummaryByChannel = buildLedgerRealIncomeSummaryByChannel;\n" +
    "this.mergeLedgerRealIncomeFallback = mergeLedgerRealIncomeFallback;\n",
    context
  );
  return context;
}

function extractExpenseAnalysisIncomeCountHelpers() {
  return [
    "getExpenseAnalysisPlannedIncomeCount",
    "buildLedgerIncomeCountSummaryByChannel",
    "normalizeExpenseAnalysisIncomeOperation",
    "normalizeExpenseAnalysisIncomeSource",
    "isExpenseAnalysisAutoIncomeSource",
    "isExpenseAnalysisManualIncomeSource",
    "isExpenseAnalysisScreenshotIncomeSource",
  ].map((name) => extractFunction(financeJs, name)).join("\n") + "\n";
}

function createMissingPaymentsContext() {
  const channels = ["пейпал дол", "пейпал евр", "пейпал сad", "трансервайз дол", "трансервайз евро", "монобанк грн"];
  const context = {
    MANUAL_FINANCE_MONEY_CHANNELS: channels,
    normalizeCell(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
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
    roundExpenseAnalysisAmount(value) {
      return Math.round((Number(value) || 0) * 10000) / 10000;
    },
    findHeaderIndexByAliases(header, aliases) {
      const normalizedAliases = aliases.map((value) => context.normalizeCell(value));
      return (header || []).findIndex((cell) => normalizedAliases.includes(context.normalizeCell(cell)));
    },
    hasAnyValue(row) {
      return (row || []).some((cell) => String(cell || "").trim());
    },
    isTableTotalRow(row) {
      return context.normalizeCell(row?.[0]) === "итого";
    },
    getCanonicalManualChannelKey(value) {
      const raw = String(value || "").trim();
      const normalized = context.normalizeLookupText(raw);
      const alias = {
        "paypal usd": "пейпал дол",
        "paypal eur": "пейпал евр",
        "paypal cad": "пейпал сad",
        "wise usd": "трансервайз дол",
        "wise eur": "трансервайз евро",
        "manual wise eur": "трансервайз евро",
        "mono uah": "монобанк грн"
      }[normalized];
      return alias || channels.find((channel) => context.normalizeCell(channel) === context.normalizeCell(raw)) || raw;
    },
    resolvePaymentChannel(value) {
      const channel = context.getCanonicalManualChannelKey(value);
      return channels.includes(channel) ? channel : "";
    },
    getClientPaymentLookupKeys(client) {
      const normalized = context.normalizeLookupText(client);
      return normalized ? [normalized] : [];
    },
    inferFallbackPaymentChannelFromClient() {
      return "";
    },
    isAmbiguousPersonalCardPayment() {
      return false;
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "readMissingPaymentCell")}\n` +
    `${extractFunction(financeJs, "firstMissingPaymentNumber")}\n` +
    `${extractFunction(financeJs, "normalizeMissingPaymentDate")}\n` +
    `${extractFunction(financeJs, "isMissingPaymentDateInPeriod")}\n` +
    `${extractFunction(financeJs, "isMissingPaymentIncomeOperation")}\n` +
    `${extractFunction(financeJs, "getMissingPaymentDateDistance")}\n` +
    `${extractFunction(financeJs, "hasMissingPaymentCounterpartyOverlap")}\n` +
    `${extractFunction(financeJs, "compareMissingPaymentScore")}\n` +
    `${extractFunction(financeJs, "scoreMissingPaymentMatch")}\n` +
    `${extractFunction(financeJs, "collectMissingPaymentMovementFallbackRows")}\n` +
    `${extractFunction(financeJs, "mapExpenseEntryToMissingPaymentActual")}\n` +
    `${extractFunction(financeJs, "mapManualOperationToMissingPaymentActual")}\n` +
    `${extractFunction(financeJs, "mapRealIncomeEntryToMissingPaymentActual")}\n` +
    `${extractFunction(financeJs, "collectMissingPaymentActualRows")}\n` +
    `${extractFunction(financeJs, "resolveMissingPaymentMovementChannel")}\n` +
    `${extractFunction(financeJs, "buildMissingPaymentClientPaymentLookup")}\n` +
    `${extractFunction(financeJs, "getMissingPaymentMovementHeaderInfo")}\n` +
    `${extractFunction(financeJs, "collectMissingPaymentPlannedRows")}\n` +
    `${extractFunction(financeJs, "buildMissingPaymentsAudit")}\n` +
    "this.buildMissingPaymentsAudit = buildMissingPaymentsAudit;",
    context
  );
  return context;
}

const MOVEMENT_HEADER = [
  "NUMBER",
  "DATE",
  "CLIENT",
  "SERVICE",
  "PAYMENT METHOD",
  "ACCRUED",
  "ACCRUED +3%",
  "ДОШЛО ДО НАС USD",
  "ДОШЛО ФАКТ / PROVIDER NET",
  "BALANCE"
];

function movementRow(orderId, channel, amount, client = `Client ${orderId}`) {
  return [String(orderId), "2026-05-10", client, `Service ${orderId}`, channel, amount, amount, "", "", amount];
}

test("expense analysis UI keeps refresh action and scrollable tables", () => {
  assert.match(uiJs, /refreshExpenseFinancialAnalysis/);
  assert.match(uiJs, /refreshButton\.textContent = state\.expenseAccounting\.loading \? "Обновляю\.\.\." : "Обновить"/);
  assert.match(uiJs, /analysis-table-wrap/);
  assert.match(uiJs, /renderPlainTable\(rows\)/);
  assert.match(uiJs, /renderMissingPaymentsBlock\(getMissingPaymentsAuditSummary\(\)\)/);
  assert.ok(
    uiJs.indexOf("renderExpenseAnalysisChannelBlock(channelReconciliation)") <
      uiJs.indexOf("renderMissingPaymentsBlock(getMissingPaymentsAuditSummary())")
  );
  assert.ok(
    uiJs.indexOf("renderMissingPaymentsBlock(getMissingPaymentsAuditSummary())") <
      uiJs.indexOf("renderBalanceReconciliationBlock(getBalanceReconciliationSummary())")
  );
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
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол", "трансервайз дол", "монобанк грн", "БАНК КАНАДА cad"],
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_FINANCE_FALLBACK_USD_RATES: { UAH: 1 / 43.86, RUB: 1 / 84.5563, CAD: 0.74, LOCAL: 1 / 18 },
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
        "банк канада cad": "БАНК КАНАДА cad",
        "td bank cad": "БАНК КАНАДА cad",
      })[normalized] || String(value || "").trim();
    },
    inferManualFinanceChannelCurrency(channel) {
      if (channel === "монобанк грн") return "UAH";
      if (channel === "БАНК КАНАДА cad") return "CAD";
      return "USD";
    },
    getManualFinanceUsdPerLocalRate(row, rateLookup = { byChannel: {}, byCurrency: {} }) {
      const channel = String(row?.channel || "").trim();
      const currency = channel === "БАНК КАНАДА cad" ? "CAD" : (channel === "монобанк грн" ? "UAH" : "USD");
      const parseRate = (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return 0;
        const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
        const numeric = Number(normalized);
        return Number.isFinite(numeric) ? numeric : 0;
      };
      const fallbackRates = { UAH: 1 / 43.86, RUB: 1 / 84.5563, CAD: 0.74, LOCAL: 1 / 18 };
      if (currency === "USD") return 1;
      return parseRate(rateLookup.byChannel?.[channel]) ||
        parseRate(rateLookup.byCurrency?.[currency]) ||
        fallbackRates[currency] ||
        0;
    },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    },
    ...extra,
  };
}

function loadLedgerAnalysisHelpers(context) {
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getLedgerFactRateLookupChannel")}\n` +
    `${extractFunction(uiJs, "resolveLedgerFactAmountUsdInfo")}\n` +
    `${extractFunction(uiJs, "getLedgerFactAmountUsd")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisLedgerWarnings")}\n` +
    `${extractFunction(uiJs, "getNormalizedLedgerFactOperation")}\n` +
    `${extractFunction(uiJs, "isExpenseAnalysisKnownChannel")}\n` +
    `${extractFunction(uiJs, "getLedgerIncomeChannel")}\n` +
    `${extractFunction(uiJs, "isLedgerProviderIncomeSource")}\n` +
    `${extractFunction(uiJs, "getLedgerExpenseChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerRealIncomeSummaryByChannel")}\n` +
    `${extractFunction(uiJs, "buildLedgerProviderExpenseByChannel")}\n` +
    "this.getLedgerFactAmountUsd = getLedgerFactAmountUsd;\n" +
    "this.getExpenseAnalysisLedgerWarnings = getExpenseAnalysisLedgerWarnings;\n" +
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
    "БАНК КАНАДА cad": { realNetUsd: 0 },
  });
  assert.deepEqual(plain(context.buildLedgerProviderExpenseByChannel(rows)), {
    "пейпал дол": 12,
    "трансервайз дол": 0,
    "монобанк грн": 993,
    "БАНК КАНАДА cad": 0,
  });
});

test("TD CAD expense Ledger rows fall back to USD rate in analysis", () => {
  const context = buildLedgerAnalysisTestContext();
  loadLedgerAnalysisHelpers(context);

  const summary = plain(context.buildLedgerProviderExpenseByChannel([
    {
      date: "2026-04-30",
      operation: "business_expense",
      source: "td_bank",
      fromChannel: "БАНК КАНАДА cad",
      amount: "17.95",
      currency: "CAD",
      amountUsd: "0",
      amountNet: "17.95",
    }
  ], { byCurrency: { CAD: 0.74 }, byChannel: {} }));

  assert.equal(summary["БАНК КАНАДА cad"], 13.283);
});

test("TD CAD income Ledger rows fall back to USD rate in analysis", () => {
  const context = buildLedgerAnalysisTestContext();
  loadLedgerAnalysisHelpers(context);

  const summary = plain(context.buildLedgerRealIncomeSummaryByChannel([
    {
      date: "2026-04-06",
      operation: "income",
      source: "td_bank",
      toChannel: "БАНК КАНАДА cad",
      amount: "150",
      currency: "CAD",
      amountUsd: "0",
      amountNet: "150",
    }
  ], { byCurrency: { CAD: 0.74 }, byChannel: {} }));

  assert.equal(summary["БАНК КАНАДА cad"].realNetUsd, 111);
});

test("missing CAD USD rate produces explicit analysis warning instead of silent zero", () => {
  const context = buildLedgerAnalysisTestContext({
    getManualFinanceUsdPerLocalRate() {
      return 0;
    }
  });
  loadLedgerAnalysisHelpers(context);

  const warnings = plain(context.getExpenseAnalysisLedgerWarnings([
    {
      date: "2026-04-30",
      operation: "business_expense",
      source: "td_bank",
      fromChannel: "БАНК КАНАДА cad",
      amount: "17.95",
      currency: "CAD",
      amountUsd: "0",
      amountNet: "17.95",
    }
  ], { byCurrency: {}, byChannel: {} }));

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /TD CAD rows missing USD rate/);
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
    extractExpenseAnalysisIncomeCountHelpers() +
    `${extractFunction(financeJs, "buildExpenseAnalysisChannelSummary")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisLedgerRows")}\n` +
    `${extractFunction(uiJs, "getLedgerFactRateLookupChannel")}\n` +
    `${extractFunction(uiJs, "resolveLedgerFactAmountUsdInfo")}\n` +
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
    "function normalizeManualLedgerSource(value, fallback = \"\") {\n" +
    "  const token = String(value || \"\").trim().toLowerCase().replace(/ё/g, \"е\").replace(/[^0-9a-zа-я]+/g, \" \").replace(/\\s+/g, \"_\").trim();\n" +
    "  if (!token) return fallback;\n" +
    "  if ([\"manual\", \"fact\", \"paypal\", \"wise\", \"monobank\", \"privatbank\", \"td_bank\", \"migration\", \"google_sheets\", \"other\"].includes(token)) return token;\n" +
    "  if ([\"manual_fact\", \"manual_finance\"].includes(token)) return \"manual\";\n" +
    "  if ([\"paypal_mcp\"].includes(token)) return \"paypal\";\n" +
    "  if ([\"transferwise\"].includes(token)) return \"wise\";\n" +
    "  if ([\"mono\"].includes(token)) return \"monobank\";\n" +
    "  if ([\"privat24\", \"privat_24\"].includes(token)) return \"privatbank\";\n" +
    "  if ([\"tdbank\", \"tdbank_mcp\", \"tdbank_import\", \"td_bank_import\", \"td\"].includes(token)) return \"td_bank\";\n" +
    "  return token;\n" +
    "}\n" +
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
    extractExpenseAnalysisIncomeCountHelpers() +
    `${extractFunction(financeJs, "buildExpenseAnalysisChannelSummary")}\n` +
    `${extractFunction(uiJs, "getExpenseAnalysisLedgerRows")}\n` +
    `${extractFunction(uiJs, "getLedgerFactRateLookupChannel")}\n` +
    `${extractFunction(uiJs, "resolveLedgerFactAmountUsdInfo")}\n` +
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
    "БАНК КАНАДА cad": 0,
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
    normalizeLookupText(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/g, " ").replace(/\s+/g, " ").trim();
    },
    canonicalManualFinanceChannel(value) {
      const normalized = String(value || "").trim().toLowerCase();
      return ({ "paypal usd": "пейпал дол", "пейпал дол": "пейпал дол", "paypal eur": "пейпал евр", "пейпал евр": "пейпал евр" })[normalized] || String(value || "").trim();
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
    extractExpenseAnalysisIncomeCountHelpers() +
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
    ["канал", "план заказы", "план услуги", "план всего", "пришло реально", "разница", "потрачено план", "потрачено реал", "разница", "план приходов, шт", "авто/MCP приходов, шт", "ручных приходов, шт", "скриншот приходов, шт"],
    ["пейпал дол", "350,0000", "360,5000", "710,5000", "311,0600", "399,4400", "30,0000", "120,5000", "-90,5000", "1", "0", "0", "0"],
    ["пейпал евр", "0,0000", "222,7500", "222,7500", "222,7500", "0,0000", "32,5000", "80,2500", "-47,7500", "0", "0", "0", "0"],
    ["Итого", "350,0000", "583,2500", "933,2500", "533,8100", "399,4400", "62,5000", "200,7500", "-138,2500", "1", "0", "0", "0"],
  ]);
});

test("mixed imported PayPal and YooMoney income keeps non-zero income and expense totals in channel summary", () => {
  const apiContext = createApiLedgerRealIncomeContext();
  const mergedRealIncome = plain(apiContext.mergeLedgerRealIncomeFallback({
    realIncome: null,
    operations: [
      {
        date: "2026-05-10",
        operation: "income",
        source: "paypal_mcp",
        to_channel: "paypal",
        amount_usd: "100",
        amount_net: "96",
        currency: "USD"
      },
      {
        date: "2026-05-11",
        operation: "income",
        source: "mcp",
        to_channel: "yoomoney",
        amount_usd: "25",
        amount_net: "2500",
        currency: "RUB"
      },
      {
        date: "2026-05-12",
        operation: "exchange_out",
        source: "manual",
        from_channel: "Яндекс руб",
        to_channel: "Бинанс spot",
        amount_usd: "",
        amount_net: "3000",
        currency: "RUB"
      }
    ],
    movementValues: [],
    period: { startDate: "2026-05-01", endDate: "2026-05-31" }
  }));

  const context = {
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_FINANCE_MONEY_CHANNELS: ["Яндекс руб", "пейпал дол"],
    calculateMovementChannelStats: () => ({
      accruedPlusByChannel: {
        "Яндекс руб": 0,
        "пейпал дол": 0
      },
      accruedPlusCountByChannel: {
        "Яндекс руб": 0,
        "пейпал дол": 0
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
    normalizeLookupText(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/g, " ").replace(/\s+/g, " ").trim();
    },
    canonicalManualFinanceChannel(value) {
      const normalized = String(value || "").trim().toLowerCase();
      return ({
        "yoomoney": "Яндекс руб",
        "яндекс руб": "Яндекс руб",
        "paypal": "пейпал дол",
        "paypal usd": "пейпал дол",
        "пейпал дол": "пейпал дол",
      })[normalized] || String(value || "").trim();
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "roundExpenseAnalysisAmount")}\n` +
    `${extractFunction(financeJs, "getManualFinancePlannedExpenseUsdNumber")}\n` +
    extractExpenseAnalysisIncomeCountHelpers() +
    `${extractFunction(financeJs, "buildExpenseAnalysisChannelSummary")}\n` +
    "this.buildExpenseAnalysisChannelSummary = buildExpenseAnalysisChannelSummary;",
    context
  );

  const summary = plain(context.buildExpenseAnalysisChannelSummary({
    manualRows: [
      { channel: "Яндекс руб", serviceIncome: "0", business: "0", flat: "0", food: "0", fun: "0", study: "0", travel: "0" },
      { channel: "пейпал дол", serviceIncome: "0", business: "0", flat: "0", food: "0", fun: "0", study: "0", travel: "0" },
    ],
    movementValues: [],
    realIncomeSummaryByChannel: mergedRealIncome.summaryByChannel,
    providerExpenseByChannel: {
      "Яндекс руб": 10,
      "пейпал дол": 0,
    },
    ledgerRows: [],
    usdRateLookup: {}
  }));

  assert.ok(summary.incomeTotals.realUsd > 0);
  assert.ok(summary.expenseTotals.realUsd > 0);
  assert.equal(summary.rows.find((row) => row[0] === "Яндекс руб")[4], "25,0000");
  assert.equal(summary.rows.find((row) => row[0] === "пейпал дол")[4], "100,0000");
});

test("buildExpenseAnalysisChannelSummary appends income counters by source group", () => {
  const context = {
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_FINANCE_MONEY_CHANNELS: ["пейпал дол", "трансервайз дол", "монобанк грн"],
    calculateMovementChannelStats: () => ({
      accruedPlusByChannel: { "пейпал дол": 103, "трансервайз дол": 206, "монобанк грн": 0 },
      accruedPlusCountByChannel: { "пейпал дол": 1, "трансервайз дол": 1, "монобанк грн": 0 }
    }),
    sumManualFinanceFieldUsdNumber() {
      return 0;
    },
    getManualFinanceFieldUsdNumber() {
      return 0;
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(numeric) ? numeric : 0;
    },
    formatSheetNumber(value, digits = 4) {
      return Number(value || 0).toFixed(digits).replace(".", ",");
    },
    normalizeLookupText(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/g, " ").replace(/\s+/g, " ").trim();
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
        "mono": "монобанк грн",
        "monobank": "монобанк грн",
        "монобанк грн": "монобанк грн",
      })[normalized] || String(value || "").trim();
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "roundExpenseAnalysisAmount")}\n` +
    `${extractFunction(financeJs, "getManualFinancePlannedExpenseUsdNumber")}\n` +
    extractExpenseAnalysisIncomeCountHelpers() +
    `${extractFunction(financeJs, "buildExpenseAnalysisChannelSummary")}\n` +
    "this.buildExpenseAnalysisChannelSummary = buildExpenseAnalysisChannelSummary;",
    context
  );

  const summary = plain(context.buildExpenseAnalysisChannelSummary({
    manualRows: [],
    movementValues: [],
    realIncomeSummaryByChannel: {},
    providerExpenseByChannel: {},
    ledgerRows: [
      { operation: "income", source: "wise", toChannel: "wise usd", amountUsd: "100", currency: "USD" },
      { operation: "servicein", source: "provider", to_channel: "paypal usd", amount_usd: "25", currency: "USD" },
      { operation: "ezoin", source: "mcp", to_channel: "wise", amount_usd: "50", currency: "USD" },
      { operation: "income", source: "manual", toChannel: "paypal usd", amountUsd: "10", currency: "USD" },
      { operation: "income", source: "fact", toChannel: "wise", amountUsd: "20", currency: "USD" },
      { operation: "income", source: "migration", toChannel: "monobank", amountUsd: "30", currency: "USD" },
      { operation: "income", source: "ocr", toChannel: "paypal usd", amountUsd: "40", currency: "USD" },
      { operation: "income", source: "photo", toChannel: "wise", amountUsd: "50", currency: "USD" },
      { operation: "income", source: "screenshot", toChannel: "monobank", amountUsd: "60", currency: "USD" },
      { operation: "income", source: "image", toChannel: "monobank", amountUsd: "70", currency: "USD" },
      { operation: "income", source: "browser_ocr", toChannel: "paypal usd", amountUsd: "80", currency: "USD" },
      { operation: "business_expense", source: "wise", fromChannel: "wise", amountUsd: "90", currency: "USD" },
      { operation: "exchange_out", source: "mcp", fromChannel: "paypal usd", amountUsd: "-12", currency: "USD" },
    ],
    usdRateLookup: {}
  }));

  const paypal = summary.rows.find((row) => row[0] === "пейпал дол");
  const wise = summary.rows.find((row) => row[0] === "трансервайз дол");
  const mono = summary.rows.find((row) => row[0] === "монобанк грн");
  const total = summary.rows.find((row) => row[0] === "Итого");
  assert.deepEqual(paypal.slice(-4), ["1", "1", "1", "2"]);
  assert.deepEqual(wise.slice(-4), ["1", "2", "1", "1"]);
  assert.deepEqual(mono.slice(-4), ["0", "0", "1", "2"]);
  assert.deepEqual(total.slice(-4), ["2", "3", "3", "5"]);
});

test("buildLedgerRealIncomeSummaryByChannel maps MCP YooMoney income into Яндекс руб", () => {
  const context = createApiLedgerRealIncomeContext();

  const summary = plain(context.buildLedgerRealIncomeSummaryByChannel([
    {
      date: "2026-05-10",
      operation: "income",
      source: "mcp",
      to_channel: "yoomoney",
      amount_usd: "25",
      amount_net: "2500",
      currency: "RUB"
    }
  ], [], { startDate: "2026-05-01", endDate: "2026-05-31" }));

  assert.equal(summary["Яндекс руб"].realNetUsd, 25);
});

test("buildLedgerRealIncomeSummaryByChannel prefers amount_usd over USD amount_net for PayPal MCP income", () => {
  const context = createApiLedgerRealIncomeContext();

  const summary = plain(context.buildLedgerRealIncomeSummaryByChannel([
    {
      date: "2026-05-12",
      operation: "income",
      source: "paypal_mcp",
      to_channel: "paypal",
      amount_usd: "100",
      amount_net: "96",
      currency: "USD"
    }
  ], [], { startDate: "2026-05-01", endDate: "2026-05-31" }));

  assert.equal(summary["пейпал дол"].realNetUsd, 100);
});

test("buildLedgerRealIncomeSummaryByChannel converts TD CAD income with fallback USD rate", () => {
  const context = createApiLedgerRealIncomeContext();

  const summary = plain(context.buildLedgerRealIncomeSummaryByChannel([
    {
      date: "2026-05-12",
      operation: "income",
      source: "td_bank",
      to_channel: "БАНК КАНАДА cad",
      amount_usd: "0",
      amount_net: "150",
      currency: "CAD"
    }
  ], [], { startDate: "2026-05-01", endDate: "2026-05-31" }));

  assert.equal(summary["БАНК КАНАДА cad"].realNetUsd, 111);
});

test("mergeLedgerRealIncomeFallback keeps provider totals primary and fills empty channels from Ledger", () => {
  const context = createApiLedgerRealIncomeContext();

  const merged = plain(context.mergeLedgerRealIncomeFallback({
    realIncome: {
      summaryByChannel: {
        "пейпал дол": {
          channel: "пейпал дол",
          currency: "USD",
          plannedReceivedUsd: 0,
          realGrossUsd: 90,
          realFeeUsd: 0,
          realNetUsd: 90,
          differenceUsd: -90,
          differencePct: -100,
        }
      }
    },
    operations: [
      {
        date: "2026-05-10",
        operation: "income",
        source: "paypal_mcp",
        to_channel: "paypal",
        amount_usd: "100",
        amount_net: "96",
        currency: "USD"
      },
      {
        date: "2026-05-11",
        operation: "income",
        source: "mcp",
        to_channel: "yoomoney",
        amount_usd: "25",
        amount_net: "2500",
        currency: "RUB"
      }
    ],
    movementValues: [],
    period: { startDate: "2026-05-01", endDate: "2026-05-31" }
  }));

  assert.equal(merged.summaryByChannel["пейпал дол"].realNetUsd, 90);
  assert.equal(merged.summaryByChannel["Яндекс руб"].realNetUsd, 25);
});

test("buildMissingPaymentsAudit reports one missing Wise payment from 9 planned and 8 actual", () => {
  const context = createMissingPaymentsContext();
  const movementValues = [
    MOVEMENT_HEADER,
    ...Array.from({ length: 8 }, (_, index) => movementRow(100 + index, "wise eur", 100 + index, `Wise Client ${index}`)),
    movementRow(199, "wise eur", 25.75, "Wise Missing")
  ];
  const realIncomeEntries = Array.from({ length: 8 }, (_, index) => ({
    source: "wise",
    date: "2026-05-10",
    channel: "трансервайз евро",
    realNetUsd: 100 + index,
    counterparty: `Wise Client ${index}`
  }));

  const audit = plain(context.buildMissingPaymentsAudit({
    movementValues,
    realIncomeEntries,
    startDate: "2026-05-01",
    endDate: "2026-05-31"
  }));

  const wise = audit.summaryRows.find((row) => row.channel === "трансервайз евро");
  assert.equal(wise.plannedCount, 9);
  assert.equal(wise.actualCount, 8);
  assert.equal(wise.missingCount, 1);
  assert.equal(audit.detailRows.length, 1);
  assert.equal(audit.detailRows[0].orderId, "199");
  assert.equal(audit.detailRows[0].accruedPlus, 25.75);
});

test("buildMissingPaymentsAudit treats PayPal 3 planned and 3 actual as fully matched", () => {
  const context = createMissingPaymentsContext();
  const movementValues = [
    MOVEMENT_HEADER,
    movementRow(201, "paypal usd", 50, "PayPal A"),
    movementRow(202, "paypal usd", 75, "PayPal B"),
    movementRow(203, "paypal usd", 125, "PayPal C")
  ];
  const realIncomeEntries = [50, 75, 125].map((amount, index) => ({
    source: "paypal",
    date: "2026-05-10",
    channel: "пейпал дол",
    realNetUsd: amount,
    counterparty: `PayPal ${String.fromCharCode(65 + index)}`
  }));

  const audit = plain(context.buildMissingPaymentsAudit({
    movementValues,
    realIncomeEntries,
    startDate: "2026-05-01",
    endDate: "2026-05-31"
  }));

  const paypal = audit.summaryRows.find((row) => row.channel === "пейпал дол");
  assert.equal(paypal.plannedCount, 3);
  assert.equal(paypal.actualCount, 3);
  assert.equal(paypal.missingCount, 0);
  assert.deepEqual(audit.detailRows, []);
});

test("buildMissingPaymentsAudit matches amount differences within one USD", () => {
  const context = createMissingPaymentsContext();
  const audit = plain(context.buildMissingPaymentsAudit({
    movementValues: [MOVEMENT_HEADER, movementRow(301, "wise eur", 100, "Close Match")],
    realIncomeEntries: [{
      source: "wise",
      date: "2026-05-10",
      channel: "трансервайз евро",
      realNetUsd: 99.25,
      counterparty: "Close Match"
    }],
    startDate: "2026-05-01",
    endDate: "2026-05-31"
  }));

  assert.equal(audit.summaryRows.find((row) => row.channel === "трансервайз евро").missingCount, 0);
});

test("buildMissingPaymentsAudit does not match same amount from another channel", () => {
  const context = createMissingPaymentsContext();
  const audit = plain(context.buildMissingPaymentsAudit({
    movementValues: [MOVEMENT_HEADER, movementRow(401, "wise eur", 88, "Wrong Channel")],
    realIncomeEntries: [{
      source: "paypal",
      date: "2026-05-10",
      channel: "пейпал дол",
      realNetUsd: 88,
      counterparty: "Wrong Channel"
    }],
    startDate: "2026-05-01",
    endDate: "2026-05-31"
  }));

  assert.equal(audit.summaryRows.find((row) => row.channel === "трансервайз евро").missingCount, 1);
  assert.equal(audit.summaryRows.find((row) => row.channel === "пейпал дол").actualCount, 1);
});

test("buildMissingPaymentsAudit lets manual fact and screenshot income close planned payments", () => {
  const context = createMissingPaymentsContext();
  const movementValues = [
    MOVEMENT_HEADER,
    movementRow(501, "wise eur", 40, "Manual Client"),
    movementRow(502, "wise eur", 41, "Fact Client"),
    movementRow(503, "wise eur", 42, "Screenshot Client")
  ];

  const audit = plain(context.buildMissingPaymentsAudit({
    movementValues,
    manualOperations: [
      { source: "manual", operation: "income", date: "2026-05-10", toChannel: "wise eur", amount_usd: "40", counterparty: "Manual Client" },
      { source: "fact", operation: "servicein", date: "2026-05-10", to_channel: "wise eur", amount_usd: "41", counterparty: "Fact Client" }
    ],
    expenseEntries: [
      { source: "screenshot/ocr", direction: "income", date: "2026-05-10", channel: "wise eur", usdAmount: "42", counterpartyName: "Screenshot Client" }
    ],
    startDate: "2026-05-01",
    endDate: "2026-05-31"
  }));

  const wise = audit.summaryRows.find((row) => row.channel === "трансервайз евро");
  assert.equal(wise.plannedCount, 3);
  assert.equal(wise.actualCount, 3);
  assert.equal(wise.missingCount, 0);
});

test("buildMissingPaymentsAudit ignores expense rows as actual payments", () => {
  const context = createMissingPaymentsContext();
  const audit = plain(context.buildMissingPaymentsAudit({
    movementValues: [MOVEMENT_HEADER, movementRow(601, "paypal usd", 77, "Expense Row")],
    expenseEntries: [
      { source: "paypal", direction: "expense", operation: "expense", date: "2026-05-10", channel: "paypal usd", usdAmount: "77", counterpartyName: "Expense Row" }
    ],
    startDate: "2026-05-01",
    endDate: "2026-05-31"
  }));

  const paypal = audit.summaryRows.find((row) => row.channel === "пейпал дол");
  assert.equal(paypal.actualCount, 0);
  assert.equal(paypal.missingCount, 1);
  assert.equal(audit.detailRows.length, 1);
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
  assert.deepEqual(stats.accruedPlusCountByChannel, {
    "пейпал дол": 1,
    "пейпал евр": 1,
    "пейпал сad": 0,
  });
});

test("calculateMovementChannelStats counts Wise planned income from the same movement rows as plan orders", () => {
  const context = {
    MANUAL_FINANCE_MONEY_CHANNELS: ["трансервайз дол"],
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
      if (["wise", "wise usd", "transferwise", "transferwise usd"].includes(normalized)) return "трансервайз дол";
      return "";
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
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(financeJs, "calculateMovementChannelStats")}\n` +
    "this.calculateMovementChannelStats = calculateMovementChannelStats;",
    context
  );

  const stats = plain(context.calculateMovementChannelStats([
    ["NUMBER", "CLIENT", "PAYMENT METHOD", "ACCRUED +3%", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
    ["1", "Wise Client A", "wise usd", "504", "504", "0"],
    ["2", "Wise Client B", "transferwise usd", "500", "500", "0"],
  ]));

  assert.equal(stats.accruedPlusByChannel["трансервайз дол"], 1004);
  assert.equal(stats.accruedPlusCountByChannel["трансервайз дол"], 2);
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
