import { createHash } from "node:crypto";
import { normalizeManualLedgerCategory } from "./manual-ledger-maps.js";

const REVOLUT_SOURCE = "revolut";
const REVOLUT_CHANNEL_BY_CURRENCY = {
  USD: "REVOLUT дол",
};

const HEADER_ALIASES = {
  transactionId: ["transaction id", "transactionid", "id", "reference", "reference id"],
  completedUtc: ["completed date utc", "completed utc", "completed at utc", "completed date"],
  startedUtc: ["started date utc", "started utc", "started at utc", "started date"],
  completedLocal: ["completed date local", "completed local", "completed at local"],
  startedLocal: ["started date local", "started local", "started at local"],
  date: ["date", "transaction date"],
  description: ["description", "merchant", "counterparty", "name", "details"],
  account: ["account", "account name", "product", "pocket"],
  amount: ["amount", "transaction amount"],
  paidOut: ["paid out", "paid out amount", "debit", "money out"],
  paidIn: ["paid in", "paid in amount", "credit", "money in"],
  fee: ["fee", "fees", "commission"],
  currency: ["currency", "amount currency", "transaction currency"],
  status: ["state", "status", "transaction state"],
  type: ["type", "operation", "transaction type"],
  balance: ["balance", "running balance"],
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "POST") {
    const message = `Unsupported method: ${request.method}`;
    return response.status(405).json(createRevolutResponse({
      ok: false,
      errors: [message],
      error: message,
    }));
  }

  try {
    const payload = parseJsonBody(request.body);
    const input = payload.rows || payload.manualRows || payload.text || payload.statementText || payload.csv || "";
    const result = parseRevolutStatementRows(input, {
      startDate: payload.startDate,
      endDate: payload.endDate,
    });
    return response.status(200).json({
      ...createRevolutResponse({
        ok: true,
        imported: result.entries.length,
        skipped: result.skippedRows.length,
        entries: result.entries,
        skippedRows: result.skippedRows,
        warnings: result.warnings,
      }),
      summary: result.summary,
      transactionCount: result.entries.length,
      periodStart: normalizeIsoDate(payload.startDate),
      periodEnd: normalizeIsoDate(payload.endDate),
    });
  } catch (error) {
    const message = String(error?.message || error || "Revolut statement import failed.");
    return response.status(400).json(createRevolutResponse({
      ok: false,
      errors: [message],
      error: message,
    }));
  }
}

export function parseRevolutStatementRows(rowsOrText, options = {}) {
  const rows = normalizeInputRows(rowsOrText);
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex === -1) {
    throw new Error("Revolut statement header was not found. Export CSV/XLSX with date, amount, currency and status columns.");
  }
  const headerMap = buildHeaderMap(rows[headerIndex]);
  validateHeaderMap(headerMap);
  const warnings = [];
  const skippedRows = [];
  const entries = rows.slice(headerIndex + 1)
    .map((row, index) => normalizeRevolutTransaction(row, index, { ...options, headerMap, warnings, skippedRows }))
    .filter((entry) => entry && entry.date && entry.currency && Math.abs(Number(entry.amount_net || entry.amountNet || entry.netAmount || 0)) > 0)
    .filter((entry) => isWithinDateRange(entry.date, options.startDate, options.endDate));
  return {
    entries,
    skippedRows,
    warnings: Array.from(new Set(warnings)),
    summary: summarizeRevolutStatementEntries(entries),
    source: REVOLUT_SOURCE,
  };
}

export function normalizeRevolutTransaction(row, index = 0, options = {}) {
  const values = Array.isArray(row) ? row : objectRowToArray(row, options.headerMap);
  const read = (key) => {
    const columnIndex = options.headerMap?.[key];
    return columnIndex === undefined ? "" : values[columnIndex];
  };

  const status = String(read("status") || "").trim();
  if (isSkippedStatus(status)) {
    const reason = `${status || "skipped"}: row ${index + 1}`;
    options.skippedRows?.push({ index, status, reason });
    options.warnings?.push(`Revolut row skipped (${reason}).`);
    return null;
  }

  const date = firstNonEmpty(
    normalizeIsoDate(read("completedUtc")),
    normalizeIsoDate(read("startedUtc")),
    normalizeIsoDate(read("completedLocal")),
    normalizeIsoDate(read("startedLocal")),
    normalizeIsoDate(read("date")),
  );
  const transactionDescription = compactDescription([read("description"), read("type")]);
  const account = String(read("account") || "").trim();
  const description = compactDescription([transactionDescription, account]);
  const currency = normalizeCurrency(read("currency"), [read("amount"), read("paidOut"), read("paidIn"), description].join(" "));
  const signedAmount = getSignedMovementAmount({ amount: read("amount"), paidOut: read("paidOut"), paidIn: read("paidIn") });
  if (!date || !currency || !signedAmount) return null;

  const direction = signedAmount > 0 ? "income" : "expense";
  const absAmount = roundAmount(Math.abs(signedAmount));
  const signedNet = roundAmount(signedAmount);
  const feeParsed = parseAmount(read("fee"));
  const sourceTransactionId = normalizeSourceTransactionId(read("transactionId"), {
    date,
    signedAmount: signedNet,
    currency,
    description: transactionDescription,
    account,
  });
  const channel = getRevolutChannel(currency);
  if (!channel) {
    options.warnings?.push(`${sourceTransactionId}: Revolut ${currency} channel is not configured; choose a ledger channel before saving.`);
  }

  return {
    id: `revolut-${sourceTransactionId}`,
    date,
    provider: REVOLUT_SOURCE,
    source: REVOLUT_SOURCE,
    channel,
    fromChannel: direction === "expense" ? channel : "",
    toChannel: direction === "income" ? channel : "",
    direction,
    operation: direction === "income" ? "income" : "expense",
    localAmount: absAmount,
    amount: absAmount,
    currency,
    usdAmount: currency === "USD" ? absAmount : null,
    amountUsd: currency === "USD" ? absAmount : "",
    amount_usd: currency === "USD" ? absAmount : "",
    grossAmount: absAmount,
    amountGross: absAmount,
    amount_gross: absAmount,
    feeAmount: feeParsed.hasValue ? Math.abs(feeParsed.value) : null,
    feeCurrency: feeParsed.hasValue ? currency : "",
    amountFee: feeParsed.hasValue ? Math.abs(feeParsed.value) : "",
    amount_fee: feeParsed.hasValue ? Math.abs(feeParsed.value) : "",
    netAmount: signedNet,
    amountNet: signedNet,
    amount_net: signedNet,
    suggestedCategory: normalizeManualLedgerCategory(direction === "income" ? "serviceIncome" : "business", "business"),
    category: direction === "income" ? "servicein" : "business",
    organization: description || "Revolut transaction",
    counterparty: description || "Revolut transaction",
    counterpartyName: description || "Revolut transaction",
    description,
    status,
    sourceTransactionId,
    externalId: sourceTransactionId,
    external_id: sourceTransactionId,
    rawSourceId: `${REVOLUT_SOURCE}:${sourceTransactionId}`,
    raw_source_id: `${REVOLUT_SOURCE}:${sourceTransactionId}`,
    rawMetadata: [
      `provider=${REVOLUT_SOURCE}`,
      account ? `account=${account}` : "",
      status ? `status=${status}` : "",
      feeParsed.hasValue ? `fee=${Math.abs(feeParsed.value)} ${currency}` : "",
      "fee preserved; not subtracted from amount_net",
    ].filter(Boolean).join("; "),
    preserveBlankChannel: !channel,
    reviewStatus: channel ? "" : "needs_review",
    review_status: channel ? "" : "needs_review",
    confidence: channel ? 0.9 : 0.75,
  };
}

export function summarizeRevolutStatementEntries(entries = []) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIsoDate(entry?.date);
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const signedAmount = Number(entry?.amount_net ?? entry?.amountNet ?? entry?.netAmount ?? 0);
    if (!date || !currency || !signedAmount) return;
    const month = date.slice(0, 7);
    if (!monthLookup.has(month)) monthLookup.set(month, new Map());
    addSummaryAmount(monthLookup.get(month), currency, signedAmount);
    addSummaryAmount(totalLookup, currency, signedAmount);
  });
  return {
    months: Array.from(monthLookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, currencyLookup]) => ({ month, totalsByCurrency: serializeCurrencyTotals(currencyLookup) })),
    totalsByCurrency: serializeCurrencyTotals(totalLookup),
  };
}

function parseJsonBody(body) {
  if (typeof body !== "string") return body || {};
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Invalid JSON payload for Revolut statement import.");
  }
}

function createRevolutResponse(overrides = {}) {
  return {
    ok: Boolean(overrides.ok),
    provider: REVOLUT_SOURCE,
    source: REVOLUT_SOURCE,
    imported: Number(overrides.imported || 0),
    skipped: Number(overrides.skipped || 0),
    entries: Array.isArray(overrides.entries) ? overrides.entries : [],
    skippedRows: Array.isArray(overrides.skippedRows) ? overrides.skippedRows : [],
    warnings: Array.isArray(overrides.warnings) ? overrides.warnings : [],
    errors: Array.isArray(overrides.errors) ? overrides.errors : [],
    ...(overrides.error ? { error: overrides.error } : {}),
  };
}

function normalizeInputRows(rowsOrText) {
  if (Array.isArray(rowsOrText)) {
    if (!rowsOrText.length) throw new Error("Revolut statement rows were empty.");
    if (Array.isArray(rowsOrText[0])) return rowsOrText;
    return objectRowsToMatrix(rowsOrText);
  }
  const text = String(rowsOrText || "").trim();
  if (!text) throw new Error("Revolut statement text was empty.");
  const rows = parseDelimitedRows(text);
  if (!rows.length) throw new Error("Revolut statement rows were empty.");
  return rows;
}

function objectRowsToMatrix(rows) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
  return [headers, ...rows.map((row) => headers.map((header) => row?.[header] ?? ""))];
}

function objectRowToArray(row, headerMap = {}) {
  const values = [];
  Object.entries(headerMap).forEach(([key, index]) => {
    values[index] = row?.[key] ?? row?.[key.replace(/_/g, " ")] ?? "";
  });
  return values;
}

function parseDelimitedRows(text) {
  const delimiter = guessDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (!quoted && char === "\n") {
      row.push(cell.trim());
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}

function guessDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
  return [",", ";", "\t"]
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ",";
}

function findHeaderIndex(rows) {
  return (rows || []).findIndex((row) => {
    const headerMap = buildHeaderMap(row);
    const hasDate = [headerMap.completedUtc, headerMap.startedUtc, headerMap.completedLocal, headerMap.startedLocal, headerMap.date]
      .some((value) => value !== undefined);
    const hasAmount = [headerMap.amount, headerMap.paidIn, headerMap.paidOut].some((value) => value !== undefined);
    return hasDate && headerMap.currency !== undefined && hasAmount;
  });
}

function buildHeaderMap(row = []) {
  const normalized = row.map(normalizeHeader);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES)
      .map(([key, aliases]) => [key, normalized.findIndex((header) => aliases.includes(header))])
      .filter(([, index]) => index !== -1)
  );
}

function validateHeaderMap(headerMap) {
  const hasDate = [headerMap.completedUtc, headerMap.startedUtc, headerMap.completedLocal, headerMap.startedLocal, headerMap.date]
    .some((value) => value !== undefined);
  const hasAmount = [headerMap.amount, headerMap.paidIn, headerMap.paidOut].some((value) => value !== undefined);
  const missing = [];
  if (!hasDate) missing.push("date");
  if (headerMap.currency === undefined) missing.push("currency");
  if (!hasAmount) missing.push("amount/paid in/paid out");
  if (missing.length) throw new Error(`Revolut statement missing required column(s): ${missing.join(", ")}.`);
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-яіїєґ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function isWithinDateRange(date, startDate, endDate) {
  const normalized = normalizeIsoDate(date);
  const start = normalizeIsoDate(startDate);
  const end = normalizeIsoDate(endDate);
  return Boolean(normalized && (!start || normalized >= start) && (!end || normalized <= end));
}

function getSignedMovementAmount({ amount = "", paidOut = "", paidIn = "" } = {}) {
  const amountParsed = parseAmount(amount);
  if (amountParsed.hasValue) return amountParsed.value;
  const paidInParsed = parseAmount(paidIn);
  const paidOutParsed = parseAmount(paidOut);
  if (paidInParsed.hasValue || paidOutParsed.hasValue) {
    return Math.abs(paidInParsed.value) - Math.abs(paidOutParsed.value);
  }
  return 0;
}

function parseAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: 0, hasValue: false };
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  let cleaned = raw
    .replace(/[()\sA-Z$€£₴₽]/gi, "")
    .replace(/[^\d,.-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) cleaned = cleaned.replace(/,/g, "");
  else if (cleaned.includes(",") && !cleaned.includes(".")) cleaned = cleaned.replace(",", ".");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { value: 0, hasValue: false };
  return { value: negative ? -Math.abs(parsed) : parsed, hasValue: true };
}

function normalizeCurrency(value, fallbackText = "") {
  const raw = String(value || "").trim().toUpperCase();
  const text = `${raw} ${fallbackText}`.toUpperCase();
  const match = text.match(/\b(USD|EUR|GBP|CAD|UAH|RUB|MXN)\b/);
  if (match) return match[1];
  if (/[€]/.test(text)) return "EUR";
  if (/[£]/.test(text)) return "GBP";
  if (/\bC\$/.test(text)) return "CAD";
  if (/[₴]/.test(text)) return "UAH";
  if (/[₽]/.test(text)) return "RUB";
  if (/[$]/.test(text)) return "USD";
  return raw;
}

function isSkippedStatus(value) {
  const status = normalizeHeader(value);
  if (!status) return false;
  return ["pending", "declined", "failed", "reverted", "cancelled", "canceled"].includes(status);
}

function normalizeSourceTransactionId(value, fallback = {}) {
  const raw = String(value || "").trim();
  if (raw) return raw;
  return createHash("sha256")
    .update([
      fallback.date || "",
      fallback.signedAmount || "",
      fallback.currency || "",
      fallback.description || "",
      fallback.account || "",
    ].join("|"))
    .digest("hex")
    .slice(0, 24);
}

function getRevolutChannel(currency) {
  return REVOLUT_CHANNEL_BY_CURRENCY[String(currency || "").trim().toUpperCase()] || "";
}

function compactDescription(parts = []) {
  return parts.map((value) => String(value || "").trim()).filter(Boolean).join(" | ").slice(0, 240);
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function addSummaryAmount(lookup, currency, signedAmount) {
  if (!lookup.has(currency)) lookup.set(currency, { income: 0, expense: 0, net: 0 });
  const totals = lookup.get(currency);
  if (signedAmount > 0) totals.income += Math.abs(signedAmount);
  if (signedAmount < 0) totals.expense += Math.abs(signedAmount);
  totals.net += signedAmount;
}

function serializeCurrencyTotals(lookup) {
  return Object.fromEntries(
    Array.from(lookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => [currency, {
        income: roundAmount(totals.income),
        expense: roundAmount(totals.expense),
        net: roundAmount(totals.net),
      }])
  );
}

function roundAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
