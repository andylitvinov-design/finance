import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeServerAnalyticsPayload } from "../server/analytics-normalizer.js";
import autoBalanceSnapshotsHandler from "../server/auto-balance-snapshots.js";
import dailyBalanceBackfillHandler from "../server/backfill-daily-balance-snapshots-route.js";
import repairMayDailyBalanceSnapshotsHandler from "../server/repair-may-daily-balance-snapshots-route.js";
import ensureFxRatesHandler from "../server/ensure-fx-rates-route.js";
import reconcileBalancesAndTransfersHandler from "../server/reconcile-balances-and-transfers.js";
import payoneerTransactionsHandler from "../server/payoneer-transactions.js";
import revolutTransactionsHandler from "../server/revolut-transactions.js";
import balancePairsHandler from "../server/balance-pairs-route.js";
import { buildBalanceSnapshotsSnapshot } from "../server/balance-snapshots.js";
import { mergeManualAndAutoBalances } from "../server/balance-snapshot-merge.js";
import { handleDebugAction, isDebugAction } from "../server/debug-endpoints.js";
import { createManualWorkbookHandler } from "../server/manual-workbook-route.js";
import paypalManualBalanceHandler from "../server/paypal-manual-balance.js";
import periodBalanceReconciliationHandler from "../server/period-balance-reconciliation-route.js";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import {
  buildPayPalProviderWarning,
  fetchPayPalStatementEntries,
  fetchPayPalStatementEntriesFromMcp,
} from "./paypal-transactions.js";
import { fetchWiseStatementEntries } from "./wise-transactions.js";
import { fetchMonobankStatementEntries } from "./monobank-transactions.js";
import { fetchPrivatBankStatementEntries } from "./privatbank-transactions.js";
import { fetchYooMoneyStatementEntries } from "./yoomoney-transactions.js";
import binanceTransactionsHandler, {
  fetchBinanceStatementEntries,
  getBinanceProviderConfigFromEnv,
} from "../server/binance-transactions.js";
import PaymentChannelReference from "../payment-channel-reference.js";

const SUPPORTED_GET_ACTIONS = new Set(["getDashboardData", "saveBalanceSnapshot", "sync", "balanceSnapshots", "balancePairs"]);
const SUPPORTED_POST_ACTIONS = new Set(["saveBalanceSnapshot", "saveTabData"]);
const BINANCE_TRANSACTIONS_ACTION = "binanceTransactions";
const PERIOD_BALANCE_RECONCILIATION_ACTION = "periodBalanceReconciliation";
const AUTO_BALANCE_SNAPSHOTS_ACTION = "autoBalanceSnapshots";
const DAILY_BALANCE_BACKFILL_ACTION = "dailyBalanceBackfill";
const MAY_DAILY_BALANCE_SNAPSHOT_REPAIR_ACTION = "mayDailyBalanceSnapshotRepair";
const ENSURE_FX_RATES_ACTION = "ensureFxRates";
const RECONCILE_BALANCES_AND_TRANSFERS_ACTION = "reconcileBalancesAndTransfers";
const PAYONEER_TRANSACTIONS_ACTION = "payoneerTransactions";
const REVOLUT_TRANSACTIONS_ACTION = "revolutTransactions";
const PAYPAL_MANUAL_BALANCE_ACTION = "paypalManualBalance";
const BALANCE_PAIRS_ACTION = "balancePairs";
const SOURCE_SPREADSHEET_ID = "1v2ZvGdutjyMkW0FZqxJ3P0GRVuKPlNxG1lvZiUZlWvo";
const SOURCE_SPREADSHEET_GID = "0";
const SOURCE_SPREADSHEET_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}/export?format=csv&gid=${SOURCE_SPREADSHEET_GID}`;
const SOURCE_SPREADSHEET_URL =
  `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}/edit#gid=${SOURCE_SPREADSHEET_GID}`;
const WISE_TRANSFER_CATEGORY = "Перевод Wise";
const WISE_TRANSFER_TARGET_CHANNEL = "wise boleslav usd";
const WISE_TRANSFER_SOURCE_PREFIX = "source-order";
const CLIENT_PAID_COLUMN_HEADER = "ОПЛАЧЕНО КЛИЕНТОМ USD";
const PAYMENT_FEE_COLUMN_HEADER = "КОМИССИЯ ПРОВАЙДЕРА USD";
const NET_RECEIVED_COLUMN_HEADER = "ДОШЛО ДО НАС USD";
const REAL_INCOME_COLUMN_HEADER = "ДОШЛО ФАКТ / PROVIDER NET";
const PROVIDER_NET_COLUMN_ALIASES = [
  REAL_INCOME_COLUMN_HEADER,
  "PROVIDER NET",
  "NET RECEIVED USD",
  "realNetUsd",
  "providerNetUsd",
];
const REAL_INCOME_CHANNELS = [
  "Яндекс руб",
  "пейпал дол",
  "пейпал евр",
  "пейпал сad",
  "приват 24-дол",
  "приват 24-евро",
  "приват 24-грн",
  "приват-фоп",
  "монобанк грн",
  "БАНК КАНАДА cad",
  "трансервайз дол",
  "трансервайз евро",
  "Payoneer - dol",
  "Payoneer - eur",
  "Бинанс spot",
  "Binance funding",
  "binance save",
];
const REAL_INCOME_CHANNEL_CURRENCY = {
  "Яндекс руб": "RUB",
  "пейпал дол": "USD",
  "пейпал евр": "EUR",
  "пейпал сad": "CAD",
  "приват 24-дол": "USD",
  "приват 24-евро": "EUR",
  "приват 24-грн": "UAH",
  "приват-фоп": "UAH",
  "монобанк грн": "UAH",
  "БАНК КАНАДА cad": "CAD",
  "трансервайз дол": "USD",
  "трансервайз евро": "EUR",
  "Payoneer - dol": "USD",
  "Payoneer - eur": "EUR",
  "Бинанс spot": "USD",
  "Binance funding": "USD",
  "binance save": "USD",
};
const REAL_INCOME_FALLBACK_USD_RATES = {
  RUB: 1 / 84.5563,
  UAH: 1 / 43.86,
  EUR: 1.16,
  CAD: 0.74,
  LOCAL: 1 / 18,
};
const FRESH_MOVEMENT_HEADER = [
  "NUMBER",
  "DATE",
  "CLIENT",
  "SERVICE",
  "COMMENT",
  "PRICE BASE",
  "ACTION",
  "QTY",
  "ACCRUED",
  "ACCRUED +3%",
  "70% OF ACCRUED",
  "70% OF +3%",
  "RUB RATE",
  "UAH RATE",
  "PAYMENT METHOD",
  "ПОЛУЧЕНО В ДОЛЛАРАХ",
  "ПОЛУЧЕНО В РУБЛЯХ",
  "ПОЛУЧЕНО В ГРИВНАХ",
  CLIENT_PAID_COLUMN_HEADER,
  PAYMENT_FEE_COLUMN_HEADER,
  NET_RECEIVED_COLUMN_HEADER,
  REAL_INCOME_COLUMN_HEADER,
  "BALANCE",
  "STATUS",
  "REVIEW NOTE",
  "",
  "DATE",
  "AMOUNT (USD)",
  "DESTINATION",
  "PAYMENT METHOD",
  "ПОЛУЧЕНО В ДОЛЛАРАХ",
  "ПОЛУЧЕНО В ГРИВНАХ",
];
const FRESH_PAYOUTS_TITLE_ROW = ["Выплаты", "Журнал переводов за период"];
const FRESH_PAYOUTS_HEADER = [
  "POSITION",
  "DATE",
  "CLIENT",
  "SERVICE",
  "PAYMENT METHOD",
  "ВАЛЮТА",
  "СУММА ТЕКУЩАЯ",
  "AMOUNT (USD)",
  "КУРС ПЕРЕВОДА",
  "COMMENT",
];
const SOURCE_RECEIVED_AMOUNT_CORRECTIONS = {
  "18116": {
    matchClient: /лозин/i,
    matchPayment: /карта\s+андрей|андрей\s+карта/i,
    matchReceivedUah: 22490.05,
    receivedUah: "14870",
    reason: "source duplicate 14870 UAH"
  },
  "18118": {
    matchClient: /ковалев/i,
    matchPayment: /фоп\s+приват|приват\s+фоп/i,
    matchReceivedUah: 1000,
    receivedUah: "22490,05",
    reason: "source missing 515 USD UAH equivalent"
  }
};
export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }

  const debugAction = String(request.query?.action || "").trim();
  if (debugAction === BINANCE_TRANSACTIONS_ACTION) {
    return await binanceTransactionsHandler(request, response);
  }

  if (debugAction === PERIOD_BALANCE_RECONCILIATION_ACTION) {
    return await periodBalanceReconciliationHandler(request, response);
  }

  if (debugAction === AUTO_BALANCE_SNAPSHOTS_ACTION) {
    return await autoBalanceSnapshotsHandler(request, response);
  }

  if (debugAction === DAILY_BALANCE_BACKFILL_ACTION) {
    return await dailyBalanceBackfillHandler(request, response);
  }

  if (debugAction === MAY_DAILY_BALANCE_SNAPSHOT_REPAIR_ACTION) {
    return await repairMayDailyBalanceSnapshotsHandler(request, response);
  }

  if (debugAction === ENSURE_FX_RATES_ACTION) {
    return await ensureFxRatesHandler(request, response);
  }

  if (debugAction === RECONCILE_BALANCES_AND_TRANSFERS_ACTION) {
    return await reconcileBalancesAndTransfersHandler(request, response);
  }

  if (debugAction === PAYONEER_TRANSACTIONS_ACTION) {
    return await payoneerTransactionsHandler(request, response);
  }

  if (debugAction === REVOLUT_TRANSACTIONS_ACTION) {
    return await revolutTransactionsHandler(request, response);
  }

  if (debugAction === PAYPAL_MANUAL_BALANCE_ACTION) {
    return await paypalManualBalanceHandler(request, response);
  }

  if (debugAction === BALANCE_PAIRS_ACTION) {
    return await balancePairsHandler(request, response);
  }

  if (isDebugAction(debugAction)) {
    return await handleDebugAction(request, response, debugAction);
  }

  if (debugAction === "manualWorkbook") {
    const routeName = String(request.query?.route || "manual-workbook").trim() || "manual-workbook";
    return await createManualWorkbookHandler(routeName)(request, response);
  }

  const upstream = normalizeUpstreamUrl(process.env.EZOHATA_V2_APPS_SCRIPT_URL);
  if (request.method === "GET" && request.query.health === "1") {
    return response.status(200).json({
      ok: true,
      service: "ezohata-reconcile-v2-api",
      configured: Boolean(upstream),
      fallbackSnapshot: !upstream,
      statusEndpoint: "/api/status",
      supportedGetActions: [...Array.from(SUPPORTED_GET_ACTIONS), "manualWorkbook"],
      supportedPostActions: [...Array.from(SUPPORTED_POST_ACTIONS), "manualWorkbook"],
    });
  }

  if (request.method === "GET" && normalizeLegacyGetAction(request.query.action || "getDashboardData") === "balanceSnapshots") {
    const snapshot = await buildBalanceSnapshotsSnapshot({ query: request.query || {} });
    return response.status(200).json(snapshot);
  }

  if (!upstream) {
    const fallbackAction = normalizeLegacyGetAction(String(
      request.method === "GET"
        ? request.query.action || "getDashboardData"
        : (typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {}).action || ""
    ).trim());
    if (request.method === "GET" && fallbackAction === "getDashboardData") {
      const snapshot = await loadSnapshotPayload();
      return response.status(200).json({
        ok: true,
        action: fallbackAction,
        source: "snapshot",
        fallbackSnapshot: true,
        data: snapshot.data,
      });
    }
    return response.status(503).json({
      ok: false,
      error: "Missing EZOHATA_V2_APPS_SCRIPT_URL environment variable.",
    });
  }

  try {
    if (request.method === "GET") {
      return await forwardGet(request, response, upstream);
    }
    if (request.method === "POST") {
      return await forwardPost(request, response, upstream);
    }
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  } catch (error) {
    return response.status(502).json({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function normalizeUpstreamUrl(value) {
  const raw = String(value || "").trim();
  return raw ? raw.replace(/\/+$/, "") : "";
}

async function loadSnapshotPayload() {
  const snapshotPath = path.join(process.cwd(), "sheet-snapshot.json");
  const text = await readFile(snapshotPath, "utf8");
  const payload = JSON.parse(text);
  if (!payload?.data?.tabs) {
    throw new Error("sheet-snapshot.json has invalid format.");
  }
  return payload;
}

function validateAction(action, method) {
  const normalized = method === "GET"
    ? normalizeLegacyGetAction(action)
    : String(action || "").trim();
  const supported = method === "POST" ? SUPPORTED_POST_ACTIONS : SUPPORTED_GET_ACTIONS;
  if (!supported.has(normalized)) {
    throw new Error(`Unsupported ${method} action: ${normalized || "unknown"}`);
  }
  return normalized;
}

function normalizeLegacyGetAction(action) {
  const normalized = String(action || "").trim();
  if (normalized === "sync") {
    return "getDashboardData";
  }
  return normalized;
}

function mapUpstreamAction(action, method) {
  const normalized = String(action || "").trim();
  if (method === "GET" && normalized === "getDashboardData") {
    return "calculatePeriod";
  }
  return normalized;
}

async function forwardGet(request, response, upstream) {
  const action = validateAction(request.query.action || "getDashboardData", "GET");
  const target = new URL(upstream);
  target.searchParams.set("action", mapUpstreamAction(action, "GET"));

  Object.entries(request.query || {}).forEach(([key, value]) => {
    if (key === "action" || value == null || value === "") return;
    target.searchParams.set(key, normalizeForwardedQueryValue(key, value));
  });

  const upstreamResponse = await fetch(target.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
  });

  return await pipeResponse(response, upstreamResponse, action, request.query || {});
}

async function forwardPost(request, response, upstream) {
  const payload =
    typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const action = validateAction(payload.action, "POST");

  const upstreamResponse = await fetch(upstream, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
    body: JSON.stringify({ ...payload, action: mapUpstreamAction(action, "POST") }),
  });

  return await pipeResponse(response, upstreamResponse, action, payload || {});
}

async function pipeResponse(response, upstreamResponse, action, requestParams = {}) {
  const text = await upstreamResponse.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Upstream returned non-JSON response for ${action}.`);
  }

  if (!upstreamResponse.ok) {
    return response.status(upstreamResponse.status).json({
      ok: false,
      action,
      error: payload?.error || `Upstream returned HTTP ${upstreamResponse.status}.`,
    });
  }

  const data = payload.ok
    ? normalizeServerAnalyticsPayload(await maybeOverlayManualRepositoryData(await maybeOverlayFreshSourceData(payload.data), requestParams))
    : payload.data;

  return response.status(payload.ok ? 200 : 502).json({
    ok: Boolean(payload.ok),
    action: payload.action || action,
    ...(payload.ok
      ? { data }
      : { error: payload.error || "Upstream returned an error." }),
  });
}

function normalizeForwardedQueryValue(key, value) {
  if (["startDate", "endDate", "dateFrom", "dateTo", "from", "to"].includes(String(key))) {
    return normalizeIsoDate(value) || String(value);
  }
  return String(value);
}

async function maybeOverlayFreshSourceData(data) {
  if (!data?.tabs || !data?.period) return data;
  try {
    const sourceRows = await loadSourceRows();
    const movementSummaryRows = extractMovementSummaryRows(data.tabs.movement?.values || []);
    const freshMovement = buildFreshMovementTableFromRows(sourceRows, data.period, movementSummaryRows);
    if (!freshMovement) return data;
    const freshPayouts = buildFreshPayoutsTableFromRows(sourceRows, data.period);
    const realIncome = await buildRealIncomePayload(data.period, freshMovement.values);
    const enrichedMovement = applyRealIncomeToMovementTable(freshMovement, realIncome);
    const servicePaymentSummaryByChannel = summarizeMovementServicePaymentsByChannel(enrichedMovement.values);
    const servicePaymentSummaryTotals = getRealIncomeSummaryTotalsFromSummary(servicePaymentSummaryByChannel);
    const servicePaymentGap = buildServicePaymentGapDiagnostics(enrichedMovement.values, servicePaymentSummaryByChannel, {
      providerEntries: realIncome?.candidateIncomeEntries || [],
    });
    const orderPaymentCoverage = buildOrderPaymentCoverageReport(enrichedMovement.values, {
      providerEntries: realIncome?.candidateIncomeEntries || [],
      transfers: data.manual?.transfers || [],
    });
    const actualPayments = buildActualPaymentSummaryByChannel(orderPaymentCoverage.rows, { realIncome });
    const movementWarnings = collectMovementVerificationWarnings(enrichedMovement.values);
    const hasServicePaymentSummary = Object.values(servicePaymentSummaryByChannel || {}).some((row) => Number(row?.realNetUsd || 0) > 0);
    const nextRealIncome = realIncome || movementWarnings.length || hasServicePaymentSummary
      ? {
          ...(realIncome || {}),
          entries: realIncome?.entries || [],
          rowMatches: realIncome?.rowMatches || [],
          refundEntries: realIncome?.refundEntries || [],
          exchangeEntries: realIncome?.exchangeEntries || [],
          candidateIncomeEntries: realIncome?.candidateIncomeEntries || [],
          matchedEntries: realIncome?.matchedEntries || [],
          unmatchedEntries: realIncome?.unmatchedEntries || [],
          servicePaymentSummaryByChannel,
          servicePaymentSummaryTotals,
          servicePaymentGapByChannel: servicePaymentGap.servicePaymentGapByChannel,
          servicePaymentGapTotals: servicePaymentGap.servicePaymentGapTotals,
          orderPaymentCoverage,
          actualPaymentSummaryByChannel: actualPayments.summaryByChannel,
          actualPaymentSummaryTotals: actualPayments.totals,
          serviceOrderSummaryByChannel: realIncome?.serviceOrderSummaryByChannel || {},
          serviceOrderSummaryTotals: realIncome?.serviceOrderSummaryTotals || null,
          summaryByChannel: realIncome?.summaryByChannel || {},
          summaryTotals: realIncome?.summaryTotals || null,
          refundSummaryByChannel: realIncome?.refundSummaryByChannel || {},
          refundSummaryTotals: realIncome?.refundSummaryTotals || null,
          exchangeSummaryByChannel: realIncome?.exchangeSummaryByChannel || {},
          exchangeSummaryTotals: realIncome?.exchangeSummaryTotals || null,
          unmatchedSummaryByChannel: realIncome?.unmatchedSummaryByChannel || {},
          unmatchedSummaryTotals: realIncome?.unmatchedSummaryTotals || null,
          allSummaryByChannel: realIncome?.allSummaryByChannel || {},
          allSummaryTotals: realIncome?.allSummaryTotals || null,
          warnings: [...new Set([...(realIncome?.warnings || []), ...movementWarnings])],
        }
      : null;
    return {
      ...data,
      tabs: {
        ...data.tabs,
        movement: enrichedMovement,
        orders: buildFreshOrdersTable(enrichedMovement),
        ...(freshPayouts ? { payouts: freshPayouts } : {})
      },
      manual: appendKovalevWiseTransfers(data.manual || {}, enrichedMovement.values || []),
      ...(nextRealIncome ? { realIncome: nextRealIncome } : {})
    };
  } catch (error) {
    console.warn("Fresh source overlay failed, using upstream dashboard data.", error);
    return data;
  }
}

async function maybeOverlayManualRepositoryData(data, requestParams = {}) {
  if (!data?.period || !data?.tabs?.analytics?.values?.length) return data;
  const manualRepository = await loadManualRepositoryFromGoogleSheets();
  if (!manualRepository.ok) {
    return appendManualWarning(data, manualRepository.warning);
  }
  const period = resolveDashboardPeriod(data.period || {}, requestParams || {});
  const periodFilter = {
    startDate: normalizeIsoDate(period.startDate),
    endDate: normalizeIsoDate(period.endDate),
  };
  const filterByPeriod = (rows) => filterRepositoryRowsByPeriod(rows || [], periodFilter);
  const periodOperations = filterByPeriod(manualRepository.operations || []);
  const periodExpenseRows = filterByPeriod(manualRepository.expenseRows || []);
  const periodTransfers = filterByPeriod(manualRepository.transfers || []);
  const periodCommissionRows = filterByPeriod(manualRepository.commissionRows || []);
  const periodLedgerV2Rows = filterByPeriod(manualRepository.ledgerV2Rows || []);
  const manualBalances = Array.isArray(manualRepository.balances) ? manualRepository.balances : [];
  const autoBalances = Array.isArray(manualRepository.autoBalances) ? manualRepository.autoBalances : [];
  const balanceSnapshotMerge = mergeManualAndAutoBalances(manualBalances, autoBalances);
  const mergedBalanceRows = balanceSnapshotMerge.rows || balanceSnapshotMerge.merged || [];

  const isLedgerRepository = /^ledger-v[12]/.test(String(manualRepository.schema || ""));
  const nextManual = {
    ...(data.manual || {}),
    schema: manualRepository.schema,
    warnings: manualRepository.warnings || [],
    expenseRows: periodExpenseRows,
    balances: mergedBalanceRows.length ? mergedBalanceRows : (data.manual?.balances || []),
    balanceRows: mergedBalanceRows,
    manualBalanceRows: manualBalances,
    autoBalances,
    balanceSnapshotMerge: {
      manual_balance_rows: manualBalances.length,
      auto_balance_rows: autoBalances.length,
      merged_balance_rows: mergedBalanceRows.length,
      auto_balance_rows_used_as_fallback: Number(balanceSnapshotMerge.auto_balance_rows_used_as_fallback || balanceSnapshotMerge.autoUsed || 0),
      auto_balance_rows_ignored_due_to_manual: Number(balanceSnapshotMerge.auto_balance_rows_ignored_due_to_manual || balanceSnapshotMerge.autoIgnored || 0),
      auto_balance_rows_ignored_as_stale_current: Number(balanceSnapshotMerge.auto_balance_rows_ignored_as_stale_current || balanceSnapshotMerge.autoIgnoredStaleCurrent || 0),
    },
    transfers: periodTransfers,
    commissionRows: periodCommissionRows,
    views: manualRepository.views,
    ledgerV2Rows: periodLedgerV2Rows,
    sourceType: "manual-google-sheets",
    manualSpreadsheetId: manualRepository.spreadsheetId,
    fallbackSchema: manualRepository.fallbackSchema || null,
  };
  nextManual.transfers = appendKovalevWiseTransfers(
    { transfers: periodTransfers },
    data.tabs?.movement?.values || []
  ).transfers;

  if (isLedgerRepository) {
    nextManual.primarySource = "ledger";
    nextManual.operations = periodOperations;
    delete nextManual.compatibilityMode;
  }

  const nextRealIncome = isLedgerRepository
    ? mergeLedgerRealIncomeFallback({
        realIncome: data.realIncome || null,
        operations: periodOperations,
        movementValues: data.tabs?.movement?.values || [],
        period
      })
    : (data.realIncome || null);

  const nextRealIncomeWithServiceGaps = nextRealIncome
    ? rebuildServicePaymentGapDiagnostics(nextRealIncome, data.tabs?.movement?.values || [], {
        ledgerOperations: periodOperations,
        period,
        transfers: nextManual.transfers || [],
      })
    : null;

  return {
    ...data,
    period,
    period_applied: {
      start: periodFilter.startDate || "",
      end: periodFilter.endDate || "",
      source_rows_total: (manualRepository.operations || []).length,
      source_rows_in_period: periodOperations.length,
    },
    manual: nextManual,
    ...(nextRealIncomeWithServiceGaps ? { realIncome: nextRealIncomeWithServiceGaps } : {})
  };
}

function resolveDashboardPeriod(period = {}, requestParams = {}) {
  const startDate =
    normalizeIsoDate(requestParams.startDate || requestParams.from || requestParams.dateFrom) ||
    normalizeIsoDate(period.startDate || period.from || period.dateFrom);
  const endDate =
    normalizeIsoDate(requestParams.endDate || requestParams.to || requestParams.dateTo) ||
    normalizeIsoDate(period.endDate || period.to || period.dateTo);
  return {
    ...period,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

function filterRepositoryRowsByPeriod(rows, period = {}) {
  const startDate = normalizeIsoDate(period.startDate);
  const endDate = normalizeIsoDate(period.endDate);
  if (!startDate && !endDate) return Array.isArray(rows) ? rows.slice() : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const date = normalizeRepositoryRowDate(row);
    if (!date) return false;
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    return true;
  });
}

function normalizeRepositoryRowDate(row) {
  if (!row || typeof row !== "object") return "";
  return normalizeIsoDate(
    row.date ||
    row.operationDate ||
    row.transactionDate ||
    row.transferDate ||
    row.createdAt ||
    row.created_at ||
    row.updatedAt ||
    row.updated_at ||
    ""
  );
}

function appendManualWarning(data, warning) {
  if (!warning) return data;
  const warnings = [
    ...new Set([
      ...((Array.isArray(data?.manual?.warnings) ? data.manual.warnings : [])),
      warning,
    ]),
  ];
  return {
    ...data,
    manual: {
      ...(data.manual || {}),
      warnings,
    },
  };
}

function appendKovalevWiseTransfers(manual = {}, movementValues = []) {
  const existingTransfers = Array.isArray(manual?.transfers) ? manual.transfers : [];
  const transfers = existingTransfers.map((row) => ({ ...row }));
  const existingKeys = new Set(transfers.map(getTransferDedupKey).filter(Boolean));
  for (const row of movementValues || []) {
    const transfer = buildKovalevWiseTransferFromMovementRow(row);
    if (!transfer) continue;
    const key = getTransferDedupKey(transfer);
    if (key && existingKeys.has(key)) continue;
    transfers.push(transfer);
    if (key) existingKeys.add(key);
  }
  return {
    ...manual,
    transfers,
  };
}

function buildKovalevWiseTransferFromMovementRow(row) {
  const orderId = String(row?.[0] || "").trim();
  if (!/^\d+$/.test(orderId)) return null;
  const client = String(row?.[2] || "").trim();
  const paymentMethod = String(row?.[14] || "").trim();
  if (!isKovalevWiseBoleslavMovementRow({ client, paymentMethod })) return null;
  const amount = firstNonEmpty([row?.[15], row?.[18], row?.[20], row?.[27]]);
  const numericAmount = parseLooseNumber(amount);
  if (numericAmount === null || Math.abs(numericAmount) <= 0) return null;
  const rawSourceId = `${WISE_TRANSFER_SOURCE_PREFIX}:${orderId}`;
  const normalizedAmount = formatDisplayNumber(Math.abs(numericAmount));
  return {
    transferDate: normalizeIsoDate(row?.[1]),
    who: [client, "Немиша", "не мне"].filter(Boolean).join(" / "),
    amount: normalizedAmount,
    currency: "USD",
    channel: WISE_TRANSFER_TARGET_CHANNEL,
    rate: "",
    usdAmount: normalizedAmount,
    raw_source_id: rawSourceId,
    rawSourceId,
    orderId,
    sourceTransactionId: rawSourceId,
    comment: `${WISE_TRANSFER_CATEGORY}: transfer not to me / transfer to Nemisha / не мне`,
  };
}

function isKovalevWiseBoleslavMovementRow({ client = "", paymentMethod = "" } = {}) {
  const normalizedClient = normalizeLookupText(client);
  const normalizedPaymentMethod = normalizeLookupText(paymentMethod);
  return /(ковалев|kovalev)/.test(normalizedClient) &&
    /(wise|transferwise|трансервайз)/.test(normalizedPaymentMethod) &&
    /bolieslavn?/.test(normalizedPaymentMethod);
}

function getTransferDedupKey(row) {
  const rawSourceId = String(row?.raw_source_id || row?.rawSourceId || row?.sourceTransactionId || "").trim();
  if (rawSourceId) return `raw:${rawSourceId}`;
  const date = normalizeIsoDate(row?.transferDate || row?.date);
  const who = normalizeLookupText(row?.who || row?.fromAccount || "");
  const amount = formatDisplayNumber(Math.abs(parseLooseNumber(row?.amount) || 0));
  const channel = normalizeLookupText(row?.channel || row?.destination || row?.toAccount || "");
  if (!date || !amount || !channel) return "";
  return `fallback:${date}:${who}:${amount}:${channel}`;
}

async function loadSourceRows() {
  const response = await fetch(SOURCE_SPREADSHEET_CSV_URL, {
    method: "GET",
    headers: { Accept: "text/csv, text/plain;q=0.9, */*;q=0.8" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Source CSV fetch failed with HTTP ${response.status}.`);
  }

  const csvText = await response.text();
  return parseCsv(csvText);
}

function buildFreshMovementTableFromRows(rows, period, summaryRows = []) {
  const mappedRows = buildMovementRowsFromSource(rows, period);
  if (!mappedRows.length) return null;
  const totalRow = buildFreshMovementTotalRow(mappedRows);
  const nextSummaryRows = buildFreshMovementSummaryRows(mappedRows, summaryRows);

  const startDate = formatDisplayDate(period.startDate) || "";
  const endDate = formatDisplayDate(period.endDate) || "";
  return {
    sheetName: "движение средства",
    spreadsheetUrl: SOURCE_SPREADSHEET_URL,
    sourceType: "live-source-csv",
    values: [
      ["дата 1", startDate, "дата 2", endDate, "обновить", "", `источник: ${SOURCE_SPREADSHEET_ID}`],
      [
        "Поменяй даты. Таблица автоматически подтянет записи за выбранный период из исходного файла.",
        "",
        "",
        "",
        "",
        "",
        `Обновлено: ${formatFreshTimestamp(new Date())}`,
      ],
      FRESH_MOVEMENT_HEADER.slice(),
      ...mappedRows,
      totalRow,
    ],
    ...(nextSummaryRows.length ? { summaryRows: nextSummaryRows } : {}),
    rowCount: mappedRows.length + 4,
    columnCount: FRESH_MOVEMENT_HEADER.length,
  };
}

function extractMovementSummaryRows(values) {
  const summaryRows = [];
  let started = false;
  for (const row of values || []) {
    const firstCell = normalizeSummaryText(row?.[0]);
    if (!started) {
      if (firstCell === "показатели") started = true;
      continue;
    }
    if (!row?.some((cell) => String(cell || "").trim())) {
      if (summaryRows.length) break;
      continue;
    }
    const label = String(row?.[0] || "").trim();
    const value = String(row?.[1] || "").trim();
    if (!label) {
      if (summaryRows.length) break;
      continue;
    }
    summaryRows.push([label, value]);
  }
  return summaryRows;
}

function collectMovementVerificationWarnings(values = []) {
  const header = values?.[2] || values?.[0] || [];
  const numberIndex = findHeaderIndexByAliases(header, ["NUMBER"]);
  const statusIndex = findHeaderIndexByAliases(header, ["STATUS"]);
  const reviewIndex = findHeaderIndexByAliases(header, ["REVIEW NOTE"]);
  return (values || [])
    .slice(3)
    .filter((row) => /^\d+$/.test(String(row?.[numberIndex] || "").trim()))
    .filter((row) => String(row?.[statusIndex] || "").trim() === "NEEDS VERIFICATION")
    .map((row) => `order ${String(row?.[numberIndex] || "").trim()}: ${String(row?.[reviewIndex] || "").trim() || "needs verification"}`);
}

function buildFreshMovementSummaryRows(mappedRows = [], upstreamSummaryRows = []) {
  const summary = [];
  const pushIfPresent = (labelMatch, fallbackLabel) => {
    const row = (upstreamSummaryRows || []).find((item) => normalizeSummaryText(item?.[0]).includes(labelMatch));
    if (row?.[0]) summary.push([String(row[0]), String(row[1] || "")]);
    else if (fallbackLabel) summary.push([fallbackLabel, ""]);
  };

  pushIfPresent("начислено", "2) начислено прайс +%");
  summary.push(["4) получено в долларах", formatTableNumber(sumMovementColumn(mappedRows, 20))]);
  pushIfPresent("70% от прайс", "6) 70% от прайс+%");

  const verificationCount = mappedRows.filter((row) => String(row?.[23] || "").trim() === "NEEDS VERIFICATION").length;
  if (verificationCount > 0) {
    summary.push(["needs verification: provider fee/net missing", String(verificationCount)]);
  }

  return summary.filter((row, index, items) => {
    const label = normalizeSummaryText(row?.[0]);
    return label && items.findIndex((candidate) => normalizeSummaryText(candidate?.[0]) === label) === index;
  }).map((row) => {
    if (normalizeSummaryText(row?.[0]) === normalizeSummaryText("2) начислено прайс +%")) {
      return [row[0], formatTableNumber(sumMovementColumn(mappedRows, 9))];
    }
    if (normalizeSummaryText(row?.[0]) === normalizeSummaryText("6) 70% от прайс+%")) {
      return [row[0], formatTableNumber(sumMovementColumn(mappedRows, 11))];
    }
    return row;
  });
}

function sumMovementColumn(rows = [], index = -1) {
  if (index < 0) return 0;
  return roundNumber((rows || []).reduce((sum, row) => sum + (parseLooseNumber(row?.[index]) || 0), 0));
}

function normalizeSummaryText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function findHeaderIndexByAliases(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeSummaryText(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeSummaryText(cell)));
}

function getMovementProviderNetIndex(header = []) {
  return findHeaderIndexByAliases(header, PROVIDER_NET_COLUMN_ALIASES);
}

function getMovementNetReceivedIndex(header = []) {
  return findHeaderIndexByAliases(header, [NET_RECEIVED_COLUMN_HEADER]);
}

function buildFreshPayoutsTableFromRows(rows, period) {
  const mappedRows = buildPayoutRowsFromSource(rows, period);
  if (!mappedRows.length) return null;
  const totalRow = buildFreshPayoutTotalRow(mappedRows);

  return {
    sheetName: "список выплат",
    sourceType: "live-source-csv",
    values: [
      FRESH_PAYOUTS_TITLE_ROW.slice(),
      FRESH_PAYOUTS_HEADER.slice(),
      ...mappedRows,
      totalRow,
    ],
    rowCount: mappedRows.length + 3,
    columnCount: FRESH_PAYOUTS_HEADER.length,
  };
}

function buildFreshOrdersTable(movementTable) {
  return {
    sheetName: "список моих заказы",
    sourceType: movementTable.sourceType,
    values: movementTable.values.map((row) => row.slice()),
    rowCount: movementTable.rowCount,
    columnCount: movementTable.columnCount,
  };
}

async function buildRealIncomePayload(period, movementValues) {
  const startDate = normalizeIsoDate(period?.startDate);
  const endDate = normalizeIsoDate(period?.endDate);
  if (!startDate || !endDate || !Array.isArray(movementValues) || movementValues.length < 4) {
    return null;
  }

  const warnings = [];
  const providerEntries = [];
  const providerResults = await Promise.all([
    loadPayPalProviderEntries(startDate, endDate),
    loadWiseProviderEntries(startDate, endDate),
    loadMonobankProviderEntries(startDate, endDate),
    loadPrivatBankProviderEntries(startDate, endDate),
    loadYooMoneyProviderEntries(startDate, endDate),
    loadBinanceProviderEntries(startDate, endDate),
  ]);
  for (const result of providerResults) {
    if (!result) continue;
    providerEntries.push(...(result.entries || []));
    warnings.push(...(result.warnings || []));
  }
  if (!providerEntries.length && !warnings.length) return null;

  const movementRateLookup = buildMovementUsdRateLookup(movementValues, endDate);
  const entries = providerEntries
    .filter((entry) => entry?.direction === "income" && entry?.date && entry?.channel && Number(entry?.localAmount || 0) > 0)
    .map((entry, index) => normalizeRealIncomeEntry(entry, movementRateLookup, index));
  entries
    .filter((entry) => entry.needsVerification)
    .forEach((entry) => warnings.push(`${entry.source || "provider"} ${entry.sourceTransactionId || entry.id}: needs verification - provider fee/net missing`));
  const verifiedEntries = entries.filter((entry) => Number(entry.realNetUsd || 0) > 0);

  const refundEntries = verifiedEntries.filter(isRefundIncomeEntry);
  const exchangeEntries = verifiedEntries.filter((entry) => !isRefundIncomeEntry(entry) && isExchangeOrTransferIncomeEntry(entry));
  const candidateIncomeEntries = verifiedEntries.filter((entry) => !isRefundIncomeEntry(entry) && !isExchangeOrTransferIncomeEntry(entry));

  const { rowMatches, warnings: matchWarnings } = matchRealIncomeEntriesToMovement(candidateIncomeEntries, movementValues);
  const matchedEntryIds = new Set(rowMatches.map((match) => String(match.matchedEntryId || "").trim()).filter(Boolean));
  const matchedEntries = candidateIncomeEntries.filter((entry) => matchedEntryIds.has(getRealIncomeEntryKey(entry)));
  const unmatchedEntries = candidateIncomeEntries.filter((entry) => !matchedEntryIds.has(getRealIncomeEntryKey(entry)));
  const serviceOrderSummaryByChannel = summarizeRealIncomeByChannel(matchedEntries, movementValues, { includeMovementDirectFallback: false });
  warnings.push(...matchWarnings);
  warnings.push(...buildUnmatchedRealIncomeWarnings(unmatchedEntries));
  return {
    entries,
    rowMatches,
    refundEntries,
    exchangeEntries,
    candidateIncomeEntries,
    matchedEntries,
    unmatchedEntries,
    serviceOrderSummaryByChannel,
    serviceOrderSummaryTotals: getRealIncomeSummaryTotalsFromSummary(serviceOrderSummaryByChannel),
    summaryByChannel: summarizeRealIncomeByChannel(matchedEntries, movementValues),
    summaryTotals: summarizeRealIncomeTotals(matchedEntries, movementValues),
    refundSummaryByChannel: summarizeRealIncomeByChannel(refundEntries, movementValues, { includeMovementDirectFallback: false }),
    refundSummaryTotals: summarizeRealIncomeTotals(refundEntries, movementValues, { includeMovementDirectFallback: false }),
    exchangeSummaryByChannel: summarizeRealIncomeByChannel(exchangeEntries, movementValues, { includeMovementDirectFallback: false }),
    exchangeSummaryTotals: summarizeRealIncomeTotals(exchangeEntries, movementValues, { includeMovementDirectFallback: false }),
    unmatchedSummaryByChannel: summarizeRealIncomeByChannel(unmatchedEntries, movementValues, { includeMovementDirectFallback: false }),
    unmatchedSummaryTotals: summarizeRealIncomeTotals(unmatchedEntries, movementValues, { includeMovementDirectFallback: false }),
    allSummaryByChannel: summarizeRealIncomeByChannel(verifiedEntries, movementValues),
    allSummaryTotals: summarizeRealIncomeTotals(verifiedEntries, movementValues),
    warnings: [...new Set(warnings.filter(Boolean))],
  };
}

async function loadPayPalProviderEntries(startDate, endDate) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  const mcpClientId = String(process.env.PAYPAL_MCP_CLIENT_ID || "").trim();
  const mcpRefreshToken = String(process.env.PAYPAL_MCP_REFRESH_TOKEN || "").trim();
  if (!((clientId && clientSecret) || (mcpClientId && mcpRefreshToken))) {
    return null;
  }

  try {
    if (clientId && clientSecret) {
      const result = await fetchPayPalStatementEntries({
        startDate,
        endDate,
        clientId,
        clientSecret,
        environment: process.env.PAYPAL_ENVIRONMENT || "live",
        fetchImpl: fetch,
      });
      return { entries: result.entries || [], warnings: result.warnings || [] };
    }
    const result = await fetchPayPalStatementEntriesFromMcp({
      startDate,
      endDate,
      clientId: mcpClientId,
      refreshToken: mcpRefreshToken,
      restClientId: clientId,
      restClientSecret: clientSecret,
      environment: process.env.PAYPAL_ENVIRONMENT || "live",
      fetchImpl: fetch,
    });
    return { entries: result.entries || [], warnings: result.warnings || [] };
  } catch (error) {
    return { entries: [], warnings: [buildPayPalProviderWarning(error, { environment: process.env.PAYPAL_ENVIRONMENT || "live" })] };
  }
}

async function loadWiseProviderEntries(startDate, endDate) {
  const apiToken = String(process.env.WISE_API_TOKEN || "").trim();
  if (!apiToken) return null;
  try {
    const result = await fetchWiseStatementEntries({
      startDate,
      endDate,
      apiToken,
      profileId: process.env.WISE_PROFILE_ID,
      baseUrl: process.env.WISE_API_BASE,
      fetchImpl: fetch,
    });
    return { entries: result.entries || [], warnings: result.warnings || [] };
  } catch (error) {
    return { entries: [], warnings: [`Wise real income: ${String(error?.message || error)}`] };
  }
}

async function loadMonobankProviderEntries(startDate, endDate) {
  const apiToken = String(process.env.MONOBANK_API_TOKEN || "").trim();
  if (!apiToken) return null;
  try {
    const result = await fetchMonobankStatementEntries({
      startDate,
      endDate,
      apiToken,
      accountId: process.env.MONOBANK_ACCOUNT_ID,
      baseUrl: process.env.MONOBANK_API_BASE,
      fetchImpl: fetch,
    });
    return { entries: result.entries || [], warnings: result.warnings || [] };
  } catch (error) {
    return { entries: [], warnings: [`Monobank real income: ${String(error?.message || error)}`] };
  }
}

async function loadPrivatBankProviderEntries(startDate, endDate) {
  const apiToken = String(process.env.PRIVATBANK_API_TOKEN || "").trim();
  const baseUrl = String(process.env.PRIVATBANK_STATEMENT_URL || "").trim();
  if (!apiToken || !baseUrl) return null;
  try {
    const result = await fetchPrivatBankStatementEntries({
      startDate,
      endDate,
      apiToken,
      accountId: process.env.PRIVATBANK_ACCOUNT_ID,
      baseUrl,
      fetchImpl: fetch,
    });
    return { entries: result.entries || [], warnings: result.warnings || [] };
  } catch (error) {
    return { entries: [], warnings: [`PrivatBank real income: ${String(error?.message || error)}`] };
  }
}

async function loadYooMoneyProviderEntries(startDate, endDate) {
  const accessToken = String(process.env.YOOMONEY_ACCESS_TOKEN || "").trim();
  if (!accessToken) return null;
  try {
    const result = await fetchYooMoneyStatementEntries({
      startDate,
      endDate,
      accessToken,
      currency: process.env.YOOMONEY_CURRENCY || "RUB",
      baseUrl: process.env.YOOMONEY_API_BASE,
      fetchImpl: fetch,
    });
    return { entries: result.entries || [], warnings: [] };
  } catch (error) {
    return { entries: [], warnings: [`YooMoney real income: ${String(error?.message || error)}`] };
  }
}

async function loadBinanceProviderEntries(startDate, endDate) {
  const config = getBinanceProviderConfigFromEnv(process.env);
  if (!config) return null;
  try {
    const result = await fetchBinanceStatementEntries({
      startDate,
      endDate,
      ...config,
      fetchImpl: fetch,
    });
    return { entries: result.entries || [], warnings: result.warnings || [] };
  } catch (error) {
    return { entries: [], warnings: [`Binance real income: ${String(error?.message || error)}`] };
  }
}

function normalizeRealIncomeEntry(entry, movementRateLookup, index = 0) {
  const currency = String(entry?.currency || inferChannelCurrency(entry?.channel)).trim().toUpperCase();
  const feeCurrency = String(entry?.feeCurrency || currency).trim().toUpperCase();
  const realGrossLocal = Math.abs(Number(entry?.localAmount || 0));
  const hasFeeAmount = hasExplicitMoneyValue(entry?.feeAmount);
  const hasNetAmount = hasExplicitMoneyValue(entry?.netAmount);
  const explicitNetUsd = getExplicitRealIncomeNetUsd(entry);
  const realFeeLocal = hasFeeAmount ? Math.abs(Number(entry?.feeAmount || 0)) : null;
  const realNetLocal = hasNetAmount
    ? Math.abs(Number(entry?.netAmount || 0))
    : (hasFeeAmount ? Math.max(0, realGrossLocal - realFeeLocal) : null);
  const realGrossUsd = convertLocalAmountToUsd(realGrossLocal, currency, movementRateLookup, entry?.channel);
  const realFeeUsd = realFeeLocal === null
    ? null
    : convertLocalAmountToUsd(realFeeLocal, feeCurrency, movementRateLookup, entry?.channel);
  const derivedNetUsd = explicitNetUsd !== null
    ? explicitNetUsd
    : hasNetAmount
    ? convertLocalAmountToUsd(realNetLocal, currency, movementRateLookup, entry?.channel)
    : (realFeeUsd === null ? null : roundNumber(realGrossUsd - realFeeUsd));
  const realNetUsd = derivedNetUsd === null ? null : Math.max(0, roundNumber(derivedNetUsd));
  return {
    id: String(entry?.id || `${entry?.source || "provider"}-${entry?.sourceTransactionId || index}`),
    source: String(entry?.source || "").trim(),
    sourceTransactionId: String(entry?.sourceTransactionId || "").trim(),
    date: normalizeIsoDate(entry?.date),
    channel: String(entry?.channel || "").trim(),
    currency,
    feeCurrency,
    organization: String(entry?.organization || "").trim(),
    counterparty: String(entry?.counterparty || entry?.counterpartyName || "").trim(),
    description: String(entry?.description || entry?.comment || entry?.organization || "").trim(),
    comment: String(entry?.comment || "").trim(),
    operation: String(entry?.operation || "").trim(),
    operationType: String(entry?.operationType || entry?.operation_type || entry?.transferType || "").trim(),
    operation_type: String(entry?.operation_type || entry?.operationType || entry?.transferType || "").trim(),
    category: String(entry?.category || entry?.suggestedCategory || "").trim(),
    suggestedCategory: String(entry?.suggestedCategory || entry?.category || "").trim(),
    rawSourceId: String(entry?.rawSourceId || entry?.raw_source_id || entry?.sourceTransactionId || "").trim(),
    raw_source_id: String(entry?.raw_source_id || entry?.rawSourceId || entry?.sourceTransactionId || "").trim(),
    realGrossLocal: roundNumber(realGrossLocal),
    realFeeLocal: realFeeLocal === null ? null : roundNumber(realFeeLocal),
    realNetLocal: realNetLocal === null ? null : roundNumber(realNetLocal),
    realGrossUsd,
    realFeeUsd,
    realNetUsd,
    needsVerification: realNetUsd === null,
  };
}

function isRefundIncomeEntry(entry = {}) {
  const classifier = normalizeRealIncomeClassifier([
    entry.operation,
    entry.operationType,
    entry.operation_type,
    entry.category,
    entry.suggestedCategory,
  ].join(" "));
  if (/\b(refund|reversal|chargeback)\b/.test(classifier)) return true;
  const text = normalizeLookupText([
    entry.sourceTransactionId,
    entry.rawSourceId,
    entry.description,
    entry.comment,
    entry.organization,
    entry.counterparty,
  ].filter(Boolean).join(" "));
  return /\b(refund|refunded|reversal|chargeback)\b|возврат|повернен|travel refund|hotel refund/.test(text);
}

function isExchangeOrTransferIncomeEntry(entry = {}) {
  if (String(entry.source || "").trim().toLowerCase() === "binance_deposit") return true;
  const classifier = normalizeRealIncomeClassifier([
    entry.operation,
    entry.operationType,
    entry.operation_type,
    entry.category,
    entry.suggestedCategory,
  ].join(" "));
  if (/\b(exchange|internal_transfer|funding_transfer)\b/.test(classifier)) return true;
  const channel = normalizeLookupText(entry.channel);
  const text = normalizeLookupText([
    entry.sourceTransactionId,
    entry.rawSourceId,
    entry.description,
    entry.comment,
    entry.organization,
    entry.counterparty,
  ].filter(Boolean).join(" "));
  if (/exchange|internal|wallet|funding|обмен/.test(text)) return true;
  if (channel === normalizeLookupText("Binance funding") && /(yandex|яндекс|yoomoney|юmoney|юмани|rub|руб|funding|transfer|exchange|обмен|перевод)/.test(text)) return true;
  return false;
}

function normalizeRealIncomeClassifier(value) {
  return normalizeLookupText(value).replace(/\s+/g, "_");
}

function hasExplicitMoneyValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function getExplicitRealIncomeNetUsd(entry) {
  for (const value of [entry?.realNetUsd, entry?.usdAmount, entry?.amountUsd, entry?.amount_usd]) {
    if (!hasExplicitMoneyValue(value)) continue;
    return Math.abs(parseLooseNumber(value));
  }
  return null;
}

function summarizeRealIncomeByChannel(entries, movementValues, { includeMovementDirectFallback = true } = {}) {
  const movementStats = summarizeMovementChannels(movementValues);
  const directMovementIncome = includeMovementDirectFallback
    ? summarizeDirectMovementRealIncomeByChannel(movementValues)
    : {};
  return Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => {
    const channelEntries = entries.filter((entry) => entry.channel === channel);
    const fallbackNetUsd = roundNumber(directMovementIncome[channel] || 0);
    const entryNetUsd = sumBy(channelEntries, "realNetUsd");
    const netUsd = entryNetUsd || fallbackNetUsd;
    const grossUsd = sumBy(channelEntries, "realGrossUsd") || fallbackNetUsd;
    const feeUsd = sumBy(channelEntries, "realFeeUsd");
    const plannedReceivedUsd = roundNumber(movementStats.plannedReceivedUsdByChannel[channel] || 0);
    const differenceUsd = roundNumber(plannedReceivedUsd - netUsd);
    return [channel, {
      channel,
      currency: inferChannelCurrency(channel),
      plannedReceivedUsd,
      realGrossUsd: grossUsd,
      realFeeUsd: feeUsd,
      realNetUsd: netUsd,
      differenceUsd,
      differencePct: calculateDifferencePct(differenceUsd, netUsd),
    }];
  }));
}

function summarizeDirectMovementRealIncomeByChannel(movementValues) {
  const totals = Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => [channel, 0]));
  const rows = (movementValues || []).slice(3).filter((row) => /^\d+$/.test(String(row?.[0] || "").trim()));
  for (const row of rows) {
    const channel = resolveMovementRowChannel(row);
    if (channel !== "приват-фоп") continue;
    const netUsd = parseLooseNumber(row?.[20]) || parseLooseNumber(row?.[18]);
    if (netUsd <= 0) continue;
    totals[channel] = roundNumber(totals[channel] + netUsd);
  }
  return totals;
}

function buildEmptyRealIncomeSummaryRow(channel, plannedReceivedUsd = 0) {
  return {
    channel,
    currency: inferChannelCurrency(channel),
    plannedReceivedUsd: roundNumber(plannedReceivedUsd),
    realGrossUsd: 0,
    realFeeUsd: 0,
    realNetUsd: 0,
    differenceUsd: roundNumber(plannedReceivedUsd),
    differencePct: 0,
  };
}

function summarizeMovementServicePaymentsByChannel(movementValues = []) {
  const movementStats = summarizeMovementChannels(movementValues);
  const totalsByChannel = Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => [channel, 0]));
  const rows = (movementValues || []).slice(3).filter((row) => /^\d+$/.test(String(row?.[0] || "").trim()));

  for (const row of rows) {
    if (!isMovementServicePaymentRow(row)) continue;
    const channel = resolveMovementServicePaymentChannel(row);
    if (!channel || !Object.prototype.hasOwnProperty.call(totalsByChannel, channel)) continue;
    const netReceivedUsd = parseLooseNumber(row?.[20]);
    const clientPaidUsd = parseLooseNumber(row?.[18]);
    const servicePaymentUsd = netReceivedUsd > 0 ? netReceivedUsd : clientPaidUsd;
    if (!Number.isFinite(servicePaymentUsd) || servicePaymentUsd <= 0) continue;
    totalsByChannel[channel] = roundNumber(totalsByChannel[channel] + servicePaymentUsd);
  }

  return Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => {
    const realNetUsd = roundNumber(totalsByChannel[channel] || 0);
    const plannedReceivedUsd = roundNumber(movementStats.plannedReceivedUsdByChannel?.[channel] || 0);
    if (!realNetUsd) return [channel, buildEmptyRealIncomeSummaryRow(channel, plannedReceivedUsd)];
    const differenceUsd = roundNumber(plannedReceivedUsd - realNetUsd);
    return [channel, {
      channel,
      currency: inferChannelCurrency(channel),
      plannedReceivedUsd,
      realGrossUsd: realNetUsd,
      realFeeUsd: 0,
      realNetUsd,
      differenceUsd,
      differencePct: calculateDifferencePct(differenceUsd, realNetUsd),
    }];
  }));
}

function rebuildServicePaymentGapDiagnostics(realIncome = {}, movementValues = [], options = {}) {
  const servicePaymentSummaryByChannel =
    realIncome?.servicePaymentSummaryByChannel ||
    summarizeMovementServicePaymentsByChannel(movementValues);
  const servicePaymentSummaryTotals =
    realIncome?.servicePaymentSummaryTotals ||
    getRealIncomeSummaryTotalsFromSummary(servicePaymentSummaryByChannel);
  const servicePaymentGap = buildServicePaymentGapDiagnostics(movementValues, servicePaymentSummaryByChannel, {
    providerEntries: realIncome?.candidateIncomeEntries || realIncome?.entries || [],
    ledgerOperations: options.ledgerOperations || [],
    period: options.period || {},
  });
  const orderPaymentCoverage = realIncome?.orderPaymentCoverage || buildOrderPaymentCoverageReport(movementValues, {
    providerEntries: realIncome?.candidateIncomeEntries || realIncome?.entries || [],
    ledgerOperations: options.ledgerOperations || [],
    period: options.period || {},
    transfers: options.transfers || [],
  });
  const actualPayments = buildActualPaymentSummaryByChannel(orderPaymentCoverage.rows, { realIncome });
  return {
    ...realIncome,
    servicePaymentSummaryByChannel,
    servicePaymentSummaryTotals,
    servicePaymentGapByChannel: servicePaymentGap.servicePaymentGapByChannel,
    servicePaymentGapTotals: servicePaymentGap.servicePaymentGapTotals,
    orderPaymentCoverage,
    actualPaymentSummaryByChannel: actualPayments.summaryByChannel,
    actualPaymentSummaryTotals: actualPayments.totals,
  };
}

export function buildOrderPaymentCoverageReport(movementValues = [], options = {}) {
  const header = movementValues?.[2] || [];
  const netReceivedIndex = getMovementNetReceivedIndex(header);
  const providerNetIndex = getMovementProviderNetIndex(header);
  const dataRows = (movementValues || [])
    .slice(3)
    .filter((row) => /^\d+$/.test(String(row?.[0] || "").trim()));
  const providerGroupTotals = buildServicePaymentProviderGroupTotals({
    providerEntries: options.providerEntries || [],
    ledgerOperations: options.ledgerOperations || [],
    movementValues,
    period: options.period || {},
  });
  const candidates = dataRows
    .map((row) => buildOrderPaymentCoverageCandidate(row, { netReceivedIndex, providerNetIndex }))
    .filter((row) => row.accruedPlus3Usd > 0);
  const transferConfirmationByRowNumber = buildOrderPaymentTransferConfirmationMap(candidates, options.transfers || []);
  const allocationByRowNumber = allocateOrderPaymentCoverageRows(candidates, providerGroupTotals, transferConfirmationByRowNumber);
  const rows = candidates.map((candidate) => buildOrderPaymentCoverageRow(candidate, allocationByRowNumber.get(candidate.rowNumber)));
  const summary = rows.reduce((totals, row) => {
    const excluded = row.status === "excluded";
    return {
      totalAccruedOrdersUsd: roundNumber(totals.totalAccruedOrdersUsd + (excluded ? 0 : row.accruedPlus3Usd)),
      totalAllocatedToOrdersUsd: roundNumber(totals.totalAllocatedToOrdersUsd + (excluded ? 0 : row.allocatedPaidUsd)),
      totalRemainingOrderUsd: roundNumber(totals.totalRemainingOrderUsd + (excluded ? 0 : Math.max(0, row.remainingUsd))),
      totalOverpaidOffsetUsd: roundNumber(totals.totalOverpaidOffsetUsd + Math.max(0, row.allocatedPaidUsd - row.accruedPlus3Usd)),
      totalExcludedNonServiceUsd: roundNumber(totals.totalExcludedNonServiceUsd + (excluded ? row.accruedPlus3Usd : 0)),
      totalUnexplainedUsd: roundNumber(totals.totalUnexplainedUsd),
    };
  }, {
    totalAccruedOrdersUsd: 0,
    totalAllocatedToOrdersUsd: 0,
    totalRemainingOrderUsd: 0,
    totalOverpaidOffsetUsd: 0,
    totalExcludedNonServiceUsd: 0,
    totalUnexplainedUsd: 0,
  });
  const channelCoverage = buildCoverageSummaryByChannel(rows);
  return {
    rows,
    summary,
    summaryByChannel: channelCoverage.summaryByChannel,
    summaryTotals: channelCoverage.totals,
    actionableRows: channelCoverage.actionableRows,
  };
}

export function buildActualPaymentSummaryByChannel(coverageRows = [], options = {}) {
  const summaryByChannel = {};
  for (const row of coverageRows || []) {
    if (!isIncludedOrderPaymentCoverageRow(row)) continue;
    const actualPaidUsd = roundNumber(row?.allocatedPaidUsd || 0);
    if (actualPaidUsd <= 0) continue;
    const channel = row.channel || "Без канала";
    const existing = summaryByChannel[channel] || {
      channel,
      actualPaidUsd: 0,
      rowCount: 0,
      rows: [],
    };
    existing.actualPaidUsd = roundNumber(existing.actualPaidUsd + actualPaidUsd);
    existing.rowCount += 1;
    existing.rows.push(row.rowNumber);
    summaryByChannel[channel] = existing;
  }
  applyProviderNetActualOverrides(summaryByChannel, options.realIncome);
  const total = roundNumber(Object.values(summaryByChannel).reduce((sum, row) => sum + Number(row.actualPaidUsd || 0), 0));
  for (const row of Object.values(summaryByChannel)) {
    row.percent = total > 0 ? roundNumber((row.actualPaidUsd / total) * 100) : 0;
  }
  return {
    summaryByChannel,
    totals: {
      actualPaidUsd: total,
    },
  };
}

function applyProviderNetActualOverrides(summaryByChannel = {}, realIncome = {}) {
  const summaries = [
    realIncome?.summaryByChannel,
    realIncome?.allSummaryByChannel,
  ].filter(Boolean);
  for (const [channel, row] of Object.entries(summaryByChannel)) {
    if (!isProviderNetRequiredActualChannel(channel)) continue;
    const providerNetUsd = summaries
      .map((summary) => Number(summary?.[channel]?.realNetUsd || 0))
      .find((amount) => Number.isFinite(amount) && amount > 0);
    if (!providerNetUsd) continue;
    row.actualPaidUsd = roundNumber(providerNetUsd);
    row.source = "provider net";
  }
}

function isProviderNetRequiredActualChannel(channel = "") {
  return /paypal|п(?:ей|эй)п|пейпал/i.test(String(channel || ""));
}

export function buildCoverageSummaryByChannel(coverageRows = []) {
  const summaryByChannel = {};
  const actionableRows = [];
  for (const row of coverageRows || []) {
    if (isActionableOrderPaymentCoverageRow(row)) {
      actionableRows.push({
        rowNumber: row.rowNumber,
        date: row.date,
        client: row.client,
        channel: row.channel || "Без канала",
        remainingUsd: roundNumber(row.remainingUsd || 0),
        status: row.status,
      });
    }
    if (!isIncludedOrderPaymentCoverageRow(row)) continue;
    const channel = row.channel || "Без канала";
    const coveredUsd = roundNumber(Math.min(Number(row.allocatedPaidUsd || 0), Number(row.accruedPlus3Usd || 0)));
    const allocatedPaidUsd = roundNumber(row.allocatedPaidUsd || 0);
    const remainingUsd = roundNumber(Math.max(0, row.remainingUsd || 0));
    const existing = summaryByChannel[channel] || {
      channel,
      coveredUsd: 0,
      allocatedPaidUsd: 0,
      remainingUsd: 0,
      rowCount: 0,
      rows: [],
    };
    existing.coveredUsd = roundNumber(existing.coveredUsd + coveredUsd);
    existing.allocatedPaidUsd = roundNumber(existing.allocatedPaidUsd + allocatedPaidUsd);
    existing.remainingUsd = roundNumber(existing.remainingUsd + remainingUsd);
    existing.rowCount += 1;
    existing.rows.push(row.rowNumber);
    summaryByChannel[channel] = existing;
  }
  const totalCoveredUsd = roundNumber(Object.values(summaryByChannel).reduce((sum, row) => sum + Number(row.coveredUsd || 0), 0));
  const totalAllocatedPaidUsd = roundNumber(Object.values(summaryByChannel).reduce((sum, row) => sum + Number(row.allocatedPaidUsd || 0), 0));
  const totalRemainingUsd = roundNumber(Object.values(summaryByChannel).reduce((sum, row) => sum + Number(row.remainingUsd || 0), 0));
  for (const row of Object.values(summaryByChannel)) {
    row.percent = totalCoveredUsd > 0 ? roundNumber((row.coveredUsd / totalCoveredUsd) * 100) : 0;
  }
  return {
    summaryByChannel,
    totals: {
      coveredUsd: totalCoveredUsd,
      allocatedPaidUsd: totalAllocatedPaidUsd,
      remainingUsd: totalRemainingUsd,
    },
    actionableRows,
  };
}

function isIncludedOrderPaymentCoverageRow(row = {}) {
  if (row.status === "excluded") return false;
  if (row.source === "transfer_confirmed" || row.source === "direct_to_transfers") return true;
  const text = normalizeLookupText([
    row.service,
    row.paymentMethod,
    row.reviewNote,
    row.status,
  ].filter(Boolean).join(" "));
  return !isExcludedServicePaymentText(text);
}

function isActionableOrderPaymentCoverageRow(row = {}) {
  return Number(row.remainingUsd || 0) > 0.01 ||
    ["needs verification", "no payment", "underpaid"].includes(String(row.status || "").trim().toLowerCase());
}

function buildOrderPaymentCoverageCandidate(row = [], options = {}) {
  const accruedPlus3Usd = parseLooseNumber(row?.[9]) || 0;
  const clientPaidUsd = parseLooseNumber(row?.[18]) || 0;
  const netReceivedUsd = options.netReceivedIndex >= 0 ? (parseLooseNumber(row?.[options.netReceivedIndex]) || 0) : 0;
  const providerNetUsd = options.providerNetIndex >= 0 ? (parseLooseNumber(row?.[options.providerNetIndex]) || 0) : 0;
  const paymentMethod = String(row?.[14] || "").trim();
  const date = normalizeDisplayDate(row?.[1]) || String(row?.[1] || "").trim();
  const channel = getOrderPaymentCoverageChannel(row);
  const safeDirectAmountUsd = getOrderPaymentCoverageDirectAmount(row, {
    clientPaidUsd,
    netReceivedUsd,
    providerNetUsd,
    paymentMethod,
  });
  const reason = getServicePaymentGapReason(row, {
    expectedUsd: accruedPlus3Usd,
    clientPaidUsd,
    netReceivedUsd,
    providerNetUsd,
    includedAmountUsd: safeDirectAmountUsd,
    includedByCurrentSummary: safeDirectAmountUsd > 0,
  });
  return {
    row,
    rowNumber: String(row?.[0] || "").trim(),
    date,
    client: String(row?.[2] || "").trim(),
    service: String(row?.[3] || "").trim(),
    accruedPlus3Usd,
    paymentMethod,
    channel,
    clientPaidUsd,
    netReceivedUsd,
    providerNetUsd,
    safeDirectAmountUsd,
    reason,
    statusText: String(row?.[23] || "").trim(),
    reviewNote: String(row?.[24] || "").trim(),
    needsProviderNet: /paypal|п(?:ей|эй)п|пейпал/i.test(`${paymentMethod} ${channel}`),
    groupKey: getOrderPaymentCoverageGroupKey({ date, client: row?.[2], paymentMethod, channel }),
    providerGroupKey: getServicePaymentProviderGroupKey(date, channel),
  };
}

function allocateOrderPaymentCoverageRows(candidates = [], providerGroupTotals = new Map(), transferConfirmationByRowNumber = new Map()) {
  const output = new Map();
  const groups = new Map();
  for (const candidate of candidates) {
    const transferConfirmation = transferConfirmationByRowNumber.get(candidate.rowNumber);
    if (transferConfirmation) {
      output.set(candidate.rowNumber, buildOrderPaymentTransferAllocation(candidate, transferConfirmation));
      continue;
    }
    if (!candidate.groupKey) {
      output.set(candidate.rowNumber, buildOrderPaymentDirectAllocation(candidate));
      continue;
    }
    const group = groups.get(candidate.groupKey) || [];
    group.push(candidate);
    groups.set(candidate.groupKey, group);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) {
      output.set(group[0].rowNumber, buildOrderPaymentDirectAllocation(group[0]));
      continue;
    }
    const rowPaidUsd = roundNumber(group.reduce((sum, row) => sum + Math.max(row.netReceivedUsd || 0, row.clientPaidUsd || 0), 0));
    const providerPaidUsd = roundNumber(providerGroupTotals.get(group[0].providerGroupKey) || 0);
    const useProviderPaid = providerPaidUsd > 0 && group.some((row) => row.needsProviderNet);
    const groupPaidUsd = useProviderPaid ? providerPaidUsd : rowPaidUsd;
    const allocationSource = useProviderPaid ? "provider net" : "grouped same-date";
    let remainingGroupPaidUsd = groupPaidUsd;
    for (const candidate of group.slice().sort(compareOrderPaymentCoverageCandidates)) {
      const allocatedPaidUsd = roundNumber(Math.min(candidate.accruedPlus3Usd, Math.max(0, remainingGroupPaidUsd)));
      remainingGroupPaidUsd = roundNumber(remainingGroupPaidUsd - allocatedPaidUsd);
      output.set(candidate.rowNumber, {
        allocatedPaidUsd,
        allocationSource: allocatedPaidUsd > 0 ? allocationSource : "none",
      });
    }
    if (remainingGroupPaidUsd > 0) {
      const last = group.slice().sort(compareOrderPaymentCoverageCandidates).at(-1);
      const current = output.get(last.rowNumber) || { allocatedPaidUsd: 0, allocationSource };
      output.set(last.rowNumber, {
        ...current,
        allocatedPaidUsd: roundNumber(current.allocatedPaidUsd + remainingGroupPaidUsd),
      });
    }
  }
  return output;
}

function buildOrderPaymentDirectAllocation(candidate) {
  if (candidate.reason === "excluded deposit/non-service") {
    return { allocatedPaidUsd: 0, allocationSource: "excluded" };
  }
  if (candidate.safeDirectAmountUsd <= 0) {
    return { allocatedPaidUsd: 0, allocationSource: "none" };
  }
  return {
    allocatedPaidUsd: candidate.safeDirectAmountUsd,
    allocationSource: candidate.netReceivedUsd > 0 ? "movement net received" : (candidate.providerNetUsd > 0 ? "provider net" : "direct row"),
  };
}

function buildOrderPaymentTransferAllocation(candidate, confirmation = {}) {
  const confirmedUsd = roundNumber(Math.min(
    Number(candidate.accruedPlus3Usd || 0),
    Number(confirmation.amountUsd || 0),
  ));
  return {
    allocatedPaidUsd: confirmedUsd,
    allocationSource: confirmation.source || "transfer_confirmed",
    source: confirmation.source || "transfer_confirmed",
    confirmationNote: buildOrderPaymentTransferConfirmationNote(confirmation),
  };
}

function buildOrderPaymentCoverageRow(candidate, allocation = {}) {
  const allocatedPaidUsd = roundNumber(allocation.allocatedPaidUsd || 0);
  const remainingUsd = candidate.reason === "excluded deposit/non-service"
    ? 0
    : roundNumber(Math.max(0, candidate.accruedPlus3Usd - allocatedPaidUsd));
  const status = getOrderPaymentCoverageStatus(candidate, { allocatedPaidUsd, remainingUsd });
  return {
    rowNumber: candidate.rowNumber,
    date: candidate.date,
    client: candidate.client,
    service: candidate.service,
    accruedPlus3Usd: roundNumber(candidate.accruedPlus3Usd),
    paymentMethod: candidate.paymentMethod,
    channel: candidate.channel || "Без канала",
    allocatedPaidUsd,
    allocationSource: allocation.allocationSource || "none",
    remainingUsd,
    status,
    source: allocation.source || "",
    netReceivedUsd: roundNumber(candidate.netReceivedUsd),
    providerNetUsd: roundNumber(candidate.providerNetUsd),
    reviewNote: getOrderPaymentCoverageReviewNote(candidate, allocation),
  };
}

function getOrderPaymentCoverageReviewNote(candidate, allocation = {}) {
  if (allocation.source === "transfer_confirmed" || allocation.source === "direct_to_transfers") {
    return allocation.confirmationNote || allocation.source;
  }
  return candidate.reviewNote || candidate.reason || "";
}

function getOrderPaymentCoverageStatus(candidate, { allocatedPaidUsd = 0, remainingUsd = 0 } = {}) {
  if (candidate.reason === "excluded deposit/non-service") return "excluded";
  if (remainingUsd > 0.01 && isUnsafeServicePaymentGapReason(candidate.reason)) return "needs verification";
  if (remainingUsd > 0.01 && allocatedPaidUsd <= 0) return "no payment";
  if (remainingUsd > 0.01) return "underpaid";
  if (allocatedPaidUsd - candidate.accruedPlus3Usd > 0.01) return "overpaid";
  return "covered";
}

function getOrderPaymentCoverageDirectAmount(row = [], { clientPaidUsd = 0, netReceivedUsd = 0, providerNetUsd = 0, paymentMethod = "" } = {}) {
  if (netReceivedUsd > 0) return netReceivedUsd;
  if (providerNetUsd > 0) return providerNetUsd;
  if (isExplicitNoFeeDirectPayment(paymentMethod)) return clientPaidUsd;
  if (isMovementServicePaymentRow(row) && clientPaidUsd > 0 && !/paypal|п(?:ей|эй)п|пейпал/i.test(paymentMethod)) return clientPaidUsd;
  return 0;
}

function getOrderPaymentCoverageChannel(row = []) {
  const resolved = resolveMovementServicePaymentDiagnosticChannel(row) || resolveMovementRowChannel(row);
  if (resolved) return resolved;
  const paymentMethod = normalizeLookupText(row?.[14]);
  if (/wise|transferwise|трансервайз/.test(paymentMethod)) return "трансервайз дол";
  if (/paypal|п[еэ]йп/.test(paymentMethod)) return "пейпал дол";
  if (/privat|приват|фоп|fop/.test(paymentMethod)) return "приват-фоп";
  return "";
}

function buildOrderPaymentTransferConfirmationMap(candidates = [], transfers = []) {
  const matches = new Map();
  const normalizedTransfers = normalizeOrderPaymentTransferRows(transfers);
  if (!normalizedTransfers.length) return matches;
  const usedKeys = new Set();
  for (const candidate of candidates || []) {
    const match = findOrderPaymentTransferConfirmation(candidate, normalizedTransfers, usedKeys);
    if (!match) continue;
    matches.set(candidate.rowNumber, match);
    usedKeys.add(match.matchKey);
  }
  return matches;
}

function normalizeOrderPaymentTransferRows(transfers = []) {
  return (transfers || []).map((row) => {
    const date = normalizeIsoDate(row?.transferDate || row?.date);
    const currency = String(row?.currency || "").trim().toUpperCase();
    const explicitUsd = firstPositiveLooseNumber([row?.usdAmount, row?.amountUsd, row?.amount_usd]);
    const amount = parseLooseNumber(row?.amount);
    const amountUsd = explicitUsd > 0
      ? explicitUsd
      : (currency === "USD" && amount !== null ? Math.abs(amount) : 0);
    const channel = String(row?.channel || row?.destination || row?.toAccount || "").trim();
    const who = String(row?.who || row?.fromAccount || row?.comment || "").trim();
    return {
      date,
      channel,
      normalizedChannel: normalizeLookupText(channel),
      who,
      normalizedWho: normalizeLookupText(who),
      amountUsd: roundNumber(Math.abs(amountUsd || 0)),
      rawSourceId: String(row?.raw_source_id || row?.rawSourceId || row?.sourceTransactionId || "").trim(),
      comment: String(row?.comment || "").trim(),
    };
  }).filter((row) => row.date && row.amountUsd > 0);
}

function findOrderPaymentTransferConfirmation(candidate, normalizedTransfers = [], usedKeys = new Set()) {
  if (!isTransferConfirmableOrderPaymentCandidate(candidate)) return null;
  const expectedUsd = roundNumber(candidate.accruedPlus3Usd || 0);
  if (expectedUsd <= 0) return null;
  const normalizedClient = normalizeLookupText(candidate.client);
  const normalizedChannel = normalizeLookupText(candidate.channel || candidate.paymentMethod);
  const matches = normalizedTransfers
    .filter((transfer) => {
      const matchKey = transfer.rawSourceId || `${transfer.date}|${transfer.normalizedWho}|${transfer.amountUsd}|${transfer.normalizedChannel}`;
      if (usedKeys.has(matchKey)) return false;
      if (Math.abs(transfer.amountUsd - expectedUsd) > 0.05) return false;
      const dayOffset = getIsoDateDiffDays(candidate.date, transfer.date);
      if (dayOffset === null || Math.abs(dayOffset) > 2) return false;
      if (!doesOrderPaymentTransferClientMatch(normalizedClient, transfer.normalizedWho)) return false;
      if (!doesOrderPaymentTransferChannelMatch(normalizedChannel, transfer.normalizedChannel, transfer.comment)) return false;
      return true;
    })
    .map((transfer) => {
      const dayOffset = getIsoDateDiffDays(candidate.date, transfer.date) || 0;
      const matchKey = transfer.rawSourceId || `${transfer.date}|${transfer.normalizedWho}|${transfer.amountUsd}|${transfer.normalizedChannel}`;
      return {
        ...transfer,
        dayOffset,
        matchKey,
      };
    })
    .sort((left, right) => Math.abs(left.dayOffset) - Math.abs(right.dayOffset));
  const bestMatch = matches[0];
  if (!bestMatch) return null;
  return {
    ...bestMatch,
    source: isDirectToTransfersOrderPaymentCandidate(candidate) ? "direct_to_transfers" : "transfer_confirmed",
  };
}

function isTransferConfirmableOrderPaymentCandidate(candidate = {}) {
  return isWiseLikeOrderPaymentChannel(candidate.channel || candidate.paymentMethod);
}

function isDirectToTransfersOrderPaymentCandidate(candidate = {}) {
  return /(ковалев|kovalev)/.test(normalizeLookupText(candidate.client)) &&
    isWiseLikeOrderPaymentChannel(candidate.channel || candidate.paymentMethod);
}

function isWiseLikeOrderPaymentChannel(value = "") {
  return /(wise|transferwise|трансервайз)/.test(normalizeLookupText(value));
}

function doesOrderPaymentTransferClientMatch(normalizedClient = "", normalizedWho = "") {
  if (!normalizedClient || !normalizedWho) return false;
  return normalizedWho.includes(normalizedClient) || normalizedClient.includes(normalizedWho);
}

function doesOrderPaymentTransferChannelMatch(normalizedChannel = "", normalizedTransferChannel = "", comment = "") {
  const text = normalizeLookupText([normalizedTransferChannel, comment].filter(Boolean).join(" "));
  if (normalizedChannel && normalizedTransferChannel && normalizedTransferChannel.includes(normalizedChannel)) return true;
  if (normalizedChannel === normalizeLookupText("трансервайз дол") && /wise|transferwise|трансервайз/.test(text)) return true;
  return false;
}

function buildOrderPaymentTransferConfirmationNote(confirmation = {}) {
  return joinReviewParts([
    confirmation.source || "transfer_confirmed",
    confirmation.date ? `matched transfer ${confirmation.date}` : "",
    confirmation.amountUsd > 0 ? `${formatDisplayNumber(confirmation.amountUsd)} USD` : "",
    confirmation.dayOffset ? `${confirmation.dayOffset > 0 ? "+" : ""}${confirmation.dayOffset}d` : "",
    confirmation.rawSourceId || "",
  ]);
}

function getOrderPaymentCoverageGroupKey({ date, client, paymentMethod, channel } = {}) {
  const normalizedDate = normalizeIsoDate(date);
  const normalizedClient = normalizeLookupText(client);
  const normalizedPayment = normalizeLookupText(paymentMethod);
  const normalizedChannel = normalizeLookupText(channel);
  if (!normalizedDate || !normalizedClient || (!normalizedPayment && !normalizedChannel)) return "";
  return `${normalizedDate}|${normalizedClient}|${normalizedPayment || normalizedChannel}|${normalizedChannel}`;
}

function compareOrderPaymentCoverageCandidates(left, right) {
  return left.rowNumber.localeCompare(right.rowNumber, "en", { numeric: true });
}

function getIsoDateDiffDays(left, right) {
  const leftDate = normalizeIsoDate(left);
  const rightDate = normalizeIsoDate(right);
  if (!leftDate || !rightDate) return null;
  const leftTime = Date.parse(`${leftDate}T00:00:00Z`);
  const rightTime = Date.parse(`${rightDate}T00:00:00Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.round((rightTime - leftTime) / 86400000);
}

export function buildServicePaymentGapDiagnostics(movementValues = [], servicePaymentSummaryByChannel = {}, options = {}) {
  const diagnosticsByChannel = new Map();
  const header = movementValues?.[2] || [];
  const netReceivedIndex = getMovementNetReceivedIndex(header);
  const providerNetIndex = getMovementProviderNetIndex(header);
  const dataRows = (movementValues || []).slice(3).filter((row) => /^\d+$/.test(String(row?.[0] || "").trim()));
  const providerGroupTotals = buildServicePaymentProviderGroupTotals({
    providerEntries: options.providerEntries || [],
    ledgerOperations: options.ledgerOperations || [],
    movementValues,
    period: options.period || {},
  });
  const candidates = [];

  for (const row of dataRows) {
    if (isKovalevWiseBoleslavMovementRow({ client: row?.[2], paymentMethod: row?.[14] })) continue;
    candidates.push(buildServicePaymentGapCandidate(row, { netReceivedIndex, providerNetIndex }));
  }

  const allocatedRowNumbers = allocateGroupedServicePaymentDiagnostics(candidates, diagnosticsByChannel, providerGroupTotals);
  for (const candidate of candidates) {
    if (allocatedRowNumbers.has(candidate.rowNumber)) continue;
    if (!candidate.reason && Math.abs(candidate.expectedUsd - candidate.includedAmountUsd) < 0.0001) continue;
    addServicePaymentDiagnosticRow(diagnosticsByChannel, candidate.channel, {
      expectedUsd: candidate.expectedUsd,
      includedUsd: candidate.includedAmountUsd,
      missingUnsafeUsd: isUnsafeServicePaymentGapReason(candidate.reason) ? candidate.expectedUsd : 0,
      offsetUsd: candidate.includedAmountUsd > candidate.expectedUsd
        ? roundNumber(candidate.includedAmountUsd - candidate.expectedUsd)
        : 0,
      row: buildServicePaymentGapSourceRow(candidate, {
        included: Boolean(candidate.includedAmountUsd > 0),
        reason: candidate.reason || "duplicate/offset/overpaid",
      }),
    });
  }

  const servicePaymentGapByChannel = Array.from(diagnosticsByChannel.values())
    .map((row) => ({
      ...row,
      expectedUsd: roundNumber(row.expectedUsd),
      includedUsd: roundNumber(row.includedUsd),
      missingUnsafeUsd: roundNumber(row.missingUnsafeUsd),
      offsetUsd: roundNumber(row.offsetUsd),
      netGapUsd: roundNumber(row.expectedUsd - row.includedUsd),
    }))
    .filter((row) => (
      row.expectedUsd ||
      row.includedUsd ||
      row.missingUnsafeUsd ||
      row.offsetUsd ||
      row.rows.length
    ))
    .sort((left, right) => Math.abs(right.netGapUsd) - Math.abs(left.netGapUsd) || left.channel.localeCompare(right.channel, "ru"));

  return {
    servicePaymentGapByChannel,
    servicePaymentGapTotals: servicePaymentGapByChannel.reduce((totals, row) => ({
      expectedUsd: roundNumber(totals.expectedUsd + row.expectedUsd),
      includedUsd: roundNumber(totals.includedUsd + row.includedUsd),
      missingUnsafeUsd: roundNumber(totals.missingUnsafeUsd + row.missingUnsafeUsd),
      offsetUsd: roundNumber(totals.offsetUsd + row.offsetUsd),
      netGapUsd: roundNumber(totals.netGapUsd + row.netGapUsd),
    }), {
      expectedUsd: 0,
      includedUsd: 0,
      missingUnsafeUsd: 0,
      offsetUsd: 0,
      netGapUsd: 0,
    }),
  };
}

function buildServicePaymentGapCandidate(row = [], options = {}) {
  const expectedUsd = parseLooseNumber(row?.[9]) || 0;
  const clientPaidUsd = parseLooseNumber(row?.[18]) || 0;
  const netReceivedUsd = options.netReceivedIndex >= 0 ? (parseLooseNumber(row?.[options.netReceivedIndex]) || 0) : 0;
  const providerNetUsd = options.providerNetIndex >= 0 ? (parseLooseNumber(row?.[options.providerNetIndex]) || 0) : 0;
  const includedByCurrentSummary = isMovementServicePaymentRow(row);
  const includedAmountUsd = includedByCurrentSummary
    ? (netReceivedUsd > 0 ? netReceivedUsd : clientPaidUsd)
    : 0;
  const reason = getServicePaymentGapReason(row, {
    expectedUsd,
    clientPaidUsd,
    netReceivedUsd,
    providerNetUsd,
    includedAmountUsd,
    includedByCurrentSummary,
  });
  const channel = getServicePaymentGapChannel(row);
  const date = normalizeDisplayDate(row?.[1]) || String(row?.[1] || "").trim();
  const client = String(row?.[2] || "").trim();
  const paymentMethod = String(row?.[14] || "").trim();
  const groupPaidUsd = netReceivedUsd > 0 ? netReceivedUsd : clientPaidUsd;
  return {
    row,
    rowNumber: String(row?.[0] || "").trim(),
    date,
    client,
    paymentMethod,
    channel,
    expectedUsd,
    clientPaidUsd,
    netReceivedUsd,
    providerNetUsd,
    includedAmountUsd,
    groupPaidUsd,
    includedByCurrentSummary,
    reason,
    groupKey: getServicePaymentDiagnosticGroupKey({ date, client, channel }),
    providerGroupKey: getServicePaymentProviderGroupKey(date, channel),
    needsProviderNet: /paypal|п(?:ей|эй)п(?:е|э)л|пейпал/i.test(`${paymentMethod} ${channel}`),
  };
}

function allocateGroupedServicePaymentDiagnostics(candidates = [], diagnosticsByChannel, providerGroupTotals = new Map()) {
  const allocatedRowNumbers = new Set();
  const groups = new Map();
  for (const candidate of candidates) {
    if (!candidate.groupKey) continue;
    const group = groups.get(candidate.groupKey) || [];
    group.push(candidate);
    groups.set(candidate.groupKey, group);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const groupAccruedUsd = roundNumber(group.reduce((sum, row) => sum + row.expectedUsd, 0));
    const rowPaidUsd = roundNumber(group.reduce((sum, row) => sum + row.groupPaidUsd, 0));
    const providerPaidUsd = roundNumber(providerGroupTotals.get(group[0].providerGroupKey) || 0);
    const useProviderPaid = providerPaidUsd > 0 && group.some((row) => row.needsProviderNet);
    const groupPaidUsd = useProviderPaid ? providerPaidUsd : rowPaidUsd;
    if (groupPaidUsd <= 0) continue;

    const groupDiffUsd = roundNumber(groupAccruedUsd - groupPaidUsd);
    group.forEach((row) => allocatedRowNumbers.add(row.rowNumber));
    if (Math.abs(groupDiffUsd) <= 0.05) continue;

    const rowNumbers = group.map((row) => row.rowNumber).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
    const reason = groupDiffUsd > 0 ? "group net underpaid" : "group net overpaid";
    addServicePaymentDiagnosticRow(diagnosticsByChannel, group[0].channel, {
      expectedUsd: groupAccruedUsd,
      includedUsd: groupPaidUsd,
      missingUnsafeUsd: groupDiffUsd > 0 ? groupDiffUsd : 0,
      offsetUsd: groupDiffUsd < 0 ? Math.abs(groupDiffUsd) : 0,
      row: {
        rowNumber: `${rowNumbers[0]}-${rowNumbers.at(-1)}`,
        date: group[0].date,
        client: group[0].client,
        order: `Grouped payment allocation (${group.length} rows)`,
        paymentMethod: group[0].paymentMethod,
        channel: group[0].channel,
        accruedUsd: groupAccruedUsd,
        clientPaidUsd: roundNumber(rowPaidUsd),
        providerNetUsd: useProviderPaid ? groupPaidUsd : 0,
        included: true,
        reason,
        status: "",
        reviewNote: `grouped payment allocation: ${rowNumbers.join(", ")}`,
      },
    });
  }
  return allocatedRowNumbers;
}

function addServicePaymentDiagnosticRow(diagnosticsByChannel, channel, diagnostic) {
  const existing = diagnosticsByChannel.get(channel) || {
    channel,
    expectedUsd: 0,
    includedUsd: 0,
    missingUnsafeUsd: 0,
    offsetUsd: 0,
    netGapUsd: 0,
    rows: [],
  };
  existing.expectedUsd = roundNumber(existing.expectedUsd + Number(diagnostic.expectedUsd || 0));
  existing.includedUsd = roundNumber(existing.includedUsd + Number(diagnostic.includedUsd || 0));
  existing.missingUnsafeUsd = roundNumber(existing.missingUnsafeUsd + Number(diagnostic.missingUnsafeUsd || 0));
  existing.offsetUsd = roundNumber(existing.offsetUsd + Number(diagnostic.offsetUsd || 0));
  existing.rows.push(diagnostic.row);
  diagnosticsByChannel.set(channel, existing);
}

function buildServicePaymentGapSourceRow(candidate, { included, reason } = {}) {
  return {
    rowNumber: candidate.rowNumber,
    date: candidate.date,
    client: candidate.client,
    order: String(candidate.row?.[3] || "").trim(),
    paymentMethod: candidate.paymentMethod,
    channel: candidate.channel,
    accruedUsd: roundNumber(candidate.expectedUsd),
    clientPaidUsd: roundNumber(candidate.clientPaidUsd),
    providerNetUsd: roundNumber(candidate.providerNetUsd),
    included: Boolean(included),
    reason,
    status: String(candidate.row?.[23] || "").trim(),
    reviewNote: String(candidate.row?.[24] || "").trim(),
  };
}

function getServicePaymentDiagnosticGroupKey({ date, client, channel } = {}) {
  const normalizedDate = normalizeIsoDate(date);
  const normalizedClient = normalizeLookupText(client);
  const normalizedChannel = normalizeLookupText(channel);
  if (!normalizedDate || !normalizedClient || !normalizedChannel || channel === "Без канала") return "";
  return `${normalizedDate}|${normalizedClient}|${normalizedChannel}`;
}

function getServicePaymentProviderGroupKey(date, channel) {
  const normalizedDate = normalizeIsoDate(date);
  const normalizedChannel = normalizeLookupText(channel);
  if (!normalizedDate || !normalizedChannel || channel === "Без канала") return "";
  return `${normalizedDate}|${normalizedChannel}`;
}

function buildServicePaymentProviderGroupTotals({ providerEntries = [], ledgerOperations = [], movementValues = [], period = {} } = {}) {
  const totals = new Map();
  for (const entry of providerEntries || []) {
    if (entry?.needsVerification) continue;
    addServicePaymentProviderGroupTotal(totals, {
      date: entry?.date,
      channel: entry?.channel,
      amountUsd: entry?.realNetUsd,
    });
  }

  const usdRateLookup = buildMovementUsdRateLookup(movementValues, period?.endDate || period?.startDate || "");
  for (const row of ledgerOperations || []) {
    if (!isLedgerProviderIncomeSource(row) || isLedgerProviderNonIncomeRow(row)) continue;
    const operation = getNormalizedLedgerFactOperation(row);
    if (!["income", "servicein", "ezoin"].includes(operation)) continue;
    addServicePaymentProviderGroupTotal(totals, {
      date: row?.date,
      channel: getLedgerIncomeChannel(row),
      amountUsd: getLedgerFactAmountUsd(row, usdRateLookup),
    });
  }
  return totals;
}

function addServicePaymentProviderGroupTotal(totals, { date, channel, amountUsd } = {}) {
  const key = getServicePaymentProviderGroupKey(date, channel);
  const amount = Number(amountUsd || 0);
  if (!key || amount <= 0) return;
  totals.set(key, roundNumber((totals.get(key) || 0) + amount));
}

function getServicePaymentGapChannel(row = []) {
  const channel = resolveMovementServicePaymentDiagnosticChannel(row);
  return channel || "Без канала";
}

function getServicePaymentGapReason(row = [], amounts = {}) {
  const text = normalizeLookupText([
    row?.[3],
    row?.[4],
    row?.[6],
    row?.[14],
    row?.[23],
    row?.[24],
  ].filter(Boolean).join(" "));
  const paymentMethod = String(row?.[14] || "").trim();
  const channel = resolveMovementRowChannel(row);
  const status = normalizeLookupText(row?.[23]);
  const review = normalizeLookupText(row?.[24]);
  const expectedUsd = Number(amounts.expectedUsd || 0);
  const clientPaidUsd = Number(amounts.clientPaidUsd || 0);
  const providerNetUsd = Number(amounts.providerNetUsd || 0);
  const includedAmountUsd = Number(amounts.includedAmountUsd || 0);

  if (!paymentMethod && !channel) return "payment channel missing";
  if (/\b(refund|refunded|reversal|chargeback)\b|возврат|повернен/.test(text)) return "refund";
  if (/\b(exchange|internal)\b|обмен/.test(text)) return "exchange";
  if (/\b(transfer|withdraw|p2p|c2c)\b|перевод|вывод/.test(text)) return "transfer";
  if (isExcludedServicePaymentText(text) || (["Binance funding", "binance save"].includes(channel)) ||
    (channel === "Бинанс spot" && !/\b(service|order|payment|оплат|заказ|услуг|услуга|servicein|ezoin)\b/.test(text))) {
    return "excluded deposit/non-service";
  }
  if (includedAmountUsd > expectedUsd && expectedUsd > 0) return "duplicate/offset/overpaid";
  if ((/paypal|п[еэ]йп/.test(normalizeLookupText(paymentMethod)) || channel?.startsWith("пейпал")) &&
    (providerNetUsd <= 0 || clientPaidUsd <= 0 || /needs verification|provider fee net missing/.test(`${status} ${review}`))) {
    return "PayPal missing client-paid/provider net";
  }
  if (expectedUsd > 0 && providerNetUsd <= 0 && (!isExplicitNoFeeDirectPayment(paymentMethod) || clientPaidUsd <= 0)) {
    return "no safe amount";
  }
  if (!amounts.includedByCurrentSummary && expectedUsd > 0) return "no safe amount";
  return "";
}

function isUnsafeServicePaymentGapReason(reason) {
  return [
    "no safe amount",
    "payment channel missing",
    "PayPal missing client-paid/provider net",
    "excluded deposit/non-service",
  ].includes(reason);
}

function isMovementServicePaymentRow(row = []) {
  if (isKovalevWiseBoleslavMovementRow({ client: row?.[2], paymentMethod: row?.[14] })) return false;
  const channel = resolveMovementServicePaymentChannel(row);
  if (!channel) return false;
  const text = normalizeLookupText([
    row?.[3],
    row?.[4],
    row?.[6],
    row?.[14],
    row?.[23],
    row?.[24],
  ].filter(Boolean).join(" "));
  if (!text) return false;
  if (isExcludedServicePaymentText(text)) return false;
  if (["Binance funding", "binance save"].includes(channel)) return false;
  if (channel === "Бинанс spot" && !/\b(service|order|payment|оплат|заказ|услуг|услуга|servicein|ezoin)\b/.test(text)) return false;
  const netReceivedUsd = parseLooseNumber(row?.[20]);
  const clientPaidUsd = parseLooseNumber(row?.[18]);
  return (netReceivedUsd > 0 || clientPaidUsd > 0);
}

function resolveMovementServicePaymentChannel(row = []) {
  const resolved = resolveMovementRowChannel(row);
  if (resolved) return resolved;

  const paymentMethod = normalizeLookupText(row?.[14]);
  const client = String(row?.[2] || "").trim();
  const clientDefault = inferFallbackPaymentChannelFromClient(client);
  if (clientDefault && /(сайт|site|card|карта|дол|usd|плат|pay)/.test(paymentMethod)) return clientDefault;
  if (/(сайт|site).*(rub|руб|рубл)|(?:rub|руб|рубл).*(сайт|site)|^юмани$|^юmoney$|^yoomoney$/.test(paymentMethod)) return "Яндекс руб";
  if (/(карта андрей|андрей карта)/.test(paymentMethod) && /лозин|lozin/i.test(normalizeLookupText(client))) return "монобанк грн";
  return "";
}

function resolveMovementServicePaymentDiagnosticChannel(row = []) {
  const resolved = resolveMovementServicePaymentChannel(row) || resolveMovementRowChannel(row);
  if (resolved) return resolved;

  const paymentMethod = normalizeLookupText(row?.[14]);
  const clientDefault = inferFallbackPaymentChannelFromClient(row?.[2]);
  if (!clientDefault || !paymentMethod) return "";

  if (clientDefault === "пейпал дол" && /paypal|п[еэ]йп/.test(paymentMethod)) return clientDefault;
  if (clientDefault === "трансервайз дол" && /wise|transferwise|трансервайз/.test(paymentMethod)) return clientDefault;
  if (clientDefault === "приват-фоп" && /privat|приват|фоп|fop/.test(paymentMethod)) return clientDefault;
  return "";
}

function isExcludedServicePaymentText(text) {
  return /\b(refund|refunded|reversal|chargeback|exchange|transfer|deposit|internal|funding|withdraw|top[ -]?up|p2p|c2c|spot|save|savings|earn)\b|возврат|повернен|обмен|перевод|депозит|внутрен|пополн|вывод|фандинг|фандин|спот/.test(text);
}

function getRealIncomeSummaryTotalsFromSummary(summaryByChannel = {}) {
  const totals = Object.values(summaryByChannel || {}).reduce((acc, row) => ({
    plannedReceivedUsd: acc.plannedReceivedUsd + Number(row?.plannedReceivedUsd || 0),
    realGrossUsd: acc.realGrossUsd + Number(row?.realGrossUsd || 0),
    realFeeUsd: acc.realFeeUsd + Number(row?.realFeeUsd || 0),
    realNetUsd: acc.realNetUsd + Number(row?.realNetUsd || 0),
    differenceUsd: acc.differenceUsd + Number(row?.differenceUsd || 0),
  }), { plannedReceivedUsd: 0, realGrossUsd: 0, realFeeUsd: 0, realNetUsd: 0, differenceUsd: 0 });
  return {
    plannedReceivedUsd: roundNumber(totals.plannedReceivedUsd),
    realGrossUsd: roundNumber(totals.realGrossUsd),
    realFeeUsd: roundNumber(totals.realFeeUsd),
    realNetUsd: roundNumber(totals.realNetUsd),
    differenceUsd: roundNumber(totals.differenceUsd),
    differencePct: calculateDifferencePct(totals.differenceUsd, totals.realNetUsd),
  };
}

function summarizeRealIncomeTotals(entries, movementValues, options = {}) {
  return getRealIncomeSummaryTotalsFromSummary(summarizeRealIncomeByChannel(entries, movementValues, options));
}

function mergeLedgerRealIncomeFallback({
  realIncome = null,
  operations = [],
  movementValues = [],
  period = {}
} = {}) {
  const ledgerSummaryByChannel = buildLedgerRealIncomeSummaryByChannel(operations, movementValues, period);
  const hasLedgerIncome = Object.values(ledgerSummaryByChannel || {}).some((row) => Number(row?.realNetUsd || 0) > 0);
  if (!hasLedgerIncome) return realIncome;

  const providerSummaryByChannel = realIncome?.summaryByChannel || summarizeRealIncomeByChannel([], movementValues);
  const mergedSummaryByChannel = Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => {
    const providerRow = providerSummaryByChannel?.[channel] || null;
    if (Number(providerRow?.realNetUsd || 0) > 0) return [channel, providerRow];
    return [channel, ledgerSummaryByChannel?.[channel] || providerRow || {
      channel,
      currency: inferChannelCurrency(channel),
      plannedReceivedUsd: 0,
      realGrossUsd: 0,
      realFeeUsd: 0,
      realNetUsd: 0,
      differenceUsd: 0,
      differencePct: 0,
    }];
  }));

  return {
    ...(realIncome || {}),
    summaryByChannel: mergedSummaryByChannel,
    summaryTotals: getRealIncomeSummaryTotalsFromSummary(mergedSummaryByChannel),
  };
}

function buildLedgerRealIncomeSummaryByChannel(operations = [], movementValues = [], period = {}) {
  const startDate = normalizeIsoDate(period?.startDate);
  const endDate = normalizeIsoDate(period?.endDate);
  const movementStats = summarizeMovementChannels(movementValues);
  const usdRateLookup = buildMovementUsdRateLookup(movementValues, endDate || startDate || "");
  const totalsByChannel = Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => [channel, 0]));

  for (const row of operations || []) {
    const date = normalizeIsoDate(row?.date);
    if (!date) continue;
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    if (!isLedgerProviderIncomeSource(row)) continue;
    if (isLedgerProviderNonIncomeRow(row)) continue;

    const operation = getNormalizedLedgerFactOperation(row);
    if (!["income", "servicein", "ezoin"].includes(operation)) continue;

    const channel = getLedgerIncomeChannel(row);
    if (!channel || !Object.prototype.hasOwnProperty.call(totalsByChannel, channel)) continue;

    const realNetUsd = getLedgerFactAmountUsd(row, usdRateLookup);
    if (realNetUsd <= 0) continue;
    totalsByChannel[channel] = roundNumber(totalsByChannel[channel] + realNetUsd);
  }

  return Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => {
    const realNetUsd = roundNumber(totalsByChannel[channel] || 0);
    const plannedReceivedUsd = roundNumber(movementStats.plannedReceivedUsdByChannel?.[channel] || 0);
    const differenceUsd = roundNumber(plannedReceivedUsd - realNetUsd);
    return [channel, {
      channel,
      currency: inferChannelCurrency(channel),
      plannedReceivedUsd,
      realGrossUsd: realNetUsd,
      realFeeUsd: 0,
      realNetUsd,
      differenceUsd,
      differencePct: calculateDifferencePct(differenceUsd, realNetUsd),
    }];
  }));
}

function normalizeLedgerProviderIncomeClassifier(value) {
  return normalizeLookupText(value).replace(/\s+/g, "_");
}

function isLedgerProviderNonIncomeRow(row = {}) {
  const direction = normalizeLedgerProviderIncomeClassifier(row?.direction || row?.ledgerV2?.direction || "");
  if (["out", "expense", "debit", "fee", "refund", "hold", "held", "reversal", "chargeback", "exchange"].includes(direction)) return true;
  const kind = normalizeLedgerProviderIncomeClassifier(
    row?.entryKind ||
    row?.operationType ||
    row?.operation_type ||
    row?.transactionType ||
    row?.transaction_type ||
    row?.transferType ||
    row?.ledgerV2?.operation_type ||
    ""
  );
  if (["fee", "refund", "hold", "held", "reversal", "chargeback", "exchange"].includes(kind)) return true;
  const source = String(row?.source || row?.provider || row?.providerSource || row?.displaySource || row?.ledgerV2?.source || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const rawSourceId = String(row?.rawSourceId || row?.raw_source_id || row?.externalId || row?.external_id || row?.ledgerV2?.raw_source_id || "")
    .trim()
    .toLowerCase();
  const text = normalizeLookupText([
    row?.comment,
    row?.description,
    row?.organization,
    row?.counterparty,
    row?.transactionSubject,
    row?.transferType,
    row?.ledgerV2?.comment
  ].filter(Boolean).join(" "));
  if ((source === "wise" || source === "transferwise" || rawSourceId.startsWith("card-")) &&
    (rawSourceId.startsWith("card-") || kind === "card" || /\bcard (transaction|payment)\b/.test(text))) {
    return true;
  }
  return false;
}

function isLedgerProviderIncomeSource(row) {
  const normalizedSource = String(
    row?.source ||
    row?.provider ||
    row?.providerSource ||
    row?.displaySource ||
    row?.ledgerV2?.source ||
    ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ([
    "mcp",
    "paypal",
    "paypal_mcp",
    "tdbank",
    "td_bank",
    "yoomoney",
    "youmoney",
    "yandex",
    "monobank",
    "wise",
    "transferwise",
    "payoneer",
    "revolut",
    "binance"
  ].includes(normalizedSource)) return true;
  const rawSourceId = String(
    row?.rawSourceId ||
    row?.raw_source_id ||
    row?.externalId ||
    row?.external_id ||
    row?.ledgerV2?.raw_source_id ||
    ""
  ).trim().toLowerCase();
  return /^(paypal|wise|yoomoney|youmoney|yandex|monobank|tdbank|td_bank|payoneer|revolut|binance|usdt|usdc|crypto|mcp):/.test(rawSourceId);
}

function getNormalizedLedgerFactOperation(row) {
  const operation = normalizeSummaryText(
    row?.operation ||
    row?.ledgerV2?.operation ||
    ""
  ).replace(/\s+/g, "_");
  if (operation) return operation;
  const category = normalizeSummaryText(
    row?.category ||
    row?.ledgerV2?.category ||
    ""
  ).replace(/\s+/g, "_");
  if (["servicein", "ezoin"].includes(category)) return category;
  return "";
}

function getLedgerIncomeChannel(row) {
  const currency = String(row?.currency || row?.ledgerV2?.currency || "").trim().toUpperCase();
  const candidates = [
    row?.toChannel,
    row?.to_channel,
    row?.channel,
    row?.providerChannel,
    row?.provider_channel
  ].map((value) => String(value || "").trim()).filter(Boolean);

  for (const candidate of candidates) {
    const resolved = resolvePaymentChannel(candidate);
    if (resolved) return resolved;
    const normalized = normalizeLookupText(candidate);
    if (["yoomoney", "youmoney", "yandex", "яндекс", "юмани", "юmoney", "юмоней"].includes(normalized)) {
      return "Яндекс руб";
    }
    if (["paypal", "пейпал"].includes(normalized)) {
      if (currency === "EUR") return "пейпал евр";
      if (currency === "CAD") return "пейпал сad";
      return "пейпал дол";
    }
    if (["wise", "transferwise", "трансервайз"].includes(normalized)) {
      return currency === "EUR" ? "трансервайз евро" : "трансервайз дол";
    }
    if (["binance funding", "funding", "funding wallet", "binance pay", "бинанс funding", "бинанс фандинг"].includes(normalized)) {
      return "Binance funding";
    }
    if (["binance save", "binance savings", "бинанс save", "бинанс сейв", "earn", "simple earn", "flexible earn", "locked earn"].includes(normalized)) {
      return "binance save";
    }
    if (["binance", "бинанс", "binance spot", "бинанс spot", "crypto", "крипт", "usdt", "usdc"].includes(normalized)) {
      return "Бинанс spot";
    }
  }

  const normalizedSource = String(
    row?.source ||
    row?.provider ||
    row?.providerSource ||
    ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["yoomoney", "youmoney", "yandex", "mcp"].includes(normalizedSource) && currency === "RUB") {
    return "Яндекс руб";
  }
  if (["paypal", "paypal_mcp"].includes(normalizedSource)) {
    if (currency === "EUR") return "пейпал евр";
    if (currency === "CAD") return "пейпал сad";
    if (currency === "USD") return "пейпал дол";
  }
  if (["wise", "transferwise"].includes(normalizedSource)) {
    if (currency === "EUR") return "трансервайз евро";
    if (currency === "USD") return "трансервайз дол";
  }
  if (["binance_pay"].includes(normalizedSource)) {
    return "Binance funding";
  }
  if (normalizedSource === "binance") {
    return "Бинанс spot";
  }
  return "";
}

function getLedgerFactAmountUsd(row, usdRateLookup = {}) {
  const explicitAmountUsd = parseLooseNumber(row?.amount_usd ?? row?.amountUsd ?? row?.usdAmount ?? "");
  if (explicitAmountUsd > 0) return roundNumber(explicitAmountUsd);
  if (explicitAmountUsd < 0) return roundNumber(-explicitAmountUsd);

  const currency = String(row?.currency || row?.ledgerV2?.currency || "").trim().toUpperCase();
  const netAmountUsd = parseLooseNumber(row?.amount_net ?? row?.amountNet ?? "");
  const grossAmount = parseLooseNumber(row?.amount ?? row?.ledgerV2?.amount ?? "");
  const localAmount = Math.abs(netAmountUsd || grossAmount);
  if (!localAmount) return 0;
  if (currency === "USD") return roundNumber(localAmount);

  const channel = getLedgerIncomeChannel(row) ||
    resolvePaymentChannel(row?.fromChannel || row?.from_channel || row?.toChannel || row?.to_channel || "");
  return convertLocalAmountToUsd(localAmount, currency, usdRateLookup, channel);
}

function applyRealIncomeToMovementTable(movementTable, realIncome) {
  if (!movementTable?.values?.length) return movementTable;
  if (!realIncome) return movementTable;
  const values = movementTable.values.map((row) => row.slice());
  const header = values[2] || [];
  const clientPaidIndex = findHeaderIndexByAliases(header, [CLIENT_PAID_COLUMN_HEADER, "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "RECEIVED TOTAL USD"]);
  const feeIndex = findHeaderIndexByAliases(header, [PAYMENT_FEE_COLUMN_HEADER]);
  const netReceivedIndex = findHeaderIndexByAliases(header, [NET_RECEIVED_COLUMN_HEADER]);
  const realIncomeIndex = findHeaderIndexByAliases(header, [REAL_INCOME_COLUMN_HEADER, "РЕАЛЬНЫЕ ПРИХОДЫ"]);
  const balanceIndex = findHeaderIndexByAliases(header, ["BALANCE", "БАЛАНС"]);
  const statusIndex = findHeaderIndexByAliases(header, ["STATUS"]);
  const reviewNoteIndex = findHeaderIndexByAliases(header, ["REVIEW NOTE"]);
  const accruedPlusIndex = findHeaderIndexByAliases(header, ["ACCRUED +3%"]);
  if (realIncomeIndex === -1 || netReceivedIndex === -1 || balanceIndex === -1 || statusIndex === -1 || reviewNoteIndex === -1 || accruedPlusIndex === -1) {
    return movementTable;
  }
  const matchedByRow = new Map((realIncome.rowMatches || []).map((match) => [match.rowNumber, match]));
  for (let index = 3; index < values.length; index += 1) {
    const row = values[index] || [];
    const number = String(row[0] || "").trim();
    if (!matchedByRow.has(number)) continue;
    const match = matchedByRow.get(number);
    if (feeIndex !== -1) row[feeIndex] = formatDisplayNumber(match.realFeeUsd);
    row[netReceivedIndex] = formatDisplayNumber(match.realNetUsd);
    row[realIncomeIndex] = formatDisplayNumber(match.realNetUsd);
    row[balanceIndex] = deriveBalance(row[netReceivedIndex], row[accruedPlusIndex], row[clientPaidIndex]);
    const statusInfo = deriveStatusInfo({
      comment: row[4],
      action: row[6],
      paymentMethod: row[14],
      totalUsd: row[netReceivedIndex],
      accruedPlus3: row[accruedPlusIndex],
      balance: row[balanceIndex],
    });
    row[statusIndex] = statusInfo.status;
    row[reviewNoteIndex] = joinReviewParts([
      clearNeedsVerificationReview(row[reviewNoteIndex]),
      `real income matched: ${match.matchedProvider}`,
      `real income diff ${formatDisplayNumber(match.differencePct)}%`,
      !String(row[clientPaidIndex] || "").trim() ? "" : `client paid gross ${formatDisplayNumber(parseLooseNumber(row[clientPaidIndex]))}`,
      !Number.isFinite(Number(match.realFeeUsd)) ? "" : `provider fee ${formatDisplayNumber(match.realFeeUsd)}`,
      statusInfo.reviewNote,
    ]);
  }
  values[values.length - 1] = buildFreshMovementTotalRow(values.slice(3, -1));
  const dataRows = values.slice(3, -1);
  const nextSummaryRows = buildFreshMovementSummaryRows(dataRows, movementTable.summaryRows || []);
  if (realIncome?.summaryTotals?.realNetUsd) {
    nextSummaryRows.push(["provider net verified", formatTableNumber(realIncome.summaryTotals.realNetUsd)]);
  }
  return { ...movementTable, values, ...(nextSummaryRows.length ? { summaryRows: nextSummaryRows } : {}) };
}

function clearNeedsVerificationReview(value) {
  return String(value || "")
    .split("|")
    .map((part) => String(part || "").trim())
    .filter((part) => part && !/^(needs verification|provider fee\/net missing)$/i.test(part))
    .join(" | ");
}

function buildUnmatchedRealIncomeWarnings(entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const summaryByChannel = summarizeRealIncomeByChannel(entries, []);
  return Object.values(summaryByChannel)
    .filter((row) => Number(row?.realNetUsd || 0) > 0)
    .map((row) => `unmatched provider income: ${row.channel} ${formatDisplayNumber(row.realNetUsd)} USD net`);
}

function matchRealIncomeEntriesToMovement(entries, movementValues) {
  const warnings = [];
  const rowMatches = [];
  const rows = (movementValues || []).slice(3).filter((row) => /^\d+$/.test(String(row?.[0] || "").trim()));
  const matchedByRow = new Map();
  for (const entry of entries) {
    const candidates = getRealIncomeMatchCandidates(entry, rows);
    const relevantCandidates = candidates.filter(isRelevantRealIncomeCandidate);
    if (!relevantCandidates.length) {
      warnings.push(`${entry.source || "provider"} ${entry.sourceTransactionId || entry.id}: no movement row match`);
      continue;
    }
    if (relevantCandidates.length > 1 && compareMatchScore(relevantCandidates[0].score, relevantCandidates[1].score) === 0) {
      warnings.push(`${entry.source || "provider"} ${entry.sourceTransactionId || entry.id}: ambiguous movement match`);
      continue;
    }
    const best = relevantCandidates[0];
    const existing = matchedByRow.get(best.rowNumber);
    if (existing && compareMatchScore(best.score, existing.score) >= 0) continue;
    if (existing) {
      const existingIndex = rowMatches.findIndex((row) => row.rowNumber === best.rowNumber);
      if (existingIndex !== -1) rowMatches.splice(existingIndex, 1);
    }
    matchedByRow.set(best.rowNumber, best);
    rowMatches.push({
      rowNumber: best.rowNumber,
      matchedEntryId: getRealIncomeEntryKey(entry),
      matchedProvider: entry.source,
      matchedTransactionId: entry.sourceTransactionId,
      channel: entry.channel,
      movementDate: best.movementDate,
      movementReceivedUsd: best.plannedReceivedUsd,
      realGrossUsd: entry.realGrossUsd,
      realFeeUsd: entry.realFeeUsd,
      realNetUsd: entry.realNetUsd,
      differenceUsd: roundNumber(best.plannedReceivedUsd - entry.realNetUsd),
      differencePct: calculateDifferencePct(best.plannedReceivedUsd - entry.realNetUsd, entry.realNetUsd),
      score: best.score,
    });
  }
  rowMatches.sort((left, right) => left.rowNumber.localeCompare(right.rowNumber, "en", { numeric: true }));
  return { rowMatches, warnings };
}

function getRealIncomeMatchCandidates(entry, rows) {
  return (rows || [])
    .map((row) => buildRealIncomeMatchCandidate(entry, row))
    .filter(Boolean)
    .sort((left, right) => compareMatchScore(left.score, right.score));
}

function getRealIncomeEntryKey(entry) {
  return String(entry?.sourceTransactionId || entry?.id || "");
}

function isRelevantRealIncomeCandidate(candidate) {
  const plannedUsd = Math.abs(Number(candidate?.plannedReceivedUsd || 0));
  const closestDiff = Math.min(
    Math.abs(Number(candidate?.score?.netDiff || 0)),
    Math.abs(Number(candidate?.score?.grossDiff || 0))
  );
  return closestDiff <= Math.max(5, plannedUsd * 0.05);
}

function buildRealIncomeMatchCandidate(entry, row) {
  const rowNumber = String(row?.[0] || "").trim();
  const movementDate = normalizeDisplayDate(row?.[1]);
  const movementChannel = resolveMovementRowChannel(row);
  if (!rowNumber || !movementDate || movementChannel !== entry.channel) return null;
  const dayDistance = Math.abs(dayDiff(entry.date, movementDate));
  if (dayDistance > 3) return null;
  const plannedReceivedUsd = parseLooseNumber(row?.[18]);
  const grossDiff = Math.abs(plannedReceivedUsd - entry.realGrossUsd);
  const netDiff = Math.abs(plannedReceivedUsd - entry.realNetUsd);
  return {
    rowNumber,
    movementDate,
    plannedReceivedUsd: roundNumber(plannedReceivedUsd),
    score: {
      dayDistance,
      netDiff: roundNumber(netDiff),
      grossDiff: roundNumber(grossDiff),
    }
  };
}

function compareMatchScore(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  if (left.dayDistance !== right.dayDistance) return left.dayDistance - right.dayDistance;
  if (left.netDiff !== right.netDiff) return left.netDiff - right.netDiff;
  if (left.grossDiff !== right.grossDiff) return left.grossDiff - right.grossDiff;
  return 0;
}

function summarizeMovementChannels(values) {
  const plannedReceivedUsdByChannel = Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => [channel, 0]));
  const rows = (values || []).slice(3).filter((row) => /^\d+$/.test(String(row?.[0] || "").trim()));
  for (const row of rows) {
    const channel = resolveMovementRowChannel(row);
    if (!channel || !Object.prototype.hasOwnProperty.call(plannedReceivedUsdByChannel, channel)) continue;
    plannedReceivedUsdByChannel[channel] += parseLooseNumber(row?.[18]);
  }
  return {
    plannedReceivedUsdByChannel: Object.fromEntries(
      Object.entries(plannedReceivedUsdByChannel).map(([channel, value]) => [channel, roundNumber(value)])
    )
  };
}

function resolveMovementRowChannel(row) {
  const paymentMethod = String(row?.[14] || "").trim();
  const client = String(row?.[2] || "").trim();
  const inferredPaymentMethod = !paymentMethod ? inferFallbackPaymentChannelFromClient(client) : "";
  const cardFallbackChannel = paymentMethod && isAmbiguousPersonalCardPayment(paymentMethod)
    ? inferFallbackPaymentChannelFromClient(client)
    : "";
  return cardFallbackChannel || resolvePaymentChannel(paymentMethod) || resolvePaymentChannel(inferredPaymentMethod);
}

function resolvePaymentChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeLookupText(raw);
  if (normalized === normalizeLookupText("binance save")) return "binance save";
  if (normalized === normalizeLookupText("Binance funding")) return "Binance funding";
  const exact = REAL_INCOME_CHANNELS.find((channel) => normalizeLookupText(channel) === normalized);
  if (exact) return exact;
  if (/^(приват|privat)( 24)? fop( uah)?$|^privat24 fop$|^(приват|privat) фоп$|^фоп (приват|privat)$/.test(normalized)) {
    return "приват-фоп";
  }
  const paypalAlias = "(?:paypal|п[еэ]йп(?:а|э)л)";
  if (new RegExp(`(?:сайт.*${paypalAlias}.*дол|сайт.*дол.*${paypalAlias}|${paypalAlias}.*(?:usd|дол)|(?:usd|дол).*${paypalAlias})`).test(normalized)) {
    return "пейпал дол";
  }
  if (new RegExp(`(?:${paypalAlias}.*(?:eur|евр|euro)|(?:eur|евр|euro).*${paypalAlias})`).test(normalized)) {
    return "пейпал евр";
  }
  if (new RegExp(`(?:${paypalAlias}.*(?:cad|канада)|(?:cad|канада).*${paypalAlias})`).test(normalized)) {
    return "пейпал сad";
  }
  if (/wise.*usd|transf?erwise.*usd|трансервайз.*дол/.test(normalized)) return "трансервайз дол";
  if (/wise.*eur|transf?erwise.*eur|трансервайз.*евро/.test(normalized)) return "трансервайз евро";
  if (/payoneer.*(?:usd|дол)|(?:usd|дол).*payoneer/.test(normalized)) return "Payoneer - dol";
  if (/payoneer.*(?:eur|евр|euro)|(?:eur|евр|euro).*payoneer/.test(normalized)) return "Payoneer - eur";
  if (/(revolut|револют).*(usd|дол)|(usd|дол).*(revolut|револют)|^revolut$|^револют$/.test(normalized)) return "REVOLUT дол";
  if (/binance.*sav|бинанс.*сейв/.test(normalized)) return "binance save";
  if (/binance.*fund|funding|бинанс.*фандинг|binance pay/.test(normalized)) return "Binance funding";
  if (/(binance|бинанс|crypto|крипт|usdt|usdc)/.test(normalized)) return "Бинанс spot";
  if (/(mono|monobank|монобанк).*(uah|грн|грив)|(?:uah|грн|грив).*(mono|monobank|монобанк)/.test(normalized)) {
    return "монобанк грн";
  }
  if (/(privat|приват).*(usd|дол)|(?:usd|дол).*(privat|приват)/.test(normalized)) return "приват 24-дол";
  if (/(privat|приват).*(eur|евр|euro)|(?:eur|евр|euro).*(privat|приват)/.test(normalized)) return "приват 24-евро";
  if (/(privat|приват).*(uah|грн|грив)|(?:uah|грн|грив).*(privat|приват)/.test(normalized)) return "приват 24-грн";
  if (/(yoomoney|юmoney|юмани|юмоней|yandex|яндекс).*(rub|руб)|(?:rub|руб).*(yoomoney|юmoney|юмани|юмоней|yandex|яндекс)/.test(normalized)) {
    return "Яндекс руб";
  }
  return "";
}

function inferFallbackPaymentChannelFromClient(client) {
  const referencedChannel = PaymentChannelReference.resolveClientDefaultPaymentChannel(client);
  if (referencedChannel) return referencedChannel;
  const text = `${normalizeLookupText(client)} ${getClientPaymentLookupKeys(client).join(" ")}`;
  if (/(william|вильям|вилл)/i.test(text)) return "трансервайз дол";
  if (/игнат/i.test(text)) return "пейпал дол";
  return "";
}

function getClientPaymentLookupKeys(client) {
  const normalized = normalizeLookupText(client);
  if (!normalized) return [];
  const relationWords = new Set(["сын", "дочь", "мать", "отец", "мама", "папа", "жена", "муж"]);
  const tokens = normalized.split(" ").filter((token) => token && !relationWords.has(token));
  const keys = [normalized];
  const familyToken = normalizeClientFamilyToken(tokens.at(-1) || "");
  if (familyToken) keys.push(`family:${familyToken}`);
  return [...new Set(keys)];
}

function normalizeClientFamilyToken(value) {
  const token = normalizeLookupText(value);
  if (!token || token.length < 4) return "";
  return token
    .replace(/(ого|его|ой|ая|яя|ый|ий|ые|ие|ых|их|а|я|ы|и)$/i, "")
    .replace(/(ов|ев|ин|ын)$/i, (ending) => (/^(ин|ын)$/i.test(ending) ? ending : ""));
}

function isAmbiguousPersonalCardPayment(value) {
  return /андрей.*карта|карта.*андрей/.test(normalizeLookupText(value));
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferChannelCurrency(channel) {
  return REAL_INCOME_CHANNEL_CURRENCY[String(channel || "").trim()] || "USD";
}

function buildMovementUsdRateLookup(movementValues = [], endDate = "") {
  if (!Array.isArray(movementValues) || !movementValues.length) return { ...REAL_INCOME_FALLBACK_USD_RATES };
  const cutoff = endDate ? new Date(`${endDate}T00:00:00Z`) : null;
  const latest = {};
  for (const row of movementValues.slice(3)) {
    if (!hasAnyValue(row) || !/^\d+$/.test(String(row?.[0] || "").trim())) continue;
    const parsedDate = parseDisplayDate(row?.[1]);
    if (cutoff && parsedDate && parsedDate > cutoff) continue;
    const timestamp = parsedDate ? parsedDate.getTime() : 0;
    addMovementRate(latest, "RUB", row?.[12], timestamp);
    addMovementRate(latest, "UAH", row?.[13], timestamp);
  }
  return {
    ...REAL_INCOME_FALLBACK_USD_RATES,
    ...Object.fromEntries(Object.entries(latest).map(([currency, row]) => [currency, row.usdPerLocal])),
  };
}

function addMovementRate(lookup, currency, value, timestamp) {
  const localPerUsd = parseLooseNumber(value);
  if (!localPerUsd) return;
  if (lookup[currency] && lookup[currency].timestamp > timestamp) return;
  lookup[currency] = { timestamp, usdPerLocal: 1 / localPerUsd };
}

function convertLocalAmountToUsd(amount, currency, rateLookup, channel = "") {
  const numeric = Math.abs(Number(amount || 0));
  if (!numeric) return 0;
  const normalizedCurrency = String(currency || inferChannelCurrency(channel)).trim().toUpperCase();
  if (normalizedCurrency === "USD") return roundNumber(numeric);
  const usdPerLocal = Number(rateLookup?.[normalizedCurrency] || 0);
  return usdPerLocal > 0 ? roundNumber(numeric * usdPerLocal) : 0;
}

function calculateDifferencePct(differenceUsd, realNetUsd) {
  const net = Number(realNetUsd || 0);
  if (!net) return 0;
  return roundNumber((Number(differenceUsd || 0) / net) * 100);
}

function sumBy(rows, key) {
  return roundNumber((rows || []).reduce((sum, row) => sum + Number(row?.[key] || 0), 0));
}

function roundNumber(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function dayDiff(leftDate, rightDate) {
  const left = new Date(`${leftDate}T00:00:00Z`);
  const right = new Date(`${rightDate}T00:00:00Z`);
  return Math.round((left - right) / 86400000);
}

function buildMovementRowsFromSource(rows, period) {
  const output = [];
  const seenNumbers = new Set();
  const startDate = normalizeIsoDate(period?.startDate);
  const endDate = normalizeIsoDate(period?.endDate);
  const sourceRows = rows.slice(3).map((row) => padRow(row, 51));
  const actionMultiplierByNumber = buildSourceActionMultiplierLookup(sourceRows);
  let previousRates = { rubRate: "", uahRate: "" };

  for (const padded of sourceRows) {
    const number = String(padded[1] || "").trim();
    if (!/^\d+$/.test(number) || seenNumbers.has(number)) continue;

    const derivedContext = buildSourcePaymentContext(padded, previousRates);
    previousRates = derivedContext.nextRates;

    const isoDate = normalizeIsoDate(padded[2]);
    if (!isoDate) continue;
    if (startDate && isoDate < startDate) continue;
    if (endDate && isoDate > endDate) continue;

    seenNumbers.add(number);
    output.push(mapSourceRowToMovementRow(padded, isoDate, derivedContext, actionMultiplierByNumber[number] || 1));
  }

  return output;
}

function buildFreshMovementTotalRow(rows) {
  const totalRow = Array.from({ length: FRESH_MOVEMENT_HEADER.length }, () => "");
  totalRow[0] = "Итого";
  const totalHeaders = new Set([
    "QTY",
    "PRICE BASE",
    "ACCRUED",
    "ACCRUED +3%",
    "70% OF ACCRUED",
    "70% OF +3%",
    "RUB RATE",
    "UAH RATE",
    "ПОЛУЧЕНО В ДОЛЛАРАХ",
    "ПОЛУЧЕНО В РУБЛЯХ",
    "ПОЛУЧЕНО В ГРИВНАХ",
    CLIENT_PAID_COLUMN_HEADER,
    PAYMENT_FEE_COLUMN_HEADER,
    NET_RECEIVED_COLUMN_HEADER,
    REAL_INCOME_COLUMN_HEADER,
    "BALANCE",
    "AMOUNT (USD)",
  ]);
  FRESH_MOVEMENT_HEADER.forEach((header, index) => {
    if (!totalHeaders.has(header)) return;
    totalRow[index] = formatTableNumber(
      rows.reduce((sum, row) => sum + (parseLooseNumber(row[index]) || 0), 0)
    );
  });
  return totalRow;
}

function buildFreshPayoutTotalRow(rows) {
  const totalRow = Array.from({ length: FRESH_PAYOUTS_HEADER.length }, () => "");
  totalRow[0] = "Итого";
  totalRow[6] = formatTableNumber(
    rows.reduce((sum, row) => sum + (parseLooseNumber(row[6]) || 0), 0)
  );
  totalRow[7] = formatTableNumber(
    rows.reduce((sum, row) => sum + (parseLooseNumber(row[7]) || 0), 0)
  );
  return totalRow;
}

function mapSourceRowToMovementRow(row, isoDate, derivedContext = buildSourcePaymentContext(row), actionMultiplier = 1) {
  const date = formatDisplayDate(isoDate);
  const paymentMethod = derivedContext.paymentMethod;
  const priceBase = normalizeNumberCell(row[6]);
  const quantity = normalizeNumberCell(row[8]);
  const accrued = deriveAccruedAmount(row, actionMultiplier);
  const accruedPlus3 = deriveAccruedPlusPercent(accrued, paymentMethod);
  const correctedContext = applySourceReceivedAmountCorrection(row, derivedContext);
  const receivedUsd = correctedContext.receivedUsd;
  const receivedRub = correctedContext.receivedRub;
  const receivedUah = correctedContext.receivedUah;
  const rubRate = derivedContext.rubRate;
  const uahRate = derivedContext.uahRate;
  const clientPaidUsd = deriveTotalUsd({ paymentMethod, receivedUsd, receivedRub, receivedUah, rubRate, uahRate });
  const amountSemantics = buildMovementAmountSemantics({ paymentMethod, clientPaidUsd });
  const balance = deriveBalance(amountSemantics.netReceivedUsd, accruedPlus3, clientPaidUsd);
  const statusInfo = deriveStatusInfo({
    comment: row[5],
    action: row[7],
    paymentMethod,
    totalUsd: amountSemantics.netReceivedUsd,
    accruedPlus3,
    balance,
    needsVerification: amountSemantics.needsVerification,
    verificationReason: amountSemantics.verificationReason,
  });

  return [
    String(row[1] || "").trim(),
    date,
    String(row[3] || "").trim(),
    String(row[4] || "").trim(),
    String(row[5] || "").trim(),
    priceBase,
    String(row[7] || "").trim(),
    quantity,
    accrued,
    accruedPlus3,
    normalizePercentShare(accrued),
    normalizePercentShare(accruedPlus3),
    rubRate,
    uahRate || (rubRate ? "UAH RATE" : ""),
    paymentMethod,
    receivedUsd,
    receivedRub,
    receivedUah,
    clientPaidUsd,
    amountSemantics.paymentFeeUsd,
    amountSemantics.netReceivedUsd,
    "",
    balance,
    statusInfo.status,
    joinReviewParts([statusInfo.reviewNote, correctedContext.correctionNote]),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

function buildMovementAmountSemantics({ paymentMethod, clientPaidUsd }) {
  if (isExplicitNoFeeDirectPayment(paymentMethod)) {
    return {
      clientPaidUsd,
      paymentFeeUsd: "",
      netReceivedUsd: clientPaidUsd,
      needsVerification: false,
      verificationReason: "",
    };
  }
  return {
    clientPaidUsd,
    paymentFeeUsd: "",
    netReceivedUsd: "",
    needsVerification: true,
    verificationReason: "provider fee/net missing",
  };
}

function deriveAccruedAmount(row, actionMultiplier = 1) {
  const explicitTotal = normalizeNumberCell(row?.[9]);
  const multiplier = normalizeActionMultiplier(actionMultiplier);
  if (explicitTotal) return formatDisplayNumber(parseLooseNumber(explicitTotal) * multiplier);

  const price = parseLooseNumber(row?.[6]);
  if (price === null) return "";

  const quantity = parseLooseNumber(row?.[8]);
  const accrued = (quantity ? price * quantity : price) * multiplier;
  return formatDisplayNumber(accrued);
}

function buildSourceActionMultiplierLookup(rows) {
  const multipliers = {};
  (rows || []).forEach((row, index) => {
    const number = String(row?.[1] || "").trim();
    if (!/^\d+$/.test(number)) return;
    const directMultiplier = parseSourceActionMultiplier(row?.[7]);
    if (directMultiplier === null) return;
    multipliers[number] = directMultiplier;

    const previous = rows[index - 1];
    const previousNumber = String(previous?.[1] || "").trim();
    if (!/^\d+$/.test(previousNumber) || parseSourceActionMultiplier(previous?.[7]) !== null) return;
    if (!isAdjacentSourceOrderPair(previous, row)) return;
    multipliers[previousNumber] = directMultiplier;
  });
  return multipliers;
}

function parseSourceActionMultiplier(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const amount = parseLooseNumber(raw);
  if (!Number.isFinite(amount) || amount === 0) return null;
  if (!/%/.test(raw) && Math.abs(amount) > 0 && Math.abs(amount) <= 1) return Math.abs(amount);
  return Math.max(0, 1 - Math.min(Math.abs(amount), 100) / 100);
}

function normalizeActionMultiplier(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 1;
}

function isAdjacentSourceOrderPair(left, right) {
  const leftDate = normalizeIsoDate(left?.[2]);
  const rightDate = normalizeIsoDate(right?.[2]);
  const leftClient = normalizeLookupText(left?.[3]);
  const rightClient = normalizeLookupText(right?.[3]);
  return Boolean(leftDate && rightDate && leftDate === rightDate && leftClient && leftClient === rightClient);
}

function applySourceReceivedAmountCorrection(row, derivedContext) {
  const number = String(row?.[1] || "").trim();
  const correction = SOURCE_RECEIVED_AMOUNT_CORRECTIONS[number];
  if (!correction) return derivedContext;

  const client = String(row?.[3] || "").trim();
  const paymentMethod = String(derivedContext.paymentMethod || "").trim();
  const receivedUahValue = parseLooseNumber(derivedContext.receivedUah);
  const matches =
    correction.matchClient.test(client) &&
    correction.matchPayment.test(paymentMethod) &&
    receivedUahValue !== null &&
    Math.abs(receivedUahValue - correction.matchReceivedUah) < 0.01;

  if (!matches) return derivedContext;

  return {
    ...derivedContext,
    receivedUah: correction.receivedUah,
    correctionNote: correction.reason,
  };
}

function isCharitySourceRow(row) {
  return /благотвор/i.test([
    row?.[4],
    row?.[5],
    row?.[40],
  ].map((value) => String(value || "")).join(" "));
}

function buildPayoutRowsFromSource(rows, period) {
  const output = [];
  const seenNumbers = new Set();
  const startDate = normalizeIsoDate(period?.startDate);
  const endDate = normalizeIsoDate(period?.endDate);
  let previousRates = { rubRate: "", uahRate: "" };

  for (const row of rows.slice(3)) {
    const padded = padRow(row, 51);
    const number = String(padded[1] || "").trim();
    if (!/^\d+$/.test(number) || seenNumbers.has(number)) continue;

    const derivedContext = buildSourcePaymentContext(padded, previousRates);
    previousRates = derivedContext.nextRates;

    const isoDate = normalizeIsoDate(padded[2]);
    if (!isoDate) continue;
    if (startDate && isoDate < startDate) continue;
    if (endDate && isoDate > endDate) continue;
    if (!/(ковалев|kovalev)/.test(normalizeLookupText(padded[3]))) continue;
    if (isCharitySourceRow(padded)) continue;

    const payoutRow = mapSourceRowToPayoutRow(padded, isoDate, derivedContext);
    if (!payoutRow) continue;

    seenNumbers.add(number);
    output.push(payoutRow);
  }

  return output;
}

function mapSourceRowToPayoutRow(row, isoDate, derivedContext = buildSourcePaymentContext(row)) {
  const correctedContext = applySourceReceivedAmountCorrection(row, derivedContext);
  const paymentMethod = correctedContext.paymentMethod;
  const receivedUsd = correctedContext.receivedUsd;
  const receivedRub = correctedContext.receivedRubForPayout;
  const receivedUah = firstNonEmpty([correctedContext.receivedUah, correctedContext.receivedUahForPayout]);
  const rubRate = correctedContext.rubRate;
  const uahRate = correctedContext.uahRate;

  let currency = "USD";
  let currentAmount = receivedUsd;
  let transferRate = "";

  if (looksLikeRublePayment(paymentMethod) && parseLooseNumber(receivedRub) !== null) {
    currency = "руб";
    currentAmount = receivedRub;
    transferRate = rubRate;
  } else if (parseLooseNumber(receivedUah) !== null) {
    currency = "грн";
    currentAmount = receivedUah;
    transferRate = uahRate;
  } else if (parseLooseNumber(receivedRub) !== null) {
    currency = "руб";
    currentAmount = receivedRub;
    transferRate = rubRate;
  } else if (parseLooseNumber(receivedUsd) !== null) {
    currency = "USD";
    currentAmount = receivedUsd;
  }
  const totalUsd = derivePayoutUsd({ currency, currentAmount, transferRate, receivedUsd, paymentMethod, receivedRub, receivedUah, rubRate, uahRate });

  if (!paymentMethod || parseLooseNumber(totalUsd) === null) return null;

  return [
    String(row[1] || "").trim(),
    formatDisplayDate(isoDate),
    String(row[3] || "").trim(),
    String(row[4] || "").trim(),
    paymentMethod,
    currency,
    currentAmount,
    totalUsd,
    transferRate,
    joinReviewParts([String(row[5] || "").trim(), String(row[40] || "").trim(), correctedContext.correctionNote]),
  ];
}

function derivePayoutUsd({ currency, currentAmount, transferRate, receivedUsd, paymentMethod, receivedRub, receivedUah, rubRate, uahRate }) {
  const amount = parseLooseNumber(currentAmount);
  const rate = parseLooseNumber(transferRate);
  if (currency !== "USD" && amount !== null && rate) {
    return formatDisplayNumber(amount / rate);
  }

  return deriveTotalUsd({ paymentMethod, receivedUsd, receivedRub, receivedUah, rubRate, uahRate });
}

function normalizePaymentMethod(row) {
  return extractSourcePaymentMethod(row).paymentMethod;
}

function isKovalevWiseBoleslavSourceRow(row, derivedContext = buildSourcePaymentContext(row)) {
  const client = normalizeLookupText(row?.[3]);
  const paymentMethod = normalizeLookupText(derivedContext.paymentMethod || normalizePaymentMethod(row));
  return /(ковалев|kovalev)/.test(client) &&
    /(wise|transferwise|трансервайз)/.test(paymentMethod) &&
    /bolieslavn?/.test(paymentMethod);
}

function extractSourcePaymentMethod(row) {
  const secondary = String(row?.[23] || "").trim();
  const fragments = [];
  for (let index = 24; index <= 29; index += 1) {
    const value = String(row?.[index] || "").trim();
    if (!value) {
      if (fragments.length) break;
      continue;
    }
    if (looksSourceNumericCell(value)) break;
    fragments.push(value);
  }
  const primary = fragments.join(", ");
  const paymentMethod = primary && secondary && !primary.includes(",") && secondary.length <= 16
    ? `${secondary}, ${primary}`
    : (primary || secondary);
  return {
    paymentMethod,
    shift: Math.max(0, fragments.length - 1),
  };
}

function looksSourceNumericCell(value) {
  return parseLooseNumber(value) !== null;
}

function looksLikeRublePayment(paymentMethod) {
  return /(руб|yandex|яндекс)/i.test(String(paymentMethod || "").trim());
}

function looksLikeUahPayment(paymentMethod) {
  return /(грн|uah|приват|privat|карта|монобанк|mono|фоп)/i.test(String(paymentMethod || "").trim());
}

function requiresProviderNetVerification(paymentMethod) {
  return /(paypal|п(?:ей|эй)п(?:е|э)л|wise|transferwise|трансервайз|сайт|site|крипт|crypto|binance|бинанс)/i.test(String(paymentMethod || "").trim());
}

function isExplicitNoFeeDirectPayment(paymentMethod) {
  return /(фоп|fop|приват|privat|монобанк|monobank|mono|карта|card|cash|нал)/i.test(String(paymentMethod || "").trim());
}

function buildSourcePaymentContext(row, previousRates = {}) {
  const payment = extractSourcePaymentMethod(row);
  const extractedPaymentMethod = payment.paymentMethod;
  const defaultPaymentMethod = !extractedPaymentMethod
    ? PaymentChannelReference.resolveClientDefaultPaymentChannel(row?.[3])
    : "";
  const paymentMethod = extractedPaymentMethod || defaultPaymentMethod;
  const paymentShift = payment.shift || 0;
  const hasExplicitPaymentMethod = Boolean(paymentMethod);
  const receivedUsd = hasExplicitPaymentMethod ? normalizeSumCell(row[30 + paymentShift]) : "";
  const receivedRub = hasExplicitPaymentMethod ? normalizeSumCell(row[32 + paymentShift]) : "";
  const receivedRubForPayout = hasExplicitPaymentMethod
    ? normalizeSumCell(firstNonEmpty([row[32 + paymentShift], row[31 + paymentShift]]))
    : "";
  const receivedUah = hasExplicitPaymentMethod
    ? normalizeSumCell(firstNonEmpty([row[33 + paymentShift], row[34 + paymentShift]]))
    : "";
  const receivedUahForPayout = hasExplicitPaymentMethod
    ? normalizeSumCell(firstNonEmpty([row[33 + paymentShift], row[34 + paymentShift], row[32 + paymentShift]]))
    : "";
  const hasUsd = parseLooseNumber(receivedUsd) !== null;
  const hasRub = parseLooseNumber(receivedRubForPayout) !== null;
  const hasUah = parseLooseNumber(receivedUah) !== null;
  const explicitRubRate = firstNonEmpty([
    normalizeNumberCell(row[16]),
    normalizeNumberCell(row[19]),
    normalizeNumberCell(row[21]),
  ]);
  const explicitUahRate = firstNonEmpty([
    normalizeNumberCell(row[18]),
    normalizeNumberCell(row[20]),
    normalizeNumberCell(row[22]),
  ]);

  const rubRate = looksLikeRublePayment(paymentMethod) || (hasRub && !hasUah && !hasUsd)
    ? firstNonEmpty([explicitRubRate, previousRates.rubRate])
    : explicitRubRate;
  const uahRate = looksLikeUahPayment(paymentMethod) || hasUah
    ? firstNonEmpty([explicitUahRate, previousRates.uahRate])
    : explicitUahRate;

  return {
    paymentMethod,
    receivedUsd,
    receivedRub,
    receivedRubForPayout,
    receivedUah,
    receivedUahForPayout,
    rubRate,
    uahRate,
    nextRates: {
      rubRate: (looksLikeRublePayment(paymentMethod) || (hasRub && !hasUah && !hasUsd))
        ? firstNonEmpty([explicitRubRate, previousRates.rubRate])
        : (previousRates.rubRate || ""),
      uahRate: (looksLikeUahPayment(paymentMethod) || hasUah)
        ? firstNonEmpty([explicitUahRate, previousRates.uahRate])
        : (previousRates.uahRate || ""),
    },
  };
}

function isCryptoPaymentMethod(paymentMethod) {
  return /(крипт|crypto|binance|бинанс|usdt|usdc|trc20|erc20)/i.test(String(paymentMethod || "").trim());
}

function getAccruedMarkupMultiplier(paymentMethod) {
  return isCryptoPaymentMethod(paymentMethod) ? 1.01 : 1.03;
}

function deriveAccruedPlusPercent(accrued, paymentMethod) {
  const accruedValue = parseLooseNumber(accrued);
  if (accruedValue === null) return "";
  return formatDisplayNumber(accruedValue * getAccruedMarkupMultiplier(paymentMethod));
}

function deriveTotalUsd({ paymentMethod, receivedUsd, receivedRub, receivedUah, rubRate, uahRate }) {
  if (looksLikeUahPayment(paymentMethod)) {
    const uah = parseLooseNumber(receivedUah);
    const uahRateValue = parseLooseNumber(uahRate);
    if (uah !== null && uahRateValue) {
      return formatDisplayNumber(uah / uahRateValue);
    }
  }

  if (looksLikeRublePayment(paymentMethod)) {
    const rub = parseLooseNumber(receivedRub);
    const rubRateValue = parseLooseNumber(rubRate);
    if (rub !== null && rubRateValue) {
      return formatDisplayNumber(rub / rubRateValue);
    }
  }

  const usd = parseLooseNumber(receivedUsd);
  if (usd !== null) return formatDisplayNumber(usd);

  const rub = parseLooseNumber(receivedRub);
  const rubRateValue = parseLooseNumber(rubRate);
  if (rub !== null && rubRateValue) {
    return formatDisplayNumber(rub / rubRateValue);
  }

  const uah = parseLooseNumber(receivedUah);
  const uahRateValue = parseLooseNumber(uahRate);
  if (uah !== null && uahRateValue) {
    return formatDisplayNumber(uah / uahRateValue);
  }

  return "";
}

function deriveBalance(totalUsd, accruedPlus3, fallbackTotalUsd = "") {
  const total = parseLooseNumber(totalUsd) ?? parseLooseNumber(fallbackTotalUsd) ?? 0;
  const accrued = parseLooseNumber(accruedPlus3) ?? 0;
  return formatDisplayNumber(accrued - total);
}

function deriveStatusInfo({ comment, action, paymentMethod, totalUsd, accruedPlus3, balance, needsVerification = false, verificationReason = "" }) {
  const commentParts = [String(comment || "").trim(), String(action || "").trim()].filter(Boolean);
  const total = parseLooseNumber(totalUsd);
  const accrued = parseLooseNumber(accruedPlus3);
  const balanceValue = parseLooseNumber(balance);

  if (accrued === null) {
    return {
      status: "CHECK REQUIRED",
      reviewNote: joinReviewParts(["manual review", "missing +3% amount", ...commentParts]),
    };
  }

  if (needsVerification) {
    return {
      status: "NEEDS VERIFICATION",
      reviewNote: joinReviewParts([
        "needs verification",
        verificationReason,
        !paymentMethod ? "payment channel missing" : "",
        ...commentParts,
      ]),
    };
  }

  if (total === null) {
    return {
      status: "CHECK REQUIRED",
      reviewNote: joinReviewParts([
        "manual review",
        !paymentMethod ? "payment channel missing" : "",
        "received amount missing",
        "balance not calculated from incomplete source row",
        ...commentParts,
      ]),
    };
  }

  if (balanceValue !== null && Math.abs(balanceValue) <= 0.01) {
    return { status: "ARRIVED", reviewNote: commentParts.join(" | ") };
  }

  if (balanceValue !== null && balanceValue < -0.01) {
    return {
      status: "OVERPAID",
      reviewNote: joinReviewParts([...commentParts, commentParts.length ? "overpaid" : "overpaid"]),
    };
  }

  return {
    status: "CHECK REQUIRED",
    reviewNote: joinReviewParts(["manual review", "underpaid", ...commentParts]),
  };
}

function summarizeMovementValues(values) {
  let maxDate = "";
  let rowCount = 0;
  for (const row of values.slice(3)) {
    const number = String(row?.[0] || "").trim();
    const date = normalizeDisplayDate(row?.[1]);
    if (!/^\d+$/.test(number) || !date) continue;
    rowCount += 1;
    if (date > maxDate) maxDate = date;
  }
  return { maxDate, rowCount };
}

function summarizePayoutValues(values) {
  const hasTitleRow = String(values?.[0]?.[0] || "").trim().toLowerCase() === "выплаты";
  const headerRowIndex = hasTitleRow ? 1 : 0;
  let maxDate = "";
  let rowCount = 0;
  for (const row of values.slice(headerRowIndex + 1)) {
    const position = String(row?.[0] || "").trim();
    const date = normalizeDisplayDate(row?.[1]);
    if (!/^\d+$/.test(position) || !date) continue;
    rowCount += 1;
    if (date > maxDate) maxDate = date;
  }
  return { maxDate, rowCount };
}

function shouldOverlayTable(upstreamStats, freshStats) {
  return freshStats.maxDate > upstreamStats.maxDate ||
    (freshStats.maxDate === upstreamStats.maxDate && freshStats.rowCount > upstreamStats.rowCount);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function padRow(row, width) {
  const output = Array.isArray(row) ? row.slice(0, width) : [];
  while (output.length < width) output.push("");
  return output;
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split(/[./]/);
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return "";
}

function normalizeDisplayDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split(/[./]/);
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return normalizeIsoDate(raw);
}

function parseDisplayDate(value) {
  const normalized = normalizeDisplayDate(value);
  return normalized ? new Date(`${normalized}T00:00:00Z`) : null;
}

function formatDisplayDate(isoDate) {
  const normalized = normalizeIsoDate(isoDate);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-");
  return `${day}.${month}.${year}`;
}

function formatFreshTimestamp(date) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Kiev",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${lookup.day}.${lookup.month}.${lookup.year} ${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, "");
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstPositiveLooseNumber(values = []) {
  for (const value of values || []) {
    const numeric = parseLooseNumber(value);
    if (numeric === null || numeric <= 0) continue;
    return Math.abs(numeric);
  }
  return 0;
}

function normalizeNumberCell(value) {
  const numeric = parseLooseNumber(value);
  return numeric === null ? "" : formatDisplayNumber(numeric);
}

function normalizeSumCell(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const matches = raw.match(/[+-]?\d[\d\s]*(?:[.,]\d+)?/g);
  if (!matches) return "";
  const sum = matches.reduce((total, part) => total + (parseLooseNumber(part) || 0), 0);
  return formatDisplayNumber(sum);
}

function normalizePercentShare(value) {
  const numeric = parseLooseNumber(value);
  return numeric === null ? "" : formatDisplayNumber(numeric * 0.7);
}

function formatTableNumber(value) {
  return Number(value || 0).toFixed(4).replace(".", ",");
}

function formatDisplayNumber(value) {
  return String(Math.round(Number(value || 0) * 10000) / 10000)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(".", ",");
}

function firstNonEmpty(values) {
  for (const value of values || []) {
    if (String(value || "").trim()) return value;
  }
  return "";
}

function hasAnyValue(row) {
  return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
}

function joinReviewParts(parts) {
  return (parts || []).filter(Boolean).join(" | ");
}
