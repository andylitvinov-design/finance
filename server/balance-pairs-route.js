import { EXPECTED_PROVIDER_BALANCES } from "./auto-balance-snapshots.js";
import { loadAutoBalanceRowsFromGoogleSheets } from "./auto-balance-repository.js";
import { mergeManualAndAutoBalances } from "./balance-snapshot-merge.js";
import {
  buildDailyCalculatedBalances,
  toCalculatedBalanceSnapshotRows,
} from "./daily-calculated-balances.js";
import {
  buildFxRateLookup,
  isStableUsdCurrency,
  resolveFrozenFxRate,
} from "./fx-rates.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";

const PROJECT_NAME = "ezohata-incoming-ledger";

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

  try {
    const snapshot = await buildBalancePairsSnapshot({
      query: request.query || {},
      repositoryLoader: loadManualRepositoryFromGoogleSheets,
      autoBalanceLoader: loadAutoBalanceRowsFromGoogleSheets,
    });
    return response.status(200).json(snapshot);
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: String(error?.message || error),
      route: "balance-pairs",
    });
  }
}

export async function buildBalancePairsSnapshot(options = {}) {
  const period = parsePeriod(options.query || {});
  const generatedAt = new Date().toISOString();
  const repository = await loadRepository(options.repositoryLoader || loadManualRepositoryFromGoogleSheets);
  const warnings = [];
  const autoBalances = Array.isArray(repository.autoBalances)
    ? { ok: true, balances: repository.autoBalances, warnings: [] }
    : await loadAutoBalances(options.autoBalanceLoader || loadAutoBalanceRowsFromGoogleSheets);
  if (!repository.ok) {
    warnings.push("manual Google Sheets read failed");
    if (repository.warning) warnings.push(toSafeWarning(repository.warning));
    warnings.push(...(autoBalances.warnings || []).map(toSafeWarning));
    const autoBalanceRows = Array.isArray(autoBalances.balances) ? autoBalances.balances : [];
    const sourceRows = autoBalanceRows.map(normalizeBalanceRow).filter(Boolean);
    const rows = buildRows({
      sourceRows,
      operations: [],
      fxRates: [],
      expectedPairs: options.expectedPairs || EXPECTED_PROVIDER_BALANCES,
      period,
    });
    const sourceStatus = sourceRows.length ? "partial" : "unavailable";
    const diagnostics = buildSnapshotDiagnostics({
      repository,
      autoBalances,
      manualBalances: [],
      autoBalanceRows,
      fxRates: [],
      sourceStatus,
      sourceRoute: "balance-pairs",
    });
    if (sourceRows.length) {
      return {
        ok: true,
        status: "partial_source",
        source_status: sourceStatus,
        generated_at: generatedAt,
        project: PROJECT_NAME,
        period,
        summary: buildSummary(rows),
        rows,
        warnings: unique(warnings.filter(Boolean)),
        diagnostics,
      };
    }
    return {
      ok: false,
      status: "repository_failed",
      source_status: sourceStatus,
      generated_at: generatedAt,
      project: PROJECT_NAME,
      period,
      summary: emptySummary(),
      rows: [],
      warnings: unique(warnings.filter(Boolean)),
      error: repository.warning ? toSafeWarning(repository.warning) : "manual Google Sheets read failed",
      diagnostics,
    };
  }

  warnings.push(...(repository.warnings || []).map(toSafeWarning));
  warnings.push(...(autoBalances.warnings || []).map(toSafeWarning));

  const manualBalances = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalanceRows = Array.isArray(autoBalances.balances) ? autoBalances.balances : [];
  const fxRates = Array.isArray(repository.fxRates) ? repository.fxRates : [];
  const merged = mergeManualAndAutoBalances(manualBalances, autoBalanceRows);
  const mergedRows = Array.isArray(merged.rows) ? merged.rows : (merged.merged || []);
  const calculatedRows = buildCalculatedRows({
    rows: mergedRows,
    operations: repository.operations || [],
    period,
  });
  const rows = buildRows({
    sourceRows: [...mergedRows, ...calculatedRows].map(normalizeBalanceRow).filter(Boolean),
    operations: repository.operations || [],
    fxRates,
    expectedPairs: options.expectedPairs || EXPECTED_PROVIDER_BALANCES,
    period,
  });

  const diagnostics = buildSnapshotDiagnostics({
    repository,
    autoBalances,
    manualBalances,
    autoBalanceRows,
    fxRates,
    sourceStatus: "complete",
    sourceRoute: "balance-pairs",
  });

  return {
    ok: true,
    status: "complete",
    source_status: "complete",
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period,
    summary: buildSummary(rows),
    rows,
    warnings: unique(warnings.filter(Boolean)),
    diagnostics,
  };
}

function buildRows({ sourceRows, operations, fxRates, expectedPairs, period }) {
  const fxRateLookup = buildFxRateLookup(fxRates || []);
  const pairs = buildExpectedPairs({
    expectedPairs,
    sourceRows,
    operations,
    period,
  });
  return pairs.map((pair) => {
    const startSnapshot = findLatestSnapshot(sourceRows, pair, period.from);
    const endSnapshot = findLatestSnapshot(sourceRows, pair, period.to);
    return {
      channel: pair.channel,
      currency: pair.currency,
      start: buildSide(startSnapshot, { requestedDate: period.from, fxRateLookup }),
      end: buildSide(endSnapshot, { requestedDate: period.to, fxRateLookup }),
    };
  });
}

function buildSnapshotDiagnostics({
  repository,
  autoBalances,
  manualBalances,
  autoBalanceRows,
  fxRates,
  sourceStatus,
  sourceRoute,
}) {
  const repositoryOk = Boolean(repository?.ok);
  const repositoryWarning = repository?.warning ? toSafeWarning(repository.warning) : null;
  const manualCount = Array.isArray(manualBalances) ? manualBalances.length : 0;
  const autoCount = Array.isArray(autoBalanceRows) ? autoBalanceRows.length : 0;
  const fxCount = Array.isArray(fxRates) ? fxRates.length : 0;
  return {
    source_route: sourceRoute,
    source_status: sourceStatus,
    // Contract-named diagnostics (issue #552).
    manual_repository_ok: repositoryOk,
    manual_repository_warning: repositoryWarning,
    manual_balance_rows_loaded: manualCount,
    auto_balance_rows_loaded: autoCount,
    fx_rates_rows_loaded: fxCount,
    // Retained from PR #573 for backward compatibility.
    repository_ok: repositoryOk,
    repository_warning: repositoryWarning,
    manual_balances_loaded: manualCount,
    auto_balances_loaded: autoCount,
    auto_balance_loader_ok: Boolean(autoBalances?.ok),
    auto_balance_warning_count: Array.isArray(autoBalances?.warnings) ? autoBalances.warnings.length : 0,
    env_config_missing: inferEnvConfigMissing(repository?.warning),
  };
}

async function loadRepository(repositoryLoader) {
  try {
    return await repositoryLoader();
  } catch (error) {
    return {
      ok: false,
      warning: `Manual Google Sheets overlay failed: ${String(error?.message || error)}`,
    };
  }
}

async function loadAutoBalances(autoBalanceLoader) {
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

function buildCalculatedRows({ rows, operations, period }) {
  if (!Array.isArray(operations) || !operations.length) return [];
  const calculated = buildDailyCalculatedBalances({
    rows,
    operations,
    from: period.from,
    to: period.to,
  });
  return toCalculatedBalanceSnapshotRows(calculated.rows || []);
}

function buildExpectedPairs({ expectedPairs, sourceRows, operations, period }) {
  const map = new Map();
  for (const row of expectedPairs || []) addPair(map, row.channel, row.currency);
  for (const row of sourceRows || []) addPair(map, row.channel, row.currency);
  for (const operation of operations || []) {
    const date = normalizeDate(operation?.date || operation?.ledgerV2?.date);
    if (!date || (period.to && date > period.to)) continue;
    const currency = String(operation?.ledgerV2?.currency || operation?.currency || "").trim().toUpperCase();
    const ledger = operation?.ledgerV2 || {};
    const operationName = String(ledger.operation || operation.operation || "").trim().toLowerCase();
    const from = String(ledger.from_channel || operation.fromChannel || operation.from_channel || "").trim();
    const to = String(ledger.to_channel || operation.toChannel || operation.to_channel || "").trim();
    if (["income", "exchange_in"].includes(operationName)) addPair(map, to, currency);
    else if (["expense", "business_expense", "personal_expense", "exchange_out"].includes(operationName)) addPair(map, from, currency);
    else if (["transfer", "partner_transfer"].includes(operationName)) {
      addPair(map, from, currency);
      addPair(map, to, currency);
    } else {
      addPair(map, operation.channel || operation.accountName || operation.account || from || to, currency);
    }
  }
  return Array.from(map.values()).sort(comparePairs);
}

function addPair(map, channel, currency) {
  const normalized = {
    channel: canonicalChannel(channel, currency),
    currency: String(currency || "").trim().toUpperCase(),
  };
  if (!normalized.channel || !normalized.currency) return;
  map.set(makeKey(normalized.channel, normalized.currency), normalized);
}

function findLatestSnapshot(rows, pair, requestedDate) {
  const key = makeKey(pair.channel, pair.currency);
  return (rows || [])
    .filter((row) => row.date && (!requestedDate || row.date <= requestedDate) && makeKey(row.channel, row.currency) === key)
    .sort(compareSnapshots)
    .at(-1) || null;
}

function buildSide(snapshot, { requestedDate, fxRateLookup }) {
  if (!snapshot) {
    return {
      status: "missing_snapshot",
      snapshot_status: "missing_snapshot",
      snapshot_date: null,
      amount: null,
      rate_to_usd: null,
      amount_usd: null,
      message: "missing snapshot",
      source_sheet: null,
    };
  }

  const amount = snapshot.amount;
  const currency = snapshot.currency;
  const snapshotStatus = snapshot.date === requestedDate ? "exact" : "latest_before";
  const explicitUsd = firstNumber(snapshot.amount_usd, snapshot.usdAmount, snapshot.amountUsd, snapshot.balance_usd, snapshot.balanceUsd, snapshot.nowUsd, snapshot.now_usd);
  if (amount === 0) {
    return sideResult(snapshot, {
      requestedDate,
      snapshotStatus,
      status: "ok_zero",
      amountUsd: 0,
      rate: isStableUsdCurrency(currency) ? 1 : null,
      message: snapshotStatus === "latest_before" ? `latest snapshot ${snapshot.date}` : "ok zero",
    });
  }
  if (explicitUsd !== null) {
    return sideResult(snapshot, {
      requestedDate,
      snapshotStatus,
      status: "ok",
      amountUsd: explicitUsd,
      rate: amount ? explicitUsd / amount : null,
      message: snapshotStatus === "latest_before" ? `latest snapshot ${snapshot.date}` : "ok",
    });
  }
  if (isStableUsdCurrency(currency)) {
    return sideResult(snapshot, {
      requestedDate,
      snapshotStatus,
      status: "ok",
      amountUsd: amount,
      rate: 1,
      message: snapshotStatus === "latest_before" ? `latest snapshot ${snapshot.date}` : "ok",
    });
  }
  const explicitRate = firstNumber(snapshot.fx_rate_to_usd, snapshot.rate_to_usd, snapshot.rate, snapshot.fxRateToUsd);
  if (explicitRate !== null && explicitRate > 0) {
    return sideResult(snapshot, {
      requestedDate,
      snapshotStatus,
      status: "ok",
      amountUsd: amount * explicitRate,
      rate: explicitRate,
      message: snapshotStatus === "latest_before" ? `latest snapshot ${snapshot.date}` : "ok",
    });
  }
  const frozenRate = resolveFrozenFxRate(fxRateLookup, { date: snapshot.date, currency });
  if (frozenRate.ok) {
    return sideResult(snapshot, {
      requestedDate,
      snapshotStatus,
      status: "ok",
      amountUsd: amount * frozenRate.rate_to_usd,
      rate: frozenRate.rate_to_usd,
      fxRateDate: frozenRate.date,
      message: snapshotStatus === "latest_before" ? `latest snapshot ${snapshot.date}` : "ok",
    });
  }

  return sideResult(snapshot, {
    requestedDate,
    snapshotStatus,
    status: "missing_fx",
    amountUsd: null,
    rate: null,
    message: `missing FX ${currency} ${snapshot.date}`,
  });
}

function sideResult(snapshot, { snapshotStatus, status, amountUsd, rate, message, fxRateDate = null }) {
  return {
    status,
    snapshot_status: snapshotStatus,
    snapshot_date: snapshot.date,
    amount: snapshot.amount,
    rate_to_usd: roundOrNull(rate),
    amount_usd: roundOrNull(amountUsd),
    message,
    fx_rate_date: fxRateDate || snapshot.date,
    source_sheet: snapshot.source_sheet || snapshot.sourceSheet || snapshot.source || null,
  };
}

function buildSummary(rows) {
  return {
    expected_rows: rows.length,
    found_start_rows: rows.filter((row) => row.start.status !== "missing_snapshot").length,
    found_end_rows: rows.filter((row) => row.end.status !== "missing_snapshot").length,
    missing_start_rows: rows.filter((row) => row.start.status === "missing_snapshot").length,
    missing_end_rows: rows.filter((row) => row.end.status === "missing_snapshot").length,
    usd_complete_start: rows.filter((row) => row.start.amount_usd !== null).length,
    usd_complete_end: rows.filter((row) => row.end.amount_usd !== null).length,
    fx_missing: rows.reduce((count, row) => count + (row.start.status === "missing_fx" ? 1 : 0) + (row.end.status === "missing_fx" ? 1 : 0), 0),
  };
}

function emptySummary() {
  return {
    expected_rows: 0,
    found_start_rows: 0,
    found_end_rows: 0,
    missing_start_rows: 0,
    missing_end_rows: 0,
    usd_complete_start: 0,
    usd_complete_end: 0,
    fx_missing: 0,
  };
}

function normalizeBalanceRow(row = {}) {
  const date = normalizeDate(row.date);
  const currency = String(row.currency || row.balance_currency || row.account_currency || "").trim().toUpperCase();
  const channel = canonicalChannel(row.channel || row.accountName || row.account, currency);
  const amount = firstNumber(row.amount, row.balanceAmount, row.balance, row.value, row.native, row.closing, row.closing_amount, row.calculated_eod);
  if (!date || !channel || !currency || amount === null) return null;
  return {
    ...row,
    date,
    channel,
    currency,
    amount,
  };
}

function parsePeriod(query = {}) {
  const from = normalizeDate(query.from || query.period_from || query.startDate || query.start || query.date_from);
  const to = normalizeDate(query.to || query.period_to || query.endDate || query.end || query.date_to) || from;
  return { from, to };
}

function compareSnapshots(left, right) {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  return sourcePriority(left) - sourcePriority(right);
}

function sourcePriority(row = {}) {
  const text = [row.balanceSource, row.balance_source, row.source, row.fact_source, row.sourceSheet, row.source_sheet].map((value) => String(value || "").toLowerCase()).join(" ");
  if (/manual|остатки/.test(text)) return 3;
  if (/provider|auto|авто|derived/.test(text)) return 2;
  if (/calculated|расчет/.test(text)) return 1;
  return 0;
}

function comparePairs(left, right) {
  const leftLabel = `${left.channel} ${left.currency}`.toLowerCase();
  const rightLabel = `${right.channel} ${right.currency}`.toLowerCase();
  return leftLabel.localeCompare(rightLabel, "ru");
}

function canonicalChannel(value, currency = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const text = raw.toLowerCase().replace(/\s+/g, " ");
  if (/^binance\s+spot$/.test(text) || /^бинанс\s+spot$/.test(text)) return "Бинанс spot";
  if (/^binance\s+save$/.test(text)) return "binance save";
  if (/^банк\s+канада\s+cad(?:\s+cad)?$/.test(text)) return "БАНК КАНАДА cad";
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (normalizedCurrency && raw.toLowerCase().endsWith(` ${normalizedCurrency.toLowerCase()}`)) {
    return raw.slice(0, -(normalizedCurrency.length + 1)).trim();
  }
  return raw;
}

function makeKey(channel, currency) {
  return `${canonicalChannel(channel, currency)}|${String(currency || "").trim().toUpperCase()}`;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  if (iso) return iso[1];
  const display = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferEnvConfigMissing(warning) {
  return /missing|not configured|credential|private[_\s-]?key|client[_\s-]?email|sheet/i.test(String(warning || ""));
}

function roundOrNull(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 10000) / 10000;
}

function unique(values) {
  return Array.from(new Set(values));
}

function toSafeWarning(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
