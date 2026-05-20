const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");
const googleSheetsJs = fs.readFileSync(path.join(root, "google-sheets.js"), "utf8");

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

function buildUiDirectionContext() {
  const channels = [
    "трансервайз евро",
    "пейпал дол",
    "монобанк грн",
    "приват 24-грн",
    "Яндекс руб",
    "БАНК КАНАДА cad",
    "Бинанс spot",
    "binance save"
  ];
  const context = {
    state: {
      expenseAccounting: { entries: [] },
      config: { manualFinance: { channels } }
    },
    elements: { endDate: { value: "2026-05-20" } },
    MANUAL_RECEIVED_ENTRY_TYPES: ["serviceincome", "ezofact", "exchange_in"],
    DEFAULT_MANUAL_RECEIVED_ENTRY_TYPE: "serviceincome",
    Date,
    normalizeIncomingSheetDateValue(value) {
      const raw = String(value || "").trim();
      return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
    },
    canonicalManualFinanceChannel(value) {
      const raw = String(value || "").trim();
      return channels.find((channel) => channel.toLowerCase() === raw.toLowerCase()) || raw;
    },
    getManualFinanceChannels() {
      return channels.slice();
    },
    inferManualFinanceChannelCurrency(channel) {
      if (/евро|eur/i.test(channel)) return "EUR";
      if (/cad|канада/i.test(channel)) return "CAD";
      if (/грн|uah/i.test(channel)) return "UAH";
      if (/руб|rub|яндекс/i.test(channel)) return "RUB";
      return "USD";
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const negative = /^\(.+\)$/.test(raw) || /^-/.test(raw);
      const normalized = raw.replace(/[()]/g, "").replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? (negative ? -Math.abs(numeric) : numeric) : 0;
    },
    normalizeManualExpenseCategory(value) {
      const raw = String(value || "").trim();
      return raw === "serviceIncome" ? "serviceIncome" : raw.toLowerCase();
    },
    loadPayPalCounterpartyOverrides() {
      return {};
    },
    getPayPalCounterpartyOverrideKey() {
      return "";
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "normalizeReceivedEntryType")}\n` +
    `${extractFunction(uiJs, "mapReceivedTypeToAccountingCategory")}\n` +
    `${extractFunction(uiJs, "applyPayPalCounterpartyOverride")}\n` +
    `${extractFunction(uiJs, "normalizeExpenseAccountingEntry")}\n` +
    `${extractFunction(uiJs, "getExpenseAccountingDirectionCounts")}\n` +
    "applyPayPalCounterpartyOverride = function(entry) { return entry; };\n" +
    "this.normalizeExpenseAccountingEntry = normalizeExpenseAccountingEntry;\n" +
    "this.getExpenseAccountingDirectionCounts = getExpenseAccountingDirectionCounts;\n",
    context
  );
  return context;
}

function buildLedgerDirectionContext() {
  const channels = [
    "трансервайз евро",
    "пейпал дол",
    "монобанк грн",
    "приват 24-грн",
    "Яндекс руб",
    "БАНК КАНАДА cad",
    "Бинанс spot",
    "binance save"
  ];
  const context = {
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : ["2026-05-20T10:00:00.000Z"]));
      }
      static now() {
        return new Date("2026-05-20T10:00:00.000Z").getTime();
      }
    },
    MANUAL_FINANCE_FALLBACK_USD_RATES: { UAH: 1 / 43.86, RUB: 1 / 84.5563, LOCAL: 1 / 18 },
    canonicalManualFinanceChannel(value) {
      const raw = String(value || "").trim();
      return channels.find((channel) => channel.toLowerCase() === raw.toLowerCase()) || raw;
    },
    normalizeIncomingSheetDateValue(value) {
      const raw = String(value || "").trim();
      return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
    },
    normalizeManualLedgerCategoryForStorage(value, fallback = "extra") {
      const raw = String(value || "").trim().toLowerCase();
      if (!raw) return fallback;
      if (raw === "serviceincome" || raw === "servicein") return "servicein";
      if (raw === "business") return "business";
      if (raw === "exchange") return "exchange";
      return raw;
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
    inferManualFinanceChannelCurrency(channel) {
      if (/евро|eur/i.test(channel)) return "EUR";
      if (/cad|канада/i.test(channel)) return "CAD";
      if (/грн|uah/i.test(channel)) return "UAH";
      if (/руб|rub|яндекс/i.test(channel)) return "RUB";
      return "USD";
    },
    normalizeManualFinancePersistedNumberInput(value) {
      const raw = String(value ?? "").trim();
      return raw ? raw.replace(".", ",") : "";
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
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerSourceToken")}\n` +
    `${extractFunction(googleSheetsJs, "inferManualLedgerSourceFromRawSourceId")}\n` +
    `${extractFunction(googleSheetsJs, "inferManualLedgerSourceFromChannels")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerSource")}\n` +
    `${extractFunction(googleSheetsJs, "resolveManualLedgerSource")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeLedgerRowForContract")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeLedgerAmountUsdForSave")}\n` +
    `${extractFunction(googleSheetsJs, "firstNonEmpty")}\n` +
    `${extractFunction(googleSheetsJs, "getLedgerUsdPerLocalRate")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeLedgerExchangeUsdSign")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualLedgerRowsForSave")}\n` +
    `${extractFunction(googleSheetsJs, "formatStableSourceIdPart")}\n` +
    `${extractFunction(googleSheetsJs, "buildStableScreenshotIncomeSourceId")}\n` +
    `${extractFunction(googleSheetsJs, "isScreenshotAccountingEntry")}\n` +
    `${extractFunction(googleSheetsJs, "buildLedgerRowsFromAccountingEntries")}\n` +
    "this.buildLedgerRowsFromAccountingEntries = buildLedgerRowsFromAccountingEntries;\n" +
    "this.normalizeManualLedgerRowsForSave = normalizeManualLedgerRowsForSave;\n",
    context
  );
  return context;
}

test("provider sign and direction survive UI counts and Ledger save mapping", async () => {
  const [
    wise,
    paypal,
    monobank,
    privatbank,
    yoomoney,
    binance
  ] = await Promise.all([
    import("../api/wise-transactions.js"),
    import("../api/paypal-transactions.js"),
    import("../api/monobank-transactions.js"),
    import("../api/privatbank-transactions.js"),
    import("../api/yoomoney-transactions.js"),
    import("../server/binance-transactions.js")
  ]);

  const apiEntries = [
    wise.normalizeWiseTransaction({
      date: "2026-05-18T10:00:00.000Z",
      referenceNumber: "CARD-YELLOWSQUARE-CREDIT-55-60",
      type: "CREDIT",
      amount: { value: 55.6, currency: "EUR" },
      details: { type: "CARD", description: "YellowSquare" }
    }, { balanceId: "eur", currency: "EUR" }, "profile-1"),
    wise.normalizeWiseTransaction({
      date: "2026-05-08T12:00:00.000Z",
      referenceNumber: "CARD-3766611855",
      type: "CREDIT",
      amount: { value: 4.4, currency: "EUR" },
      details: { type: "CARD", description: "Card transaction at Bolt" }
    }, { balanceId: "eur", currency: "EUR" }, "profile-1"),
    ...paypal.parsePayPalManualActivityRows([
      { date: "2026-05-13", name: "Booking.com BV", amount: "-US$27.14", type: "Payment" },
      { date: "2026-05-14", name: "Provider refund", amount: "+US$36.00", type: "Refund" }
    ]).entries,
    monobank.normalizeMonobankStatementItem({ id: "MONO-IN", time: 1776679200, amount: 25300, currencyCode: 980, description: "Incoming transfer" }),
    monobank.normalizeMonobankStatementItem({ id: "MONO-OUT", time: 1776679200, amount: -12000, currencyCode: 980, description: "Card payment" }),
    privatbank.normalizePrivatBankStatementItem({ id: "PB-IN", date: "2026-05-15", amount: "500", currency: "UAH", direction: "credit", description: "Incoming" }),
    privatbank.normalizePrivatBankStatementItem({ id: "PB-OUT", date: "2026-05-15", amount: "250", currency: "UAH", direction: "debit", description: "Payment" }),
    yoomoney.normalizeYooMoneyOperation({ operation_id: "YM-IN", direction: "in", amount: "438.98", datetime: "2026-05-16T12:00:00.000+03:00", title: "Incoming", type: "deposition" }),
    yoomoney.normalizeYooMoneyOperation({ operation_id: "YM-OUT", direction: "out", amount: "99.9", datetime: "2026-05-16T12:00:00.000+03:00", title: "Payment", type: "payment-shop" }),
    binance.normalizeBinanceDeposit({ id: "BN-IN", coin: "USDT", amount: "125.50", completeTime: 1776679200000 }),
    binance.normalizeBinanceWithdrawal({ id: "BN-OUT", coin: "USDT", amount: "25.00", transactionFee: "1.00", completeTime: 1776679200000 })
  ];

  const ui = buildUiDirectionContext();
  const uiEntries = plain(apiEntries.map((entry, index) => ui.normalizeExpenseAccountingEntry(entry, index)));
  ui.state.expenseAccounting.entries = uiEntries;

  const counts = ui.getExpenseAccountingDirectionCounts();
  assert.equal(counts.received, 6);
  assert.equal(counts.spent, 6);
  assert.deepEqual(uiEntries.map((entry) => [entry.source, entry.sourceTransactionId, entry.direction]), [
    ["wise", "CARD-YELLOWSQUARE-CREDIT-55-60", "income"],
    ["wise", "CARD-3766611855", "expense"],
    ["paypal_manual", "paypal_manual:2026-05-13:booking-com-bv:-27-14:usd:payment", "expense"],
    ["paypal_manual", "paypal_manual:2026-05-14:provider-refund:36:usd:refund", "income"],
    ["monobank", "MONO-IN", "income"],
    ["monobank", "MONO-OUT", "expense"],
    ["privatbank", "PB-IN", "income"],
    ["privatbank", "PB-OUT", "expense"],
    ["yoomoney", "YM-IN", "income"],
    ["yoomoney", "YM-OUT", "expense"],
    ["binance", "BN-IN", "income"],
    ["binance", "BN-OUT", "expense"]
  ]);

  const ledger = buildLedgerDirectionContext();
  const ledgerRows = plain(ledger.buildLedgerRowsFromAccountingEntries(uiEntries));
  const saved = plain(ledger.normalizeManualLedgerRowsForSave(ledgerRows, []));

  assert.equal(saved.rows.length, 12);
  for (const entry of uiEntries.filter((item) => item.direction === "income")) {
    const row = saved.rows.find((candidate) => candidate.rawSourceId === entry.sourceTransactionId);
    assert.ok(row, `missing income ledger row for ${entry.source}:${entry.sourceTransactionId}`);
    assert.equal(row.operation, "income");
    assert.equal(row.fromChannel, "");
    assert.ok(row.toChannel);
    assert.equal(row.direction, "in");
    assert.equal(row.source, entry.source);
    assert.ok(Number.parseFloat(String(row.amountNet || row.amount).replace(",", ".")) >= 0);
  }
  for (const entry of uiEntries.filter((item) => item.direction === "expense")) {
    const row = saved.rows.find((candidate) => candidate.rawSourceId === entry.sourceTransactionId);
    assert.ok(row, `missing expense ledger row for ${entry.source}:${entry.sourceTransactionId}`);
    assert.match(row.operation, /^(business_expense|personal_expense)$/);
    assert.ok(row.fromChannel);
    assert.equal(row.toChannel, "");
    assert.equal(row.direction, "out");
    assert.ok(Number.parseFloat(String(row.amountNet || row.amount).replace(",", ".")) >= 0);
  }

  const paypalRefund = saved.rows.find((row) => row.rawSourceId === uiEntries[3].sourceTransactionId);
  assert.equal(paypalRefund.operation, "income");
  assert.equal(paypalRefund.amountNet, "");
});
