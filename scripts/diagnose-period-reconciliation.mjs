#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";

export function buildPeriodReconciliationDiagnosis({ reconciliationPayload = {}, auditSnapshot = null } = {}) {
  const reconciliation = reconciliationPayload.period_balance_reconciliation || reconciliationPayload.reconciliation || {};
  const rows = Array.isArray(reconciliation.by_channel_currency) ? reconciliation.by_channel_currency : [];
  const summary = reconciliation.summary || {};
  const statusCounts = summary.status_counts || {};
  const actionableRows = Array.isArray(reconciliation.actionable_rows) ? reconciliation.actionable_rows : rows.filter((row) => row.status !== "ok");
  const wiseUsd = rows.find((row) => normalize(row.channel).includes("трансервайз дол") && row.currency === "USD") || null;

  return {
    ok: Boolean(reconciliationPayload.ok ?? true),
    generated_at: reconciliationPayload.generated_at || "",
    period: reconciliation.period || reconciliationPayload.period || {},
    summary: {
      status: summary.status || "needs_verification",
      positions_checked: Number(summary.positions_checked || 0),
      missing_amount_net: Number(statusCounts.missing_amount_net || summary.missing_amount_net_rows || 0),
      missing_opening_balance: Number(statusCounts.missing_opening_balance || 0),
      missing_provider_balance: Number(statusCounts.missing_provider_balance || 0),
      mismatch: Number(statusCounts.mismatch || 0),
      blocked: Number(summary.blocked || 0),
      actionable_rows: actionableRows.length,
    },
    wise_usd: wiseUsd ? pickReconciliationRow(wiseUsd) : null,
    blockers: buildBlockers(actionableRows),
    balance_template_rows: buildBalanceTemplateRows(actionableRows, reconciliation.period || reconciliationPayload.period || {}),
    paypal_manual_confirmations: buildPayPalManualConfirmations(actionableRows),
    historical_wise_diagnostic: buildHistoricalWiseDiagnostic(auditSnapshot),
    invariants: [
      "Do not invent balances.",
      "Do not copy PayPal gross into amount_net without manual net/fee confirmation.",
      "Do not change balance formula; reconciliation remains amount_net/balance_amount based.",
    ],
  };
}

function buildBlockers(rows = []) {
  const byStatus = {};
  for (const row of rows) {
    const status = row.status || "needs_verification";
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(pickReconciliationRow(row));
  }
  return byStatus;
}

function buildBalanceTemplateRows(rows = [], period = {}) {
  return rows
    .filter((row) => row.status === "missing_provider_balance" || row.status === "missing_opening_balance")
    .map((row) => ({
      date: row.status === "missing_opening_balance" ? previousDate(period.from || "") : (period.to || row.date || row.factual_closing_balance_date || ""),
      required_before_or_on: row.status === "missing_opening_balance" ? (period.from || "") : "",
      channel: row.channel || "",
      currency: row.currency || "",
      confirmed_balance: "",
      computed_reference_balance: row.computed_real_closing_balance ?? "",
      purpose: row.status,
      verification_source: "",
      safe_to_apply: false,
      action: row.status === "missing_opening_balance"
        ? "Fill factual opening balance from provider/manual statement before the first movement."
        : "Fill factual closing balance from provider/manual statement for the period end date.",
    }));
}

function buildPayPalManualConfirmations(rows = []) {
  return rows
    .filter((row) => row.status === "missing_amount_net")
    .filter((row) => /paypal|пейпал/i.test(row.channel || ""))
    .map((row) => ({
      channel: row.channel || "",
      currency: row.currency || "",
      confirmed_amount_net: "",
      confirmed_fee: "",
      confirmation_source: "",
      safe_to_apply: false,
      action: "Confirm PayPal personal net/fee manually before writing amount_net.",
    }));
}

function buildHistoricalWiseDiagnostic(auditSnapshot) {
  const dailyRows = auditSnapshot?.daily_balances?.rows || [];
  const wiseMismatches = dailyRows
    .filter((row) => /wise|трансервайз/i.test(row.channel || ""))
    .filter((row) => row.status === "mismatch")
    .map((row) => ({
      date: row.date || "",
      channel: row.channel || "",
      currency: row.currency || "",
      opening_balance: row.opening_balance ?? null,
      net_change: row.net_change ?? null,
      closing_balance: row.closing_balance ?? null,
      provider_reported_balance: row.provider_reported_balance ?? null,
      difference: row.difference ?? null,
      safe_to_apply: false,
      action: "Dry-run only: inspect old Wise CARD/provider rows and apply only provider-proven net corrections.",
    }));
  return {
    dry_run: true,
    safe_corrections_to_apply: [],
    mismatch_rows: wiseMismatches,
  };
}

function pickReconciliationRow(row = {}) {
  return {
    channel: row.channel || "",
    currency: row.currency || "",
    status: row.status || "",
    opening_balance: row.opening_balance ?? null,
    opening_balance_date: row.opening_balance_date || null,
    real_delta: row.real_delta ?? null,
    factual_closing_balance: row.factual_closing_balance ?? null,
    factual_closing_balance_date: row.factual_closing_balance_date || null,
    real_difference: row.real_difference ?? null,
    movement_rows: Number(row.movement_rows || 0),
    missing_amount_net_rows: Number(row.missing_amount_net_rows || 0),
    formula: row.formula || "",
    fix_action: row.fix_action || "",
  };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function previousDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function parseArgs(argv = []) {
  const args = { baseUrl: DEFAULT_BASE_URL };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") args.from = argv[++index];
    else if (arg === "--to") args.to = argv[++index];
    else if (arg === "--base-url") args.baseUrl = argv[++index];
    else if (arg === "--json") args.json = true;
  }
  return args;
}

function buildUrl(baseUrl, pathname, params = {}) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(`Request failed for ${url}: HTTP ${response.status} ${payload?.error || text.slice(0, 300)}`);
  }
  return payload;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const params = { from: args.from, to: args.to };
  const reconciliationPayload = await fetchJson(buildUrl(args.baseUrl, "/api", { action: "periodBalanceReconciliation", ...params }));
  const auditSnapshot = await fetchJson(buildUrl(args.baseUrl, "/api/audit-snapshot", params)).catch(() => null);
  const diagnosis = buildPeriodReconciliationDiagnosis({ reconciliationPayload, auditSnapshot });
  if (args.json) console.log(JSON.stringify(diagnosis, null, 2));
  else {
    console.log(`Period ${diagnosis.period.from || ""}..${diagnosis.period.to || ""}: ${diagnosis.summary.status}`);
    console.log(JSON.stringify(diagnosis.summary, null, 2));
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
