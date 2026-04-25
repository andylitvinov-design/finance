const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const match = indexHtml.match(/function buildLatestNowByChannel\(expenseRows, endDate\) \{[\s\S]*?\n      \}/);
if (!match) throw new Error("buildLatestNowByChannel was not found in index.html");

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

const context = {
  MANUAL_NOW_CATEGORY: "now",
  MANUAL_FINANCE_MONEY_CHANNELS: ["Яндекс руб", "пейпал дол"],
  parseLooseNumber,
};
vm.createContext(context);
vm.runInContext(`${match[0]}\nthis.buildLatestNowByChannel = buildLatestNowByChannel;`, context);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("buildLatestNowByChannel ignores zero placeholders and keeps previous values by channel", () => {
  const rows = [
    {
      date: "2026-04-24",
      category: "now",
      amounts: { "Яндекс руб": "1000", "пейпал дол": "50" },
    },
    {
      date: "2026-04-25",
      category: "now",
      amounts: { "Яндекс руб": "0", "пейпал дол": "0,0000" },
    },
  ];

  assert.deepEqual(plain(context.buildLatestNowByChannel(rows, "2026-04-25")), {
    "Яндекс руб": "1000",
    "пейпал дол": "50",
  });
});

test("buildLatestNowByChannel uses a newer non-zero value independently per channel", () => {
  const rows = [
    {
      date: "2026-04-24",
      category: "now",
      amounts: { "Яндекс руб": "1000", "пейпал дол": "50" },
    },
    {
      date: "2026-04-25",
      category: "now",
      amounts: { "Яндекс руб": "1200", "пейпал дол": "" },
    },
  ];

  assert.deepEqual(plain(context.buildLatestNowByChannel(rows, "2026-04-25")), {
    "Яндекс руб": "1200",
    "пейпал дол": "50",
  });
});
