const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const contract = require("../manual-ledger-contract.js");

test("manual ledger category aliases normalize to canonical categories", () => {
  assert.equal(contract.normalizeManualLedgerCategory("serviceIncome"), "servicein");
  assert.equal(contract.normalizeManualLedgerCategory("services"), "servicein");
  assert.equal(contract.normalizeManualLedgerCategory("ezohata"), "ezoin");
  assert.equal(contract.normalizeManualLedgerCategory("exchangeUsd"), "exchange");
  assert.equal(contract.normalizeManualLedgerCategory("flat"), "house");
  assert.equal(contract.normalizeManualLedgerCategory("rent"), "house");
  assert.equal(contract.normalizeManualLedgerCategory("beauty"), "fun");
  assert.equal(contract.normalizeManualLedgerCategory("events"), "fun");
  assert.equal(contract.normalizeManualLedgerCategory("travel/study"), "travel");
  assert.equal(contract.normalizeManualLedgerCategory("study"), "travel");
  assert.equal(contract.normalizeManualLedgerCategory("unclear"), "extra");
  assert.equal(contract.normalizeManualLedgerCategory("other"), "extra");
});

test("manual ledger channel aliases normalize to configured channel names", () => {
  const channels = [
    "Яндекс руб",
    "пейпал дол",
    "пейпал евр",
    "пейпал сad",
    "приват 24-дол",
    "приват 24-евро",
    "приват 24-грн",
    "монобанк грн",
    "трансервайз дол",
    "трансервайз евро",
    "REVOLUT дол",
    "Payoneer - eur",
    "Payoneer - dol",
    "Бинанс spot",
    "binance save",
    "Налично -я-евр",
    "местная валюты",
    "БАНК КАНАДА cad",
    "нал-мам-евро",
    "нал-мам-дол"
  ];

  assert.equal(contract.normalizeManualLedgerChannel("yandex rub", channels), "Яндекс руб");
  assert.equal(contract.normalizeManualLedgerChannel("paypal usd", channels), "пейпал дол");
  assert.equal(contract.normalizeManualLedgerChannel("paypal cad", channels), "пейпал сad");
  assert.equal(contract.normalizeManualLedgerChannel("privat 24 uah", channels), "приват 24-грн");
  assert.equal(contract.normalizeManualLedgerChannel("mono uah", channels), "монобанк грн");
  assert.equal(contract.normalizeManualLedgerChannel("wise eur", channels), "трансервайз евро");
  assert.equal(contract.normalizeManualLedgerChannel("binance spot", channels), "Бинанс spot");
});

test("manual ledger operation and direction normalize exchange rows", () => {
  assert.equal(contract.normalizeManualLedgerOperation("exchange_in", "exchange"), "exchange_in");
  assert.equal(contract.normalizeManualLedgerDirection("", "exchange_in"), "in");
  assert.equal(contract.normalizeManualLedgerOperation("exchange_out", "exchange"), "exchange_out");
  assert.equal(contract.normalizeManualLedgerDirection("", "exchange_out"), "out");
});

test("ledger v2 normalizes income gross fee net and balance prefers net", () => {
  const row = contract.normalizeLedgerRow({
    date: "2026-05-01",
    operation: "income",
    from_channel: "Client A",
    to_channel: "пейпал дол",
    amount: "324",
    currency: "USD",
    amount_gross: "324",
    amount_fee: "12.94",
    amount_net: "311.06",
    category: "serviceIncome",
    source: "paypal",
    raw_source_id: "TXN-1",
    comment: "PayPal income"
  });

  assert.equal(row.category, "service");
  assert.equal(row.source, "paypal");
  assert.equal(row.external_id, "TXN-1");
  assert.equal(row.amount_gross, "324");
  assert.equal(row.amount_fee, "12.94");
  assert.equal(row.amount_net, "311.06");
  assert.equal(row.amount_usd, "311.06");
  assert.equal(contract.getBalanceAmount(row), 311.06);
  assert.equal(contract.validateLedgerRow(row).ok, true);
});

test("ledger v2 refuses balance fallback when net is missing", () => {
  const warnings = [];
  const row = contract.normalizeLedgerRow({
    date: "2026-05-01",
    operation: "income",
    to_channel: "пейпал дол",
    amount: "100",
    currency: "USD",
    category: "service",
    external_id: "missing-net"
  });
  const balance = contract.getBalanceAmount(row, { warnings });

  assert.equal(row.amount_net, "");
  assert.equal(balance, null);
  assert.match(warnings[0], /amount_net missing.*missing-net/);
  assert.deepEqual(contract.validateLedgerRow(row).errors, ["amount_net is required"]);
});

test("ledger v2 source normalization maps provider aliases to contract vocabulary", () => {
  assert.equal(contract.normalizeLedgerRow({ source: "privat24" }).source, "privatbank");
  assert.equal(contract.normalizeLedgerRow({ source: "paypal mcp" }).source, "paypal");
  assert.equal(contract.normalizeLedgerRow({ source: "tdbank" }).source, "td_bank");
  assert.equal(contract.normalizeLedgerRow({ source: "photo" }).source, "photo");
  assert.equal(contract.normalizeLedgerRow({ source: "file_import" }).source, "file_import");
  assert.equal(contract.normalizeLedgerRow({ source: "csv_import" }).source, "csv_import");
  assert.equal(contract.normalizeLedgerRow({ source: "xlsx_import" }).source, "xlsx_import");
  assert.equal(contract.normalizeLedgerRow({ source: "pdf_import" }).source, "pdf_import");
  assert.equal(contract.normalizeLedgerRow({ source: "mcp" }).source, "other");
});

test("ledger v2 normalizes exchange amount_usd signs and two-row aggregation", () => {
  const out = contract.normalizeLedgerRow({
    date: "2026-05-01",
    operation: "exchange_out",
    from_channel: "Яндекс руб",
    to_channel: "Бинанс spot",
    amount: "74669",
    currency: "RUB",
    amount_usd: "883.0684",
    amount_net: "74669",
    category: "exchange",
    raw_source_id: "ex-1"
  });
  const input = contract.normalizeLedgerRow({
    date: "2026-05-01",
    operation: "exchange_in",
    from_channel: "Яндекс руб",
    to_channel: "Бинанс spot",
    amount: "874",
    currency: "USD",
    amount_net: "874",
    category: "exchange",
    raw_source_id: "ex-1:in"
  });

  assert.equal(out.operation, "exchange");
  assert.equal(out.legacy_operation, "exchange_out");
  assert.equal(out.amount_usd, "-883.0684");
  assert.equal(input.amount_usd, "874");
  assert.equal(out.external_id, "ex-1");
  assert.equal(input.external_id, "ex-1:in");
  assert.equal([out, input].reduce((sum, row) => sum + Number(row.amount_usd || 0), 0).toFixed(4), "-9.0684");
});

test("ledger v2 recognizes physical v2 rows", () => {
  assert.equal(contract.isLedgerV2Row({ amount_net: "10", external_id: "id" }), true);
  assert.equal(contract.isLedgerV2Row({ amount: "10", raw_source_id: "id" }), false);
});

test("legacy wide migration helper is dry-run and emits ledger preview", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-ledger-"));
  const csvPath = path.join(dir, "legacy.csv");
  fs.writeFileSync(csvPath, [
    "date,category,Яндекс руб,Бинанс spot,монобанк грн",
    "2026-04-24,exchange,-74669,874,",
    "2026-04-25,flat,,,100"
  ].join("\n"));

  const output = execFileSync("node", ["scripts/migrate-manual-ledger.mjs", "--expenses", csvPath], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });
  const summary = JSON.parse(output);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.createdRows, 3);
  assert.deepEqual(summary.unknownCategories, []);
  assert.equal(summary.sample[0].operation, "exchange_out");
  assert.equal(summary.sample[1].operation, "exchange_in");
  assert.equal(summary.sample[2].category, "house");
});
