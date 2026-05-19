import { loadAutoBalanceRowsFromGoogleSheets } from "./auto-balance-repository.js";
import { mergeManualAndAutoBalances } from "./balance-snapshot-merge.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { buildPeriodBalanceReconciliation } from "./period-balance-reconciliation-engine.js";
import {
  buildProviderLedgerReconciliation,
  buildYooMoneyProviderEvidenceFixture,
} from "./provider-ledger-reconciliation-engine.js";

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
    const balanceRows = mergeManualAndAutoBalances([], Array.isArray(autoBalances.balances) ? autoBalances.balances : []).rows;
    const reconciliation = buildPeriodBalanceReconciliation({
      operations: [],
      balanceRows,
      plannedRows: [],
      plannedSourceStatus: "needs_verification",
      period,
    });
    annotateReconciliationSources(reconciliation, balanceRows);
    annotateBalanceSourceDiagnostics(reconciliation, period);
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
  const balanceSnapshotMerge = mergeManualAndAutoBalances(manualBalances, autoBalanceRows);
  const balanceRows = balanceSnapshotMerge.rows || balanceSnapshotMerge.merged || [];
  const reconciliation = buildPeriodBalanceReconciliation({
    operations: repository.operations || [],
    balanceRows,
    plannedRows,
    plannedSourceStatus,
    period,
  });
  annotateReconciliationSources(reconciliation, balanceRows);
  annotateBalanceSourceDiagnostics(reconciliation, period);
  annotateProviderLedgerReconciliation(reconciliation, repository.operations || [], period);
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

function annotateProviderLedgerReconciliation(reconciliation, operations = [], period = {}) {
  const yoomoneyBalanceDiagnostics = (reconciliation.by_channel_currency || [])
    .filter((row) => row.channel === "Яндекс руб" && row.currency === "RUB")
    .filter((row) => row.status && row.status !== "ok" && row.status !== "no_data")
    .map((row) => ({
      date: row.manual_provider_closing_balance_date || period.to || "",
      channel: row.channel,
      currency: row.currency,
      status: row.status,
      computed_closing_balance: row.calculated_closing_balance,
      provider_reported_balance: row.manual_provider_closing_balance,
      sourceRow: row.sourceRow || row.source_row || null,
    }));
  const yoomoney = buildProviderLedgerReconciliation({
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    providerEvidence: buildYooMoneyProviderEvidenceFixture(),
    ledgerRows: operations,
    balanceDiagnostics: yoomoneyBalanceDiagnostics,
    period,
  });
  reconciliation.provider_ledger_reconciliation = { yoomoney };
  reconciliation.summary = {
    ...(reconciliation.summary || {}),
    transaction_reconciliation_status: yoomoney.transaction_reconciliation_status,
    monthly_total_status: yoomoney.monthly_total_status,
    date_alignment_status: yoomoney.date_alignment_status,
    extra_ledger_status: yoomoney.extra_ledger_status,
    manual_migration_status: yoomoney.manual_migration_status,
    provider_evidence_total: yoomoney.provider_evidence_total,
    ledger_provider_total: yoomoney.ledger_provider_total,
    raw_ledger_yoomoney_total: yoomoney.raw_ledger_yoomoney_total,
    confirmed_matched_ledger_total: yoomoney.confirmed_matched_ledger_total,
    legacy_source_yoomoney_total: yoomoney.legacy_source_yoomoney_total,
    extra_ledger_total: yoomoney.extra_ledger_total,
    ledger_manual_migration_total: yoomoney.ledger_manual_migration_total,
    manual_migration_total: yoomoney.manual_migration_total,
    combined_total: yoomoney.combined_total,
    provider_net: yoomoney.provider_net,
    raw_ledger_yoomoney_net: yoomoney.raw_ledger_yoomoney_net,
    confirmed_matched_ledger_net: yoomoney.confirmed_matched_ledger_net,
    transaction_monthly_delta: yoomoney.transaction_monthly_delta,
    transaction_delta: yoomoney.transaction_delta,
    manual_migration_delta: yoomoney.manual_migration_delta,
    stale_ostatki_rows: yoomoney.stale_ostatki_rows,
    manual_confirmation_required_rows: yoomoney.manual_confirmation_required_rows,
  };
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
  reconciliation.actionable_rows = (reconciliation.actionable_rows || []).map((row) => {
    const sourceRow = findSourceBalanceRow(row, lookup);
    const balanceSource = sourceRow
      ? (normalizeBalanceSource(sourceRow, "manual_fact") === "provider_auto" ? "provider_auto" : "manual_fact")
      : String(row.balanceSource || row.balance_source || "missing").trim() || "missing";
    return {
      ...row,
      balanceSource,
      balance_source: balanceSource,
      needsManualConfirmation: balanceSource !== "manual_fact",
      needs_manual_confirmation: balanceSource !== "manual_fact",
      sourceSheet: sourceRow?.sourceSheet || row.sourceSheet || (balanceSource === "manual_fact" ? MANUAL_BALANCE_SHEET_NAME : (balanceSource === "provider_auto" ? AUTO_BALANCE_SHEET_NAME : "")),
      source_sheet: sourceRow?.sourceSheet || row.source_sheet || row.sourceSheet || (balanceSource === "manual_fact" ? MANUAL_BALANCE_SHEET_NAME : (balanceSource === "provider_auto" ? AUTO_BALANCE_SHEET_NAME : "")),
      sourceRow: sourceRow?.sourceRow || row.sourceRow || null,
      source_row: sourceRow?.sourceRow || row.source_row || row.sourceRow || null,
      sourceComment: sourceRow?.comment || row.sourceComment || "",
      source_comment: sourceRow?.comment || row.source_comment || row.sourceComment || "",
    };
  });
}

function annotateBalanceSourceDiagnostics(reconciliation, period = {}) {
  const rows = Array.isArray(reconciliation.by_channel_currency) ? reconciliation.by_channel_currency : [];
  const counts = { manual_fact: 0, provider_auto: 0, missing: 0 };
  rows.forEach((row) => {
    const source = String(row.balanceSource || row.balance_source || "missing").trim();
    if (Object.prototype.hasOwnProperty.call(counts, source)) counts[source] += 1;
    else counts.missing += 1;
  });
  reconciliation.summary = {
    ...(reconciliation.summary || {}),
    balance_source_counts: counts,
    manual_fact_rows: counts.manual_fact,
    provider_auto_rows: counts.provider_auto,
    missing_fact_rows: counts.missing,
  };
  reconciliation.required_manual_fact_rows = rows
    .filter((row) => row.needsManualConfirmation || row.needs_manual_confirmation || String(row.balanceSource || row.balance_source || "") !== "manual_fact")
    .filter((row) => String(row.status || "") !== "no_data")
    .map((row) => buildRequiredManualFactRow(row, period));
}

function buildRequiredManualFactRow(row, period = {}) {
  const source = String(row.balanceSource || row.balance_source || "missing").trim() || "missing";
  return {
    sheet: MANUAL_BALANCE_SHEET_NAME,
    date: period.to || row.manual_provider_closing_balance_date || "",
    channel: row.channel || "",
    currency: row.currency || "",
    amount: null,
    amount_hint: source === "provider_auto" ? row.manual_provider_closing_balance : null,
    balanceSource: source,
    balance_source: source,
    needsManualConfirmation: true,
    needs_manual_confirmation: true,
    sourceSheet: row.sourceSheet || row.source_sheet || "",
    source_sheet: row.source_sheet || row.sourceSheet || "",
    sourceRow: row.sourceRow || row.source_row || null,
    source_row: row.source_row || row.sourceRow || null,
    status: row.status || "",
    reason: row.missing_fact_reason || row.diagnosis || "",
    action: source === "provider_auto"
      ? "Confirm provider auto balance, then enter the factual balance in Остатки."
      : "Enter factual manual/provider balance in Остатки.",
  };
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
  const date = row.manual_provider_closing_balance_date || "";
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

function normalizeBalanceSource(row = {}, fallback = "manual_fact") {
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/auto snapshot|provider_auto|provider|wise|paypal|monobank|binance|privat|yoomoney/.test(text)) return "provider_auto";
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
