const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.join(__dirname, "..");
const bridgeJs = fs.readFileSync(path.join(repoRoot, "fop-transfer-category.js"), "utf8");
const configJs = fs.readFileSync(path.join(repoRoot, "config.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

function createBridgeContext() {
  const calls = [];
  const options = [];
  const context = {
    window: null,
    globalThis: null,
    document: {
      getElementById(id) {
        if (id === "startDate") return { value: "2026-05-01" };
        if (id === "endDate") return { value: "2026-05-08" };
        return null;
      },
      createElement(tag) {
        return {
          tagName: String(tag || "").toUpperCase(),
          value: "",
          textContent: "",
        };
      },
      querySelectorAll() {
        return [];
      },
    },
    normalizeManualExpenseCategory(value) {
      return String(value || "").trim();
    },
    renderExpenseAccountingRow(entry) {
      return {
        querySelector(selector) {
          if (selector !== "select.expense-select") return null;
          return {
            options,
            value: "",
            appendChild(option) {
              options.push(option);
            },
          };
        },
      };
    },
    renderTabs() {
      calls.push({ type: "renderTabs" });
      return "rendered";
    },
    parseLooseNumber(value) {
      const normalized = String(value ?? "").replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    formatSheetNumber(value) {
      return Number(value || 0).toFixed(4).replace(".", ",");
    },
    normalizeManualFinancePersistedNumberInput(value) {
      return Number(value || 0).toFixed(4).replace(".", ",");
    },
    normalizeIncomingSheetDateValue(value) {
      const raw = String(value || "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
    },
    inferManualFinanceChannelCurrency(channel) {
      return /руб/i.test(String(channel || "")) ? "RUB" : "USD";
    },
    async getManualTransfersSheetDirect() {
      return { transferRows: [{ transferDate: "2026-05-02", amount: "10", currency: "USD", channel: "пейпал дол" }], commissionRows: [] };
    },
    async saveManualTransfersSheetDirect(startDate, endDate, transferRows, commissionRows) {
      calls.push({ type: "saveTransfers", startDate, endDate, transferRows, commissionRows });
      return { rowCount: transferRows.length, savedAt: "now" };
    },
    async saveExpenseAccountingEntriesDirect(entries) {
      calls.push({ type: "saveExpenses", entries });
      return { rowCount: entries.length };
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bridgeJs, context);
  return { context, calls, options };
}

test("FOP bridge is loaded after ui.js and before expense pie analytics", () => {
  const uiIndex = indexHtml.indexOf('./ui.js');
  const fopIndex = indexHtml.indexOf('./fop-transfer-category.js');
  const pieIndex = indexHtml.indexOf('./expense-pie-analytics.js');
  assert.ok(uiIndex !== -1, "ui.js must be loaded");
  assert.ok(fopIndex !== -1, "fop-transfer-category.js must be loaded");
  assert.ok(pieIndex !== -1, "expense-pie-analytics.js must be loaded");
  assert.ok(uiIndex < fopIndex, "FOP bridge must wrap UI functions after ui.js");
  assert.ok(fopIndex < pieIndex, "FOP bridge should install before later analytics wrappers");
});

test("FOP transfer category is not part of personal expense categories", () => {
  assert.match(configJs, /MANUAL_EXPENSE_ACCOUNTING_CATEGORIES\s*=\s*\[[^\]]+\]/);
  assert.doesNotMatch(configJs, /MANUAL_EXPENSE_ACCOUNTING_CATEGORIES[^;]*(Перевод ФОП|transferFop)/s);
});

test("FOP category aliases normalize to transferFop", () => {
  const { context } = createBridgeContext();
  assert.equal(context.normalizeManualExpenseCategory("Перевод ФОП"), "transferFop");
  assert.equal(context.normalizeManualExpenseCategory("перевод фоп"), "transferFop");
  assert.equal(context.normalizeManualExpenseCategory("fop transfer"), "transferFop");
  assert.equal(context.normalizeManualExpenseCategory("business"), "business");
});

test("FOP transfer entries are converted to transfer rows, not regular expense saves", async () => {
  const { context, calls } = createBridgeContext();
  const result = await context.saveExpenseAccountingEntriesDirect([
    {
      date: "2026-05-08",
      category: "Перевод ФОП",
      localAmount: "8400",
      usdAmount: "100",
      currency: "RUB",
      channel: "Яндекс руб",
      organization: "ФОП Андрій",
    },
  ]);

  assert.equal(result.fopTransferRows, 1);
  assert.equal(calls.some((call) => call.type === "saveExpenses"), false);
  const transferCall = calls.find((call) => call.type === "saveTransfers");
  assert.ok(transferCall, "FOP rows must be saved through saveManualTransfersSheetDirect");
  assert.equal(transferCall.startDate, "2026-05-01");
  assert.equal(transferCall.endDate, "2026-05-08");
  assert.deepEqual(JSON.parse(JSON.stringify(transferCall.transferRows.at(-1))), {
    transferDate: "2026-05-08",
    who: "ФОП Андрій",
    amount: "8400,0000",
    currency: "RUB",
    channel: "Яндекс руб",
    rate: "84,0000",
    usdAmount: "100,0000",
  });
});

test("mixed save keeps regular expenses on the original path and FOP on transfers", async () => {
  const { context, calls } = createBridgeContext();
  await context.saveExpenseAccountingEntriesDirect([
    { date: "2026-05-08", category: "business", localAmount: "12", currency: "USD", channel: "пейпал дол" },
    { date: "2026-05-08", category: "transferFop", localAmount: "100", currency: "USD", channel: "пейпал дол" },
  ]);

  const expenseCall = calls.find((call) => call.type === "saveExpenses");
  const transferCall = calls.find((call) => call.type === "saveTransfers");
  assert.equal(expenseCall.entries.length, 1);
  assert.equal(expenseCall.entries[0].category, "business");
  assert.ok(transferCall.transferRows.some((row) => row.who === "Перевод ФОП" && row.amount === "100,0000"));
});
