const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const expandedEditorJs = fs.readFileSync(path.join(root, "manual-balance-expanded-editor.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function buildContext() {
  const context = {
    module: { exports: {} },
    state: {
      manualFinance: {
        data: { periodEnd: "2026-05-15", balanceRows: [] },
      },
    },
    elements: { endDate: { value: "2026-05-15" } },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    },
    normalizeManualFinancePersistedNumberInput(value) {
      return String(value ?? "").trim().replace(".", ",");
    },
    getManualFinanceChannels() {
      return ["пейпал дол", "пейпал евр", "трансервайз дол", "Налично -я-евр"];
    },
    canonicalManualFinanceChannel(value) {
      const raw = String(value || "").trim();
      if (raw === "paypal usd") return "пейпал дол";
      return raw;
    },
    inferManualFinanceChannelCurrency(channel) {
      const raw = String(channel || "").toLowerCase();
      if (/евр|eur/.test(raw)) return "EUR";
      if (/руб/.test(raw)) return "RUB";
      return "USD";
    },
  };
  vm.createContext(context);
  vm.runInContext(expandedEditorJs, context);
  return context;
}

test("expanded balance editor builds one visible row for every configured channel", () => {
  const context = buildContext();
  const rows = context.module.exports.buildExpandedManualFinanceBalanceEditorRows([], { defaultDate: "2026-05-15" });

  assert.deepEqual(rows.map((row) => row.channel), [
    "пейпал дол",
    "пейпал евр",
    "трансервайз дол",
    "Налично -я-евр",
  ]);
  assert.deepEqual(rows.map((row) => row.date), ["2026-05-15", "2026-05-15", "2026-05-15", "2026-05-15"]);
  assert.equal(rows.find((row) => row.channel === "пейпал евр").currency, "EUR");
});

test("expanded balance editor preserves existing amounts and canonicalizes aliases", () => {
  const context = buildContext();
  const rows = context.module.exports.buildExpandedManualFinanceBalanceEditorRows([
    { date: "2026-05-14", channel: "paypal usd", amount: "120.50", currency: "USD", usdAmount: "120.50", comment: "existing" },
  ], { defaultDate: "2026-05-15" });

  const paypalUsd = rows.find((row) => row.channel === "пейпал дол");
  assert.equal(paypalUsd.date, "2026-05-14");
  assert.equal(paypalUsd.amount, "120,50");
  assert.equal(paypalUsd.usdAmount, "120,50");
  assert.equal(paypalUsd.comment, "existing");
});

test("expanded balance editor keeps custom filled rows after configured rows", () => {
  const context = buildContext();
  const rows = context.module.exports.buildExpandedManualFinanceBalanceEditorRows([
    { date: "2026-05-15", channel: "custom wallet", amount: "9", currency: "USD", comment: "custom" },
  ], { defaultDate: "2026-05-15" });

  assert.equal(rows.length, 5);
  assert.equal(rows[4].channel, "custom wallet");
  assert.equal(rows[4].amount, "9");
  assert.equal(rows[4].comment, "custom");
});

test("expanded balance editor is loaded after ui.js so it can override the balance renderer", () => {
  const uiIndex = indexHtml.indexOf("./ui.js");
  const expandedIndex = indexHtml.indexOf("./manual-balance-expanded-editor.js");
  assert.ok(uiIndex > 0, "ui.js must be present");
  assert.ok(expandedIndex > uiIndex, "expanded balance editor must load after ui.js");
});
