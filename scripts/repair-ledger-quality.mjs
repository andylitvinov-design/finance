#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildDailyCurrencyBalances } from "../server/daily-balance-engine.js";
import { mergeManualAndAutoBalances } from "../server/balance-snapshot-merge.js";
import {
  buildProviderLedgerReconciliation,
  buildYooMoneyProviderEvidenceFixture,
} from "../server/provider-ledger-reconciliation-engine.js";
import {
  getManualGoogleSheetsAccessToken,
  MANUAL_LEDGER_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  loadManualRepositoryFromGoogleSheets,
  SHEETS_API_BASE_URL,
} from "../server/manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const LEDGER_RANGE_COLUMNS = "A:V";
const TASKS = new Set(["all", "missing-amount-net", "mismatches", "missing-balances", "normalize-sources", "yoomoney-reconcile"]);
const TASK_ALIASES = new Map([
  ["mismatch-report", "mismatches"],
  ["mismatch", "mismatches"],
]);
const SOURCE_ONLY_FIELDS = new Set(["source", "updated_at"]);
const MISSING_NET_FIELDS = new Set(["amount_net", "source", "comment", "updated_at"]);

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    confirmFile: "",
    json: false,
    task: "all",
    from: "",
    to: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--task") options.task = normalizeTaskName(argv[++index] || "");
    else if (arg === "--from") options.from = normalizeDate(argv[++index] || "");
    else if (arg === "--to") options.to = normalizeDate(argv[++index] || "");
    else if (arg === "--confirm-file") options.confirmFile = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!TASKS.has(options.task)) {
    throw new Error(`Unsupported --task: ${options.task || "(empty)"}`);
  }
  return options;
}

export function buildLedgerQualityRepairReport({
  repository = {},
  confirmations = {},
  now = new Date().toISOString(),
  task = "all",
  period = {},
} = {}) {
  task = normalizeTaskName(task);
  const operations = Array.isArray(repository.operations) ? repository.operations : [];
  const balances = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalances = Array.isArray(repository.autoBalances) ? repository.autoBalances : [];
  const mergedBalanceResult = mergeManualAndAutoBalances(balances, autoBalances);
  const mergedBalances = mergedBalanceResult.rows || mergedBalanceResult.merged || [];
  const missingAmountNet = shouldRun(task, "missing-amount-net")
    ? buildMissingAmountNetReport({ operations, confirmations, now })
    : emptyTaskReport();
  const normalizeSources = shouldRun(task, "normalize-sources")
    ? buildNormalizeSourcesReport({ operations, confirmations, now })
    : emptyTaskReport();
  const mismatchReport = shouldRun(task, "mismatches")
    ? buildMismatchReport({ operations, balances })
    : emptyTaskReport();
  const missingBalances = shouldRun(task, "missing-balances")
    ? buildMissingBalancesReport({ operations, balances, autoBalances, mergedBalances })
    : emptyTaskReport();
  const yoomoneyReconcile = shouldRun(task, "yoomoney-reconcile")
    ? buildYooMoneyReconciliationReport({ operations, balances: mergedBalances, period })
    : emptyTaskReport();
  const balancesSummary = buildBalancesSummary(operations);

  return {
    dryRun: true,
    generatedAt: now,
    tasks: task === "all" ? [...TASKS].filter((value) => value !== "all") : [task],
    summary: {
      ledger_rows: operations.length,
      uses_amount_net: true,
      fallback_amount_rows: 0,
      missing_amount_net_rows: balancesSummary.missing_amount_net_rows,
      excluded_missing_amount_net_rows: balancesSummary.excluded_missing_amount_net_rows,
      unknown_source_rows: normalizeSources.summary.detected,
    },
    balances: balancesSummary,
    missingAmountNet,
    mismatchReport,
    missingBalances,
    normalizeSources,
    yoomoneyReconcile,
  };
}

export function buildYooMoneyReconciliationReport({ operations = [], balances = [], period = {} } = {}) {
  const from = normalizeDate(period.from) || "2026-04-01";
  const to = normalizeDate(period.to) || "2026-05-19";
  const daily = buildDailyCurrencyBalances(operations, balances);
  const balanceDiagnostics = (daily.rows || [])
    .filter((row) => row.channel === "Яндекс руб" && row.currency === "RUB")
    .filter((row) => row.status && row.status !== "ok");
  const report = buildProviderLedgerReconciliation({
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    providerEvidence: buildYooMoneyProviderEvidenceFixture(),
    ledgerRows: operations,
    balanceDiagnostics,
    period: { from, to },
  });
  return {
    ...report,
    summary: {
      detected: report.row_level.provider_rows.length + report.row_level.ledger_rows.length,
      wouldUpdate: 0,
      updated: 0,
      skipped: report.manual_confirmation_required_rows.length,
      needsManualVerification: report.manual_confirmation_required_rows.length,
    },
  };
}

export function buildMissingAmountNetReport({ operations = [], confirmations = {}, now = new Date().toISOString() } = {}) {
  const rows = operations
    .filter((row) => !hasText(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net))
    .map((row) => buildMissingAmountNetRow({ row, confirmations, now }));
  return {
    rows,
    summary: summarizeRows(rows),
  };
}

function buildMissingAmountNetRow({ row, confirmations = {}, now }) {
  const confirmation = findConfirmation(row, confirmations);
  const paypal = isPayPalRow(row);
  const before = compactLedgerRow(row);
  const after = confirmation
    ? buildConfirmedAmountNetPatch({ row, confirmation, now })
    : null;
  const classification = paypal
    ? "paypal_personal_needs_manual_confirmation"
    : inferSafeSource(row)
      ? "simple_provider_safe_to_fill"
      : "needs_manual_verification";
  return {
    ...before,
    classification,
    warning_status: paypal ? "fee_unavailable_personal_account" : "",
    recommended_amount_net: confirmation ? String(confirmation.amount_net ?? confirmation.amountNet) : null,
    before,
    after,
    action: after
      ? "apply confirmed amount_net only; keep PayPal fee unavailable"
      : "skip until exact provider/manual amount_net is confirmed",
    skippedReason: after ? "" : "amount_net is not manually/provider confirmed",
  };
}

function buildConfirmedAmountNetPatch({ row, confirmation, now }) {
  const amountNet = String(confirmation.amount_net ?? confirmation.amountNet ?? "").trim();
  if (!amountNet) return null;
  const rawSourceId = getRawSourceId(row);
  const confirmedRawSourceId = String(confirmation.raw_source_id ?? confirmation.rawSourceId ?? rawSourceId).trim();
  if (confirmedRawSourceId && rawSourceId && confirmedRawSourceId !== rawSourceId) return null;
  const comment = appendCommentMarker(getComment(row), "manual_provider_confirmed fee_unavailable_personal_account");
  return {
    amount_net: amountNet,
    amount_fee: getAmountFee(row),
    source: "paypal_personal_manual",
    comment,
    updated_at: now,
  };
}

export function buildNormalizeSourcesReport({ operations = [], confirmations = {}, now = new Date().toISOString() } = {}) {
  const rows = operations
    .filter((row) => isUnknownSource(row))
    .map((row) => {
      const safeSource = inferSafeSource(row, confirmations);
      const before = compactLedgerRow(row);
      return {
        ...before,
        group: buildUnknownSourceGroup(row),
        evidence: buildSourceEvidence(row),
        risk: safeSource ? "low" : "ambiguous",
        recommendation: safeSource ? "apply" : "skip",
        before,
        after: safeSource ? { source: safeSource, updated_at: now } : null,
        skippedReason: safeSource ? "" : "ambiguous source evidence",
      };
    });
  return {
    rows,
    groups: groupUnknownSourceRows(rows),
    summary: summarizeRows(rows),
  };
}

export function inferSafeSource(row, confirmations = {}) {
  const confirmation = findConfirmation(row, confirmations);
  if (confirmation?.source) return normalizeTargetSource(confirmation.source);
  const text = normalizeText([
    getRawSource(row),
    getRawSourceId(row),
    getComment(row),
    getFromChannel(row),
    getToChannel(row),
  ].join(" "));
  if (isPayPalRow(row)) return confirmation ? "paypal_personal_manual" : "paypal";
  if (/(wise|transferwise|трансервайз)/.test(text)) return "wise";
  if (/(monobank|mono|монобанк)/.test(text)) return "monobank";
  if (/(privat|приват|приват24|приват фоп|приват-фоп)/.test(text)) return "privatbank";
  if (/(tdbank|td bank|td_bank|банк канада|канада cad)/.test(text)) return "td_bank";
  if (/(binance|бинанс)/.test(text)) return "binance";
  if (/(yoomoney|yoo money|youmoney|yamoney|yandex|яндекс|юмани|юmoney|юмоней)/.test(text)) return "yoomoney";
  if (/migration[:_\s-]|migrated|миграц/.test(text)) return "migration";
  if (/(manual_provider_confirmed|manual confirmed|ручн|manual)/.test(text)) return "manual";
  return "";
}

export function buildMismatchReport({ operations = [], balances = [] } = {}) {
  const daily = buildDailyCurrencyBalances(operations, balances);
  const dailyMismatches = (daily.rows || []).filter((row) => row.status === "mismatch");
  const rows = dailyMismatches
    .sort(compareMismatchRows)
    .map((row) => enrichMismatchRow({ row, operations, balances }));
  return {
    rows,
    summary: {
      detected: rows.length,
      wouldUpdate: 0,
      updated: 0,
      skipped: rows.length,
      needsManualVerification: rows.filter((row) => !row.after).length,
    },
  };
}

function enrichMismatchRow({ row, operations, balances }) {
  const opening = findOpeningBalanceRow({ balances, date: row.date, channel: row.channel, currency: row.currency });
  const factual = findBalanceRow({ balances, date: row.date, channel: row.channel, currency: row.currency });
  const movements = movementsForRange({
    operations,
    channel: row.channel,
    currency: row.currency,
    fromExclusive: opening?.date || "",
    toInclusive: row.date,
  });
  const nearbyOtherChannelRows = operations
    .map(normalizeMovementRow)
    .filter((movement) => movement.date > (opening?.date || "") && movement.date <= row.date)
    .filter((movement) => movement.currency === row.currency && movement.channel !== row.channel)
    .filter((movement) => Math.abs(Math.abs(movement.balanceAmount) - Math.abs(row.difference || 0)) <= 0.01);
  const missingNetRows = operations
    .filter((operation) => !hasText(operation?.ledgerV2?.amount_net ?? operation?.amountNet ?? operation?.amount_net))
    .filter((operation) => normalizeDate(operation?.date ?? operation?.ledgerV2?.date) > (opening?.date || ""))
    .filter((operation) => normalizeDate(operation?.date ?? operation?.ledgerV2?.date) <= row.date)
    .filter((operation) => getCurrency(operation) === row.currency)
    .filter((operation) => getFromChannel(operation) === row.channel || getToChannel(operation) === row.channel);
  const classification = classifyMismatch({ row, movements, nearbyOtherChannelRows, missingNetRows });
  return {
    date: row.date,
    channel: row.channel,
    currency: row.currency,
    opening_balance: row.opening_balance,
    inflow: row.inflow,
    outflow: row.outflow,
    computed_closing_balance: row.closing_balance ?? row.computed_closing_balance,
    provider_reported_balance: row.provider_reported_balance,
    difference: row.difference,
    formula: `opening_balance ${formatValue(row.opening_balance)} + inflow ${formatValue(row.inflow)} - outflow ${formatValue(row.outflow)} = computed_closing_balance ${formatValue(row.closing_balance ?? row.computed_closing_balance)} ; provider_reported_balance ${formatValue(row.provider_reported_balance)} ; difference ${formatValue(row.difference)}`,
    factual_balance_row: compactBalanceRow(factual),
    opening_balance_row: compactBalanceRow(opening),
    movements: movements.map(compactMovementRow),
    nearby_other_channel_rows: nearbyOtherChannelRows.map(compactMovementRow),
    missing_amount_net_rows: missingNetRows.map(compactLedgerRow),
    classification,
    confidence: "medium",
    before: {
      status: row.status,
      opening_balance: row.opening_balance,
      inflow: row.inflow,
      outflow: row.outflow,
      computed_closing_balance: row.closing_balance ?? row.computed_closing_balance,
      provider_reported_balance: row.provider_reported_balance,
      difference: row.difference,
    },
    after: null,
    correction: buildMismatchCorrection(classification),
    manual_action: buildMismatchManualAction({ row, factual }),
  };
}

export function buildMissingBalancesReport({ operations = [], balances = [], autoBalances = [], mergedBalances = [] } = {}) {
  const merged = mergedBalances.length
    ? mergedBalances
    : (mergeManualAndAutoBalances(balances, autoBalances).rows || []);
  const daily = buildDailyCurrencyBalances(operations, merged);
  const rows = (daily.rows || [])
    .filter((row) => row.status === "missing_opening_balance" || row.status === "missing_provider_balance")
    .sort(compareMismatchRows)
    .map((row) => buildMissingBalanceRow({ row, balances, autoBalances }));
  return {
    rows,
    summary: summarizeRows(rows),
  };
}

function buildMissingBalanceRow({ row, balances = [], autoBalances = [] }) {
  const exactManual = findExactBalanceCandidate({ balances, row });
  const exactAuto = findExactBalanceCandidate({ balances: autoBalances, row });
  const nearbyManual = findNearbyBalanceCandidates({ balances, row });
  const nearbyAuto = findNearbyBalanceCandidates({ balances: autoBalances, row });
  const amountHint = row.status === "missing_provider_balance" ? row.closing_balance : null;
  return {
    date: row.date,
    channel: row.channel,
    currency: row.currency,
    status: row.status,
    opening_balance: row.opening_balance,
    inflow: row.inflow,
    outflow: row.outflow,
    computed_closing_balance: row.closing_balance,
    provider_reported_balance: row.provider_reported_balance,
    difference: row.difference,
    exact_manual_source: compactBalanceRow(exactManual),
    exact_auto_source: compactBalanceRow(exactAuto),
    nearby_manual_sources: nearbyManual.map(compactBalanceRow),
    nearby_auto_sources: nearbyAuto.map(compactBalanceRow),
    amount_hint: amountHint,
    before: {
      status: row.status,
      opening_balance: row.opening_balance,
      provider_reported_balance: row.provider_reported_balance,
    },
    after: null,
    skippedReason: "no exact factual manual/provider balance row available for safe automatic correction",
    manual_action: buildMissingBalanceManualAction({ row, amountHint }),
  };
}

function findExactBalanceCandidate({ balances = [], row }) {
  return (balances || []).find((candidate) =>
    normalizeDate(candidate?.date) === row.date
    && String(candidate?.channel || candidate?.accountName || candidate?.account || "").trim() === row.channel
    && String(candidate?.currency || "").trim().toUpperCase() === row.currency
    && parseAmount(candidate?.balanceAmount ?? candidate?.amount) !== null
  );
}

function findNearbyBalanceCandidates({ balances = [], row }) {
  return (balances || [])
    .filter((candidate) => String(candidate?.channel || candidate?.accountName || candidate?.account || "").trim() === row.channel)
    .filter((candidate) => String(candidate?.currency || "").trim().toUpperCase() === row.currency)
    .filter((candidate) => Math.abs(daysBetween(normalizeDate(candidate?.date), row.date)) <= 3)
    .sort((left, right) => normalizeDate(left?.date).localeCompare(normalizeDate(right?.date)))
    .slice(0, 5);
}

function classifyMismatch({ row, movements, nearbyOtherChannelRows, missingNetRows }) {
  if (missingNetRows.some(isPayPalRow)) return "paypal_manual_confirmation_needed";
  if (movements.some((movement) => Math.abs(Math.abs(movement.balanceAmount) * 2 - Math.abs(row.difference || 0)) <= 0.01)) {
    return "wrong_sign";
  }
  if (nearbyOtherChannelRows.length) return "wrong_channel";
  if (!movements.length) return "missing_ledger_operation";
  return "wrong_factual_balance";
}

function buildMismatchCorrection(classification) {
  const corrections = {
    wrong_factual_balance: "verify provider statement, then update manual Остатки only if the factual row is wrong",
    missing_ledger_operation: "add the missing Ledger operation after provider/manual verification",
    duplicate_ledger_operation: "remove or correct the duplicate Ledger operation after row-level proof",
    wrong_sign: "fix Ledger sign/operation direction for the listed movement row",
    wrong_channel: "fix from_channel/to_channel for the listed nearby movement row",
    wrong_currency: "fix Ledger currency after provider proof",
    one_sided_exchange_or_transfer: "add or link the missing exchange/transfer side",
    paypal_manual_confirmation_needed: "confirm PayPal Personal net manually; do not invent fee or use gross as net",
    needs_manual_verification: "manual/provider verification required before mutation",
  };
  return corrections[classification] || corrections.needs_manual_verification;
}

function buildMismatchManualAction({ row, factual }) {
  const sourceRow = factual?.sourceRow ? `Остатки row ${factual.sourceRow}` : "the matching Остатки row";
  return [
    `Verify ${sourceRow} against the provider/manual statement for ${row.date} ${row.channel} ${row.currency}.`,
    `If factual balance is ${formatValue(row.closing_balance ?? row.computed_closing_balance)}, update Остатки; otherwise add/fix the missing Ledger movement that explains difference ${formatValue(row.difference)}.`,
  ].join(" ");
}

function buildMissingBalanceManualAction({ row, amountHint }) {
  if (row.status === "missing_opening_balance") {
    return `Add a factual opening Остатки row before ${row.date} for ${row.channel} ${row.currency}; do not use computed balances as facts.`;
  }
  return `Confirm provider closing balance for ${row.date} ${row.channel} ${row.currency}; optional amount_hint=${formatValue(amountHint)} must stay a hint until verified.`;
}

export function buildUpdatedLedgerRow({ header = [], currentRow = [], patch = {} } = {}) {
  const normalizedHeader = header.map((cell) => String(cell || "").trim().toLowerCase());
  const values = currentRow.slice(0, normalizedHeader.length);
  while (values.length < normalizedHeader.length) values.push("");
  for (const [field, value] of Object.entries(patch)) {
    const index = normalizedHeader.indexOf(field);
    if (index === -1) continue;
    values[index] = String(value ?? "");
  }
  return values;
}

export async function applyLedgerQualityRepairs({ report, task = "all", fetchImpl = fetch } = {}) {
  const updates = collectUpdates(report, task);
  if (!updates.length) return { updated: 0, skipped: 0, updates: [] };
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  const header = await readLedgerHeader({ accessToken, fetchImpl });
  let updated = 0;
  const applied = [];
  for (const update of updates) {
    const currentRow = await readLedgerRow({ sheetRowNumber: update.sheetRowNumber, accessToken, fetchImpl });
    const nextRow = buildUpdatedLedgerRow({ header, currentRow, patch: update.patch });
    await writeLedgerRow({ sheetRowNumber: update.sheetRowNumber, row: nextRow, accessToken, fetchImpl });
    updated += 1;
    applied.push({
      sheetRowNumber: update.sheetRowNumber,
      patch: update.patch,
      before: update.before || null,
      after: update.after || update.patch,
    });
  }
  return { updated, skipped: 0, updates: applied };
}

function collectUpdates(report, task) {
  const updates = [];
  if (shouldRun(task, "missing-amount-net")) {
    for (const row of report?.missingAmountNet?.rows || []) {
      if (!row.after) continue;
      updates.push({
        sheetRowNumber: row.sheetRowNumber,
        patch: filterPatch(row.after, MISSING_NET_FIELDS),
        before: row.before || null,
        after: filterPatch(row.after, MISSING_NET_FIELDS),
      });
    }
  }
  if (shouldRun(task, "mismatches")) {
    for (const row of report?.mismatchReport?.rows || []) {
      if (!row.after) continue;
      updates.push({
        sheetRowNumber: row.sheetRowNumber,
        patch: row.after,
        before: row.before || null,
        after: row.after,
      });
    }
  }
  if (shouldRun(task, "normalize-sources")) {
    for (const row of report?.normalizeSources?.rows || []) {
      if (!row.after) continue;
      updates.push({
        sheetRowNumber: row.sheetRowNumber,
        patch: filterPatch(row.after, SOURCE_ONLY_FIELDS),
        before: row.before || null,
        after: filterPatch(row.after, SOURCE_ONLY_FIELDS),
      });
    }
  }
  return updates;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log([
      "Usage: node scripts/repair-ledger-quality.mjs [--task all|missing-amount-net|mismatches|missing-balances|normalize-sources|yoomoney-reconcile] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run|--apply] [--confirm-file file.json] [--json]",
      "",
      "Dry-run is the default. --apply writes only explicit Ledger row patches.",
    ].join("\n"));
    return;
  }
  const confirmations = options.confirmFile ? JSON.parse(await readFile(options.confirmFile, "utf8")) : {};
  const repository = await loadManualRepositoryFromGoogleSheets();
  if (!repository?.ok) {
    throw new Error(repository?.warning || "Manual repository could not be loaded.");
  }
  const report = buildLedgerQualityRepairReport({ repository, confirmations, task: options.task, period: { from: options.from, to: options.to } });
  if (options.apply) {
    const applyResult = await applyLedgerQualityRepairs({ report, task: options.task });
    report.apply = applyResult;
    report.dryRun = false;
    report.missingAmountNet.summary.updated = countApplied(applyResult, report.missingAmountNet.rows);
    report.mismatchReport.summary.updated = countApplied(applyResult, report.mismatchReport.rows);
    report.missingBalances.summary.updated = countApplied(applyResult, report.missingBalances.rows);
    report.normalizeSources.summary.updated = countApplied(applyResult, report.normalizeSources.rows);
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);
}

function printHumanReport(report) {
  console.log(`Ledger quality repair ${report.dryRun ? "dry-run" : "apply"} (${report.generatedAt})`);
  console.log(`Summary: ${JSON.stringify(report.summary)}`);
  printTaskSummary("missing-amount-net", report.missingAmountNet);
  printTaskSummary("mismatches", report.mismatchReport);
  printTaskSummary("missing-balances", report.missingBalances);
  printTaskSummary("normalize-sources", report.normalizeSources);
  if (report.yoomoneyReconcile?.source) printTaskSummary("yoomoney-reconcile", report.yoomoneyReconcile);
}

function printTaskSummary(name, taskReport) {
  console.log(`\n[${name}] ${JSON.stringify(taskReport.summary)}`);
  for (const row of taskReport.rows || []) {
    console.log(JSON.stringify(row));
  }
}

async function readLedgerHeader({ accessToken, fetchImpl }) {
  const payload = await sheetsFetchJson({
    range: buildLedgerHeaderRange(),
    method: "GET",
    accessToken,
    fetchImpl,
  });
  return payload.values?.[0] || [];
}

async function readLedgerRow({ sheetRowNumber, accessToken, fetchImpl }) {
  const payload = await sheetsFetchJson({
    range: buildLedgerRowRange(sheetRowNumber),
    method: "GET",
    accessToken,
    fetchImpl,
  });
  const row = payload.values?.[0] || [];
  if (!row.some((cell) => hasText(cell))) throw new Error(`Ledger row ${sheetRowNumber} was not found.`);
  return row;
}

async function writeLedgerRow({ sheetRowNumber, row, accessToken, fetchImpl }) {
  const range = buildLedgerRowRange(sheetRowNumber);
  await sheetsFetchJson({
    range,
    method: "PUT",
    accessToken,
    fetchImpl,
    searchParams: { valueInputOption: "USER_ENTERED" },
    body: { range, majorDimension: "ROWS", values: [row] },
  });
}

async function sheetsFetchJson({ range, method, accessToken, fetchImpl, body, searchParams = {} }) {
  const url = new URL(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`);
  Object.entries(searchParams).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetchImpl(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets request failed with HTTP ${response.status}`);
  return payload || {};
}

function buildLedgerHeaderRange() {
  return `'${escapeSheetName(MANUAL_LEDGER_SHEET_NAME)}'!A1:V1`;
}

function buildLedgerRowRange(sheetRowNumber) {
  return `'${escapeSheetName(MANUAL_LEDGER_SHEET_NAME)}'!${LEDGER_RANGE_COLUMNS.replace(":", `${sheetRowNumber}:`)}${sheetRowNumber}`;
}

function escapeSheetName(value) {
  return String(value || "").replace(/'/g, "''");
}

function buildBalancesSummary(operations) {
  const grouped = new Map();
  let totalUsd = 0;
  let hasTotalUsd = false;
  let missing = 0;
  for (const row of operations || []) {
    if (!hasText(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net)) {
      missing += 1;
      continue;
    }
    const amount = parseAmount(row?.ledgerV2?.balance_amount ?? row?.balanceAmount);
    if (amount === null) continue;
    const channel = getMovementChannel({ row, balanceAmount: amount });
    if (!channel) continue;
    const existing = grouped.get(channel) || { channel, balance_amount: 0, balance_usd: 0, rows: 0 };
    existing.balance_amount += amount;
    existing.rows += 1;
    const usd = parseAmount(row?.ledgerV2?.amount_usd ?? row?.amountUsd);
    if (usd !== null) {
      existing.balance_usd += usd;
      totalUsd += usd;
      hasTotalUsd = true;
    }
    grouped.set(channel, existing);
  }
  return {
    by_channel: [...grouped.values()]
      .sort((left, right) => left.channel.localeCompare(right.channel))
      .map((row) => ({ ...row, balance_amount: round(row.balance_amount), balance_usd: round(row.balance_usd) })),
    total_usd: hasTotalUsd ? round(totalUsd) : null,
    uses_amount_net: true,
    fallback_amount_rows: 0,
    missing_amount_net_rows: missing,
    excluded_missing_amount_net_rows: missing,
  };
}

function compactLedgerRow(row) {
  return {
    sheetRowNumber: Number(row?.sheetRowNumber || row?.sheet_row_number || 0) || null,
    date: normalizeDate(row?.ledgerV2?.date ?? row?.date),
    operation: String(row?.ledgerV2?.operation || row?.operation || "").trim(),
    from_channel: getFromChannel(row),
    to_channel: getToChannel(row),
    currency: getCurrency(row),
    amount: stringValue(row?.ledgerV2?.amount ?? row?.amount),
    amount_gross: stringValue(row?.ledgerV2?.amount_gross ?? row?.amountGross ?? row?.amount_gross),
    amount_fee: getAmountFee(row),
    amount_net: stringValue(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net),
    source: getRawSource(row),
    raw_source_id: getRawSourceId(row),
    comment: getComment(row),
  };
}

function normalizeMovementRow(row) {
  const balanceAmount = parseAmount(row?.ledgerV2?.balance_amount ?? row?.balanceAmount);
  return {
    ...compactLedgerRow(row),
    balanceAmount,
    channel: balanceAmount === null ? "" : getMovementChannel({ row, balanceAmount }),
  };
}

function compactMovementRow(row) {
  return {
    sheetRowNumber: row.sheetRowNumber,
    date: row.date,
    operation: row.operation,
    from_channel: row.from_channel,
    to_channel: row.to_channel,
    amount: row.amount,
    amount_net: row.amount_net,
    balance_amount: row.balanceAmount,
    currency: row.currency,
    source: row.source,
    raw_source_id: row.raw_source_id,
    comment: row.comment,
  };
}

function compactBalanceRow(row) {
  if (!row) return null;
  return {
    sourceSheet: row.sourceSheet || "Остатки",
    sourceRow: row.sourceRow ?? null,
    date: row.date,
    channel: row.channel || row.accountName || row.account || "",
    currency: row.currency || "",
    amount: stringValue(row.amount ?? row.balanceAmount),
    source: row.source || row.fact_source || "",
    comment: row.comment || "",
  };
}

function findConfirmation(row, confirmations = {}) {
  const entries = [
    ...(Array.isArray(confirmations.missingAmountNet) ? confirmations.missingAmountNet : []),
    ...(Array.isArray(confirmations.rows) ? confirmations.rows : []),
  ];
  const rowNumber = Number(row?.sheetRowNumber || 0);
  const rawSourceId = getRawSourceId(row);
  return entries.find((entry) => {
    const entryRow = Number(entry.sheetRowNumber || entry.sheet_row_number || 0);
    const entryRaw = String(entry.raw_source_id ?? entry.rawSourceId ?? "").trim();
    return (entryRow && entryRow === rowNumber) || (entryRaw && entryRaw === rawSourceId);
  }) || null;
}

function movementsForRange({ operations, channel, currency, fromExclusive, toInclusive }) {
  return (operations || [])
    .map(normalizeMovementRow)
    .filter((row) => row.balanceAmount !== null)
    .filter((row) => hasText(row.amount_net))
    .filter((row) => row.channel === channel)
    .filter((row) => row.currency === currency)
    .filter((row) => row.date > fromExclusive && row.date <= toInclusive)
    .sort(compareMovementRows);
}

function findOpeningBalanceRow({ balances, date, channel, currency }) {
  return (balances || [])
    .filter((row) => row.date < date)
    .filter((row) => String(row.channel || row.accountName || row.account || "").trim() === channel)
    .filter((row) => String(row.currency || "").trim().toUpperCase() === currency)
    .sort((left, right) => left.date.localeCompare(right.date))
    .at(-1) || null;
}

function findBalanceRow({ balances, date, channel, currency }) {
  return (balances || [])
    .find((row) =>
      row.date === date &&
      String(row.channel || row.accountName || row.account || "").trim() === channel &&
      String(row.currency || "").trim().toUpperCase() === currency
    ) || null;
}

function buildUnknownSourceGroup(row) {
  return {
    channel: getFromChannel(row) || getToChannel(row),
    operation: String(row?.ledgerV2?.operation || row?.operation || "").trim(),
    currency: getCurrency(row),
    raw_source_id_pattern: rawSourcePattern(getRawSourceId(row)),
    comment_marker: commentMarker(getComment(row)),
  };
}

function groupUnknownSourceRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = JSON.stringify(row.group);
    const existing = groups.get(key) || { ...row.group, count: 0, recommendation: row.recommendation, evidence: row.evidence };
    existing.count += 1;
    groups.set(key, existing);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function buildSourceEvidence(row) {
  return {
    source: getRawSource(row),
    raw_source_id: getRawSourceId(row),
    from_channel: getFromChannel(row),
    to_channel: getToChannel(row),
    comment: getComment(row),
  };
}

function summarizeRows(rows) {
  return {
    detected: rows.length,
    wouldUpdate: rows.filter((row) => row.after).length,
    updated: 0,
    skipped: rows.filter((row) => !row.after).length,
    needsManualVerification: rows.filter((row) => !row.after).length,
  };
}

function emptyTaskReport() {
  return { rows: [], summary: { detected: 0, wouldUpdate: 0, updated: 0, skipped: 0, needsManualVerification: 0 } };
}

function filterPatch(patch, allowed) {
  return Object.fromEntries(Object.entries(patch || {}).filter(([field]) => allowed.has(field)));
}

function countApplied(applyResult, rows) {
  const applied = new Set((applyResult?.updates || []).map((row) => Number(row.sheetRowNumber)));
  return (rows || []).filter((row) => applied.has(Number(row.sheetRowNumber))).length;
}

function normalizeTaskName(task) {
  const normalized = String(task || "").trim();
  return TASK_ALIASES.get(normalized) || normalized;
}

function shouldRun(task, target) {
  return normalizeTaskName(task) === "all" || normalizeTaskName(task) === target;
}

function isUnknownSource(row) {
  return ["", "other", "unknown", "google_sheets", "mcp", "provider", "import"].includes(normalizeRowSource(row));
}

function normalizeRowSource(row) {
  return normalizeTargetSource(getRawSource(row));
}

function normalizeTargetSource(value) {
  const source = normalizeText(value).replace(/\s+/g, "_");
  if (source === "privat_bank" || source === "privat24") return "privatbank";
  if (source === "tdbank") return "td_bank";
  if (source === "paypal_mcp") return "paypal";
  if (source === "yoo_money" || source === "yamoney" || source === "yandex") return "yoomoney";
  return source;
}

function isPayPalRow(row) {
  const text = normalizeText([getRawSource(row), getRawSourceId(row), getFromChannel(row), getToChannel(row)].join(" "));
  return /paypal|пейпал/.test(text);
}

function getMovementChannel({ row, balanceAmount }) {
  if (balanceAmount < 0) return getFromChannel(row) || getToChannel(row);
  return getToChannel(row) || getFromChannel(row);
}

function getFromChannel(row) {
  return String(row?.ledgerV2?.from_channel ?? row?.fromChannel ?? row?.from_channel ?? "").trim();
}

function getToChannel(row) {
  return String(row?.ledgerV2?.to_channel ?? row?.toChannel ?? row?.to_channel ?? "").trim();
}

function getCurrency(row) {
  return String(row?.ledgerV2?.currency ?? row?.currency ?? "").trim().toUpperCase();
}

function getRawSource(row) {
  return String(row?.source ?? row?.ledgerV2?.source ?? "").trim();
}

function getRawSourceId(row) {
  return String(row?.ledgerV2?.raw_source_id ?? row?.rawSourceId ?? row?.raw_source_id ?? row?.ledgerV2?.external_id ?? row?.externalId ?? row?.external_id ?? "").trim();
}

function getComment(row) {
  return String(row?.ledgerV2?.comment ?? row?.comment ?? "").trim();
}

function getAmountFee(row) {
  return stringValue(row?.ledgerV2?.amount_fee ?? row?.amountFee ?? row?.amount_fee);
}

function appendCommentMarker(comment, marker) {
  const current = String(comment || "").trim();
  if (current.includes(marker)) return current;
  return current ? `${current}; ${marker}` : marker;
}

function rawSourcePattern(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[0-9A-Z]{17}$/i.test(raw)) return "paypal_transaction_id";
  const prefix = raw.split(/[:_-]/)[0];
  return prefix || "freeform";
}

function commentMarker(value) {
  const text = normalizeText(value);
  if (/manual_provider_confirmed/.test(text)) return "manual_provider_confirmed";
  if (/fee_unavailable_personal_account/.test(text)) return "fee_unavailable_personal_account";
  if (/migration/.test(text)) return "migration";
  if (/manual|ручн/.test(text)) return "manual";
  return "";
}

function compareMismatchRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function compareMovementRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  const leftRow = Number(left.sheetRowNumber || 0);
  const rightRow = Number(right.sheetRowNumber || 0);
  return leftRow - rightRow;
}

function parseAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function daysBetween(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const leftMs = Date.parse(`${left}T00:00:00Z`);
  const rightMs = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return Number.POSITIVE_INFINITY;
  return Math.round((leftMs - rightMs) / 86400000);
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasText(value) {
  return String(value ?? "").trim() !== "";
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function round(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function formatValue(value) {
  return value === null || value === undefined ? "null" : String(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
