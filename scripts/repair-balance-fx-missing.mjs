#!/usr/bin/env node
import { inspect } from "node:util";

import {
  AUTO_BALANCE_HEADERS,
  AUTO_BALANCE_SHEET_NAME,
  FX_RATES_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "../server/manual-google-sheets.js";
import { buildFxRateLookup, parseFxRateRows } from "../server/fx-rates.js";

const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";
const DEFAULT_FROM = "2026-05-01";
const DEFAULT_TO = "2026-05-27";
const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const FX_REPAIR_CONFIRMATION = "repair-balance-fx-missing-usd-equivalents";

if (isCliEntrypoint()) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await buildBalanceFxMissingRepairReport(options);
  print(report, options);
  if (!report.ok) process.exitCode = 1;
}

export function parseArgs(argv = []) {
  const options = {
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    baseUrl: DEFAULT_BASE_URL,
    dryRun: true,
    apply: false,
    confirm: "",
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
    else if (arg === "--base-url") options.baseUrl = String(argv[++index] || "").replace(/\/+$/, "");
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length).replace(/\/+$/, "");
    else if (arg === "--confirm") options.confirm = String(argv[++index] || "").trim();
    else if (arg.startsWith("--confirm=")) options.confirm = String(arg.slice("--confirm=".length)).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.from || !options.to || options.from > options.to) {
    throw new Error("--from/--to must be YYYY-MM-DD with from <= to.");
  }
  if (options.apply && options.confirm !== FX_REPAIR_CONFIRMATION) {
    throw new Error(`Pass --confirm=${FX_REPAIR_CONFIRMATION} with --apply.`);
  }
  return options;
}

export async function buildBalanceFxMissingRepairReport(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const reconciliationPayload = options.reconciliationPayload || await fetchReconciliation(options, { fetchImpl });
  const reconciliation = reconciliationPayload?.period_balance_reconciliation || reconciliationPayload;
  const sourceRead = options.sourceValuesBySheet
    ? { ok: true, values: options.sourceValuesBySheet, warning: null }
    : await readSourceSheetsIfAvailable({ fetchImpl });
  const sourceRows = buildSourceRowIndex(sourceRead.values);
  const fxRateLookup = buildFxRateLookup(parseFxRateRows(sourceRead.values?.[FX_RATES_SHEET_NAME] || []).rates);
  const problemRows = findUsdCoverageProblemRows(reconciliation, sourceRows, fxRateLookup);
  const repairs = problemRows.flatMap((row) => row.repairs).filter((repair) => repair.can_apply);
  let applyResult = { applied: false, updated_cells: [], skipped: options.apply ? "no_safe_repairs" : "dry_run" };
  if (options.apply && repairs.length) {
    applyResult = await applyRepairs(repairs, { fetchImpl, accessToken: options.accessToken });
  }
  return {
    ok: true,
    dry_run: !options.apply,
    period: { from: options.from || DEFAULT_FROM, to: options.to || DEFAULT_TO },
    failing_layer: "balance snapshot USD conversion / FX coverage",
    source_tables_checked: Object.keys(sourceRead.values),
    source_read: { ok: sourceRead.ok, warning: sourceRead.warning },
    before: summarizeFxMissing(reconciliation),
    fx_missing_rows_count: problemRows.filter((row) => row.fx_warnings.length).length,
    fx_missing_rows: problemRows.filter((row) => row.fx_warnings.length),
    usd_coverage_problem_rows_count: problemRows.length,
    usd_coverage_problem_rows: problemRows,
    safe_repairs_count: repairs.length,
    safe_repairs: repairs,
    needs_owner_fx_count: problemRows.filter((row) => row.repairs.some((repair) => repair.repair === "needs_owner_fx")).length,
    apply_result: applyResult,
    warnings: [
      ...(sourceRead.warning ? [sourceRead.warning] : []),
      "No live/current FX rates are used.",
      "USD/USDT/USDC are treated as 1 for exact stable currency matches.",
      "This script writes only amount_usd cells for rows with a native amount and a deterministic USD equivalent from zero, stable currency, row rate, or FX Rates.",
      "Ledger/provider/env/amount_net are not modified.",
    ],
  };
}

function findUsdCoverageProblemRows(reconciliation = {}, sourceRows = new Map(), fxRateLookup = new Map()) {
  const excluded = new Set((reconciliation.total_usd_row?.excluded_channels || []).map((value) => normalizeText(value)));
  return (reconciliation.by_channel_currency || [])
    .filter((row) => (row.fx_warnings || []).length || excluded.has(normalizeText(`${row.channel} ${row.currency}`.trim())))
    .map((row) => {
      const repairs = [];
      if ((row.fx_warnings || []).some((warning) => String(warning).startsWith("opening_") || String(warning).startsWith("planned_"))) {
        repairs.push(buildProblem({
          kind: "opening_or_planned",
          date: row.opening_balance_date,
          channel: row.channel,
          currency: row.currency,
          nativeAmount: row.opening_native,
          amountUsd: row.opening_amount_usd,
          rate: row.opening_fx_rate_to_usd,
          fxSource: row.opening_fx_source,
          sourceRow: findSourceRow(sourceRows, row.opening_balance_date, row.channel, row.currency),
          fxRateLookup,
        }));
      }
      if ((row.fx_warnings || []).some((warning) => String(warning).startsWith("confirmed_") || String(warning).startsWith("diff_"))) {
        repairs.push(buildProblem({
          kind: "closing",
          date: row.manual_provider_closing_balance_date || row.factual_closing_balance_date || row.fact_date,
          channel: row.channel,
          currency: row.currency,
          nativeAmount: row.confirmed_end_native,
          amountUsd: row.manual_provider_closing_balance_usd,
          rate: row.manual_provider_closing_balance_fx_rate_to_usd,
          fxSource: row.manual_provider_closing_balance_fx_source,
          sourceRow: findSourceRow(sourceRows, row.manual_provider_closing_balance_date || row.factual_closing_balance_date || row.fact_date, row.channel, row.currency) || fallbackSourceRow(row),
          fxRateLookup,
        }));
      }
      if (!(row.fx_warnings || []).length) {
        repairs.push(...buildComparableCoverageProblems(row, sourceRows, fxRateLookup));
      }
      return {
        date: row.manual_provider_closing_balance_date || row.factual_closing_balance_date || row.fact_date || row.opening_balance_date || null,
        channel: row.channel,
        currency: row.currency,
        native_amount: row.confirmed_end_native ?? row.opening_native ?? null,
        fx_warnings: row.fx_warnings || [],
        source_sheet: row.sourceSheet || null,
        source_row: row.sourceRow || null,
        problem_source: summarizeProblemSources(repairs),
        repairs,
      };
    });
}

function buildComparableCoverageProblems(row = {}, sourceRows = new Map(), fxRateLookup = new Map()) {
  const problems = [];
  if (row.opening_usd === null || row.opening_usd === undefined) {
    problems.push(buildProblem({
      kind: "opening",
      date: row.opening_balance_date,
      channel: row.channel,
      currency: row.currency,
      nativeAmount: row.opening_native,
      amountUsd: row.opening_amount_usd,
      rate: row.opening_fx_rate_to_usd,
      fxSource: row.opening_fx_source,
      sourceRow: findSourceRow(sourceRows, row.opening_balance_date, row.channel, row.currency),
      fxRateLookup,
    }));
  }
  if (row.confirmed_end_usd === null || row.confirmed_end_usd === undefined) {
    problems.push(buildProblem({
      kind: "closing",
      date: row.manual_provider_closing_balance_date || row.factual_closing_balance_date || row.fact_date,
      channel: row.channel,
      currency: row.currency,
      nativeAmount: row.confirmed_end_native,
      amountUsd: row.manual_provider_closing_balance_usd,
      rate: row.manual_provider_closing_balance_fx_rate_to_usd,
      fxSource: row.manual_provider_closing_balance_fx_source,
      sourceRow: findSourceRow(sourceRows, row.manual_provider_closing_balance_date || row.factual_closing_balance_date || row.fact_date, row.channel, row.currency) || fallbackSourceRow(row),
      fxRateLookup,
    }));
  }
  if (!problems.length && (row.change_usd === null || row.diff_usd === null)) {
    problems.push({
      kind: "comparable_total",
      date: row.manual_provider_closing_balance_date || row.opening_balance_date || null,
      channel: row.channel,
      currency: row.currency,
      native_amount: row.confirmed_end_native ?? row.opening_native ?? null,
      source_sheet: row.sourceSheet || null,
      source_row: row.sourceRow || null,
      missing_fields: ["opening_usd or confirmed_end_usd"],
      problem_source: "USD totals are finite, but change/diff cannot be comparable because opening or closing side is missing.",
      repair: "needs_balance_fact",
      suggested_repair_action: "Confirm the missing opening/closing balance fact; do not invent native balances.",
      can_apply: false,
    });
  }
  return problems;
}

function buildProblem({ kind, date, channel, currency, nativeAmount, amountUsd, rate, fxSource, sourceRow, fxRateLookup = new Map() }) {
  const amount = parseNumber(nativeAmount);
  const hasUsd = parseNumber(amountUsd) !== null || parseNumber(sourceRow?.amount_usd) !== null;
  const explicitRate = parseNumber(rate) ?? parseNumber(sourceRow?.rate);
  const hasRate = explicitRate !== null;
  const hasClosingBalance = amount !== null || parseNumber(sourceRow?.amount) !== null;
  const missing = [];
  if (!hasClosingBalance) missing.push(kind === "closing" ? "no closing balance" : "no opening balance");
  if (!hasUsd) missing.push("no balance_usd");
  if (!hasRate && !hasUsd) missing.push("no rate");
  const wrongMapping = Boolean(sourceRow && (parseNumber(sourceRow.amount_usd) !== null || parseNumber(sourceRow.rate) !== null) && !hasUsd && !hasRate);
  if (wrongMapping) missing.push("wrong field mapping");
  const sourceAmount = amount ?? parseNumber(sourceRow?.amount);
  const resolved = resolveRepairUsd({
    date,
    currency,
    amount: sourceAmount,
    rate: explicitRate,
    amountUsd,
    sourceAmountUsd: sourceRow?.amount_usd,
    fxRateLookup,
  });
  const canApplyAmountUsd = sourceRow
    && resolved.can_apply
    && parseNumber(sourceRow.amount_usd) === null
    && sourceRow.amountColumn !== -1
    && sourceRow.amountUsdColumn !== -1;
  if (canApplyAmountUsd) {
    return {
      kind,
      date,
      channel,
      currency,
      native_amount: sourceAmount,
      source_sheet: sourceRow.sheet,
      source_row: sourceRow.rowNumber,
      missing_fields: missing,
      problem_source: missing.join(", "),
      repair: "balance_usd",
      repair_value: resolved.amount_usd,
      fx_source: resolved.fx_source,
      fx_rate_to_usd: resolved.fx_rate_to_usd,
      fx_rate_date: resolved.fx_rate_date,
      suggested_repair_action: `write amount_usd=${resolved.amount_usd} without changing native amount`,
      can_apply: true,
      write: { sheet: sourceRow.sheet, row: sourceRow.rowNumber, column: sourceRow.amountUsdColumn + 1, value: String(resolved.amount_usd) },
    };
  }
  const missingFx = sourceAmount !== null && !isUnmappableCurrency(currency) && !hasUsd && !hasRate && !resolved.can_apply;
  return {
    kind,
    date,
    channel,
    currency,
    native_amount: sourceAmount,
    source_sheet: sourceRow?.sheet || null,
    source_row: sourceRow?.rowNumber || null,
    missing_fields: missing,
    problem_source: missing.join(", ") || String(fxSource || "fx_missing"),
    repair: !hasClosingBalance ? "needs_balance_fact" : (missingFx ? "needs_fx_rate" : "needs_owner_fx"),
    proposed_fields: buildProposedFields({ amount: sourceAmount, currency, missingFx }),
    missing_fx_date: missingFx ? normalizeDate(date) : null,
    missing_fx_currency: missingFx ? String(currency || "").trim().toUpperCase() : null,
    suggested_repair_action: buildSuggestedRepairAction({ hasClosingBalance, missingFx, date, currency }),
    can_apply: false,
  };
}

function resolveRepairUsd({ date, currency, amount, rate, amountUsd, sourceAmountUsd, fxRateLookup = new Map() } = {}) {
  const explicitUsd = parseNumber(amountUsd) ?? parseNumber(sourceAmountUsd);
  if (explicitUsd !== null) return { can_apply: false };
  if (amount === null || amount === undefined) return { can_apply: false };
  if (Number(amount) === 0) {
    return { can_apply: true, amount_usd: 0, fx_rate_to_usd: null, fx_rate_date: normalizeDate(date) || null, fx_source: "zero_native_balance" };
  }
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (isStableUsdCurrency(normalizedCurrency)) {
    return { can_apply: true, amount_usd: round(amount), fx_rate_to_usd: 1, fx_rate_date: normalizeDate(date) || null, fx_source: "stable_usd_currency" };
  }
  const parsedRate = parseNumber(rate);
  if (parsedRate !== null && parsedRate > 0) {
    return { can_apply: true, amount_usd: round(Number(amount) * parsedRate), fx_rate_to_usd: parsedRate, fx_rate_date: normalizeDate(date) || null, fx_source: "snapshot_rate" };
  }
  const fx = fxRateLookup.get(`${normalizeDate(date)}|${normalizedCurrency}`);
  if (fx?.ok && parseNumber(fx.rate_to_usd) !== null) {
    const fxRate = parseNumber(fx.rate_to_usd);
    return { can_apply: true, amount_usd: round(Number(amount) * fxRate), fx_rate_to_usd: fxRate, fx_rate_date: fx.date, fx_source: "fx_rates" };
  }
  return { can_apply: false };
}

function buildProposedFields({ amount, currency, missingFx }) {
  if (amount === 0) return { balance_usd: 0, fx_source: "zero_native_balance" };
  if (isStableUsdCurrency(currency)) return { balance_usd: "native amount", fx_rate_to_usd: 1, fx_source: "stable_usd_currency" };
  if (missingFx) return { fx_rate_to_usd: "frozen historical FX rate", balance_usd: "native amount * fx_rate_to_usd", fx_source: "FX Rates" };
  return { balance_usd: "owner_frozen_usd", fx_rate_to_usd: "owner_frozen_rate", fx_source: "owner_frozen_source" };
}

function buildSuggestedRepairAction({ hasClosingBalance, missingFx, date, currency }) {
  if (!hasClosingBalance) return "Confirm the missing native balance fact first; this script will not invent balances.";
  if (missingFx) return `Add/fetch FX Rates for ${normalizeDate(date)}/${String(currency || "").trim().toUpperCase()}, then rerun this repair.`;
  return "Provide explicit currency mapping/rate before writing USD equivalent.";
}

function summarizeProblemSources(repairs = []) {
  return Array.from(new Set(repairs.flatMap((repair) => repair.missing_fields || []))).join(", ") || "fx_missing";
}

function summarizeFxMissing(reconciliation = {}) {
  const total = reconciliation.total_usd_row || {};
  return {
    warning: (reconciliation.warnings || []).find((warning) => String(warning).includes("fx_missing")) || null,
    excluded_fx_missing_rows: total.excluded_fx_missing_rows ?? null,
    fx_missing_start_rows: total.fx_missing_start_rows ?? null,
    fx_missing_end_rows: total.fx_missing_end_rows ?? null,
    fx_missing_change_rows: total.fx_missing_change_rows ?? null,
    fx_missing_movement_rows: total.fx_missing_movement_rows ?? null,
    fx_missing_diff_rows: total.fx_missing_diff_rows ?? null,
    total_usd_row: total,
  };
}

async function fetchReconciliation(options, { fetchImpl = fetch } = {}) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const from = encodeURIComponent(options.from || DEFAULT_FROM);
  const to = encodeURIComponent(options.to || DEFAULT_TO);
  const response = await fetchImpl(`${baseUrl}/api/period-balance-reconciliation?from=${from}&to=${to}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `period-balance-reconciliation failed with HTTP ${response.status}`);
  return payload;
}

async function readSourceSheets({ fetchImpl = fetch, accessToken } = {}) {
  const token = accessToken || await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  const result = {};
  for (const sheetName of ["Остатки", AUTO_BALANCE_SHEET_NAME, FX_RATES_SHEET_NAME]) {
    result[sheetName] = await readSheetValues(sheetName, { fetchImpl, accessToken: token });
  }
  return result;
}

async function readSourceSheetsIfAvailable({ fetchImpl = fetch } = {}) {
  try {
    return { ok: true, values: await readSourceSheets({ fetchImpl }), warning: null };
  } catch (error) {
    return {
      ok: false,
      values: {},
      warning: `raw Sheet read unavailable: ${String(error?.message || error)}; report uses live reconciliation source row metadata only and apply is disabled.`,
    };
  }
}

async function readSheetValues(sheetName, { fetchImpl = fetch, accessToken } = {}) {
  const range = encodeURIComponent(`'${sheetName}'!A:L`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Read ${sheetName} failed with HTTP ${response.status}`);
  return payload.values || [];
}

function buildSourceRowIndex(sourceValuesBySheet = {}) {
  const index = new Map();
  for (const [sheet, values] of Object.entries(sourceValuesBySheet)) {
    const header = values[0] || (sheet === AUTO_BALANCE_SHEET_NAME ? AUTO_BALANCE_HEADERS : []);
    const columns = buildHeaderIndexes(header);
    for (const [offset, cells] of (values || []).slice(1).entries()) {
      const row = normalizeSourceRow({ sheet, header, columns, cells, rowNumber: offset + 2 });
      if (!row.date || !row.channel || !row.currency) continue;
      index.set(sourceKey(row.date, row.channel, row.currency), row);
    }
  }
  return index;
}

function normalizeSourceRow({ sheet, header, columns, cells, rowNumber }) {
  const padded = padRow(cells, Math.max(header.length, AUTO_BALANCE_HEADERS.length));
  return {
    sheet,
    rowNumber,
    date: normalizeDate(padded[columns.date]),
    channel: String(padded[columns.channel] || "").trim(),
    amount: String(padded[columns.amount] || "").trim(),
    currency: String(padded[columns.currency] || "").trim().toUpperCase(),
    rate: columns.rate === -1 ? "" : String(padded[columns.rate] || "").trim(),
    amount_usd: columns.amountUsd === -1 ? "" : String(padded[columns.amountUsd] || "").trim(),
    source: columns.source === -1 ? "" : String(padded[columns.source] || "").trim(),
    status: columns.status === -1 ? "" : String(padded[columns.status] || "").trim(),
    comment: columns.comment === -1 ? "" : String(padded[columns.comment] || "").trim(),
    amountColumn: columns.amount,
    amountUsdColumn: columns.amountUsd,
  };
}

function buildHeaderIndexes(header = []) {
  const normalized = header.map((cell) => normalizeText(cell));
  return {
    date: findIndex(normalized, ["date", "дата"]),
    channel: findIndex(normalized, ["channel", "канал", "account"]),
    amount: findIndex(normalized, ["amount", "сумма"]),
    currency: findIndex(normalized, ["currency", "валюта"]),
    rate: findIndex(normalized, ["rate", "курс", "fx_rate_to_usd", "rate_to_usd"]),
    amountUsd: findIndex(normalized, ["amount_usd", "сумма_usd", "usd amount", "usdamount", "balance_usd"]),
    source: findIndex(normalized, ["source", "источник"]),
    status: findIndex(normalized, ["status", "статус"]),
    comment: findIndex(normalized, ["comment", "комментарий"]),
  };
}

function findSourceRow(sourceRows, date, channel, currency) {
  if (!date || !channel || !currency) return null;
  return sourceRows.get(sourceKey(date, channel, currency)) || null;
}

function fallbackSourceRow(row = {}) {
  if (!row.sourceSheet || !row.sourceRow) return null;
  return {
    sheet: row.sourceSheet,
    rowNumber: row.sourceRow,
    date: row.manual_provider_closing_balance_date || row.factual_closing_balance_date || row.fact_date || null,
    channel: row.channel,
    amount: String(row.confirmed_end_native ?? ""),
    currency: row.currency,
    rate: "",
    amount_usd: "",
    source: "",
    status: row.fact_status || "",
    comment: "",
    amountColumn: -1,
    amountUsdColumn: -1,
  };
}

async function applyRepairs(repairs = [], { fetchImpl = fetch, accessToken } = {}) {
  const token = accessToken || await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  const data = repairs.map((repair) => ({
    range: `'${repair.write.sheet}'!${columnName(repair.write.column)}${repair.write.row}`,
    values: [[repair.write.value]],
  }));
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Batch update failed with HTTP ${response.status}`);
  return {
    applied: true,
    updated_cells: data.map((entry) => entry.range),
    total_updated_cells: payload.totalUpdatedCells ?? data.length,
    sheet_response: payload,
  };
}

function sourceKey(date, channel, currency) {
  return `${date}|${normalizeText(channel)}|${String(currency || "").trim().toUpperCase()}`;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function isStableUsdCurrency(currency = "") {
  return ["USD", "USDT", "USDC"].includes(String(currency || "").trim().toUpperCase());
}

function isUnmappableCurrency(currency = "") {
  return ["LOCAL", "UNKNOWN"].includes(String(currency || "").trim().toUpperCase());
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const slash = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  return "";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function findIndex(normalizedHeader, names) {
  const normalizedNames = names.map(normalizeText);
  return normalizedHeader.findIndex((cell) => normalizedNames.includes(cell));
}

function padRow(row = [], length = 0) {
  const output = row.slice();
  while (output.length < length) output.push("");
  return output;
}

function columnName(columnNumber) {
  let number = Number(columnNumber || 0);
  let name = "";
  while (number > 0) {
    const modulo = (number - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    number = Math.floor((number - modulo) / 26);
  }
  return name;
}

function print(result, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(inspect(result, { depth: null, colors: process.stdout.isTTY, maxArrayLength: null }));
  }
}

function printHelp() {
  console.log(`Usage: node scripts/repair-balance-fx-missing.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD --dry-run [--json]
       node scripts/repair-balance-fx-missing.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD --apply --confirm=${FX_REPAIR_CONFIRMATION} [--json]`);
}

function isCliEntrypoint() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}
