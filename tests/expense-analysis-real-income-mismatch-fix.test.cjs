const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const fixJs = fs.readFileSync(path.join(root, "expense-analysis-real-income-mismatch-fix.js"), "utf8");

test("real income mismatch fix loads after ui.js", () => {
  assert.match(indexHtml, /<script src="\.\/expense-analysis-real-income-mismatch-fix\.js"><\/script>/);
  assert.ok(
    indexHtml.indexOf('<script src="./ui.js"></script>') <
      indexHtml.indexOf('<script src="./expense-analysis-real-income-mismatch-fix.js"></script>'),
    "patch must wrap UI globals after ui.js defines them"
  );
});

test("CAD rate-derived Ledger fallback mismatch does not emit warning but keeps API value", () => {
  const warnings = [];
  const context = {
    console: { warn: (...args) => warnings.push(args) },
    window: null,
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").slice(0, 10);
    },
    roundProviderSummaryAmount(value) {
      return Math.round((Number(value) || 0) * 10000) / 10000;
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(numeric) ? numeric : 0;
    },
    isLedgerProviderIncomeSource(row) {
      return ["td_bank", "tdbank"].includes(String(row?.source || "").trim().toLowerCase());
    },
    isLedgerProviderNonIncomeRow() {
      return false;
    },
    getNormalizedLedgerFactOperation(row) {
      return String(row?.operation || "").trim().toLowerCase();
    },
    getLedgerIncomeChannel(row) {
      return String(row?.toChannel || row?.to_channel || "").trim();
    },
    buildLedgerRealIncomeSummaryByChannel(rows) {
      return {
        "БАНК КАНАДА cad": {
          channel: "БАНК КАНАДА cad",
          currency: "CAD",
          realNetUsd: rows.reduce((sum, row) => sum + Math.abs(Number(row.amountNet || 0)) * 0.74, 0),
        },
      };
    },
    mergeExpenseAnalysisRealIncomeSummaryByChannel(apiSummaryByChannel = {}, ledgerSummaryByChannel = {}) {
      const merged = { ...apiSummaryByChannel };
      Object.entries(ledgerSummaryByChannel).forEach(([channel, ledgerSummary]) => {
        const apiSummary = merged[channel];
        if (!apiSummary?.realNetUsd) {
          merged[channel] = ledgerSummary;
          return;
        }
        if (apiSummary.realNetUsd !== ledgerSummary.realNetUsd) {
          context.console.warn("[expense-analysis] API real income summary differs from Ledger fallback", {
            channel,
            apiRealNetUsd: apiSummary.realNetUsd,
            ledgerRealNetUsd: ledgerSummary.realNetUsd,
          });
        }
      });
      return merged;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fixJs, context);

  const ledgerSummary = context.buildLedgerRealIncomeSummaryByChannel([
    {
      date: "2026-05-02",
      operation: "income",
      source: "td_bank",
      toChannel: "БАНК КАНАДА cad",
      amountNet: "150",
      currency: "CAD",
      amountUsd: "0",
    },
  ], {}, { startDate: "2026-05-01", endDate: "2026-05-31" });
  const merged = context.mergeExpenseAnalysisRealIncomeSummaryByChannel({
    "БАНК КАНАДА cad": { channel: "БАНК КАНАДА cad", currency: "CAD", realNetUsd: 112.5 },
  }, ledgerSummary, { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(ledgerSummary["БАНК КАНАДА cad"].rateDerivedRows, 1);
  assert.equal(ledgerSummary["БАНК КАНАДА cad"].explicitUsdRows, 0);
  assert.equal(merged["БАНК КАНАДА cad"].realNetUsd, 112.5);
  assert.equal(warnings.length, 0);
});

test("USD explicit Ledger fallback mismatch still emits warning", () => {
  const warnings = [];
  const context = {
    console: { warn: (...args) => warnings.push(args) },
    window: null,
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").slice(0, 10);
    },
    roundProviderSummaryAmount(value) {
      return Math.round((Number(value) || 0) * 10000) / 10000;
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(numeric) ? numeric : 0;
    },
    isLedgerProviderIncomeSource(row) {
      return String(row?.source || "").trim().toLowerCase() === "paypal";
    },
    isLedgerProviderNonIncomeRow() {
      return false;
    },
    getNormalizedLedgerFactOperation(row) {
      return String(row?.operation || "").trim().toLowerCase();
    },
    getLedgerIncomeChannel(row) {
      return String(row?.toChannel || row?.to_channel || "").trim();
    },
    buildLedgerRealIncomeSummaryByChannel() {
      return {
        "пейпал дол": { channel: "пейпал дол", currency: "USD", realNetUsd: 90 },
      };
    },
    mergeExpenseAnalysisRealIncomeSummaryByChannel(apiSummaryByChannel = {}, ledgerSummaryByChannel = {}) {
      const merged = { ...apiSummaryByChannel };
      Object.entries(ledgerSummaryByChannel).forEach(([channel, ledgerSummary]) => {
        const apiSummary = merged[channel];
        if (!apiSummary?.realNetUsd) {
          merged[channel] = ledgerSummary;
          return;
        }
        if (apiSummary.realNetUsd !== ledgerSummary.realNetUsd) {
          context.console.warn("[expense-analysis] API real income summary differs from Ledger fallback", {
            channel,
            apiRealNetUsd: apiSummary.realNetUsd,
            ledgerRealNetUsd: ledgerSummary.realNetUsd,
          });
        }
      });
      return merged;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fixJs, context);

  const ledgerSummary = context.buildLedgerRealIncomeSummaryByChannel([
    {
      date: "2026-05-02",
      operation: "income",
      source: "paypal",
      toChannel: "пейпал дол",
      amountNet: "90",
      currency: "USD",
      amountUsd: "90",
    },
  ], {}, { startDate: "2026-05-01", endDate: "2026-05-31" });
  const merged = context.mergeExpenseAnalysisRealIncomeSummaryByChannel({
    "пейпал дол": { channel: "пейпал дол", currency: "USD", realNetUsd: 100 },
  }, ledgerSummary, { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(ledgerSummary["пейпал дол"].explicitUsdRows, 1);
  assert.equal(ledgerSummary["пейпал дол"].rateDerivedRows, 0);
  assert.equal(merged["пейпал дол"].realNetUsd, 100);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].channel, "пейпал дол");
});
