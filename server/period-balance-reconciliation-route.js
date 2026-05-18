import { loadAutoBalanceRowsFromGoogleSheets } from "./auto-balance-repository.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { buildPeriodBalanceReconciliation } from "./period-balance-reconciliation-engine.js";

const PROJECT_NAME = "ezohata-incoming-ledger";
const MANUAL_BALANCE_SHEET_NAME = "Остатки";
const AUTO_BALANCE_SHEET_NAME = "Авто Остатки";

export default async function periodBalanceReconciliationHandler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: request.query || {},
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
    autoBalanceLoader: loadAutoBalanceRowsFromGoogleSheets,
  });
  return response.status(200).json(snapshot);
}

export async function buildPeriodBalanceReconciliationSnapshot(options = {}) {
  const query = options.query || {};
  const period = parsePeriod(query);
  const warnings = [];
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
    const balanceRows = Array.isArray(autoBalances.balances) ? autoBalances.balances : [];
    const reconciliation = buildPeriodBalanceReconciliation({
      operations: [],
      balanceRows,
      plannedRows: [],
      plannedSourceStatus: "needs_verification",
      period,
    });
    annotateReconciliationSources(reconciliation, balanceRows);
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      project: PROJECT_NAME,
      period,
      period_balance_reconciliation: reconciliation,
      warnings: unique(warnings),
    };
  }

  const plannedRows = resolvePlannedRows(repository);
  const plannedSourceStatus = resolvePlannedSourceStatus(repository, plannedRows);
  const manualBalances = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalanceRows = Array.isArray(autoBalances.balances) ? autoBalances.balances : [];
  const balanceRows = mergeManualAndAutoBalances(manualBalances, autoBalanceRows);
  const reconciliation = buildPeriodBalanceReconciliation({
    operations: repository.operations || [],
    balanceRows,
    plannedRows,
    plannedSourceStatus,
    period,
  });
  annotateReconciliationSources(reconciliation, balanceRows);
  reconciliation.diagnostics = {
    ...(reconciliation.diagnostics || {}),
    manual_balance_snapshot_rows_loaded: manualBalances.length,
    auto_balance_snapshot_rows_loaded: autoBalanceRows.length,
    balance_snapshot_rows_loaded: balanceRows.length,
    analytics_fact_rows_rendered: (reconciliation.by_channel_currency || [])
      .filter((row) => row.factual_closing_balance !== null && row.factual_closing_balance !== undefined).length,
  };
  warnings.push(...(repository.warnings || []).map(toSafeWarning).filter(Boolean));
  warnings.push(...(autoBalances.warnings || []).map(toSafeWarning).filter(Boolean));
  warnings.push(...reconciliation.warnings);
  if (!plannedRows.length && plannedSourceStatus !== "available") {
    warnings.push(
      "needs verification: planned income/expense source is not connected to period balance reconciliation yet; TODO expose UI movementValues order-plan rows and manual finance planned expense rows server-side as repository.plannedRows before planned_delta can be trusted."
    );
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    project: PROJECT_NAME,
    period,
    period_balance_reconciliation: reconciliation,
    warnings: unique(warnings),
  };
}

function mergeManualAndAutoBalances(manualBalances = [], autoBalances = []) {
  const manualRows = (manualBalances || []).map((row) => ({
    ...row,
    source: normalizeBalanceSource(row, "manual_fact"),
    fact_source: normalizeBalanceSource(row, "manual_fact"),
    sourceSheet: row.sourceSheet || MANUAL_BALANCE_SHEET_NAME,
  }));
  const manualKeys = new Set(manualRows.map(balanceKey));
  return [
    ...manualRows,
    ...(autoBalances || [])
      .filter((row) => !manualKeys.has(balanceKey(row)))
      .map((row) => ({
        ...row,
        source: "provider_auto",
        fact_source: "provider_auto",
        sourceSheet: row.sourceSheet || AUTO_BALANCE_SHEET_NAME,
      })),
  ];
}

function annotateReconciliationSources(reconciliation, balanceRows = []) {
  const lookup = buildBalanceRowLookup(balanceRows);
  reconciliation.by_channel_currency = (reconciliation.by_channel_currency || []).map((row) => {
    const sourceRow = findSourceBalanceRow(row, lookup);
    const balanceSource = sourceRow
      ? (normalizeBalanceSource(sourceRow, "manual_fact") === "provider_auto" ? "provider_auto" : "manual_fact")
      : "missing";
    return {
      ...row,
      balanceSource,
      balance_source: balanceSource,
      needsManualConfirmation: balanceSource !== "manual_fact",
      needs_manual_confirmation: balanceSource !== "manual_fact",
      provider: sourceRow?.provider || "",
      sourceSheet: sourceRow?.sourceSheet || (balanceSource === "manual_fact" ? MANUAL_BALANCE_SHEET_NAME : (balanceSource === "provider_auto" ? AUTO_BALANCE_SHEET_NAME : "")),
      source_sheet: sourceRow?.sourceSheet || (balanceSource === "manual_fact" ? MANUAL_BALANCE_SHEET_NAME : (balanceSource === "provider_auto" ? AUTO_BALANCE_SHEET_NAME : "")),
      sourceRow: sourceRow?.sourceRow || null,
      source_row: sourceRow?.sourceRow || null,
      sourceComment: sourceRow?.comment || "",
      source_comment: sourceRow?.comment || "",
    };
  });
}

function buildBalanceRowLookup(balanceRows = []) {
  const lookup = new Map();
  (balanceRows || []).forEach((row) => {
    const key = balanceDatedKey(row.date, row.channel || row.accountName || row.account, row.currency);
    if (!key) return;
    const existing = lookup.get(key);
    if (existing && normalizeBalanceSource(existing, "manual_fact") === "manual_fact") return;
    lookup.set(key, row);
  });
  return lookup;
}

function findSourceBalanceRow(row, lookup) {
  const date = row.factual_closing_balance_date || row.manual_provider_closing_balance_date || row.opening_balance_date || "";
  const exactKey = balanceDatedKey(date, row.channel, row.currency);
  if (exactKey && lookup.has(exactKey)) return lookup.get(exactKey);
  return null;
}

function balanceDatedKey(date, channel, currency) {
  const normalizedDate = normalizeDate(date);
  const normalizedChannel = String(channel || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!normalizedDate || !normalizedChannel || !normalizedCurrency) return "";
  return [normalizedDate, normalizedChannel, normalizedCurrency].join("|");
}

function balanceKey(row = {}) {
  return [
    normalizeDate(row.date),
    String(row.channel || row.accountName || row.account || "").trim(),
    String(row.currency || "").trim().toUpperCase(),
  ].join("|");
}

function normalizeBalanceSource(row = {}, fallback = "manual_fact") {
  const text = String(row.source || row.fact_source || row.provider || row.comment || "").trim().toLowerCase();
  if (/auto snapshot|provider|wise|paypal|monobank|binance|privat|yoomoney/.test(text)) return "provider_auto";
  return fallback;
}

function resolvePlannedRows(repository) {
  const candidates = [
    repository?.plannedRows,
    repository?.planRows,
    repository?.plannedOperations,
    repository?.views?.plannedRows,
    repository?.views?.planRows,
    repository?.analytics?.plannedRows,
  ];
  for (const rows of candidates) {
    if (Array.isArray(rows) && rows.length) return rows;
  }
  return [];
}

function resolvePlannedSourceStatus(repository, plannedRows) {
  if (Array.isArray(plannedRows) && plannedRows.length) return "ok";
  return repository?.plannedSourceStatus === "available" ? "available" : "needs_verification";
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

function parsePeriod(query = {}) {
  const period = String(query.period || "").trim();
  if (/^\d{4}-\d{2}$/.test(period)) {
    return { from: `${period}-01`, to: lastDayOfMonth(period) };
  }
  return {
    from: normalizeDate(query.from || query.startDate || query.dateFrom),
    to: normalizeDate(query.to || query.endDate || query.dateTo),
  };
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  return "";
}

function lastDayOfMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function unique(values) {
  return [...new Set((values || []).map(toSafeWarning).filter(Boolean))];
}

function toSafeWarning(value) {
  return String(value || "")
    .replace(/service account credentials/gi, "service account access")
    .replace(/\bcredentials\b/gi, "access")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=._~-]+/gi, "Basic [redacted]")
    .replace(/access_token['":=\s]+[A-Za-z0-9._~+/-]+/gi, "access_token [redacted]")
    .replace(/refresh_token['":=\s]+[A-Za-z0-9._~+/-]+/gi, "refresh_token [redacted]")
    .trim();
}
