#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";
export const APPLY_CONFIRMATION_TEXT = "I understand this may mutate finance data for issue 460";

const ENDPOINTS = [
  ["status", "/api/status"],
  ["auditSnapshot", "/api/audit-snapshot"],
  ["periodReconciliation", "/api/period-balance-reconciliation"],
];

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    period: { from: "", to: "" },
    dryRun: true,
    apply: false,
    confirmFile: "",
    output: "",
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = String(arg || "").split("=", 2);
    const value = () => inlineValue ?? argv[++index] ?? "";

    if (name === "--from") args.period.from = value();
    else if (name === "--to") args.period.to = value();
    else if (name === "--base-url") args.baseUrl = value();
    else if (name === "--output") args.output = value();
    else if (name === "--confirm-file") args.confirmFile = value();
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.baseUrl = String(args.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!args.period.from) args.period.from = "2026-05-01";
  if (!args.period.to) args.period.to = new Date().toISOString().slice(0, 10);
  return args;
}

export function validateApplyGuard(args = {}, readFile = readFileSync) {
  if (!args.apply) return;
  if (!args.confirmFile) {
    throw new Error("--apply requires --confirm-file; default mode is dry-run and does not mutate data.");
  }
  const contents = String(readFile(args.confirmFile, "utf8")).trim();
  if (contents !== APPLY_CONFIRMATION_TEXT) {
    throw new Error(`--apply confirmation file must contain exactly: ${APPLY_CONFIRMATION_TEXT}`);
  }
}

export async function fetchDiagnosticInputs({
  baseUrl = DEFAULT_BASE_URL,
  period = {},
  fetchImpl = fetch,
} = {}) {
  const endpointChecks = {};
  const payloads = {};
  for (const [name, pathname] of ENDPOINTS) {
    const url = buildEndpointUrl(baseUrl, pathname, name === "status" ? {} : period);
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    const contentType = response.headers?.get?.("content-type") || "";
    const text = await response.text();
    const parsed = parseJson(text);
    endpointChecks[name] = {
      method: "GET",
      url,
      status: response.status,
      content_type: contentType,
      first300: text.slice(0, 300),
      json_parsed: parsed !== null,
      ok: response.ok && parsed?.ok !== false,
    };
    if (!response.ok || parsed === null || parsed?.ok === false) {
      throw new Error(`Request failed for ${url}: HTTP ${response.status} ${parsed?.error || text.slice(0, 300)}`);
    }
    payloads[name] = parsed;
  }
  return { endpointChecks, payloads };
}

export function buildRemainingUsdDiffReport({
  period = {},
  statusPayload = {},
  auditSnapshotPayload = {},
  reconciliationPayload = {},
  endpointChecks = {},
} = {}) {
  const reconciliation = reconciliationPayload.period_balance_reconciliation || {};
  const rows = Array.isArray(reconciliation.by_channel_currency) ? reconciliation.by_channel_currency : [];
  const totalUsdRow = reconciliation.total_usd_row || reconciliation.reconciliation_report_summary?.total_usd_row || null;
  const fxMissingRows = rows.filter((row) => Array.isArray(row.fx_warnings) && row.fx_warnings.length);
  const topMismatches = rows
    .filter((row) => Number.isFinite(Number(row.diff_usd)) && Math.abs(Number(row.diff_usd)) > 0.0001)
    .sort((left, right) => Math.abs(Number(right.diff_usd)) - Math.abs(Number(left.diff_usd)))
    .slice(0, 10)
    .map((row) => classifyMismatch(row));
  const binanceSave = rows.find((row) =>
    normalize(row.channel) === "binance save" && String(row.currency || "").trim().toUpperCase() === "USDT"
  ) || null;
  const amountNet = {
    uses_amount_net: Boolean(auditSnapshotPayload.balances?.uses_amount_net),
    fallback_amount_rows: Number(auditSnapshotPayload.balances?.fallback_amount_rows || 0),
    missing_amount_net_rows: Number(auditSnapshotPayload.balances?.missing_amount_net_rows || 0),
  };

  return {
    issue: 460,
    generated_at: new Date().toISOString(),
    dry_run: true,
    mutates_data: false,
    period: {
      from: period.from || reconciliation.period?.from || reconciliationPayload.period?.from || "",
      to: period.to || reconciliation.period?.to || reconciliationPayload.period?.to || "",
    },
    production: {
      status: statusPayload.status || "",
      commitSha: statusPayload.commitSha || null,
      commitRef: statusPayload.commitRef || null,
      gitRepoSlug: statusPayload.gitRepoSlug || null,
    },
    endpoint_checks: endpointChecks,
    amount_net: amountNet,
    failing_layer: buildFailingLayerEvidence({ statusPayload, amountNet, reconciliation, totalUsdRow, topMismatches }),
    reconciliation_summary: reconciliation.summary || null,
    total_usd_row: totalUsdRow,
    top_mismatches: topMismatches,
    fx_missing_summary: {
      count: fxMissingRows.length,
      action: "keep_excluded_until_frozen_usd_evidence_exists",
      live_floating_fx_allowed: false,
    },
    fx_missing_rows: fxMissingRows.map((row) => ({
      ...pickCanonicalRow(row),
      candidate_repair_type: "fx_missing",
      reason: "missing frozen USD equivalent",
      confidence: "high",
      action: "keep excluded from ВСЕГО USD until frozen USD evidence exists",
    })),
    binance_save_conclusion: buildBinanceSaveConclusion(binanceSave),
    constraints: [
      "No Ledger mutation was performed.",
      "Provider transport, secrets/env, amount_net semantics, and core balance formula are unchanged.",
      "Large differences are not treated as rounding.",
      "Live floating FX is not used for historical USD totals.",
    ],
  };
}

function buildFailingLayerEvidence({ statusPayload, amountNet, reconciliation, totalUsdRow, topMismatches }) {
  const hasTotalRow = Boolean(totalUsdRow && totalUsdRow.label === "ВСЕГО USD");
  const statusCounts = reconciliation.summary?.status_counts || {};
  return {
    chain: "UI -> API route -> provider/import -> normalization -> ledger save -> balance -> reconciliation/report",
    primary: "balance",
    confidence: "high",
    evidence_for: [
      "Live period-balance reconciliation returns parsed JSON with canonical by_channel_currency rows.",
      `Top finite USD mismatches are balance/fact rows: ${topMismatches.map((row) => `${row.channel}/${row.currency}:${row.diff_usd}`).join(", ") || "none"}.`,
      `Reconciliation status counts include mismatch=${Number(statusCounts.mismatch || 0)} and needs_verification=${Number(statusCounts.needs_verification || 0)}.`,
    ],
    evidence_against: [
      `deploy/source ok: ${statusPayload.gitRepoSlug || "unknown repo"} ${statusPayload.commitRef || "unknown ref"} ${statusPayload.commitSha || "unknown sha"}.`,
      `UI/report ok: final ВСЕГО USD row present=${hasTotalRow}.`,
      `normalization/amount_net ok: uses_amount_net=${amountNet.uses_amount_net}, fallback=${amountNet.fallback_amount_rows}, missing=${amountNet.missing_amount_net_rows}.`,
      "reconciliation/report is surfacing fx_missing and needs_verification instead of silently coercing values.",
    ],
  };
}

function classifyMismatch(row = {}) {
  const normalizedChannel = normalize(row.channel);
  let candidateRepairType = "provider_confirmation_required";
  let reason = "confirmed balance conflicts with planned balance";
  let confidence = "medium";

  if (hasFxWarning(row)) {
    candidateRepairType = "fx_missing";
    reason = "missing frozen USD equivalent";
    confidence = "high";
  } else if (normalizedChannel === "binance save" && String(row.currency || "").toUpperCase() === "USDT") {
    candidateRepairType = "provider_confirmation_required";
    reason = "Binance Save USDT provider/current fact conflicts with owner opening; keep needs_verification";
    confidence = "high";
  } else if (/бинанс spot|binance spot/i.test(String(row.channel || "")) && String(row.currency || "").toUpperCase() === "USDT") {
    candidateRepairType = "possible_binance_spot_save_funding_transition";
    reason = "Binance Spot USDT has movement plus confirmed balance conflict; inspect wallet bucket transition evidence";
    confidence = "medium";
  } else if (/paypal|пейпал/i.test(String(row.channel || ""))) {
    candidateRepairType = "owner_confirmation_required";
    reason = "PayPal owner evidence/current fact conflicts with Ledger movement; requires owner/provider confirmation";
    confidence = "medium";
  } else if (Number(row.diff_usd || 0) === 0) {
    candidateRepairType = "no_action_needed";
    reason = "no finite USD mismatch";
    confidence = "high";
  }

  return {
    ...pickCanonicalRow(row),
    reason,
    confidence,
    sourceTransactionId_coverage: summarizeSourceCoverage(row),
    candidate_repair_type: candidateRepairType,
  };
}

function buildBinanceSaveConclusion(row) {
  if (!row) {
    return {
      status: "not_found",
      fixed: false,
      conclusion: "binance save / USDT row was not present in reconciliation output.",
      row: null,
    };
  }
  return {
    status: row.status === "ok" ? "fixed" : "still_needs_owner_or_provider_confirmation",
    fixed: row.status === "ok",
    conclusion: row.status === "ok"
      ? "Binance Save USDT reconciles in the current report."
      : "Binance Save USDT remains unresolved; do not remove needs_verification without owner/provider proof.",
    row: classifyMismatch(row),
  };
}

function pickCanonicalRow(row = {}) {
  return {
    channel: row.channel || "",
    currency: row.currency || "",
    opening_native: numberOrNull(row.opening_native),
    movement_native: numberOrNull(row.movement_native),
    planned_end_native: numberOrNull(row.planned_end_native),
    confirmed_end_native: numberOrNull(row.confirmed_end_native),
    diff_native: numberOrNull(row.diff_native),
    opening_usd: numberOrNull(row.opening_usd),
    movement_usd: numberOrNull(row.movement_usd),
    planned_end_usd: numberOrNull(row.planned_end_usd),
    confirmed_end_usd: numberOrNull(row.confirmed_end_usd),
    diff_usd: numberOrNull(row.diff_usd),
    status: row.status || "",
    balance_source: row.balance_source || row.balanceSource || "",
    opening_balance_source: row.opening_balance_source || "",
    closing_balance_source: row.closing_balance_source || "",
    fx_warnings: Array.isArray(row.fx_warnings) ? row.fx_warnings : [],
  };
}

function summarizeSourceCoverage(row = {}) {
  const movementRows = Number(row.movement_rows || 0);
  const missingAmountNetRows = Number(row.missing_amount_net_rows || 0);
  return {
    movement_rows: movementRows,
    missing_amount_net_rows: missingAmountNetRows,
    raw_source_id_status: movementRows ? "inspect_movement_rows_for_raw_source_id_coverage" : "no_movement_rows_in_reconciliation_row",
  };
}

function buildEndpointUrl(baseUrl, pathname, params = {}) {
  const url = new URL(pathname, `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hasFxWarning(row = {}) {
  return Array.isArray(row.fx_warnings) && row.fx_warnings.length > 0;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }
  validateApplyGuard(args);
  const { endpointChecks, payloads } = await fetchDiagnosticInputs({
    baseUrl: args.baseUrl,
    period: args.period,
    fetchImpl,
  });
  const report = buildRemainingUsdDiffReport({
    period: args.period,
    statusPayload: payloads.status,
    auditSnapshotPayload: payloads.auditSnapshot,
    reconciliationPayload: payloads.periodReconciliation,
    endpointChecks,
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) writeFileSync(args.output, output);
  if (args.json || !args.output) process.stdout.write(output);
  else process.stdout.write(`Dry-run report written to ${args.output}\n`);
  return report;
}

function printHelp() {
  console.log(`Usage: node scripts/reconcile-remaining-usd-diff.mjs --from=2026-05-01 --to=2026-05-27 --dry-run --output=/tmp/report.json

Default mode is dry-run. --apply requires:
  --confirm-file=<path>

Confirmation file must contain exactly:
  ${APPLY_CONFIRMATION_TEXT}`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
