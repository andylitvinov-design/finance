const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const googleSheetsJs = fs.readFileSync(path.join(root, "google-sheets.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
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
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body was not closed`);
}

function buildContext() {
  const context = {
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim().slice(0, 10);
    },
    normalizeManualFinancePersistedNumberInput(value) {
      const raw = String(value ?? "").trim();
      return raw ? raw.replace(".", ",") : "";
    },
    normalizeLookupText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^0-9a-zа-я]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    },
    canonicalManualFinanceChannel(value) {
      const raw = String(value || "").trim();
      const normalized = context.normalizeLookupText(raw);
      if (/^(transferwise|wise|трансервайз)( дол| usd| dollar| dollars)?$/.test(normalized)) return "трансервайз дол";
      if (/^(transferwise|wise|трансервайз)( евр| евро| eur| euro| euros)$/.test(normalized)) return "трансервайз евро";
      if (/^(monobank|mono|монобанк)( грн| uah)?$/.test(normalized)) return "монобанк грн";
      return raw;
    },
    inferManualFinanceChannelCurrency(channel) {
      const raw = String(channel || "").toLowerCase();
      if (/грн|uah/.test(raw)) return "UAH";
      if (/руб|rub/.test(raw)) return "RUB";
      if (/евр|eur/.test(raw)) return "EUR";
      return "USD";
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(googleSheetsJs, "appendManualBalanceSourceMarker")}\n` +
      `${extractFunction(googleSheetsJs, "normalizeManualBalanceCurrencyForSave")}\n` +
      `${extractFunction(googleSheetsJs, "normalizeManualBalanceChannelForSave")}\n` +
      `${extractFunction(googleSheetsJs, "normalizeManualBalanceRowForSave")}\n` +
      `${extractFunction(googleSheetsJs, "normalizeManualBalanceRowsForSave")}\n` +
      `${extractFunction(googleSheetsJs, "makeManualBalanceRowKey")}\n` +
      `${extractFunction(googleSheetsJs, "mergeManualBalanceRowsWithStats")}\n` +
      "this.normalizeManualBalanceRowsForSave = normalizeManualBalanceRowsForSave;\n" +
      "this.mergeManualBalanceRowsWithStats = mergeManualBalanceRowsWithStats;",
    context
  );
  return context;
}

test("fact balance rows normalize to canonical Остатки rows", () => {
  const context = buildContext();
  const result = context.normalizeManualBalanceRowsForSave([
    { date: "2026-05-17", channel: "TransferWise", currency: "USD", amount: "1070.48" },
    { date: "2026-05-17", channel: "wise eur", currency: "EUR", amount: "12.5" },
    { date: "2026-05-17", channel: "mono", currency: "грн", amount: "14033" },
  ], { sourceMarker: "from_fact_balance_input" });

  assert.equal(result.skipped, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows.map((row) => [row.channel, row.currency, row.amount, row.comment]))), [
    ["трансервайз дол", "USD", "1070,48", "from_fact_balance_input"],
    ["трансервайз евро", "EUR", "12,5", "from_fact_balance_input"],
    ["монобанк грн", "UAH", "14033", "from_fact_balance_input"],
  ]);
});

test("fact balance save updates same date channel currency instead of duplicating", () => {
  const context = buildContext();
  const incoming = context.normalizeManualBalanceRowsForSave([
    { date: "2026-05-17", channel: "TransferWise", currency: "USD", amount: "1070.48" },
  ], { sourceMarker: "from_fact_balance_input" });

  const merge = context.mergeManualBalanceRowsWithStats(
    [{ date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "1000", comment: "old" }],
    incoming.rows
  );

  assert.equal(merge.inserted, 0);
  assert.equal(merge.updated, 1);
  assert.equal(merge.rows.length, 1);
  assert.equal(merge.rows[0].amount, "1070,48");
});

test("non-balance fact rows are skipped before Остатки persistence", () => {
  const context = buildContext();
  const result = context.normalizeManualBalanceRowsForSave([
    { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: "" },
    { date: "2026-05-17", channel: "", currency: "USD", amount: "22" },
  ]);

  assert.equal(result.rows.length, 0);
  assert.equal(result.skipped, 2);
});
