const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

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

function buildContext() {
  const context = {
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-31" }
    },
    getManualFinanceChannels() {
      return ["пейпал дол", "приват 24-грн", "монобанк грн", "REVOLUT евро", "Payoneer - eur", "Payoneer - dol"];
    },
    inferManualFinanceChannelCurrency(channel) {
      if (/грн|uah/i.test(channel)) return "UAH";
      if (/евр|eur/i.test(channel)) return "EUR";
      return "USD";
    },
    normalizeIncomingSheetDateValue(value) {
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
    },
    normalizeLookupText(value) {
      return String(value || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    },
    parseLooseNumber(value) {
      const normalized = String(value || "").replace(/\s+/g, "").replace(",", ".");
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    normalizeExpenseAccountingEntry(entry) {
      return {
        date: entry.date,
        dateSource: entry.dateSource,
        channel: entry.channel,
        direction: entry.direction,
        localAmount: entry.localAmount,
        currency: entry.currency,
        amount_usd: entry.usdAmount,
        counterparty: entry.counterparty,
        organization: entry.organization,
        receivedType: entry.direction === "income" ? "serviceincome" : "",
        category: entry.direction === "income" ? "serviceIncome" : entry.suggestedCategory,
        suggestedCategory: entry.suggestedCategory,
        source: entry.source,
        sourceImageIndex: entry.sourceImageIndex
      };
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "parseExpenseOcrText")}\n` +
    `${extractFunction(uiJs, "parseCardReceiptExpenseOcrEntries")}\n` +
    `${extractFunction(uiJs, "isCardReceiptExpenseOcrContext")}\n` +
    `${extractFunction(uiJs, "extractUnsignedCardReceiptAmount")}\n` +
    `${extractFunction(uiJs, "findCardReceiptMerchant")}\n` +
    `${extractFunction(uiJs, "isCardReceiptMerchantLine")}\n` +
    `${extractFunction(uiJs, "inferCardReceiptOcrChannel")}\n` +
    `${extractFunction(uiJs, "isPrivat24ExpenseOcrContext")}\n` +
    `${extractFunction(uiJs, "hasYooMoneyExpenseOcrMarker")}\n` +
    `${extractFunction(uiJs, "parsePrivat24ExpenseOcrEntries")}\n` +
    `${extractFunction(uiJs, "isPrivat24ExpenseOcrContentLine")}\n` +
    `${extractFunction(uiJs, "extractStrictPrivat24ExpenseOcrAmount")}\n` +
    `${extractFunction(uiJs, "extractExpenseOcrDate")}\n` +
    `${extractFunction(uiJs, "getExpenseOcrPeriodYear")}\n` +
    `${extractFunction(uiJs, "getExpenseOcrMonthNumber")}\n` +
    `${extractFunction(uiJs, "extractExpenseOcrAmount")}\n` +
    `${extractFunction(uiJs, "normalizeExpenseOcrCurrency")}\n` +
    `${extractFunction(uiJs, "inferExpenseOcrDirection")}\n` +
    `${extractFunction(uiJs, "inferExpenseOcrChannel")}\n` +
    `${extractFunction(uiJs, "inferExpenseOcrCategory")}\n` +
    `${extractFunction(uiJs, "isExpenseOcrNoiseLine")}\n` +
    `${extractFunction(uiJs, "cleanupExpenseOcrOrganization")}\n` +
    "this.parseExpenseOcrText = parseExpenseOcrText;",
    context
  );
  return context;
}

test("browser OCR parses Ukrainian Privat24 date section and income card", () => {
  const context = buildContext();
  const result = context.parseExpenseOcrText(
    [
      "Privat24",
      "Сб, 16 травня",
      "Урсул Г.",
      "+8 700.00 UAH",
      "Залишок 17 340.00 UAH",
    ].join("\n"),
    0,
    ""
  );

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].date, "2026-05-16");
  assert.equal(result.entries[0].dateSource, "screenshot");
  assert.equal(result.entries[0].localAmount, 8700);
  assert.equal(result.entries[0].currency, "UAH");
});

test("browser OCR parses Google Wallet Payoneer unsigned card purchase", () => {
  const context = buildContext();
  const result = context.parseExpenseOcrText(
    [
      "Payoneer Card [PEL] ••9007",
      "SumUp *Raiz mediterra",
      "€30.00",
      "Completed • Thursday, May 21 at 2:06 p.m.",
      "Purchase made on phone",
    ].join("\n"),
    0,
    "2026-05-21"
  );

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].date, "2026-05-21");
  assert.equal(result.entries[0].dateSource, "screenshot");
  assert.equal(result.entries[0].direction, "expense");
  assert.equal(result.entries[0].localAmount, 30);
  assert.equal(result.entries[0].currency, "EUR");
  assert.equal(result.entries[0].channel, "Payoneer - eur");
  assert.equal(result.entries[0].counterparty, "SumUp *Raiz mediterra");
});

test("browser OCR ignores card suffixes while parsing unsigned receipt amount", () => {
  const context = buildContext();
  const result = context.parseExpenseOcrText(
    [
      "Google Wallet",
      "Payoneer Card [PEL] ••9007",
      "Virtual account 9293",
      "SumUp *Raiz mediterra",
      "30.00 EUR",
      "Completed • Thursday, May 21 at 2:06 p.m.",
    ].join("\n"),
    0,
    "2026-05-21"
  );

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].localAmount, 30);
  assert.equal(result.entries[0].currency, "EUR");
  assert.equal(result.entries[0].counterparty, "SumUp *Raiz mediterra");
});

test("browser OCR normalizes Privat24 income to serviceIncome channel and counterparty", () => {
  const context = buildContext();
  const result = context.parseExpenseOcrText("Privat24\nСб, 16 травня\nУрсул Г.\n+8 700.00 UAH", 0, "");
  const [entry] = result.entries;

  assert.equal(entry.direction, "income");
  assert.equal(entry.channel, "приват 24-грн");
  assert.equal(entry.category, "serviceIncome");
  assert.equal(entry.receivedType, "serviceincome");
  assert.equal(entry.counterparty, "Урсул Г.");
});

test("screenshot image validation accepts jpg extension when browser MIME is blank or octet-stream", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "isSupportedExpenseScreenshotImageFile")}\n` +
    "this.isSupportedExpenseScreenshotImageFile = isSupportedExpenseScreenshotImageFile;",
    context
  );

  assert.equal(context.isSupportedExpenseScreenshotImageFile({ name: "1000600099.jpg", type: "" }), true);
  assert.equal(context.isSupportedExpenseScreenshotImageFile({ name: "1000600099.jpg", type: "application/octet-stream" }), true);
  assert.equal(context.isSupportedExpenseScreenshotImageFile({ name: "1000600099.txt", type: "application/octet-stream" }), false);
});

test("browser OCR parses Payoneer card SumUp expense as one EUR row", () => {
  const context = buildContext();
  const result = context.parseExpenseOcrText(
    [
      "Payoneer card",
      "2026-05-21",
      "SumUp *Raiz mediterra",
      "-30 EUR",
      "Card payment",
    ].join("\n"),
    0,
    "2026-05-21"
  );

  assert.equal(result.entries.length, 1);
  assert.deepEqual({
    date: result.entries[0].date,
    localAmount: result.entries[0].localAmount,
    currency: result.entries[0].currency,
    counterparty: result.entries[0].counterparty,
    direction: result.entries[0].direction,
    channel: result.entries[0].channel,
  }, {
    date: "2026-05-21",
    localAmount: 30,
    currency: "EUR",
    counterparty: "SumUp *Raiz mediterra",
    direction: "expense",
    channel: "Payoneer - eur",
  });
});
