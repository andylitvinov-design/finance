import {
  getManualGoogleSheetsAccessToken,
  MANUAL_LEDGER_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
} from "../server/manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const ALLOWED_UPDATE_FIELDS = new Set([
  "date",
  "operation",
  "from_channel",
  "to_channel",
  "amount",
  "currency",
  "amount_usd",
  "amount_gross",
  "amount_fee",
  "amount_net",
  "category",
  "subcategory",
  "direction",
  "comment",
  "counterparty",
  "description",
  "source",
  "external_id",
  "raw_source_id",
  "transfer_group_id",
  "updated_at",
]);
const FIELD_ALIASES = {
  fromChannel: "from_channel",
  toChannel: "to_channel",
  amountUsd: "amount_usd",
  amountGross: "amount_gross",
  amountFee: "amount_fee",
  amountNet: "amount_net",
  rawSourceId: "raw_source_id",
  externalId: "external_id",
  transferGroupId: "transfer_group_id",
  updatedAt: "updated_at",
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const action = String(payload.action || "").trim().toLowerCase();
    if (action === "update") {
      const result = await updateLedgerOperationRow(payload, { fetchImpl: fetch });
      return response.status(200).json({ ok: true, ...result });
    }
    if (action === "delete") {
      const result = await deleteLedgerOperationRow(payload, { fetchImpl: fetch });
      return response.status(200).json({ ok: true, ...result });
    }
    return response.status(400).json({ ok: false, error: "Unsupported ledger operation action." });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      error: String(error?.message || error || "Ledger operation failed."),
    });
  }
}

export async function updateLedgerOperationRow(payload = {}, { fetchImpl = fetch } = {}) {
  const sheetRowNumber = normalizeSheetRowNumber(payload.sheetRowNumber);
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  const header = await readLedgerHeader({ accessToken, fetchImpl });
  const currentRow = await readLedgerRow({ sheetRowNumber, accessToken, fetchImpl });
  const nextRow = buildUpdatedLedgerRow({ header, currentRow, patch: payload });
  const range = buildLedgerRowRange(sheetRowNumber);
  await writeLedgerRow({ range, values: [nextRow], accessToken, fetchImpl });
  return { sheetRowNumber, savedAt: new Date().toISOString() };
}

export async function deleteLedgerOperationRow(payload = {}, { fetchImpl = fetch } = {}) {
  const sheetRowNumber = normalizeSheetRowNumber(payload.sheetRowNumber);
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  const range = buildLedgerRowRange(sheetRowNumber);
  await clearLedgerRow({ range, accessToken, fetchImpl });
  return { sheetRowNumber, savedAt: new Date().toISOString() };
}

function buildUpdatedLedgerRow({ header, currentRow, patch }) {
  const normalizedHeader = normalizeHeader(header);
  if (!normalizedHeader.length) throw new Error("Ledger header row was not found.");
  const values = currentRow.slice(0, normalizedHeader.length);
  while (values.length < normalizedHeader.length) values.push("");
  const updateFields = normalizeUpdateFields(patch);
  updateFields.updated_at = new Date().toISOString();

  for (const [field, value] of Object.entries(updateFields)) {
    if (!ALLOWED_UPDATE_FIELDS.has(field)) continue;
    const index = normalizedHeader.indexOf(field);
    if (index === -1) continue;
    values[index] = String(value ?? "");
  }
  return values;
}

function normalizeUpdateFields(patch = {}) {
  const output = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const field = FIELD_ALIASES[key] || key;
    if (ALLOWED_UPDATE_FIELDS.has(field)) output[field] = value;
  }
  return output;
}

function normalizeHeader(header = []) {
  return (header || []).map((cell) => String(cell || "").trim().toLowerCase());
}

function normalizeSheetRowNumber(value) {
  const rowNumber = Number(value || 0);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("A valid Ledger sheetRowNumber is required.");
  }
  return rowNumber;
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
  if (!row.some((cell) => String(cell || "").trim())) {
    throw new Error("Ledger row was not found. Reload the Operations list and try again.");
  }
  return row;
}

async function writeLedgerRow({ range, values, accessToken, fetchImpl }) {
  await sheetsFetchJson({
    range,
    method: "PUT",
    accessToken,
    fetchImpl,
    searchParams: { valueInputOption: "USER_ENTERED" },
    body: { range, majorDimension: "ROWS", values },
  });
}

async function clearLedgerRow({ range, accessToken, fetchImpl }) {
  await sheetsFetchJson({
    range,
    method: "POST",
    accessToken,
    fetchImpl,
    suffix: ":clear",
    body: {},
  });
}

async function sheetsFetchJson({ range, method, accessToken, fetchImpl, body, searchParams = {}, suffix = "" }) {
  const url = new URL(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${encodeURIComponent(range)}${suffix}`);
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
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Sheets request failed with HTTP ${response.status}`);
  }
  return payload || {};
}

function buildLedgerHeaderRange() {
  return `'${escapeSheetName(MANUAL_LEDGER_SHEET_NAME)}'!A1:V1`;
}

function buildLedgerRowRange(sheetRowNumber) {
  return `'${escapeSheetName(MANUAL_LEDGER_SHEET_NAME)}'!A${sheetRowNumber}:V${sheetRowNumber}`;
}

function escapeSheetName(value) {
  return String(value || "").replace(/'/g, "''");
}
