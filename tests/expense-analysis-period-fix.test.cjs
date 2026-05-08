const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "expense-analysis-period-fix.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("expense analysis period guard is loaded after ui.js and before main.js", () => {
  assert.ok(indexHtml.indexOf("./ui.js") < indexHtml.indexOf("./expense-analysis-period-fix.js"));
  assert.ok(indexHtml.indexOf("./expense-analysis-period-fix.js") < indexHtml.indexOf("./main.js"));
});

test("expense analysis period guard filters out-of-range provider expense rows", () => {
  const seenRows = [];
  const context = {
    window: {
      buildLedgerProviderExpenseByChannel(rows) {
        seenRows.push(...rows);
        return Object.fromEntries(rows.map((row) => [row.id, row.amountUsd]));
      },
    },
    document: {
      getElementById(id) {
        return { value: id === "startDate" ? "2026-05-01" : "2026-05-05" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  const result = context.window.buildLedgerProviderExpenseByChannel([
    { id: "before", date: "2026-04-30", amountUsd: 2247.3385, source: "yoomoney", fromChannel: "Яндекс руб" },
    { id: "inside", date: "2026-05-03", amountUsd: 884.2807, source: "yoomoney", fromChannel: "Яндекс руб" },
    { id: "after", date: "2026-05-06", amountUsd: 25, source: "yoomoney", fromChannel: "Яндекс руб" },
  ], {}, {});

  assert.deepEqual(Object.keys(result), ["inside"]);
  assert.deepEqual(seenRows.map((row) => row.id), ["inside"]);
});

test("expense analysis period guard prefers explicit options over DOM dates", () => {
  const context = {
    window: {
      buildLedgerProviderExpenseByChannel(rows) {
        return rows.map((row) => row.id);
      },
    },
    document: {
      getElementById() {
        return { value: "2026-05-01" };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  const result = context.window.buildLedgerProviderExpenseByChannel([
    { id: "dom-period", date: "2026-05-01" },
    { id: "explicit-period", date: "2026-04-30" },
  ], {}, { startDate: "2026-04-29", endDate: "2026-04-30" });

  assert.deepEqual(result, ["explicit-period"]);
});
