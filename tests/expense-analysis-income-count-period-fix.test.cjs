const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const periodFixJs = fs.readFileSync(path.join(root, "expense-analysis-period-fix.js"), "utf8");

function runPeriodFix(context) {
  vm.createContext(context);
  vm.runInContext(periodFixJs, context);
  return context;
}

function createContext(documentValues = {}) {
  const context = {
    window: {
      buildLedgerIncomeCountSummaryByChannel(rows) {
        const summary = {};
        (rows || []).forEach((row) => {
          const channel = String(row.toChannel || row.to_channel || row.channel || "").trim();
          if (!channel) return;
          if (!summary[channel]) summary[channel] = { autoIncomeCount: 0, manualIncomeCount: 0, screenshotIncomeCount: 0 };
          if (row.source === "manual") summary[channel].manualIncomeCount += 1;
          else if (row.source === "screenshot") summary[channel].screenshotIncomeCount += 1;
          else summary[channel].autoIncomeCount += 1;
        });
        return summary;
      },
      buildLedgerProviderExpenseByChannel(rows) {
        const summary = {};
        (rows || []).forEach((row) => {
          const channel = String(row.fromChannel || row.from_channel || row.channel || "").trim();
          if (!channel) return;
          summary[channel] = (summary[channel] || 0) + Number(row.amountUsd || row.amount_usd || 0);
        });
        return summary;
      },
    },
    document: {
      getElementById(id) {
        return { value: documentValues[id] || "" };
      },
    },
  };
  return runPeriodFix(context);
}

test("income counters use selected period options", () => {
  const context = createContext();
  const rows = [
    { date: "2026-05-01", source: "provider", toChannel: "yandex rub" },
    { date: "2026-05-02", source: "provider", toChannel: "yandex rub" },
    { date: "2026-04-15", source: "provider", toChannel: "yandex rub" },
    { date: "2026-05-03", source: "manual", toChannel: "yandex rub" },
  ];

  const summary = context.window.buildLedgerIncomeCountSummaryByChannel(rows, {
    startDate: "2026-05-01",
    endDate: "2026-05-03",
  });

  assert.deepEqual(summary, {
    "yandex rub": { autoIncomeCount: 2, manualIncomeCount: 1, screenshotIncomeCount: 0 },
  });
});

test("income counters use DOM selected week when options are absent", () => {
  const context = createContext({ startDate: "2026-05-01", endDate: "2026-05-07" });
  const rows = [
    { date: "2026-05-01", source: "provider", to_channel: "yandex rub" },
    { date: "2026-05-07", source: "provider", to_channel: "yandex rub" },
    { date: "2026-04-30", source: "provider", to_channel: "yandex rub" },
    { date: "2026-05-08", source: "provider", to_channel: "yandex rub" },
  ];

  const summary = context.window.buildLedgerIncomeCountSummaryByChannel(rows);

  assert.equal(summary["yandex rub"].autoIncomeCount, 2);
});

test("provider expense guard still filters out-of-range rows", () => {
  const context = createContext();
  const rows = [
    { date: "2026-05-01", fromChannel: "yandex rub", amountUsd: 10 },
    { date: "2026-05-03", fromChannel: "yandex rub", amountUsd: 5 },
    { date: "2026-04-30", fromChannel: "yandex rub", amountUsd: 100 },
  ];

  const summary = context.window.buildLedgerProviderExpenseByChannel(rows, {}, {
    startDate: "2026-05-01",
    endDate: "2026-05-03",
  });

  assert.deepEqual(summary, { "yandex rub": 15 });
});
