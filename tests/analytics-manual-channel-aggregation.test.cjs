const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const financeJs = fs.readFileSync(path.join(__dirname, "..", "finance.js"), "utf8");

function extractFunction(name) {
  const pattern = new RegExp(`^function ${name}\\(`, "m");
  const match = pattern.exec(financeJs);
  if (!match) throw new Error(`${name} was not found in finance.js`);
  const next = financeJs.slice(match.index + 1).search(/^function [A-Za-z0-9_]+\(/m);
  return next === -1
    ? financeJs.slice(match.index).trim()
    : financeJs.slice(match.index, match.index + 1 + next).trim();
}

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatSheetNumber(value, digits = 4) {
  return Number(value || 0).toFixed(digits).replace(".", ",");
}

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

const source = [
  extractFunction("normalizeLookupText"),
  extractFunction("resolveManualFinanceChannelAlias"),
  extractFunction("canonicalManualFinanceChannel"),
  extractFunction("getCanonicalManualChannelKey"),
  extractFunction("buildEmptyExpenseAmounts"),
  extractFunction("getCanonicalManualExpenseAmounts"),
  extractFunction("createLegacyFactMoneyRow"),
  extractFunction("calculateLegacyFactRowTotal"),
  extractFunction("normalizeManualFinanceMoneyRows"),
  extractFunction("buildLegacyFactMoneyRowsFromExpenseRows"),
];

const manualChannels = ["пейпал дол", "пейпал евр", "приват 24-грн", "монобанк грн"];

const context = {
  MANUAL_FINANCE_TOTAL_LABEL: "Итого",
  MANUAL_FINANCE_MONEY_CHANNELS: manualChannels,
  getManualFinanceChannels() {
    return manualChannels.slice();
  },
  parseLooseNumber,
  formatSheetNumber,
  normalizeCell,
  getManualFinanceComputedAmount(value) {
    return parseLooseNumber(value);
  },
  evaluateManualFinanceCellNumericValue(rows, rowIndex, key) {
    return parseLooseNumber(rows?.[rowIndex]?.[key]);
  }
};

vm.createContext(context);
vm.runInContext(
  `${source.join("\n")}\nthis.buildLegacyFactMoneyRowsFromExpenseRows = buildLegacyFactMoneyRowsFromExpenseRows;`,
  context
);

function rowByChannel(rows, channel) {
  return rows.find((row) => row.channel === channel);
}

test("buildLegacyFactMoneyRowsFromExpenseRows aggregates alias channels into canonical analytics rows", () => {
  const rows = context.buildLegacyFactMoneyRowsFromExpenseRows([
    {
      category: "serviceIncome",
      amounts: {
        "paypal usd": "100",
        "paypal eur": "200",
        "privat 24 грн": "300",
        "monobank uah": "400"
      }
    },
    {
      category: "business",
      amounts: {
        "пейпал дол": "10",
        "пейпал евр": "20",
        "приват 24-грн": "30",
        "монобанк грн": "40"
      }
    },
    {
      category: "flat",
      amounts: {
        "paypal usd": "1",
        "paypal eur": "2",
        "privat 24 грн": "3",
        "monobank uah": "4"
      }
    },
    {
      category: "food",
      amounts: {
        "paypal usd": "5",
        "paypal eur": "6",
        "privat 24 грн": "7",
        "monobank uah": "8"
      }
    },
    {
      category: "fun",
      amounts: {
        "paypal usd": "9",
        "paypal eur": "10",
        "privat 24 грн": "11",
        "monobank uah": "12"
      }
    },
    {
      category: "study",
      amounts: {
        "paypal usd": "13",
        "paypal eur": "14",
        "privat 24 грн": "15",
        "monobank uah": "16"
      }
    },
    {
      category: "travel",
      amounts: {
        "paypal usd": "17",
        "paypal eur": "18",
        "privat 24 грн": "19",
        "monobank uah": "20"
      }
    },
    {
      category: "exchange",
      amounts: {
        "paypal usd": "21",
        "paypal eur": "22",
        "privat 24 грн": "23",
        "monobank uah": "24"
      }
    }
  ]);

  assert.equal(rowByChannel(rows, "пейпал дол").serviceIncome, "100,0000");
  assert.equal(rowByChannel(rows, "пейпал евр").serviceIncome, "200,0000");
  assert.equal(rowByChannel(rows, "приват 24-грн").serviceIncome, "300,0000");
  assert.equal(rowByChannel(rows, "монобанк грн").serviceIncome, "400,0000");

  assert.equal(rowByChannel(rows, "пейпал дол").house, "1,0000");
  assert.equal(rowByChannel(rows, "пейпал евр").house, "2,0000");
  assert.equal(rowByChannel(rows, "приват 24-грн").house, "3,0000");
  assert.equal(rowByChannel(rows, "монобанк грн").house, "4,0000");

  assert.equal(rowByChannel(rows, "пейпал дол").exchange, "21,0000");
  assert.equal(rowByChannel(rows, "пейпал евр").exchange, "22,0000");
  assert.equal(rowByChannel(rows, "приват 24-грн").exchange, "23,0000");
  assert.equal(rowByChannel(rows, "монобанк грн").exchange, "24,0000");

  assert.equal(rowByChannel(rows, "пейпал дол").total, "55,0000");
  assert.equal(rowByChannel(rows, "пейпал евр").total, "70,0000");
  assert.equal(rowByChannel(rows, "приват 24-грн").total, "85,0000");
  assert.equal(rowByChannel(rows, "монобанк грн").total, "100,0000");

  const totalRow = rowByChannel(rows, "Итого");
  assert.equal(totalRow.serviceIncome, "1000,0000");
  assert.equal(totalRow.business, "100,0000");
  assert.equal(totalRow.house, "10,0000");
  assert.equal(totalRow.food, "26,0000");
  assert.equal(totalRow.fun, "42,0000");
  assert.equal(totalRow.study, "58,0000");
  assert.equal(totalRow.travelFun, "74,0000");
  assert.equal(totalRow.exchange, "90,0000");
  assert.equal(totalRow.total, "310,0000");
});
