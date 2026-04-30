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
  assert.deepEqual(summary.duplicateRawSourceIds, []);
  assert.deepEqual(summary.duplicateTransferGroupIds, ["migration:exchange:2026-04-24:1"]);
  assert.equal(summary.sample[0].operation, "exchange_out");
  assert.equal(summary.sample[1].operation, "exchange_in");
  assert.equal(summary.sample[2].category, "house");
});
