#!/usr/bin/env node
import { inspect } from "node:util";

import { loadAutoBalanceRowsFromGoogleSheets } from "../server/auto-balance-repository.js";
import { EXPECTED_PROVIDER_BALANCES, filterExpectedProviderBalancesForDate, saveAutoBalanceSnapshotRows } from "../server/auto-balance-snapshots.js";
import { mergeManualAndAutoBalances } from "../server/balance-snapshot-merge.js";
import { buildDailyCalculatedBalances } from "../server/daily-calculated-balances.js";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import { applyOwnerMayOpeningBalanceSeed } from "../server/may-2026-owner-opening-balances.js";

const TARGET_SHEET = "Авто Остатки";
const DERIVED_SOURCE = "derived_from_confirmed_balance";

if (isCliEntrypoint()) {
  await main();
}

export function parseArgs(argv = []) {
  const options = { from: "", to: "", apply: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--from") options.from = normalizeDate(argv[++index]);
    else if (arg.startsWith("--from=")) options.from = normalizeDate(arg.slice("--from=".length));
    else if (arg === "--to") options.to = normalizeDate(argv[++index]);
    else if (arg.startsWith("--to=")) options.to = normalizeDate(arg.slice("--to=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.from) throw new Error("--from must be YYYY-MM-DD.");
  if (!options.help && !options.to) throw new Error("--to must be YYYY-MM-DD.");
  if (options.from && options.to && options.from > options.to) throw new Error("--from cannot be later than --to.");
  return options;
}

export async function buildBackfillDailyBalanceSnapshotsReport(options = {}) {
  const from = normalizeDate(options.from);
  const to = normalizeDate(options.to);
  if (!from || !to) throw new Error("from and to must be YYYY-MM-DD.");
  const now = options.now || new Date();
  const timestamp = normalizeTimestamp(now);
  const repositoryLoader = options.repositoryLoader || loadManualRepositoryFromGoogleSheets;
  const autoBalanceLoader = options.autoBalanceLoader || loadAutoBalanceRowsFromGoogleSheets;
  const saveRows = options.saveRows || saveAutoBalanceSnapshotRows;

  const repository = await repositoryLoader();
  if (!repository?.ok) {
    return {
      ok: false,
      dryRun: !options.apply,
      target_sheet: TARGET_SHEET,
      period: { from, to },
      error: repository?.warning || "Manual repository unavailable.",
    };
  }

  const autoBalances = Array.isArray(repository.autoBalances)
    ? { ok: true, balances: repository.autoBalances, warnings: [] }
    : await autoBalanceLoader();
  const manualBalances = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalanceRows = Array.isArray(autoBalances?.balances) ? autoBalances.balances : [];
  const merged = mergeManualAndAutoBalances(manualBalances, autoBalanceRows);
  const operations = Array.isArray(repository.operations) ? repository.operations : [];
  const ownerMayOpeningSeed = applyOwnerMayOpeningBalanceSeed(merged.rows || merged.merged || [], {
    operations,
    period: { from, to },
    force: from <= "2026-05-01" && to >= "2026-05-01",
  });
  const balanceRows = ownerMayOpeningSeed.rows;
  const calculated = buildDailyCalculatedBalances({
    operations,
    balanceRows,
    activePairs: filterExpectedProviderBalancesForDate(EXPECTED_PROVIDER_BALANCES, to),
    period: { from, to },
    now,
  });
  const plannedRows = calculated.rows
    .filter((row) => row.status === "calculated_from_previous")
    .map((row) => toAutoBalanceBackfillRow(row, timestamp));
  const missingAnchors = buildMissingAnchorRows({ operations, balanceRows, from, to });

  let save = { rowCount: 0, skipped: options.apply ? "no_rows" : "dry_run" };
  if (options.apply && plannedRows.length) {
    save = await saveRows(plannedRows);
  }

  return {
    ok: true,
    dryRun: !options.apply,
    target_sheet: TARGET_SHEET,
    period: { from, to },
    planned_rows: plannedRows,
    planned_rows_count: plannedRows.length,
    missing_anchors: missingAnchors,
    missing_anchors_count: missingAnchors.length,
    blocked_rows: calculated.rows.filter((row) => row.status !== "calculated_from_previous"),
    calculated_summary: calculated.summary,
    merge_summary: {
      auto_used: merged.autoUsed || merged.auto_balance_rows_used_as_fallback || 0,
      auto_ignored_due_to_manual: merged.autoIgnored || merged.auto_balance_rows_ignored_due_to_manual || 0,
      stale_current_only_auto_rows: merged.autoIgnoredStaleCurrent || merged.auto_balance_rows_ignored_as_stale_current || 0,
      owner_confirmed_may_opening_balance_seed_applied: ownerMayOpeningSeed.applied,
      owner_confirmed_may_opening_total_usd: ownerMayOpeningSeed.applied ? ownerMayOpeningSeed.owner_total_usd : null,
      owner_input_opening_total_usd: ownerMayOpeningSeed.reconciliation_adjusted_opening?.owner_input_opening_total_usd ?? null,
      reconciliation_adjusted_opening_total_usd: ownerMayOpeningSeed.reconciliation_adjusted_opening?.reconciliation_adjusted_opening_total_usd ?? null,
      diff_from_owner_input_total_usd: ownerMayOpeningSeed.reconciliation_adjusted_opening?.diff_from_owner_input_total_usd ?? null,
      reconciliation_adjusted_opening: ownerMayOpeningSeed.reconciliation_adjusted_opening,
    },
    save,
    warnings: [
      ...ownerMayOpeningSeed.warnings,
      ...(repository.warnings || []),
      ...(autoBalances.warnings || []),
      ...(calculated.warnings || []),
      ...(options.apply ? [] : ["dry-run only; pass --apply to write derived rows to Авто Остатки"]),
    ],
  };
}

function toAutoBalanceBackfillRow(row, timestamp) {
  return {
    date: row.date,
    provider: "derived",
    channel: row.channel,
    amount: row.calculated_eod,
    currency: row.currency,
    source: DERIVED_SOURCE,
    fetchedAt: timestamp,
    rawSourceId: `${DERIVED_SOURCE}:${row.date}:${row.channel}:${row.currency}`,
    status: DERIVED_SOURCE,
    comment: `Derived from confirmed ${row.anchor_source || "balance"} balance on ${row.anchor_date || "anchor"} plus Ledger amount_net movements.`,
  };
}

function buildMissingAnchorRows({ operations = [], balanceRows = [], from, to }) {
  const pairs = new Map();
  for (const operation of operations || []) {
    const date = normalizeDate(operation?.date || operation?.ledgerV2?.date);
    if (!date || date < from || date > to) continue;
    const currency = String(operation?.ledgerV2?.currency || operation?.currency || "").trim().toUpperCase();
    const balanceAmount = parseNumber(operation?.ledgerV2?.balance_amount ?? operation?.balanceAmount);
    const channel = getMovementChannel(operation, balanceAmount === null ? 1 : balanceAmount);
    if (channel && currency) pairs.set(makeKey(channel, currency), { channel, currency });
  }

  const anchors = new Set();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    if (!date || date > to) continue;
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    if (channel && currency && amount !== null) anchors.add(makeKey(channel, currency));
  }

  return Array.from(pairs.values())
    .filter((pair) => !anchors.has(makeKey(pair.channel, pair.currency)))
    .sort((left, right) => left.channel === right.channel ? left.currency.localeCompare(right.currency) : left.channel.localeCompare(right.channel))
    .map((pair) => ({ ...pair, status: "needs_opening_balance" }));
}

function getMovementChannel(operation, balanceAmount) {
  const ledger = operation?.ledgerV2 || {};
  const from = String(ledger.from_channel || operation?.fromChannel || operation?.from_channel || "").trim();
  const to = String(ledger.to_channel || operation?.toChannel || operation?.to_channel || "").trim();
  const fallback = String(operation?.channel || operation?.accountName || operation?.account || "").trim();
  if (Number(balanceAmount) < 0) return from || fallback || to;
  return to || fallback || from;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await buildBackfillDailyBalanceSnapshotsReport(options);
  if (!report.ok) process.exitCode = 1;
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(inspect(report, { depth: 6, colors: false, maxArrayLength: 80 }));
}

function printHelp() {
  console.log(`Usage: node scripts/backfill-daily-balance-snapshots.mjs --from YYYY-MM-DD --to YYYY-MM-DD [--json] [--apply]

Default is dry-run. Only --apply writes derived rows to Авто Остатки.`);
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function makeKey(channel, currency) {
  return `${String(channel || "").trim()}|${String(currency || "").trim().toUpperCase()}`;
}

function isCliEntrypoint() {
  return import.meta.url === `file://${process.argv[1]}`;
}
