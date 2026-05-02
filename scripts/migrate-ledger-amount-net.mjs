#!/usr/bin/env node
import { createSign } from "node:crypto";

const SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const SHEET_NAME = "Ledger";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const READ_RANGE = `'${SHEET_NAME}'!A:V`;
const FALLBACK_USD_RATES = {
  RUB: 1 / 84.5563,
  UAH: 1 / 43.86,
  EUR: 1.16,
  CAD: 0.74,
  LOCAL: 1 / 18,
};
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim().replace(/\\n/g, "\n");

if (!clientEmail || !privateKey) {
  console.log(JSON.stringify({
    ok: false,
    dryRun: !apply,
    status: "needs verification",
    message: "Google service account credentials are not configured.",
    rowCount: 0,
    missingAmountNetRows: null,
    exchangeMissingAmountUsdRows: null,
    balanceDelta: null
  }, null, 2));
  process.exit(0);
}

const accessToken = await requestAccessToken();
const values = await readLedgerValues(accessToken);
const result = buildMigratedLedger(values);

if (apply && result.errors.length) {
  console.error(JSON.stringify({ ok: false, dryRun: false, errors: result.errors }, null, 2));
  process.exit(1);
}

if (apply && result.hasChanges) {
  await writeLedgerValues(accessToken, result.values);
}

console.log(JSON.stringify({
  ok: result.errors.length === 0,
  dryRun: !apply,
  applied: apply,
  rowCount: result.rowCount,
  hasChanges: result.hasChanges,
  missingAmountNetRows: result.missingAmountNetRows,
  incompletePayPalRows: result.incompletePayPalRows,
  exchangeMissingAmountUsdRows: result.exchangeMissingAmountUsdRows,
  derivedExchangeAmountUsdRows: result.derivedExchangeAmountUsdRows,
  sourceBackfilledRows: result.sourceBackfilledRows,
  unknownSourceRows: result.unknownSourceRows,
  balanceDelta: round(result.balanceDelta),
  errors: result.errors
}, null, 2));

async function requestAccessToken() {
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
  const response = await fetch(OAUTH_TOKEN_URL, {
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

function signJwt(header, payload, key) {
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key);
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function readLedgerValues(accessToken) {
  const url = `${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(READ_RANGE)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets read failed with HTTP ${response.status}`);
  return payload.values || [];
}

async function writeLedgerValues(accessToken, values) {
  const url = `${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(READ_RANGE)}?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range: READ_RANGE, majorDimension: "ROWS", values }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets write failed with HTTP ${response.status}`);
}

function buildMigratedLedger(values) {
  const headerIndex = (values || []).findIndex((row) => (row || []).some((cell) => normalize(cell) === "date"));
  if (headerIndex === -1) {
    return { values, rowCount: 0, hasChanges: false, missingAmountNetRows: 0, exchangeMissingAmountUsdRows: 0, derivedExchangeAmountUsdRows: 0, balanceDelta: 0, errors: ["Ledger header row was not found."] };
  }
  const header = values[headerIndex].slice();
  let hasChanges = false;
  const required = ["amount_usd", "amount_gross", "amount_fee", "amount_net", "source"];
  for (const name of required) {
    if (findIndex(header, [name]) === -1) {
      header.push(name);
      hasChanges = true;
    }
  }
  const indexes = {
    operation: findIndex(header, ["operation"]),
    amount: findIndex(header, ["amount"]),
    currency: findIndex(header, ["currency", "валюта"]),
    amountUsd: findIndex(header, ["amount_usd"]),
    amountGross: findIndex(header, ["amount_gross"]),
    amountFee: findIndex(header, ["amount_fee", "fee"]),
    amountNet: findIndex(header, ["amount_net"]),
    source: findIndex(header, ["source"]),
    rawSourceId: findIndex(header, ["raw_source_id", "raw source id", "source transaction id", "external_id", "external id"]),
    fromChannel: findIndex(header, ["from_channel", "from channel"]),
    toChannel: findIndex(header, ["to_channel", "to channel"]),
    rate: findIndex(header, ["rate", "курс", "exchange_rate", "kurs"]),
  };
  const nextValues = values.map((row, index) => index === headerIndex ? header.slice() : row.slice());
  let rowCount = 0;
  let missingAmountNetRows = 0;
  let incompletePayPalRows = 0;
  let exchangeMissingAmountUsdRows = 0;
  let derivedExchangeAmountUsdRows = 0;
  let sourceBackfilledRows = 0;
  let unknownSourceRows = 0;
  let balanceDelta = 0;
  const errors = [];

  for (let index = headerIndex + 1; index < nextValues.length; index += 1) {
    const row = nextValues[index];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    rowCount += 1;
    const amount = parseNumber(row[indexes.amount]);
    const amountGross = parseNumber(row[indexes.amountGross]) ?? Math.abs(amount || 0);
    const amountFee = parseNumber(row[indexes.amountFee]);
    const existingNet = parseNumber(row[indexes.amountNet]);
    const source = inferLedgerSource({
      currentSource: row[indexes.source],
      rawSourceId: row[indexes.rawSourceId],
      fromChannel: row[indexes.fromChannel],
      toChannel: row[indexes.toChannel],
    });
    if (source === "unknown") {
      unknownSourceRows += 1;
    } else if (String(row[indexes.source] || "").trim() !== source) {
      row[indexes.source] = source;
      sourceBackfilledRows += 1;
      hasChanges = true;
    }
    const isPayPalSource = source === "paypal";
    const nextNet = existingNet === null
      ? deriveSafeAmountNet({ amount, amountGross, amountFee, isPayPalSource })
      : existingNet;
    if (existingNet === null) {
      missingAmountNetRows += 1;
      if (isPayPalSource && amountFee === null) incompletePayPalRows += 1;
    }
    const nextGross = row[indexes.amountGross] || formatNumber(Math.abs(amount || 0));
    if (row[indexes.amountGross] !== nextGross) {
      row[indexes.amountGross] = nextGross;
      hasChanges = true;
    }
    if (nextNet !== null) {
      const formattedNet = formatNumber(nextNet);
      if (row[indexes.amountNet] !== formattedNet) {
        row[indexes.amountNet] = formattedNet;
        hasChanges = true;
      }
      balanceDelta += signedAmount(nextNet, row[indexes.operation]) - signedAmount(amount || 0, row[indexes.operation]);
    }
    const operation = normalize(row[indexes.operation]);
    if (operation === "exchange_in" || operation === "exchange_out" || operation === "exchange") {
      const existingAmountUsd = parseNumber(row[indexes.amountUsd]);
      if (existingAmountUsd === null) {
        const derivedAmountUsd = deriveExchangeAmountUsd(row, indexes, nextNet ?? Math.abs(amountGross || amount || 0));
        if (derivedAmountUsd === null) {
          exchangeMissingAmountUsdRows += 1;
          errors.push(`Ledger row ${index + 1}: exchange amount_usd is required.`);
        } else {
          row[indexes.amountUsd] = formatNumber(derivedAmountUsd);
          derivedExchangeAmountUsdRows += 1;
          hasChanges = true;
        }
      }
    }
  }

  return {
    values: nextValues,
    rowCount,
    hasChanges,
    missingAmountNetRows,
    incompletePayPalRows,
    exchangeMissingAmountUsdRows,
    derivedExchangeAmountUsdRows,
    sourceBackfilledRows,
    unknownSourceRows,
    balanceDelta,
    errors
  };
}

function inferLedgerSource({ currentSource = "", rawSourceId = "", fromChannel = "", toChannel = "" } = {}) {
  const normalized = normalizeSourceToken(currentSource);
  if (["manual", "fact", "paypal", "wise", "monobank", "privatbank", "td_bank", "migration", "google_sheets"].includes(normalized)) {
    return normalized;
  }
  const fromRawSourceId = inferSourceFromRawSourceId(rawSourceId);
  if (fromRawSourceId) return fromRawSourceId;
  const fromChannels = inferSourceFromChannels(fromChannel, toChannel);
  if (fromChannels) return fromChannels;
  return "unknown";
}

function normalizeSourceToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, "_")
    .trim();
}

function inferSourceFromRawSourceId(rawSourceId = "") {
  const raw = String(rawSourceId || "").trim().toLowerCase();
  if (!raw) return "";
  if (/^migration:/i.test(raw)) return "migration";
  if (/^(paypal|pp|txn[-_:]paypal)/i.test(raw)) return "paypal";
  if (/^(wise|transferwise)[:_-]/i.test(raw)) return "wise";
  if (/^(mono|monobank)[:_-]/i.test(raw)) return "monobank";
  if (/^(privat|privat24|pb)[:_-]/i.test(raw)) return "privatbank";
  if (/^(tdbank|td_bank|td)[:_-]/i.test(raw)) return "td_bank";
  return "";
}

function inferSourceFromChannels(...values) {
  const normalized = values
    .map((value) => String(value || "").trim().toLowerCase().replace(/ё/g, "е"))
    .filter(Boolean)
    .join(" ");
  if (!normalized) return "";
  if (/(paypal|пейпал)/.test(normalized)) return "paypal";
  if (/(wise|transferwise|трансервайз)/.test(normalized)) return "wise";
  if (/(monobank|mono|монобанк)/.test(normalized)) return "monobank";
  if (/(privat|приват)/.test(normalized)) return "privatbank";
  if (/(td bank|tdbank)/.test(normalized)) return "td_bank";
  return "";
}

function deriveSafeAmountNet({ amount, amountGross, amountFee, isPayPalSource = false } = {}) {
  if (Number.isFinite(amountFee)) {
    return Math.max(0, Math.abs(amountGross || amount || 0) - Math.abs(amountFee));
  }
  if (isPayPalSource) return null;
  const base = Math.abs(amountGross || amount || 0);
  return Number.isFinite(base) && base > 0 ? base : null;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function findIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map(normalize));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalize(cell)));
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function signedAmount(value, operation) {
  const amount = Math.abs(Number(value || 0));
  const normalized = normalize(operation);
  return normalized === "exchange_out" || normalized.includes("expense") || normalized === "expense" ? -amount : amount;
}

function deriveExchangeAmountUsd(row, indexes, amountNet) {
  const baseAmount = Math.abs(Number(amountNet || 0)) || Math.abs(parseNumber(row[indexes.amount]) || 0);
  if (!baseAmount) return null;
  const operation = row[indexes.operation];
  const currency = String(row[indexes.currency] || "").trim().toUpperCase();
  const explicitRate = normalizeUsdRate(parseNumber(row[indexes.rate]));
  const rate = currency === "USD"
    ? 1
    : explicitRate || FALLBACK_USD_RATES[currency] || FALLBACK_USD_RATES.LOCAL;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return signedExchangeUsd(baseAmount * rate, operation);
}

function normalizeUsdRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate > 2 ? 1 / rate : rate;
}

function signedExchangeUsd(value, operation) {
  const amount = Math.abs(Number(value || 0));
  const normalized = normalize(operation);
  return normalized === "exchange_out" ? -amount : amount;
}

function formatNumber(value) {
  return String(round(value));
}

function round(value) {
  return Math.round(Number(value || 0) * 1000000) / 1000000;
}
