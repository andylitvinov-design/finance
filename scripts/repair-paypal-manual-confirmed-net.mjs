#!/usr/bin/env node
import { createSign } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const SHEET_NAME = "Ledger";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const READ_RANGE = `'${SHEET_NAME}'!A:V`;

export const PAYPAL_MANUAL_CONFIRMATIONS = [
  {
    rawSourceId: "51J71784GD5986719",
    expectedSheetRowNumber: 93,
    expectedDate: "2026-04-21",
    expectedOperation: "income",
    expectedToChannel: "пейпал евр",
    expectedCurrency: "EUR",
    expectedAmount: 200,
    amountFee: 0,
    amountNet: 200,
    source: "paypal_personal_manual",
    commentMarker: "PayPal manual confirmation from screenshot, paid to PayPal balance EUR 200, fee=0, net=200",
  },
  {
    rawSourceId: "7CW85848UD033154F",
    expectedSheetRowNumber: 489,
    expectedDate: "2026-05-19",
    expectedOperation: "income",
    expectedToChannel: "пейпал евр",
    expectedCurrency: "EUR",
    expectedAmount: 3.5,
    amountFee: 0,
    amountNet: 3.5,
    source: "paypal_personal_manual",
    commentMarker: "PayPal refund manual confirmation, fee=0, net=3.5",
  },
];

if (isCliEntrypoint()) {
  await main();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim().replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    console.log(JSON.stringify({
      ok: false,
      dryRun: !apply,
      applied: false,
      error: "Google service account credentials are not configured.",
      targets: [],
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const accessToken = await requestAccessToken(privateKey, clientEmail);
  const values = await readLedgerValues(accessToken);
  const result = buildPayPalManualNetRepair(values, PAYPAL_MANUAL_CONFIRMATIONS);

  if (!result.ok) {
    console.error(JSON.stringify({ ...result, dryRun: !apply, applied: false }, null, 2));
    process.exit(1);
  }

  if (apply) {
    for (const target of result.targets) {
      await writeLedgerRow(accessToken, target.sheetRowNumber, target.nextRow);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: !apply,
    applied: apply,
    targetCount: result.targets.length,
    targets: result.targets.map(({ nextRow, ...target }) => target),
  }, null, 2));
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function buildPayPalManualNetRepair(values, confirmations = PAYPAL_MANUAL_CONFIRMATIONS) {
  const headerIndex = (values || []).findIndex((row) => (row || []).some((cell) => normalizeHeaderCell(cell) === "date"));
  if (headerIndex === -1) return failure("Ledger header row was not found.");

  const header = values[headerIndex] || [];
  const indexes = buildHeaderIndexes(header);
  const missingHeaders = Object.entries(indexes)
    .filter(([, index]) => index === -1)
    .map(([field]) => field);
  if (missingHeaders.length) return failure(`Ledger header is missing required columns: ${missingHeaders.join(", ")}`);

  const rawIdCounts = new Map();
  for (let index = headerIndex + 1; index < values.length; index += 1) {
    const rawId = String(values[index]?.[indexes.rawSourceId] || "").trim();
    if (!rawId) continue;
    rawIdCounts.set(rawId, (rawIdCounts.get(rawId) || 0) + 1);
  }

  const errors = [];
  const targets = [];

  for (const confirmation of confirmations) {
    if ((rawIdCounts.get(confirmation.rawSourceId) || 0) !== 1) {
      errors.push(`${confirmation.rawSourceId}: expected exactly one Ledger row, found ${rawIdCounts.get(confirmation.rawSourceId) || 0}.`);
      continue;
    }

    const rowIndex = values.findIndex((row, index) =>
      index > headerIndex && String(row?.[indexes.rawSourceId] || "").trim() === confirmation.rawSourceId
    );
    const sheetRowNumber = rowIndex + 1;
    const row = values[rowIndex] || [];
    const rowErrors = validateTargetRow(row, indexes, confirmation, sheetRowNumber);
    if (rowErrors.length) {
      errors.push(...rowErrors.map((error) => `${confirmation.rawSourceId}: ${error}`));
      continue;
    }

    const nextRow = row.slice(0, header.length);
    while (nextRow.length < header.length) nextRow.push("");
    nextRow[indexes.amountFee] = formatAmount(confirmation.amountFee);
    nextRow[indexes.amountNet] = formatAmount(confirmation.amountNet);
    nextRow[indexes.source] = confirmation.source;
    nextRow[indexes.comment] = mergeCommentMarker(row[indexes.comment], confirmation.commentMarker);
    nextRow[indexes.updatedAt] = new Date().toISOString();

    targets.push({
      sheetRowNumber,
      rawSourceId: confirmation.rawSourceId,
      date: row[indexes.date],
      operation: row[indexes.operation],
      toChannel: row[indexes.toChannel],
      currency: row[indexes.currency],
      amount: parseNumber(row[indexes.amount]),
      oldAmountFee: row[indexes.amountFee] ?? "",
      oldAmountNet: row[indexes.amountNet] ?? "",
      oldSource: row[indexes.source] ?? "",
      nextAmountFee: formatAmount(confirmation.amountFee),
      nextAmountNet: formatAmount(confirmation.amountNet),
      nextSource: confirmation.source,
      commentMarker: confirmation.commentMarker,
      nextRow,
    });
  }

  if (targets.length !== confirmations.length) {
    errors.push(`Expected ${confirmations.length} repair targets, got ${targets.length}.`);
  }

  return errors.length ? { ok: false, errors, targets } : { ok: true, errors: [], targets };
}

function validateTargetRow(row, indexes, confirmation, sheetRowNumber) {
  const errors = [];
  if (sheetRowNumber !== confirmation.expectedSheetRowNumber) {
    errors.push(`expected sheet row ${confirmation.expectedSheetRowNumber}, found ${sheetRowNumber}.`);
  }
  if (String(row[indexes.date] || "").trim() !== confirmation.expectedDate) {
    errors.push(`expected date ${confirmation.expectedDate}, found ${row[indexes.date] || ""}.`);
  }
  if (normalizeText(row[indexes.operation]) !== normalizeText(confirmation.expectedOperation)) {
    errors.push(`expected operation ${confirmation.expectedOperation}, found ${row[indexes.operation] || ""}.`);
  }
  if (normalizeText(row[indexes.toChannel]) !== normalizeText(confirmation.expectedToChannel)) {
    errors.push(`expected to_channel ${confirmation.expectedToChannel}, found ${row[indexes.toChannel] || ""}.`);
  }
  if (normalizeText(row[indexes.currency]) !== normalizeText(confirmation.expectedCurrency)) {
    errors.push(`expected currency ${confirmation.expectedCurrency}, found ${row[indexes.currency] || ""}.`);
  }
  if (parseNumber(row[indexes.amount]) !== confirmation.expectedAmount) {
    errors.push(`expected amount ${confirmation.expectedAmount}, found ${row[indexes.amount] || ""}.`);
  }
  const oldNet = parseNumber(row[indexes.amountNet]);
  if (oldNet !== null && oldNet !== confirmation.amountNet) {
    errors.push(`old amount_net is non-empty and different: ${row[indexes.amountNet]}.`);
  }
  const oldFee = parseNumber(row[indexes.amountFee]);
  if (oldFee !== null && oldFee !== confirmation.amountFee) {
    errors.push(`old amount_fee is non-empty and different: ${row[indexes.amountFee]}.`);
  }
  const source = normalizeText(row[indexes.source]);
  if (source && source !== "paypal" && source !== normalizeText(confirmation.source)) {
    errors.push(`expected source paypal or ${confirmation.source}, found ${row[indexes.source]}.`);
  }
  return errors;
}

function buildHeaderIndexes(header) {
  return {
    date: findHeaderIndex(header, ["date"]),
    operation: findHeaderIndex(header, ["operation"]),
    toChannel: findHeaderIndex(header, ["to_channel"]),
    amount: findHeaderIndex(header, ["amount"]),
    currency: findHeaderIndex(header, ["currency"]),
    amountFee: findHeaderIndex(header, ["amount_fee"]),
    amountNet: findHeaderIndex(header, ["amount_net"]),
    comment: findHeaderIndex(header, ["comment"]),
    source: findHeaderIndex(header, ["source"]),
    rawSourceId: findHeaderIndex(header, ["raw_source_id"]),
    updatedAt: findHeaderIndex(header, ["updated_at"]),
  };
}

function findHeaderIndex(header, names) {
  const normalizedNames = names.map(normalizeHeaderCell);
  return (header || []).findIndex((cell) => normalizedNames.includes(normalizeHeaderCell(cell)));
}

function failure(error) {
  return { ok: false, errors: [error], targets: [] };
}

function mergeCommentMarker(comment, marker) {
  const current = String(comment || "").trim();
  if (!current) return marker;
  if (current.includes(marker)) return current;
  return `${current} | ${marker}`;
}

function normalizeHeaderCell(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(value) {
  return Number(value).toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 10,
  });
}

async function requestAccessToken(privateKey, clientEmail) {
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

async function writeLedgerRow(accessToken, sheetRowNumber, row) {
  const range = `'${SHEET_NAME}'!A${sheetRowNumber}:V${sheetRowNumber}`;
  const url = `${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values: [row] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets row write failed with HTTP ${response.status}`);
}
