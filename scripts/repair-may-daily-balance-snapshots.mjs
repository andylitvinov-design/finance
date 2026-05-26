#!/usr/bin/env node
import { inspect } from "node:util";

import {
  AUTO_BALANCE_HEADERS,
  AUTO_BALANCE_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "../server/manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const MAY_REPAIR_CONFIRMATION = "repair-may-2026-daily-balance-snapshots";
const DEFAULT_FROM = "2026-05-01";
const DEFAULT_TO = "2026-05-31";

if (isCliEntrypoint()) {
  await main();
}

export function parseArgs(argv = []) {
  const options = { from: DEFAULT_FROM, to: DEFAULT_TO, apply: false, confirm: "", json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--confirm") options.confirm = String(argv[++index] || "").trim();
    else if (arg.startsWith("--confirm=")) options.confirm = String(arg.slice("--confirm=".length)).trim();
    else if (arg === "--from") options.from = normalizeDate(argv[++index]);
    else if (arg.startsWith("--from=")) options.from = normalizeDate(arg.slice("--from=".length));
    else if (arg === "--to") options.to = normalizeDate(argv[++index]);
    else if (arg.startsWith("--to=")) options.to = normalizeDate(arg.slice("--to=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && (!options.from || !options.to || options.from > options.to)) {
    throw new Error("--from/--to must be YYYY-MM-DD with from <= to.");
  }
  return options;
}

export async function buildRepairMayDailyBalanceSnapshotsReport(options = {}) {
  const from = normalizeDate(options.from) || DEFAULT_FROM;
  const to = normalizeDate(options.to) || DEFAULT_TO;
  if (!from || !to || from > to) throw new Error("from and to must be YYYY-MM-DD with from <= to.");
  const apply = Boolean(options.apply);
  const confirm = String(options.confirm || "").trim();
  if (apply && confirm !== MAY_REPAIR_CONFIRMATION) {
    throw new Error(`Pass confirm=${MAY_REPAIR_CONFIRMATION} with --apply to rewrite ${AUTO_BALANCE_SHEET_NAME}.`);
  }

  const readValues = options.readValues || readAutoBalanceValues;
  const writeValues = options.writeValues || writeAutoBalanceValues;
  const values = await readValues();
  const repair = buildDedupedAutoBalanceValues(values, { from, to });

  let save = { rowCount: 0, skipped: apply ? "no_rows" : "dry_run" };
  if (apply && repair.removedRows.length) {
    const writeResult = await writeValues(repair.values);
    save = {
      rowCount: repair.removedRows.length,
      sheetName: AUTO_BALANCE_SHEET_NAME,
      updatedRows: writeResult?.updatedRows ?? repair.values.length,
    };
  }

  return {
    ok: true,
    dryRun: !apply,
    target_sheet: AUTO_BALANCE_SHEET_NAME,
    period: { from, to },
    total_rows_before: repair.totalRowsBefore,
    total_rows_after: repair.totalRowsAfter,
    duplicate_groups: repair.duplicateGroups,
    duplicate_groups_count: repair.duplicateGroups.length,
    removed_rows_count: repair.removedRows.length,
    removed_rows: repair.removedRows,
    save,
    warnings: apply ? [] : [`dry-run only; pass --apply --confirm=${MAY_REPAIR_CONFIRMATION} to rewrite ${AUTO_BALANCE_SHEET_NAME}`],
  };
}

export function buildDedupedAutoBalanceValues(values = [], { from = DEFAULT_FROM, to = DEFAULT_TO } = {}) {
  const sourceValues = normalizeValues(values);
  const header = sourceValues[0]?.length ? sourceValues[0] : AUTO_BALANCE_HEADERS.slice();
  const rows = sourceValues.slice(1).map((cells, index) => normalizeSheetRow(cells, header, index + 2));
  const groups = new Map();

  for (const row of rows) {
    if (!isRowInRange(row, from, to)) continue;
    const key = dedupeKey(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const duplicateGroups = [];
  const removedRowNumbers = new Set();
  const removedRows = [];
  for (const [key, groupRows] of groups.entries()) {
    if (groupRows.length < 2) continue;
    const kept = chooseCanonicalRow(groupRows);
    const removed = groupRows.filter((row) => row.rowNumber !== kept.rowNumber);
    removed.forEach((row) => {
      removedRowNumbers.add(row.rowNumber);
      removedRows.push(toReportRow(row, { key }));
    });
    duplicateGroups.push({
      key,
      count: groupRows.length,
      kept: toReportRow(kept, { key }),
      removed: removed.map((row) => toReportRow(row, { key })),
    });
  }

  const outputRows = rows.filter((row) => !removedRowNumbers.has(row.rowNumber));
  return {
    values: [header, ...outputRows.map((row) => row.values)],
    duplicateGroups,
    removedRows,
    totalRowsBefore: rows.length,
    totalRowsAfter: outputRows.length,
  };
}

function chooseCanonicalRow(rows = []) {
  return rows.slice().sort(compareRowsForKeep)[0];
}

function compareRowsForKeep(left, right) {
  return rowScore(right) - rowScore(left) || right.fetchedAt.localeCompare(left.fetchedAt) || left.rowNumber - right.rowNumber;
}

function rowScore(row) {
  let score = 0;
  if (row.hasNumericAmount) score += 1000;
  if (["ok", "zero_balance", "derived_from_confirmed_balance", "derived_from_confirmed_opening"].includes(row.status)) score += 100;
  score += sourceRank(row) * 100;
  score += row.values.filter((cell) => String(cell ?? "").trim()).length;
  return score;
}

function sourceRank(row) {
  const text = normalizeText([row.source, row.provider, row.status].join(" "));
  const provenance = normalizeText(row.comment);
  const status = normalizeText(row.status);
  if (/derived from confirmed|derived confirmed/.test(status)) return 5;
  if (/manual|user confirmed|owner confirmed|paypal manual/.test(text)) return 9;
  if (/provider auto|wise auto|paypal auto|monobank auto|binance auto|privatbank auto|yoomoney auto|tdbank auto|payoneer auto|revolut auto|auto daily provider snapshot/.test(text)) return 8;
  if (/derived from confirmed|derived confirmed/.test(text) || /derived from confirmed|derived confirmed/.test(provenance)) return 5;
  if (/provider error|needs provider permission|missing provider balance|provider not implemented/.test(text)) return 1;
  return 3;
}

function normalizeSheetRow(cells = [], header = [], rowNumber) {
  const row = padRow(cells, header.length || AUTO_BALANCE_HEADERS.length);
  const indexes = buildHeaderIndexes(header);
  const amount = String(row[indexes.amount] ?? "").trim();
  const numericAmount = parseNumber(amount);
  return {
    rowNumber,
    values: row,
    date: normalizeDate(row[indexes.date]),
    provider: String(row[indexes.provider] || "").trim(),
    channel: String(row[indexes.channel] || "").trim(),
    amount,
    hasNumericAmount: Number.isFinite(numericAmount),
    currency: String(row[indexes.currency] || "").trim().toUpperCase(),
    source: String(row[indexes.source] || "").trim(),
    fetchedAt: String(row[indexes.fetchedAt] || "").trim(),
    rawSourceId: String(row[indexes.rawSourceId] || "").trim(),
    status: String(row[indexes.status] || "").trim(),
    comment: String(row[indexes.comment] || "").trim(),
  };
}

function buildHeaderIndexes(header = []) {
  const normalized = (header || []).map(normalizeText);
  return {
    date: findIndex(normalized, ["date", "дата"]),
    provider: findIndex(normalized, ["provider", "провайдер"]),
    channel: findIndex(normalized, ["channel", "канал"]),
    amount: findIndex(normalized, ["amount", "сумма"]),
    currency: findIndex(normalized, ["currency", "валюта"]),
    source: findIndex(normalized, ["source", "источник"]),
    fetchedAt: findIndex(normalized, ["fetched_at", "fetched at"]),
    rawSourceId: findIndex(normalized, ["raw_source_id", "external_id"]),
    status: findIndex(normalized, ["status", "статус"]),
    comment: findIndex(normalized, ["comment", "комментарий"]),
  };
}

function findIndex(header, names) {
  const normalizedNames = names.map(normalizeText);
  const index = header.findIndex((cell) => normalizedNames.includes(cell));
  return index === -1 ? 0 : index;
}

function dedupeKey(row) {
  if (!row.date || !row.channel || !row.currency) return "";
  return `${row.date}|${normalizeChannel(row.channel)}|${row.currency}`;
}

function isRowInRange(row, from, to) {
  return Boolean(row.date && row.date >= from && row.date <= to);
}

function toReportRow(row, { key } = {}) {
  return {
    row: row.rowNumber,
    key,
    date: row.date,
    provider: row.provider,
    channel: row.channel,
    amount: row.amount,
    currency: row.currency,
    source: row.source,
    fetched_at: row.fetchedAt,
    raw_source_id: row.rawSourceId,
    status: row.status,
    comment: row.comment,
  };
}

async function readAutoBalanceValues({ fetchImpl = fetch } = {}) {
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  const range = encodeURIComponent(`'${AUTO_BALANCE_SHEET_NAME}'!A:L`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Read ${AUTO_BALANCE_SHEET_NAME} failed with HTTP ${response.status}`);
  return payload.values || [];
}

async function writeAutoBalanceValues(values, { fetchImpl = fetch } = {}) {
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  return writeAutoBalanceValuesWithAccessToken(values, { fetchImpl, accessToken });
}

export async function writeAutoBalanceValuesWithAccessToken(values, { fetchImpl = fetch, accessToken } = {}) {
  if (!accessToken) throw new Error("Google Sheets access token is required.");
  const range = encodeURIComponent(`'${AUTO_BALANCE_SHEET_NAME}'!A:L`);
  const clearResponse = await fetchImpl(
    `${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}:clear`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({}),
    }
  );
  const clearPayload = await clearResponse.json().catch(() => ({}));
  if (!clearResponse.ok) throw new Error(clearPayload?.error?.message || `Clear ${AUTO_BALANCE_SHEET_NAME} failed with HTTP ${clearResponse.status}`);

  const response = await fetchImpl(
    `${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ range: `'${AUTO_BALANCE_SHEET_NAME}'!A:L`, majorDimension: "ROWS", values }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Write ${AUTO_BALANCE_SHEET_NAME} failed with HTTP ${response.status}`);
  return payload;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await buildRepairMayDailyBalanceSnapshotsReport(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(inspect(report, { depth: 8, colors: false, maxArrayLength: 200 }));
}

function printHelp() {
  console.log(`Usage: node scripts/repair-may-daily-balance-snapshots.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json] [--apply --confirm=${MAY_REPAIR_CONFIRMATION}]

Default is dry-run. The apply mode rewrites only ${AUTO_BALANCE_SHEET_NAME}, removing duplicate rows by date + normalized channel + currency.`);
}

function normalizeValues(values = []) {
  return (values || []).map((row) => Array.isArray(row) ? row.slice() : []);
}

function padRow(row = [], length = AUTO_BALANCE_HEADERS.length) {
  const copy = row.slice(0, length);
  while (copy.length < length) copy.push("");
  return copy;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeChannel(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  const numeric = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function isCliEntrypoint() {
  return import.meta.url === `file://${process.argv[1]}`;
}
