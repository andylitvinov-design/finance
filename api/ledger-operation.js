import { createSign } from "node:crypto";

const SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const LEDGER_SHEET_NAME = "Ledger";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";

const FIELD_TO_HEADER = {
  date: "date",
  operation: "operation",
  fromChannel: "from_channel",
  toChannel: "to_channel",
  amount: "amount",
  currency: "currency",
  amountUsd: "amount_usd",
  amountGross: "amount_gross",
  amountFee: "amount_fee",
  amountNet: "amount_net",
  category: "category",
  comment: "comment",
  source: "source",
  rawSourceId: "raw_source_id",
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Use POST." });

  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    if (payload.action !== "update") {
      return response.status(400).json({ ok: false, error: "Unsupported action." });
    }
    const result = await updateLedgerOperation(payload);
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    const status = Number(error?.status || 500);
    return response.status(status).json({ ok: false, error: String(error?.message || error) });
  }
}

async function updateLedgerOperation(payload) {
  const accessToken = await requestAccessToken();
  const values = await getLedgerValues(accessToken);
  const header = (values[0] || []).map((cell) => String(cell || "").trim());
  if (!header.length) throw httpError(500, "Ledger header is empty.");

  const rowIndex = findMatchingLedgerRow(values, payload.match || {});
  const row = (values[rowIndex] || []).slice();
  const updates = payload.updates || {};
  for (const [field, value] of Object.entries(updates)) {
    if (!Object.prototype.hasOwnProperty.call(FIELD_TO_HEADER, field)) continue;
    const columnIndex = findHeaderIndex(header, FIELD_TO_HEADER[field]);
    if (columnIndex === -1) continue;
    row[columnIndex] = normalizeForSheet(value);
  }
  const updatedAtIndex = findHeaderIndex(header, "updated_at");
  if (updatedAtIndex !== -1) row[updatedAtIndex] = new Date().toISOString();

  const range = `'${escapeSheetName(LEDGER_SHEET_NAME)}'!A${rowIndex + 1}:${columnLetter(Math.max(header.length, row.length))}${rowIndex + 1}`;
  await putSheetValues(accessToken, range, [padRow(row, Math.max(header.length, row.length))]);
  return { sheetRowNumber: rowIndex + 1, updatedAt: new Date().toISOString() };
}

function findMatchingLedgerRow(values, match) {
  const header = values[0] || [];
  const candidates = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    if (!matchesCell(header, row, "source", match.source, { allowBlank: false })) continue;
    if (!matchesCell(header, row, "date", match.date, { date: true })) continue;
    if (!matchesCell(header, row, "operation", match.operation)) continue;
    if (!matchesCell(header, row, "from_channel", match.fromChannel)) continue;
    if (!matchesCell(header, row, "to_channel", match.toChannel)) continue;
    if (!matchesCell(header, row, "amount", match.amount, { number: true })) continue;
    if (!matchesCell(header, row, "currency", match.currency)) continue;
    if (!matchesCell(header, row, "category", match.category)) continue;
    candidates.push(index);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw httpError(409, `Found ${candidates.length} matching Ledger rows. Add raw_source_id or reload data before editing.`);
  throw httpError(404, "Ledger row was not found. Reload Operations and try again.");
}

function matchesCell(header, row, name, expected, options = {}) {
  const rawExpected = String(expected ?? "").trim();
  if (!rawExpected && options.allowBlank !== false) return true;
  const index = findHeaderIndex(header, name);
  if (index === -1) return !rawExpected;
  const actual = String(row[index] ?? "").trim();
  if (options.date) return normalizeDate(actual) === normalizeDate(rawExpected);
  if (options.number) return Math.abs(parseNumber(actual) - parseNumber(rawExpected)) < 0.000001;
  return normalizeToken(actual) === normalizeToken(rawExpected);
}

async function requestAccessToken() {
  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!clientEmail || !privateKey) throw httpError(500, "Google service account credentials are not configured.");
  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = signJwt({ alg: "RS256", typ: "JWT" }, {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: OAUTH_TOKEN_URL,
    exp: issuedAt + 3600,
    iat: issuedAt,
  }, privateKey);
  const authResponse = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const authPayload = await authResponse.json().catch(() => ({}));
  if (!authResponse.ok || !authPayload.access_token) {
    throw httpError(502, authPayload?.error_description || authPayload?.error || `OAuth failed with HTTP ${authResponse.status}`);
  }
  return authPayload.access_token;
}

async function getLedgerValues(accessToken) {
  const range = encodeURIComponent(`'${escapeSheetName(LEDGER_SHEET_NAME)}'!A:V`);
  const sheetsResponse = await fetch(`${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await sheetsResponse.json().catch(() => ({}));
  if (!sheetsResponse.ok) throw httpError(502, payload?.error?.message || `Sheets read failed with HTTP ${sheetsResponse.status}`);
  return payload.values || [];
}

async function putSheetValues(accessToken, range, values) {
  const encodedRange = encodeURIComponent(range);
  const sheetsResponse = await fetch(`${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  const payload = await sheetsResponse.json().catch(() => ({}));
  if (!sheetsResponse.ok) throw httpError(502, payload?.error?.message || `Sheets write failed with HTTP ${sheetsResponse.status}`);
}

function signJwt(header, payload, privateKey) {
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function normalizeForSheet(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  return raw.slice(0, 10);
}

function parseNumber(value) {
  const numeric = Number(String(value ?? "").replace(/\s/g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function findHeaderIndex(header, name) {
  const target = normalizeToken(name).replace(/ /g, "_");
  return (header || []).findIndex((cell) => normalizeToken(cell).replace(/ /g, "_") === target);
}

function columnLetter(columnNumber) {
  let n = Number(columnNumber || 1);
  let text = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    text = String.fromCharCode(65 + mod) + text;
    n = Math.floor((n - mod) / 26);
  }
  return text || "A";
}

function padRow(row, length) {
  const next = row.slice();
  while (next.length < length) next.push("");
  return next;
}

function escapeSheetName(value) {
  return String(value || "").replace(/'/g, "''");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
