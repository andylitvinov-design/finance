import { normalizeManualLedgerCategory } from "../server/manual-ledger-maps.js";
import {
  buildProviderImportCoverage,
  detectPossibleFeeDoubleCount,
  detectProviderDuplicateRows
} from "../server/provider-import-diagnostics.js";

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
  const rawBalances = await fetchWiseBalances({ fetchImpl, baseUrl, apiToken, resolvedProfileId: profileId });
  const statementPayloads = await Promise.all(
    (Array.isArray(rawBalances) ? rawBalances : [])
      .filter((balance) => balance?.balanceId && balance?.currency)
      .map(async (balance) => {
        try {
          const statement = await fetchWiseJson({
            fetchImpl,
            baseUrl,
            apiToken,
            path: `/v1/profiles/${profileId}/balance-statements/${balance.balanceId}/statement.json`,
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
  const rawTransactions = statementPayloads.flatMap(({ transactions }) => transactions);
  const normalizedEntries = statementPayloads.flatMap(({ balance, transactions }) =>
    transactions.map((transaction, index) => normalizeWiseTransaction(transaction, balance, profileId, index))
  );
  const entries = normalizedEntries.filter((entry) => entry.date && entry.channel && entry.localAmount > 0);
  const warnings = statementPayloads
    .filter((payload) => payload.error)
    .map((payload) => `${payload.balance?.currency || payload.balance?.id}: ${payload.error}`);
  const diagnostics = buildWiseImportDiagnostics({
    rawTransactions,
    normalizedEntries,
    entries,
    warnings,
    periodStart: startDate,
    periodEnd: endDate
  });
  return {
    entries,
    balances: rawBalances,
    summary: summarizeWiseStatementEntries(entries),
    transactionCount: statementPayloads.reduce((sum, payload) => sum + payload.transactions.length, 0),
    periodStart: startDate,
    periodEnd: endDate,
    source: "wise",
    diagnostics,
    warnings: Array.from(new Set([...warnings, ...diagnostics.warnings]))
  };
}

export async function fetchWiseBalances(options = {}) {
  const apiToken = String(options.apiToken || "").trim();
  if (!apiToken) throw new Error("Wise credentials are not configured. Set WISE_API_TOKEN.");
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || WISE_LIVE_BASE).replace(/\/+$/, "");
  const profileId = String(options.resolvedProfileId || "").trim() || await resolveWiseProfileId({
    fetchImpl,
    baseUrl,
    apiToken,
    profileId: options.profileId
  });
  const balances = await fetchWiseJson({
    fetchImpl,
    baseUrl,
    apiToken,
    path: `/v4/profiles/${profileId}/balances`,
    query: { types: "STANDARD,SAVINGS" }
  });
  return (Array.isArray(balances) ? balances : [])
    .map((balance) => normalizeWiseBalance(balance))
    .filter((balance) => balance.balanceId && balance.currency && balance.channel);
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
  const localAmount = extractWiseCardLocalAmount(transaction, amount);
  const explicitUsdAmount = parseExplicitWiseUsdAmount(transaction);
  const fee = normalizeWiseMoney(transaction?.totalFees);
  const dateInfo = selectWiseTransactionDates(transaction);
  const reference = String(transaction?.referenceNumber || "").trim();
  const direction = resolveWiseTransactionDirection(transaction, amount);
  const counterparty = buildWiseCounterparty(transaction, direction);
  const accountCurrency = amount.currency || String(balance?.currency || "").toUpperCase();
  const accountAmount = Math.abs(amount.value);
  const accountUsdAmount = explicitUsdAmount ?? (accountCurrency === "USD" ? accountAmount : null);
  const sourceTransactionId = buildWiseSourceTransactionId({ transaction, balance, dateInfo, index });
  const organization = buildWiseDescription(transaction, balance, profileId);
  return {
    id: `wise-${sourceTransactionId}`,
    date: dateInfo.operationDate || dateInfo.postedDate,
    operationDate: dateInfo.operationDate,
    postedDate: dateInfo.postedDate,
    channel: getWiseChannel(accountCurrency),
    direction,
    localAmount: Math.abs(localAmount.value || accountAmount),
    localCurrency: localAmount.currency || accountCurrency,
    accountAmount,
    currency: accountCurrency,
    usdAmount: accountUsdAmount,
    amountNet: accountAmount,
    netAmount: accountAmount,
    amountGross: accountAmount,
    amount_gross: accountAmount,
    amountFee: Math.abs(fee.value) || null,
    amount_fee: Math.abs(fee.value) || null,
    amount_net: accountAmount,
    suggestedCategory: normalizeManualLedgerCategory(direction === "income" ? "serviceIncome" : "business", "business"),
    organization,
    ...counterparty,
    confidence: 0.95,
    source: "wise",
    provider: "wise",
    sourceTransactionId,
    rawSourceId: sourceTransactionId,
    raw_source_id: sourceTransactionId,
    externalId: sourceTransactionId,
    external_id: sourceTransactionId,
    feeAmount: Math.abs(fee.value) || null,
    feeCurrency: fee.currency || "",
    comment: organization
  };
}

export function buildWiseImportDiagnostics(options = {}) {
  const rawTransactions = Array.isArray(options.rawTransactions) ? options.rawTransactions : [];
  const normalizedEntries = Array.isArray(options.normalizedEntries) ? options.normalizedEntries : [];
  const entries = Array.isArray(options.entries) ? options.entries : [];
  const skippedRows = normalizedEntries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry?.date || !entry?.channel || !(Number(entry?.localAmount) > 0));
  const diagnosticRows = entries.map((entry) => ({
    provider: "wise",
    source: "wise",
    raw_source_id: entry.raw_source_id || entry.rawSourceId || entry.sourceTransactionId,
    date: entry.date,
    from_channel: entry.direction === "income" ? "" : entry.channel,
    to_channel: entry.direction === "income" ? entry.channel : "",
    channel: entry.channel,
    direction: entry.direction === "income" ? "in" : "out",
    amount: entry.accountAmount || entry.amountNet || entry.netAmount || entry.localAmount,
    amount_net: entry.amountNet || entry.netAmount,
    currency: entry.currency,
    counterparty: entry.counterpartyName || entry.merchantName || entry.description,
    description: entry.description
  }));
  const duplicateRows = detectProviderDuplicateRows(diagnosticRows);
  const feeDoubleCount = detectPossibleFeeDoubleCount(diagnosticRows);
  const needsReviewRows = diagnosticRows.filter((row) => {
    const rawId = String(row.raw_source_id || "").trim();
    const amountNet = Number(row.amount_net);
    return !rawId || !Number.isFinite(amountNet) || amountNet <= 0 || !["in", "out"].includes(row.direction);
  });
  const parserWarnings = [
    ...(Array.isArray(options.warnings) ? options.warnings : []),
    ...skippedRows.map(({ index }) => `Wise warning: transaction ${index + 1} was skipped by normalization filter.`),
    ...duplicateRows.map((row) => `Wise warning: duplicate raw_source_id ${row.key}.`),
    ...(feeDoubleCount.likely_fee_double_count ? ["Wise warning: possible fee double-count candidate detected."] : []),
    ...needsReviewRows.map((row) => `Wise warning: row ${row.raw_source_id || row.date || "unknown"} needs review before ledger save.`)
  ];
  const coverage = buildProviderImportCoverage({
    provider: "wise",
    source: "wise",
    inputRows: rawTransactions,
    parsedRows: normalizedEntries,
    ledgerRows: entries,
    skippedRows,
    duplicateRows,
    needsReviewRows,
    parserWarnings,
    periodFrom: options.periodStart,
    periodTo: options.periodEnd
  });
  return {
    coverage,
    duplicate_rows: duplicateRows,
    fee_double_count: feeDoubleCount,
    needs_review_rows: needsReviewRows,
    warnings: coverage.parser_warnings
  };
}

function buildWiseSourceTransactionId({ transaction, balance, dateInfo, index }) {
  const reference = String(transaction?.referenceNumber || transaction?.id || transaction?.transactionId || "").trim();
  if (reference) return reference;
  const balanceId = String(balance?.balanceId || balance?.id || balance?.currency || "balance").trim();
  const date = dateInfo?.operationDate || dateInfo?.postedDate || normalizeWiseDate(transaction?.date) || "unknown-date";
  const amount = normalizeWiseMoney(transaction?.amount);
  const amountPart = `${amount.value || 0}-${amount.currency || ""}`;
  return `${balanceId}-${date}-${amountPart}-${index}`;
}

function resolveWiseTransactionDirection(transaction = {}, amount = {}) {
  if (isWiseCardTransaction(transaction)) {
    if (hasWiseRefundMarker(transaction)) return "income";
    const numericAmount = Number(amount?.value || 0);
    const transactionType = String(transaction?.type || "").trim().toUpperCase();
    if (transactionType === "CREDIT" && numericAmount > 0 && !hasWiseOrdinaryCardPurchaseMarker(transaction)) {
      return "income";
    }
    return "expense";
  }

  const numericAmount = Number(amount?.value || 0);
  if (numericAmount > 0) return "income";
  if (numericAmount < 0) return "expense";

  const transactionType = String(transaction?.type || "").trim().toUpperCase();
  return transactionType === "CREDIT" ? "income" : "expense";
}

function isWiseCardTransaction(transaction = {}) {
  const details = transaction?.details || {};
  const type = String(details.type || transaction?.type || "").trim().toUpperCase();
  const reference = String(transaction?.referenceNumber || "").trim().toUpperCase();
  const description = String(details.description || "").trim().toLowerCase();
  return type === "CARD" || reference.startsWith("CARD-") || /\bcard (transaction|payment)\b/.test(description);
}

function hasWiseRefundMarker(transaction = {}) {
  const details = transaction?.details || {};
  const candidates = [
    transaction?.type,
    transaction?.referenceNumber,
    details.type,
    details.description,
    details.category,
    details.status
  ].map((value) => String(value || "").trim().toLowerCase());
  return candidates.some((text) => /\b(refund|refunded|reversal|reversed|chargeback)\b/.test(text));
}

function hasWiseOrdinaryCardPurchaseMarker(transaction = {}) {
  const details = transaction?.details || {};
  const description = String(details.description || "").trim().toLowerCase();
  return /\b(card transaction at|card payment to|payment to|purchase at|paid at)\b/.test(description);
}

export function summarizeWiseStatementEntries(entries = []) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIsoDate(entry?.date);
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Math.abs(Number(entry?.accountAmount || entry?.amountNet || entry?.netAmount || entry?.localAmount || 0));
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

function parseExplicitWiseUsdAmount(transaction) {
  const candidates = [
    transaction?.amountUsd,
    transaction?.amount_usd,
    transaction?.usdAmount
  ];
  for (const candidate of candidates) {
    const numeric = Number.parseFloat(String(candidate ?? "").replace(",", "."));
    if (Number.isFinite(numeric) && numeric !== 0) return Math.abs(numeric);
  }
  return null;
}

function selectWiseTransactionDates(transaction) {
  const details = transaction?.details || {};
  const operationDate = firstWiseIsoDate(
    transaction?.operationDate,
    transaction?.operation_date,
    transaction?.createdOn,
    transaction?.createdAt,
    transaction?.creationTime,
    details?.operationDate,
    details?.operation_date,
    details?.createdOn,
    details?.createdAt,
    details?.cardTransaction?.createdOn,
    details?.cardTransaction?.createdAt,
    details?.cardTransaction?.operationDate,
    transaction?.date
  );
  const postedDate = firstWiseIsoDate(
    transaction?.postedDate,
    transaction?.posted_date,
    transaction?.settlementDate,
    transaction?.settledAt,
    details?.postedDate,
    details?.posted_date,
    details?.settlementDate,
    details?.settledAt,
    transaction?.date
  );
  return { operationDate, postedDate };
}

function firstWiseIsoDate(...values) {
  for (const value of values) {
    const normalized = normalizeWiseDate(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeWiseDate(value) {
  if (!value) return "";
  const raw = String(value || "").trim();
  const iso = raw.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return "";
}

function extractWiseCardLocalAmount(transaction, accountAmount) {
  const candidates = [
    transaction?.sourceAmount,
    transaction?.source_amount,
    transaction?.targetAmount,
    transaction?.target_amount,
    transaction?.details?.sourceAmount,
    transaction?.details?.source_amount,
    transaction?.details?.targetAmount,
    transaction?.details?.target_amount,
    transaction?.details?.merchantAmount,
    transaction?.details?.merchant_amount,
    transaction?.details?.cardTransaction?.sourceAmount,
    transaction?.details?.cardTransaction?.targetAmount,
    transaction?.details?.cardTransaction?.merchantAmount
  ];
  for (const candidate of candidates) {
    const normalized = normalizeWiseMoney(candidate);
    if (normalized.value && normalized.currency) return normalized;
  }
  const descriptionAmount = parseWiseCardDescriptionAmount(transaction?.details?.description);
  if (descriptionAmount.value && descriptionAmount.currency) return descriptionAmount;
  return accountAmount;
}

function parseWiseCardDescriptionAmount(description) {
  const match = String(description || "").match(/\bcard transaction of\s+([+-]?\d+(?:[.,]\d+)?)\s+([A-Z]{3})\b/i);
  if (!match) return { value: 0, currency: "" };
  return {
    value: Number.parseFloat(String(match[1] || "0").replace(",", ".")) || 0,
    currency: String(match[2] || "").trim().toUpperCase()
  };
}

function normalizeWiseBalance(balance) {
  const amount = normalizeWiseMoney(
    balance?.cashAmount ||
    balance?.availableAmount ||
    balance?.amount ||
    balance?.reservedAmount ||
    balance
  );
  const currency = amount.currency || String(balance?.currency || "").trim().toUpperCase();
  const amountValue = Math.abs(amount.value);
  const explicitUsdAmount = extractWiseBalanceUsdAmount(balance, amountValue, currency);
  return {
    currency,
    amount: roundWiseAmount(amountValue),
    amountUsd: explicitUsdAmount === null ? "" : roundWiseAmount(explicitUsdAmount),
    balanceId: String(balance?.id || "").trim(),
    channel: getWiseChannel(currency)
  };
}

function extractWiseBalanceUsdAmount(balance, amountValue, currency) {
  if (currency === "USD") return amountValue;
  const candidates = [
    balance?.usdAmount,
    balance?.amountUsd,
    balance?.totalWorth,
    balance?.totalValue,
    balance?.availableAmountInHomeCurrency,
    balance?.convertedAmount
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeWiseMoney(candidate);
    if (normalized.currency === "USD" && normalized.value) return Math.abs(normalized.value);
  }
  return null;
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
