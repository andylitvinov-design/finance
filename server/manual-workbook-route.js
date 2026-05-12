import { MANUAL_SPREADSHEET_ID, getManualGoogleSheetsAccessToken, SHEETS_API_BASE_URL } from "./manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const FRIENDLY_QUOTA_ERROR = "Google Sheets quota exceeded. Retry shortly.";

const ALLOWED_SHEET_TITLES = new Set([
  "Ledger",
  "Расходы",
  "Остатки",
  "Переводы",
  "Комиссии",
  "Заказы",
  "Мои заказы",
  "Orders",
  "список моих заказы",
]);

export function createManualWorkbookHandler(routeName) {
  return async function handler(request, response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Cache-Control", "no-store");

    if (request.method === "OPTIONS") {
      return response.status(200).json({ ok: true });
    }

    if (request.method === "GET") {
      return response.status(200).json({
        ok: true,
        route: routeName,
        sourceType: "server-google-service-account",
        spreadsheetId: MANUAL_SPREADSHEET_ID,
        writeEnabled: true,
      });
    }

    if (request.method !== "POST") {
      return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
    }

    try {
      const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
      if (payload.action !== "sheetsFetch") {
        return response.status(400).json({ ok: false, error: "Unsupported manual workbook action." });
      }
      const data = await runRestrictedSheetsFetch(payload);
      return response.status(200).json({ ok: true, route: routeName, data });
    } catch (error) {
      const normalized = normalizeManualWorkbookError(error);
      return response.status(normalized.status).json(normalized.body);
    }
  };
}

async function runRestrictedSheetsFetch(payload) {
  const request = normalizeSheetsRequest(payload);
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE });
  const url = `${SHEETS_API_BASE_URL}${request.path}`;
  const upstreamResponse = await fetch(url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(request.body ? { body: request.body } : {}),
  });
  const text = await upstreamResponse.text();
  const upstreamPayload = parseJson(text);
  if (!upstreamResponse.ok) {
    const message = upstreamPayload?.error?.message || upstreamPayload?.error || `Google Sheets API HTTP ${upstreamResponse.status}`;
    const error = new Error(message);
    error.status = upstreamResponse.status;
    error.retryAfter = parseRetryAfter(upstreamResponse.headers?.get?.("retry-after"));
    throw error;
  }
  return upstreamPayload || {};
}

function normalizeSheetsRequest(payload) {
  const method = String(payload.method || "GET").trim().toUpperCase();
  const path = String(payload.path || "").trim();
  const body = typeof payload.body === "string" ? payload.body : (payload.body ? JSON.stringify(payload.body) : "");
  if (!["GET", "POST", "PUT"].includes(method)) {
    throw Object.assign(new Error("Unsupported Google Sheets method."), { status: 400 });
  }
  if (!path.startsWith(`/spreadsheets/${MANUAL_SPREADSHEET_ID}`)) {
    throw Object.assign(new Error("Unsupported manual workbook spreadsheet."), { status: 400 });
  }
  validateRestrictedSheetsPath(path, method, body);
  return { method, path, body };
}

function validateRestrictedSheetsPath(path, method, body) {
  const noQuery = path.split("?")[0];
  if (method === "GET" && noQuery === `/spreadsheets/${MANUAL_SPREADSHEET_ID}`) return;
  if (method === "POST" && noQuery === `/spreadsheets/${MANUAL_SPREADSHEET_ID}:batchUpdate`) {
    validateSpreadsheetBatchUpdate(body);
    return;
  }
  if (method === "POST" && noQuery === `/spreadsheets/${MANUAL_SPREADSHEET_ID}/values:batchUpdate`) {
    validateValuesBatchUpdate(body);
    return;
  }
  const valuesPrefix = `/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/`;
  if (noQuery.startsWith(valuesPrefix)) {
    const encodedRange = noQuery.slice(valuesPrefix.length).replace(/:clear$/, "");
    validateEncodedRange(encodedRange);
    if (method === "GET") return;
    if (method === "POST" && noQuery.endsWith(":clear")) return;
    if (method === "PUT") return;
  }
  throw Object.assign(new Error("Unsupported manual workbook Google Sheets path."), { status: 400 });
}

function validateSpreadsheetBatchUpdate(body) {
  const payload = parseJson(body);
  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const safe = requests.every((request) => {
    if (request?.addSheet?.properties?.title) {
      return ALLOWED_SHEET_TITLES.has(String(request.addSheet.properties.title));
    }
    if (request?.insertDimension?.range?.dimension === "COLUMNS") {
      return true;
    }
    return false;
  });
  if (!requests.length || !safe) {
    throw Object.assign(new Error("Unsupported manual workbook batch update."), { status: 400 });
  }
}

function validateValuesBatchUpdate(body) {
  const payload = parseJson(body);
  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (!data.length) return;
  data.forEach((item) => validateRangeTitle(String(item?.range || "")));
}

function validateEncodedRange(encodedRange) {
  validateRangeTitle(decodeURIComponent(encodedRange || ""));
}

function validateRangeTitle(range) {
  const title = extractSheetTitle(range);
  if (!ALLOWED_SHEET_TITLES.has(title)) {
    throw Object.assign(new Error("Unsupported manual workbook sheet."), { status: 400 });
  }
}

function extractSheetTitle(range) {
  const raw = String(range || "").trim();
  const match = raw.match(/^'((?:[^']|'')+)'(?:!|$)/);
  if (match) return match[1].replace(/''/g, "'");
  return raw.split("!")[0].replace(/^'|'$/g, "");
}

function normalizeManualWorkbookError(error) {
  const status = Number(error?.status || 500);
  const message = String(error?.message || error || "Manual workbook request failed.");
  if (status === 429 || /quota|rate limit|too many requests/i.test(message)) {
    return {
      status: 429,
      body: {
        ok: false,
        error: FRIENDLY_QUOTA_ERROR,
        retryAfter: Number(error?.retryAfter || 60),
      },
    };
  }
  if (/service account credentials are not configured/i.test(message)) {
    return { status: 503, body: { ok: false, error: "Manual workbook server access is not configured." } };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    body: { ok: false, error: sanitizeGoogleError(message) },
  };
}

function sanitizeGoogleError(message) {
  return String(message || "Manual workbook request failed.")
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, "[redacted-private-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function parseRetryAfter(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 60;
}
