const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mainJs = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const sheetsJs = fs.readFileSync(path.join(__dirname, "..", "google-sheets.js"), "utf8");
const ordersJs = fs.readFileSync(path.join(__dirname, "..", "orders.js"), "utf8");
const financeJs = fs.readFileSync(path.join(__dirname, "..", "finance.js"), "utf8");

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
  MANUAL_FINANCE_TOTAL_LABEL: "Итого",
  MANUAL_ORDERS_HEADERS: ["ДАТА", "ИМЯ", "ЗАКАЗ", "СТОИМОСТЬ", "СКИДКА", "ИТОГО"],
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
  elements: {
    startDate: { value: "2026-04-01" },
    endDate: { value: "2026-04-30" },
  },
  state: {
    manualOrders: {
      data: null,
    },
    data: {
      tabs: {
        orders: {
          values: [],
        },
      },
    },
  },
  isManualFinanceFormula() {
    return false;
  },
  isTableTotalRow() {
    return false;
  },
  assertIncomingExpenseHeaders() {},
};

vm.createContext(context);
vm.runInContext(
  [
    extractFunction(mainJs, "parseIsoDate"),
    extractFunction(mainJs, "parseDisplayDate"),
    extractFunction(mainJs, "parseDisplayDateToIso"),
    extractFunction(mainJs, "findDateColumnIndex"),
    extractFunction(mainJs, "normalizeCell"),
    extractFunction(mainJs, "hasAnyValue"),
    extractFunction(mainJs, "padRowToWidth"),
    extractFunction(mainJs, "parseLooseNumber"),
    extractFunction(mainJs, "roundTo2"),
    extractFunction(financeJs, "findHeaderIndexByAliases"),
    extractFunction(financeJs, "formatSheetNumber"),
    extractFunction(ordersJs, "recalculateManualOrderRow"),
    extractFunction(ordersJs, "appendManualOrdersTotalRow"),
    extractFunction(ordersJs, "buildManualOrdersTotalRow"),
    extractFunction(ordersJs, "getVisibleManualOrdersRows"),
    extractFunction(ordersJs, "buildOrdersSummaryFromClient"),
    extractFunction(ordersJs, "isManualOrdersTotalRow"),
    extractFunction(sheetsJs, "normalizeIncomingSheetDateValue"),
    extractFunction(sheetsJs, "parseIncomingExpenseSheetValues"),
    "this.parseDisplayDate = parseDisplayDate;",
    "this.getVisibleManualOrdersRows = getVisibleManualOrdersRows;",
    "this.buildOrdersSummaryFromClient = buildOrdersSummaryFromClient;",
    "this.normalizeIncomingSheetDateValue = normalizeIncomingSheetDateValue;",
    "this.parseIncomingExpenseSheetValues = parseIncomingExpenseSheetValues;",
  ].join("\n"),
  context
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function dateIso(value) {
  if (!value) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

test("normalizeIncomingSheetDateValue keeps ISO timestamps inside the selected day", () => {
  assert.equal(context.normalizeIncomingSheetDateValue("2026-04-24 00:00:00"), "2026-04-24");
  assert.equal(context.normalizeIncomingSheetDateValue("2026-04-25T13:45:59"), "2026-04-25");
});

test("parseDisplayDate supports slash dates and yearless period dates without changing existing formats", () => {
  assert.equal(dateIso(context.parseDisplayDate("2026-04-30")), "2026-04-30");
  assert.equal(dateIso(context.parseDisplayDate("2026-04-30 00:00:00")), "2026-04-30");
  assert.equal(dateIso(context.parseDisplayDate("30.04.2026")), "2026-04-30");
  assert.equal(dateIso(context.parseDisplayDate("30/04/2026")), "2026-04-30");
  assert.equal(dateIso(context.parseDisplayDate("30/04", 2026)), "2026-04-30");
  assert.equal(dateIso(context.parseDisplayDate("30.04", 2026)), "2026-04-30");
  assert.equal(context.parseDisplayDate("30/04"), null);
});

test("getVisibleManualOrdersRows includes William short-date order in April plan orders", () => {
  const williamRow = ["30/04", "William", "трансервайз дол", "206", "50%", "103"];
  context.state.manualOrders.data = {
    headers: context.MANUAL_ORDERS_HEADERS,
    rows: [
      williamRow,
      ["01/05", "May client", "трансервайз дол", "103", "50%", "51.5"],
    ],
  };

  const visible = plain(context.getVisibleManualOrdersRows("2026-04-01", "2026-04-30"));
  assert.deepEqual(visible.rows, [
    ["30/04", "William", "трансервайз дол", "206,0000", "50%", "103,0000"],
    ["", "", "Итого", "206,0000", "", "103,0000"],
  ]);

  const summary = plain(context.buildOrdersSummaryFromClient([visible.headers, ...visible.rows]));
  assert.equal(summary.orderRows, 1);
  assert.equal(summary.personalOrdersGross, 206);
  assert.equal(summary.totalAccruedPlus3Pct, 103);
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

// --- applyLatestBalanceUsdToMoneyRows regression tests ---
{
  const applyFn = extractFunction(sheetsJs, "applyLatestBalanceUsdToMoneyRows");
  const ctxApply = vm.createContext({ parseLooseNumber: context.parseLooseNumber, formatSheetNumber: context.formatSheetNumber });
  vm.runInContext(applyFn + "\nthis.applyLatestBalanceUsdToMoneyRows = applyLatestBalanceUsdToMoneyRows;", ctxApply);

  test("applyLatestBalanceUsdToMoneyRows uses explicit usdAmount from CAD balance row", () => {
    const moneyRows = [{ channel: "БАНК КАНАДА cad", now: "1000", nowUsd: "" }];
    const latest = { "БАНК КАНАДА cad": { value: "1000", currency: "CAD", rate: "1.35", usdAmount: "740.74" } };
    const result = ctxApply.applyLatestBalanceUsdToMoneyRows(moneyRows, latest);
    assert.equal(result[0].channel, "БАНК КАНАДА cad");
    assert.ok(Math.abs(parseFloat(String(result[0].nowUsd).replace(",", ".")) - 740.74) < 0.01);
  });

  test("applyLatestBalanceUsdToMoneyRows converts EUR row with rate when no explicit usdAmount", () => {
    const moneyRows = [{ channel: "пейпал евр", now: "100", nowUsd: "" }];
    const latest = { "пейпал евр": { value: "100", currency: "EUR", rate: "0.86", usdAmount: "" } };
    const result = ctxApply.applyLatestBalanceUsdToMoneyRows(moneyRows, latest);
    assert.ok(Math.abs(parseFloat(String(result[0].nowUsd).replace(",", ".")) - (100 / 0.86)) < 0.01);
  });

  test("applyLatestBalanceUsdToMoneyRows converts USDT 1:1 without rate", () => {
    const moneyRows = [{ channel: "Бинанс spot", now: "500", nowUsd: "" }];
    const latest = { "Бинанс spot": { value: "500", currency: "USDT", rate: "", usdAmount: "" } };
    const result = ctxApply.applyLatestBalanceUsdToMoneyRows(moneyRows, latest);
    assert.equal(parseFloat(String(result[0].nowUsd).replace(",", ".")), 500);
  });

  test("applyLatestBalanceUsdToMoneyRows does not override already-set nowUsd", () => {
    const moneyRows = [{ channel: "Бинанс spot", now: "500", nowUsd: "499,0000" }];
    const latest = { "Бинанс spot": { value: "500", currency: "USDT", rate: "", usdAmount: "" } };
    const result = ctxApply.applyLatestBalanceUsdToMoneyRows(moneyRows, latest);
    assert.equal(result[0].nowUsd, "499,0000");
  });
}
