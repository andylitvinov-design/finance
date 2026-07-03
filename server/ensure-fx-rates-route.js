import { DEFAULT_PROVIDER_FX_CURRENCIES, ensureFxRates } from "./fx-rates.js";

export default async function ensureFxRatesHandler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  const body = parseRequestBody(request.body);
  const {
    applyFxRateRows,
    fetchFxRowsForDate,
    parseCurrencyList,
    readFxRateSheetValues,
  } = await loadFxRateScriptPrimitives();
  const { currentDate, from, to } = resolveEnsureFxWindow({ body, query: request.query || {} });
  const currencies = parseCurrencyList(body.currencies || request.query?.currencies || DEFAULT_PROVIDER_FX_CURRENCIES);
  const result = await ensureFxRates({
    from,
    to,
    currencies,
    currentDate,
    fetchImpl: fetch,
    readFxRateSheetValues,
    fetchFxRowsForDate,
    applyFxRateRows,
  });

  return response.status(result.ok ? 200 : 500).json({
    ...result,
    action: "ensure-fx-rates",
    target_sheet: "FX Rates",
  });
}

async function loadFxRateScriptPrimitives() {
  return await import("../scripts/fetch-fx-rates.mjs");
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

// Cron calls this endpoint without params; a lookback window heals FX gaps
// left by failed daily runs instead of only fetching today's rate.
export function resolveEnsureFxWindow({ body = {}, query = {}, todayIso = todayUtcDate() } = {}) {
  const currentDate = normalizeIsoDate(body.currentDate || query.currentDate) || todayIso;
  const lookbackDays = normalizeLookbackDays(body.lookbackDays ?? query.lookbackDays);
  const explicitFrom = normalizeIsoDate(body.from || query.from);
  const explicitTo = normalizeIsoDate(body.to || query.to);
  const from = explicitFrom || shiftIsoDate(currentDate, -lookbackDays);
  const to = explicitTo || (explicitFrom ? explicitFrom : currentDate);
  return { currentDate, lookbackDays, from, to };
}

export const DEFAULT_FX_LOOKBACK_DAYS = 7;
const MAX_FX_LOOKBACK_DAYS = 31;

export function normalizeLookbackDays(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_FX_LOOKBACK_DAYS;
  return Math.min(parsed, MAX_FX_LOOKBACK_DAYS);
}

export function shiftIsoDate(isoDate, deltaDays) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}
