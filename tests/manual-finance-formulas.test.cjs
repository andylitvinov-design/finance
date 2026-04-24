const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateManualFinanceFormula,
  evaluateManualFinanceCellNumericValue,
  normalizeManualFinancePersistedNumberInput,
} = require("../manual-finance-formulas.js");

const FORMULA_KEY_BY_COLUMN = {
  A: "channel",
  B: "now",
  C: "serviceIncome",
  D: "business",
  E: "house",
  F: "food",
  G: "study",
  H: "travelFun",
  I: "total",
};

const rows = [
  {
    channel: "Яндекс руб",
    business: "=4000+6000",
    house: "5",
    food: "7",
    study: "11",
    travelFun: "13",
    total: "",
  },
  {
    channel: "PayPal",
    business: "=D3+E3",
    house: "2",
    food: "",
    study: "",
    travelFun: "",
    total: "",
  },
];

const options = {
  formulaKeyByColumn: FORMULA_KEY_BY_COLUMN,
  formulaRowOffset: 3,
};

test("evaluateManualFinanceFormula resolves direct arithmetic formulas", () => {
  assert.equal(evaluateManualFinanceFormula("=4000+6000", rows, options), 10000);
});

test("evaluateManualFinanceFormula resolves references to fact cells", () => {
  assert.equal(evaluateManualFinanceFormula("=D3+E3", rows, options), 10005);
});

test("evaluateManualFinanceCellNumericValue uses formulas as numeric source of truth", () => {
  assert.equal(evaluateManualFinanceCellNumericValue(rows, 1, "business", options), 10005);
});

test("normalizeManualFinancePersistedNumberInput stores formulas as final numbers", () => {
  assert.equal(
    normalizeManualFinancePersistedNumberInput("=D3+E3", {
      ...options,
      rows,
      rowIndex: 1,
      key: "business",
    }),
    "10005"
  );
});

test("normalizeManualFinancePersistedNumberInput evaluates plain arithmetic formulas without row context", () => {
  assert.equal(normalizeManualFinancePersistedNumberInput("=2000+5000"), "7000");
});

test("normalizeManualFinancePersistedNumberInput drops invalid formulas instead of persisting raw text", () => {
  assert.equal(
    normalizeManualFinancePersistedNumberInput("=SUM(D3:D4)", {
      ...options,
      rows,
      rowIndex: 0,
      key: "business",
    }),
    ""
  );
});
