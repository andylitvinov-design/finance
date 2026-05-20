import { normalizeManualLedgerCategory } from "../server/manual-ledger-maps.js";

const PAYONEER_SOURCE = "payoneer";
const PAYONEER_CHANNEL_BY_CURRENCY = {
  USD: "Payoneer - dol",
  EUR: "Payoneer - eur",
  GBP: "Payoneer GBP",
  CAD: "Payoneer CAD",
};

const HEADER_ALIASES = {
  date: ["date", "transaction date", "created date", "completion date"],
  id: ["transaction id", "reference id", "payment id", "id"],
  description: ["description", "details", "payer", "payee", "from", "to"],
  payer: ["payer", "from"],
  payee: ["payee", "to"],
  currency: ["currency"],
  amount: ["amount"],
  gross: ["gross amount", "gross"],
  credit: ["credit"],
  debit: ["debit"],
  fee: ["fee", "fees", "service fee"],
  net: ["net amount", "net", "total"],
  balance: ["balance", "running balance"],
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  try {
    const payload = parsePayoneerJsonBody(request.body);
    const input = firstPayoneerInput(payload);
    const result = parsePayoneerStatementRows(input, {
      startDate: payload.startDate,
      endDate: payload.endDate,
      dryRun: Boolean(payload.dryRun),
    });
    return response.status(200).json({
      ok: true,
      entries: result.entries,
      summary: result.summary,
      warnings: result.warnings,
      transactionCount: result.entries.length,
      periodStart: normalizeIsoDate(payload.startDate),
      periodEnd: normalizeIsoDate(payload.endDate),
      source: PAYONEER_SOURCE,
    });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      error: String(error?.message || error || "Payoneer statement import failed."),
    });
  }
}

export function parsePayoneerStatementRows(rowsOrText, options = {}) {
  const rows = normalizePayoneerInputRows(rowsOrText);
  const headerIndex = findPayoneerHeaderIndex(rows);
  if (headerIndex === -1) {
    throw new Error("Payoneer statement header was not found. Required columns include date, currency, and amount/net/credit/debit.");
  }
  const headerMap = buildPayoneerHeaderMap(rows[headerIndex]);
  validatePayoneerHeaderMap(headerMap);
  const warnings = [];
  const entries = rows.slice(headerIndex + 1)
    .map((row, index) => normalizePayoneerTransaction(row, index, { ...options, headerMap, warnings }))
    .filter((entry) => entry && entry.date && entry.currency && entry.localAmount > 0);
  return {
    entries,
    summary: summarizePayoneerStatementEntries(entries),
    warnings: Array.from(new Set(warnings)),
    source: PAYONEER_SOURCE,
  };
}

export function normalizePayoneerTransaction(row, index = 0, options = {}) {
  const values = Array.isArray(row) ? row : objectRowToArray(row, options.headerMap);
  const read = (key) => {
    const columnIndex = options.headerMap?.[key];
    return columnIndex === undefined ? "" : values[columnIndex];
  };
  const date = normalizeIsoDate(read("date"));
  const currency = normalizePayoneerCurrency(read("currency"), [
    read("amount"),
    read("gross"),
    read("credit"),
    read("debit"),
    read("net"),
    read("description"),
  ].join(" "));
  const rawId = firstNonEmpty(read("id"), read("balance"));
  const description = compactPayoneerDescription([
    read("description"),
    read("payer"),
    read("payee"),
  ]);
  const grossRaw = firstNonEmpty(read("gross"), read("amount"), read("credit"), read("debit"));
  const grossSigned = read("debit") ? -Math.abs(parsePayoneerAmount(read("debit")).value) : parsePayoneerAmount(grossRaw).value;
  const netParsed = parsePayoneerAmount(read("net"));
  const grossParsed = parsePayoneerAmount(grossRaw);
  const feeParsed = parsePayoneerAmount(read("fee"));
  const hasNet = netParsed.hasValue;
  const hasFee = feeParsed.hasValue;
  const hasGross = grossParsed.hasValue;
  const direction = inferPayoneerDirection({
    netValue: netParsed.value,
    amountValue: grossSigned || grossParsed.value,
    creditValue: parsePayoneerAmount(read("credit")).value,
    debitValue: parsePayoneerAmount(read("debit")).value,
    description,
  });
  const derivedNet = !hasNet && hasGross && hasFee && direction === "income"
    ? Math.max(0, Math.abs(grossParsed.value) - Math.abs(feeParsed.value))
    : null;
  const netAmount = hasNet ? Math.abs(netParsed.value) : derivedNet;
  const localAmount = netAmount ?? Math.abs(grossSigned || grossParsed.value);
  if (!date || !currency || !localAmount) return null;
  if (!hasFee) {
    options.warnings?.push(`${rawId || date || `row ${index + 1}`}: Payoneer fee is missing; amount_fee left blank.`);
  }
  if (!hasNet && derivedNet === null) {
    options.warnings?.push(`${rawId || date || `row ${index + 1}`}: Payoneer net amount is missing; amount_net left blank for review.`);
  }
  const hasConfiguredChannel = ["USD", "EUR"].includes(currency);
  if (!hasConfiguredChannel) {
    options.warnings?.push(`${rawId || date || `row ${index + 1}`}: Payoneer ${currency} channel is not configured; choose a ledger channel before saving.`);
  }
  const sourceTransactionId = normalizePayoneerSourceTransactionId(rawId, {
    date,
    currency,
    amount: localAmount,
    index,
  });
  const grossAmount = hasGross ? Math.abs(grossParsed.value) : localAmount;
  return {
    id: `payoneer-${sourceTransactionId || index}`,
    date,
    channel: getPayoneerChannel(currency),
    direction,
    localAmount,
    currency,
    usdAmount: currency === "USD" && netAmount !== null ? netAmount : null,
    grossAmount,
    amountGross: grossAmount,
    amount_gross: grossAmount,
    feeAmount: hasFee ? Math.abs(feeParsed.value) : null,
    amountFee: hasFee ? Math.abs(feeParsed.value) : "",
    amount_fee: hasFee ? Math.abs(feeParsed.value) : "",
    feeCurrency: hasFee ? currency : "",
    netAmount,
    amountNet: netAmount ?? "",
    amount_net: netAmount ?? "",
    suggestedCategory: normalizeManualLedgerCategory(direction === "income" ? "serviceIncome" : "business", "business"),
    organization: description || "Payoneer transaction",
    counterpartyName: firstNonEmpty(read("payer"), read("payee"), description),
    confidence: hasNet ? 0.9 : 0.75,
    source: PAYONEER_SOURCE,
    sourceTransactionId,
    externalId: sourceTransactionId,
    external_id: sourceTransactionId,
    description,
    rawMetadata: hasNet ? "" : "Payoneer net missing; review amount_net before save.",
    preserveBlankChannel: !hasConfiguredChannel,
    reviewStatus: (hasNet || derivedNet !== null) && hasConfiguredChannel ? "" : "needs_review",
    review_status: (hasNet || derivedNet !== null) && hasConfiguredChannel ? "" : "needs_review",
  };
}

export function summarizePayoneerStatementEntries(entries = []) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIsoDate(entry?.date);
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Math.abs(Number(entry?.localAmount || 0));
    if (!date || !currency || !amount) return;
    const month = date.slice(0, 7);
    if (!monthLookup.has(month)) monthLookup.set(month, new Map());
    addPayoneerSummaryAmount(monthLookup.get(month), currency, entry.direction, amount);
    addPayoneerSummaryAmount(totalLookup, currency, entry.direction, amount);
  });
  return {
    months: Array.from(monthLookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, currencyLookup]) => ({
        month,
        totalsByCurrency: serializePayoneerCurrencyTotals(currencyLookup),
      })),
    totalsByCurrency: serializePayoneerCurrencyTotals(totalLookup),
  };
}

function parsePayoneerJsonBody(body) {
  if (typeof body !== "string") return body || {};
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Invalid JSON payload for Payoneer statement import.");
  }
}

function firstPayoneerInput(payload = {}) {
  return payload.rows || payload.manualRows || payload.text || payload.activityText || "";
}

function normalizePayoneerInputRows(rowsOrText) {
  if (Array.isArray(rowsOrText)) {
    if (!rowsOrText.length) throw new Error("Payoneer statement rows were empty.");
    if (Array.isArray(rowsOrText[0])) return rowsOrText;
    return objectRowsToMatrix(rowsOrText);
  }
  const text = String(rowsOrText || "").trim();
  if (!text) throw new Error("Payoneer statement text was empty.");
  const rows = parseSimpleDelimitedRows(text);
  if (!rows.length) throw new Error("Payoneer statement rows were empty.");
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

function parseSimpleDelimitedRows(text) {
  const delimiter = guessDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
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
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
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
  const candidates = [",", ";", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ",";
}

function findPayoneerHeaderIndex(rows) {
  return (rows || []).findIndex((row) => {
    const headerMap = buildPayoneerHeaderMap(row);
    return headerMap.date !== undefined && headerMap.currency !== undefined &&
      [headerMap.amount, headerMap.gross, headerMap.credit, headerMap.debit, headerMap.net].some((value) => value !== undefined);
  });
}

function buildPayoneerHeaderMap(row = []) {
  const normalized = row.map(normalizePayoneerHeader);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES)
      .map(([key, aliases]) => [key, normalized.findIndex((header) => aliases.includes(header))])
      .filter(([, index]) => index !== -1)
  );
}

function validatePayoneerHeaderMap(headerMap) {
  const missing = [];
  if (headerMap.date === undefined) missing.push("date");
  if (headerMap.currency === undefined) missing.push("currency");
  if ([headerMap.amount, headerMap.gross, headerMap.credit, headerMap.debit, headerMap.net].every((value) => value === undefined)) {
    missing.push("amount/net/credit/debit");
  }
  if (missing.length) throw new Error(`Payoneer statement missing required column(s): ${missing.join(", ")}.`);
}

function normalizePayoneerHeader(value) {
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

function parsePayoneerAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: 0, hasValue: false };
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  let cleaned = raw
    .replace(/[()\sA-Z$€£₴₽]/gi, "")
    .replace(/[^\d,.-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(",", ".");
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { value: 0, hasValue: false };
  return { value: negative ? -Math.abs(parsed) : parsed, hasValue: true };
}

function normalizePayoneerCurrency(value, fallbackText = "") {
  const raw = String(value || "").trim().toUpperCase();
  const text = `${raw} ${fallbackText}`.toUpperCase();
  const match = text.match(/\b(USD|EUR|GBP|CAD)\b/);
  if (match) return match[1];
  if (/[€]/.test(text)) return "EUR";
  if (/[£]/.test(text)) return "GBP";
  if (/\bC\$/.test(text)) return "CAD";
  if (/[$]/.test(text)) return "USD";
  return raw;
}

function inferPayoneerDirection({ netValue = 0, amountValue = 0, creditValue = 0, debitValue = 0, description = "" } = {}) {
  if (netValue < 0) return "expense";
  if (netValue > 0) return "income";
  if (creditValue > 0) return "income";
  if (debitValue > 0) return "expense";
  if (amountValue < 0) return "expense";
  const text = String(description || "").toLowerCase();
  if (/\b(withdrawal|card|payout|paid out|debit|fee|charge|payment to)\b/.test(text)) return "expense";
  return "income";
}

function normalizePayoneerSourceTransactionId(value, fallback = {}) {
  const raw = String(value || "").trim();
  if (raw) return raw;
  return `payoneer-${fallback.date || "date"}-${fallback.currency || "currency"}-${fallback.amount || "amount"}-${fallback.index || 0}`;
}

function getPayoneerChannel(currency) {
  return PAYONEER_CHANNEL_BY_CURRENCY[String(currency || "").trim().toUpperCase()] || "";
}

function compactPayoneerDescription(parts = []) {
  return parts.map((value) => String(value || "").trim()).filter(Boolean).join(" | ").slice(0, 240);
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function addPayoneerSummaryAmount(lookup, currency, direction, amount) {
  if (!lookup.has(currency)) lookup.set(currency, { income: 0, expense: 0, net: 0 });
  const totals = lookup.get(currency);
  if (direction === "income") {
    totals.income += amount;
    totals.net += amount;
  } else {
    totals.expense += amount;
    totals.net -= amount;
  }
}

function serializePayoneerCurrencyTotals(lookup) {
  return Object.fromEntries(
    Array.from(lookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => [
        currency,
        {
          income: roundPayoneerAmount(totals.income),
          expense: roundPayoneerAmount(totals.expense),
          net: roundPayoneerAmount(totals.net),
        },
      ])
  );
}

function roundPayoneerAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
