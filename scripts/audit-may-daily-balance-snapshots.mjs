#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXPECTED_PROVIDER_BALANCES } from "../server/auto-balance-snapshots.js";

const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";
const DEFAULT_FROM = "2026-05-01";
const DEFAULT_TO = "2026-05-31";
const LEFT_DATE = "2026-05-20";
const RIGHT_DATE = "2026-05-26";

if (isCliEntrypoint()) {
  const options = parseArgs(process.argv.slice(2));
  const result = await runLiveAudit(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printAudit(result);
  if (!result.ok) process.exitCode = 1;
}

export function parseArgs(argv = []) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--base-url") options.baseUrl = String(argv[++index] || "").trim() || DEFAULT_BASE_URL;
    else if (arg.startsWith("--base-url=")) options.baseUrl = String(arg.slice("--base-url=".length)).trim() || DEFAULT_BASE_URL;
    else if (arg === "--from") options.from = normalizeDate(argv[++index]);
    else if (arg.startsWith("--from=")) options.from = normalizeDate(arg.slice("--from=".length));
    else if (arg === "--to") options.to = normalizeDate(argv[++index]);
    else if (arg.startsWith("--to=")) options.to = normalizeDate(arg.slice("--to=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.from || !options.to || options.from > options.to) throw new Error("--from/--to must be YYYY-MM-DD with from <= to.");
  return options;
}

export async function runLiveAudit(options = {}) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const from = normalizeDate(options.from) || DEFAULT_FROM;
  const to = normalizeDate(options.to) || DEFAULT_TO;
  const endpointLogs = [];
  const status = await fetchJsonWithLog(`${baseUrl}/api/status`, endpointLogs);
  const may = await fetchJsonWithLog(`${baseUrl}/api/balance-snapshots?from=${from}&to=${to}`, endpointLogs);
  const left = await fetchJsonWithLog(`${baseUrl}/api/balance-snapshots?from=${LEFT_DATE}&to=${LEFT_DATE}`, endpointLogs);
  const right = await fetchJsonWithLog(`${baseUrl}/api/balance-snapshots?from=${RIGHT_DATE}&to=${RIGHT_DATE}`, endpointLogs);
  const auditSnapshot = await fetchJsonWithLog(`${baseUrl}/api/audit-snapshot?from=${from}&to=${to}`, endpointLogs);
  const uiSourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "remainders-summary-popup.js");
  const uiSource = fs.existsSync(uiSourcePath) ? fs.readFileSync(uiSourcePath, "utf8") : "";

  const audit = auditDailyBalanceSnapshotCoverage({
    balanceSnapshots: may.json,
    leftBalanceSnapshots: left.json,
    rightBalanceSnapshots: right.json,
    auditSnapshot: auditSnapshot.json,
    expectedPairs: EXPECTED_PROVIDER_BALANCES,
    uiSource,
    from,
    to,
  });

  return {
    ok: endpointLogs.every((entry) => entry.status >= 200 && entry.status < 300 && entry.json_parse_result === "ok"),
    current_deploy: extractDeploy(status.json),
    endpoint_logs: endpointLogs.map((entry) => ({ ...entry, current_deploy: extractDeploy(status.json) })),
    ...audit,
  };
}

export function auditDailyBalanceSnapshotCoverage({
  balanceSnapshots = {},
  leftBalanceSnapshots = null,
  rightBalanceSnapshots = null,
  auditSnapshot = {},
  expectedPairs = EXPECTED_PROVIDER_BALANCES,
  uiSource = "",
  from = DEFAULT_FROM,
  to = DEFAULT_TO,
} = {}) {
  const expected = uniquePairs(expectedPairs);
  const rows = extractSnapshotRows(balanceSnapshots);
  const leftRows = extractSnapshotRows(leftBalanceSnapshots || filterRowsByDate(balanceSnapshots, LEFT_DATE));
  const rightRows = extractSnapshotRows(rightBalanceSnapshots || filterRowsByDate(balanceSnapshots, RIGHT_DATE));
  const dateCoverage = buildDateRange(from, to).map((date) => buildDateCoverage(date, rows, expected));
  const channelCoverage = buildChannelCoverage(rows, expected, from, to);
  const keyDateComparison = compareKeyDates({
    leftDate: LEFT_DATE,
    rightDate: RIGHT_DATE,
    leftRows,
    rightRows,
  });

  return {
    summary: {
      from,
      to,
      expected_channel_currency_count: expected.length,
      dates: dateCoverage.length,
      missing_dates: dateCoverage.filter((row) => row.status === "missing").length,
      partial_dates: dateCoverage.filter((row) => row.status === "partial").length,
      ok_dates: dateCoverage.filter((row) => row.status === "ok").length,
    },
    expected_channel_currency: expected.map((pair) => ({ channel: pair.channel, currency: pair.currency })),
    date_coverage: dateCoverage,
    channel_coverage: channelCoverage,
    key_date_comparison: keyDateComparison,
    source_diagnostics: buildSourceDiagnostics({ balanceSnapshots, auditSnapshot }),
    ui_source_check: inspectRemaindersPopupSource(uiSource),
  };
}

export function inspectRemaindersPopupSource(source = "") {
  const hasCollapsedDiagnostics = /createElement\(["']details["']\)|<details/.test(source);
  return {
    uses_balance_snapshots_selected_date_rows: /api\/balance-snapshots/.test(source) && /selected_date_rows/.test(source),
    renders_selected_date_snapshots: /renderSelectedDateSnapshotBlock/.test(source),
    renders_reconciliation_table_as_primary: /summary\.rows\.forEach/.test(source) && /needsVerification/.test(source) && !hasCollapsedDiagnostics,
    has_collapsed_diagnostics: hasCollapsedDiagnostics,
    has_partial_coverage_warning: /Частичное покрытие/.test(source),
  };
}

async function fetchJsonWithLog(url, endpointLogs) {
  const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const body = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let json = null;
  let jsonParseResult = "ok";
  try {
    json = JSON.parse(body);
  } catch (error) {
    jsonParseResult = `error: ${String(error?.message || error)}`;
  }
  endpointLogs.push({
    method: "GET",
    url,
    status: response.status,
    content_type: contentType,
    first_300_chars_body: body.slice(0, 300),
    json_parse_result: jsonParseResult,
    json_top_keys: json && typeof json === "object" ? Object.keys(json).slice(0, 20) : [],
  });
  return { response, body, json };
}

function extractDeploy(status = {}) {
  return {
    commitSha: status?.commitSha || "",
    commitRef: status?.commitRef || "",
    gitRepoSlug: status?.gitRepoSlug || "",
    status: status?.status || "",
    deploymentUrl: status?.deploymentUrl || "",
  };
}

function extractSnapshotRows(payload = {}) {
  const snapshots = payload?.balance_snapshots || payload || {};
  const candidates = [
    snapshots.selected_rows,
    snapshots.merged_rows,
    snapshots.selected_date_rows,
    snapshots.rows,
  ];
  return (candidates.find(Array.isArray) || []).map(normalizeRow).filter((row) => row.date && row.channel && row.currency);
}

function filterRowsByDate(payload = {}, date) {
  const snapshots = payload?.balance_snapshots || payload || {};
  const rows = extractSnapshotRows(payload).filter((row) => row.date === date);
  return { balance_snapshots: { ...snapshots, selected_rows: rows } };
}

function buildDateCoverage(date, rows, expected) {
  const dayRows = rows.filter((row) => row.date === date);
  const keyCounts = countKeys(dayRows);
  const numericRows = dayRows.filter((row) => row.amount_numeric).length;
  const missingExpected = expected
    .filter((pair) => !keyCounts.has(makeKey(pair.channel, pair.currency)))
    .map((pair) => makeKey(pair.channel, pair.currency));
  const duplicates = duplicateEntries(keyCounts);
  const missingAmountRows = dayRows.length - numericRows;
  const status = dayRows.length === 0
    ? "missing"
    : missingExpected.length || duplicates.length || missingAmountRows
      ? "partial"
      : "ok";
  return {
    date,
    total_rows: dayRows.length,
    numeric_rows: numericRows,
    missing_amount_rows: missingAmountRows,
    unique_channel_currency_count: keyCounts.size,
    duplicate_channel_currency_count: duplicates.length,
    expected_rows: expected.length,
    missing_expected_count: missingExpected.length,
    missing_channels: missingExpected,
    duplicates,
    status,
  };
}

function buildChannelCoverage(rows, expected, from, to) {
  const dates = buildDateRange(from, to);
  return expected.map((pair) => {
    const key = makeKey(pair.channel, pair.currency);
    const matching = rows.filter((row) => makeKey(row.channel, row.currency) === key);
    const presentDates = new Set(matching.map((row) => row.date));
    const missingDates = dates.filter((date) => !presentDates.has(date));
    const numericCount = matching.filter((row) => row.amount_numeric).length;
    return {
      channel: pair.channel,
      currency: pair.currency,
      days_present: presentDates.size,
      first_missing_date: missingDates[0] || null,
      last_missing_date: missingDates.at(-1) || null,
      amount_numeric_count: numericCount,
      status: presentDates.size === dates.length && numericCount >= dates.length ? "ok" : presentDates.size ? "partial" : "missing",
    };
  }).sort((left, right) => left.channel === right.channel ? left.currency.localeCompare(right.currency) : left.channel.localeCompare(right.channel));
}

function compareKeyDates({ leftDate, rightDate, leftRows, rightRows }) {
  const leftCounts = countKeys(leftRows);
  const rightCounts = countKeys(rightRows);
  const leftKeys = new Set(leftCounts.keys());
  const rightKeys = new Set(rightCounts.keys());
  const rightOnly = Array.from(rightKeys).filter((key) => !leftKeys.has(key)).sort();
  const leftOnly = Array.from(leftKeys).filter((key) => !rightKeys.has(key)).sort();
  const leftMissingAmount = leftRows.filter((row) => !row.amount_numeric).map((row) => makeKey(row.channel, row.currency)).sort();
  const rightMissingAmount = rightRows.filter((row) => !row.amount_numeric).map((row) => makeKey(row.channel, row.currency)).sort();
  const rightDuplicates = duplicateEntries(rightCounts);
  const explanations = [];
  if (rightOnly.length) explanations.push(`${rightOnly.length} channel+currency pair(s) are present on ${rightDate} but missing on ${leftDate}.`);
  if (leftOnly.length) explanations.push(`${leftOnly.length} channel+currency pair(s) are present on ${leftDate} but missing on ${rightDate}.`);
  if (rightDuplicates.length) explanations.push(`${rightDuplicates.length} duplicate channel+currency pair(s) inflate the ${rightDate} raw row count.`);
  return {
    left: summarizeRowsForDate(leftDate, leftRows),
    right: summarizeRowsForDate(rightDate, rightRows),
    present_on_right_missing_on_left: rightOnly,
    present_on_left_missing_on_right: leftOnly,
    missing_or_non_numeric_amount: {
      [leftDate]: leftMissingAmount,
      [rightDate]: rightMissingAmount,
    },
    duplicates: {
      [leftDate]: duplicateEntries(leftCounts),
      [rightDate]: rightDuplicates,
      left: duplicateEntries(leftCounts),
      right: rightDuplicates,
    },
    explanation: explanations.join(" ") || "Raw row counts differ only by row multiplicity/order.",
  };
}

function summarizeRowsForDate(date, rows) {
  const counts = countKeys(rows);
  return {
    date,
    total_rows: rows.length,
    numeric_rows: rows.filter((row) => row.amount_numeric).length,
    unique_channel_currency_count: counts.size,
    duplicate_channel_currency_count: duplicateEntries(counts).length,
    channels: Array.from(counts.keys()).sort(),
  };
}

function buildSourceDiagnostics({ balanceSnapshots = {}, auditSnapshot = {} }) {
  const snapshots = balanceSnapshots?.balance_snapshots || {};
  const auditBalances = auditSnapshot?.balances || {};
  const balanceCoverage = auditSnapshot?.balance_coverage || {};
  return {
    saved_balance_snapshots: {
      manual_rows: snapshots.manual_rows?.length ?? snapshots.rows?.length ?? 0,
      auto_rows: snapshots.auto_rows?.length ?? 0,
      merged_rows: snapshots.merged_rows?.length ?? snapshots.selected_rows?.length ?? 0,
      selected_date_rows: snapshots.selected_date_rows?.length ?? 0,
      selected_date_source: snapshots.selected_date_source || "unknown",
      diagnostics: snapshots.diagnostics || {},
    },
    audit_balance_coverage: {
      status: auditSnapshot?.audit_checks?.find?.((check) => check.name === "balance_coverage")?.status || "",
      summary: balanceCoverage.summary || {},
      actionable_rows: balanceCoverage.actionable_rows?.length || 0,
    },
    reconciliation_planned_table: {
      needs_verification_rows: Array.isArray(auditBalances.needs_verification_rows) ? auditBalances.needs_verification_rows.length : 0,
      source: "audit-snapshot balances.needs_verification_rows",
    },
    provider_opening_balance_diagnostics: Array.isArray(auditBalances.needs_verification_rows)
      ? auditBalances.needs_verification_rows.map((row) => ({
        channel: row.channel,
        currency: row.currency,
        reason: row.reason || row.adjustment_reason || row.status || "needs_verification",
        source: row.source || "audit-snapshot",
      })).slice(0, 50)
      : [],
  };
}

function normalizeRow(row = {}) {
  const amount = parseNumber(row.amount ?? row.balance ?? row.amount_usd ?? row.balance_usd ?? row.closing_amount_usd);
  return {
    ...row,
    date: normalizeDate(row.date),
    channel: String(row.channel || row.accountName || row.account || "").trim(),
    currency: String(row.currency || "").trim().toUpperCase(),
    amount,
    amount_numeric: amount !== null,
  };
}

function uniquePairs(rows = []) {
  const pairs = new Map();
  for (const row of rows || []) {
    const channel = String(row.channel || "").trim();
    const currency = String(row.currency || "").trim().toUpperCase();
    if (!channel || !currency) continue;
    pairs.set(makeKey(channel, currency), { channel, currency });
  }
  return Array.from(pairs.values()).sort((left, right) =>
    left.channel === right.channel ? left.currency.localeCompare(right.currency) : left.channel.localeCompare(right.channel)
  );
}

function countKeys(rows = []) {
  const counts = new Map();
  for (const row of rows || []) {
    const key = makeKey(row.channel, row.currency);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function duplicateEntries(counts) {
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function buildDateRange(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(",", ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function makeKey(channel, currency) {
  return `${String(channel || "").trim()}|${String(currency || "").trim().toUpperCase()}`;
}

function printAudit(result) {
  console.log(`Deploy: ${result.current_deploy.gitRepoSlug}@${result.current_deploy.commitSha} (${result.current_deploy.commitRef})`);
  console.log("\nEndpoint checks:");
  for (const entry of result.endpoint_logs || []) {
    console.log(`${entry.method} ${entry.url} -> ${entry.status} ${entry.content_type}; JSON ${entry.json_parse_result}`);
    console.log(`  first300: ${entry.first_300_chars_body.replace(/\n/g, "\\n")}`);
  }
  console.log("\nMay coverage:");
  console.table(result.date_coverage.map((row) => ({
    date: row.date,
    rows: row.total_rows,
    numeric: row.numeric_rows,
    expected: row.expected_rows,
    missing: row.missing_expected_count,
    duplicates: row.duplicate_channel_currency_count,
    status: row.status,
  })));
  console.log("\n2026-05-20 vs 2026-05-26:");
  console.log(JSON.stringify(result.key_date_comparison, null, 2));
  console.log("\nUI source check:");
  console.log(JSON.stringify(result.ui_source_check, null, 2));
}

function isCliEntrypoint() {
  return import.meta.url === `file://${process.argv[1]}`;
}
