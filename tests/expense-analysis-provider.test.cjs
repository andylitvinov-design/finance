const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");

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
    { channel: "пейпал евр", now: "0", serviceIncome: "222,7500", business: "20,0000", flat: "0", food: "0", fun: "0", study: "0", travel: "12,5000", total: "32,5000" }
  ]);
});
