#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";

export function buildPeriodReconciliationDiagnosis({
  reconciliationPayload = {},
  auditSnapshot = null,
  dashboardPayload = null,
  csvRows = null,
  drilldownTarget = null,
} = {}) {
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
    movement_drilldown: drilldownTarget ? buildChannelMovementDrilldown({
      reconciliation,
      dashboardPayload,
      csvRows,
      channel: drilldownTarget.channel,
      currency: drilldownTarget.currency,
    }) : null,
    invariants: [
      "Do not invent balances.",
      "Do not copy PayPal gross into amount_net without manual net/fee confirmation.",
      "Do not change balance formula; reconciliation remains amount_net/balance_amount based.",
    ],
  };
}

export function buildChannelMovementDrilldown({
  reconciliation = {},
  dashboardPayload = null,
  csvRows = null,
  channel = "трансервайз дол",
  currency = "USD",
} = {}) {
  const period = reconciliation.period || {};
  const row = (reconciliation.by_channel_currency || [])
    .find((candidate) => candidate.channel === channel && candidate.currency === currency) || null;
  const operations = dashboardPayload?.data?.manual?.operations || dashboardPayload?.manual?.operations || [];
  const targetCurrency = String(currency || "").trim().toUpperCase();
  const openingDate = row?.opening_balance_date || "";
  const movementStart = getMovementWindowStart(openingDate, period.from || "");
  const livePeriodRows = operations
    .filter((operation) => isInPeriod(operation.date, period))
    .filter((operation) => String(operation.currency || operation.ledgerV2?.currency || "").trim().toUpperCase() === targetCurrency)
    .filter((operation) => getOperationChannel(operation, getSignedBalanceAmount(operation)) === channel)
    .map(compactOperationRow);
  const reconciliationRows = livePeriodRows.filter((operation) => isInPeriod(operation.date, { from: movementStart, to: period.to }));
  const openingDateRows = livePeriodRows.filter((operation) => openingDate && operation.date === openingDate);
  const parsedCsvRows = Array.isArray(csvRows) ? csvRows : [];
  const csvTargetRows = parsedCsvRows
    .filter((csvRow) => isInPeriod(csvRow.date, period))
    .filter((csvRow) => String(csvRow.currency || "").trim().toUpperCase() === targetCurrency)
    .filter((csvRow) => String(csvRow.from_channel || csvRow.to_channel || "").trim() === channel)
    .map(compactCsvRow);

  const liveKeys = new Set(livePeriodRows.map((operation) => operation.raw_source_id).filter(Boolean));
  const csvKeys = new Set(csvTargetRows.map((operation) => operation.raw_source_id).filter(Boolean));
  const csvSummary = summarizeRows(csvTargetRows);
  const liveSummary = summarizeRows(livePeriodRows);
  const reconciliationSummary = summarizeRows(reconciliationRows);
  const openingDateSummary = summarizeRows(openingDateRows);
  const csvGrossOutflow = csvSummary.outflow_gross;
  const liveRealOutflow = round(Number(row?.real_outflow ?? reconciliationSummary.outflow_net ?? 0));
  const liveRealInflow = round(Number(row?.real_inflow ?? reconciliationSummary.income ?? 0));
  const displayedNetMovement = Math.abs(Number(row?.real_delta || reconciliationSummary.net_movement || 0));
  const csvGrossVsNetGap = round(csvSummary.outflow_gross - csvSummary.outflow_net);
  const explainedDifference = round(
    liveRealInflow
    + openingDateSummary.outflow_net
    + csvGrossVsNetGap
  );
  const residual = round((csvGrossOutflow - displayedNetMovement) - explainedDifference);
  const csvGrossToNetMovementExplanation = {
    csv_gross_outflow: csvGrossOutflow,
    live_real_outflow: liveRealOutflow,
    live_real_inflow: liveRealInflow,
    opening_date_excluded_net_outflow: openingDateSummary.outflow_net,
    gross_vs_net_gap: csvGrossVsNetGap,
    displayed_net_movement: round(displayedNetMovement),
    residual,
  };

  return {
    channel,
    currency: targetCurrency,
    period,
    explanation: "CSV export total is gross outflow. Reconciliation movement is net movement: real_outflow - real_inflow, from after the opening snapshot date, using amount_net.",
    csv_gross_to_net_movement_explanation: csvGrossToNetMovementExplanation,
    opening: {
      balance: row?.opening_balance ?? null,
      date: openingDate || null,
      movement_start: movementStart || period.from || null,
    },
    reconciliation: {
      real_inflow: row?.real_inflow ?? reconciliationSummary.income,
      real_outflow: row?.real_outflow ?? reconciliationSummary.outflow_net,
      real_delta: row?.real_delta ?? reconciliationSummary.net_movement,
      movement_rows: row?.movement_rows ?? reconciliationRows.length,
      calculated_closing: row?.calculated_closing_balance ?? null,
      fact_closing: row?.factual_closing_balance ?? null,
      difference: row?.real_difference ?? null,
      formula: row?.formula || "",
    },
    summaries: {
      csv_period: csvSummary,
      live_ledger_period: liveSummary,
      reconciliation_window: reconciliationSummary,
      opening_date_excluded_from_reconciliation: openingDateSummary,
    },
    csv_vs_reconciliation_difference: {
      csv_gross_outflow: csvGrossOutflow,
      ui_movement_abs: round(displayedNetMovement),
      difference: round(csvGrossOutflow - displayedNetMovement),
      explained_by: {
        live_income_net: liveRealInflow,
        opening_date_outflow_net_excluded: openingDateSummary.outflow_net,
        csv_gross_vs_net_gap: csvGrossVsNetGap,
        explained_difference: explainedDifference,
        residual,
      },
    },
    rows: {
      reconciliation_window: reconciliationRows,
      opening_date_excluded_from_reconciliation: openingDateRows,
      live_extra_not_in_csv: livePeriodRows.filter((operation) => operation.raw_source_id && !csvKeys.has(operation.raw_source_id)),
      csv_missing_from_live: csvTargetRows.filter((operation) => operation.raw_source_id && !liveKeys.has(operation.raw_source_id)),
      exchange_out: livePeriodRows.filter((operation) => operation.operation === "exchange_out"),
      refunds_or_income: livePeriodRows.filter((operation) => operation.signed_amount > 0),
      yellowsquare: livePeriodRows.filter((operation) => /yellowsquare/i.test(operation.comment || "")),
      top_rows_by_abs_amount: [...livePeriodRows].sort((left, right) => Math.abs(right.signed_amount) - Math.abs(left.signed_amount)).slice(0, 15),
    },
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
  const args = { baseUrl: DEFAULT_BASE_URL, channel: "", currency: "", csv: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") args.from = argv[++index];
    else if (arg === "--to") args.to = argv[++index];
    else if (arg === "--base-url") args.baseUrl = argv[++index];
    else if (arg === "--channel") args.channel = argv[++index];
    else if (arg === "--currency") args.currency = argv[++index];
    else if (arg === "--csv") args.csv = argv[++index];
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
  const drilldownTarget = args.channel || args.currency || args.csv
    ? { channel: args.channel || "трансервайз дол", currency: args.currency || "USD" }
    : null;
  const dashboardPayload = drilldownTarget
    ? await fetchJson(buildUrl(args.baseUrl, "/api", { action: "getDashboardData", ...params }))
    : null;
  const csvRows = args.csv ? parseCsv(await readFile(args.csv, "utf8")) : null;
  const diagnosis = buildPeriodReconciliationDiagnosis({
    reconciliationPayload,
    auditSnapshot,
    dashboardPayload,
    csvRows,
    drilldownTarget,
  });
  if (args.json) console.log(JSON.stringify(diagnosis, null, 2));
  else {
    console.log(`Period ${diagnosis.period.from || ""}..${diagnosis.period.to || ""}: ${diagnosis.summary.status}`);
    console.log(JSON.stringify(diagnosis.summary, null, 2));
  }
}

function getMovementWindowStart(openingDate, from) {
  if (!openingDate) return from || "";
  const afterOpening = addDays(openingDate, 1);
  if (!from) return afterOpening;
  if (openingDate === from) return afterOpening;
  return afterOpening && afterOpening < from ? from : afterOpening;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isInPeriod(date, period = {}) {
  const value = String(date || "").slice(0, 10);
  if (!value) return false;
  if (period.from && value < period.from) return false;
  if (period.to && value > period.to) return false;
  return true;
}

function compactOperationRow(operation = {}) {
  const signedAmount = getSignedBalanceAmount(operation);
  return {
    sheet_row: operation.sheetRowNumber || null,
    date: String(operation.date || operation.ledgerV2?.date || "").slice(0, 10),
    operation: operation.operation || operation.ledgerV2?.operation || "",
    direction: operation.direction || "",
    from_channel: operation.fromChannel || operation.ledgerV2?.from_channel || "",
    to_channel: operation.toChannel || operation.ledgerV2?.to_channel || "",
    amount: parseNumber(operation.amount),
    amount_usd: parseNumber(operation.amountUsd ?? operation.amount_usd),
    gross: parseNumber(operation.amountGross ?? operation.ledgerV2?.amount_gross ?? operation.amount),
    fee: parseNumber(operation.amountFee ?? operation.ledgerV2?.amount_fee),
    net: parseNumber(operation.amountNet ?? operation.ledgerV2?.amount_net ?? operation.amount),
    signed_amount: signedAmount,
    source: operation.source || operation.ledgerV2?.source || "",
    raw_source_id: getRawSourceId(operation),
    comment: operation.comment || "",
  };
}

function compactCsvRow(row = {}) {
  const operation = String(row.operation || "").trim();
  const net = parseNumber(row.net ?? row.amount_net ?? row.amount) || 0;
  const signedAmount = operation === "income" || operation === "exchange_in"
    ? Math.abs(net)
    : -Math.abs(net);
  return {
    sheet_row: null,
    date: String(row.date || "").slice(0, 10),
    operation,
    direction: row.direction || "",
    from_channel: row.from_channel || "",
    to_channel: row.to_channel || "",
    amount: parseNumber(row.amount),
    amount_usd: parseNumber(row.amount_usd),
    gross: parseNumber(row.gross ?? row.amount),
    fee: parseNumber(row.fee),
    net,
    signed_amount: signedAmount,
    source: row.source || "",
    raw_source_id: String(row.raw_source_id || row.external_id || "").trim(),
    comment: row.comment || "",
  };
}

function summarizeRows(rows = []) {
  const summary = {
    count: rows.length,
    income: 0,
    outflow_gross: 0,
    outflow_net: 0,
    net_movement: 0,
    transfers: 0,
    exchange_out: 0,
    refunds: 0,
    by_operation: {},
    by_merchant_top: [],
  };
  const byMerchant = {};
  for (const row of rows) {
    const signed = Number(row.signed_amount || 0);
    summary.net_movement += signed;
    if (signed > 0) summary.income += signed;
    if (signed < 0) {
      summary.outflow_gross += Number(row.gross || 0);
      summary.outflow_net += Math.abs(signed);
    }
    if (/transfer/i.test(row.operation || "")) summary.transfers += signed;
    if (row.operation === "exchange_out") summary.exchange_out += Math.abs(signed);
    if (signed > 0 && /refund|correction|возврат/i.test(row.comment || "")) summary.refunds += signed;
    summary.by_operation[row.operation || "unknown"] = round((summary.by_operation[row.operation || "unknown"] || 0) + signed);
    const merchant = normalizeMerchant(row.comment || "");
    byMerchant[merchant] = round((byMerchant[merchant] || 0) + signed);
  }
  for (const key of ["income", "outflow_gross", "outflow_net", "net_movement", "transfers", "exchange_out", "refunds"]) {
    summary[key] = round(summary[key]);
  }
  summary.by_merchant_top = Object.entries(byMerchant)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 12)
    .map(([merchant, amount]) => ({ merchant, amount }));
  return summary;
}

function normalizeMerchant(comment) {
  return String(comment || "")
    .replace(/^Card transaction of [^ ]+ [A-Z]{3} issued by /, "")
    .slice(0, 80);
}

function getSignedBalanceAmount(operation = {}) {
  return parseNumber(operation.ledgerV2?.balance_amount ?? operation.balanceAmount) || 0;
}

function getOperationChannel(operation = {}, signedAmount = 0) {
  const ledger = operation.ledgerV2 || {};
  if (signedAmount < 0) return String(ledger.from_channel || operation.fromChannel || operation.toChannel || "").trim();
  return String(ledger.to_channel || operation.toChannel || operation.fromChannel || "").trim();
}

function getRawSourceId(operation = {}) {
  const ledger = operation.ledgerV2 || {};
  return String(operation.rawSourceId || operation.raw_source_id || operation.externalId || operation.external_id || ledger.external_id || "").trim();
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuotes) {
      if (char === "\"") {
        if (input[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows.shift() || [];
  return rows
    .filter((values) => values.some((value) => String(value || "").trim()))
    .map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
