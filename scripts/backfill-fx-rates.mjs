#!/usr/bin/env node
import { inspect } from "node:util";

import {
  applyFxRateRows,
  fetchFxRowsForDate,
  parseCurrencyList,
} from "./fetch-fx-rates.mjs";
import { FX_RATES_SHEET_NAME } from "../server/manual-google-sheets.js";

const DEFAULT_CURRENCIES = ["EUR", "CAD", "UAH", "RUB", "CHF", "GBP", "THB"];

if (isCliEntrypoint()) {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildBackfillFxRatesReport(options);
  print(report, options);
  if (!report.ok) process.exitCode = 1;
}

export function parseArgs(argv = []) {
  const options = {
    from: "",
    to: "",
    currencies: DEFAULT_CURRENCIES,
    dryRun: true,
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
    } else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--from") options.from = normalizeDate(argv[++index]);
    else if (arg.startsWith("--from=")) options.from = normalizeDate(arg.slice("--from=".length));
    else if (arg === "--to") options.to = normalizeDate(argv[++index]);
    else if (arg.startsWith("--to=")) options.to = normalizeDate(arg.slice("--to=".length));
    else if (arg === "--currencies") options.currencies = parseCurrencyList(argv[++index]);
    else if (arg.startsWith("--currencies=")) options.currencies = parseCurrencyList(arg.slice("--currencies=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.from || !options.to || options.from > options.to) throw new Error("--from/--to must be YYYY-MM-DD with from <= to.");
  if (!options.currencies.length) throw new Error("--currencies must include at least one currency.");
  return options;
}

export async function buildBackfillFxRatesReport(options = {}) {
  const from = normalizeDate(options.from);
  const to = normalizeDate(options.to);
  const currencies = parseCurrencyList(options.currencies || DEFAULT_CURRENCIES);
  const dryRun = options.apply ? false : options.dryRun !== false;
  const fetchImpl = options.fetchImpl || fetch;
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const rows = [];
  for (const date of enumerateDates(from, to)) {
    try {
      rows.push(...await fetchFxRowsForDate({ date, currencies, fetchedAt, fetchImpl }));
    } catch (error) {
      return {
        ok: false,
        dry_run: dryRun,
        period: { from, to },
        currencies,
        rows,
        apply_result: { applied: false, skipped: "provider_error" },
        error: normalizeProviderError(error, { date, currency: currencies.join(",") }),
      };
    }
  }
  let applyResult = { applied: false, skipped: "dry_run", target_sheet: FX_RATES_SHEET_NAME };
  if (options.apply) {
    try {
      applyResult = await applyFxRateRows(rows, { fetchImpl });
    } catch (error) {
      return {
        ok: false,
        dry_run: false,
        period: { from, to },
        currencies,
        target_sheet: FX_RATES_SHEET_NAME,
        rows,
        apply_result: { applied: false, skipped: "apply_error", target_sheet: FX_RATES_SHEET_NAME },
        error: normalizeApiError(error, { date: to, currency: currencies.join(",") }),
      };
    }
  }
  return {
    ok: true,
    dry_run: dryRun,
    period: { from, to },
    currencies,
    target_sheet: FX_RATES_SHEET_NAME,
    rows,
    apply_result: applyResult,
  };
}

function enumerateDates(from, to) {
  const output = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function normalizeProviderError(error, fallback = {}) {
  return {
    code: "provider_error",
    message: redact(String(error?.message || error || "provider_error")),
    source: "frankfurter",
    date: error?.date || fallback.date || "",
    currency: error?.currency || fallback.currency || "",
  };
}

function normalizeApiError(error, fallback = {}) {
  return {
    code: "api_error",
    message: redact(String(error?.message || error || "api_error")),
    source: "google_sheets",
    date: fallback.date || "",
    currency: fallback.currency || "",
  };
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function redact(value) {
  return String(value || "")
    .replace(/(token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, "[redacted-private-key]");
}

function print(report, options = {}) {
  if (options.help) {
    console.log("Usage: node scripts/backfill-fx-rates.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD --currencies=EUR,CAD --dry-run|--apply [--json]");
    return;
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(inspect(report, { depth: null, colors: process.stdout.isTTY, maxArrayLength: null }));
}

function isCliEntrypoint() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}
