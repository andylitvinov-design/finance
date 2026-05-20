import {
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "./manual-google-sheets.js";
import { AUTO_BALANCE_SHEET_NAME } from "./auto-balance-snapshots.js";

const SHEETS_READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const FALLBACK_USD_RATES = {
  USD: 1,
  EUR: 1.16,
  CAD: 0.74,
  UAH: 1 / 43.86,
  RUB: 1 / 84.5563,
  USDT: 1,
  LOCAL: 1 / 18,
};

export async function loadAutoBalanceRowsFromGoogleSheets({ fetchImpl = fetch } = {}) {
  try {
    const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_READ_SCOPE, fetchImpl });
    const values = await getAutoBalanceSheetValues({ accessToken, fetchImpl });
    return {
      ok: true,
      balances: parseAutoBalanceRows(values),
      warnings: [],
    };
  } catch (error) {
    return {
      ok: false,
      balances: [],
      warnings: [`Auto balance sheet unavailable: ${String(error?.message || error)}`],
    };
  }
}

async function getAutoBalanceSheetValues({ accessToken, fetchImpl }) {
  const range = encodeURIComponent(`'${AUTO_BALANCE_SHEET_NAME}'!A:L`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Read ${AUTO_BALANCE_SHEET_NAME} failed with HTTP ${response.status}`);
  }
  return payload.values || [];
}

export function parseAutoBalanceRows(values = []) {
  const { header, rows } = splitHeaderRows(values);
  const indexes = {
    date: findHeaderIndex(header, ["date", "дата"]),
    provider: findHeaderIndex(header, ["provider", "провайдер"]),
    channel: findHeaderIndex(header, ["channel", "канал"]),
    amount: findHeaderIndex(header, ["amount", "сумма"]),
    currency: findHeaderIndex(header, ["currency", "валюта"]),
    rate: findHeaderIndex(header, ["rate", "курс"]),
    amountUsd: findHeaderIndex(header, ["amount_usd", "сумма_usd", "usd amount"]),
    source: findHeaderIndex(header, ["source", "источник"]),
    rawSourceId: findHeaderIndex(header, ["raw_source_id", "external_id"]),
    status: findHeaderIndex(header, ["status", "статус"]),
    comment: findHeaderIndex(header, ["comment", "комментарий"]),
  };
  if (indexes.date === -1 || indexes.channel === -1 || indexes.currency === -1 || indexes.status === -1) return [];
  return rows
    .map((row, rowIndex) => {
      const status = normalizeAutoBalanceStatus(row[indexes.status]);
      const channel = String(row[indexes.channel] || "").trim();
      const currency = String(row[indexes.currency] || "").trim().toUpperCase();
      const amount = String(row[indexes.amount] ?? "").trim();
      const amountUsd = indexes.amountUsd === -1 ? "" : String(row[indexes.amountUsd] ?? "").trim();
      const numericAmount = parseNumber(amount);
      const hasNumericAmount = Number.isFinite(numericAmount);
      if (["ok", "zero_balance"].includes(status) && !hasNumericAmount) return null;
      return {
        date: normalizeDate(row[indexes.date]),
        channel,
        accountName: channel,
        amount: hasNumericAmount ? amount : "",
        balanceAmount: hasNumericAmount ? amount : "",
        currency,
        rate: indexes.rate === -1 ? "" : String(row[indexes.rate] ?? "").trim(),
        usdAmount: hasNumericAmount ? (amountUsd || formatUsdAmount(numericAmount, currency)) : "",
        source: normalizeAutoBalanceSource(row[indexes.source]),
        fact_source: normalizeAutoBalanceSource(row[indexes.source]) === "paypal_derived_balance"
          ? "derived_balance"
          : (normalizeAutoBalanceSource(row[indexes.source]) === "planned_daily_balance" ? "planned_daily_balance" : "provider_auto"),
        provider: indexes.provider === -1 ? inferProvider(channel) : String(row[indexes.provider] || inferProvider(channel)).trim().toLowerCase(),
        rawSourceId: indexes.rawSourceId === -1 ? "" : String(row[indexes.rawSourceId] || "").trim(),
        status,
        autoBalanceStatus: status,
        auto_balance_status: status,
        isStatusOnly: !hasNumericAmount,
        is_status_only: !hasNumericAmount,
        comment: indexes.comment === -1 ? "" : String(row[indexes.comment] || "").trim(),
        sourceSheet: AUTO_BALANCE_SHEET_NAME,
        sourceRow: rowIndex + 2,
      };
    })
    .filter((row) => row?.date && row.channel && row.currency);
}

function splitHeaderRows(values) {
  const rows = values || [];
  const headerIndex = rows.findIndex((row) => (row || []).some((cell) => ["date", "дата"].includes(normalizeText(cell))));
  if (headerIndex === -1) return { header: [], rows: [] };
  return {
    header: rows[headerIndex] || [],
    rows: rows.slice(headerIndex + 1).filter((row) => (row || []).some((cell) => String(cell || "").trim())),
  };
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map(normalizeText));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeText(cell)));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function normalizeAutoBalanceStatus(value) {
  const status = String(value || "").trim();
  if (status === "needs_permission") return "needs_provider_permission";
  return status || "missing_provider_balance";
}

function normalizeAutoBalanceSource(value) {
  const source = String(value || "").trim().toLowerCase();
  if (source === "planned_daily_balance") return "planned_daily_balance";
  if (source === "paypal_derived_balance") return "paypal_derived_balance";
  if (source === "paypal_manual_balance" || source === "paypal_manual_confirmed_balance") return source;
  return "provider_auto";
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  const numeric = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function formatUsdAmount(amount, currency) {
  const rate = FALLBACK_USD_RATES[currency] || 0;
  if (!rate) return "";
  return String(Math.round(amount * rate * 10000) / 10000).replace(".", ",");
}

function inferProvider(channel) {
  const text = normalizeText(channel);
  if (/wise|transferwise|трансервайз/.test(text)) return "wise";
  if (/paypal|пейпал/.test(text)) return "paypal";
  if (/mono|monobank|монобанк/.test(text)) return "monobank";
  if (/binance|бинанс/.test(text)) return "binance";
  if (/privat|приват/.test(text)) return "privatbank";
  if (/яндекс|yoomoney/.test(text)) return "yoomoney";
  return "provider";
}
