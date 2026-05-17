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

if (isCliEntrypoint()) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim().replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    if (options.apply) {
      print({ ok: false, dryRun: false, error: "Google service account credentials are not configured; --apply is disabled without explicit Sheets credentials." }, options);
      process.exitCode = 1;
      return;
    }
    print(await buildLiveDryRunReport(options), options);
    return;
  }

  const accessToken = await requestAccessToken(privateKey, clientEmail);
  const values = await readLedgerValues(accessToken);
  const result = buildWiseAmountNetHistoryFix(values);
  if (options.apply && result.ok && result.hasChanges) {
    await writeLedgerValues(accessToken, result.values);
  }
  print(toReport(result, options), options);
  if (!result.ok) process.exitCode = 1;
}

export function parseArgs(argv = []) {
  const options = { apply: false, json: false, baseUrl: "https://ezohata-incoming-ledger.vercel.app", from: "2026-05-01", to: "2026-05-17" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--base-url") options.baseUrl = String(argv[++index] || "").replace(/\/+$/, "");
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length).replace(/\/+$/, "");
    else if (arg === "--from") options.from = argv[++index] || "";
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
    else if (arg === "--to") options.to = argv[++index] || "";
    else if (arg.startsWith("--to=")) options.to = arg.slice("--to=".length);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function buildWiseAmountNetHistoryFix(values = []) {
  const headerIndex = findHeaderIndex(values);
  if (headerIndex === -1) {
    return emptyResult(values, ["Ledger header row was not found."]);
  }
  const header = values[headerIndex] || [];
  const indexes = {
    date: findIndex(header, ["date", "дата"]),
    operation: findIndex(header, ["operation"]),
    fromChannel: findIndex(header, ["from_channel", "from channel"]),
    toChannel: findIndex(header, ["to_channel", "to channel"]),
    amount: findIndex(header, ["amount", "сумма"]),
    currency: findIndex(header, ["currency", "валюта"]),
    amountGross: findIndex(header, ["amount_gross", "gross"]),
    amountFee: findIndex(header, ["amount_fee", "fee"]),
    amountNet: findIndex(header, ["amount_net", "net"]),
    source: findIndex(header, ["source", "источник"]),
    rawSourceId: findIndex(header, ["raw_source_id", "source transaction id", "external_id", "external id"]),
    comment: findIndex(header, ["comment", "комментарий"]),
  };
  const missing = Object.entries(indexes).filter(([, index]) => index === -1).map(([name]) => name);
  if (missing.length) return emptyResult(values, [`Ledger required column(s) missing: ${missing.join(", ")}`]);

  const nextValues = values.map((row) => row.slice());
  const candidates = [];
  let totalCorrection = 0;
  let mayCorrection = 0;

  for (let index = headerIndex + 1; index < nextValues.length; index += 1) {
    const row = nextValues[index];
    if (!row?.some((cell) => String(cell || "").trim())) continue;
    const candidate = getWiseCardDebitCandidate(row, indexes, index + 1);
    if (!candidate) continue;
    candidates.push(candidate);
    totalCorrection += candidate.delta;
    if (candidate.date >= "2026-05-01" && candidate.date <= "2026-05-17") mayCorrection += candidate.delta;
    row[indexes.amountNet] = formatNumber(candidate.nextAmountNet);
  }

  return {
    ok: true,
    values: nextValues,
    hasChanges: candidates.length > 0,
    candidateRows: candidates,
    safeWiseCardDebitRows: candidates.length,
    totalCorrection: round(totalCorrection),
    may2026Correction: round(mayCorrection),
    errors: [],
  };
}

async function buildLiveDryRunReport(options) {
  try {
    const baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
    const url = `${baseUrl}/api?action=getDashboardData&from=${encodeURIComponent(options.from)}&to=${encodeURIComponent(options.to)}`;
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    const operations = payload?.data?.manual?.operations || [];
    if (!response.ok || !Array.isArray(operations)) {
      return { ok: false, dryRun: true, error: payload?.error || `Live dashboard data failed with HTTP ${response.status}` };
    }
    const candidates = operations.map(getWiseCardDebitCandidateFromOperation).filter(Boolean);
    const mayCorrection = candidates
      .filter((row) => row.date >= options.from && row.date <= options.to)
      .reduce((sum, row) => sum + row.delta, 0);
    return {
      ok: true,
      dryRun: true,
      applied: false,
      source: "live-dashboard-data",
      safeWiseCardDebitRows: candidates.length,
      totalCorrection: round(candidates.reduce((sum, row) => sum + row.delta, 0)),
      may2026Correction: round(mayCorrection),
      hasChanges: candidates.length > 0,
      candidateRows: candidates,
      errors: [],
      remainingWiseMayMismatchNote: mayCorrection
        ? "Apply with explicit Google Sheets credentials to reduce the May Wise USD mismatch by this correction only; rerun reconciliation afterward."
        : "No May correction found; investigate Wise USD mismatch at row level.",
    };
  } catch (error) {
    return { ok: false, dryRun: true, error: `Live dashboard data failed: ${String(error?.message || error)}` };
  }
}

function getWiseCardDebitCandidate(row, indexes, sheetRowNumber) {
  const source = normalize(row[indexes.source]);
  const rawSourceId = String(row[indexes.rawSourceId] || "").trim();
  const channelText = `${row[indexes.fromChannel] || ""} ${row[indexes.toChannel] || ""}`.toLowerCase();
  const isWise = source === "wise" || /^(wise|transferwise)[:_-]/i.test(rawSourceId) || /wise|transferwise|трансервайз/i.test(channelText);
  if (!isWise || !/^CARD-/i.test(rawSourceId)) return null;

  const amount = parseNumber(row[indexes.amount]);
  const gross = parseNumber(row[indexes.amountGross]) ?? Math.abs(amount || 0);
  const fee = parseNumber(row[indexes.amountFee]);
  const net = parseNumber(row[indexes.amountNet]);
  if (amount === null || gross === null || fee === null || net === null) return null;
  const fullDebit = Math.abs(gross || amount);
  const feeReducedNet = round(Math.max(0, fullDebit - Math.abs(fee)));
  if (Math.abs(net - feeReducedNet) > 0.0001) return null;
  if (Math.abs(fullDebit - net) <= 0.0001) return null;
  const operation = normalize(row[indexes.operation]);
  if (!isOutflowOperation(operation)) return null;
  return {
    sheetRowNumber,
    date: normalizeDate(row[indexes.date]),
    operation,
    from_channel: String(row[indexes.fromChannel] || "").trim(),
    to_channel: String(row[indexes.toChannel] || "").trim(),
    currency: String(row[indexes.currency] || "").trim().toUpperCase(),
    raw_source_id: rawSourceId,
    amount: round(amount),
    fee: round(fee),
    previousAmountNet: round(net),
    nextAmountNet: round(fullDebit),
    delta: round(fullDebit - net),
    reason: "Wise CARD debit already includes provider fee in the full balance debit; amount_net must equal full debit while amount_fee remains metadata.",
  };
}

function getWiseCardDebitCandidateFromOperation(row) {
  const rawSourceId = String(row?.rawSourceId || row?.raw_source_id || row?.externalId || row?.external_id || row?.ledgerV2?.external_id || "").trim();
  const isWise = /wise|transferwise|трансервайз/i.test(`${row?.source || ""} ${row?.fromChannel || ""} ${row?.toChannel || ""} ${rawSourceId}`);
  if (!isWise || !/^CARD-/i.test(rawSourceId)) return null;
  const amount = parseNumber(row.amount ?? row.ledgerV2?.amount);
  const gross = parseNumber(row.amountGross ?? row.ledgerV2?.amount_gross) ?? Math.abs(amount || 0);
  const fee = parseNumber(row.amountFee ?? row.ledgerV2?.amount_fee);
  const net = parseNumber(row.amountNet ?? row.ledgerV2?.amount_net);
  if (amount === null || gross === null || fee === null || net === null) return null;
  const fullDebit = Math.abs(gross || amount);
  const feeReducedNet = round(Math.max(0, fullDebit - Math.abs(fee)));
  if (Math.abs(net - feeReducedNet) > 0.0001 || Math.abs(fullDebit - net) <= 0.0001) return null;
  return {
    sheetRowNumber: row.sheetRowNumber,
    date: row.date,
    operation: row.operation,
    from_channel: row.fromChannel || row.ledgerV2?.from_channel || "",
    currency: row.currency || row.ledgerV2?.currency || "",
    raw_source_id: rawSourceId,
    previousAmountNet: round(net),
    nextAmountNet: round(fullDebit),
    fee: round(fee),
    delta: round(fullDebit - net),
    reason: "Wise CARD debit already includes provider fee in the full balance debit; amount_net must equal full debit while amount_fee remains metadata.",
  };
}

function isOutflowOperation(operation) {
  return ["expense", "business_expense", "personal_expense", "transfer", "partner_transfer", "exchange_out"].includes(operation);
}

function toReport(result, { apply = false } = {}) {
  return {
    ok: result.ok,
    dryRun: !apply,
    applied: Boolean(apply && result.ok && result.hasChanges),
    safeWiseCardDebitRows: result.safeWiseCardDebitRows || 0,
    totalCorrection: result.totalCorrection || 0,
    may2026Correction: result.may2026Correction || 0,
    hasChanges: Boolean(result.hasChanges),
    candidateRows: result.candidateRows || [],
    errors: result.errors || [],
    remainingWiseMayMismatchNote: result.may2026Correction
      ? "Apply reduces the May Wise USD mismatch by this correction only; rerun reconciliation and continue row-level investigation until diff is zero."
      : "No May correction found; investigate Wise USD mismatch at row level.",
  };
}

function emptyResult(values, errors) {
  return {
    ok: false,
    values,
    hasChanges: false,
    candidateRows: [],
    safeWiseCardDebitRows: 0,
    totalCorrection: 0,
    may2026Correction: 0,
    errors,
  };
}

async function requestAccessToken(privateKey, clientEmail) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = signJwt({ alg: "RS256", typ: "JWT" }, {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: OAUTH_TOKEN_URL,
    exp: issuedAt + 3600,
    iat: issuedAt,
  }, privateKey);
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
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
  const response = await fetch(`${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(READ_RANGE)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets read failed with HTTP ${response.status}`);
  return payload.values || [];
}

async function writeLedgerValues(accessToken, values) {
  const response = await fetch(`${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(READ_RANGE)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ range: READ_RANGE, majorDimension: "ROWS", values }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets write failed with HTTP ${response.status}`);
}

function findHeaderIndex(values) {
  return (values || []).findIndex((row) => (row || []).some((cell) => normalize(cell) === "date"));
}

function findIndex(header, aliases) {
  const normalized = new Set((aliases || []).map(normalize));
  return (header || []).findIndex((cell) => normalized.has(normalize(cell)));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "_");
}

function normalizeDate(value) {
  const raw = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatNumber(value) {
  return String(round(value));
}

function round(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function print(payload, options) {
  if (options.json !== false) console.log(JSON.stringify(payload, null, 2));
  else console.log(JSON.stringify(payload, null, 2));
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
