const MONOBANK_LIVE_BASE = "https://api.monobank.ua";
const MONOBANK_MAX_RANGE_DAYS = 31;
const MONOBANK_CHANNEL_BY_CURRENCY = {
  UAH: "монобанк грн"
};
const MONOBANK_PERMISSION_WARNING = "Monobank token/permission stale; upload screenshot or refresh token.";
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

  let requestToken = "";
  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    requestToken = String(payload.apiToken || "").trim();
    const action = normalizeMonobankAction(payload.action);
    const apiToken = resolveMonobankApiToken(payload.apiToken, process.env.MONOBANK_API_TOKEN);
    const baseUrl = String(payload.baseUrl || process.env.MONOBANK_API_BASE || MONOBANK_LIVE_BASE).replace(/\/+$/, "");

    if (action === "validate") {
      const result = await fetchMonobankClientInfo({
        apiToken,
        baseUrl,
        fetchImpl: fetch
      });
      return response.status(200).json({
        ok: true,
        valid: true,
        source: "monobank",
        mode: requestToken ? "manual" : "env",
        ...result
      });
    }

    const result = await fetchMonobankStatementEntries({
      startDate: payload.startDate,
      endDate: payload.endDate,
      apiToken,
      accountId: payload.accountId || process.env.MONOBANK_ACCOUNT_ID,
      baseUrl,
      fetchImpl: fetch
    });
    return response.status(200).json({ ok: true, mode: requestToken ? "manual" : "env", ...result });
  } catch (error) {
    return response.status(400).json(buildMonobankErrorPayload(error, requestToken));
  }
}

export async function fetchMonobankClientInfo(options = {}) {
  const apiToken = String(options.apiToken || "").trim();
  if (!apiToken) throw new Error("Monobank token is required.");
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || MONOBANK_LIVE_BASE).replace(/\/+$/, "");
  const rawClient = await fetchMonobankJson({ fetchImpl, baseUrl, apiToken, path: "/personal/client-info" });
  return {
    client: summarizeMonobankClient(rawClient),
    accounts: summarizeMonobankClientAccounts(rawClient),
    rawClient
  };
}

export async function fetchMonobankStatementEntries(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const apiToken = String(options.apiToken || "").trim();
  if (!apiToken) throw new Error("Monobank credentials are not configured. Set MONOBANK_API_TOKEN.");
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || MONOBANK_LIVE_BASE).replace(/\/+$/, "");
  const clientInfo = await fetchMonobankClientInfo({ fetchImpl, baseUrl, apiToken });
  const accounts = resolveMonobankAccounts(clientInfo.rawClient, options.accountId);
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
    accounts: clientInfo.accounts,
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
  const accounts = collectMonobankAccounts(clientInfo);
  const filtered = requested ? accounts.filter((account) => String(account.id) === requested) : accounts;
  if (requested && !filtered.length) throw new Error(`Monobank account ${requested} was not found for this token.`);
  if (filtered.length) return filtered;
  return [{ id: requested || "0", currencyCode: 980, type: "default" }];
}

function collectMonobankAccounts(clientInfo) {
  const ownAccounts = Array.isArray(clientInfo?.accounts) ? clientInfo.accounts : [];
  const jars = Array.isArray(clientInfo?.jars) ? clientInfo.jars : [];
  const managedAccounts = (Array.isArray(clientInfo?.managedClients) ? clientInfo.managedClients : [])
    .flatMap((client) => Array.isArray(client?.accounts) ? client.accounts : []);
  return [...ownAccounts, ...jars, ...managedAccounts].filter((account) => account?.id);
}

export function summarizeMonobankClientAccounts(clientInfo) {
  return collectMonobankAccounts(clientInfo).map((account) => {
    const currency = currencyByCode(account?.currencyCode);
    const type = String(account?.type || account?.sendId || "account").trim();
    const maskedPan = maskTail(account?.maskedPan);
    const maskedIban = maskIban(account?.iban);
    return {
      id: String(account?.id || "").trim(),
      currency,
      type,
      label: [currency, type, maskedPan || maskedIban].filter(Boolean).join(" ").trim(),
      maskedPan,
      maskedIban,
    };
  });
}

function summarizeMonobankClient(clientInfo) {
  return {
    name: String(clientInfo?.name || "").trim(),
    clientId: String(clientInfo?.clientId || "").trim(),
    accountCount: collectMonobankAccounts(clientInfo).length,
  };
}

export function normalizeMonobankStatementItem(item, account = {}, index = 0) {
  const amount = centsToMajor(item?.amount);
  const currency = currencyByCode(item?.currencyCode || account?.currencyCode);
  const date = item?.time ? new Date(Number(item.time) * 1000).toISOString().slice(0, 10) : "";
  const classification = classifyMonobankOperation(item, amount);
  const counterparty = buildMonobankCounterparty(item, classification.direction);
  return {
    id: `monobank-${item?.id || account?.id || index}`,
    date,
    channel: getMonobankChannel(currency),
    direction: classification.direction,
    localAmount: Math.abs(amount),
    currency,
    usdAmount: currency === "USD" ? Math.abs(amount) : null,
    suggestedCategory: classification.suggestedCategory,
    receivedType: classification.receivedType,
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
    entryKind: classification.entryKind,
    operationType: classification.operationType
  };
}

function classifyMonobankOperation(item, amount) {
  const text = normalizeLookupText([
    item?.description,
    item?.comment,
    item?.counterName,
    item?.mcc
  ].filter(Boolean).join(" "));
  const isExpense = amount < 0;
  if (isExpense && /exchange|обмен|crypto|крипт|binance|p2p/.test(text)) {
    return {
      direction: "exchange",
      suggestedCategory: "exchange",
      receivedType: "",
      entryKind: "exchange",
      operationType: "exchange"
    };
  }
  if (/transfer|перевод|переказ|iban|card2card|карта/.test(text)) {
    return {
      direction: isExpense ? "expense" : "income",
      suggestedCategory: isExpense ? "business" : "serviceIncome",
      receivedType: isExpense ? "" : "serviceincome",
      entryKind: "payment",
      operationType: "transfer"
    };
  }
  if (!isExpense && /exchange|обмен|crypto|крипт|binance|p2p/.test(text)) {
    return {
      direction: "income",
      suggestedCategory: "exchange",
      receivedType: "exchange_in",
      entryKind: "payment",
      operationType: "exchange"
    };
  }
  return {
    direction: isExpense ? "expense" : "income",
    suggestedCategory: isExpense ? inferBankExpenseCategory(item) : "serviceIncome",
    receivedType: isExpense ? "" : "serviceincome",
    entryKind: "payment",
    operationType: isExpense ? "expense" : "income"
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

function maskIban(value) {
  const raw = String(value || "").replace(/\s+/g, "");
  if (!raw) return "";
  const head = raw.slice(0, 4);
  const tail = raw.slice(-4);
  return `${head}...${tail}`;
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
    return;
  }
  totals.expense += amount;
  totals.net -= amount;
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
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function inferCounterpartyType(name) {
  if (!name) return "unknown";
  return /fop|фоп|llc|inc|ltd|тов|магаз|market/i.test(String(name)) ? "company" : "person";
}

function roundAmount(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMonobankApiToken(requestToken, envToken) {
  const manual = String(requestToken || "").trim();
  if (manual) return manual;
  return String(envToken || "").trim();
}

function normalizeMonobankAction(value) {
  const action = String(value || "import").trim().toLowerCase();
  return action === "validate" ? "validate" : "import";
}

function buildMonobankErrorPayload(error, token) {
  const message = String(error?.message || error || "").trim();
  if (isMissingMonobankTokenError(message)) {
    return {
      ok: false,
      code: "MONOBANK_TOKEN_MISSING",
      error: "Monobank token is not configured.",
      action: "configure_env_or_manual_token",
      warning: MONOBANK_PERMISSION_WARNING,
      ui_action: "upload screenshot or refresh token"
    };
  }
  return {
    ok: false,
    error: sanitizeMonobankErrorMessage(message || "Monobank request failed.", token)
  };
}

function isMissingMonobankTokenError(message) {
  return /monobank token is required|monobank credentials are not configured|set MONOBANK_API_TOKEN/i.test(String(message || ""));
}

function sanitizeMonobankErrorMessage(message, token) {
  const raw = String(message || "").trim() || "Monobank request failed.";
  const secret = String(token || "").trim();
  if (!secret) return raw;
  return raw.split(secret).join("[redacted]");
}
