#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getManualGoogleSheetsAccessToken,
  MANUAL_LEDGER_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
} from "../server/manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const LEDGER_RANGE_COLUMNS = "A:V";
const REQUIRED_COLUMNS = ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_net", "source", "raw_source_id"];
const SIMPLE_NET_SOURCES = new Set(["manual", "fact", "google_sheets", "migration"]);

if (isCliEntrypoint()) {
  await main();
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    const confirmations = await readConfirmations(options.confirmFile);
    const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE });
    const values = await readLedgerValues({ accessToken });
    const plan = buildMissingLedgerAmountNetRepairPlan(values, { ...options, confirmations });

    if (options.apply && plan.ok && plan.changes.length) {
      await applyMissingLedgerAmountNetRepair({ accessToken, plan });
    }

    const report = {
      ok: plan.ok,
      dryRun: !options.apply,
      applied: Boolean(options.apply && plan.ok && plan.changes.length),
      summary: plan.summary,
      rows: plan.rows,
      changes: plan.changes,
      skipped: plan.skipped,
      errors: plan.errors,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!plan.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

export function parseArgs(argv = []) {
  const options = {
    apply: false,
    from: "",
    to: "",
    rawSourceId: "",
    confirmFile: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--from") options.from = normalizeDate(argv[++index] || "");
    else if (arg.startsWith("--from=")) options.from = normalizeDate(arg.slice("--from=".length));
    else if (arg === "--to") options.to = normalizeDate(argv[++index] || "");
    else if (arg.startsWith("--to=")) options.to = normalizeDate(arg.slice("--to=".length));
    else if (arg === "--raw-source-id") options.rawSourceId = String(argv[++index] || "").trim();
    else if (arg.startsWith("--raw-source-id=")) options.rawSourceId = arg.slice("--raw-source-id=".length).trim();
    else if (arg === "--confirm-file") options.confirmFile = String(argv[++index] || "").trim();
    else if (arg.startsWith("--confirm-file=")) options.confirmFile = arg.slice("--confirm-file=".length).trim();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.from && options.to && options.from > options.to) throw new Error("--from must be before or equal to --to.");
  return options;
}

export function buildMissingLedgerAmountNetRepairPlan(values = [], options = {}) {
  const headerIndex = findHeaderIndex(values);
  if (headerIndex === -1) return errorPlan(["Ledger header row was not found."]);
  const header = values[headerIndex] || [];
  const indexes = buildIndexes(header);
  const missingColumns = REQUIRED_COLUMNS.filter((name) => indexes[name] === -1);
  if (missingColumns.length) return errorPlan([`Ledger required column(s) missing: ${missingColumns.join(", ")}`]);

  const rows = [];
  for (let index = headerIndex + 1; index < values.length; index += 1) {
    const row = values[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    const candidate = buildCandidate({ row, indexes, rowNumber: index + 1, options });
    if (!candidate || !matchesFilters(candidate, options)) continue;
    rows.push(candidate);
  }

  const changes = rows.filter((row) => row.status === "change");
  const skipped = rows.filter((row) => row.status !== "change");
  const errors = [];
  if (options.apply && changes.some((row) => row.confirmation_required) && !options.confirmFile) {
    errors.push("--apply refuses confirmation-required rows without --confirm-file.");
  }

  return {
    ok: errors.length === 0,
    rows,
    changes,
    skipped,
    errors,
    summary: {
      detected_rows: rows.length,
      change_rows: changes.length,
      skipped_rows: skipped.length,
      confirmation_required_rows: rows.filter((row) => row.confirmation_required).length,
    },
  };
}

export function applyRepairPlanToValues(values = [], plan = {}) {
  const next = values.map((row) => Array.isArray(row) ? row.slice() : []);
  if (!plan.ok) return next;
  for (const change of plan.changes || []) {
    next[change.rowNumber - 1][change.amountNetColumnIndex] = change.new_amount_net;
  }
  return next;
}

async function applyMissingLedgerAmountNetRepair({ accessToken, plan, fetchImpl = fetch } = {}) {
  const data = (plan.changes || []).map((row) => ({
    range: `'${MANUAL_LEDGER_SHEET_NAME}'!${columnName(row.amountNetColumnIndex + 1)}${row.rowNumber}`,
    values: [[row.new_amount_net]],
  }));
  if (!data.length) return { updated: 0 };
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values:batchUpdate?valueInputOption=USER_ENTERED`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data, valueInputOption: "USER_ENTERED" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets write failed with HTTP ${response.status}`);
  return { updated: data.length, updatedRange: payload?.totalUpdatedCells || null };
}

async function readLedgerValues({ accessToken, fetchImpl = fetch } = {}) {
  const range = `'${MANUAL_LEDGER_SHEET_NAME}'!${LEDGER_RANGE_COLUMNS}`;
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets read failed with HTTP ${response.status}`);
  return payload.values || [];
}

async function readConfirmations(path) {
  if (!path) return [];
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.missingAmountNet)) return payload.missingAmountNet;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function buildCandidate({ row, indexes, rowNumber, options }) {
  const oldAmountNet = String(row[indexes.amount_net] || "").trim();
  if (oldAmountNet) return null;
  const rawSourceId = String(row[indexes.raw_source_id] || "").trim();
  const confirmation = findConfirmation({ row, indexes, rowNumber, options });
  const source = normalizeSource(row[indexes.source]);
  const amount = parseAmount(row[indexes.amount]);
  const paypal = isPayPalRow(row, indexes);
  const derived = confirmation?.amount_net ?? confirmation?.amountNet ?? deriveSafeAmountNet({ amount, source, paypal });
  const newAmountNet = derived === null || derived === undefined ? "" : formatNumber(derived);
  const confirmationRequired = paypal || !isSimpleSafeSource(source);
  const status = newAmountNet ? "change" : "needs_verification";
  return {
    rowNumber,
    raw_source_id: rawSourceId,
    date: normalizeDate(row[indexes.date]),
    operation: String(row[indexes.operation] || "").trim(),
    from_channel: String(row[indexes.from_channel] || "").trim(),
    to_channel: String(row[indexes.to_channel] || "").trim(),
    amount: String(row[indexes.amount] || "").trim(),
    currency: String(row[indexes.currency] || "").trim().toUpperCase(),
    source,
    old_amount_net: oldAmountNet,
    new_amount_net: newAmountNet,
    amountNetColumnIndex: indexes.amount_net,
    status,
    confirmation_required: confirmationRequired,
    warning: status === "change"
      ? ""
      : paypal
        ? "PayPal fee/net unavailable; explicit provider/manual confirmation is required. Gross was not used as net."
        : "amount_net cannot be derived safely from existing fields.",
  };
}

function deriveSafeAmountNet({ amount, source, paypal }) {
  if (paypal || !isSimpleSafeSource(source) || amount === null) return null;
  return Math.abs(amount);
}

function matchesFilters(row, options = {}) {
  if (options.rawSourceId && row.raw_source_id !== options.rawSourceId) return false;
  if (options.from && row.date < options.from) return false;
  if (options.to && row.date > options.to) return false;
  return true;
}

function findConfirmation({ row, indexes, rowNumber, options }) {
  const rawSourceId = String(row[indexes.raw_source_id] || "").trim();
  return (options.confirmations || []).find((entry) => {
    const confirmedId = String(entry.raw_source_id ?? entry.rawSourceId ?? "").trim();
    if (confirmedId && rawSourceId && confirmedId !== rawSourceId) return false;
    const confirmedRow = Number(entry.rowNumber ?? entry.sheetRowNumber ?? entry.sheet_row_number ?? 0);
    return Boolean(confirmedId || (confirmedRow && confirmedRow === Number(rowNumber || 0)));
  }) || null;
}

function buildIndexes(header = []) {
  const normalized = header.map((cell) => normalizeHeader(cell));
  return Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, normalized.indexOf(name)]));
}

function findHeaderIndex(values = []) {
  return (values || []).findIndex((row) => (row || []).some((cell) => normalizeHeader(cell) === "date"));
}

function isPayPalRow(row, indexes) {
  const text = normalizeText([
    row[indexes.source],
    row[indexes.from_channel],
    row[indexes.to_channel],
    row[indexes.raw_source_id],
  ].join(" "));
  return /paypal|пейпал/.test(text);
}

function isSimpleSafeSource(source) {
  return SIMPLE_NET_SOURCES.has(normalizeSource(source));
}

function normalizeSource(value) {
  const raw = normalizeText(value).replace(/\s+/g, "_");
  if (!raw || raw === "other" || raw === "unknown") return "unknown";
  return raw;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function parseAmount(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.round(numeric * 1000000) / 1000000);
}

function columnName(index) {
  let value = index;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function errorPlan(errors) {
  return {
    ok: false,
    rows: [],
    changes: [],
    skipped: [],
    errors,
    summary: {
      detected_rows: 0,
      change_rows: 0,
      skipped_rows: 0,
      confirmation_required_rows: 0,
    },
  };
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function printHelp() {
  console.log(`Usage: node scripts/repair-missing-ledger-amount-net.mjs [options]

Dry-run is the default. Writes require --apply.

Options:
  --from YYYY-MM-DD              Limit rows from this date
  --to YYYY-MM-DD                Limit rows to this date
  --raw-source-id ID             Limit to one raw_source_id
  --confirm-file path.json       Explicit confirmed amount_net rows
  --apply                        Write amount_net cells to Ledger
  -h, --help                     Show help

Confirmation file shape:
  [{ "raw_source_id": "5U351082V9506951V", "amount_net": "36" }]
`);
}
