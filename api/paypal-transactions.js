const DEFAULT_PAYPAL_ENVIRONMENT = "live";
const MAX_RANGE_DAYS = 366;
const PAYPAL_PAGE_SIZE = 500;
import { normalizeManualLedgerCategory } from "./manual-ledger-maps.js";

const PAYPAL_MCP_BASE_URL = "https://mcp.paypal.com";
const PAYPAL_MCP_PAGE_SIZE = 100;
const PAYPAL_EXCHANGE_EVENT_CODES = new Set(["T0200", "T1105"]);
const PAYPAL_REFUND_EVENT_CODES = new Set(["T1107", "T1108", "T1109", "T1110", "T1111"]);
const PAYPAL_CHANNEL_BY_CURRENCY = {
  USD: "пейпал дол",
  EUR: "пейпал евр",
  CAD: "пейпал сad"
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
    const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
    const mcpClientId = String(process.env.PAYPAL_MCP_CLIENT_ID || "").trim();
    const mcpRefreshToken = String(process.env.PAYPAL_MCP_REFRESH_TOKEN || "").trim();
    let result;
    if (clientId && clientSecret) {
      try {
        result = await fetchPayPalStatementEntries({
          startDate: payload.startDate,
          endDate: payload.endDate,
          clientId,
          clientSecret,
          environment: process.env.PAYPAL_ENVIRONMENT || DEFAULT_PAYPAL_ENVIRONMENT,
          fetchImpl: fetch
        });
      } catch (error) {
        if (!mcpClientId || !mcpRefreshToken) throw error;
        result = await fetchPayPalStatementEntriesFromMcp({
          startDate: payload.startDate,
          endDate: payload.endDate,
          clientId: mcpClientId,
          refreshToken: mcpRefreshToken,
          fetchImpl: fetch
        });
      }
    } else {
      result = await fetchPayPalStatementEntriesFromMcp({
        startDate: payload.startDate,
        endDate: payload.endDate,
        clientId: mcpClientId,
        refreshToken: mcpRefreshToken,
        fetchImpl: fetch
      });
    }
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

export async function fetchPayPalStatementEntries(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = getPayPalBaseUrl(options.environment, options.baseUrl);
  const accessToken = await getPayPalAccessToken({
    fetchImpl,
    baseUrl,
    clientId: options.clientId,
    clientSecret: options.clientSecret
  });
  const details = [];
  for (const chunk of splitDateRange(startDate, endDate)) {
    details.push(...(await fetchPayPalTransactionDetails({ fetchImpl, baseUrl, accessToken, ...chunk })));
  }
  const entries = normalizePayPalTransactionDetails(details);
  return {
    entries,
    summary: summarizePayPalStatementEntries(entries),
    transactionCount: details.length,
    periodStart: startDate,
    periodEnd: endDate,
    source: "paypal"
  };
}

export async function fetchPayPalStatementEntriesFromMcp(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const fetchImpl = options.fetchImpl || fetch;
  const accessToken = await getPayPalMcpAccessToken({
    fetchImpl,
    clientId: options.clientId,
    refreshToken: options.refreshToken
  });
  const details = [];
  let page = 1;
  let totalPages = 1;
  do {
    const payload = await callPayPalMcpTool({
      fetchImpl,
      accessToken,
      toolName: "list_transactions",
      argumentsValue: {
        start_date: toPayPalDateTime(startDate, false),
        end_date: toPayPalDateTime(endDate, true),
        page,
        page_size: PAYPAL_MCP_PAGE_SIZE
      }
    });
    details.push(...(Array.isArray(payload?.transaction_details) ? payload.transaction_details : []));
    totalPages = Math.max(1, Number(payload?.total_pages || 1));
    page += 1;
  } while (page <= totalPages);
  const entries = normalizePayPalTransactionDetails(details);
  return {
    entries,
    summary: summarizePayPalStatementEntries(entries),
    transactionCount: details.length,
    periodStart: startDate,
    periodEnd: endDate,
    source: "paypal-mcp"
  };
}

async function getPayPalMcpAccessToken(options = {}) {
  const clientId = String(options.clientId || "").trim();
  const refreshToken = String(options.refreshToken || "").trim();
  if (!clientId || !refreshToken) {
    throw new Error("PayPal credentials are not configured. Set PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET or PAYPAL_MCP_CLIENT_ID/PAYPAL_MCP_REFRESH_TOKEN.");
  }
  const upstream = await (options.fetchImpl || fetch)(`${PAYPAL_MCP_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId
    }).toString()
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `PayPal MCP token refresh failed (${upstream.status}).`);
  }
  return payload.access_token;
}

async function callPayPalMcpTool(options = {}) {
  const client = await openPayPalMcpSession(options);
  try {
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ezohata-incoming-ledger", version: "1.0.0" }
    });
    await client.notify("notifications/initialized", {});
    const result = await client.request("tools/call", {
      name: options.toolName,
      arguments: options.argumentsValue || {}
    });
    const text = (result?.content || [])
      .filter((item) => item?.type === "text")
      .map((item) => item.text || "")
      .join("\n")
      .trim();
    return text ? JSON.parse(text) : result;
  } finally {
    client.close();
  }
}

async function openPayPalMcpSession(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const response = await fetchImpl(`${PAYPAL_MCP_BASE_URL}/sse`, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: "text/event-stream"
    },
    signal: controller.signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`PayPal MCP session failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let nextId = 1;
  const firstEvent = await readPayPalMcpEvent(reader, decoder, () => buffer, (value) => { buffer = value; });
  const endpoint = parsePayPalMcpEndpoint(firstEvent);
  if (!endpoint) throw new Error("PayPal MCP session did not return a message endpoint.");
  return {
    close() {
      controller.abort();
      reader.cancel().catch(() => {});
    },
    async notify(method, params) {
      await postPayPalMcpMessage(fetchImpl, endpoint, options.accessToken, {
        jsonrpc: "2.0",
        method,
        params
      });
    },
    async request(method, params) {
      const id = nextId;
      nextId += 1;
      await postPayPalMcpMessage(fetchImpl, endpoint, options.accessToken, {
        jsonrpc: "2.0",
        id,
        method,
        params
      });
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const event = await readPayPalMcpEvent(reader, decoder, () => buffer, (value) => { buffer = value; }, deadline - Date.now());
        const payload = parsePayPalMcpJsonEvent(event);
        if (!payload || payload.id !== id) continue;
        if (payload.error) throw new Error(payload.error.message || `PayPal MCP request failed: ${method}`);
        return payload.result;
      }
      throw new Error(`PayPal MCP request timed out: ${method}`);
    }
  };
}

async function postPayPalMcpMessage(fetchImpl, endpoint, accessToken, payload) {
  const upstream = await fetchImpl(`${PAYPAL_MCP_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify(payload)
  });
  if (!upstream.ok && upstream.status !== 202) {
    const text = await upstream.text().catch(() => "");
    throw new Error(text || `PayPal MCP message failed (${upstream.status}).`);
  }
}

async function readPayPalMcpEvent(reader, decoder, getBuffer, setBuffer, timeoutMs = 12000) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let buffer = getBuffer();
  while (!buffer.includes("\n\n")) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("PayPal MCP event stream timed out.");
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("PayPal MCP event stream timed out.")), remaining))
    ]);
    if (chunk.done) throw new Error("PayPal MCP event stream closed.");
    buffer += decoder.decode(chunk.value, { stream: true });
  }
  const separatorIndex = buffer.indexOf("\n\n");
  const event = buffer.slice(0, separatorIndex);
  setBuffer(buffer.slice(separatorIndex + 2));
  return event;
}

function parsePayPalMcpEndpoint(event) {
  return String(event || "").match(/^data:\s*(.+)$/m)?.[1]?.trim() || "";
}

function parsePayPalMcpJsonEvent(event) {
  const data = String(event || "").match(/^data:\s*(.+)$/m)?.[1]?.trim();
  if (!data) return null;
  return JSON.parse(data);
}

export function summarizePayPalStatementEntries(entries = []) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIsoDate(entry?.date);
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Math.abs(Number(entry?.localAmount || 0));
    if (!date || !currency || !amount) return;
    const month = date.slice(0, 7);
    if (!monthLookup.has(month)) monthLookup.set(month, new Map());
    addPayPalSummaryAmount(monthLookup.get(month), currency, entry.direction, amount);
    addPayPalSummaryAmount(totalLookup, currency, entry.direction, amount);
  });
  return {
    months: Array.from(monthLookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, currencyLookup]) => ({
        month,
        totalsByCurrency: serializePayPalCurrencyTotals(currencyLookup)
      })),
    totalsByCurrency: serializePayPalCurrencyTotals(totalLookup)
  };
}

function addPayPalSummaryAmount(lookup, currency, direction, amount) {
  if (!lookup.has(currency)) lookup.set(currency, { income: 0, expense: 0, exchange: 0, net: 0 });
  const totals = lookup.get(currency);
  if (direction === "income") {
    totals.income += amount;
    totals.net += amount;
  } else if (direction === "expense") {
    totals.expense += amount;
    totals.net -= amount;
  } else if (direction === "exchange") {
    totals.exchange += amount;
  }
}

function serializePayPalCurrencyTotals(lookup) {
  return Object.fromEntries(
    Array.from(lookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => [
        currency,
        {
          income: roundPayPalSummaryAmount(totals.income),
          expense: roundPayPalSummaryAmount(totals.expense),
          ...(totals.exchange ? { exchange: roundPayPalSummaryAmount(totals.exchange) } : {}),
          net: roundPayPalSummaryAmount(totals.net)
        }
      ])
  );
}

function roundPayPalSummaryAmount(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

export async function getPayPalAccessToken(options = {}) {
  const clientId = String(options.clientId || "").trim();
  const clientSecret = String(options.clientSecret || "").trim();
  if (!clientId || !clientSecret) throw new Error("Missing PayPal client id or secret.");
  const fetchImpl = options.fetchImpl || fetch;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const upstream = await fetchImpl(`${options.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `PayPal token request failed (${upstream.status}).`);
  }
  return payload.access_token;
}

export async function fetchPayPalTransactionDetails(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const details = [];
  let page = 1;
  let totalPages = 1;
  do {
    const url = new URL(`${options.baseUrl}/v1/reporting/transactions`);
    url.searchParams.set("start_date", toPayPalDateTime(options.startDate, false));
    url.searchParams.set("end_date", toPayPalDateTime(options.endDate, true));
    url.searchParams.set("fields", "all");
    url.searchParams.set("page_size", String(PAYPAL_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const upstream = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: "application/json",
        "Accept-Language": "en_US",
        "Content-Type": "application/json"
      }
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      throw new Error(payload?.message || payload?.name || `PayPal transaction request failed (${upstream.status}).`);
    }
    details.push(...(Array.isArray(payload?.transaction_details) ? payload.transaction_details : []));
    totalPages = Math.max(1, Number(payload?.total_pages || 1));
    page += 1;
  } while (page <= totalPages);
  return details;
}

export function normalizePayPalTransactionDetails(details = []) {
  const entries = [];
  details.forEach((detail, detailIndex) => {
    const info = detail?.transaction_info || {};
    const date = normalizeIsoDate(String(info.transaction_initiation_date || info.transaction_updated_date || "").slice(0, 10));
    const amount = normalizeMoney(info.transaction_amount);
    const fee = normalizeMoney(info.fee_amount);
    const organization = getPayPalCounterparty(detail, info);
    const direction = getPayPalEntryDirection(info, amount.value);
    const entryKind = getPayPalEntryKind(detail, info, amount.value);
    const counterparty = buildPayPalCounterparty(detail, info, direction, entryKind);
    if (date && amount.value) {
      entries.push({
        id: `paypal-${info.transaction_id || detailIndex}`,
        date,
        channel: getPayPalChannel(amount.currency),
        direction,
        localAmount: Math.abs(amount.value),
        currency: amount.currency,
        usdAmount: amount.currency === "USD" ? Math.abs(amount.value) : null,
        feeAmount: fee.value < 0 ? Math.abs(fee.value) : null,
        feeCurrency: fee.currency || amount.currency,
        suggestedCategory: getPayPalSuggestedCategory(direction),
        organization,
        ...counterparty,
        entryKind,
        confidence: 0.95,
        source: "paypal",
        sourceTransactionId: String(info.transaction_id || "")
      });
    }
    if (date && fee.value < 0) {
      entries.push({
        id: `paypal-fee-${info.transaction_id || detailIndex}`,
        date,
        channel: getPayPalChannel(fee.currency || amount.currency),
        direction: "expense",
        localAmount: Math.abs(fee.value),
        currency: fee.currency || amount.currency,
        usdAmount: (fee.currency || amount.currency) === "USD" ? Math.abs(fee.value) : null,
        feeAmount: null,
        feeCurrency: fee.currency || amount.currency,
        suggestedCategory: "business",
        organization: `PayPal fee${organization ? `: ${organization}` : ""}`,
        ...buildPayPalFeeCounterparty(detail, info),
        entryKind: "fee",
        confidence: 0.95,
        source: "paypal",
        sourceTransactionId: String(info.transaction_id || "")
      });
    }
  });
  return entries.filter((entry) => entry.date && entry.channel && entry.localAmount > 0);
}

function getPayPalEntryDirection(info, amount) {
  const eventCode = String(info?.transaction_event_code || "").trim().toUpperCase();
  if (PAYPAL_EXCHANGE_EVENT_CODES.has(eventCode)) return "exchange";
  return amount < 0 ? "expense" : "income";
}

function getPayPalSuggestedCategory(direction) {
  if (direction === "income") return normalizeManualLedgerCategory("serviceIncome", "serviceIncome");
  if (direction === "exchange") return normalizeManualLedgerCategory("exchange", "exchange");
  return normalizeManualLedgerCategory("business", "business");
}

function getPayPalEntryKind(detail, info, amount) {
  const eventCode = String(info?.transaction_event_code || "").trim().toUpperCase();
  if (PAYPAL_EXCHANGE_EVENT_CODES.has(eventCode)) return "exchange";
  const text = [info?.transaction_subject, info?.transaction_note, detail?.auction_info?.auction_site]
    .map((value) => String(value || "").trim().toLowerCase())
    .join(" | ");
  if (PAYPAL_REFUND_EVENT_CODES.has(eventCode) || /\brefund(ed)?\b/.test(text)) return "refund";
  return amount < 0 ? "payment" : "payment";
}

export function splitDateRange(startDate, endDate) {
  const chunks = [];
  let cursor = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  while (cursor <= end) {
    const chunkStart = cursor;
    const chunkEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 30));
    const cappedEnd = chunkEnd < end ? chunkEnd : end;
    chunks.push({ startDate: formatUtcDate(chunkStart), endDate: formatUtcDate(cappedEnd) });
    cursor = new Date(Date.UTC(cappedEnd.getUTCFullYear(), cappedEnd.getUTCMonth(), cappedEnd.getUTCDate() + 1));
  }
  return chunks;
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) throw new Error("Select a valid PayPal statement period.");
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  if (start > end) throw new Error("PayPal statement start date must be before end date.");
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) throw new Error(`PayPal statement period is too large. Maximum is ${MAX_RANGE_DAYS} days.`);
}

function getPayPalBaseUrl(environment, explicitBaseUrl) {
  if (explicitBaseUrl) return String(explicitBaseUrl).replace(/\/+$/, "");
  return String(environment || "").toLowerCase() === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

function toPayPalDateTime(date, endOfDay) {
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function parseUtcDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeMoney(value) {
  return {
    value: Number.parseFloat(String(value?.value || "0").replace(",", ".")) || 0,
    currency: String(value?.currency_code || value?.currency || "").trim().toUpperCase()
  };
}

function getPayPalChannel(currency) {
  return PAYPAL_CHANNEL_BY_CURRENCY[String(currency || "").toUpperCase()] || "пейпал дол";
}

function getPayPalCounterparty(detail, info) {
  const payer = detail?.payer_info || {};
  const shipping = detail?.shipping_info || {};
  const cartItems = Array.isArray(detail?.cart_info?.item_details) ? detail.cart_info.item_details : [];
  const name = [payer.payer_name?.given_name, payer.payer_name?.surname].filter(Boolean).join(" ");
  const itemNames = cartItems
    .map((item) => [item?.item_name, item?.item_description].filter(Boolean).join(" - "))
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
  return compactPayPalDescription([
    info.transaction_subject ||
      info.transaction_note ||
      itemNames ||
      shipping.name ||
      info.invoice_id ||
      info.custom_field ||
      name ||
      payer.email_address ||
      info.transaction_id ||
      "PayPal",
    info.invoice_id ? `invoice ${info.invoice_id}` : "",
    info.custom_field ? `custom ${info.custom_field}` : "",
    info.transaction_event_code ? `event ${info.transaction_event_code}` : ""
  ]);
}

function buildPayPalCounterparty(detail, info, direction, entryKind) {
  const payer = normalizePayPalPartyInfo(detail?.payer_info, "payer");
  const payee = normalizePayPalPartyInfo(detail?.payee_info || detail?.payee || detail?.seller_info, "payee");
  const merchantName = firstNonEmpty(
    payee.name,
    detail?.cart_info?.merchant_name,
    detail?.incentive_info?.merchant_name,
    info?.business_partner_name
  );
  const description = getPayPalCounterparty(detail, info);
  const fallback = firstNonEmpty(
    merchantName,
    description,
    info?.transaction_subject,
    info?.transaction_note,
    info?.invoice_id ? `invoice ${info.invoice_id}` : "",
    info?.custom_field ? `custom ${info.custom_field}` : "",
    info?.transaction_id,
    "Контрагент не определен"
  );
  const preferredParty = entryKind === "refund"
    ? (payer.name || payer.email ? payer : (payee.name || payee.email ? payee : null))
    : (direction === "income"
        ? (payer.name || payer.email ? payer : null)
        : (payee.name || payee.email ? payee : null));
  const counterpartyName = firstNonEmpty(
    preferredParty?.name,
    direction === "expense" ? merchantName : "",
    ""
  );
  const counterpartyEmail = firstNonEmpty(
    preferredParty?.email,
    direction === "expense" ? payee.email : "",
    ""
  );
  const labelValue = firstNonEmpty(counterpartyName, counterpartyEmail, fallback, "Контрагент не определен");
  return {
    counterpartyName,
    counterpartyEmail,
    counterpartyType: inferCounterpartyType(counterpartyName || merchantName || fallback),
    counterpartyRole: entryKind === "exchange"
      ? "unknown"
      : (direction === "income" ? "payer" : (payee.name || payee.email ? "payee" : merchantName ? "merchant" : "unknown")),
    counterpartyLabel: `${direction === "income" ? "От" : "Кому"}: ${labelValue}`,
    payerName: payer.name,
    payerEmail: payer.email,
    payerId: payer.id,
    payeeName: payee.name,
    payeeEmail: payee.email,
    merchantName,
    transactionSubject: String(info?.transaction_subject || "").trim(),
    description,
    transactionEventCode: String(info?.transaction_event_code || "").trim()
  };
}

function buildPayPalFeeCounterparty(detail, info) {
  const base = buildPayPalCounterparty(detail, info, "expense", "fee");
  return {
    ...base,
    counterpartyName: "Комиссия PayPal",
    counterpartyEmail: "",
    counterpartyType: "company",
    counterpartyRole: "merchant",
    counterpartyLabel: "Кому: Комиссия PayPal"
  };
}

function normalizePayPalPartyInfo(raw, role) {
  const source = raw || {};
  const explicitName = firstNonEmpty(
    typeof source[`${role}_name`] === "string" ? source[`${role}_name`] : "",
    typeof source.name === "string" ? source.name : "",
    [source[`${role}_name`]?.given_name, source[`${role}_name`]?.surname].filter(Boolean).join(" "),
    [source?.payer_name?.given_name, source?.payer_name?.surname].filter(Boolean).join(" "),
    [source?.payee_name?.given_name, source?.payee_name?.surname].filter(Boolean).join(" ")
  );
  return {
    name: explicitName,
    email: firstNonEmpty(source.email_address, source.email, source[`${role}_email`]),
    id: firstNonEmpty(source.account_id, source.payer_id, source.payee_id, source.merchant_id)
  };
}

function inferCounterpartyType(value) {
  const text = String(value || "").trim();
  if (!text) return "unknown";
  if (/\b(inc|llc|ltd|corp|company|gmbh|s\.r\.o|магаз|store|shop|software|services?)\b/i.test(text)) return "company";
  if (/^[a-zа-яё'-]+(?:\s+[a-zа-яё'-]+){1,3}$/i.test(text)) return "person";
  return "unknown";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function compactPayPalDescription(parts) {
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
