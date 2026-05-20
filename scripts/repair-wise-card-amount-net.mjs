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

const DEFAULT_TARGET_IDS = [
  "CARD-3772654733",
  "CARD-3771957018",
  "CARD-3771546317",
  "CARD-3783859981",
  "CARD-3783623750",
  "CARD-3782940401",
  "CARD-3782348604",
];

if (isCliEntrypoint()) {
  await main();
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
    const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim().replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
      if (options.apply) throw new Error("Google service account credentials are not configured; --apply is disabled.");
      const values = await readLiveDashboardLedgerValues(options);
      const plan = buildWiseCardAmountNetRepairPlan(values, options);
      printReport({
        ...plan,
        dryRun: true,
        applied: false,
        source: "live-dashboard-data",
        note: "Dry-run used the live dashboard API because local Google Sheets credentials are not configured.",
      });
      if (!plan.ok) process.exitCode = 1;
      return;
    }

    const accessToken = await requestAccessToken(privateKey, clientEmail);
    const values = await readLedgerValues(accessToken);
    const plan = buildWiseCardAmountNetRepairPlan(values, options);
    if (options.apply && plan.ok && plan.changes.length) {
      await applyWiseCardAmountNetRepair(accessToken, plan);
    }
    printReport({ ...plan, dryRun: !options.apply, applied: Boolean(options.apply && plan.ok && plan.changes.length) });
    if (!plan.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

export function parseArgs(argv = []) {
  const options = {
    apply: false,
    baseUrl: "https://ezohata-incoming-ledger.vercel.app",
    ids: [],
    from: "",
    to: "",
    channel: "",
    currency: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--base-url") options.baseUrl = String(argv[++index] || "").replace(/\/+$/, "");
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length).replace(/\/+$/, "");
    else if (arg === "--id") options.ids.push(...splitIds(argv[++index]));
    else if (arg.startsWith("--id=")) options.ids.push(...splitIds(arg.slice("--id=".length)));
    else if (arg === "--from") options.from = String(argv[++index] || "").trim();
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length).trim();
    else if (arg === "--to") options.to = String(argv[++index] || "").trim();
    else if (arg.startsWith("--to=")) options.to = arg.slice("--to=".length).trim();
    else if (arg === "--channel") options.channel = String(argv[++index] || "").trim();
    else if (arg.startsWith("--channel=")) options.channel = arg.slice("--channel=".length).trim();
    else if (arg === "--currency") options.currency = String(argv[++index] || "").trim().toUpperCase();
    else if (arg.startsWith("--currency=")) options.currency = arg.slice("--currency=".length).trim().toUpperCase();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.ids = Array.from(new Set(options.ids.map((id) => String(id || "").trim()).filter(Boolean)));
  return options;
}

export function buildWiseCardAmountNetRepairPlan(values = [], options = {}) {
  const headerIndex = findHeaderIndex(values);
  if (headerIndex === -1) return errorPlan(["Ledger header row was not found."]);
  const header = values[headerIndex] || [];
  const indexes = buildIndexes(header);
  const missing = Object.entries(indexes).filter(([, index]) => index === -1).map(([name]) => name);
  if (missing.length) return errorPlan([`Ledger required column(s) missing: ${missing.join(", ")}`]);

  const target = buildTarget(options);
  if (!target.ok) return errorPlan([target.error]);

  const rows = [];
  for (let index = headerIndex + 1; index < values.length; index += 1) {
    const row = values[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    if (!matchesTarget(row, indexes, target)) continue;
    rows.push(buildCandidate(row, indexes, index + 1, indexes.amountNet));
  }

  const errors = validateCandidates(rows, target);
  const changes = rows.filter((row) => row.status === "change");
  const unchanged = rows.filter((row) => row.status === "unchanged");
  return {
    ok: errors.length === 0,
    target: target.type === "ids" ? { type: "ids", ids: target.ids } : {
      type: "range",
      from: target.from,
      to: target.to,
      channel: target.channel,
      currency: target.currency,
    },
    rows,
    changes,
    unchanged,
    errors,
    summary: {
      matched_rows: rows.length,
      change_rows: changes.length,
      unchanged_rows: unchanged.length,
      total_diff: round(changes.reduce((sum, row) => sum + row.diff, 0)),
    },
  };
}

export function applyRepairPlanToValues(values = [], plan = {}) {
  const next = values.map((row) => Array.isArray(row) ? row.slice() : []);
  if (!plan.ok) return next;
  for (const change of plan.changes || []) {
    next[change.rowNumber - 1][change.amountNetColumnIndex] = formatNumber(change.expected_amount_net);
  }
  return next;
}

async function applyWiseCardAmountNetRepair(accessToken, plan) {
  const data = (plan.changes || []).map((row) => ({
    range: `'${SHEET_NAME}'!${columnName(row.amountNetColumnIndex + 1)}${row.rowNumber}`,
    values: [[formatNumber(row.expected_amount_net)]],
  }));
  if (!data.length) return;
  const response = await fetch(`${SHEETS_API_BASE}/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate?valueInputOption=USER_ENTERED`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ data, valueInputOption: "USER_ENTERED" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets write failed with HTTP ${response.status}`);
}

async function readLiveDashboardLedgerValues(options) {
  const from = normalizeDate(options.from) || "2026-05-09";
  const to = normalizeDate(options.to) || "2026-05-12";
  const baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
  const url = `${baseUrl}/api?action=getDashboardData&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  const operations = payload?.data?.manual?.operations || [];
  if (!response.ok || !Array.isArray(operations)) {
    throw new Error(payload?.error || `Live dashboard data failed with HTTP ${response.status}`);
  }
  const rows = [[
    "date",
    "operation",
    "from_channel",
    "to_channel",
    "amount",
    "currency",
    "amount_gross",
    "amount_fee",
    "amount_net",
    "source",
    "raw_source_id",
    "comment",
  ]];
  for (const row of operations) {
    const ledger = row?.ledgerV2 || {};
    const sheetRowNumber = Number(row?.sheetRowNumber || 0);
    const output = [
      row?.date || ledger.date || "",
      row?.operation || ledger.operation || "",
      row?.fromChannel || ledger.from_channel || "",
      row?.toChannel || ledger.to_channel || "",
      row?.amount || ledger.amount || "",
      row?.currency || ledger.currency || "",
      row?.amountGross || ledger.amount_gross || "",
      row?.amountFee || ledger.amount_fee || "",
      row?.amountNet || ledger.amount_net || "",
      row?.source || ledger.source || "",
      row?.rawSourceId || row?.raw_source_id || row?.externalId || row?.external_id || ledger.raw_source_id || ledger.external_id || "",
      row?.comment || ledger.comment || "",
    ];
    if (Number.isInteger(sheetRowNumber) && sheetRowNumber > 1) rows[sheetRowNumber - 1] = output;
    else rows.push(output);
  }
  return rows;
}

function buildTarget(options) {
  const ids = (options.ids && options.ids.length ? options.ids : DEFAULT_TARGET_IDS).map((id) => String(id || "").trim()).filter(Boolean);
  const hasRange = Boolean(options.from || options.to || options.channel || options.currency);
  if (options.ids?.length && hasRange) return { ok: false, error: "Use either --id targets or exact --from/--to/--channel/--currency range, not both." };
  if (options.ids?.length || !hasRange) return { ok: true, type: "ids", ids };
  const from = normalizeDate(options.from);
  const to = normalizeDate(options.to);
  const channel = String(options.channel || "").trim();
  const currency = String(options.currency || "").trim().toUpperCase();
  if (!from || !to || !channel || !currency) {
    return { ok: false, error: "Range mode requires exact --from, --to, --channel, and --currency." };
  }
  if (from > to) return { ok: false, error: "--from must be before or equal to --to." };
  return { ok: true, type: "range", from, to, channel, currency };
}

function matchesTarget(row, indexes, target) {
  const rawSourceId = String(row[indexes.rawSourceId] || "").trim();
  if (target.type === "ids") return target.ids.includes(rawSourceId);
  const date = normalizeDate(row[indexes.date]);
  const channel = String(row[indexes.fromChannel] || row[indexes.toChannel] || "").trim();
  const currency = String(row[indexes.currency] || "").trim().toUpperCase();
  return date >= target.from &&
    date <= target.to &&
    channel === target.channel &&
    currency === target.currency &&
    /^CARD-/i.test(rawSourceId);
}

function buildCandidate(row, indexes, rowNumber, amountNetColumnIndex) {
  const amount = parseNumber(row[indexes.amount]);
  const oldGross = parseNumber(row[indexes.amountGross]);
  const oldFee = parseNumber(row[indexes.amountFee]);
  const oldNet = parseNumber(row[indexes.amountNet]);
  const gross = oldGross ?? Math.abs(amount || 0);
  const expected = round(Math.abs(gross));
  const feeReducedNet = oldFee === null ? null : round(Math.max(0, expected - Math.abs(oldFee)));
  const diff = oldNet === null ? null : round(expected - oldNet);
  const source = String(row[indexes.source] || "").trim();
  const rawSourceId = String(row[indexes.rawSourceId] || "").trim();
  const channel = String(row[indexes.fromChannel] || row[indexes.toChannel] || "").trim();
  const isWiseCard = normalize(source) === "wise" && /^CARD-/i.test(rawSourceId);
  const isOldSemantics = oldNet !== null && feeReducedNet !== null && Math.abs(oldNet - feeReducedNet) <= 0.0001;
  const isAlreadyExpected = oldNet !== null && Math.abs(oldNet - expected) <= 0.0001;
  const status = isAlreadyExpected ? "unchanged" : "change";
  return {
    rowNumber,
    raw_source_id: rawSourceId,
    sourceTransactionId: rawSourceId,
    date: normalizeDate(row[indexes.date]),
    channel,
    currency: String(row[indexes.currency] || "").trim().toUpperCase(),
    old_amount: amount,
    old_amount_net: oldNet,
    old_fee: oldFee,
    old_gross: oldGross,
    comment: String(row[indexes.comment] || "").trim(),
    expected_amount_net: expected,
    diff,
    amountNetColumnIndex,
    status,
    safe: Boolean(isWiseCard && (isOldSemantics || isAlreadyExpected)),
    reason: isAlreadyExpected
      ? "already repaired"
      : "Wise CARD debit amount_net must equal the full account debit; amount_fee remains metadata.",
  };
}

function validateCandidates(rows, target) {
  const errors = [];
  if (target.type === "ids") {
    const byId = new Map();
    for (const row of rows) {
      byId.set(row.raw_source_id, (byId.get(row.raw_source_id) || 0) + 1);
    }
    for (const id of target.ids) {
      const count = byId.get(id) || 0;
      if (count === 0) errors.push(`Missing Ledger row for ${id}.`);
      if (count > 1) errors.push(`Ambiguous Ledger rows for ${id}: ${count} matches.`);
    }
  }
  for (const row of rows) {
    if (!row.safe) errors.push(`Unsafe row ${row.rowNumber} / ${row.raw_source_id}: not a Wise CARD row with old or already-repaired amount_net semantics.`);
    if (row.old_amount === null || row.old_amount_net === null || row.old_gross === null || row.old_fee === null) {
      errors.push(`Unsafe row ${row.rowNumber} / ${row.raw_source_id}: amount, gross, fee, and amount_net must all be present.`);
    }
  }
  return errors;
}

function buildIndexes(header) {
  return {
    date: findIndex(header, ["date", "дата"]),
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

function findHeaderIndex(values) {
  return (values || []).findIndex((row) => (row || []).some((cell) => normalize(cell) === "date"));
}

function findIndex(header, aliases) {
  const normalized = new Set((aliases || []).map(normalize));
  return (header || []).findIndex((cell) => normalized.has(normalize(cell)));
}

function splitIds(value) {
  return String(value || "").split(",").map((id) => id.trim()).filter(Boolean);
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

function columnName(number) {
  let current = number;
  let output = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    current = Math.floor((current - 1) / 26);
  }
  return output;
}

function errorPlan(errors) {
  return {
    ok: false,
    target: null,
    rows: [],
    changes: [],
    unchanged: [],
    errors,
    summary: {
      matched_rows: 0,
      change_rows: 0,
      unchanged_rows: 0,
      total_diff: 0,
    },
  };
}

function printReport(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function printHelp() {
  console.log(`Usage:
  node scripts/repair-wise-card-amount-net.mjs [--apply]
  node scripts/repair-wise-card-amount-net.mjs --id CARD-... [--id CARD-...] [--apply]
  node scripts/repair-wise-card-amount-net.mjs --from 2026-05-09 --to 2026-05-12 --channel "трансервайз дол" --currency USD [--apply]

Dry-run is the default. --apply updates only matched Ledger amount_net cells.`);
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
