const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildOcrContext() {
  const channels = ["Яндекс руб", "приват 24-грн", "монобанк грн", "пейпал дол"];
  const context = {
    elements: {
      endDate: { value: "2026-05-31" },
    },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    parseLooseNumber(value) {
      const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    getManualFinanceChannels() {
      return channels;
    },
    inferManualFinanceChannelCurrency(channel) {
      if (channel === "Яндекс руб") return "RUB";
      if (channel === "пейпал дол") return "USD";
      return "UAH";
    },
    normalizeLookupText(value) {
      return String(value || "").toLowerCase();
    },
    normalizeExpenseAccountingEntry(entry) {
      return entry;
    },
  };
  require("node:vm").createContext(context);
  require("node:vm").runInContext([
    extractFunction(uiJs, "parseExpenseOcrText"),
    extractFunction(uiJs, "isPrivat24ExpenseOcrContext"),
    extractFunction(uiJs, "hasYooMoneyExpenseOcrMarker"),
    extractFunction(uiJs, "parsePrivat24ExpenseOcrEntries"),
    extractFunction(uiJs, "isPrivat24ExpenseOcrContentLine"),
    extractFunction(uiJs, "extractStrictPrivat24ExpenseOcrAmount"),
    extractFunction(uiJs, "extractExpenseOcrDate"),
    extractFunction(uiJs, "extractExpenseOcrAmount"),
    extractFunction(uiJs, "normalizeExpenseOcrCurrency"),
    extractFunction(uiJs, "inferExpenseOcrDirection"),
    extractFunction(uiJs, "inferExpenseOcrChannel"),
    extractFunction(uiJs, "inferExpenseOcrCategory"),
    extractFunction(uiJs, "cleanupExpenseOcrOrganization"),
    "this.parseExpenseOcrText = parseExpenseOcrText;",
  ].join("\n"), context);
  return context;
}

test("UI exposes personal Privat24 CSV/XLSX import as the primary path", () => {
  assert.match(uiJs, /Для личного Приват24 используйте импорт выписки CSV\/XLSX\. Business API доступен только для бизнес-счетов\./);
  assert.match(uiJs, /Импорт Privat24 CSV\/XLSX/);
  assert.match(uiJs, /Privat API \(business\)/);
  assert.match(uiJs, /function renderPrivat24ImportHelper/);
  assert.match(uiJs, /async function importPrivat24StatementFile/);
  assert.match(uiJs, /function readPrivat24XlsxFile/);
  assert.match(uiJs, /action: "parseStatement"/);
});

test("Privat24 OCR extracts signed UAH income with Ukrainian month date", () => {
  const context = buildOcrContext();
  const parsed = plain(context.parseExpenseOcrText([
    "Privat24 Історія картки UAH",
    "Сб, 16 травня",
    "Урсул Г.",
    "+8 700.00 UAH",
  ].join("\n"), 0, "2026-05-20"));

  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].direction, "income");
  assert.equal(parsed.entries[0].channel, "приват 24-грн");
  assert.equal(parsed.entries[0].currency, "UAH");
  assert.equal(parsed.entries[0].localAmount, 8700);
  assert.equal(parsed.entries[0].date, "2026-05-16");
  assert.match(parsed.warnings.join("\n"), /Privat24 OCR context detected; broad OCR rows suppressed\./);
});

test("Privat24 OCR does not map OCR RUB noise to Yandex channel", () => {
  const context = buildOcrContext();
  const parsed = plain(context.parseExpenseOcrText([
    "Приват24 історія картки",
    "Вт, 12 травня",
    "GOOGLE",
    "-4 842.92 RUB",
  ].join("\n"), 0, "2026-05-20"));

  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].channel, "приват 24-грн");
  assert.equal(parsed.entries[0].currency, "UAH");
  assert.equal(parsed.entries[0].localAmount, 4842.92);
});

test("YooMoney OCR with RUB still maps to Yandex channel outside Privat24 context", () => {
  const context = buildOcrContext();
  const parsed = plain(context.parseExpenseOcrText("ЮMoney payment -156.62 RUB", 0, "2026-05-20"));

  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].channel, "Яндекс руб");
  assert.equal(parsed.entries[0].currency, "RUB");
});

test("browser OCR does not infer Yandex from bare RUB without provider marker", () => {
  const context = buildOcrContext();
  const parsed = plain(context.parseExpenseOcrText("Unknown payment -156.62 RUB", 0, "2026-05-20"));

  assert.equal(parsed.entries.length, 1);
  assert.notEqual(parsed.entries[0].channel, "Яндекс руб");
});

test("Privat24 OCR rejects standalone numbers, card endings, times, headers, and dates as amounts", () => {
  const context = buildOcrContext();
  const parsed = plain(context.parseExpenseOcrText([
    "Privat24 Історія картки UAH",
    "5",
    "12",
    "16",
    "29",
    "15662",
    "Картка *1234",
    "12:34",
    "99%",
    "Ср, 29 квітня",
  ].join("\n"), 0, "2026-05-20"));

  assert.deepEqual(parsed.entries, []);
});
