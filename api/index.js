import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeServerAnalyticsPayload } from "./analytics-normalizer.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import {
  fetchPayPalStatementEntries,
  fetchPayPalStatementEntriesFromMcp,
} from "./paypal-transactions.js";
import { fetchWiseStatementEntries } from "./wise-transactions.js";
import { fetchYooMoneyStatementEntries } from "./yoomoney-transactions.js";

const SUPPORTED_GET_ACTIONS = new Set(["getDashboardData", "saveBalanceSnapshot", "sync"]);
const SUPPORTED_POST_ACTIONS = new Set(["saveBalanceSnapshot", "saveTabData"]);
const SOURCE_SPREADSHEET_ID = "1v2ZvGdutjyMkW0FZqxJ3P0GRVuKPlNxG1lvZiUZlWvo";
const SOURCE_SPREADSHEET_GID = "0";
const SOURCE_SPREADSHEET_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}/export?format=csv&gid=${SOURCE_SPREADSHEET_GID}`;
const SOURCE_SPREADSHEET_URL =
  `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}/edit#gid=${SOURCE_SPREADSHEET_GID}`;
const REAL_INCOME_COLUMN_HEADER = "РЕАЛЬНЫЕ ПРИХОДЫ";
const REAL_INCOME_CHANNELS = [
  "Яндекс руб",
  "пейпал дол",
  "пейпал евр",
  "пейпал сad",
  "трансервайз дол",
  "трансервайз евро",
];
const REAL_INCOME_CHANNEL_CURRENCY = {
  "Яндекс руб": "RUB",
  "пейпал дол": "USD",
  "пейпал евр": "EUR",
  "пейпал сad": "CAD",
  "трансервайз дол": "USD",
  "трансервайз евро": "EUR",
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
  "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)",
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

  const upstream = normalizeUpstreamUrl(process.env.EZOHATA_V2_APPS_SCRIPT_URL);
  if (request.method === "GET" && request.query.health === "1") {
    return response.status(200).json({
      ok: true,
      service: "ezohata-reconcile-v2-api",
      configured: Boolean(upstream),
      fallbackSnapshot: !upstream,
      supportedGetActions: Array.from(SUPPORTED_GET_ACTIONS),
      supportedPostActions: Array.from(SUPPORTED_POST_ACTIONS),
    });
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
    target.searchParams.set(key, String(value));
  });

  const upstreamResponse = await fetch(target.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
  });

  return await pipeResponse(response, upstreamResponse, action);
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

  return await pipeResponse(response, upstreamResponse, action);
}

async function pipeResponse(response, upstreamResponse, action) {
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
    ? normalizeServerAnalyticsPayload(await maybeOverlayManualRepositoryData(await maybeOverlayFreshSourceData(payload.data)))
    : payload.data;

  return response.status(payload.ok ? 200 : 502).json({
    ok: Boolean(payload.ok),
    action: payload.action || action,
    ...(payload.ok
      ? { data }
      : { error: payload.error || "Upstream returned an error." }),
  });
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
    return {
      ...data,
      tabs: {
        ...data.tabs,
        movement: enrichedMovement,
        orders: buildFreshOrdersTable(enrichedMovement),
        ...(freshPayouts ? { payouts: freshPayouts } : {})
      },
      ...(realIncome ? { realIncome } : {})
    };
  } catch (error) {
    console.warn("Fresh source overlay failed, using upstream dashboard data.", error);
    return data;
  }
}

async function maybeOverlayManualRepositoryData(data) {
  if (!data?.period || !data?.tabs?.analytics?.values?.length) return data;
  const manualRepository = await loadManualRepositoryFromGoogleSheets();
  if (!manualRepository.ok) {
    return appendManualWarning(data, manualRepository.warning);
  }
  return {
    ...data,
    manual: {
      ...(data.manual || {}),
      schema: manualRepository.schema,
      operations: manualRepository.operations,
      expenseRows: manualRepository.expenseRows,
      balances: manualRepository.balances.length ? manualRepository.balances : (data.manual?.balances || []),
      balanceRows: manualRepository.balances,
      transfers: manualRepository.transfers,
      commissionRows: manualRepository.commissionRows,
      views: manualRepository.views,
      sourceType: "manual-google-sheets",
      manualSpreadsheetId: manualRepository.spreadsheetId,
    },
  };
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
    ...(summaryRows.length ? { summaryRows } : {}),
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

function normalizeSummaryText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
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
    loadYooMoneyProviderEntries(startDate, endDate),
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
    .map((entry, index) => normalizeRealIncomeEntry(entry, movementRateLookup, index))
    .filter((entry) => entry.realNetUsd > 0);

  const { rowMatches, warnings: matchWarnings } = matchRealIncomeEntriesToMovement(entries, movementValues);
  warnings.push(...matchWarnings);
  return {
    entries,
    rowMatches,
    summaryByChannel: summarizeRealIncomeByChannel(entries, movementValues),
    summaryTotals: summarizeRealIncomeTotals(entries, movementValues),
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
      return { entries: result.entries || [], warnings: [] };
    }
    const result = await fetchPayPalStatementEntriesFromMcp({
      startDate,
      endDate,
      clientId: mcpClientId,
      refreshToken: mcpRefreshToken,
      fetchImpl: fetch,
    });
    return { entries: result.entries || [], warnings: [] };
  } catch (error) {
    return { entries: [], warnings: [`PayPal real income: ${String(error?.message || error)}`] };
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

function normalizeRealIncomeEntry(entry, movementRateLookup, index = 0) {
  const currency = String(entry?.currency || inferChannelCurrency(entry?.channel)).trim().toUpperCase();
  const feeCurrency = String(entry?.feeCurrency || currency).trim().toUpperCase();
  const realGrossLocal = Math.abs(Number(entry?.localAmount || 0));
  const realFeeLocal = Math.abs(Number(entry?.feeAmount || 0));
  const realNetLocal = Math.max(0, realGrossLocal - realFeeLocal);
  const realGrossUsd = convertLocalAmountToUsd(realGrossLocal, currency, movementRateLookup, entry?.channel);
  const realFeeUsd = convertLocalAmountToUsd(realFeeLocal, feeCurrency, movementRateLookup, entry?.channel);
  const realNetUsd = Math.max(0, roundNumber(realGrossUsd - realFeeUsd));
  return {
    id: String(entry?.id || `${entry?.source || "provider"}-${entry?.sourceTransactionId || index}`),
    source: String(entry?.source || "").trim(),
    sourceTransactionId: String(entry?.sourceTransactionId || "").trim(),
    date: normalizeIsoDate(entry?.date),
    channel: String(entry?.channel || "").trim(),
    currency,
    feeCurrency,
    organization: String(entry?.organization || "").trim(),
    realGrossLocal: roundNumber(realGrossLocal),
    realFeeLocal: roundNumber(realFeeLocal),
    realNetLocal: roundNumber(realNetLocal),
    realGrossUsd,
    realFeeUsd,
    realNetUsd,
  };
}

function summarizeRealIncomeByChannel(entries, movementValues) {
  const movementStats = summarizeMovementChannels(movementValues);
  return Object.fromEntries(REAL_INCOME_CHANNELS.map((channel) => {
    const channelEntries = entries.filter((entry) => entry.channel === channel);
    const grossUsd = sumBy(channelEntries, "realGrossUsd");
    const feeUsd = sumBy(channelEntries, "realFeeUsd");
    const netUsd = sumBy(channelEntries, "realNetUsd");
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

function summarizeRealIncomeTotals(entries, movementValues) {
  const summaryByChannel = summarizeRealIncomeByChannel(entries, movementValues);
  const totals = Object.values(summaryByChannel).reduce((acc, row) => ({
    plannedReceivedUsd: acc.plannedReceivedUsd + row.plannedReceivedUsd,
    realGrossUsd: acc.realGrossUsd + row.realGrossUsd,
    realFeeUsd: acc.realFeeUsd + row.realFeeUsd,
    realNetUsd: acc.realNetUsd + row.realNetUsd,
    differenceUsd: acc.differenceUsd + row.differenceUsd,
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

function applyRealIncomeToMovementTable(movementTable, realIncome) {
  if (!movementTable?.values?.length || !realIncome?.entries?.length) return movementTable;
  const values = movementTable.values.map((row) => row.slice());
  const header = values[2] || [];
  const realIncomeIndex = header.findIndex((cell) => normalizeSummaryText(cell) === normalizeSummaryText(REAL_INCOME_COLUMN_HEADER));
  const reviewNoteIndex = header.findIndex((cell) => normalizeSummaryText(cell) === normalizeSummaryText("REVIEW NOTE"));
  if (realIncomeIndex === -1) return movementTable;
  const matchedByRow = new Map((realIncome.rowMatches || []).map((match) => [match.rowNumber, match]));
  for (let index = 3; index < values.length; index += 1) {
    const row = values[index] || [];
    const number = String(row[0] || "").trim();
    if (!matchedByRow.has(number)) continue;
    const match = matchedByRow.get(number);
    row[realIncomeIndex] = formatDisplayNumber(match.realNetUsd);
    row[reviewNoteIndex] = joinReviewParts([
      row[reviewNoteIndex],
      `real income matched: ${match.matchedProvider}`,
      `real income diff ${formatDisplayNumber(match.differencePct)}%`,
    ]);
  }
  values[values.length - 1] = buildFreshMovementTotalRow(values.slice(3, -1));
  if (movementTable.summaryRows?.length) {
    const nextSummaryRows = movementTable.summaryRows
      .filter((row) => normalizeSummaryText(row?.[0]) !== normalizeSummaryText("реально получено net"));
    nextSummaryRows.push(["реально получено net", formatTableNumber(realIncome.summaryTotals?.realNetUsd || 0)]);
    movementTable = { ...movementTable, summaryRows: nextSummaryRows };
  }
  return { ...movementTable, values };
}

function matchRealIncomeEntriesToMovement(entries, movementValues) {
  const warnings = [];
  const rowMatches = [];
  const rows = (movementValues || []).slice(3).filter((row) => /^\d+$/.test(String(row?.[0] || "").trim()));
  const matchedByRow = new Map();
  for (const entry of entries) {
    const candidates = rows
      .map((row) => buildRealIncomeMatchCandidate(entry, row))
      .filter(Boolean)
      .sort((left, right) => compareMatchScore(left.score, right.score));
    if (!candidates.length) {
      warnings.push(`${entry.source || "provider"} ${entry.sourceTransactionId || entry.id}: no movement row match`);
      continue;
    }
    if (candidates.length > 1 && compareMatchScore(candidates[0].score, candidates[1].score) === 0) {
      warnings.push(`${entry.source || "provider"} ${entry.sourceTransactionId || entry.id}: ambiguous movement match`);
      continue;
    }
    const best = candidates[0];
    const existing = matchedByRow.get(best.rowNumber);
    if (existing && compareMatchScore(best.score, existing.score) >= 0) continue;
    if (existing) {
      const existingIndex = rowMatches.findIndex((row) => row.rowNumber === best.rowNumber);
      if (existingIndex !== -1) rowMatches.splice(existingIndex, 1);
    }
    matchedByRow.set(best.rowNumber, best);
    rowMatches.push({
      rowNumber: best.rowNumber,
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
  if (normalized === normalizeLookupText("binance save")) return "Бинанс spot";
  const exact = REAL_INCOME_CHANNELS.find((channel) => normalizeLookupText(channel) === normalized);
  if (exact) return exact;
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
  if (/(yoomoney|юmoney|юмани|юмоней|yandex|яндекс).*(rub|руб)|(?:rub|руб).*(yoomoney|юmoney|юмани|юмоней|yandex|яндекс)/.test(normalized)) {
    return "Яндекс руб";
  }
  return "";
}

function inferFallbackPaymentChannelFromClient(client) {
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
  if (!Array.isArray(movementValues) || !movementValues.length) return {};
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

    seenNumbers.add(number);
    output.push(mapSourceRowToMovementRow(padded, isoDate, derivedContext));
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
    "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)",
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

function mapSourceRowToMovementRow(row, isoDate, derivedContext = buildSourcePaymentContext(row)) {
  const date = formatDisplayDate(isoDate);
  const paymentMethod = derivedContext.paymentMethod;
  const priceBase = normalizeNumberCell(row[6]);
  const quantity = normalizeNumberCell(row[8]);
  const accrued = deriveAccruedAmount(row);
  const accruedPlus3 = deriveAccruedPlusPercent(accrued, paymentMethod);
  const correctedContext = applySourceReceivedAmountCorrection(row, derivedContext);
  const receivedUsd = correctedContext.receivedUsd;
  const receivedRub = correctedContext.receivedRub;
  const receivedUah = correctedContext.receivedUah;
  const rubRate = derivedContext.rubRate;
  const uahRate = derivedContext.uahRate;
  const totalUsd = deriveTotalUsd({ paymentMethod, receivedUsd, receivedRub, receivedUah, rubRate, uahRate });
  const balance = deriveBalance(totalUsd, accruedPlus3);
  const statusInfo = deriveStatusInfo({
    comment: row[5],
    action: row[7],
    paymentMethod,
    totalUsd,
    accruedPlus3,
    balance,
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
    totalUsd,
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

function deriveAccruedAmount(row) {
  const explicitTotal = normalizeNumberCell(row?.[9]);
  if (explicitTotal) return explicitTotal;

  const price = parseLooseNumber(row?.[6]);
  if (price === null) return "";

  const quantity = parseLooseNumber(row?.[8]);
  const accrued = quantity ? price * quantity : price;
  return formatDisplayNumber(accrued);
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
    if (!/ковалев/i.test(String(padded[3] || "").trim())) continue;
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

function buildSourcePaymentContext(row, previousRates = {}) {
  const payment = extractSourcePaymentMethod(row);
  const paymentMethod = payment.paymentMethod;
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
  return /(крипт|crypto|binance|бинанс)/i.test(String(paymentMethod || "").trim());
}

function deriveAccruedPlusPercent(accrued, paymentMethod) {
  const accruedValue = parseLooseNumber(accrued);
  if (accruedValue === null) return "";
  const multiplier = isCryptoPaymentMethod(paymentMethod) ? 1.01 : 1.03;
  return formatDisplayNumber(accruedValue * multiplier);
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

function deriveBalance(totalUsd, accruedPlus3) {
  const total = parseLooseNumber(totalUsd);
  const accrued = parseLooseNumber(accruedPlus3);
  if (total === null || accrued === null) return total === null && accrued !== null ? formatDisplayNumber(-accrued) : "";
  return formatDisplayNumber(total - accrued);
}

function deriveStatusInfo({ comment, action, paymentMethod, totalUsd, accruedPlus3, balance }) {
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

  if (total === null) {
    return {
      status: "CHECK REQUIRED",
      reviewNote: joinReviewParts([
        "manual review",
        !paymentMethod ? "payment channel missing" : "",
        "received amount missing",
        ...commentParts,
      ]),
    };
  }

  if (balanceValue !== null && Math.abs(balanceValue) <= 0.01) {
    return { status: "ARRIVED", reviewNote: commentParts.join(" | ") };
  }

  if (balanceValue !== null && balanceValue > 0.01) {
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
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split(".");
    return `${year}-${month}-${day}`;
  }
  return "";
}

function normalizeDisplayDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split(".");
    return `${year}-${month}-${day}`;
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
