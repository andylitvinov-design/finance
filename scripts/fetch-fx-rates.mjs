#!/usr/bin/env node
import { inspect } from "node:util";

import {
  FX_RATES_HEADERS,
  FX_RATES_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "../server/manual-google-sheets.js";
import { DEFAULT_PROVIDER_FX_CURRENCIES, isStableUsdCurrency } from "../server/fx-rates.js";

const DEFAULT_SOURCE = "frankfurter";
const DEFAULT_CURRENCIES = DEFAULT_PROVIDER_FX_CURRENCIES;
const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

if (isCliEntrypoint()) {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildFetchFxRatesReport(options);
  print(report, options);
  if (!report.ok) process.exitCode = 1;
}

export function parseArgs(argv = []) {
  const options = {
    date: "",
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
    else if (arg === "--date") options.date = normalizeDate(argv[++index]);
    else if (arg.startsWith("--date=")) options.date = normalizeDate(arg.slice("--date=".length));
    else if (arg === "--currencies") options.currencies = parseCurrencyList(argv[++index]);
    else if (arg.startsWith("--currencies=")) options.currencies = parseCurrencyList(arg.slice("--currencies=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.date) throw new Error("--date=YYYY-MM-DD is required.");
  if (!options.currencies.length) throw new Error("--currencies must include at least one currency.");
  return options;
}

export async function buildFetchFxRatesReport(options = {}) {
  const date = normalizeDate(options.date);
  const currencies = parseCurrencyList(options.currencies || DEFAULT_CURRENCIES);
  const dryRun = options.apply ? false : options.dryRun !== false;
  const fetchImpl = options.fetchImpl || fetch;
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  let rows = [];
  try {
    rows = await fetchFxRowsForDate({ date, currencies, fetchedAt, fetchImpl });
  } catch (error) {
    return {
      ok: false,
      dry_run: dryRun,
      date,
      currencies,
      rows: [],
      apply_result: { applied: false, skipped: "provider_error" },
      error: normalizeProviderError(error, { date, currency: currencies.join(",") }),
    };
  }
  let applyResult = { applied: false, skipped: "dry_run", target_sheet: FX_RATES_SHEET_NAME };
  if (options.apply) {
    try {
      applyResult = await applyFxRateRows(rows, { fetchImpl });
    } catch (error) {
      return {
        ok: false,
        dry_run: false,
        date,
        currencies,
        source: DEFAULT_SOURCE,
        target_sheet: FX_RATES_SHEET_NAME,
        rows,
        apply_result: { applied: false, skipped: "apply_error", target_sheet: FX_RATES_SHEET_NAME },
        error: normalizeApiError(error, { date, currency: currencies.join(",") }),
      };
    }
  }
  return {
    ok: true,
    dry_run: dryRun,
    date,
    currencies,
    source: DEFAULT_SOURCE,
    target_sheet: FX_RATES_SHEET_NAME,
    rows,
    apply_result: applyResult,
    warnings: [
      "Fetch scripts write only FX Rates.",
      "Historical reports read stored FX Rates and do not call live FX APIs.",
    ],
  };
}

export async function fetchFxRowsForDate({ date, currencies = DEFAULT_CURRENCIES, fetchedAt = new Date().toISOString(), fetchImpl = fetch } = {}) {
  const normalizedDate = normalizeDate(date);
  const normalizedCurrencies = parseCurrencyList(currencies);
  const stableRows = normalizedCurrencies
    .filter(isStableUsdCurrency)
    .map((currency) => buildFxRow({
      date: normalizedDate,
      currency,
      rateToUsd: 1,
      sourceUrl: "exact-stable-currency",
      fetchedAt,
      comment: "Exact stable USD-like currency match.",
    }));
  const providerCurrencies = normalizedCurrencies.filter((currency) => !isStableUsdCurrency(currency));
  if (!providerCurrencies.length) return stableRows;

  const url = buildFrankfurterUrl(normalizedDate, providerCurrencies);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ProviderFxError(payload?.message || payload?.error || `Frankfurter returned HTTP ${response.status}`, {
      date: normalizedDate,
      currency: providerCurrencies.join(","),
    });
  }
  const providerRows = normalizeFrankfurterPayload(payload, { date: normalizedDate, currencies: providerCurrencies, sourceUrl: url, fetchedAt });
  return [...stableRows, ...providerRows];
}

export async function applyFxRateRows(rows = [], { fetchImpl = fetch } = {}) {
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  await ensureFxRatesSheet({ accessToken, fetchImpl });
  const existingValues = await readFxRatesSheetValues({ accessToken, fetchImpl });
  const mergedValues = mergeFxRateSheetValues(existingValues, rows);
  const range = encodeURIComponent(`'${FX_RATES_SHEET_NAME}'!A:I`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: mergedValues }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `FX Rates update failed with HTTP ${response.status}`);
  }
  return {
    applied: true,
    target_sheet: FX_RATES_SHEET_NAME,
    rows_written: Math.max(0, mergedValues.length - 1),
    updated_range: payload.updatedRange || null,
  };
}

export async function readFxRateSheetValues({ fetchImpl = fetch } = {}) {
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  await ensureFxRatesSheet({ accessToken, fetchImpl });
  return await readFxRatesSheetValues({ accessToken, fetchImpl });
}

export function parseCurrencyList(value) {
  const input = Array.isArray(value) ? value.join(",") : String(value || "");
  return Array.from(new Set(input.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)));
}

function normalizeFrankfurterPayload(payload, { date, currencies, sourceUrl, fetchedAt }) {
  const rows = Array.isArray(payload) ? payload : [];
  return currencies.map((currency) => {
    const match = rows.find((row) =>
      String(row?.date || "") === date &&
      String(row?.base || "").toUpperCase() === "USD" &&
      String(row?.quote || "").toUpperCase() === currency
    );
    const usdToCurrency = Number(match?.rate || 0);
    if (!usdToCurrency) {
      throw new ProviderFxError(`Missing Frankfurter rate for ${currency}`, { date, currency });
    }
    return buildFxRow({
      date,
      currency,
      rateToUsd: round(1 / usdToCurrency),
      sourceUrl,
      fetchedAt,
      comment: "rate_to_usd derived from Frankfurter USD quote.",
    });
  });
}

function buildFxRow({ date, currency, rateToUsd, sourceUrl, fetchedAt, comment }) {
  return {
    date,
    currency,
    base_currency: "USD",
    rate_to_usd: rateToUsd,
    source: DEFAULT_SOURCE,
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    status: "ok",
    comment,
  };
}

async function ensureFxRatesSheet({ accessToken, fetchImpl }) {
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Spreadsheet metadata read failed with HTTP ${response.status}`);
  const exists = (payload.sheets || []).some((sheet) => sheet?.properties?.title === FX_RATES_SHEET_NAME);
  if (exists) return { created: false };
  const addResponse = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: FX_RATES_SHEET_NAME } } }],
    }),
  });
  const addPayload = await addResponse.json().catch(() => ({}));
  if (!addResponse.ok) throw new Error(addPayload?.error?.message || `Create FX Rates sheet failed with HTTP ${addResponse.status}`);
  return { created: true };
}

async function readFxRatesSheetValues({ accessToken, fetchImpl }) {
  const range = encodeURIComponent(`'${FX_RATES_SHEET_NAME}'!A:I`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Read FX Rates failed with HTTP ${response.status}`);
  return payload.values || [];
}

function mergeFxRateSheetValues(existingValues = [], rows = []) {
  const output = [FX_RATES_HEADERS];
  const existingRows = (existingValues || []).slice(1).filter((row) => (row || []).some((cell) => String(cell || "").trim()));
  const byKey = new Map();
  for (const row of existingRows) {
    const normalized = normalizeSheetRow(row);
    if (normalized) byKey.set(`${normalized[0]}|${normalized[1]}`, normalized);
  }
  for (const row of rows || []) {
    const values = [
      row.date,
      row.currency,
      row.base_currency,
      formatNumber(row.rate_to_usd),
      row.source,
      row.source_url,
      row.fetched_at,
      row.status,
      row.comment,
    ];
    byKey.set(`${row.date}|${row.currency}`, values);
  }
  return [...output, ...Array.from(byKey.values()).sort((left, right) => `${left[0]}|${left[1]}`.localeCompare(`${right[0]}|${right[1]}`))];
}

function normalizeSheetRow(row = []) {
  const padded = row.slice(0, FX_RATES_HEADERS.length);
  while (padded.length < FX_RATES_HEADERS.length) padded.push("");
  const date = normalizeDate(padded[0]);
  const currency = String(padded[1] || "").trim().toUpperCase();
  if (!date || !currency) return null;
  padded[0] = date;
  padded[1] = currency;
  return padded;
}

function buildFrankfurterUrl(date, currencies) {
  const url = new URL("https://api.frankfurter.dev/v2/rates");
  url.searchParams.set("date", date);
  url.searchParams.set("base", "USD");
  url.searchParams.set("quotes", currencies.join(","));
  return url.toString();
}

function normalizeProviderError(error, fallback = {}) {
  if (error instanceof ProviderFxError) {
    return {
      code: "provider_error",
      message: redact(error.message),
      source: DEFAULT_SOURCE,
      date: error.date || fallback.date || "",
      currency: error.currency || fallback.currency || "",
    };
  }
  return {
    code: "provider_error",
    message: redact(String(error?.message || error || "provider_error")),
    source: DEFAULT_SOURCE,
    date: fallback.date || "",
    currency: fallback.currency || "",
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

class ProviderFxError extends Error {
  constructor(message, { date, currency } = {}) {
    super(message);
    this.date = date;
    this.currency = currency;
  }
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function round(value) {
  return Math.round(Number(value || 0) * 1000000) / 1000000;
}

function formatNumber(value) {
  return String(Number(value || 0));
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
    console.log("Usage: node scripts/fetch-fx-rates.mjs --date=YYYY-MM-DD --currencies=EUR,CAD --dry-run|--apply [--json]");
    return;
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(inspect(report, { depth: null, colors: process.stdout.isTTY, maxArrayLength: null }));
}

function isCliEntrypoint() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}
