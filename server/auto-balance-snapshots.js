import { fetchWiseBalances } from "../api/wise-transactions.js";
import { fetchMonobankClientInfo } from "../api/monobank-transactions.js";
import {
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "./manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const BALANCE_SHEET_NAME = "Остатки";
const BALANCE_HEADERS = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"];
const SNAPSHOT_COMMENT = "auto daily provider snapshot";
const FALLBACK_USD_RATES = {
  USD: 1,
  EUR: 1.16,
  CAD: 0.74,
  UAH: 1 / 43.86,
  RUB: 1 / 84.5563,
};

export function getProviderCurrentBalanceCapabilities(env = process.env) {
  return [
    {
      provider: "wise",
      provider_current_balance_status: String(env.WISE_API_TOKEN || "").trim() ? "available" : "needs_permission",
    },
    {
      provider: "monobank",
      provider_current_balance_status: String(env.MONOBANK_API_TOKEN || "").trim() ? "available" : "needs_permission",
    },
    { provider: "paypal", provider_current_balance_status: "not_implemented" },
    { provider: "privatbank", provider_current_balance_status: "not_implemented" },
    { provider: "yoomoney", provider_current_balance_status: "not_implemented" },
    { provider: "binance", provider_current_balance_status: "not_implemented" },
  ];
}

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "GET") {
    return response.status(405).json(buildStructuredError("method_not_allowed", `Unsupported method: ${request.method}`));
  }

  const result = await runAutoBalanceSnapshots({
    query: request.query || {},
    env: process.env,
    fetchImpl: fetch,
  });
  return response.status(result.ok ? 200 : 500).json(result);
}

export async function runAutoBalanceSnapshots(options = {}) {
  const query = options.query || {};
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const date = normalizeIsoDate(query.date) || todayUtcDate();
  const dryRun = isTruthy(query.dryRun);
  const warnings = [];
  const providerResults = await collectProviderBalanceRows({ date, env, fetchImpl });
  const rows = providerResults.flatMap((result) => result.rows || []);
  const skippedRows = providerResults.flatMap((result) => result.skipped_rows || []);

  if (!rows.length) {
    warnings.push("No provider returned a writable current balance row.");
  }
  for (const result of providerResults) {
    if (result.warning) warnings.push(result.warning);
    if (result.error) warnings.push(`${result.provider}: ${result.error}`);
  }

  let saveResult = { rowCount: 0, skipped: dryRun ? "dry_run" : "no_rows" };
  if (!dryRun && rows.length) {
    try {
      saveResult = await saveAutoBalanceSnapshotRows(rows, { fetchImpl });
    } catch (error) {
      return {
        ...buildBaseResponse({ date, dryRun, providerResults, rows, skippedRows, warnings }),
        ok: false,
        error: String(error?.message || error),
        saved_rows: 0,
      };
    }
  }

  return {
    ...buildBaseResponse({ date, dryRun, providerResults, rows, skippedRows, warnings }),
    ok: true,
    saved_rows: dryRun ? 0 : Number(saveResult.rowCount || 0),
    save: saveResult,
  };
}

function buildBaseResponse({ date, dryRun, providerResults, rows, skippedRows, warnings }) {
  return {
    ok: true,
    date,
    dryRun,
    saved_rows: 0,
    skipped_rows: skippedRows.length,
    providers_checked: providerResults.map((result) => result.provider),
    providers_succeeded: providerResults
      .filter((result) => result.provider_current_balance_status === "available" && result.rows?.length)
      .map((result) => result.provider),
    providers_failed: providerResults
      .filter((result) => ["error", "needs_permission"].includes(result.provider_current_balance_status))
      .map((result) => result.provider),
    provider_current_balance_status: Object.fromEntries(
      providerResults.map((result) => [result.provider, result.provider_current_balance_status])
    ),
    provider_results: providerResults.map((result) => ({
      provider: result.provider,
      provider_current_balance_status: result.provider_current_balance_status,
      rows: result.rows?.length || 0,
      skipped_rows: result.skipped_rows?.length || 0,
      error: result.error || null,
    })),
    warnings: unique(warnings).slice(0, 20),
    rows_preview: rows.slice(0, 20),
  };
}

export async function collectProviderBalanceRows({ date, env = process.env, fetchImpl = fetch } = {}) {
  return [
    await collectWiseBalanceRows({ date, env, fetchImpl }),
    await collectMonobankBalanceRows({ date, env, fetchImpl }),
    buildUnavailableProviderResult("paypal", "not_implemented", "PayPal module imports transactions only; no proven current-balance endpoint is wired."),
    buildUnavailableProviderResult("privatbank", "not_implemented", "PrivatBank module imports transactions only; no proven current-balance endpoint is wired."),
    buildUnavailableProviderResult("yoomoney", "not_implemented", "YooMoney module imports transactions only; no proven current-balance endpoint is wired."),
    buildUnavailableProviderResult("binance", "not_implemented", "Binance module imports transactions only; no proven current-balance snapshot writer is wired."),
  ];
}

async function collectWiseBalanceRows({ date, env, fetchImpl }) {
  const provider = "wise";
  try {
    if (!String(env.WISE_API_TOKEN || "").trim()) {
      return buildUnavailableProviderResult(provider, "needs_permission", "WISE_API_TOKEN is not configured.");
    }
    const balances = await fetchWiseBalances({
      apiToken: env.WISE_API_TOKEN,
      profileId: env.WISE_PROFILE_ID,
      baseUrl: env.WISE_API_BASE || "https://api.wise.com",
      fetchImpl,
    });
    const rows = (balances || []).map((balance) => buildSnapshotRow({
      date,
      channel: balance.channel,
      amount: balance.amount,
      currency: balance.currency,
      amountUsd: balance.amountUsd,
    })).filter(Boolean);
    return { provider, provider_current_balance_status: "available", rows, skipped_rows: [] };
  } catch (error) {
    return { provider, provider_current_balance_status: "error", rows: [], skipped_rows: [], error: String(error?.message || error) };
  }
}

async function collectMonobankBalanceRows({ date, env, fetchImpl }) {
  const provider = "monobank";
  try {
    if (!String(env.MONOBANK_API_TOKEN || "").trim()) {
      return buildUnavailableProviderResult(provider, "needs_permission", "MONOBANK_API_TOKEN is not configured.");
    }
    const clientInfo = await fetchMonobankClientInfo({
      apiToken: env.MONOBANK_API_TOKEN,
      baseUrl: env.MONOBANK_API_BASE || "https://api.monobank.ua",
      fetchImpl,
    });
    const accounts = collectMonobankRawAccounts(clientInfo.rawClient);
    const rows = [];
    const skipped_rows = [];
    for (const account of accounts) {
      const mapped = mapMonobankAccountToSnapshotRow(account, date);
      if (mapped) rows.push(mapped);
      else skipped_rows.push({ provider, reason: "missing_real_balance_or_supported_channel" });
    }
    return { provider, provider_current_balance_status: "available", rows, skipped_rows };
  } catch (error) {
    return { provider, provider_current_balance_status: "error", rows: [], skipped_rows: [], error: String(error?.message || error) };
  }
}

function collectMonobankRawAccounts(clientInfo) {
  return [
    ...(Array.isArray(clientInfo?.accounts) ? clientInfo.accounts : []),
    ...(Array.isArray(clientInfo?.jars) ? clientInfo.jars : []),
    ...(Array.isArray(clientInfo?.managedClients) ? clientInfo.managedClients : [])
      .flatMap((client) => Array.isArray(client?.accounts) ? client.accounts : []),
  ];
}

function mapMonobankAccountToSnapshotRow(account, date) {
  if (!Object.prototype.hasOwnProperty.call(account || {}, "balance")) return null;
  const currency = monobankCurrencyByCode(account?.currencyCode);
  const channel = currency === "UAH" ? "монобанк грн" : "";
  if (!channel) return null;
  const amount = Math.round((Number(account.balance) / 100) * 10000) / 10000;
  if (!Number.isFinite(amount)) return null;
  return buildSnapshotRow({ date, channel, amount, currency });
}

function buildUnavailableProviderResult(provider, status, warning) {
  return { provider, provider_current_balance_status: status, rows: [], skipped_rows: [], warning };
}

function buildSnapshotRow({ date, channel, amount, currency, amountUsd }) {
  const numericAmount = Number(amount);
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const normalizedChannel = String(channel || "").trim();
  if (!date || !normalizedChannel || !normalizedCurrency || !Number.isFinite(numericAmount)) return null;
  const rate = Number(FALLBACK_USD_RATES[normalizedCurrency] || 0);
  const numericUsd = Number(amountUsd);
  const usdAmount = Number.isFinite(numericUsd) && numericUsd !== 0
    ? numericUsd
    : (rate ? numericAmount * rate : "");
  return {
    date,
    channel: normalizedChannel,
    amount: formatSheetNumber(numericAmount),
    currency: normalizedCurrency,
    rate: rate ? formatSheetNumber(rate, 6) : "",
    usdAmount: usdAmount === "" ? "" : formatSheetNumber(usdAmount),
    comment: SNAPSHOT_COMMENT,
  };
}

export async function saveAutoBalanceSnapshotRows(rows, { fetchImpl = fetch } = {}) {
  const snapshotRows = normalizeSnapshotRows(rows);
  if (!snapshotRows.length) return { rowCount: 0, savedAt: new Date().toISOString() };
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  await ensureBalanceSheetExists({ accessToken, fetchImpl });
  const existingValues = await getBalanceSheetValues({ accessToken, fetchImpl });
  const existingRows = parseBalanceSheetValues(existingValues);
  const mergedRows = mergeBalanceRowsByDateChannelCurrency(existingRows, snapshotRows);
  await putBalanceSheetValues(buildBalanceSheetValues(mergedRows), { accessToken, fetchImpl });
  return { rowCount: snapshotRows.length, savedAt: new Date().toISOString() };
}

function normalizeSnapshotRows(rows) {
  return (rows || []).map((row) => ({
    date: normalizeIsoDate(row?.date),
    channel: String(row?.channel || "").trim(),
    amount: formatSheetNumber(parseSheetNumber(row?.amount)),
    currency: String(row?.currency || "").trim().toUpperCase(),
    rate: row?.rate === "" ? "" : formatSheetNumber(parseSheetNumber(row?.rate), 6),
    usdAmount: row?.usdAmount === "" ? "" : formatSheetNumber(parseSheetNumber(row?.usdAmount)),
    comment: String(row?.comment || SNAPSHOT_COMMENT).trim(),
  })).filter((row) =>
    row.date && row.channel && row.currency && (String(row.amount).trim() || String(row.usdAmount).trim())
  );
}

export function mergeBalanceRowsByDateChannelCurrency(existingRows = [], replacementRows = []) {
  const replacementKeys = new Set((replacementRows || []).map(balanceRowKey));
  return [
    ...(existingRows || []).filter((row) => !replacementKeys.has(balanceRowKey(row))),
    ...(replacementRows || []),
  ].sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
    return left.currency.localeCompare(right.currency);
  });
}

function balanceRowKey(row) {
  return `${normalizeIsoDate(row?.date)}|${String(row?.channel || "").trim()}|${String(row?.currency || "").trim().toUpperCase()}`;
}

async function ensureBalanceSheetExists({ accessToken, fetchImpl }) {
  const metadataResponse = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const metadata = await metadataResponse.json().catch(() => ({}));
  if (!metadataResponse.ok) throw new Error(metadata?.error?.message || `Sheets metadata failed with HTTP ${metadataResponse.status}`);
  const exists = (metadata.sheets || []).some((sheet) => sheet?.properties?.title === BALANCE_SHEET_NAME);
  if (exists) return;
  const createResponse = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: BALANCE_SHEET_NAME } } }] }),
  });
  const payload = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) throw new Error(payload?.error?.message || `Create Остатки sheet failed with HTTP ${createResponse.status}`);
}

async function getBalanceSheetValues({ accessToken, fetchImpl }) {
  const range = encodeURIComponent(`'${BALANCE_SHEET_NAME}'!A:G`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Read Остатки failed with HTTP ${response.status}`);
  return payload.values || [];
}

async function putBalanceSheetValues(values, { accessToken, fetchImpl }) {
  const range = encodeURIComponent(`'${BALANCE_SHEET_NAME}'!A:G`);
  const response = await fetchImpl(
    `${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ range: `'${BALANCE_SHEET_NAME}'!A:G`, majorDimension: "ROWS", values }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Write Остатки failed with HTTP ${response.status}`);
}

function parseBalanceSheetValues(values) {
  return (values || []).slice(1).map((row) => ({
    date: normalizeIsoDate(row?.[0]),
    channel: String(row?.[1] || "").trim(),
    amount: formatSheetNumber(parseSheetNumber(row?.[2])),
    currency: String(row?.[3] || "").trim().toUpperCase(),
    rate: row?.[4] === undefined || row?.[4] === "" ? "" : formatSheetNumber(parseSheetNumber(row?.[4]), 6),
    usdAmount: row?.[5] === undefined || row?.[5] === "" ? "" : formatSheetNumber(parseSheetNumber(row?.[5])),
    comment: String(row?.[6] || "").trim(),
  })).filter((row) => row.date && row.channel && row.currency && (row.amount || row.usdAmount));
}

function buildBalanceSheetValues(rows) {
  return [
    BALANCE_HEADERS.slice(),
    ...(rows || []).map((row) => [
      row.date || "",
      row.channel || "",
      row.amount || "",
      row.currency || "",
      row.rate || "",
      row.usdAmount || "",
      row.comment || "",
    ]),
  ];
}

function monobankCurrencyByCode(code) {
  const lookup = { 124: "CAD", 840: "USD", 978: "EUR", 980: "UAH" };
  return lookup[Number(code)] || "UAH";
}

function parseSheetNumber(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  const numeric = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function formatSheetNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * (10 ** digits)) / (10 ** digits);
  return String(rounded).replace(".", ",");
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildStructuredError(code, message) {
  return { ok: false, error: message, code };
}
