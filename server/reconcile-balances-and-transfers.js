import { buildAuditSnapshot } from "../api/audit-snapshot.js";
import { fetchMonobankStatementEntries } from "../api/monobank-transactions.js";
import { fetchPayPalStatementEntries } from "../api/paypal-transactions.js";
import { fetchPrivatBankStatementEntries } from "../api/privatbank-transactions.js";
import { fetchWiseStatementEntries } from "../api/wise-transactions.js";
import { fetchYooMoneyStatementEntries } from "../api/yoomoney-transactions.js";
import { fetchBinanceStatementEntries, getBinanceProviderConfigFromEnv } from "./binance-transactions.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { runAutoBalanceSnapshots } from "./auto-balance-snapshots.js";

const PROVIDER_ORDER = ["wise", "monobank", "paypal", "privatbank", "yoomoney", "binance"];

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
  const result = await runReconcileBalancesAndTransfers({
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
  const currentDate = todayUtcDate();
  const balanceDate = currentDate;
  const dryRun = Boolean(options.dryRun);

  const balances = await runStep("auto_balance_snapshots", () => runAutoBalanceSnapshots({
    query: { date: balanceDate, currentDate, dryRun },
    env,
    fetchImpl,
  }));
  const transfers = await collectProviderTransfers({ from, to, env, fetchImpl });
  const audit = await runStep("audit_snapshot", () => buildAuditSnapshot({
    query: { from, to },
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
  }));
  const auditSnapshot = audit.ok ? audit.result : null;
  const computedRows = collectRemainderRows(auditSnapshot).filter((row) => row.computed_balance === true);
  const needsVerificationRows = collectRemainderRows(auditSnapshot)
    .filter((row) => row.needs_verification === true || String(row.status || "").toLowerCase().includes("needs"))
    .map(buildNeedsVerificationReason);
  const balanceStepOk = Boolean(balances.ok && balances.result?.ok !== false);
  const auditStepOk = Boolean(audit.ok && auditSnapshot?.ok !== false);

  return {
    ok: Boolean(balanceStepOk && auditStepOk),
    action: "reconcile-balances-and-transfers",
    period: { from, to },
    mode: dryRun ? "dry_run" : "write_auto_balances_and_read_provider_movements",
    notes: [
      "Current-only providers are saved only for the current date; this endpoint does not claim historical backfill.",
      "Computed balances are returned by audit snapshot only and are not written to Остатки or Авто Остатки as factual rows.",
      "Provider movement fetches are read-only; Ledger save is not called.",
    ],
    providers_checked: PROVIDER_ORDER,
    balances_pulled: Number(balances.result?.saved_rows || 0),
    balance_snapshot: summarizeBalanceStep(balances),
    transfers_imported: transfers.reduce((sum, result) => sum + Number(result.entries || 0), 0),
    provider_transfers: transfers,
    computed_rows_count: computedRows.length,
    computed_rows_factual_conflicts: computedRows.filter((row) => row.factual_provider_balance === true).length,
    needs_verification_rows: needsVerificationRows,
    provider_failures: [
      ...extractBalanceProviderFailures(balances.result),
      ...transfers.filter((result) => result.status === "error" || result.status === "needs_permission"),
    ],
    audit_snapshot: auditSnapshot,
    errors: [
      ...[balances, audit].filter((step) => !step.ok).map((step) => ({
        step: step.step,
        code: step.code,
        message: step.error,
      })),
      ...(!balanceStepOk && balances.ok ? [{
        step: balances.step,
        code: "step_failed",
        message: balances.result?.error || "auto balance snapshot step returned ok=false",
      }] : []),
      ...(!auditStepOk && audit.ok ? [{
        step: audit.step,
        code: "step_failed",
        message: auditSnapshot?.error || "audit snapshot step returned ok=false",
      }] : []),
    ],
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
      write_status: "not_written_to_ledger",
    });
  }
  return results;
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
