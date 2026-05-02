import { normalizeManualLedgerCategory } from "../server/manual-ledger-maps.js";

const WISE_LIVE_BASE = "https://api.wise.com";
const WISE_MAX_RANGE_DAYS = 469;
const WISE_CHANNEL_BY_CURRENCY = {
  USD: "трансервайз дол",
  EUR: "трансервайз евро"
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
    const result = await fetchWiseStatementEntries({
      startDate: payload.startDate,
      endDate: payload.endDate,
      apiToken: process.env.WISE_API_TOKEN,
      profileId: process.env.WISE_PROFILE_ID,
      baseUrl: process.env.WISE_API_BASE || WISE_LIVE_BASE,
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

export async function fetchWiseStatementEntries(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const apiToken = String(options.apiToken || "").trim();
  if (!apiToken) throw new Error("Wise credentials are not configured. Set WISE_API_TOKEN.");
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || WISE_LIVE_BASE).replace(/\/+$/, "");
  const profileId = await resolveWiseProfileId({ fetchImpl, baseUrl, apiToken, profileId: options.profileId });
  const balances = await fetchWiseJson({ fetchImpl, baseUrl, apiToken, path: `/v4/profiles/${profileId}/balances`, query: { types: "STANDARD,SAVINGS" } });
  const statementPayloads = await Promise.all(
    (Array.isArray(balances) ? balances : [])
      .filter((balance) => balance?.id && balance?.currency)
      .map(async (balance) => {
        try {
          const statement = await fetchWiseJson({
            fetchImpl,
            baseUrl,
            apiToken,
            path: `/v1/profiles/${profileId}/balance-statements/${balance.id}/statement.json`,
            query: {
              currency: balance.currency,
              intervalStart: toWiseDateTime(startDate, false),
              intervalEnd: toWiseDateTime(endDate, true),
              type: "COMPACT"
            }
          });
          return { balance, transactions: Array.isArray(statement?.transactions) ? statement.transactions : [], error: "" };
        } catch (error) {
          return { balance, transactions: [], error: error.message || "Wise statement request failed." };
        }
      })
  );
  const entries = statementPayloads.flatMap(({ balance, transactions }) =>
    transactions.map((transaction, index) => normalizeWiseTransaction(transaction, balance, profileId, index))
  ).filter((entry) => entry.date && entry.channel && entry.localAmount > 0);
  const warnings = statementPayloads
    .filter((payload) => payload.error)
    .map((payload) => `${payload.balance?.currency || payload.balance?.id}: ${payload.error}`);
  return {
    entries,
    summary: summarizeWiseStatementEntries(entries),
    transactionCount: statementPayloads.reduce((sum, payload) => sum + payload.transactions.length, 0),
    periodStart: startDate,
    periodEnd: endDate,
    source: "wise",
    warnings
  };
}

async function resolveWiseProfileId(options) {
  const profiles = await fetchWiseJson({ ...options, path: "/v2/profiles" });
  const requested = String(options.profileId || "").trim();
  if (requested) {
    const match = (Array.isArray(profiles) ? profiles : []).find((profile) => String(profile?.id) === requested);
    if (!match) throw new Error(`Wise profile ${requested} was not found for this token.`);
    return requested;
  }
  const firstProfile = (Array.isArray(profiles) ? profiles : []).find((profile) => profile?.id);
  if (!firstProfile) throw new Error("Wise token has no accessible profiles.");
  return String(firstProfile.id);
}

async function fetchWiseJson(options) {
  const url = new URL(options.path, options.baseUrl);
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const upstream = await options.fetchImpl(url.toString(), {
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      Accept: "application/json"
    }
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    throw new Error(payload?.error || payload?.message || `Wise request failed (${upstream.status}).`);
  }
  return payload;
}

export function normalizeWiseTransaction(transaction, balance, profileId, index = 0) {
  const amount = normalizeWiseMoney(transaction?.amount);
  const fee = normalizeWiseMoney(transaction?.totalFees);
  const details = transaction?.details || {};
  const explicitUsdAmount = normalizeWiseOptionalNumber(
    transaction?.usdAmount ?? transaction?.amountUsd ?? transaction?.amount_usd ?? details?.usdAmount ?? details?.amountUsd ?? details?.amount_usd
  );
  const date = normalizeIsoDate(String(transaction?.date || "").slice(0, 10));
  const reference = String(transaction?.referenceNumber || "").trim();
  const direction = String(transaction?.type || "").toUpperCase() === "CREDIT" ? "income" : "expense";
  const counterparty = buildWiseCounterparty(transaction, direction);
  return {
    id: `wise-${reference || balance?.id || index}`,
    date,
    channel: getWiseChannel(amount.currency || balance?.currency),
    direction,
    localAmount: Math.abs(amount.value),
    currency: amount.currency || String(balance?.currency || "").toUpperCase(),
    usdAmount: explicitUsdAmount !== null
      ? Math.abs(explicitUsdAmount)
      : ((amount.currency || balance?.currency) === "USD" ? Math.abs(amount.value) : null),
    suggestedCategory: normalizeManualLedgerCategory(direction === "income" ? "serviceIncome" : "business", "business"),
    organization: buildWiseDescription(transaction, balance, profileId),
    ...counterparty,
    confidence: 0.95,
    source: "wise",
    sourceTransactionId: reference || `${balance?.id || "balance"}-${date}-${index}`,
    feeAmount: Math.abs(fee.value) || null,
    feeCurrency: fee.currency || ""
  };
}

export function summarizeWiseStatementEntries(entries = []) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIsoDate(entry?.date);
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Math.abs(Number(entry?.localAmount || 0));
    if (!date || !currency || !amount) return;
    const month = date.slice(0, 7);
    if (!monthLookup.has(month)) monthLookup.set(month, new Map());
    addWiseSummaryAmount(monthLookup.get(month), currency, entry.direction, amount);
    addWiseSummaryAmount(totalLookup, currency, entry.direction, amount);
  });
  return {
    months: Array.from(monthLookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, currencyLookup]) => ({
        month,
        totalsByCurrency: serializeWiseCurrencyTotals(currencyLookup)
      })),
    totalsByCurrency: serializeWiseCurrencyTotals(totalLookup)
  };
}

function addWiseSummaryAmount(lookup, currency, direction, amount) {
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

function serializeWiseCurrencyTotals(lookup) {
  return Object.fromEntries(
    Array.from(lookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => [
        currency,
        {
          income: roundWiseAmount(totals.income),
          expense: roundWiseAmount(totals.expense),
          net: roundWiseAmount(totals.net)
        }
      ])
  );
}

function buildWiseDescription(transaction, balance, profileId) {
  const details = transaction?.details || {};
  return compactDescription([
    details.description,
    details.type,
    transaction?.referenceNumber ? `reference ${transaction.referenceNumber}` : "",
    balance?.currency ? `balance ${balance.currency}` : "",
    profileId ? `profile ${profileId}` : ""
  ]);
}

function buildWiseCounterparty(transaction, direction) {
  const details = transaction?.details || {};
  const description = String(details.description || "").trim();
  const merchantName = extractWiseMerchantName(description);
  const referenceNumber = String(transaction?.referenceNumber || "").trim();
  const fallback = firstNonEmpty(description, referenceNumber, "Контрагент не определен");
  return {
    counterpartyName: merchantName,
    counterpartyEmail: "",
    counterpartyType: merchantName ? "company" : "unknown",
    counterpartyRole: merchantName ? "merchant" : "unknown",
    counterpartyLabel: `${direction === "income" ? "От" : "Кому"}: ${firstNonEmpty(merchantName, fallback)}`,
    merchantName,
    description,
    referenceNumber,
    transferType: String(details.type || "").trim()
  };
}

function extractWiseMerchantName(description) {
  const text = String(description || "").trim();
  if (!text) return "";
  const patterns = [
    /\b(?:card payment to|payment to|sent to|transfer to)\s+(.+)$/i,
    /\b(?:received from|transfer from)\s+(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    return String(match[1] || "").trim();
  }
  return "";
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

function normalizeWiseMoney(value) {
  return {
    value: Number.parseFloat(String(value?.value || value?.amount || "0").replace(",", ".")) || 0,
    currency: String(value?.currency_code || value?.currency || "").trim().toUpperCase()
  };
}

function normalizeWiseOptionalNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const numeric = Number.parseFloat(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function getWiseChannel(currency) {
  return WISE_CHANNEL_BY_CURRENCY[String(currency || "").toUpperCase()] || "трансервайз дол";
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) throw new Error("Select a valid Wise statement period.");
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  if (start > end) throw new Error("Wise statement start date must be before end date.");
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days > WISE_MAX_RANGE_DAYS) throw new Error(`Wise statement period is too large. Maximum is ${WISE_MAX_RANGE_DAYS} days.`);
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function parseUtcDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function toWiseDateTime(date, endOfDay) {
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}.000Z`;
}

function roundWiseAmount(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}
