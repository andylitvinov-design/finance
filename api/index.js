import { readFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_GET_ACTIONS = new Set(["getDashboardData", "saveBalanceSnapshot", "sync"]);
const SUPPORTED_POST_ACTIONS = new Set(["saveBalanceSnapshot", "saveTabData"]);
const SOURCE_SPREADSHEET_ID = "1v2ZvGdutjyMkW0FZqxJ3P0GRVuKPlNxG1lvZiUZlWvo";
const SOURCE_SPREADSHEET_GID = "0";
const SOURCE_SPREADSHEET_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}/export?format=csv&gid=${SOURCE_SPREADSHEET_GID}`;
const SOURCE_SPREADSHEET_URL =
  `https://docs.google.com/spreadsheets/d/${SOURCE_SPREADSHEET_ID}/edit#gid=${SOURCE_SPREADSHEET_GID}`;
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

  const data = payload.ok ? await maybeOverlayFreshSourceData(payload.data) : payload.data;

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
    return {
      ...data,
      tabs: {
        ...data.tabs,
        movement: freshMovement,
        orders: buildFreshOrdersTable(freshMovement),
        ...(freshPayouts ? { payouts: freshPayouts } : {})
      }
    };
  } catch (error) {
    console.warn("Fresh source overlay failed, using upstream dashboard data.", error);
    return data;
  }
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

    const payoutRow = mapSourceRowToPayoutRow(padded, isoDate, derivedContext);
    if (!payoutRow) continue;

    seenNumbers.add(number);
    output.push(payoutRow);
  }

  return output;
}

function mapSourceRowToPayoutRow(row, isoDate, derivedContext = buildSourcePaymentContext(row)) {
  const paymentMethod = derivedContext.paymentMethod;
  const receivedUsd = derivedContext.receivedUsd;
  const receivedRub = derivedContext.receivedRubForPayout;
  const receivedUah = derivedContext.receivedUahForPayout;
  const rubRate = derivedContext.rubRate;
  const uahRate = derivedContext.uahRate;

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
    joinReviewParts([String(row[5] || "").trim(), String(row[40] || "").trim()]),
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
  const primary = String(row?.[24] || "").trim();
  const secondary = String(row?.[23] || "").trim();
  if (primary && secondary && !primary.includes(",") && secondary.length <= 16) {
    return `${secondary}, ${primary}`;
  }
  return primary || secondary;
}

function looksLikeRublePayment(paymentMethod) {
  return /(руб|yandex|яндекс)/i.test(String(paymentMethod || "").trim());
}

function looksLikeUahPayment(paymentMethod) {
  return /(грн|uah|приват|privat|карта|монобанк|mono|фоп)/i.test(String(paymentMethod || "").trim());
}

function buildSourcePaymentContext(row, previousRates = {}) {
  const paymentMethod = normalizePaymentMethod(row);
  const hasExplicitPaymentMethod = Boolean(paymentMethod);
  const receivedUsd = hasExplicitPaymentMethod ? normalizeSumCell(row[30]) : "";
  const receivedRub = hasExplicitPaymentMethod ? normalizeSumCell(row[32]) : "";
  const receivedRubForPayout = hasExplicitPaymentMethod
    ? normalizeSumCell(firstNonEmpty([row[32], row[31]]))
    : "";
  const receivedUah = hasExplicitPaymentMethod
    ? normalizeSumCell(firstNonEmpty([row[33], row[34]]))
    : "";
  const receivedUahForPayout = hasExplicitPaymentMethod
    ? normalizeSumCell(firstNonEmpty([row[33], row[34], row[32]]))
    : "";
  const hasUsd = parseLooseNumber(receivedUsd) !== null;
  const hasRub = parseLooseNumber(receivedRubForPayout) !== null;
  const hasUah = parseLooseNumber(receivedUah) !== null;
  const explicitRate16 = normalizeNumberCell(row[16]);
  const explicitRate18 = normalizeNumberCell(row[18]);

  const rubRate = looksLikeRublePayment(paymentMethod) || (hasRub && !hasUah && !hasUsd)
    ? firstNonEmpty([explicitRate16, explicitRate18, previousRates.rubRate])
    : firstNonEmpty([explicitRate16, explicitRate18]);
  const uahRate = looksLikeUahPayment(paymentMethod) || hasUah
    ? firstNonEmpty([explicitRate16, explicitRate18, previousRates.uahRate])
    : firstNonEmpty([explicitRate16, explicitRate18]);

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
        ? firstNonEmpty([explicitRate16, explicitRate18, previousRates.rubRate])
        : (previousRates.rubRate || ""),
      uahRate: (looksLikeUahPayment(paymentMethod) || hasUah)
        ? firstNonEmpty([explicitRate16, explicitRate18, previousRates.uahRate])
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

function joinReviewParts(parts) {
  return (parts || []).filter(Boolean).join(" | ");
}
