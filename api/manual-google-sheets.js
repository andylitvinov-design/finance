import { createSign } from "node:crypto";

const MANUAL_SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";

const EXPENSE_SHEET_NAME = "Расходы";
const BALANCE_SHEET_NAME = "Остатки";
const TRANSFER_SHEET_NAME = "Переводы";
const COMMISSION_SHEET_NAME = "Комиссии";

export async function loadManualRepositoryFromGoogleSheets({ fetchImpl = fetch } = {}) {
  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!clientEmail || !privateKey) {
    return {
      ok: false,
      warning: "Manual Google Sheets overlay skipped: service account credentials are not configured.",
    };
  }

  try {
    const accessToken = await requestServiceAccountAccessToken({ clientEmail, privateKey, fetchImpl });
    const valuesBySheet = await batchGetSheetValues({
      spreadsheetId: MANUAL_SPREADSHEET_ID,
      sheetNames: [EXPENSE_SHEET_NAME, BALANCE_SHEET_NAME, TRANSFER_SHEET_NAME, COMMISSION_SHEET_NAME],
      accessToken,
      fetchImpl,
    });
    return {
      ok: true,
      spreadsheetId: MANUAL_SPREADSHEET_ID,
      expenseRows: parseExpenseRows(valuesBySheet[EXPENSE_SHEET_NAME] || []),
      balances: parseBalanceRows(valuesBySheet[BALANCE_SHEET_NAME] || []),
      transfers: parseTransferRows(valuesBySheet[TRANSFER_SHEET_NAME] || []),
      commissionRows: parseCommissionRows(valuesBySheet[COMMISSION_SHEET_NAME] || []),
    };
  } catch (error) {
    return {
      ok: false,
      warning: `Manual Google Sheets overlay failed: ${String(error?.message || error)}`,
    };
  }
}

function normalizePrivateKey(value) {
  return String(value || "").trim().replace(/\\n/g, "\n");
}

async function requestServiceAccountAccessToken({ clientEmail, privateKey, fetchImpl }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: clientEmail,
      scope: SHEETS_SCOPE,
      aud: OAUTH_TOKEN_URL,
      exp: issuedAt + 3600,
      iat: issuedAt,
    },
    privateKey
  );

  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload?.error_description || payload?.error || `OAuth token request failed with HTTP ${response.status}`);
  }
  return payload.access_token;
}

function signJwt(header, payload, privateKey) {
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function batchGetSheetValues({ spreadsheetId, sheetNames, accessToken, fetchImpl }) {
  const url = new URL(`${SHEETS_API_BASE}/spreadsheets/${spreadsheetId}/values:batchGet`);
  sheetNames.forEach((name) => url.searchParams.append("ranges", `'${name.replace(/'/g, "''")}'`));
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Sheets batchGet failed with HTTP ${response.status}`);
  }
  const output = {};
  (payload.valueRanges || []).forEach((range) => {
    const title = extractSheetTitle(range.range);
    output[title] = range.values || [];
  });
  return output;
}

function extractSheetTitle(range) {
  const raw = String(range || "");
  const match = raw.match(/^'((?:[^']|'')+)'!/);
  if (match) return match[1].replace(/''/g, "'");
  return raw.split("!")[0].replace(/^'|'$/g, "");
}

function parseExpenseRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата", "date"]);
  const categoryIndex = findHeaderIndex(header, ["категория", "category"]);
  if (dateIndex === -1 || categoryIndex === -1) return [];
  const channelIndexes = header
    .map((cell, index) => ({ channel: String(cell || "").trim(), index }))
    .filter((item) => item.channel && item.index !== dateIndex && item.index !== categoryIndex);
  return rows
    .map((row) => ({
      date: normalizeDate(row[dateIndex]),
      category: String(row[categoryIndex] || "").trim(),
      amounts: Object.fromEntries(channelIndexes.map(({ channel, index }) => [channel, String(row[index] || "").trim()])),
    }))
    .filter((row) => row.date && row.category && Object.values(row.amounts).some((value) => String(value || "").trim()));
}

function parseBalanceRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата", "date"]);
  const channelIndex = findHeaderIndex(header, ["канал", "account", "channel"]);
  const amountIndex = findHeaderIndex(header, ["сумма", "amount"]);
  if (dateIndex === -1 || channelIndex === -1 || amountIndex === -1) return [];
  const currencyIndex = findHeaderIndex(header, ["валюта", "currency"]);
  const rateIndex = findHeaderIndex(header, ["курс", "rate"]);
  const usdIndex = findHeaderIndex(header, ["сумма_usd", "usd amount", "usdAmount"]);
  const commentIndex = findHeaderIndex(header, ["комментарий", "comment"]);
  return rows
    .map((row) => {
      const channel = String(row[channelIndex] || "").trim();
      const amount = String(row[amountIndex] || "").trim();
      return {
        date: normalizeDate(row[dateIndex]),
        channel,
        accountName: channel,
        amount,
        balanceAmount: amount,
        currency: currencyIndex === -1 ? "" : String(row[currencyIndex] || "").trim(),
        rate: rateIndex === -1 ? "" : String(row[rateIndex] || "").trim(),
        usdAmount: usdIndex === -1 ? "" : String(row[usdIndex] || "").trim(),
        comment: commentIndex === -1 ? "" : String(row[commentIndex] || "").trim(),
        source: "manual-google-sheets",
      };
    })
    .filter((row) => row.date && row.channel && row.amount);
}

function parseTransferRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата перевода", "date"]);
  const whoIndex = findHeaderIndex(header, ["кто", "who"]);
  const amountIndex = findHeaderIndex(header, ["сумма", "amount"]);
  const currencyIndex = findHeaderIndex(header, ["валюта", "currency"]);
  const channelIndex = findHeaderIndex(header, ["канал куда", "channel", "destination"]);
  const rateIndex = findHeaderIndex(header, ["курс", "rate"]);
  const usdIndex = findHeaderIndex(header, ["сумма в долларах", "usd amount", "usdAmount"]);
  if (dateIndex === -1 || amountIndex === -1 || channelIndex === -1) return [];
  return rows
    .map((row) => ({
      transferDate: normalizeDate(row[dateIndex]),
      who: whoIndex === -1 ? "" : String(row[whoIndex] || "").trim(),
      amount: String(row[amountIndex] || "").trim(),
      currency: currencyIndex === -1 ? "" : String(row[currencyIndex] || "").trim(),
      channel: String(row[channelIndex] || "").trim(),
      rate: rateIndex === -1 ? "" : String(row[rateIndex] || "").trim(),
      usdAmount: usdIndex === -1 ? "" : String(row[usdIndex] || "").trim(),
    }))
    .filter((row) => row.transferDate && row.channel && row.amount);
}

function parseCommissionRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата", "date"]);
  const channelIndex = findHeaderIndex(header, ["канал", "channel"]);
  const usdIndex = findHeaderIndex(header, ["сумма в долларах", "usd amount", "usdAmount"]);
  const commentIndex = findHeaderIndex(header, ["комментарий", "comment"]);
  if (dateIndex === -1 || channelIndex === -1 || usdIndex === -1) return [];
  return rows
    .map((row) => ({
      date: normalizeDate(row[dateIndex]),
      channel: String(row[channelIndex] || "").trim(),
      usdAmount: String(row[usdIndex] || "").trim(),
      comment: commentIndex === -1 ? "" : String(row[commentIndex] || "").trim(),
    }))
    .filter((row) => row.date && row.channel && row.usdAmount);
}

function splitHeaderRows(values) {
  const headerIndex = (values || []).findIndex((row) => {
    const normalized = (row || []).map((cell) => normalizeCell(cell));
    return normalized.includes("дата") || normalized.includes("дата перевода");
  });
  if (headerIndex === -1) return { header: [], rows: [] };
  return {
    header: values[headerIndex] || [],
    rows: values.slice(headerIndex + 1).filter((row) => (row || []).some((cell) => String(cell || "").trim())),
  };
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const display = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (display) return `${display[3]}-${display[2]}-${display[1]}`;
  if (/^\d{5}$/.test(raw)) {
    const date = new Date((Number(raw) - 25569) * 86400 * 1000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  return "";
}

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}
