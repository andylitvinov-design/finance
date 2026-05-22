#!/usr/bin/env node
import { inspect } from "node:util";

import { loadAutoBalanceRowsFromGoogleSheets } from "../server/auto-balance-repository.js";
import { mergeManualAndAutoBalances } from "../server/balance-snapshot-merge.js";
import {
  buildDailyCalculatedBalances,
  materializeDailyCalculatedBalances,
} from "../server/daily-calculated-balances.js";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";

if (isCliEntrypoint()) {
  await main();
}

export function parseArgs(argv = []) {
  const options = {
    apply: false,
    json: false,
    days: 30,
    to: new Date().toISOString().slice(0, 10),
    from: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--days") options.days = parsePositiveInteger(argv[++index], "days");
    else if (arg.startsWith("--days=")) options.days = parsePositiveInteger(arg.slice("--days=".length), "days");
    else if (arg === "--to") options.to = normalizeDate(argv[++index]);
    else if (arg.startsWith("--to=")) options.to = normalizeDate(arg.slice("--to=".length));
    else if (arg === "--from") options.from = normalizeDate(argv[++index]);
    else if (arg.startsWith("--from=")) options.from = normalizeDate(arg.slice("--from=".length));
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.to) throw new Error("--to must be YYYY-MM-DD.");
  if (!options.from) options.from = addDays(options.to, -(options.days - 1));
  if (!options.from) throw new Error("--from must be YYYY-MM-DD.");
  if (options.from > options.to) throw new Error("--from cannot be later than --to.");
  return options;
}

export async function buildMaterializationReport(options = {}) {
  const repository = await loadManualRepositoryFromGoogleSheets();
  if (!repository.ok) {
    return { ok: false, dryRun: !options.apply, error: repository.warning || "Manual repository unavailable." };
  }
  const autoBalances = Array.isArray(repository.autoBalances)
    ? { ok: true, balances: repository.autoBalances, warnings: [] }
    : await loadAutoBalanceRowsFromGoogleSheets();
  const manualBalances = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalanceRows = Array.isArray(autoBalances.balances) ? autoBalances.balances : [];
  const merged = mergeManualAndAutoBalances(manualBalances, autoBalanceRows);
  const balanceRows = merged.rows || merged.merged || [];
  const calculated = buildDailyCalculatedBalances({
    operations: repository.operations || [],
    balanceRows,
    period: { from: options.from, to: options.to },
  });
  const materialized = await materializeDailyCalculatedBalances({
    rows: calculated.rows,
    apply: Boolean(options.apply),
  });
  return {
    ok: true,
    dryRun: !options.apply,
    period: { from: options.from, to: options.to },
    sheetName: materialized.sheetName,
    calculated_summary: calculated.summary,
    materialized: {
      rowCount: materialized.rowCount,
      inserted: materialized.inserted || 0,
      updated: materialized.updated || 0,
    },
    rows: materialized.rows || calculated.rows.slice(0, 25),
    warnings: [
      ...(repository.warnings || []),
      ...(autoBalances.warnings || []),
      ...(calculated.warnings || []),
      ...(options.apply ? [] : ["dry-run only; pass --apply to write Расчетные Остатки"]),
    ],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await buildMaterializationReport(options);
  if (!report.ok) process.exitCode = 1;
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(inspect(report, { depth: 6, colors: false, maxArrayLength: 50 }));
}

function printHelp() {
  console.log(`Usage: node scripts/materialize-daily-calculated-balances.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--days 30] [--json] [--apply]

Default is dry-run. Only --apply writes the hidden Расчетные Остатки sheet.`);
}

function parsePositiveInteger(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`--${name} must be a positive integer.`);
  return numeric;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function isCliEntrypoint() {
  return import.meta.url === `file://${process.argv[1]}`;
}
