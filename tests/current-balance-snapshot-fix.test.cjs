const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fixJs = fs.readFileSync(path.join(__dirname, "..", "current-balance-snapshot-fix.js"), "utf8");

function buildContext() {
  const context = {
    parseLooseNumber(value) {
      const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    getCanonicalManualChannelKey(value) {
      const raw = String(value || "").trim();
      const normalized = raw.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
      if (["binance savings", "бинанс сейв"].includes(normalized)) return "binance save";
      if (["binance spot", "бинанс spot"].includes(normalized)) return "Бинанс spot";
      return raw;
    },
    inferManualFinanceChannelCurrency(channel) {
      if (/руб/i.test(String(channel || ""))) return "RUB";
      if (/грн/i.test(String(channel || ""))) return "UAH";
      if (/cad|канада/i.test(String(channel || ""))) return "CAD";
      return "USD";
    }
  };
  vm.createContext(context);
  vm.runInContext(fixJs, context);
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("excludes stale May 28 current balance rows and applies owner-confirmed snapshot", () => {
  const context = buildContext();
  const result = context.buildLatestBalanceEntriesByChannel([
    { date: "2026-05-28", channel: "binance save", amount: "7425", currency: "USD", source: "manual-google-sheets" },
    { date: "2026-05-28", channel: "Бинанс spot", amount: "1689", currency: "USD", source: "manual-google-sheets" },
    { date: "2026-05-28", channel: "legacy_combined_binance_spot_funding", amount: "345", currency: "USDT", source: "manual-google-sheets" },
    { date: "2026-05-28", channel: "Payoneer - eur", amount: "1173", currency: "EUR", source: "manual-google-sheets" },
    { date: "2026-05-27", channel: "Яндекс руб", amount: "100000", currency: "RUB", usdAmount: "1200" }
  ], "2026-05-28");

  assert.equal(result["binance save"].value, "7432");
  assert.equal(result["binance save"].usdAmount, "7432");
  assert.equal(result["Бинанс spot"].value, "1162");
  assert.equal(result["БАНК КАНАДА cad"].value, "10538");
  assert.equal(result["БАНК КАНАДА cad"].usdAmount, "7798");
  assert.equal(result["монобанк грн"].value, "1333");
  assert.equal(result["монобанк грн"].usdAmount, "31.36");
  assert.equal(result["Яндекс руб"].value, "100000");
  assert.equal(result["Яндекс руб"].usdAmount, "1376");
  assert.equal(context.__currentBalanceSnapshotFixDiagnostics.excludedStaleRows.length, 4);
  assert.equal(context.__currentBalanceSnapshotFixDiagnostics.appliedOwnerCorrections.length, 5);
});

test("does not apply May 28 snapshot correction outside May 28", () => {
  const context = buildContext();
  const result = context.buildLatestBalanceEntriesByChannel([
    { date: "2026-05-28", channel: "binance save", amount: "7425", currency: "USD" },
    { date: "2026-05-28", channel: "Бинанс spot", amount: "1689", currency: "USD" }
  ], "2026-05-29");

  assert.deepEqual(plain(result), {
    "binance save": { value: "7425", date: "2026-05-28", currency: "USD", rate: "", usdAmount: "" },
    "Бинанс spot": { value: "1689", date: "2026-05-28", currency: "USD", rate: "", usdAmount: "" }
  });
  assert.equal(context.__currentBalanceSnapshotFixDiagnostics.excludedStaleRows.length, 0);
  assert.equal(context.__currentBalanceSnapshotFixDiagnostics.appliedOwnerCorrections.length, 0);
});

test("snapshot fix loader runs before main app bootstrap", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const carrierIndex = indexHtml.indexOf("./channel-display-order.js");
  const mainIndex = indexHtml.indexOf("./main.js");
  assert.ok(carrierIndex !== -1, "channel-display-order.js must be loaded");
  assert.ok(mainIndex !== -1, "main.js must be loaded");
  assert.ok(carrierIndex < mainIndex, "loader carrier must run before main.js");

  const carrierJs = fs.readFileSync(path.join(__dirname, "..", "channel-display-order.js"), "utf8");
  assert.match(carrierJs, /current-balance-snapshot-fix\.js/);
});
