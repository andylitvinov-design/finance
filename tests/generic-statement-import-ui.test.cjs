const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildGenericImportContext() {
  const context = {
    state: {
      config: {
        manualFinance: {
          channels: [
            "Яндекс руб",
            "пейпал дол",
            "пейпал евр",
            "приват 24-грн",
            "БАНК КАНАДА cad"
          ]
        }
      },
      expenseAccounting: {
        entries: [],
        warnings: [],
        resultTab: "spent",
        statementImportLoading: false
      }
    },
    elements: {
      startDate: { value: "2026-04-01" },
      endDate: { value: "2026-04-30" }
    },
    window: {},
    document: {
      head: {
        appendChild() {}
      },
      createElement() {
        return {};
      }
    },
    navigator: {},
    normalizeIncomingSheetDateValue(value) {
      const raw = String(value || "").trim();
      const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
      const slash = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      if (slash) return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
      return "";
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      const negative = /^\(.+\)$/.test(raw) || /^-/.test(raw);
      const normalized = raw.replace(/[()]/g, "").replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : 0;
    },
    getManualFinanceChannels() {
      return context.state.config.manualFinance.channels.slice();
    },
    canonicalManualFinanceChannel(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      return context.state.config.manualFinance.channels.find((channel) => channel.toLowerCase() === raw.toLowerCase()) || raw;
    },
    normalizeLookupText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^0-9a-zа-яіїєґ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    },
    XLSX: {
      read() {
        return {
          SheetNames: ["Sheet1"],
          Sheets: { Sheet1: {} }
        };
      },
      utils: {
        sheet_to_csv() {
          return [
            "Date,Description,Debit,Credit,Currency,Balance",
            "04/13/2026,XLSX expense,20.00,,CAD,2480.00",
            "04/14/2026,XLSX income,,200.00,CAD,2680.00"
          ].join("\n");
        }
      }
    },
    normalizeExpenseAccountingEntry(entry) {
      return entry;
    },
    setExpenseAccountingStatus(message, isError = false) {
      context.lastStatus = { message, isError };
    },
    renderTabs() {},
    lastStatus: { message: "", isError: false }
  };
  vm.createContext(context);
  vm.runInContext(
    `${uiJs}\n` +
    "renderTabs = function() {};\n" +
    "normalizeExpenseAccountingEntry = function(entry) { return entry; };\n" +
    "setExpenseAccountingStatus = function(message, isError) { globalThis.lastStatus = { message, isError: Boolean(isError) }; };\n" +
    "this.parseGenericStatementCsv = parseGenericStatementCsv;\n" +
    "this.parseGenericStatementText = parseGenericStatementText;\n" +
    "this.parseGenericStatementXlsx = parseGenericStatementXlsx;\n" +
    "this.parseExpenseStatementFile = parseExpenseStatementFile;\n" +
    "this.detectExpenseStatementFileType = detectExpenseStatementFileType;\n" +
    "this.detectGenericStatementProvider = detectGenericStatementProvider;\n" +
    "this.saveExpenseAccountingEntries = saveExpenseAccountingEntries;\n" +
    "this.normalizeStatementHeader = normalizeStatementHeader;\n" +
    "this.setPdfLoader = function(fn) { loadPdfJsIfNeeded = fn; };",
    context
  );
  return context;
}

test("expense UI exposes the generic statement import control", () => {
  assert.match(uiJs, /Загрузить выписку/);
  assert.match(uiJs, /importExpenseStatementFile/);
  assert.match(uiJs, /image\/\*,\.pdf,\.csv,\.xlsx,\.xls,text\/csv,application\/pdf/);
});

test("generic CSV detects TD Bank, maps debit and credit rows, and ignores balance as amount", () => {
  const context = buildGenericImportContext();
  const result = plain(context.parseGenericStatementCsv([
    "Date,Description,Withdrawals,Deposits,Balance",
    "04/11/2026,Coffee,12.34,,2400.00",
    "04/12/2026,Client deposit,,100.00,2500.00"
  ].join("\n"), {
    source: "csv_import",
    fileName: "td-easyweb-export.csv",
    normalizedFileName: "td-export"
  }));

  assert.equal(result.providerDetection.providerHint, "tdbank");
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((entry) => entry.direction), ["expense", "income"]);
  assert.deepEqual(result.entries.map((entry) => entry.localAmount), [12.34, 100]);
  assert.equal(result.entries[0].localAmount === 2400, false);
  assert.equal(result.entries[0].channel, "БАНК КАНАДА cad");
  assert.equal(result.entries[0].providerHint, "tdbank");
  assert.equal(result.entries[0].currency, "CAD");
  assert.equal(result.entries[0].source, "csv_import");
  assert.match(result.entries[0].sourceTransactionId, /^csv_import:td-export:0:2026-04-11:12\.34:CAD:coffee$/);
});

test("generic PayPal CSV detects provider and maps USD and EUR channels conservatively", () => {
  const context = buildGenericImportContext();
  assert.equal(context.normalizeStatementHeader("Gross"), "gross");
  assert.equal(context.normalizeStatementHeader("Source Amount"), "source amount");
  assert.equal(context.normalizeStatementHeader("Target Amount"), "target amount");
  assert.equal(context.normalizeStatementHeader("Transaction Amount"), "amount");
  const result = plain(context.parseGenericStatementCsv([
    "Date,Name,Gross,Fee,Net,Currency",
    "04/11/2026,US Client,120.00,-4.00,116.00,USD",
    "04/12/2026,EU Client,90.00,-3.00,87.00,EUR"
  ].join("\n"), {
    source: "csv_import",
    fileName: "paypal-activity.csv",
    normalizedFileName: "paypal-activity"
  }));

  assert.equal(result.providerDetection.providerHint, "paypal");
  assert.deepEqual(result.entries.map((entry) => entry.channel), ["пейпал дол", "пейпал евр"]);
  assert.deepEqual(result.entries.map((entry) => entry.providerHint), ["paypal", "paypal"]);
  assert.deepEqual(result.entries.map((entry) => entry.localAmount), [116, 87]);
  assert.match(result.entries[0].rawMetadata, /PayPal net used as amount/);
  assert.match(result.entries[0].rawMetadata, /gross=120/);
  assert.match(result.entries[0].rawMetadata, /fee=-4/);
});

test("generic PayPal CSV does not treat Gross as a saveable amount when Net is missing", () => {
  const context = buildGenericImportContext();
  const result = plain(context.parseGenericStatementCsv([
    "Date,Name,Gross,Fee,Net,Currency",
    "04/11/2026,US Client,120.00,-4.00,,USD"
  ].join("\n"), {
    source: "csv_import",
    fileName: "paypal-activity.csv",
    normalizedFileName: "paypal-activity"
  }));

  assert.equal(result.providerDetection.providerHint, "paypal");
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].localAmount, 120);
  assert.equal(result.entries[0].channel, "");
  assert.equal(result.entries[0].review_status, "needs_review");
  assert.match(result.entries[0].rawMetadata, /PayPal net missing; gross used for review only/);
});

test("generic Privat and YooMoney statements map only provider-specific currency channels", () => {
  const context = buildGenericImportContext();
  const privat = plain(context.parseGenericStatementCsv([
    "Дата,Описание,Сумма,Валюта",
    "12.04.2026,Приват карта оплата,-120.00,UAH"
  ].join("\n"), {
    source: "csv_import",
    fileName: "privat24-card.csv",
    normalizedFileName: "privat24-card"
  }));
  const yoomoney = plain(context.parseGenericStatementCsv([
    "Date,Description,Amount,Currency",
    "2026-04-12,YooMoney кошелек payment,-500.00,RUB"
  ].join("\n"), {
    source: "csv_import",
    fileName: "yandex-wallet.csv",
    normalizedFileName: "yandex-wallet"
  }));

  assert.equal(privat.providerDetection.providerHint, "privatbank");
  assert.equal(privat.entries[0].channel, "приват 24-грн");
  assert.equal(yoomoney.providerDetection.providerHint, "yoomoney");
  assert.equal(yoomoney.entries[0].channel, "Яндекс руб");
});

test("generic Wise statement stays needs_review when no exact Wise channel exists", () => {
  const context = buildGenericImportContext();
  const result = plain(context.parseGenericStatementCsv([
    "Date,Description,Source Amount,Target Amount,Currency",
    "2026-04-12,Wise card transaction,-25.00,,USD"
  ].join("\n"), {
    source: "csv_import",
    fileName: "wise-card.csv",
    normalizedFileName: "wise-card"
  }));

  assert.equal(result.providerDetection.providerHint, "wise");
  assert.equal(result.entries[0].providerHint, "wise");
  assert.equal(result.entries[0].channel, "");
  assert.equal(result.entries[0].review_status, "needs_review");
  assert.match(result.entries[0].rawMetadata, /Wise source\/target amount requires provider-specific review/);
});

test("unknown USD statement does not infer PayPal or Wise from currency alone", () => {
  const context = buildGenericImportContext();
  const result = plain(context.parseGenericStatementCsv([
    "Date,Description,Amount,Currency",
    "2026-04-12,Client payment,100.00,USD"
  ].join("\n"), {
    source: "csv_import",
    fileName: "statement.csv",
    normalizedFileName: "statement"
  }));

  assert.equal(result.providerDetection.providerHint, "");
  assert.equal(result.entries[0].providerHint, "");
  assert.equal(result.entries[0].channel, "");
  assert.equal(result.entries[0].review_status, "needs_review");
});

test("generic CSV amount-only rows infer direction from sign without using balance", () => {
  const context = buildGenericImportContext();
  const result = plain(context.parseGenericStatementCsv([
    "Дата,Описание,Сумма,Валюта,Остаток",
    "12.04.2026,Card charge,-12.34,USD,998.00",
    "13.04.2026,Client payment,100.00,USD,1098.00"
  ].join("\n"), {
    source: "csv_import",
    normalizedFileName: "generic-usd"
  }));

  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((entry) => entry.direction), ["expense", "income"]);
  assert.deepEqual(result.entries.map((entry) => entry.localAmount), [12.34, 100]);
  assert.deepEqual(result.entries.map((entry) => entry.review_status), ["needs_review", "needs_review"]);
  assert.deepEqual(result.entries.map((entry) => entry.channel), ["", ""]);
});

test("save blocks generic rows that still need channel review", async () => {
  const context = buildGenericImportContext();
  context.state.expenseAccounting.entries = [
    {
      date: "2026-04-12",
      channel: "",
      localAmount: 100,
      source: "csv_import",
      review_status: "needs_review"
    }
  ];

  await context.saveExpenseAccountingEntries();

  assert.equal(context.lastStatus.isError, true);
  assert.match(context.lastStatus.message, /строки без канала/);
});

test("generic XLSX reuses XLSX conversion and returns accounting entries", async () => {
  const context = buildGenericImportContext();
  const result = plain(await context.parseGenericStatementXlsx({
    name: "statement.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  }, {
    source: "xlsx_import",
    normalizedFileName: "statement",
    provider: "td",
    defaultChannel: "БАНК КАНАДА cad",
    defaultCurrency: "CAD"
  }));

  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((entry) => entry.source), ["xlsx_import", "xlsx_import"]);
  assert.deepEqual(result.entries.map((entry) => entry.localAmount), [20, 200]);
});

test("PDF text import parses text operations and empty PDF returns controlled message", async () => {
  const context = buildGenericImportContext();
  context.setPdfLoader(async () => ({
    getDocument() {
      return {
        promise: {
          numPages: 1,
          async getPage() {
            return {
              async getTextContent() {
                return {
                  items: [
                    { str: "Date,Description,Debit,Credit,Balance" },
                    { str: "04/15/2026,PDF expense,33.00,,900.00" },
                    { str: "04/16/2026,PDF income,,150.00,1050.00" }
                  ]
                };
              }
            };
          }
        }
      };
    }
  }));

  const parsed = plain(await context.parseExpenseStatementFile({
    name: "statement.pdf",
    type: "application/pdf",
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  }));

  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.entries.map((entry) => entry.source), ["pdf_import", "pdf_import"]);
  assert.deepEqual(parsed.entries.map((entry) => entry.direction), ["expense", "income"]);

  context.setPdfLoader(async () => ({
    getDocument() {
      return {
        promise: {
          numPages: 0
        }
      };
    }
  }));
  const empty = plain(await context.parseExpenseStatementFile({
    name: "empty.pdf",
    type: "application/pdf",
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  }));

  assert.equal(empty.entries.length, 0);
  assert.match(empty.emptyMessage, /PDF прочитан, но текстовые операции не найдены/);
});
