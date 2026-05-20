const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`Function not found: ${name}`);
  let depth = 0;
  let inBody = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      inBody = true;
    } else if (char === "}") {
      depth -= 1;
      if (inBody && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Function body not found: ${name}`);
}

test("operations account/channel filter matches from_channel and to_channel", () => {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").slice(0, 10);
    },
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction(uiJs, "filterExpenseOperationsRows")}\nthis.filterExpenseOperationsRows = filterExpenseOperationsRows;`, context);

  const rows = [
    { date: "2026-05-01", operation: "transfer", displaySource: "binance", fromChannel: "Бинанс spot", toChannel: "binance save" },
    { date: "2026-05-08", operation: "income", displaySource: "binance_pay", fromChannel: "", toChannel: "Binance funding" },
    { date: "2026-05-09", operation: "expense", displaySource: "paypal", fromChannel: "пейпал дол", toChannel: "" },
  ];

  assert.deepEqual(
    context.filterExpenseOperationsRows(rows, { accountChannel: "Binance funding" }).map((row) => row.date),
    ["2026-05-08"]
  );
  assert.deepEqual(
    context.filterExpenseOperationsRows(rows, { accountChannel: "binance save" }).map((row) => row.date),
    ["2026-05-01"]
  );
});
