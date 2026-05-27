import { DEFAULT_PROVIDER_FX_CURRENCIES, ensureFxRates } from "./fx-rates.js";
import {
  applyFxRateRows,
  fetchFxRowsForDate,
  parseCurrencyList,
  readFxRateSheetValues,
} from "../scripts/fetch-fx-rates.mjs";

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
  const currentDate = normalizeIsoDate(body.currentDate || request.query?.currentDate) || todayUtcDate();
  const from = normalizeIsoDate(body.from || request.query?.from) || currentDate;
  const to = normalizeIsoDate(body.to || request.query?.to) || from;
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
