const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mainJs = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const sheetsJs = fs.readFileSync(path.join(__dirname, "..", "google-sheets.js"), "utf8");

function extractFunction(source, name) {
  const pattern = new RegExp(`^function ${name}\\(`, "m");
  const match = pattern.exec(source);
  if (!match) throw new Error(`${name} was not found`);
  const next = source.slice(match.index + 1).search(/^function [A-Za-z0-9_]+\(/m);
  return next === -1
    ? source.slice(match.index).trim()
    : source.slice(match.index, match.index + 1 + next).trim();
}

const context = {
  getManualFinanceChannels() {
    return ["Яндекс руб", "Бинанс spot", "приват 24-грн"];
  },
  canonicalManualFinanceChannel(value) {
    return String(value || "").trim();
  },
  buildEmptyExpenseAmounts() {
    return { "Яндекс руб": "", "Бинанс spot": "", "приват 24-грн": "" };
  },
  normalizeManualFinancePersistedNumberInput(value) {
    return String(value || "");
  },
  normalizeManualExpenseCategory(value) {
    return String(value || "").trim();
  },
  assertIncomingExpenseHeaders() {},
};

vm.createContext(context);
vm.runInContext(
  [
    extractFunction(mainJs, "parseIsoDate"),
    extractFunction(mainJs, "parseDisplayDate"),
    extractFunction(mainJs, "parseDisplayDateToIso"),
    extractFunction(sheetsJs, "normalizeIncomingSheetDateValue"),
    extractFunction(sheetsJs, "parseIncomingExpenseSheetValues"),
    "this.normalizeIncomingSheetDateValue = normalizeIncomingSheetDateValue;",
    "this.parseIncomingExpenseSheetValues = parseIncomingExpenseSheetValues;",
  ].join("\n"),
  context
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("normalizeIncomingSheetDateValue keeps ISO timestamps inside the selected day", () => {
  assert.equal(context.normalizeIncomingSheetDateValue("2026-04-24 00:00:00"), "2026-04-24");
  assert.equal(context.normalizeIncomingSheetDateValue("2026-04-25T13:45:59"), "2026-04-25");
});

test("parseIncomingExpenseSheetValues keeps timestamped exchange rows for legacy expense grids", () => {
  const parsed = plain(context.parseIncomingExpenseSheetValues([
    ["дата", "категория", "Яндекс руб", "Бинанс spot", "приват 24-грн"],
    ["2026-04-24 00:00:00", "exchange", "-74669", "874", ""],
    ["2026-04-25 00:00:00", "exchange", "", "-950", "-4916"],
    ["2026-04-30", "exchange", "", "", "-4916"],
  ]));

  assert.deepEqual(parsed, [
    {
      date: "2026-04-24",
      category: "exchange",
      amounts: { "Яндекс руб": "-74669", "Бинанс spot": "874", "приват 24-грн": "" },
    },
    {
      date: "2026-04-25",
      category: "exchange",
      amounts: { "Яндекс руб": "", "Бинанс spot": "-950", "приват 24-грн": "-4916" },
    },
    {
      date: "2026-04-30",
      category: "exchange",
      amounts: { "Яндекс руб": "", "Бинанс spot": "", "приват 24-грн": "-4916" },
    },
  ]);
});
