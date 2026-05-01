const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const sheetsJs = fs.readFileSync(path.join(root, "google-sheets.js"), "utf8");

function extractFunction(source, name) {
  let start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`${name} was not found`);
  const parenStart = source.indexOf("(", start);
  let parenDepth = 0;
  let braceStart = -1;
  for (let index = parenStart; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      braceStart = source.indexOf("{", index);
      break;
    }
  }
  if (braceStart === -1) throw new Error(`${name} body was not found`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body was not closed`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("buildLedgerRowsFromAccountingEntries maps Monobank exchange outflow into ledger exchange_out row", () => {
  const context = {
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : ["2026-05-01T10:00:00.000Z"]));
      }
      static now() {
        return new Date("2026-05-01T10:00:00.000Z").getTime();
      }
    },
    canonicalManualFinanceChannel(value) {
      return String(value || "").trim();
    },
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    normalizeManualLedgerCategoryForStorage(value, fallback = "extra") {
      if (value === "exchange") return "exchange";
      if (value === "serviceIncome") return "servicein";
      return fallback;
    },
    inferManualFinanceChannelCurrency(channel) {
      return /монобанк/i.test(String(channel || "")) ? "UAH" : "USD";
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    formatSheetNumber(value, digits = 4) {
      return Number(value || 0).toFixed(digits).replace(".", ",");
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(sheetsJs, "buildLedgerRowsFromAccountingEntries")}\nthis.buildLedgerRowsFromAccountingEntries = buildLedgerRowsFromAccountingEntries;`,
    context
  );

  const rows = plain(context.buildLedgerRowsFromAccountingEntries([
    {
      date: "2026-04-20",
      channel: "монобанк грн",
      direction: "exchange",
      localAmount: 4517.6,
      currency: "UAH",
      usdAmount: "",
      category: "exchange",
      description: "P2P Binance top up",
      sourceTransactionId: "MONO-EX-1"
    }
  ]));

  assert.deepEqual(rows, [
    {
      date: "2026-04-20",
      operation: "exchange_out",
      fromChannel: "монобанк грн",
      toChannel: "",
      amount: "4517,6000",
      currency: "UAH",
      amountUsd: "",
      category: "exchange",
      direction: "out",
      comment: "P2P Binance top up",
      source: "mcp",
      rawSourceId: "MONO-EX-1",
      transferGroupId: "MONO-EX-1",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:00:00.000Z"
    }
  ]);
});
