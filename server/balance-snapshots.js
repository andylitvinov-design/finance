import fs from "node:fs";
import path from "node:path";

import { loadAutoBalanceRowsFromGoogleSheets } from "./auto-balance-repository.js";
import {
  EXPECTED_PROVIDER_BALANCES,
  buildExpectedProviderBalanceExclusionsForDate,
  filterExpectedProviderBalancesForDate,
  getProviderCurrentBalanceCapabilities,
} from "./auto-balance-snapshots.js";
import { mergeManualAndAutoBalances } from "./balance-snapshot-merge.js";
import {
  buildDailyCalculatedBalances,
  toCalculatedBalanceSnapshotRows,
} from "./daily-calculated-balances.js";
import { buildCanonicalBalanceTotal } from "./canonical-balance-total.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { applyOwnerMayCurrentBalanceSnapshot } from "./may-2026-owner-current-balances.js";
import { applyOwnerMayOpeningBalanceSeed } from "./may-2026-owner-opening-balances.js";
import { buildPeriodBalanceReconciliation } from "./period-balance-reconciliation-engine.js";
import { buildProviderBalanceMatrix } from "./provider-balance-matrix.js";

const PROJECT_NAME = "ezohata-incoming-ledger";
const BALANCE_SHEET_NAME = "Остатки";
const FACT_SHEET_NAME = "Факт";
const FACT_BALANCE_WARNING = "Остатки внесены во вкладку Факт, но сверка использует вкладку Остатки.";
const BALANCE_TARGET_COLUMNS = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"];
const PROVIDERS_WITH_TRANSACTION_IMPORT = new Set(["wise", "monobank", "paypal", "privatbank", "yoomoney", "binance"]);
const PROVIDERS_WITH_CURRENT_BALANCE_REFRESH = new Set(["wise", "monobank", "paypal", "yoomoney", "binance"]);

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: request.query || {},
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
    autoBalanceLoader: loadAutoBalanceRowsFromGoogleSheets,
  });
  return response.status(200).json(snapshot);
}

export async function buildBalanceSnapshotsSnapshot(options = {}) {
  const query = options.query || {};
  const generatedAt = new Date().toISOString();
  const periodFilter = parsePeriodFilter(query);
  const warnings = [];
  const auditChecks = [];
  const repository = await loadRepository(options.repositoryLoader);
  const autoBalances = Array.isArray(repository?.autoBalances)
    ? { ok: true, balances: repository.autoBalances, warnings: [] }
    : (options.autoBalanceLoader
      ? await loadAutoBalances(options.autoBalanceLoader)
      : { ok: true, balances: [], warnings: [] });

  if (!repository.ok) {
    warnings.push("needs verification: manual Google Sheets read access is unavailable.");
    if (repository.warning) warnings.push(toSafeWarning(repository.warning));
    warnings.push(...(autoBalances.warnings || []).map(toSafeWarning).filter(Boolean));
    auditChecks.push({
      name: "manual_google_sheets_access",
      status: "needs verification",
      message: "Balance snapshots inventory could not read live Google Sheets data.",
    });
    return emptySnapshot({ generatedAt, period: periodFilter.period, warnings, auditChecks });
  }

  const manualBalances = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalanceRows = Array.isArray(autoBalances.balances) ? autoBalances.balances : [];
  const balanceSnapshotMerge = mergeManualAndAutoBalances(manualBalances, autoBalanceRows);
  const ownerMayOpeningSeed = applyOwnerMayOpeningBalanceSeed(balanceSnapshotMerge.rows || balanceSnapshotMerge.merged || []);
  const ownerMayCurrentSnapshot = applyOwnerMayCurrentBalanceSnapshot(ownerMayOpeningSeed.rows, {
    period: periodFilter.period,
  });
  const balanceSnapshots = buildBalanceSnapshotsSummary(manualBalances, periodFilter, {
    ...repository,
    autoBalances: autoBalanceRows,
    mergedBalances: ownerMayCurrentSnapshot.rows,
    balanceSnapshotMerge,
  });
  auditChecks.push(
    {
      name: "manual_google_sheets_access",
      status: "ok",
      message: "Balance snapshots inventory read Google Sheets repository data.",
    },
    {
      name: "balance_snapshots_inventory",
      status: balanceSnapshots.valid_rows && !balanceSnapshots.incomplete_rows ? "ok" : "needs verification",
      message: balanceSnapshots.valid_rows
        ? `Остатки inventory: ${balanceSnapshots.valid_rows}/${balanceSnapshots.total_rows} valid row(s), ${balanceSnapshots.dates.length} date(s), ${balanceSnapshots.by_channel_currency.length} account-currency pair(s).`
        : "No valid Остатки rows found for the selected period.",
    }
  );

  if (balanceSnapshots.incomplete_rows) {
    warnings.push(`needs verification: ${balanceSnapshots.incomplete_rows} Остатки row(s) are incomplete.`);
  }
  if (balanceSnapshots.fact_balance_rows?.some((row) => row.status === "missing_in_ostatki")) {
    warnings.push(FACT_BALANCE_WARNING);
  }

  return {
    ok: true,
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period: resolvePeriod(periodFilter, balanceSnapshots.dates),
    balance_snapshots: balanceSnapshots,
    provider_current_balance_status: getProviderCurrentBalanceCapabilities(),
    warnings: unique([
      ...(repository.warnings || []).map(toSafeWarning),
      ...(autoBalances.warnings || []).map(toSafeWarning),
      ...ownerMayOpeningSeed.warnings,
      ...ownerMayCurrentSnapshot.warnings,
      ...warnings,
    ]),
    audit_checks: auditChecks,
  };
}

async function loadRepository(repositoryLoader = loadManualRepositoryFromGoogleSheets) {
  try {
    return await repositoryLoader();
  } catch (error) {
    return {
      ok: false,
      warning: `Manual Google Sheets overlay failed: ${String(error?.message || error)}`,
    };
  }
}

async function loadAutoBalances(autoBalanceLoader = loadAutoBalanceRowsFromGoogleSheets) {
  try {
    return await autoBalanceLoader();
  } catch (error) {
    return {
      ok: false,
      balances: [],
      warnings: [`Auto balance sheet failed: ${String(error?.message || error)}`],
    };
  }
}

function emptySnapshot({ generatedAt, period, warnings, auditChecks }) {
  return {
    ok: true,
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period,
    balance_snapshots: emptyBalanceSnapshotsSummary(),
    warnings: unique(warnings),
    audit_checks: auditChecks,
  };
}

export function buildBalanceSnapshotsSummary(balanceRows = [], periodFilter = {}, repository = {}) {
  const normalizedRows = (balanceRows || []).map(normalizeBalanceSnapshotRow);
  const normalizedAutoRows = (repository.autoBalances || []).map(normalizeBalanceSnapshotRow);
  const staleCurrentOnlyAutoRows = (repository.autoBalances || [])
    .filter((row) => isBalanceRowInPeriod(normalizeBalanceSnapshotRow(row), periodFilter))
    .filter(isStaleCurrentOnlyAutoSnapshot);
  const mergedSourceRows = Array.isArray(repository.mergedBalances)
    ? repository.mergedBalances
    : mergeManualAndAutoBalances(balanceRows || [], repository.autoBalances || []).rows;
  const preOwnerMergedSourceRows = Array.isArray(repository.balanceSnapshotMerge?.rows)
    ? repository.balanceSnapshotMerge.rows
    : mergedSourceRows;
  const normalizedMergedRows = (mergedSourceRows || []).map(normalizeBalanceSnapshotRow);
  const filteredRows = normalizedRows.filter((row) => isBalanceRowInPeriod(row, periodFilter));
  const filteredAutoRows = normalizedAutoRows.filter((row) => isBalanceRowInPeriod(row, periodFilter));
  const filteredMergedRows = normalizedMergedRows.filter((row) => isBalanceRowInPeriod(row, periodFilter));
  const validRows = filteredRows.filter((row) => row.valid);
  const validAutoRows = filteredAutoRows.filter((row) => row.valid);
  const validMergedRows = filteredMergedRows.filter((row) => row.valid);
  const invalidRows = filteredRows.filter((row) => !row.valid);
  const dates = unique(validRows.map((row) => row.date)).sort();
  const autoDates = unique(validAutoRows.map((row) => row.date)).sort();
  const mergedDates = unique(validMergedRows.map((row) => row.date)).sort();
  const targetDate = resolveInputTargetDate(periodFilter, validRows);
  const selectedDate = resolveSelectedDate(periodFilter, validMergedRows, validAutoRows, validRows);
  const selectedCanonicalUsdLookup = buildSelectedCanonicalUsdLookup({
    selectedDate,
    periodFilter,
    rows: validMergedRows,
    sourceRows: preOwnerMergedSourceRows,
    repository,
  });
  const selectedDateSummary = buildSelectedDateSummary({
    selectedDate,
    validMergedRows,
    validAutoRows,
    validRows,
    staleCurrentOnlyAutoRows,
    canonicalUsdLookup: selectedCanonicalUsdLookup,
  });
  const selectedDateCoverage = buildSelectedDateCoverage(selectedDateSummary.rows, EXPECTED_PROVIDER_BALANCES, selectedDateSummary.selected_date);
  const selectedTotalUsd = sumSelectedDateUsd(selectedDateSummary.rows);
  const canonicalTotal = buildCanonicalBalanceTotal({
    selectedDateTotalUsd: selectedTotalUsd,
    selectedDateStatus: selectedDateCoverage.status,
  });
  const factBalanceRows = buildFactBalanceRows(repository, periodFilter, normalizedRows.filter((row) => row.valid));

  return {
    total_rows: filteredRows.length,
    valid_rows: validRows.length,
    incomplete_rows: invalidRows.length,
    diagnostics: {
      fact_balance_rows_detected: factBalanceRows.length,
      fact_balance_rows_saved_to_ostatki: factBalanceRows.filter((row) => row.status === "matched_ostatki").length,
      balance_snapshot_rows_loaded: validRows.length,
      manual_balance_snapshot_rows_loaded: validRows.length,
      auto_balance_snapshot_rows_loaded: validAutoRows.length,
      merged_balance_snapshot_rows_loaded: validMergedRows.length,
      manual_balance_dates: dates,
      auto_balance_dates: autoDates,
      merged_balance_dates: mergedDates,
      selected_balance_dates: selectedDateSummary.rows.length ? [selectedDateSummary.selected_date] : [],
      missing_daily_coverage_dates: buildMissingDailyCoverageDates(periodFilter, mergedDates),
      stale_current_only_auto_rows: staleCurrentOnlyAutoRows.length,
      skipped_non_balance_fact_rows: countSkippedNonBalanceFactRows(repository, periodFilter),
      inserted: 0,
      updated: 0,
      skipped: 0,
    },
    dates,
    rows: buildDetailedRows(validRows),
    manual_rows: buildDetailedRows(validRows),
    auto_rows: buildDetailedRows(validAutoRows),
    confirmed_rows: buildTypedBalanceRows(validRows, "confirmed"),
    auto_balance_rows: buildTypedBalanceRows(validAutoRows, "auto"),
    merged_rows: buildDetailedRows(validMergedRows),
    selected_rows: buildSelectedRows(selectedDateSummary.rows),
    selected_date: selectedDateSummary.selected_date,
    total_usd: selectedTotalUsd,
    canonical_total_usd: canonicalTotal.canonical_total_usd,
    canonical_total: canonicalTotal,
    selected_date_rows: buildDetailedRows(selectedDateSummary.rows),
    selected_date_coverage: selectedDateCoverage,
    provider_channel_matrix: buildProviderChannelMatrix({
      selectedDate: selectedDateSummary.selected_date,
      selectedRows: selectedDateSummary.rows,
      allRows: validMergedRows,
      operations: repository.operations || [],
      providerStatuses: getProviderCurrentBalanceCapabilities(),
    }),
    selected_date_source: selectedDateSummary.source,
    selected_date_diagnostics: selectedDateSummary.diagnostics,
    fact_balance_rows: factBalanceRows,
    input_rows: buildInputRows({
      targetDate,
      balanceRows: normalizedRows.filter((row) => row.valid),
      operations: repository.operations || [],
    }),
    by_date: buildByDate(validMergedRows, { manualRows: validRows, autoRows: validAutoRows, mergedRows: validMergedRows }),
    by_channel_currency: buildByChannelCurrency(validMergedRows),
    auto_dates: autoDates,
    merged_dates: mergedDates,
    missing_date_rows: invalidRows.filter((row) => row.missing.date).length,
    missing_channel_rows: invalidRows.filter((row) => row.missing.channel).length,
    missing_currency_rows: invalidRows.filter((row) => row.missing.currency).length,
    missing_amount_rows: invalidRows.filter((row) => row.missing.amount).length,
    incomplete_preview: invalidRows.slice(0, 10).map((row) => ({
      date: row.date || null,
      channel: row.channel || null,
      currency: row.currency || null,
      reason: row.reason,
    })),
  };
}

function emptyBalanceSnapshotsSummary() {
  return {
    total_rows: 0,
    valid_rows: 0,
    incomplete_rows: 0,
    dates: [],
    rows: [],
    manual_rows: [],
    auto_rows: [],
    confirmed_rows: [],
    auto_balance_rows: [],
    merged_rows: [],
    selected_rows: [],
    selected_date: "",
    selected_date_rows: [],
    selected_date_coverage: buildSelectedDateCoverage([], EXPECTED_PROVIDER_BALANCES),
    provider_channel_matrix: [],
    selected_date_source: "none",
    selected_date_diagnostics: [],
    input_rows: [],
    by_date: [],
    by_channel_currency: [],
    missing_date_rows: 0,
    missing_channel_rows: 0,
    missing_currency_rows: 0,
    missing_amount_rows: 0,
    incomplete_preview: [],
    fact_balance_rows: [],
    diagnostics: {
      fact_balance_rows_detected: 0,
      fact_balance_rows_saved_to_ostatki: 0,
      balance_snapshot_rows_loaded: 0,
      manual_balance_snapshot_rows_loaded: 0,
      auto_balance_snapshot_rows_loaded: 0,
      merged_balance_snapshot_rows_loaded: 0,
      manual_balance_dates: [],
      auto_balance_dates: [],
      merged_balance_dates: [],
      selected_balance_dates: [],
      missing_daily_coverage_dates: [],
      stale_current_only_auto_rows: 0,
      skipped_non_balance_fact_rows: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
    },
  };
}

function buildInputRows({ targetDate, balanceRows = [], operations = [] } = {}) {
  if (!targetDate) return [];
  const activePairs = new Map();
  for (const channel of loadConfiguredChannels()) {
    const currency = inferCurrencyFromChannel(channel);
    if (currency) addActivePair(activePairs, { channel, currency });
  }
  for (const row of balanceRows || []) {
    addActivePair(activePairs, row);
  }
  for (const operation of operations || []) {
    for (const pair of getOperationChannelCurrencyPairs(operation)) {
      addActivePair(activePairs, pair);
    }
  }

  const existingByKey = new Map();
  for (const row of balanceRows || []) {
    if (row.date === targetDate) existingByKey.set(makeKey(row.channel, row.currency), row);
  }

  return Array.from(activePairs.values())
    .sort(compareChannelCurrency)
    .map((pair) => {
      const existing = existingByKey.get(makeKey(pair.channel, pair.currency));
      const existingAmount = existing ? existing.amount : null;
      return {
        date: targetDate,
        channel: pair.channel,
        currency: pair.currency,
        sheet: BALANCE_SHEET_NAME,
        amount_required: true,
        target_columns: BALANCE_TARGET_COLUMNS,
        existing_amount: existingAmount,
        amount: existingAmount,
        needs_input: existingAmount === null,
        source: existingAmount === null ? "active_channel_missing_balance" : "existing_balance",
        status: existingAmount === null ? "needs_input" : "already_entered",
      };
    });
}

function buildFactBalanceRows(repository = {}, periodFilter = {}, balanceRows = []) {
  const rows = [];
  for (const row of repository.legacyExpenseRows || []) {
    if (normalizeFactCategory(row?.category) !== "now") continue;
    const date = normalizeDate(row?.date);
    if (!date || !isDateInPeriod(date, periodFilter)) continue;
    for (const [channel, rawAmount] of Object.entries(row.amounts || {})) {
      const amount = parseNumber(rawAmount);
      if (!String(channel || "").trim() || amount === null) continue;
      const currency = inferCurrencyFromChannel(channel);
      if (!currency) continue;
      const exists = balanceRows.some((balance) =>
        balance.date === date
        && makeKey(balance.channel, balance.currency) === makeKey(channel, currency)
      );
      rows.push({
        date,
        channel,
        currency,
        amount,
        sheet: FACT_SHEET_NAME,
        expected_sheet: BALANCE_SHEET_NAME,
        status: exists ? "matched_ostatki" : "missing_in_ostatki",
      });
    }
  }
  return rows.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
    return left.currency.localeCompare(right.currency);
  });
}

function normalizeFactCategory(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function countSkippedNonBalanceFactRows(repository = {}, periodFilter = {}) {
  let skipped = 0;
  for (const row of repository.legacyExpenseRows || []) {
    const date = normalizeDate(row?.date);
    if (date && !isDateInPeriod(date, periodFilter)) continue;
    if (normalizeFactCategory(row?.category) !== "now") skipped += 1;
  }
  return skipped;
}

function getOperationChannelCurrencyPairs(operation) {
  const ledger = operation?.ledgerV2 || {};
  const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
  if (!currency) return [];
  const operationName = String(ledger.operation || operation?.operation || "").trim().toLowerCase();
  const from = String(ledger.from_channel || operation?.fromChannel || operation?.from_channel || "").trim();
  const to = String(ledger.to_channel || operation?.toChannel || operation?.to_channel || "").trim();
  const fallback = String(operation?.channel || operation?.accountName || operation?.account || "").trim();
  if (operationName === "income") return [{ channel: to || fallback, currency }];
  if (["expense", "business_expense", "personal_expense"].includes(operationName)) return [{ channel: from || fallback, currency }];
  if (operationName === "exchange_in") return [{ channel: to || fallback, currency }];
  if (operationName === "exchange_out") return [{ channel: from || fallback, currency }];
  if (operationName === "transfer" || operationName === "partner_transfer") {
    return [from, to].filter(Boolean).map((channel) => ({ channel, currency }));
  }
  return [fallback || from || to].filter(Boolean).map((channel) => ({ channel, currency }));
}

function addActivePair(map, pair) {
  const channel = String(pair?.channel || "").trim();
  const currency = String(pair?.currency || "").trim().toUpperCase();
  if (!channel || !currency) return;
  const key = makeKey(channel, currency);
  if (!map.has(key)) map.set(key, { channel, currency });
}

function resolveInputTargetDate(periodFilter = {}, rows = []) {
  if (periodFilter.to) return periodFilter.to;
  const dates = unique((rows || []).map((row) => row.date)).sort();
  return dates.at(-1) || "";
}

function resolveSelectedDate(periodFilter = {}, mergedRows = [], autoRows = [], manualRows = []) {
  if (periodFilter.from && periodFilter.to && periodFilter.from === periodFilter.to) return periodFilter.from;
  if (periodFilter.to) return periodFilter.to;
  if (periodFilter.from) return periodFilter.from;
  const dates = unique([
    ...(mergedRows || []).map((row) => row.date),
    ...(autoRows || []).map((row) => row.date),
    ...(manualRows || []).map((row) => row.date),
  ]).sort();
  return dates.at(-1) || "";
}

function buildSelectedDateSummary({
  selectedDate,
  validMergedRows = [],
  validAutoRows = [],
  validRows = [],
  staleCurrentOnlyAutoRows = [],
  canonicalUsdLookup = new Map(),
} = {}) {
  if (!selectedDate) {
    return {
      selected_date: "",
      rows: [],
      source: "none",
      diagnostics: ["No balance snapshot for this date; run guarded May backfill."],
    };
  }
  const selectedRows = hydrateSelectedDateRows(latestKnownRowsForDate(validMergedRows, selectedDate), canonicalUsdLookup);
  if (selectedRows.length) {
    return {
      selected_date: selectedDate,
      rows: selectedRows,
      source: selectedRows.some((row) => row.date < selectedDate) ? "latest_known" : "merged",
      diagnostics: buildSelectedHydrationDiagnostics(selectedRows),
    };
  }
  const staleForDate = (staleCurrentOnlyAutoRows || []).filter((row) => normalizeDate(row.date) === selectedDate);
  const diagnostics = ["No balance snapshot for this date; run guarded May backfill."];
  if (staleForDate.length) {
    diagnostics.push(`Ignored ${staleForDate.length} stale current-only auto row(s) for ${selectedDate}.`);
  }
  return {
    selected_date: selectedDate,
    rows: [],
    source: "none",
    diagnostics,
  };
}

function buildSelectedCanonicalUsdLookup({
  selectedDate,
  periodFilter = {},
  rows = [],
  sourceRows = [],
  repository = {},
} = {}) {
  if (!selectedDate) return new Map();
  const from = periodFilter.from || resolveSelectedCanonicalPeriodStart(rows, selectedDate);
  const period = { from, to: selectedDate };
  const baseRows = Array.isArray(sourceRows) && sourceRows.length ? sourceRows : rows;
  const calculatedBalanceRows = from
    ? toCalculatedBalanceSnapshotRows(buildDailyCalculatedBalances({
      operations: repository.operations || [],
      balanceRows: baseRows,
      period,
    }).rows)
    : [];
  const reconciliation = buildPeriodBalanceReconciliation({
    operations: repository.operations || [],
    balanceRows: baseRows,
    calculatedBalanceRows,
    fxRates: Array.isArray(repository.fxRates) ? repository.fxRates : [],
    plannedRows: Array.isArray(repository.plannedRows) ? repository.plannedRows : [],
    plannedSourceStatus: repository.plannedSourceStatus || "needs_verification",
    period,
  });
  const lookup = new Map();
  for (const row of reconciliation.by_channel_currency || []) {
    const key = makeCanonicalKey(row.channel, row.currency);
    if (!key) continue;
    const confirmedUsd = parseNumber(row.confirmed_end_usd);
    lookup.set(key, {
      confirmed_end_usd: confirmedUsd,
      confirmed_end_native: parseNumber(row.confirmed_end_native),
      status: row.status || "",
    });
  }
  return lookup;
}

function hydrateSelectedDateRows(rows = [], canonicalUsdLookup = new Map()) {
  const aggregateKeys = new Set(canonicalUsdLookup.keys());
  return (rows || [])
    .filter((row) => !isDuplicateBinanceComponentRow(row, aggregateKeys))
    .map((row) => hydrateSelectedDateRow(row, canonicalUsdLookup));
}

function hydrateSelectedDateRow(row = {}, canonicalUsdLookup = new Map()) {
  const key = makeCanonicalKey(row.channel, row.currency);
  const canonical = key ? canonicalUsdLookup.get(key) : null;
  const canonicalUsd = parseNumber(canonical?.confirmed_end_usd);
  const fallbackUsd = canonicalUsd !== null
    ? canonicalUsd
    : resolveStableUsdAmount(row);
  if (fallbackUsd === null) return row;
  return {
    ...row,
    amount_usd: fallbackUsd,
    selected_usd_source: canonicalUsd !== null ? "period_reconciliation_confirmed_end_usd" : "stable_usd_currency",
  };
}

function isDuplicateBinanceComponentRow(row = {}, aggregateKeys = new Set()) {
  const channel = canonicalBalanceChannel(row.channel, row.currency);
  const currency = String(row.currency || "").trim().toUpperCase();
  if (!["USDT", "USDC"].includes(currency)) return false;
  return (channel === "binance save" && aggregateKeys.has(makeKey("binance save", "USD")))
    || (channel === "Бинанс spot" && aggregateKeys.has(makeKey("Бинанс spot", "USD")));
}

function buildSelectedHydrationDiagnostics(rows = []) {
  const diagnostics = [];
  const hydrated = rows.filter((row) => row.selected_usd_source).length;
  const missingUsdRows = rows.filter((row) => parseNumber(row.amount) !== null && parseNumber(row.amount_usd) === null);
  if (hydrated) diagnostics.push(`Hydrated ${hydrated} selected-date USD value(s) from canonical reconciliation or stable USD currency.`);
  if (missingUsdRows.length) diagnostics.push(`needs verification: ${missingUsdRows.length} selected-date row(s) still have native amount without trusted USD equivalent.`);
  return diagnostics;
}

function findEarliestBalanceDate(rows = [], selectedDate = "") {
  const dates = unique((rows || [])
    .map((row) => row.date)
    .filter((date) => date && (!selectedDate || date <= selectedDate)))
    .sort();
  return dates[0] || "";
}

function resolveSelectedCanonicalPeriodStart(rows = [], selectedDate = "") {
  const earliest = findEarliestBalanceDate(rows, selectedDate);
  if (selectedDate >= "2026-06-01" && earliest && earliest <= "2026-05-01") {
    return "2026-05-01";
  }
  return earliest;
}

function latestKnownRowsForDate(rows = [], selectedDate = "") {
  const exactRows = (rows || [])
    .filter((row) => row.valid && row.date === selectedDate && !isRetiredSelectedBalanceRow(row));
  const exactKeys = new Set(exactRows.map((row) => makeCanonicalKey(row.channel, row.currency)).filter(Boolean));
  const latestByKey = new Map();
  for (const row of rows || []) {
    if (!row.valid || !row.date || row.date >= selectedDate) continue;
    if (isRetiredSelectedBalanceRow(row)) continue;
    const key = makeCanonicalKey(row.channel, row.currency);
    if (!key || key === "|") continue;
    if (exactKeys.has(key)) continue;
    const current = latestByKey.get(key);
    if (!current || compareSelectedBalanceRows(row, current) > 0) {
      latestByKey.set(key, row);
    }
  }
  return [...exactRows, ...Array.from(latestByKey.values())].sort(compareDetailedRows);
}

function compareSelectedBalanceRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  return selectedBalancePriority(left) - selectedBalancePriority(right);
}

function selectedBalancePriority(row = {}) {
  const source = normalizeDisplaySource(row);
  if (source === "manual_fact") return 4;
  if (source === "provider_auto") return 3;
  if (source === "derived_balance") return 2;
  return 1;
}

function isRetiredSelectedBalanceRow(row = {}) {
  return normalizeDisplaySource(row) === "derived_balance"
    && canonicalBalanceChannel(row.channel, row.currency) === "";
}

function loadConfiguredChannels() {
  try {
    const configPath = path.join(process.cwd(), "sheet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return Array.isArray(config?.manualFinance?.channels) ? config.manualFinance.channels : [];
  } catch {
    return [];
  }
}

function inferCurrencyFromChannel(channel) {
  const normalized = String(channel || "").toLowerCase();
  if (/\b(cad|сad)\b|канад/.test(normalized)) return "CAD";
  if (/\b(eur|euro)\b|евр|евро/.test(normalized)) return "EUR";
  if (/\b(uah)\b|грн/.test(normalized)) return "UAH";
  if (/\b(rub)\b|руб|яндекс/.test(normalized)) return "RUB";
  if (/\b(usd|usdt|usdc)\b|дол|dol|spot|save|binance|wise/.test(normalized)) return "USD";
  return "";
}

function normalizeBalanceSnapshotRow(row) {
  const date = normalizeDate(row?.date);
  const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
  const currency = String(row?.currency || "").trim().toUpperCase();
  const amount = parseNumber(row?.balanceAmount ?? row?.amount);
  const amountUsd = parseNumber(row?.amount_usd ?? row?.amountUsd ?? row?.usdAmount ?? row?.balance_usd ?? row?.balanceUsd);
  const missing = {
    date: !date,
    channel: !channel,
    currency: !currency,
    amount: amount === null,
  };
  const reason = Object.entries(missing)
    .filter(([, value]) => value)
    .map(([key]) => `missing_${key}`)
    .join(", ");
  return {
    date,
    channel,
    currency,
    amount,
    amount_usd: amountUsd,
    source: row?.source,
    fact_source: row?.fact_source,
    provider: row?.provider,
    comment: row?.comment,
    sourceSheet: row?.sourceSheet,
    status: row?.status,
    fetchedAt: row?.fetchedAt,
    fetched_at: row?.fetched_at,
    valid: !reason,
    missing,
    reason,
  };
}

function isStaleCurrentOnlyAutoSnapshot(row = {}) {
  const rowDate = normalizeDate(row.date);
  const fetchedDate = normalizeDate(String(row.fetchedAt || row.fetched_at || "").slice(0, 10));
  if (!rowDate || !fetchedDate || rowDate === fetchedDate) return false;
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
    row.status,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  return /auto daily provider snapshot|current[- ]?balance|current balance|provider current/.test(text);
}

function buildMissingDailyCoverageDates(periodFilter = {}, dates = []) {
  const from = normalizeDate(periodFilter.from);
  const to = normalizeDate(periodFilter.to);
  if (!from || !to || from > to) return [];
  const existing = new Set(dates || []);
  const missing = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    if (!existing.has(date)) missing.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return missing;
}

function buildDetailedRows(rows) {
  return (rows || [])
    .map((row) => ({
      date: row.date,
      channel: row.channel,
      currency: row.currency,
      amount: row.amount,
      ...(row.amount_usd !== null && row.amount_usd !== undefined ? { amount_usd: row.amount_usd } : {}),
    }))
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
      return left.currency.localeCompare(right.currency);
    });
}

function buildTypedBalanceRows(rows, balanceKind) {
  return (rows || [])
    .map((row) => ({
      date: row.date,
      channel: row.channel,
      currency: row.currency,
      amount: row.amount,
      balance_kind: balanceKind,
      source: normalizeDisplaySource(row),
      source_sheet: row.sourceSheet || (balanceKind === "confirmed" ? BALANCE_SHEET_NAME : "Авто Остатки"),
      status: normalizeDisplayStatus(row, balanceKind),
    }))
    .sort(compareDetailedRows);
}

function buildSelectedRows(rows) {
  return (rows || [])
    .map((row) => {
      const selectedFrom = isConfirmedBalanceRow(row) ? "confirmed" : "auto";
      return {
        date: row.date,
        channel: row.channel,
        currency: row.currency,
        amount: row.amount,
        ...(row.amount_usd !== null && row.amount_usd !== undefined ? { amount_usd: row.amount_usd } : {}),
        balance_kind: "selected",
        source: normalizeDisplaySource(row),
        source_sheet: row.sourceSheet || (selectedFrom === "confirmed" ? BALANCE_SHEET_NAME : "Авто Остатки"),
        status: normalizeDisplayStatus(row, selectedFrom),
        selected_from: selectedFrom,
      };
    })
    .sort(compareDetailedRows);
}

function buildSelectedDateCoverage(rows = [], expectedPairs = [], selectedDate = "") {
  const canonicalExpected = normalizeExpectedPairs(expectedPairs);
  const expected = filterExpectedProviderBalancesForDate(canonicalExpected, selectedDate);
  const excludedExpected = buildExpectedProviderBalanceExclusionsForDate(canonicalExpected, selectedDate);
  const counts = new Map();
  let numericRows = 0;
  for (const row of rows || []) {
    const key = makeKey(row.channel, row.currency);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (parseNumber(row.amount) !== null) numericRows += 1;
  }
  const missingChannels = expected
    .filter((pair) => !counts.has(makeKey(pair.channel, pair.currency)))
    .map((pair) => makeKey(pair.channel, pair.currency));
  const duplicates = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const missingAmountRows = Math.max(0, (rows || []).length - numericRows);
  const status = rows.length === 0
    ? "missing"
    : missingChannels.length || duplicates.length || missingAmountRows
      ? "partial"
      : "ok";
  return {
    expected_rows: expected.length,
    total_rows: rows.length,
    numeric_rows: numericRows,
    missing_amount_rows: missingAmountRows,
    unique_channel_currency_count: counts.size,
    duplicate_channel_currency_count: duplicates.length,
    duplicates,
    canonical_expected_rows: canonicalExpected.length,
    excluded_expected: excludedExpected,
    missing_channels: missingChannels,
    status,
  };
}

function buildProviderChannelMatrix({
  selectedDate = "",
  selectedRows = [],
  allRows = [],
  operations = [],
  providerStatuses = [],
} = {}) {
  return buildProviderBalanceMatrix({
    selectedDate,
    expectedProviderBalances: filterExpectedProviderBalancesForDate(EXPECTED_PROVIDER_BALANCES, selectedDate),
    selectedRows,
    allRows,
    operations,
    providerStatuses,
  });
}

function sumSelectedDateUsd(rows = []) {
  let total = 0;
  let finiteRows = 0;
  for (const row of rows || []) {
    const value = parseNumber(row?.amount_usd ?? row?.usdAmount);
    if (value === null) continue;
    total += value;
    finiteRows += 1;
  }
  return finiteRows ? round(total) : null;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function buildLastOperationDateByKey(operations = [], selectedDate = "") {
  const map = new Map();
  for (const operation of operations || []) {
    const date = normalizeDate(operation?.date || operation?.ledgerV2?.date);
    if (!date || (selectedDate && date > selectedDate)) continue;
    for (const pair of getOperationChannelCurrencyPairs(operation)) {
      const key = makeKey(pair.channel, pair.currency);
      if (!map.has(key) || date > map.get(key)) map.set(key, date);
    }
  }
  return map;
}

function buildLastBalanceRowByKey(rows = [], selectedDate = "") {
  const map = new Map();
  for (const row of rows || []) {
    if (!row.valid || !row.date || (selectedDate && row.date > selectedDate)) continue;
    const key = makeKey(row.channel, row.currency);
    const current = map.get(key);
    if (!current || compareSelectedBalanceRows(row, current) > 0) map.set(key, row);
  }
  return map;
}

function classifyBalanceSnapshotSource(row = {}) {
  if (!row) return "missing";
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
    row.status,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/manual|screenshot|owner|confirmed|остатки/.test(text) || normalizeDisplaySource(row) === "manual_fact") {
    return "manual/screenshot";
  }
  if (/provider|auto|wise|paypal|binance|monobank|privat|yoomoney/.test(text) || normalizeDisplaySource(row) === "provider_auto") {
    return "provider";
  }
  return "unknown";
}

function buildProviderMatrixActionRequired({
  supportsCurrentBalance,
  supportsTransactionImport,
  source,
  lastBalanceDate,
  selectedDate,
} = {}) {
  const actions = [];
  if (!supportsCurrentBalance) actions.push("upload screenshot");
  if (supportsCurrentBalance && selectedDate && (!lastBalanceDate || lastBalanceDate < selectedDate)) actions.push("refresh token");
  if (source !== "provider" || !lastBalanceDate || (selectedDate && lastBalanceDate < selectedDate)) actions.push("manual balance needed");
  if (supportsTransactionImport && selectedDate) actions.push("verify latest imported operations");
  return unique(actions).join(" / ") || "none";
}

function compareProviderMatrixRows(left, right) {
  if (left.provider !== right.provider) return left.provider.localeCompare(right.provider);
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function normalizeExpectedPairs(rows = []) {
  const pairs = new Map();
  for (const row of rows || []) {
    const channel = String(row?.channel || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    if (!channel || !currency) continue;
    pairs.set(makeKey(channel, currency), { ...row, channel, currency });
  }
  return Array.from(pairs.values()).sort(compareChannelCurrency);
}

function compareDetailedRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function isConfirmedBalanceRow(row = {}) {
  return normalizeDisplaySource(row) === "manual_fact" || String(row.sourceSheet || "") === BALANCE_SHEET_NAME;
}

function normalizeDisplaySource(row = {}) {
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
    row.status,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/derived_from_confirmed_balance|paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed/.test(text)) {
    return "derived_balance";
  }
  if (/manual[_ -]owner[_ -]confirmed|owner[_ -]confirmed|manual_fact|manual confirmed|manual balance|manual_confirmed_balance|paypal_manual_balance|paypal_manual_confirmed_balance/.test(text)) {
    return "manual_fact";
  }
  if (/provider_auto|auto snapshot|provider|wise|paypal|binance|monobank|privat|yoomoney|revolut|payoneer/.test(text)) {
    return "provider_auto";
  }
  return isConfirmedBalanceRowSourceSheet(row) ? "manual_fact" : "provider_auto";
}

function normalizeDisplayStatus(row = {}, balanceKind) {
  const explicit = String(row.status || "").trim();
  if (explicit) return explicit;
  if (balanceKind === "confirmed") return "confirmed";
  if (balanceKind === "auto") return normalizeDisplaySource(row) === "derived_balance" ? "derived_from_confirmed_balance" : "auto";
  return normalizeDisplaySource(row) === "manual_fact" ? "confirmed" : "auto";
}

function isConfirmedBalanceRowSourceSheet(row = {}) {
  return String(row.sourceSheet || "").trim() === BALANCE_SHEET_NAME;
}

function buildByDate(rows, { manualRows = rows, autoRows = [], mergedRows = [] } = {}) {
  const grouped = new Map();
  for (const row of rows || []) {
    const entry = grouped.get(row.date) || {
      date: row.date,
      rows: 0,
      channel_currency_pairs: new Set(),
    };
    entry.rows += 1;
    entry.channel_currency_pairs.add(makeKey(row.channel, row.currency));
    grouped.set(row.date, entry);
  }
  const manualCounts = countRowsByDate(manualRows);
  const autoCounts = countRowsByDate(autoRows);
  const mergedCounts = countRowsByDate(mergedRows);
  return Array.from(grouped.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => ({
      date: row.date,
      rows: row.rows,
      manual_rows: manualCounts.get(row.date) || 0,
      auto_rows: autoCounts.get(row.date) || 0,
      merged_rows: mergedCounts.get(row.date) || row.rows,
      channel_currency_pairs: row.channel_currency_pairs.size,
    }));
}

function countRowsByDate(rows = []) {
  const counts = new Map();
  for (const row of rows || []) {
    counts.set(row.date, (counts.get(row.date) || 0) + 1);
  }
  return counts;
}

function buildByChannelCurrency(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = makeKey(row.channel, row.currency);
    const entry = grouped.get(key) || {
      channel: row.channel,
      currency: row.currency,
      rows: 0,
      dates: new Set(),
    };
    entry.rows += 1;
    entry.dates.add(row.date);
    grouped.set(key, entry);
  }
  return Array.from(grouped.values())
    .map((entry) => {
      const dates = Array.from(entry.dates).sort();
      return {
        channel: entry.channel,
        currency: entry.currency,
        rows: entry.rows,
        dates,
        first_date: dates[0] || null,
        last_date: dates.at(-1) || null,
      };
    })
    .sort((left, right) => {
      if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
      return left.currency.localeCompare(right.currency);
    });
}

function compareChannelCurrency(left, right) {
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function isBalanceRowInPeriod(row, periodFilter = {}) {
  if (!periodFilter.from && !periodFilter.to) return true;
  if (!row.date) return false;
  return isDateInPeriod(row.date, periodFilter);
}

function isDateInPeriod(date, periodFilter = {}) {
  if (!periodFilter.from && !periodFilter.to) return true;
  if (periodFilter.from && date < periodFilter.from) return false;
  if (periodFilter.to && date > periodFilter.to) return false;
  return true;
}

function parsePeriodFilter(query = {}) {
  const period = String(query.period || "").trim();
  if (/^\d{4}-\d{2}$/.test(period)) {
    return {
      from: `${period}-01`,
      to: lastDayOfMonth(period),
      period: { from: `${period}-01`, to: lastDayOfMonth(period) },
    };
  }
  const selectedDate = normalizeDate(query.date);
  if (selectedDate) {
    return {
      from: "",
      to: selectedDate,
      period: {
        from: "needs verification",
        to: selectedDate,
      },
    };
  }
  const from = normalizeDate(query.from);
  const to = normalizeDate(query.to);
  return {
    from,
    to,
    period: {
      from: from || "needs verification",
      to: to || "needs verification",
    },
  };
}

function resolvePeriod(periodFilter, dates = []) {
  if (periodFilter.from || periodFilter.to) return periodFilter.period;
  return {
    from: dates[0] || "needs verification",
    to: dates.at(-1) || "needs verification",
  };
}

function makeKey(channel, currency) {
  return `${channel}|${currency}`;
}

function makeCanonicalKey(channel, currency) {
  const canonicalChannel = canonicalBalanceChannel(channel, currency);
  const canonicalCurrency = String(currency || "").trim().toUpperCase();
  if (!canonicalChannel || !canonicalCurrency) return "";
  return makeKey(canonicalChannel, canonicalCurrency);
}

function canonicalBalanceChannel(value, currency = "") {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  if (!raw) return "";
  if (normalized === "legacy_combined_binance_spot_funding") return "";
  if (/^binance\s+spot$/.test(normalized)) return "Бинанс spot";
  if (/^бинанс\s+spot$/.test(normalized)) return "Бинанс spot";
  if (/^binance\s+save$/.test(normalized)) return "binance save";
  if (/^банк\s+канада\s+cad(?:\s+cad)?$/i.test(raw)) return "БАНК КАНАДА cad";
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (normalizedCurrency && normalized.endsWith(` ${normalizedCurrency.toLowerCase()}`)) {
    return raw.slice(0, -(normalizedCurrency.length + 1)).trim();
  }
  return raw;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function lastDayOfMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveStableUsdAmount(row = {}) {
  const amount = parseNumber(row.amount);
  if (amount === null) return null;
  const currency = String(row.currency || "").trim().toUpperCase();
  return ["USD", "USDT", "USDC"].includes(currency) ? amount : null;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== null && value !== undefined && String(value).trim()))];
}

function toSafeWarning(value) {
  return String(value || "")
    .replace(/service account credentials/gi, "service account access")
    .replace(/\bcredentials\b/gi, "access")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=._~-]+/gi, "Basic [redacted]")
    .replace(/access_token['\":=\s]+[A-Za-z0-9._~+/-]+/gi, "access_token [redacted]")
    .replace(/refresh_token['\":=\s]+[A-Za-z0-9._~+/-]+/gi, "refresh_token [redacted]")
    .trim();
}
