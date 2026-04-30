const PRIVATBANK_CHANNEL_BY_CURRENCY = {
  USD: "приват 24-дол",
  EUR: "приват 24-евро",
  UAH: "приват 24-грн"
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
    const result = await fetchPrivatBankStatementEntries({
      startDate: payload.startDate,
      endDate: payload.endDate,
      apiToken: process.env.PRIVATBANK_API_TOKEN,
      accountId: process.env.PRIVATBANK_ACCOUNT_ID,
      baseUrl: process.env.PRIVATBANK_STATEMENT_URL,
      fetchImpl: fetch
    });
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    return response.status(400).json({ ok: false, error: String(error?.message || error) });
  }
}

export async function fetchPrivatBankStatementEntries(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const baseUrl = String(options.baseUrl || "").trim();
  const apiToken = String(options.apiToken || "").trim();
  if (!baseUrl) throw new Error("PrivatBank statement endpoint is not configured. Set PRIVATBANK_STATEMENT_URL.");
  if (!apiToken) throw new Error("PrivatBank credentials are not configured. Set PRIVATBANK_API_TOKEN.");
  const accountId = String(options.accountId || "").trim();
  const url = new URL(baseUrl);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  if (accountId) url.searchParams.set("account", accountId);
  const upstream = await (options.fetchImpl || fetch)(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Token: apiToken,
      Accept: "application/json"
    }
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    throw new Error(payload?.error || payload?.message || `PrivatBank request failed (${upstream.status}).`);
  }
  const rows = extractPrivatBankRows(payload);
  const account = { accountId, currency: payload?.currency || payload?.account?.currency || "" };
  const entries = rows
    .map((row, index) => normalizePrivatBankStatementItem(row, account, index))
    .filter((entry) => entry.date && entry.channel && entry.localAmount > 0);
  return {
    entries,
    summary: summarizePrivatBankStatementEntries(entries),
    transactionCount: rows.length,
    periodStart: startDate,
    periodEnd: endDate,
    source: "privatbank",
    warnings: []
  };
}

export function normalizePrivatBankStatementItem(item, account = {}, index = 0) {
  const amount = parseBankNumber(firstNonEmpty(item?.amount, item?.sum, item?.value, item?.amt, item?.trantype === "D" ? item?.debit : item?.credit));
  const currency = normalizeCurrency(firstNonEmpty(item?.currency, item?.ccy, item?.currencyCode, account?.currency));
  const direction = inferPrivatBankDirection(item, amount);
  const signedAmount = direction === "expense" ? -Math.abs(amount) : Math.abs(amount);
  const date = normalizeBankDate(firstNonEmpty(item?.date, item?.operationDate, item?.trandate, item?.dat_od, item?.time));
  const counterpartyName = firstNonEmpty(item?.counterparty, item?.counterpartyName, item?.name, item?.contragentName, item?.AUT_MY_NAM, item?.description);
  const description = firstNonEmpty(item?.description, item?.purpose, item?.nazn, item?.paymentPurpose, item?.details, item?.info);
  const sourceId = firstNonEmpty(item?.id, item?.transactionId, item?.ref, item?.reference, item?.trn_id, item?.docNumber, `${account?.accountId || "account"}-${date}-${index}`);
  return {
    id: `privatbank-${sourceId}`,
    date,
    channel: getPrivatBankChannel(currency),
    direction,
    localAmount: Math.abs(signedAmount),
    currency,
    usdAmount: currency === "USD" ? Math.abs(signedAmount) : null,
    suggestedCategory: direction === "income" ? "serviceIncome" : inferBankExpenseCategory(item),
    organization: compactDescription([
      description,
      item?.purpose && item.purpose !== description ? item.purpose : "",
      account?.accountId ? `account ${account.accountId}` : ""
    ]),
    counterpartyName: String(counterpartyName || "").trim(),
    counterpartyEmail: "",
    counterpartyType: inferCounterpartyType(counterpartyName),
    counterpartyRole: direction === "income" ? "payer" : "payee",
    counterpartyLabel: `${direction === "income" ? "От" : "Кому"}: ${firstNonEmpty(counterpartyName, description, "Контрагент не определен")}`,
    counterIban: String(firstNonEmpty(item?.counterpartyIban, item?.iban, item?.contragentIban, item?.AUT_CNTR_ACC) || "").trim(),
    merchantName: String(counterpartyName || "").trim(),
    description: String(description || "").trim(),
    confidence: 0.85,
    source: "privatbank",
    sourceTransactionId: String(sourceId),
    feeAmount: Math.abs(parseBankNumber(firstNonEmpty(item?.fee, item?.commission))) || null,
    feeCurrency: currency,
    entryKind: "payment"
  };
}

export function summarizePrivatBankStatementEntries(entries = []) {
  return summarizeBankEntries(entries);
}

function extractPrivatBankRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["statements", "transactions", "items", "data", "rows"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.response?.data)) return payload.response.data;
  return [];
}

function inferPrivatBankDirection(item, amount) {
  const rawDirection = String(firstNonEmpty(item?.direction, item?.type, item?.trantype, item?.operationType) || "").trim().toLowerCase();
  if (/credit|income|in|c|приход|кредит/.test(rawDirection)) return "income";
  if (/debit|expense|out|d|расход|дебет/.test(rawDirection)) return "expense";
  return amount < 0 ? "expense" : "income";
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) throw new Error("Select a valid PrivatBank statement period.");
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  if (start > end) throw new Error("PrivatBank statement start date must be before end date.");
}

function normalizeBankDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 1000000000) {
    return new Date(numeric * (numeric > 9999999999 ? 1 : 1000)).toISOString().slice(0, 10);
  }
  return "";
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function parseUtcDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function parseBankNumber(value) {
  const raw = String(value || "0").replace(/\s+/g, "").replace(",", ".");
  return Number.parseFloat(raw) || 0;
}

function normalizeCurrency(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "980") return "UAH";
  if (raw === "840") return "USD";
  if (raw === "978") return "EUR";
  if (/UAH|ГРН/.test(raw)) return "UAH";
  if (/USD|ДОЛ/.test(raw)) return "USD";
  if (/EUR|ЕВР/.test(raw)) return "EUR";
  return "UAH";
}

function getPrivatBankChannel(currency) {
  return PRIVATBANK_CHANNEL_BY_CURRENCY[String(currency || "").toUpperCase()] || "приват 24-грн";
}

function inferBankExpenseCategory(item) {
  const text = normalizeLookupText([item?.description, item?.purpose, item?.mcc].filter(Boolean).join(" "));
  if (/курс|обуч|навч|учеб|school|study/.test(text)) return "study";
  if (/еда|food|продукт|кафе|coffee|restaurant|маркет/.test(text)) return "food";
  if (/кварт|аренд|rent|flat|house|дом/.test(text)) return "flat";
  if (/такси|hotel|flight|travel|поезд|билет/.test(text)) return "travel";
  if (/кино|бар|game|fun|развлеч/.test(text)) return "fun";
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
