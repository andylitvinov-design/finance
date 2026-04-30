const MONOBANK_LIVE_BASE = "https://api.monobank.ua";
const MONOBANK_MAX_RANGE_DAYS = 31;
const MONOBANK_CHANNEL_BY_CURRENCY = {
  UAH: "монобанк грн"
};
const MONOBANK_CURRENCY_BY_CODE = {
  124: "CAD",
  840: "USD",
  978: "EUR",
  980: "UAH"
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const result = await fetchMonobankStatementEntries({
      startDate: payload.startDate,
      endDate: payload.endDate,
      apiToken: process.env.MONOBANK_API_TOKEN,
      accountId: process.env.MONOBANK_ACCOUNT_ID,
      baseUrl: process.env.MONOBANK_API_BASE || MONOBANK_LIVE_BASE,
      fetchImpl: fetch
    });
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    return response.status(400).json({ ok: false, error: String(error?.message || error) });
  }
}

export async function fetchMonobankStatementEntries(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const apiToken = String(options.apiToken || "").trim();
  if (!apiToken) throw new Error("Monobank credentials are not configured. Set MONOBANK_API_TOKEN.");
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || MONOBANK_LIVE_BASE).replace(/\/+$/, "");
  const clientInfo = await fetchMonobankJson({ fetchImpl, baseUrl, apiToken, path: "/personal/client-info" });
  const accounts = resolveMonobankAccounts(clientInfo, options.accountId);
  const from = toUnixSeconds(startDate, false);
  const to = toUnixSeconds(endDate, true);
  const statementPayloads = await Promise.all(accounts.map(async (account) => {
    const rows = await fetchMonobankJson({
      fetchImpl,
      baseUrl,
      apiToken,
      path: `/personal/statement/${encodeURIComponent(account.id)}/${from}/${to}`
    });
    return { account, rows: Array.isArray(rows) ? rows : [] };
  }));
  const entries = statementPayloads
    .flatMap(({ account, rows }) => rows.map((row, index) => normalizeMonobankStatementItem(row, account, index)))
    .filter((entry) => entry.date && entry.channel && entry.localAmount > 0);
  return {
    entries,
    summary: summarizeMonobankStatementEntries(entries),
    transactionCount: statementPayloads.reduce((sum, payload) => sum + payload.rows.length, 0),
    periodStart: startDate,
    periodEnd: endDate,
    source: "monobank",
    warnings: []
  };
}

async function fetchMonobankJson(options) {
  const upstream = await options.fetchImpl(`${options.baseUrl}${options.path}`, {
    headers: {
      "X-Token": options.apiToken,
      Accept: "application/json"
    }
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    throw new Error(payload?.errorDescription || payload?.error || payload?.message || `Monobank request failed (${upstream.status}).`);
  }
  return payload;
}

function resolveMonobankAccounts(clientInfo, requestedAccountId) {
  const requested = String(requestedAccountId || "").trim();
  const ownAccounts = Array.isArray(clientInfo?.accounts) ? clientInfo.accounts : [];
  const jars = Array.isArray(clientInfo?.jars) ? clientInfo.jars : [];
  const managedAccounts = (Array.isArray(clientInfo?.managedClients) ? clientInfo.managedClients : [])
    .flatMap((client) => Array.isArray(client?.accounts) ? client.accounts : []);
  const accounts = [...ownAccounts, ...jars, ...managedAccounts].filter((account) => account?.id);
  const filtered = requested ? accounts.filter((account) => String(account.id) === requested) : accounts;
  if (requested && !filtered.length) throw new Error(`Monobank account ${requested} was not found for this token.`);
  if (filtered.length) return filtered;
  return [{ id: requested || "0", currencyCode: 980, type: "default" }];
}

export function normalizeMonobankStatementItem(item, account = {}, index = 0) {
  const amount = centsToMajor(item?.amount);
  const currency = currencyByCode(item?.currencyCode || account?.currencyCode);
  const direction = amount < 0 ? "expense" : "income";
  const date = item?.time ? new Date(Number(item.time) * 1000).toISOString().slice(0, 10) : "";
  const counterparty = buildMonobankCounterparty(item, direction);
  return {
    id: `monobank-${item?.id || account?.id || index}`,
    date,
    channel: getMonobankChannel(currency),
    direction,
    localAmount: Math.abs(amount),
    currency,
    usdAmount: currency === "USD" ? Math.abs(amount) : null,
    suggestedCategory: direction === "income" ? "serviceIncome" : inferBankExpenseCategory(item),
    organization: buildMonobankDescription(item, account),
    ...counterparty,
    confidence: 0.9,
    source: "monobank",
    sourceTransactionId: String(item?.id || `${account?.id || "account"}-${item?.time || index}`),
    feeAmount: Math.abs(centsToMajor(item?.commissionRate)) || null,
    feeCurrency: currency,
    mcc: String(item?.mcc || item?.originalMcc || "").trim(),
    receiptId: String(item?.receiptId || "").trim(),
    invoiceId: String(item?.invoiceId || "").trim(),
    entryKind: "payment"
  };
}

function buildMonobankDescription(item, account) {
  return compactDescription([
    item?.description,
    item?.comment,
    item?.mcc ? `mcc ${item.mcc}` : "",
    account?.type || account?.maskedPan ? `account ${account.type || ""} ${maskTail(account.maskedPan)}` : ""
  ]);
}

function buildMonobankCounterparty(item, direction) {
  const name = firstNonEmpty(item?.counterName, item?.description, item?.comment, "Контрагент не определен");
  return {
    counterpartyName: String(item?.counterName || "").trim(),
    counterpartyEmail: "",
    counterpartyType: inferCounterpartyType(name),
    counterpartyRole: direction === "income" ? "payer" : "payee",
    counterpartyLabel: `${direction === "income" ? "От" : "Кому"}: ${name}`,
    counterIban: String(item?.counterIban || "").trim(),
    counterEdrpou: String(item?.counterEdrpou || "").trim(),
    merchantName: String(item?.counterName || "").trim(),
    description: String(item?.description || "").trim()
  };
}

export function summarizeMonobankStatementEntries(entries = []) {
  return summarizeBankEntries(entries);
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) throw new Error("Select a valid Monobank statement period.");
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  if (start > end) throw new Error("Monobank statement start date must be before end date.");
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days > MONOBANK_MAX_RANGE_DAYS) throw new Error(`Monobank statement period is too large. Maximum is ${MONOBANK_MAX_RANGE_DAYS} days.`);
}

function getMonobankChannel(currency) {
  return MONOBANK_CHANNEL_BY_CURRENCY[String(currency || "").toUpperCase()] || "монобанк грн";
}

function centsToMajor(value) {
  return Math.round((Number(value || 0) / 100) * 10000) / 10000;
}

function currencyByCode(code) {
  return MONOBANK_CURRENCY_BY_CODE[Number(code)] || "UAH";
}

function toUnixSeconds(date, endOfDay) {
  return Math.floor(new Date(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`).getTime() / 1000);
}

function parseUtcDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function maskTail(maskedPan) {
  const raw = Array.isArray(maskedPan) ? String(maskedPan[0] || "") : String(maskedPan || "");
  const tail = raw.match(/(\d{4})$/)?.[1] || "";
  return tail ? `****${tail}` : "";
}

function inferBankExpenseCategory(item) {
  const text = normalizeLookupText([item?.description, item?.comment, item?.mcc].filter(Boolean).join(" "));
  if (/курс|обуч|навч|учеб|school|study|8299/.test(text)) return "study";
  if (/еда|food|продукт|кафе|coffee|restaurant|маркет|5411|5812|5814/.test(text)) return "food";
  if (/кварт|аренд|rent|flat|house|дом/.test(text)) return "flat";
  if (/такси|hotel|flight|travel|поезд|билет|4111|4121|4511|4722/.test(text)) return "travel";
  if (/кино|бар|game|fun|развлеч|799/.test(text)) return "fun";
  return "business";
}

function summarizeBankEntries(entries) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIsoDate(entry?.date);
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Math.abs(Number(entry?.localAmount || 0));
    if (!date || !currency || !amount) return;
    const month = date.slice(0, 7);
    if (!monthLookup.has(month)) monthLookup.set(month, new Map());
    addSummaryAmount(monthLookup.get(month), currency, entry.direction, amount);
    addSummaryAmount(totalLookup, currency, entry.direction, amount);
  });
  return {
    months: Array.from(monthLookup.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([month, totals]) => ({
      month,
      totalsByCurrency: serializeSummary(totals)
    })),
    totalsByCurrency: serializeSummary(totalLookup)
  };
}

function addSummaryAmount(lookup, currency, direction, amount) {
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

function serializeSummary(lookup) {
  return Object.fromEntries(Array.from(lookup.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([currency, totals]) => [
    currency,
    {
      income: roundAmount(totals.income),
      expense: roundAmount(totals.expense),
      net: roundAmount(totals.net)
    }
  ]));
}

function compactDescription(parts) {
  const seen = new Set();
  return parts.map((part) => String(part || "").trim()).filter(Boolean).filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" | ").slice(0, 240);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function inferCounterpartyType(value) {
  return /тов|фоп|llc|inc|ltd|corp|company/i.test(String(value || "")) ? "company" : "unknown";
}

function normalizeLookupText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-яіїєґ]+/g, " ").replace(/\s+/g, " ").trim();
}

function roundAmount(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}
