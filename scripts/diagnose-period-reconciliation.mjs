#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";
const TOP_MISMATCH_TARGETS = [
  { date: "2026-05-05", channel: "Яндекс руб", currency: "RUB", reported_difference: 141136.88 },
  { date: "2026-04-27", channel: "Яндекс руб", currency: "RUB", reported_difference: -2755.86 },
  { date: "2026-05-04", channel: "монобанк грн", currency: "UAH", reported_difference: 1000 },
  { date: "2026-05-04", channel: "пейпал евр", currency: "EUR", reported_difference: -241.14 },
  { date: "2026-05-09", channel: "трансервайз дол", currency: "USD", reported_difference: 165.32 },
  { date: "2026-05-12", channel: "трансервайз дол", currency: "USD", reported_difference: -138.59 },
];

export function buildPeriodReconciliationDiagnosis({ reconciliationPayload = {}, auditSnapshot = null, dashboardData = null } = {}) {
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
    top_mismatch_diagnostics: buildTopMismatchDiagnostics({
      auditSnapshot,
      dashboardData,
      reconciliationRows: rows,
    }),
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

function buildTopMismatchDiagnostics({ auditSnapshot = null, dashboardData = null, reconciliationRows = [] } = {}) {
  const dailyRows = Array.isArray(auditSnapshot?.daily_balances?.rows) ? auditSnapshot.daily_balances.rows : [];
  const coverageRows = Array.isArray(auditSnapshot?.balance_coverage?.accounts) ? auditSnapshot.balance_coverage.accounts : [];
  const manual = dashboardData?.data?.manual || dashboardData?.manual || {};
  const operations = Array.isArray(manual.operations) ? manual.operations : [];
  const balanceRows = [
    ...tagBalanceRows(manual.balanceRows || manual.balances || [], "manual"),
    ...tagBalanceRows(manual.autoBalances || manual.auto_balance_rows || [], "provider_auto"),
  ];

  return TOP_MISMATCH_TARGETS.map((target) => {
    const daily = findTargetRow(dailyRows, target) || findTargetRow(coverageRows, target) || {};
    const reconciliation = findReconciliationRow(reconciliationRows, target) || {};
    const contributingRows = findLedgerRows(operations, target);
    const manualFacts = findBalanceRows(balanceRows, target, "manual");
    const providerFacts = findBalanceRows(balanceRows, target, "provider_auto");
    const openingBalance = findOpeningBalance(balanceRows, target);
    const factualClosing = providerFacts[0] || manualFacts[0] || null;
    const computedClosing = firstValue(daily.closing_balance, daily.computed_closing_balance, reconciliation.computed_real_closing_balance);
    const inflow = firstValue(daily.inflow, reconciliation.inflow);
    const outflow = firstValue(daily.outflow, reconciliation.outflow);
    const difference = firstValue(daily.difference, daily.real_difference, reconciliation.real_difference, target.reported_difference);

    return {
      date: target.date,
      channel: target.channel,
      currency: target.currency,
      reported_difference: target.reported_difference,
      evidence_status: classifyEvidenceStatus({ target, daily, reconciliation, manualFacts, providerFacts, contributingRows }),
      ledger_contributing_rows: contributingRows,
      amount_net_signs: contributingRows.map((row) => ({
        sheet_row: row.sheet_row,
        raw_source_id: row.raw_source_id,
        amount_net: row.amount_net,
        balance_amount: row.balance_amount,
        sign: row.balance_amount > 0 ? "positive" : row.balance_amount < 0 ? "negative" : "zero_or_missing",
      })),
      ostatki_rows: manualFacts,
      auto_ostatki_rows: providerFacts,
      provider_balance_rows: providerFacts,
      opening_balance: openingBalance ? openingBalance.amount : firstValue(daily.opening_balance, reconciliation.opening_balance),
      opening_balance_source: openingBalance ? openingBalance.source : (daily.opening_balance_source || null),
      inflow: inflow ?? null,
      outflow: outflow ?? null,
      computed_closing: computedClosing ?? null,
      expected_closing_hint: computedClosing ?? null,
      factual_closing: factualClosing ? factualClosing.amount : firstValue(daily.provider_reported_balance, reconciliation.factual_closing_balance),
      factual_closing_source: factualClosing ? factualClosing.source : (daily.provider_reported_balance_source || daily.balance_source || null),
      difference: difference ?? null,
      safe_to_apply: false,
    };
  });
}

function tagBalanceRows(rows = [], fallbackSource) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    source: normalizeBalanceSource(row, fallbackSource),
  }));
}

function findTargetRow(rows = [], target) {
  return (rows || []).find((row) =>
    row?.date === target.date &&
      normalize(row?.channel) === normalize(target.channel) &&
      String(row?.currency || "").trim().toUpperCase() === target.currency
  ) || null;
}

function findReconciliationRow(rows = [], target) {
  return (rows || []).find((row) =>
    normalize(row?.channel) === normalize(target.channel) &&
      String(row?.currency || "").trim().toUpperCase() === target.currency
  ) || null;
}

function findLedgerRows(operations = [], target) {
  return (operations || [])
    .filter((row) => normalizeDate(row?.date || row?.ledgerV2?.date) === target.date)
    .filter((row) => String(row?.currency || row?.ledgerV2?.currency || "").trim().toUpperCase() === target.currency)
    .filter((row) => normalize(getMovementChannel(row)) === normalize(target.channel))
    .map((row) => {
      const ledger = row?.ledgerV2 || {};
      return {
        sheet_row: row.sheetRowNumber || row.sheet_row || null,
        date: normalizeDate(row.date || ledger.date),
        operation: ledger.operation || row.operation || "",
        from_channel: ledger.from_channel || row.fromChannel || "",
        to_channel: ledger.to_channel || row.toChannel || "",
        source: ledger.source || row.source || "",
        raw_source_id: ledger.raw_source_id || row.rawSourceId || row.raw_source_id || ledger.external_id || row.externalId || row.external_id || "",
        amount_gross: parseAmount(ledger.amount_gross ?? row.amountGross ?? row.amount_gross),
        amount_fee: parseAmount(ledger.amount_fee ?? row.amountFee ?? row.amount_fee),
        amount_net: parseAmount(ledger.amount_net ?? row.amountNet ?? row.amount_net),
        balance_amount: parseAmount(ledger.balance_amount ?? row.balanceAmount),
      };
    });
}

function findBalanceRows(rows = [], target, source) {
  return (rows || [])
    .filter((row) => row.source === source)
    .filter((row) => normalizeDate(row.date) === target.date)
    .filter((row) => normalize(row.channel || row.accountName || row.account) === normalize(target.channel))
    .filter((row) => String(row.currency || "").trim().toUpperCase() === target.currency)
    .map(formatBalanceRow);
}

function findOpeningBalance(rows = [], target) {
  return (rows || [])
    .filter((row) => normalizeDate(row.date) < target.date)
    .filter((row) => normalize(row.channel || row.accountName || row.account) === normalize(target.channel))
    .filter((row) => String(row.currency || "").trim().toUpperCase() === target.currency)
    .sort((left, right) => normalizeDate(left.date).localeCompare(normalizeDate(right.date)))
    .map(formatBalanceRow)
    .at(-1) || null;
}

function formatBalanceRow(row = {}) {
  return {
    date: normalizeDate(row.date),
    channel: row.channel || row.accountName || row.account || "",
    currency: String(row.currency || "").trim().toUpperCase(),
    amount: parseAmount(row.balanceAmount ?? row.amount),
    source: row.source || "manual",
    source_sheet: row.sourceSheet || "",
  };
}

function classifyEvidenceStatus({ target, daily = {}, reconciliation = {}, manualFacts = [], providerFacts = [], contributingRows = [] }) {
  if (/paypal|пейпал/i.test(target.channel) && contributingRows.some((row) => row.amount_net === null)) return "needs_verification";
  if (providerFacts.length || daily.provider_reported_balance_source === "provider_auto" || daily.balance_source === "provider_auto") return "provider_confirmed";
  if (manualFacts.length || daily.provider_reported_balance !== undefined || reconciliation.factual_closing_balance !== undefined) return "manual_confirmed";
  if (daily.status === "needs_verification" || reconciliation.status === "needs_verification") return "needs_verification";
  return "missing_fact";
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

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function getMovementChannel(row = {}) {
  const ledger = row.ledgerV2 || {};
  const balanceAmount = parseAmount(ledger.balance_amount ?? row.balanceAmount);
  const operation = String(ledger.operation || row.operation || "").trim();
  if (operation === "expense" || balanceAmount < 0) return ledger.from_channel || row.fromChannel || "";
  return ledger.to_channel || row.toChannel || ledger.from_channel || row.fromChannel || "";
}

function normalizeBalanceSource(row = {}, fallback = "manual") {
  const marker = [row.source, row.fact_source, row.provider, row.sourceSheet]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (/provider_auto|auto snapshot|авто|wise|paypal|monobank|binance|privat|yoomoney/.test(marker)) return "provider_auto";
  return fallback;
}

function parseAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
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
  const dashboardData = await fetchJson(buildUrl(args.baseUrl, "/api", { action: "getDashboardData", ...params })).catch(() => null);
  const diagnosis = buildPeriodReconciliationDiagnosis({ reconciliationPayload, auditSnapshot, dashboardData });
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
