const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");
const importerJs = fs.readFileSync(path.join(__dirname, "..", "td-easyweb-importer.js"), "utf8");

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

test("expense UI exposes TD Bank helper wiring", () => {
  assert.match(uiJs, /TD Bank import helper/);
  assert.match(uiJs, /loadTdBankExpenseStatementFromClipboard/);
  assert.match(uiJs, /td-easyweb-importer\.js/);
  assert.match(uiJs, /state\.expenseAccounting\.tdBankLoading/);
  assert.match(uiJs, /state\.expenseAccounting\.tdBankSummary/);
});

test("normalizeTdBankClipboardEntries maps clipboard payload into ledger entries", () => {
  const context = {
    elements: {
      startDate: { value: "2026-04-01" },
      endDate: { value: "2026-04-30" },
    },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    normalizeExpenseAccountingEntry(entry) {
      return entry;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "compactTdBankDescription")}\n` +
    `${extractFunction(uiJs, "normalizeTdBankClipboardEntries")}\n` +
    "this.normalizeTdBankClipboardEntries = normalizeTdBankClipboardEntries;",
    context
  );

  const rows = plain(context.normalizeTdBankClipboardEntries({
    source: { provider: "tdbank", requestedStartDate: "2026-04-01", requestedEndDate: "2026-04-30" },
    items: [
      {
        occurredAt: "2026-04-11",
        direction: "expense",
        amount: 12.34,
        currency: "CAD",
        name: "Coffee",
        accountName: "TD Bank Chequing",
        runningBalance: 2400,
        runningBalanceCurrency: "CAD",
        providerTransactionId: "txn-1",
      },
      {
        occurredAt: "2026-05-01",
        direction: "expense",
        amount: 9.99,
        currency: "CAD",
      },
    ],
  }));

  assert.deepEqual(rows, [
    {
      date: "2026-04-11",
      channel: "БАНК КАНАДА cad",
      direction: "expense",
      localAmount: 12.34,
      currency: "CAD",
      usdAmount: null,
      suggestedCategory: "business",
      organization: "Coffee | account TD Bank Chequing | balance 2400 CAD",
      confidence: 0.95,
      source: "tdbank",
      sourceTransactionId: "txn-1",
    },
  ]);
});

test("td easyweb importer exposes collect helper", () => {
  assert.match(importerJs, /window\.TD_EASYWEB_IMPORTER = \{ collect \}/);
  assert.match(importerJs, /provider: "tdbank"/);
});
