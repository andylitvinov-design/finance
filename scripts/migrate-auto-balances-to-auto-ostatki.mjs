#!/usr/bin/env node

import {
  AUTO_BALANCE_HEADERS,
  AUTO_BALANCE_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "../server/manual-google-sheets.js";

const MANUAL_BALANCE_SHEET_NAME = "Остатки";
const LEGACY_AUTO_RE = /wise auto snapshot|auto daily provider snapshot|provider snapshot|auto snapshot/i;
const WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function detectLegacyAutoRows(values = []) {
  const { header, rows, headerOffset } = splitHeaderRows(values);
  const indexes = {
    date: findHeaderIndex(header, ["date", "дата"]),
    channel: findHeaderIndex(header, ["channel", "account", "канал"]),
    amount: findHeaderIndex(header, ["amount", "сумма"]),
    currency: findHeaderIndex(header, ["currency", "валюта"]),
    rate: findHeaderIndex(header, ["rate", "курс"]),
    amountUsd: findHeaderIndex(header, ["amount_usd", "usd amount", "usdamount", "сумма_usd"]),
    source: findHeaderIndex(header, ["source", "источник"]),
    comment: findHeaderIndex(header, ["comment", "комментарий"]),
  };
  if (indexes.date === -1 || indexes.channel === -1 || indexes.amount === -1) return [];
  return rows
    .map((row, index) => convertLegacyAutoRow(row, headerOffset + index + 2, indexes))
    .filter(Boolean);
}

export function convertLegacyAutoRow(row = [], sourceRow = null, indexes = defaultLegacyIndexes()) {
  const source = readCell(row, indexes.source);
  const comment = readCell(row, indexes.comment);
  if (!LEGACY_AUTO_RE.test(`${comment} ${source}`)) return null;
  const channel = readCell(row, indexes.channel);
  const provider = inferProvider(`${comment} ${source} ${channel}`);
  const amount = normalizeNumberText(readCell(row, indexes.amount));
  const currency = readCell(row, indexes.currency).toUpperCase() || inferCurrency(channel);
  return {
    date: normalizeDate(readCell(row, indexes.date)),
    provider,
    channel,
    amount,
    currency,
    rate: normalizeNumberText(readCell(row, indexes.rate)),
    amountUsd: normalizeNumberText(readCell(row, indexes.amountUsd)),
    source: source || (provider === "provider" ? "provider_auto" : `${provider}_auto`),
    fetchedAt: "",
    rawSourceId: `legacy-ostatki:${sourceRow}`,
    status: amount ? (Number(amount.replace(",", ".")) === 0 ? "zero_balance" : "ok") : "missing_provider_balance",
    comment: comment || "legacy auto snapshot migrated from Остатки",
    sourceRow,
  };
}

export function summarizeMigration({ manualValues = [], autoValues = [] } = {}) {
  const detectedRows = detectLegacyAutoRows(manualValues);
  const existingRows = parseAutoRows(autoValues);
  const existingKeys = new Set(existingRows.flatMap((row) => makeAutoKeys(row)));
  const rowsToCopy = [];
  const duplicateRows = [];
  const skippedRows = [];
  for (const row of detectedRows) {
    if (!row.date || !row.channel || !row.currency) {
      skippedRows.push({ row: row.sourceRow, reason: "missing_required_fields" });
      continue;
    }
    const keys = makeAutoKeys(row);
    if (keys.some((key) => existingKeys.has(key))) {
      duplicateRows.push(row);
      continue;
    }
    rowsToCopy.push(row);
    keys.forEach((key) => existingKeys.add(key));
  }
  return {
    detected: detectedRows.length,
    rowsToCopy,
    duplicates: duplicateRows,
    skipped: skippedRows,
    detectedRows,
  };
}

export function buildAutoBalanceValues(rows = []) {
  return [
    AUTO_BALANCE_HEADERS,
    ...(rows || []).map((row) => [
      row.date || "",
      row.provider || "",
      row.channel || "",
      row.amount || "",
      row.currency || "",
      row.rate || "",
      row.amountUsd || "",
      row.source || "",
      row.fetchedAt || "",
      row.rawSourceId || "",
      row.status || "",
      row.comment || "",
    ]),
  ];
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: WRITE_SCOPE });
  if (apply) await ensureSheet(accessToken, AUTO_BALANCE_SHEET_NAME);
  const [manualValues, autoValues] = await Promise.all([
    getValues(accessToken, MANUAL_BALANCE_SHEET_NAME, "A:Z"),
    getValues(accessToken, AUTO_BALANCE_SHEET_NAME, "A:L", { optional: true }),
  ]);
  const summary = summarizeMigration({ manualValues, autoValues });
  const existingAutoRows = parseAutoRows(autoValues);
  if (apply && summary.rowsToCopy.length) {
    await replaceSheetValues(accessToken, AUTO_BALANCE_SHEET_NAME, "A:L", buildAutoBalanceValues([...existingAutoRows, ...summary.rowsToCopy]));
  }
  const output = apply
    ? { copied: summary.rowsToCopy.length, duplicates: summary.duplicates, skipped: summary.skipped }
    : { detected: summary.detected, rowsToCopy: summary.rowsToCopy, duplicates: summary.duplicates, skipped: summary.skipped };
  console.log(JSON.stringify(output, null, 2));
}

function splitHeaderRows(values = []) {
  const headerOffset = (values || []).findIndex((row) => (row || []).some((cell) => ["date", "дата"].includes(normalizeText(cell))));
  if (headerOffset === -1) return { header: [], rows: [], headerOffset: -1 };
  return {
    header: values[headerOffset] || [],
    rows: values.slice(headerOffset + 1).filter((row) => (row || []).some((cell) => String(cell || "").trim())),
    headerOffset,
  };
}

function parseAutoRows(values = []) {
  const { header, rows } = splitHeaderRows(values);
  if (!header.length) return [];
  const indexes = Object.fromEntries(AUTO_BALANCE_HEADERS.map((name) => [name, findHeaderIndex(header, [name])]));
  return rows.map((row) => ({
    date: normalizeDate(readCell(row, indexes.date)),
    provider: readCell(row, indexes.provider).toLowerCase() || inferProvider(readCell(row, indexes.channel)),
    channel: readCell(row, indexes.channel),
    amount: normalizeNumberText(readCell(row, indexes.amount)),
    currency: readCell(row, indexes.currency).toUpperCase(),
    rate: normalizeNumberText(readCell(row, indexes.rate)),
    amountUsd: normalizeNumberText(readCell(row, indexes.amount_usd)),
    source: readCell(row, indexes.source),
    fetchedAt: readCell(row, indexes.fetched_at),
    rawSourceId: readCell(row, indexes.raw_source_id),
    status: readCell(row, indexes.status),
    comment: readCell(row, indexes.comment),
  })).filter((row) => row.date && row.channel && row.currency);
}

function defaultLegacyIndexes() {
  return { date: 0, channel: 1, amount: 2, currency: 3, rate: 4, amountUsd: 5, comment: 6, source: 7 };
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map(normalizeText));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeText(cell)));
}

function readCell(row, index) {
  return index === -1 || index === undefined ? "" : String(row?.[index] ?? "").trim();
}

function makeAutoKeys(row = {}) {
  const base = [
    String(row.date || "").trim(),
    inferProvider(row.provider || row.source || row.comment || ""),
    normalizeText(row.channel),
    String(row.currency || "").trim().toUpperCase(),
  ];
  return [
    [...base, String(row.rawSourceId || "").trim()].join("|"),
    [...base, String(row.amount || "").trim()].join("|"),
  ];
}

function inferProvider(value) {
  const text = normalizeText(value);
  if (/wise|transferwise|трансервайз/.test(text)) return "wise";
  if (/paypal|пейпал/.test(text)) return "paypal";
  if (/mono|monobank|монобанк/.test(text)) return "monobank";
  if (/binance|бинанс/.test(text)) return "binance";
  if (/privat|приват/.test(text)) return "privatbank";
  if (/yoomoney|юmoney|юмани|яндекс/.test(text)) return "yoomoney";
  return "provider";
}

function inferCurrency(channel) {
  const text = normalizeText(channel);
  if (/eur|евр|евро/.test(text)) return "EUR";
  if (/cad|сad|канада/.test(text)) return "CAD";
  if (/uah|грн/.test(text)) return "UAH";
  if (/rub|руб|яндекс/.test(text)) return "RUB";
  if (/usdt|бинанс|binance/.test(text)) return "USDT";
  return "USD";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : raw;
}

function normalizeNumberText(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const numeric = Number(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(numeric)) return "";
  return String(numeric).replace(".", ",");
}

async function ensureSheet(accessToken, title) {
  const metadataResponse = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const metadata = await metadataResponse.json();
  if (!metadataResponse.ok) throw new Error(metadata?.error?.message || `Sheets metadata failed with HTTP ${metadataResponse.status}`);
  if ((metadata.sheets || []).some((sheet) => sheet?.properties?.title === title)) return;
  const createResponse = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  const payload = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) throw new Error(payload?.error?.message || `Create ${title} failed with HTTP ${createResponse.status}`);
}

async function getValues(accessToken, title, columns, options = {}) {
  const range = encodeURIComponent(`'${title}'!${columns}`);
  const response = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && options.optional && /Unable to parse range|not found|cannot find/i.test(String(payload?.error?.message || ""))) return [];
  if (!response.ok) throw new Error(payload?.error?.message || `Read ${title} failed with HTTP ${response.status}`);
  return payload.values || [];
}

export async function replaceSheetValues(accessToken, title, columns, values, { fetchImpl = fetch } = {}) {
  await clearValues(accessToken, title, columns, { fetchImpl });
  return putValues(accessToken, title, columns, values, { fetchImpl });
}

async function clearValues(accessToken, title, columns, { fetchImpl = fetch } = {}) {
  const range = encodeURIComponent(`'${title}'!${columns}`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Clear ${title} failed with HTTP ${response.status}`);
}

async function putValues(accessToken, title, columns, values, { fetchImpl = fetch } = {}) {
  const range = encodeURIComponent(`'${title}'!${columns}`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ range: `'${title}'!${columns}`, majorDimension: "ROWS", values }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Write ${title} failed with HTTP ${response.status}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
