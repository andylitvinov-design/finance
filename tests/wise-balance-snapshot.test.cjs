const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const googleSheetsJs = fs.readFileSync(path.join(root, "google-sheets.js"), "utf8");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}`);
  if (start === -1) start = source.indexOf(`function ${name}`);
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

test("buildWiseBalanceSnapshotRows maps Wise balances into Остатки rows", () => {
  const context = {
    state: {
      aggregatedManualRange: { transferRows: [] },
      manualTransfers: { data: { transferRows: [] } },
      manualFinance: { data: { transferRows: [] } },
      data: { tabs: { movement: { values: [] } } }
    },
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    normalizeManualFinancePersistedNumberInput(value) {
      const raw = String(value ?? "").trim();
      return raw ? raw.replace(".", ",") : "";
    },
    normalizeLookupText(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    },
    inferManualFinanceChannelCurrency(channel) {
      if (/eur|евр/i.test(String(channel || ""))) return "EUR";
      if (/cad|сad/i.test(String(channel || ""))) return "CAD";
      return "USD";
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
    inferManualFinanceChannelCurrency(channel) {
      if (/eur|евр/i.test(String(channel || ""))) return "EUR";
      if (/cad|сad/i.test(String(channel || ""))) return "CAD";
      return "USD";
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    buildManualBalanceRowsFromAmounts(date, amounts) {
      return Object.entries(amounts).map(([channel, amount]) => ({
        date,
        channel,
        amount,
        currency: channel === "трансервайз евро" ? "EUR" : "USD",
        rate: channel === "трансервайз евро" ? "1,200000" : "1,000000",
        usdAmount: channel === "трансервайз евро" ? "99,12" : amount,
        comment: ""
      }));
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "buildWiseBalanceSnapshotRows")}\nthis.buildWiseBalanceSnapshotRows = buildWiseBalanceSnapshotRows;`,
    context
  );

  const rows = plain(context.buildWiseBalanceSnapshotRows([
    { channel: "трансервайз дол", currency: "USD", amount: 120.45, amountUsd: 120.45 },
    { channel: "трансервайз евро", currency: "EUR", amount: 85.5, amountUsd: "" }
  ], "2026-05-02"));

  assert.deepEqual(rows, [
    {
      date: "2026-05-02",
      channel: "трансервайз дол",
      amount: "120,45",
      currency: "USD",
      rate: "1,000000",
      usdAmount: "120,45",
      comment: "wise auto snapshot"
    },
    {
      date: "2026-05-02",
      channel: "трансервайз евро",
      amount: "85,5",
      currency: "EUR",
      rate: "1,200000",
      usdAmount: "99,12",
      comment: "wise auto snapshot"
    }
  ]);
});

test("saveWiseBalanceSnapshotsIfNeeded saves only once per session and skips without Google access", async () => {
  const savedRows = [];
  const logCalls = [];
  const context = {
    state: {
      expenseAccounting: {
        wiseBalanceSnapshotKeys: new Set()
      }
    },
    Date: class MockDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : ["2026-05-02T09:00:00.000Z"]));
      }
    },
    console: {
      log(...args) {
        logCalls.push(args);
      }
    },
    formatDateInputValue() {
      return "2026-05-02";
    },
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    buildWiseBalanceSnapshotRows(balances, snapshotDate) {
      return (balances || []).map((balance) => ({
        date: snapshotDate,
        channel: balance.channel,
        amount: String(balance.amount),
        currency: balance.currency,
        rate: "",
        usdAmount: String(balance.amountUsd || ""),
        comment: "wise auto snapshot"
      }));
    },
    hasConfiguredManualFinanceEndpoint() {
      return true;
    },
    async saveBalanceSnapshotRowsDirect(rows) {
      savedRows.push(...rows);
      return { rowCount: rows.length, savedAt: "saved-now" };
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "getWiseBalanceSnapshotAttemptKey")}\n` +
    `${extractFunction(uiJs, "saveWiseBalanceSnapshotsIfNeeded")}\n` +
    "this.saveWiseBalanceSnapshotsIfNeeded = saveWiseBalanceSnapshotsIfNeeded;",
    context
  );

  const first = plain(await context.saveWiseBalanceSnapshotsIfNeeded([
    { channel: "трансервайз дол", currency: "USD", amount: 120.45, amountUsd: 120.45 },
    { channel: "трансервайз евро", currency: "EUR", amount: 85.5, amountUsd: "" }
  ]));
  const second = plain(await context.saveWiseBalanceSnapshotsIfNeeded([
    { channel: "трансервайз дол", currency: "USD", amount: 120.45, amountUsd: 120.45 }
  ]));

  assert.equal(first.saved, true);
  assert.match(first.statusSuffix, /Balance snapshot saved: 2 канал/);
  assert.equal(savedRows.length, 2);
  assert.equal(logCalls.length, 1);
  assert.equal(second.saved, false);
  assert.match(second.statusSuffix, /уже сохранялся/);

  context.hasConfiguredManualFinanceEndpoint = () => false;
  context.state.expenseAccounting.wiseBalanceSnapshotKeys = new Set();
  const skipped = plain(await context.saveWiseBalanceSnapshotsIfNeeded([
    { channel: "трансервайз дол", currency: "USD", amount: 120.45, amountUsd: 120.45 }
  ]));
  assert.equal(skipped.saved, false);
  assert.match(skipped.statusSuffix, /Google write access/);
});

test("saveBalanceSnapshotRowsDirect replaces same date and channel instead of duplicating", async () => {
  const writtenPayloads = [];
  const context = {
    getManualBalancesSheetName() {
      return "Остатки";
    },
    getManualFinanceSpreadsheetId() {
      return "spreadsheet-id";
    },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    normalizeManualFinancePersistedNumberInput(value) {
      const raw = String(value ?? "").trim();
      return raw ? raw.replace(".", ",") : "";
    },
    normalizeLookupText(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    },
    inferManualFinanceChannelCurrency(channel) {
      if (/eur|евр/i.test(String(channel || ""))) return "EUR";
      if (/cad|сad/i.test(String(channel || ""))) return "CAD";
      return "USD";
    },
    parseIncomingBalanceSheetValues(values) {
      return (values || []).slice(1).map((row) => ({
        date: row[0],
        channel: row[1],
        amount: row[2],
        currency: row[3],
        rate: row[4],
        usdAmount: row[5],
        comment: row[6]
      }));
    },
    buildIncomingBalanceSheetValues(rows) {
      return [
        ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
        ...rows.map((row) => [row.date, row.channel, row.amount, row.currency, row.rate, row.usdAmount, row.comment])
      ];
    },
    async getManualSpreadsheetMetadata() {
      return { sheets: [{ properties: { title: "Остатки" } }] };
    },
    async getSheetValuesByTitle() {
      return [
        ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
        ["2026-05-02", "трансервайз дол", "50", "USD", "1", "50", "old"],
      ];
    },
    async ensureSheetExists() {},
    async overwriteSheetValues(_sheetName, values) {
      writtenPayloads.push(values);
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(googleSheetsJs, "appendManualBalanceSourceMarker")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualBalanceCurrencyForSave")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualBalanceChannelForSave")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualBalanceRowForSave")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualBalanceRowsForSave")}\n` +
    `${extractFunction(googleSheetsJs, "makeManualBalanceRowKey")}\n` +
    `${extractFunction(googleSheetsJs, "mergeManualBalanceRowsWithStats")}\n` +
    `${extractFunction(googleSheetsJs, "saveBalanceSnapshotRowsDirect")}\n` +
    "this.saveBalanceSnapshotRowsDirect = saveBalanceSnapshotRowsDirect;",
    context
  );

  const result = plain(await context.saveBalanceSnapshotRowsDirect([
    {
      date: "2026-05-02",
      channel: "трансервайз дол",
      amount: "120,45",
      currency: "USD",
      rate: "1",
      usdAmount: "120,45",
      comment: "wise auto snapshot"
    }
  ]));

  assert.equal(result.rowCount, 1);
  assert.equal(writtenPayloads.length, 1);
  assert.deepEqual(writtenPayloads[0], [
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
    ["2026-05-02", "трансервайз дол", "120,45", "USD", "1", "120,45", "wise auto snapshot"]
  ]);
});

test("mergeManualBalanceRows keeps same channel balances separated by currency", () => {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    normalizeManualFinancePersistedNumberInput(value) {
      return String(value ?? "").trim();
    },
    normalizeLookupText(value) {
      return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    },
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    inferManualFinanceChannelCurrency(channel) {
      if (/cad|сad/i.test(String(channel || ""))) return "CAD";
      return "USD";
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(googleSheetsJs, "appendManualBalanceSourceMarker")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualBalanceCurrencyForSave")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualBalanceChannelForSave")}\n` +
    `${extractFunction(googleSheetsJs, "normalizeManualBalanceRowForSave")}\n` +
    `${extractFunction(googleSheetsJs, "makeManualBalanceRowKey")}\n` +
    `${extractFunction(googleSheetsJs, "mergeManualBalanceRowsWithStats")}\n` +
    `${extractFunction(googleSheetsJs, "mergeManualBalanceRows")}\n` +
    "this.mergeManualBalanceRows = mergeManualBalanceRows;",
    context
  );

  const merged = plain(context.mergeManualBalanceRows(
    [
      { date: "2026-05-17", channel: "пейпал сad", currency: "CAD", amount: "10" },
      { date: "2026-05-17", channel: "пейпал сad", currency: "USD", amount: "20" },
    ],
    [
      { date: "2026-05-17", channel: "пейпал сad", currency: "USD", amount: "25" },
    ]
  ));

  assert.deepEqual(merged, [
    { date: "2026-05-17", channel: "пейпал сad", currency: "CAD", amount: "10", rate: "", usdAmount: "", comment: "" },
    { date: "2026-05-17", channel: "пейпал сad", currency: "USD", amount: "25", rate: "", usdAmount: "", comment: "" },
  ]);
});
