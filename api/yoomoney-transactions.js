const YOOMONEY_BASE_URL = "https://yoomoney.ru";
const YOOMONEY_MAX_RANGE_DAYS = 366;
const YOOMONEY_PAGE_SIZE = 100;
const YOOMONEY_DEFAULT_CURRENCY = "RUB";
const YOOMONEY_CHANNEL_BY_CURRENCY = {
  RUB: "Яндекс руб",
  USD: "пейпал дол",
  EUR: "пейпал евр",
  CAD: "БАНК КАНАДА cad"
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const accessToken = await resolveYooMoneyAccessToken({
      authorizationCode: payload.authorizationCode,
      clientId: process.env.YOOMONEY_CLIENT_ID,
      clientSecret: process.env.YOOMONEY_CLIENT_SECRET,
      redirectUri: process.env.YOOMONEY_REDIRECT_URI,
      accessToken: process.env.YOOMONEY_ACCESS_TOKEN,
      baseUrl: process.env.YOOMONEY_API_BASE || YOOMONEY_BASE_URL,
      fetchImpl: fetch
    });
    const result = await fetchYooMoneyStatementEntries({
      startDate: payload.startDate,
      endDate: payload.endDate,
      accessToken,
      currency: process.env.YOOMONEY_CURRENCY || YOOMONEY_DEFAULT_CURRENCY,
      baseUrl: process.env.YOOMONEY_API_BASE || YOOMONEY_BASE_URL,
      fetchImpl: fetch
    });
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

export async function fetchYooMoneyStatementEntries(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const accessToken = String(options.accessToken || "").trim();
  if (!accessToken) throw new Error("YooMoney credentials are not configured. Set YOOMONEY_ACCESS_TOKEN.");

  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || YOOMONEY_BASE_URL).replace(/\/+$/, "");
  const currency = String(options.currency || YOOMONEY_DEFAULT_CURRENCY).trim().toUpperCase() || YOOMONEY_DEFAULT_CURRENCY;
  const operations = [];
  let nextRecord = "";
  let guard = 0;
  do {
    const payload = await fetchYooMoneyOperationHistory({
      fetchImpl,
      baseUrl,
      accessToken,
      startDate,
      endDate,
      startRecord: nextRecord
    });
    operations.push(...(Array.isArray(payload?.operations) ? payload.operations : []));
    nextRecord = String(payload?.next_record || "").trim();
    guard += 1;
  } while (nextRecord && guard < 100);

  const entries = operations
    .map((operation, index) => normalizeYooMoneyOperation(operation, { currency }, index))
    .filter((entry) => entry.date && entry.localAmount > 0);
  return {
    entries,
    summary: summarizeYooMoneyStatementEntries(entries),
    transactionCount: operations.length,
    periodStart: startDate,
    periodEnd: endDate,
    source: "yoomoney"
  };
}

async function fetchYooMoneyOperationHistory(options = {}) {
  const body = new URLSearchParams({
    type: "deposition payment",
    records: String(YOOMONEY_PAGE_SIZE),
    from: toYooMoneyDateTime(options.startDate, false),
    till: toYooMoneyDateTime(options.endDate, true)
  });
  if (options.startRecord) body.set("start_record", String(options.startRecord));

  const upstream = await options.fetchImpl(`${options.baseUrl}/api/operation-history`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || payload?.error) {
    throw new Error(payload?.error_description || payload?.error || `YooMoney operation-history request failed (${upstream.status}).`);
  }
  return payload || {};
}

export async function exchangeYooMoneyAuthorizationCode(options = {}) {
  const code = String(options.authorizationCode || "").trim();
  const clientId = String(options.clientId || "").trim();
  const redirectUri = String(options.redirectUri || "").trim();
  if (!code) throw new Error("YooMoney authorization code is missing.");
  if (!clientId || !redirectUri) {
    throw new Error("YooMoney OAuth is not configured. Set YOOMONEY_CLIENT_ID and YOOMONEY_REDIRECT_URI.");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });
  const clientSecret = String(options.clientSecret || "").trim();
  if (clientSecret) body.set("client_secret", clientSecret);
  const baseUrl = String(options.baseUrl || YOOMONEY_BASE_URL).replace(/\/+$/, "");
  const upstream = await (options.fetchImpl || fetch)(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `YooMoney token request failed (${upstream.status}).`);
  }
  return payload.access_token;
}

async function resolveYooMoneyAccessToken(options = {}) {
  const configured = String(options.accessToken || "").trim();
  if (configured) return configured;
  const code = String(options.authorizationCode || "").trim();
  if (code) return exchangeYooMoneyAuthorizationCode(options);
  throw new Error("YooMoney credentials are not configured. Set YOOMONEY_ACCESS_TOKEN, or provide authorizationCode with YOOMONEY_CLIENT_ID and YOOMONEY_REDIRECT_URI.");
}

export function normalizeYooMoneyOperation(operation = {}, options = {}, index = 0) {
  const currency = String(operation.currency || operation.amount_currency || options.currency || YOOMONEY_DEFAULT_CURRENCY).trim().toUpperCase();
  const amount = Math.abs(Number.parseFloat(String(operation.amount || operation.amount_due || "0").replace(",", "."))) || 0;
  const rawDirection = String(operation.direction || "").trim().toLowerCase();
  const rawType = String(operation.type || "").trim().toLowerCase();
  const direction = rawDirection === "in" || rawType === "deposition" || rawType.startsWith("incoming")
    ? "income"
    : "expense";
  const operationId = String(operation.operation_id || operation.operationId || "").trim();
  const counterparty = firstNonEmpty(
    operation.sender,
    operation.recipient,
    operation.title,
    operation.account,
    "Контрагент не определен"
  );
  const comment = firstNonEmpty(operation.comment, operation.message, operation.details, operation.label);
  const date = normalizeIsoDate(String(operation.datetime || operation.date || "").slice(0, 10));
  return {
    date,
    provider: "yoomoney",
    operation_id: operationId,
    direction,
    amount,
    currency,
    counterparty,
    comment,
    status: String(operation.status || "").trim(),
    raw: operation,
    id: `yoomoney-${operationId || index}`,
    channel: getYooMoneyChannel(currency),
    localAmount: amount,
    usdAmount: currency === "USD" ? amount : null,
    suggestedCategory: direction === "income" ? "serviceIncome" : "business",
    organization: compactDescription([operation.title, comment, operation.label]),
    counterpartyName: counterparty === "Контрагент не определен" ? "" : counterparty,
    counterpartyEmail: "",
    counterpartyType: "unknown",
    counterpartyRole: direction === "income" ? "sender" : "recipient",
    counterpartyLabel: `${direction === "income" ? "От" : "Кому"}: ${counterparty}`,
    confidence: 0.9,
    source: "yoomoney",
    sourceTransactionId: operationId
  };
}

export function summarizeYooMoneyStatementEntries(entries = []) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIsoDate(entry?.date);
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Math.abs(Number(entry?.amount || entry?.localAmount || 0));
    if (!date || !currency || !amount) return;
    const month = date.slice(0, 7);
    if (!monthLookup.has(month)) monthLookup.set(month, new Map());
    addYooMoneySummaryAmount(monthLookup.get(month), currency, entry.direction, amount);
    addYooMoneySummaryAmount(totalLookup, currency, entry.direction, amount);
  });
  return {
    months: Array.from(monthLookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, currencyLookup]) => ({
        month,
        totalsByCurrency: serializeYooMoneyCurrencyTotals(currencyLookup)
      })),
    totalsByCurrency: serializeYooMoneyCurrencyTotals(totalLookup)
  };
}

function addYooMoneySummaryAmount(lookup, currency, direction, amount) {
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

function serializeYooMoneyCurrencyTotals(lookup) {
  return Object.fromEntries(
    Array.from(lookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => [
        currency,
        {
          income: roundYooMoneyAmount(totals.income),
          expense: roundYooMoneyAmount(totals.expense),
          net: roundYooMoneyAmount(totals.net)
        }
      ])
  );
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) throw new Error("Select a valid YooMoney statement period.");
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  if (start > end) throw new Error("YooMoney statement start date must be before end date.");
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days > YOOMONEY_MAX_RANGE_DAYS) throw new Error(`YooMoney statement period is too large. Maximum is ${YOOMONEY_MAX_RANGE_DAYS} days.`);
}

function toYooMoneyDateTime(date, endOfDay) {
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function parseUtcDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function getYooMoneyChannel(currency) {
  return YOOMONEY_CHANNEL_BY_CURRENCY[String(currency || "").toUpperCase()] || "Яндекс руб";
}

function roundYooMoneyAmount(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function compactDescription(parts) {
  const seen = new Set();
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" | ")
    .slice(0, 240);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}
