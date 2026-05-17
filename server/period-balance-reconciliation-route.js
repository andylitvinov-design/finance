import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { buildPeriodBalanceReconciliation } from "./period-balance-reconciliation-engine.js";

const PROJECT_NAME = "ezohata-incoming-ledger";

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
  });
  return response.status(200).json(snapshot);
}

export async function buildPeriodBalanceReconciliationSnapshot(options = {}) {
  const query = options.query || {};
  const period = parsePeriod(query);
  const warnings = [];
  const repository = await loadRepository(options.repositoryLoader);

  if (!repository.ok) {
    warnings.push("needs verification: manual Google Sheets read access is unavailable.");
    if (repository.warning) warnings.push(toSafeWarning(repository.warning));
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      project: PROJECT_NAME,
      period,
      period_balance_reconciliation: buildPeriodBalanceReconciliation({
        operations: [],
        balanceRows: [],
        plannedRows: [],
        plannedSourceStatus: "needs_verification",
        period,
      }),
      warnings: unique(warnings),
    };
  }

  const plannedRows = resolvePlannedRows(repository);
  const plannedSourceStatus = resolvePlannedSourceStatus(repository, plannedRows);
  const reconciliation = buildPeriodBalanceReconciliation({
    operations: repository.operations || [],
    balanceRows: repository.balances || [],
    plannedRows,
    plannedSourceStatus,
    period,
  });
  reconciliation.diagnostics = {
    ...(reconciliation.diagnostics || {}),
    balance_snapshot_rows_loaded: Array.isArray(repository.balances) ? repository.balances.length : 0,
    analytics_fact_rows_rendered: (reconciliation.by_channel_currency || [])
      .filter((row) => row.factual_closing_balance !== null && row.factual_closing_balance !== undefined).length,
  };
  warnings.push(...(repository.warnings || []).map(toSafeWarning).filter(Boolean));
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
