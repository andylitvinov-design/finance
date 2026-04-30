#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contract = require("../manual-ledger-contract.js");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const config = JSON.parse(readFileSync(path.join(root, "sheet-config.json"), "utf8"));
const channels = config.manualFinance?.channels || [];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith("--")) {
    const [key, inlineValue] = arg.slice(2).split("=");
    args.set(key, inlineValue ?? process.argv[index + 1] ?? "");
    if (inlineValue === undefined) index += 1;
  }
}

if (args.has("write")) {
  console.error("Refusing to run destructive migration: --write is not implemented. This helper is dry-run only.");
  process.exit(2);
}

const inputPath = args.get("expenses") || args.get("input");
if (!inputPath) {
  console.error("Usage: node scripts/migrate-manual-ledger.mjs --expenses legacy-expenses.csv");
  process.exit(2);
}

const text = readFileSync(path.resolve(inputPath), "utf8");
const rows = inputPath.endsWith(".json") ? JSON.parse(text) : parseCsv(text);
const header = rows[0] || [];
const dateIndex = findHeaderIndex(header, ["date", "дата"]);
const categoryIndex = findHeaderIndex(header, ["category", "категория"]);
if (dateIndex === -1 || categoryIndex === -1) {
  console.error("Input must include date/category columns.");
  process.exit(2);
}

const unknownCategories = new Set();
const unknownChannels = new Set();
const skipped = [];
const ledgerRows = [];

for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
  const row = rows[rowIndex] || [];
  const date = String(row[dateIndex] || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    skipped.push({ row: rowIndex + 1, reason: "empty_or_invalid_date" });
    continue;
  }
  const rawCategory = String(row[categoryIndex] || "").trim();
  const category = contract.normalizeManualLedgerCategory(rawCategory, "extra");
  if (category === "extra" && contract.normalizeToken(rawCategory) !== "extra") unknownCategories.add(rawCategory || "(blank)");
  header.forEach((cell, cellIndex) => {
    if (cellIndex === dateIndex || cellIndex === categoryIndex) return;
    const amount = parseNumber(row[cellIndex]);
    if (!amount) return;
    const rawChannel = String(cell || "").trim();
    const channel = contract.normalizeManualLedgerChannel(rawChannel, channels);
    if (!channels.includes(channel)) unknownChannels.add(rawChannel);
    const legacyGroup = `migration:${date}:${rowIndex}:${cellIndex}`;
    if (category === "exchange") {
      ledgerRows.push({
        date,
        operation: amount > 0 ? "exchange_in" : "exchange_out",
        from_channel: amount > 0 ? "" : channel,
        to_channel: amount > 0 ? channel : "",
        amount: Math.abs(amount),
        currency: inferCurrency(channel),
        amount_usd: null,
        category,
        direction: amount > 0 ? "in" : "out",
        raw_source_id: legacyGroup,
        transfer_group_id: `migration:exchange:${date}:${rowIndex}`
      });
      return;
    }
    const isIncome = category === "servicein" || category === "ezoin";
    ledgerRows.push({
      date,
      operation: isIncome ? "income" : (category === "business" ? "business_expense" : "personal_expense"),
      from_channel: isIncome ? "" : channel,
      to_channel: isIncome ? channel : "",
      amount: Math.abs(amount),
      currency: inferCurrency(channel),
      amount_usd: null,
      category,
      direction: isIncome ? "in" : "out",
      raw_source_id: legacyGroup,
      transfer_group_id: ""
    });
  });
}

console.log(JSON.stringify({
  dryRun: true,
  input: path.resolve(inputPath),
  createdRows: ledgerRows.length,
  skippedRows: skipped.length,
  unknownCategories: [...unknownCategories],
  unknownChannels: [...unknownChannels],
  sample: ledgerRows.slice(0, 10)
}, null, 2));

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map(contract.normalizeToken));
  return (header || []).findIndex((cell) => normalizedAliases.has(contract.normalizeToken(cell)));
}

function parseNumber(value) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function inferCurrency(channel) {
  const value = String(channel || "").toLowerCase();
  if (/eur|евр|евро/.test(value)) return "EUR";
  if (/cad|канада/.test(value)) return "CAD";
  if (/грн|uah/.test(value)) return "UAH";
  if (/руб|rub|yandex|яндекс/.test(value)) return "RUB";
  if (/местная|local/.test(value)) return "LOCAL";
  return "USD";
}
