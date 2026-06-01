import { buildAuditSnapshot } from "../api/audit-snapshot.js";
import { fetchMonobankStatementEntries } from "../api/monobank-transactions.js";
import { fetchPayPalStatementEntries } from "../api/paypal-transactions.js";
import { fetchPrivatBankStatementEntries } from "../api/privatbank-transactions.js";
import { fetchWiseStatementEntries } from "../api/wise-transactions.js";
import { fetchYooMoneyStatementEntries } from "../api/yoomoney-transactions.js";
import { fetchBinanceStatementEntries, getBinanceProviderConfigFromEnv } from "./binance-transactions.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { runAutoBalanceSnapshots } from "./auto-balance-snapshots.js";
import { DEFAULT_PROVIDER_FX_CURRENCIES, ensureFxRates } from "./fx-rates.js";
import { buildBalanceSnapshotsSnapshot } from "./balance-snapshots.js";
import { buildPeriodBalanceReconciliationSnapshot } from "./period-balance-reconciliation-route.js";
import { buildCanonicalBalanceTotalFromSnapshots } from "./canonical-balance-total.js";

const PROVIDER_ORDER = ["wise", "monobank", "paypal", "privatbank", "yoomoney", "binance"];
const AUTO_REFRESH_SUPPORTED_PROVIDERS = ["wise", "paypal", "binance"];
const MANUAL_PROVIDER_ACTIONS = {
  monobank: "ручной скриншот или отдельная кнопка Monobank; этот общий flow не обновляет канал автоматически",
  privatbank: "ручной скриншот или ручной ввод остатка; автообновление текущего остатка не реализовано",
  yoomoney: "ручной скриншот или отдельный OAuth/token flow; этот общий flow не обновляет канал автоматически",
  tdbank: "ручной скриншот или ручной ввод остатка; автообновление не реализовано",
  payoneer: "ручной ввод подтверждённого остатка или ручной скриншот; API текущего остатка не настроен",
  revolut: "ручной скриншот или ручной ввод остатка; автообновление не реализовано",
  cash: "ручной ввод owner-confirmed остатка или скриншот",
  manual: "ручной ввод owner-confirmed остатка или скриншот",
  local: "ручной ввод owner-confirmed остатка или скриншот",
  unknown: "уточнить канал и внести owner-confirmed остаток",
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "POST") {
    return response.status(405).json(buildStructuredError("method_not_allowed", `Unsupported method: ${request.method}`));
  }

  const payload = parseRequestBody(request.body);
  const runner = request.refreshAllBalancesRunner || runReconcileBalancesAndTransfers;
  const result = await runner({
    from: payload.from || payload.startDate || request.query?.from,
    to: payload.to || payload.endDate || request.query?.to,
    dryRun: isTruthy(payload.dryRun || request.query?.dryRun),
    env: process.env,
    fetchImpl: fetch,
  });
  return response.status(result.ok ? 200 : 500).json(result);
}

export async function runReconcileBalancesAndTransfers(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const from = normalizeIsoDate(options.from);
  const to = normalizeIsoDate(options.to);
  const currentDate = normalizeIsoDate(options.currentDate) || todayUtcDate();
  const balanceDate = currentDate;
  const dryRun = Boolean(options.dryRun);
  const ensureFxRatesRunner = options.ensureFxRatesRunner || ensureFxRates;
  const autoBalanceRunner = options.autoBalanceRunner || runAutoBalanceSnapshots;
  const auditSnapshotRunner = options.auditSnapshotRunner || buildAuditSnapshot;
  const selectedDateSnapshotRunner = options.selectedDateSnapshotRunner || buildBalanceSnapshotsSnapshot;
  const periodReconciliationRunner = options.periodReconciliationRunner || buildPeriodBalanceReconciliationSnapshot;
  const providerTransferCollector = options.providerTransferCollector || collectProviderTransfers;
  const fxRatePrimitives = options.fxRatePrimitives || await loadFxRateScriptPrimitives();

  const fxRatesEnsure = await runStep("ensure_fx_rates", () => ensureFxRatesRunner({
    from: from || currentDate,
    to: to || from || currentDate,
    currencies: options.fxCurrencies || DEFAULT_PROVIDER_FX_CURRENCIES,
    currentDate,
    fetchImpl,
    readFxRateSheetValues: fxRatePrimitives.readFxRateSheetValues,
    fetchFxRowsForDate: fxRatePrimitives.fetchFxRowsForDate,
    applyFxRateRows: fxRatePrimitives.applyFxRateRows,
  }));
  const balances = await runStep("auto_balance_snapshots", () => autoBalanceRunner({
    query: { date: balanceDate, currentDate, dryRun },
    env,
    fetchImpl,
  }));
  const transfers = await providerTransferCollector({ from, to, env, fetchImpl });
  const selectedDateSnapshotStep = await runStep("selected_date_balance_snapshot", () => selectedDateSnapshotRunner({
    query: { from: from || to || currentDate, to: to || from || currentDate },
  }));
  const periodReconciliationStep = await runStep("period_balance_reconciliation", () => periodReconciliationRunner({
    query: { from: from || currentDate, to: to || from || currentDate },
  }));
  const audit = await runStep("audit_snapshot", () => auditSnapshotRunner({
    query: { from, to },
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
  }));
  const auditSnapshot = audit.ok ? audit.result : null;
  const selectedDateSnapshot = selectedDateSnapshotStep.ok ? selectedDateSnapshotStep.result?.balance_snapshots || selectedDateSnapshotStep.result : null;
  const periodReconciliation = periodReconciliationStep.ok
    ? periodReconciliationStep.result?.period_balance_reconciliation || periodReconciliationStep.result
    : null;
  const canonicalTotal = buildCanonicalBalanceTotalFromSnapshots({
    selectedDateSnapshot,
    periodReconciliation,
  });
  const computedRows = collectRemainderRows(auditSnapshot).filter((row) => row.computed_balance === true);
  const needsVerificationRows = collectRemainderRows(auditSnapshot)
    .filter((row) => row.needs_verification === true || String(row.status || "").toLowerCase().includes("needs"))
    .map(buildNeedsVerificationReason);
  const providerFailures = [
    ...extractBalanceProviderFailures(balances.result),
    ...transfers.filter((result) => result.status === "error" || result.status === "needs_permission"),
  ];
  const balanceStepOk = Boolean(balances.ok && balances.result?.ok !== false);
  const auditStepOk = Boolean(audit.ok && auditSnapshot?.ok !== false);
  const fxRatesStepOk = Boolean(fxRatesEnsure.ok && fxRatesEnsure.result?.ok !== false);
  const selectedDateStepOk = Boolean(selectedDateSnapshotStep.ok && selectedDateSnapshotStep.result?.ok !== false);
  const periodReconciliationStepOk = Boolean(periodReconciliationStep.ok && periodReconciliationStep.result?.ok !== false);
  const structuredErrors = [
    ...[fxRatesEnsure, balances, selectedDateSnapshotStep, periodReconciliationStep, audit].filter((step) => !step.ok).map((step) => ({
      step: step.step,
      code: step.code,
      message: step.error,
    })),
    ...(!fxRatesStepOk && fxRatesEnsure.ok ? [{
      step: fxRatesEnsure.step,
      code: "step_failed",
      message: (fxRatesEnsure.result?.errors || []).map((error) => error.message).filter(Boolean).join("; ") || "ensure FX Rates returned ok=false",
    }] : []),
    ...(!balanceStepOk && balances.ok ? [{
      step: balances.step,
      code: "step_failed",
      message: balances.result?.error || "auto balance snapshot step returned ok=false",
    }] : []),
    ...(!selectedDateStepOk && selectedDateSnapshotStep.ok ? [{
      step: selectedDateSnapshotStep.step,
      code: "step_failed",
      message: selectedDateSnapshotStep.result?.error || "selected-date balance snapshot returned ok=false",
    }] : []),
    ...(!periodReconciliationStepOk && periodReconciliationStep.ok ? [{
      step: periodReconciliationStep.step,
      code: "step_failed",
      message: periodReconciliationStep.result?.error || "period balance reconciliation returned ok=false",
    }] : []),
    ...(!auditStepOk && audit.ok ? [{
      step: audit.step,
      code: "step_failed",
      message: auditSnapshot?.error || "audit snapshot returned ok=false",
    }] : []),
  ];
  const providerMatrix = Array.isArray(selectedDateSnapshot?.provider_channel_matrix)
    ? selectedDateSnapshot.provider_channel_matrix
    : [];
  const refreshReport = buildRefreshReport({
    balances: balances.result,
    transfers,
    providerFailures,
    needsVerificationRows,
    errors: structuredErrors,
    providerMatrix,
    canonicalTotal,
  });
  const warnings = uniqueStrings([
    ...(fxRatesEnsure.result?.warnings || []),
    ...(balances.result?.warnings || []),
    ...(selectedDateSnapshotStep.result?.warnings || []),
    ...(periodReconciliationStep.result?.warnings || []),
    ...(auditSnapshot?.warnings || []),
  ].map((warning) => String(warning || "")).filter(Boolean));

  return {
    ok: Boolean(fxRatesStepOk && balanceStepOk && selectedDateStepOk && periodReconciliationStepOk && auditStepOk),
    action: "reconcile-balances-and-transfers",
    period: { from, to },
    mode: dryRun ? "dry_run" : "write_auto_balances_and_read_provider_movements",
    notes: [
      "Current-only providers are saved only for the current date; this endpoint does not claim historical backfill.",
      "Computed balances are returned by audit snapshot only and are not written to Остатки or Авто Остатки as factual rows.",
      "Provider movement fetches are read-only; Ledger save is not called.",
    ],
    auto_refresh_supported_providers: AUTO_REFRESH_SUPPORTED_PROVIDERS,
    providers_checked: PROVIDER_ORDER,
    fx_rates_ensure: summarizeFxRatesEnsureStep(fxRatesEnsure),
    balances_pulled: Number(balances.result?.saved_rows || 0),
    updated_balance_rows: Number(balances.result?.saved_rows || 0),
    balance_snapshot: summarizeBalanceStep(balances),
    transfers_imported: transfers.reduce((sum, result) => sum + Number(result.entries || 0), 0),
    transactions_imported: transfers.reduce((sum, result) => sum + Number(result.entries || 0), 0),
    provider_transfers: transfers,
    computed_rows_count: computedRows.length,
    computed_rows_factual_conflicts: computedRows.filter((row) => row.factual_provider_balance === true).length,
    needs_verification_rows: needsVerificationRows,
    provider_failures: providerFailures,
    selected_date_snapshot: selectedDateSnapshot,
    period_balance_reconciliation: periodReconciliation,
    canonical_total: canonicalTotal,
    selected_date_total_usd: canonicalTotal.selected_date_total_usd,
    period_total_usd: canonicalTotal.period_total_usd,
    refresh_report: refreshReport,
    manual_required: refreshReport.manual_actions,
    stale_channels: refreshReport.stale_manual_channels,
    provider_matrix: providerMatrix,
    warnings,
    audit_snapshot: auditSnapshot,
    errors: structuredErrors,
  };
}

function buildRefreshReport({
  balances = {},
  transfers = [],
  providerFailures = [],
  needsVerificationRows = [],
  errors = [],
  providerMatrix = [],
  canonicalTotal = {},
} = {}) {
  const operations = (transfers || [])
    .filter((row) => AUTO_REFRESH_SUPPORTED_PROVIDERS.includes(row.provider))
    .map((row) => ({
      provider: row.provider,
      status: row.status || "unknown",
      imported: Number(row.entries || 0),
      write_status: row.write_status || "processed_provider_movements",
      ...(row.error ? { error: row.error } : {}),
      warnings: Array.isArray(row.warnings) ? row.warnings.slice(0, 10) : [],
    }));
  const balanceRows = (balances?.provider_results || [])
    .filter((row) => AUTO_REFRESH_SUPPORTED_PROVIDERS.includes(row.provider))
    .map((row) => ({
      provider: row.provider,
      status: row.provider_current_balance_status || "unknown",
      updated: Number(row.writable_rows ?? row.rows ?? 0),
      rows: Number(row.rows || 0),
      error: row.error || row.original_provider_error || null,
    }));
  const staleManualChannels = (providerMatrix || [])
    .filter((row) => row.severity === "red" || row.current_balance_auto === false || row.access_status !== "available")
    .map((row) => ({
      provider: row.provider,
      channel: row.channel,
      currency: row.currency,
      status: row.access_status || row.provider_token_status || "needs_verification",
      reason: row.stale_reason || row.reason || row.access_status || "needs_verification",
      action_required: row.action_required || MANUAL_PROVIDER_ACTIONS[row.provider] || "ручной ввод или ручной скриншот",
      severity: row.severity || "red",
    }));
  const reportErrors = uniqueProviderErrors([
    ...providerFailures.map((row) => ({
      provider: row.provider || row.step || "backend",
      reason: row.error || row.message || row.status || "error",
      action_required: actionForFailure(row),
    })),
    ...errors.map((row) => ({
      provider: row.step || "backend",
      reason: row.message || row.error || row.code || "error",
      action_required: "проверить backend-flow и повторить обновление",
    })),
  ]);
  const manualActions = uniqueManualActions([
    ...staleManualChannels,
    ...(needsVerificationRows || []).map((row) => ({
      channel: row.channel || "Не указан",
      currency: row.currency || "UNKNOWN",
      status: row.status || "needs_verification",
      reason: row.reason || "needs_verification",
      action_required: "ручной ввод остатка, ручной скриншот или обновление токена провайдера",
      severity: "red",
    })),
  ]);
  return {
    pulled: [
      ...operations.map((row) => ({
        provider: row.provider,
        status: row.status,
        details: `операции обработаны: ${row.imported}`,
      })),
      ...balanceRows.map((row) => ({
        provider: row.provider,
        status: row.status,
        details: `остатки обновлены: ${row.updated}`,
      })),
    ],
    operations_imported: operations,
    balances_updated: balanceRows,
    provider_failures: reportErrors,
    errors: reportErrors,
    unsupported_channels: staleManualChannels,
    stale_manual_channels: staleManualChannels,
    manual_actions: manualActions,
    provider_matrix: providerMatrix,
    totals: canonicalTotal,
  };
}

async function loadFxRateScriptPrimitives() {
  const module = await import("../scripts/fetch-fx-rates.mjs");
  return {
    readFxRateSheetValues: module.readFxRateSheetValues,
    fetchFxRowsForDate: module.fetchFxRowsForDate,
    applyFxRateRows: module.applyFxRateRows,
  };
}

function summarizeFxRatesEnsureStep(step) {
  const result = step.result || {};
  return {
    ok: Boolean(step.ok && result.ok),
    checked: Number(result.checked || 0),
    already_present: Number(result.already_present || 0),
    missing_before_ensure: Number(result.missing_before_ensure || 0),
    fetched_rows: Number(result.fetched_rows || 0),
    fallback_rows: Number(result.fallback_rows || 0),
    missing_after_ensure: Number(result.missing_after_ensure || 0),
    currencies: result.currencies || [],
    warnings: result.warnings || [],
    errors: result.errors || (step.ok ? [] : [{ message: step.error }]),
    apply_result: result.apply_result || null,
  };
}

async function collectProviderTransfers({ from, to, env, fetchImpl }) {
  const providers = [
    ["wise", () => fetchWiseStatementEntries({
      startDate: from,
      endDate: to,
      apiToken: env.WISE_API_TOKEN,
      profileId: env.WISE_PROFILE_ID,
      baseUrl: env.WISE_API_BASE,
      fetchImpl,
    })],
    ["monobank", () => fetchMonobankStatementEntries({
      startDate: from,
      endDate: to,
      apiToken: env.MONOBANK_API_TOKEN,
      accountId: env.MONOBANK_ACCOUNT_ID,
      baseUrl: env.MONOBANK_API_BASE,
      fetchImpl,
    })],
    ["paypal", () => fetchPayPalStatementEntries({
      startDate: from,
      endDate: to,
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      environment: env.PAYPAL_ENVIRONMENT || "live",
      baseUrl: env.PAYPAL_API_BASE,
      fetchImpl,
    })],
    ["privatbank", () => fetchPrivatBankStatementEntries({
      startDate: from,
      endDate: to,
      apiToken: env.PRIVATBANK_API_TOKEN,
      accountId: env.PRIVATBANK_ACCOUNT_ID,
      baseUrl: env.PRIVATBANK_STATEMENT_URL,
      fetchImpl,
    })],
    ["yoomoney", () => fetchYooMoneyStatementEntries({
      startDate: from,
      endDate: to,
      accessToken: env.YOOMONEY_ACCESS_TOKEN,
      currency: env.YOOMONEY_CURRENCY || "RUB",
      baseUrl: env.YOOMONEY_API_BASE,
      fetchImpl,
    })],
    ["binance", () => fetchBinanceStatementEntries({
      startDate: from,
      endDate: to,
      ...getBinanceProviderConfigFromEnv(env),
      fetchImpl,
    })],
  ];

  const results = [];
  for (const [provider, runner] of providers) {
    const result = await runStep(provider, runner);
    if (!result.ok) {
      results.push({
        provider,
        status: isPermissionError(result.error) ? "needs_permission" : "error",
        entries: 0,
        error: result.error,
        write_status: "not_written_to_ledger",
      });
      continue;
    }
    results.push({
      provider,
      status: "ok",
      entries: Array.isArray(result.result?.entries) ? result.result.entries.length : 0,
      transaction_count: Number(result.result?.transactionCount || 0),
      warnings: Array.isArray(result.result?.warnings) ? result.result.warnings.slice(0, 10) : [],
      write_status: "processed_provider_movements",
    });
  }
  return results;
}

function actionForFailure(row = {}) {
  const status = String(row.status || "").toLowerCase();
  const text = String(row.error || row.message || row.reason || "").toLowerCase();
  if (status.includes("permission") || /token|credential|oauth|permission|secret|api key/.test(text)) {
    return "обновить токен или проверить права API";
  }
  if (status.includes("not_implemented")) return "ручной ввод или ручной скриншот";
  return "проверить ошибку провайдера и повторить обновление";
}

function uniqueProviderErrors(rows = []) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = `${row.provider || ""}|${row.reason || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function uniqueManualActions(rows = []) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = `${row.provider || ""}|${row.channel || ""}|${row.currency || ""}|${row.reason || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values));
}

async function runStep(step, runner) {
  try {
    return { ok: true, step, result: await runner() };
  } catch (error) {
    return { ok: false, step, code: "step_failed", error: safeErrorMessage(error) };
  }
}

function summarizeBalanceStep(step) {
  const result = step.result || {};
  return {
    ok: Boolean(step.ok && result.ok),
    saved_rows: Number(result.saved_rows || 0),
    providers_checked: result.providers_checked || [],
    providers_succeeded: result.providers_succeeded || [],
    providers_failed: result.providers_failed || [],
    provider_results: result.provider_results || [],
    warnings: result.warnings || [],
    error: step.ok ? result.error || null : step.error,
  };
}

function extractBalanceProviderFailures(result) {
  return (result?.provider_results || [])
    .filter((row) => row.error || ["error", "needs_permission"].includes(row.provider_current_balance_status))
    .map((row) => ({
      provider: row.provider,
      status: row.provider_current_balance_status,
      entries: 0,
      error: row.error || row.provider_current_balance_status,
      write_status: "auto_balance_snapshot",
    }));
}

function collectRemainderRows(snapshot) {
  return Array.isArray(snapshot?.balances?.remainders_rows) ? snapshot.balances.remainders_rows : [];
}

function buildNeedsVerificationReason(row) {
  const missing = [];
  if (!Number.isFinite(toNumber(row.opening_amount_usd ?? row.openingUsd))) missing.push("opening_usd");
  if (!Number.isFinite(toNumber(row.closing_amount_usd ?? row.closingUsd))) missing.push("closing_usd");
  if (!Number.isFinite(toNumber(row.delta_amount_usd ?? row.deltaUsd))) missing.push("delta_usd");
  return {
    channel: String(row.channel || row.account || "Не указан"),
    currency: String(row.currency || "UNKNOWN"),
    status: String(row.status || "needs_verification"),
    source: String(row.source || "unknown"),
    reason: missing.length
      ? `missing ${missing.join(", ")}; source=${row.source || "unknown"}`
      : `status=${row.status || "needs_verification"}; source=${row.source || "unknown"}`,
  };
}

function parseRequestBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(String(body || "{}"));
  } catch {
    return {};
  }
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function isTruthy(value) {
  return value === true || value === 1 || /^(1|true|yes)$/i.test(String(value || "").trim());
}

function isPermissionError(message) {
  return /credential|token|permission|not configured|client_id|secret|api key/i.test(String(message || ""));
}

function safeErrorMessage(error) {
  return String(error?.message || error || "unknown error").replace(/\s+/g, " ").slice(0, 500);
}

function buildStructuredError(code, message) {
  return { ok: false, code, error: message };
}
