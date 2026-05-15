const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const guardJs = fs.readFileSync(path.join(root, "expense-analysis-transfer-guard.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("expense analysis transfer guard marks Перевод ФОП rows as transfer-like", () => {
  const context = {
    window: {},
    isTransferOrExchangeRow(row) {
      const operation = String(row?.operation || "").trim().toLowerCase();
      const category = String(row?.category || "").trim().toLowerCase();
      return operation.includes("exchange") || category === "partner";
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(guardJs, context);

  assert.equal(typeof context.isTransferOrExchangeRow, "function");
  assert.equal(context.isTransferOrExchangeRow.__expenseAnalysisTransferGuardWrapped, true);
  assert.equal(context.isTransferOrExchangeRow({
    operation: "business_expense",
    category: "transferFop",
    direction: "out",
    fromChannel: "трансервайз дол",
    toChannel: "приват-фоп",
    amountUsd: "-193.07",
  }), true);
  assert.equal(context.isTransferOrExchangeRow({
    operation: "expense",
    category: "business",
    direction: "out",
    fromChannel: "трансервайз дол",
    amountUsd: "-25",
  }), false);
});

test("expense analysis transfer guard loads after FOP category patch and before period analysis patches", () => {
  const fopIndex = indexHtml.indexOf("./fop-transfer-category.js");
  const guardIndex = indexHtml.indexOf("./expense-analysis-transfer-guard.js");
  const periodFixIndex = indexHtml.indexOf("./expense-analysis-period-fix.js");
  assert.ok(fopIndex !== -1, "fop transfer category script missing");
  assert.ok(guardIndex !== -1, "expense analysis transfer guard script missing");
  assert.ok(periodFixIndex !== -1, "period fix script missing");
  assert.ok(fopIndex < guardIndex, "guard should load after FOP category patch");
  assert.ok(guardIndex < periodFixIndex, "guard should load before analysis period wrappers");
});
