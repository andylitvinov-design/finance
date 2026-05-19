const DEFAULT_PAYPAL_ENVIRONMENT = "live";
const MAX_RANGE_DAYS = 366;
const PAYPAL_PAGE_SIZE = 500;
import { normalizeManualLedgerCategory } from "../server/manual-ledger-maps.js";

const PAYPAL_MCP_BASE_URL = "https://mcp.paypal.com";
const PAYPAL_MCP_PAGE_SIZE = 100;
const DEFAULT_PAYPAL_MCP_TOOL_NAME = "list_transactions";
const PAYPAL_ERROR_EXCERPT_LENGTH = 300;
const PAYPAL_MCP_FALLBACK_ACTION = "Use PayPal REST permissions or PayPal statement file import.";
export const PAYPAL_FEE_UNAVAILABLE_WARNING = "PayPal fee unavailable due to API permissions/auth";
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
      const environment = process.env.PAYPAL_ENVIRONMENT || DEFAULT_PAYPAL_ENVIRONMENT;
      try {
        result = await fetchPayPalStatementEntries({
          startDate: payload.startDate,
          endDate: payload.endDate,
          clientId,
          clientSecret,
          environment,
          fetchImpl: fetch
        });
      } catch (error) {
        if (!mcpClientId || !mcpRefreshToken) throw error;
        const restWarning = buildPayPalRestFallbackWarning(error);
        try {
          result = await fetchPayPalStatementEntriesFromMcp({
            startDate: payload.startDate,
            endDate: payload.endDate,
            clientId: mcpClientId,
            refreshToken: mcpRefreshToken,
            restClientId: clientId,
            restClientSecret: clientSecret,
            environment,
            fetchImpl: fetch
          });
        } catch (mcpError) {
          if (isPayPalMcpFallbackUnavailableError(mcpError)) {
            return response.status(400).json({
              ok: false,
              provider: mcpError.provider,
              phase: mcpError.phase,
              error: mcpError.userMessage,
              warnings: uniquePayPalWarnings([restWarning]),
              availableMcpTools: mcpError.availableMcpTools || []
            });
          }
          throw mcpError;
        }
        result = {
          ...result,
          warnings: uniquePayPalWarnings([
            restWarning,
            buildPayPalProviderWarning(error, { environment }),
            ...(result.warnings || [])
          ])
        };
      }
    } else {
      result = await fetchPayPalStatementEntriesFromMcp({
        startDate: payload.startDate,
        endDate: payload.endDate,
        clientId: mcpClientId,
        refreshToken: mcpRefreshToken,
        restClientId: clientId,
        restClientSecret: clientSecret,
        environment: process.env.PAYPAL_ENVIRONMENT || DEFAULT_PAYPAL_ENVIRONMENT,
        fetchImpl: fetch
      });
    }
    if (Array.isArray(result?.warnings) && result.warnings.length) {
      for (const warning of result.warnings) {
        console.warn(String(warning));
      }
    }
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      error: getPayPalSafeErrorMessage(error)
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
  const missingFeeWarnings = collectPayPalFeeWarnings(entries, { source: "PayPal" });
  return {
    entries,
    warnings: missingFeeWarnings,
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
  const toolName = getPayPalMcpToolName();
  do {
    const payload = await callPayPalMcpTool({
      fetchImpl,
      accessToken,
      toolName,
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
  const enrichment = await enrichPayPalMcpTransactionDetails(details, {
    fetchImpl,
    startDate,
    endDate,
    clientId: options.restClientId,
    clientSecret: options.restClientSecret,
    environment: options.environment,
    baseUrl: options.baseUrl,
  });
  const entries = normalizePayPalTransactionDetails(enrichment.details);
  const warnings = [...enrichment.warnings, ...collectPayPalFeeWarnings(entries, { source: "PayPal MCP" })];
  return {
    entries,
    summary: summarizePayPalStatementEntries(entries),
    transactionCount: details.length,
    periodStart: startDate,
    periodEnd: endDate,
    source: "paypal-mcp",
    warnings,
    counterpartyDebugSamples: enrichment.debugSamples
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
  const payload = await readJsonOrTextResponse(upstream, "PayPal MCP token refresh failed");
  if (!upstream.ok || !payload?.access_token) {
    throw new Error(formatPayPalUpstreamError("PayPal MCP token refresh failed", upstream.status, payload));
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
    let result;
    try {
      result = await client.request("tools/call", {
        name: options.toolName,
        arguments: options.argumentsValue || {}
      });
    } catch (error) {
      if (!isPayPalMcpToolNotFound(error)) throw error;
      const availableMcpTools = await listPayPalMcpTools(client).catch(() => []);
      throw createPayPalMcpFallbackUnavailableError(options.toolName, availableMcpTools, error);
    }
    const text = (result?.content || [])
      .filter((item) => item?.type === "text")
      .map((item) => item.text || "")
      .join("\n")
      .trim();
    return text ? parseJsonText(text, `PayPal MCP tool ${options.toolName || "unknown"}`) : result;
  } finally {
    client.close();
  }
}

async function listPayPalMcpTools(client) {
  const result = await client.request("tools/list", {});
  return (Array.isArray(result?.tools) ? result.tools : [])
    .map((tool) => String(tool?.name || "").trim())
    .filter(Boolean);
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
    throw new Error(formatPayPalTextError("PayPal MCP message failed", upstream.status, text));
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
  return parseJsonText(data, "PayPal MCP event");
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

function collectPayPalFeeWarnings(entries = [], options = {}) {
  const source = String(options.source || "PayPal").trim() || "PayPal";
  const warnings = [];
  const seen = new Set();
  for (const entry of entries || []) {
    if (String(entry?.direction || "") !== "income") continue;
    const hasFee = hasExplicitMoneyValue(entry?.feeAmount);
    const hasNet = hasExplicitMoneyValue(entry?.netAmount);
    if (hasFee || hasNet) continue;
    const key = String(entry?.sourceTransactionId || entry?.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    warnings.push(`${source} warning: missing fee on income transaction ${key}; net is not set.`);
  }
  return warnings;
}

function getPayPalMcpToolName() {
  return String(process.env.PAYPAL_MCP_TOOL_NAME || "").trim() || DEFAULT_PAYPAL_MCP_TOOL_NAME;
}

export function getPayPalSafeErrorMessage(error) {
  return getPayPalBodyExcerpt(error?.message || error) || "PayPal import failed.";
}

function buildPayPalRestFallbackWarning(error) {
  return `PayPal REST import failed: ${getPayPalSafeErrorMessage(error)}`;
}

export function isPayPalMcpToolNotFound(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("tool list_transactions not found") ||
    message.includes("mcp error -32602") ||
    message.includes("tool not found") ||
    message.includes("method not found");
}

function createPayPalMcpFallbackUnavailableError(toolName, availableMcpTools, cause) {
  const selectedTool = String(toolName || DEFAULT_PAYPAL_MCP_TOOL_NAME).trim() || DEFAULT_PAYPAL_MCP_TOOL_NAME;
  const message = `PayPal REST import failed and MCP fallback is unavailable because PayPal MCP tool ${selectedTool} is not exposed. ${PAYPAL_MCP_FALLBACK_ACTION}`;
  const error = new Error(message);
  error.provider = "paypal";
  error.phase = "mcp_fallback";
  error.userMessage = message;
  error.availableMcpTools = Array.isArray(availableMcpTools) ? availableMcpTools : [];
  error.causeMessage = getPayPalSafeErrorMessage(cause);
  error.isPayPalMcpFallbackUnavailable = true;
  return error;
}

function isPayPalMcpFallbackUnavailableError(error) {
  return Boolean(error?.isPayPalMcpFallbackUnavailable);
}

export function buildPayPalProviderWarning(error, options = {}) {
  const message = String(error?.message || error || "").trim();
  const environment = String(options.environment || DEFAULT_PAYPAL_ENVIRONMENT).trim().toLowerCase() || DEFAULT_PAYPAL_ENVIRONMENT;
  const hint = isPayPalEnvironmentMismatchCandidate(error, message)
    ? ` (environment: ${environment}; verify live vs sandbox app credentials).`
    : ".";
  return `${PAYPAL_FEE_UNAVAILABLE_WARNING}${hint}`;
}

function isPayPalEnvironmentMismatchCandidate(error, message) {
  const status = Number(error?.paypalStatus || error?.status || 0);
  const normalized = String(message || "").toLowerCase();
  return status === 401 ||
    /client authentication failed|invalid_client|invalid client|authentication failed|unauthorized/.test(normalized);
}

function createPayPalApiError(message, options = {}) {
  const error = new Error(message);
  error.paypalStatus = Number(options.status || 0);
  error.paypalPhase = String(options.phase || "");
  error.paypalError = String(options.payload?.error || "");
  error.paypalName = String(options.payload?.name || "");
  return error;
}

function uniquePayPalWarnings(warnings = []) {
  return Array.from(new Set((warnings || []).map((warning) => String(warning || "").trim()).filter(Boolean)));
}

export function parseJsonText(text, context = "PayPal response") {
  const raw = String(text || "").trim();
  if (!raw) throw new Error(`${context} returned empty response.`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${context} returned non-JSON: ${getPayPalBodyExcerpt(raw)}`);
  }
}

export async function readJsonOrTextResponse(response, context = "PayPal response") {
  const status = Number(response?.status || 0);
  if (typeof response?.text === "function") {
    const text = await response.text().catch(() => "");
    const raw = String(text || "").trim();
    if (!raw) return null;
    try {
      return parseJsonText(raw, context);
    } catch {
      throw new Error(formatPayPalTextError(context, status, raw));
    }
  }
  if (typeof response?.json === "function") {
    try {
      return await response.json();
    } catch {
      throw new Error(formatPayPalTextError(context, status, ""));
    }
  }
  return null;
}

function formatPayPalUpstreamError(context, status, payload) {
  const detail = getPayPalPayloadError(payload) || `HTTP ${status || "unknown"}`;
  return `${context} (${status || "unknown"}): ${getPayPalBodyExcerpt(detail)}`;
}

function formatPayPalTextError(context, status, text) {
  const excerpt = getPayPalBodyExcerpt(text) || "non-JSON response";
  return `${context} (${status || "unknown"}): ${excerpt}`;
}

function getPayPalPayloadError(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(
    payload.error_description ||
      payload.message ||
      payload.name ||
      payload.error ||
      payload.details?.[0]?.description ||
      ""
  ).trim();
}

function getPayPalBodyExcerpt(value) {
  return redactPayPalSecretText(String(value || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PAYPAL_ERROR_EXCERPT_LENGTH);
}

function redactPayPalSecretText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9._~+\/-]+=*/gi, "Basic [redacted]")
    .replace(/((?:access_token|refresh_token|client_secret)\s*[=:]\s*)[^\s&,'"]+/gi, "$1[redacted]")
    .replace(/(["'](?:access_token|refresh_token|client_secret)["']\s*:\s*["'])[^"']+/gi, "$1[redacted]");
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
  const payload = await readJsonOrTextResponse(upstream, "PayPal OAuth failed");
  if (!upstream.ok || !payload?.access_token) {
    throw createPayPalApiError(
      formatPayPalUpstreamError("PayPal OAuth failed", upstream.status, payload),
      { status: upstream.status, payload, phase: "oauth" }
    );
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
    const payload = await readJsonOrTextResponse(upstream, "PayPal transaction request failed");
    if (!upstream.ok) {
      throw createPayPalApiError(
        formatPayPalUpstreamError("PayPal transaction request failed", upstream.status, payload),
        { status: upstream.status, payload, phase: "transaction_search" }
      );
    }
    details.push(...(Array.isArray(payload?.transaction_details) ? payload.transaction_details : []));
    totalPages = Math.max(1, Number(payload?.total_pages || 1));
    page += 1;
  } while (page <= totalPages);
  return details;
}

export async function fetchPayPalTransactionDetailsById(options = {}) {
  const transactionId = String(options.transactionId || "").trim();
  const transactionDate = normalizeIsoDate(options.transactionDate);
  if (!transactionId || !transactionDate) return [];
  const fetchImpl = options.fetchImpl || fetch;
  const window = buildPayPalTransactionSearchWindow(transactionDate);
  const url = new URL(`${options.baseUrl}/v1/reporting/transactions`);
  url.searchParams.set("start_date", toPayPalDateTime(window.startDate, false));
  url.searchParams.set("end_date", toPayPalDateTime(window.endDate, true));
  url.searchParams.set("transaction_id", transactionId);
  url.searchParams.set("fields", "all");
  url.searchParams.set("balance_affecting_records_only", "N");
  url.searchParams.set("page_size", String(PAYPAL_PAGE_SIZE));
  url.searchParams.set("page", "1");
  const upstream = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: "application/json",
      "Accept-Language": "en_US",
      "Content-Type": "application/json"
    }
  });
  const payload = await readJsonOrTextResponse(upstream, "PayPal transaction detail lookup failed");
  if (!upstream.ok) {
    throw createPayPalApiError(
      formatPayPalUpstreamError("PayPal transaction detail lookup failed", upstream.status, payload),
      { status: upstream.status, payload, phase: "transaction_detail_lookup" }
    );
  }
  return Array.isArray(payload?.transaction_details) ? payload.transaction_details : [];
}

async function enrichPayPalMcpTransactionDetails(details = [], options = {}) {
  const targets = (details || []).filter(shouldEnrichPayPalMcpDetail);
  const warnings = [];
  const debugSamples = [];
  if (!targets.length) return { details, warnings, debugSamples };

  const clientId = String(options.clientId || "").trim();
  const clientSecret = String(options.clientSecret || "").trim();
  if (!clientId || !clientSecret) {
    warnings.push("PayPal REST enrichment skipped: PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET are not configured.");
    debugSamples.push(...targets.slice(0, 5).map((detail) => buildPayPalCounterpartyDebugSample(detail, "missing_rest_credentials")));
    return { details, warnings, debugSamples };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = getPayPalBaseUrl(options.environment, options.baseUrl);
  let accessToken = "";
  try {
    accessToken = await getPayPalAccessToken({ fetchImpl, baseUrl, clientId, clientSecret });
  } catch (error) {
    warnings.push(buildPayPalProviderWarning(error, { environment: options.environment }));
    debugSamples.push(...targets.slice(0, 5).map((detail) => buildPayPalCounterpartyDebugSample(detail, "rest_token_failed")));
    return { details, warnings, debugSamples };
  }

  const enrichedByTransactionId = new Map();
  for (const target of targets) {
    const info = target?.transaction_info || {};
    const transactionId = String(info.transaction_id || "").trim();
    const transactionDate = getPayPalTransactionDate(info);
    if (!transactionId || !transactionDate || enrichedByTransactionId.has(transactionId)) continue;
    try {
      const candidates = await fetchPayPalTransactionDetailsById({
        fetchImpl,
        baseUrl,
        accessToken,
        transactionId,
        transactionDate,
      });
      const best = pickBestPayPalTransactionDetailMatch(target, candidates);
      if (best) {
        enrichedByTransactionId.set(transactionId, best);
      } else {
        debugSamples.push(buildPayPalCounterpartyDebugSample(target, "rest_detail_not_found", candidates));
      }
    } catch (error) {
      warnings.push(buildPayPalProviderWarning(error, { environment: options.environment }));
      debugSamples.push(buildPayPalCounterpartyDebugSample(target, "rest_lookup_failed"));
    }
  }

  const enrichedDetails = details.map((detail) => {
    const transactionId = String(detail?.transaction_info?.transaction_id || "").trim();
    const enriched = enrichedByTransactionId.get(transactionId);
    return enriched ? mergePayPalTransactionDetail(detail, enriched) : detail;
  });
  const stillSparse = enrichedDetails.filter(shouldEnrichPayPalMcpDetail);
  debugSamples.push(...stillSparse.slice(0, Math.max(0, 5 - debugSamples.length)).map((detail) => buildPayPalCounterpartyDebugSample(detail, "no_readable_counterparty_after_enrichment")));

  return {
    details: enrichedDetails,
    warnings: uniquePayPalWarnings(warnings),
    debugSamples: debugSamples.slice(0, 5)
  };
}

function shouldEnrichPayPalMcpDetail(detail) {
  const info = detail?.transaction_info || {};
  if (!String(info.transaction_id || "").trim()) return false;
  const amount = normalizeMoney(info.transaction_amount);
  const direction = getPayPalEntryDirection(info, amount.value);
  const entryKind = getPayPalEntryKind(detail, info, amount.value);
  if (direction === "exchange" || entryKind === "exchange") return false;
  return getReadablePayPalCounterparty(detail, { direction, entryKind, info }).unavailable;
}

function pickBestPayPalTransactionDetailMatch(original, candidates = []) {
  const originalInfo = original?.transaction_info || {};
  const transactionId = String(originalInfo.transaction_id || "").trim();
  const originalAmount = normalizeMoney(originalInfo.transaction_amount);
  const originalDate = getPayPalTransactionDate(originalInfo);
  return (candidates || [])
    .filter((candidate) => String(candidate?.transaction_info?.transaction_id || "").trim() === transactionId)
    .map((candidate) => {
      const info = candidate?.transaction_info || {};
      const amount = normalizeMoney(info.transaction_amount);
      const date = getPayPalTransactionDate(info);
      const readable = !shouldEnrichPayPalMcpDetail(candidate);
      return {
        candidate,
        score:
          (readable ? 8 : 0) +
          (amount.currency && amount.currency === originalAmount.currency ? 4 : 0) +
          (Math.abs(Math.abs(amount.value) - Math.abs(originalAmount.value)) < 0.0001 ? 4 : 0) +
          (date && date === originalDate ? 2 : 0)
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.candidate || null;
}

function mergePayPalTransactionDetail(original, enriched) {
  return {
    ...enriched,
    ...original,
    payer_info: enriched?.payer_info || original?.payer_info,
    payee_info: enriched?.payee_info || original?.payee_info,
    payee: enriched?.payee || original?.payee,
    seller_info: enriched?.seller_info || original?.seller_info,
    shipping_info: enriched?.shipping_info || original?.shipping_info,
    cart_info: enriched?.cart_info || original?.cart_info,
    incentive_info: enriched?.incentive_info || original?.incentive_info,
    transaction_info: mergePayPalTransactionInfo(original?.transaction_info || {}, enriched?.transaction_info || {})
  };
}

function mergePayPalTransactionInfo(originalInfo, enrichedInfo) {
  const output = { ...enrichedInfo };
  Object.entries(originalInfo || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    output[key] = value;
  });
  return output;
}

function buildPayPalCounterpartyDebugSample(detail, reason, candidates = []) {
  const info = detail?.transaction_info || {};
  return {
    reason,
    transactionId: String(info.transaction_id || ""),
    eventCode: String(info.transaction_event_code || ""),
    date: getPayPalTransactionDate(info),
    currency: normalizeMoney(info.transaction_amount).currency,
    hasPayerInfo: Boolean(detail?.payer_info),
    hasPayeeInfo: Boolean(detail?.payee_info || detail?.payee || detail?.seller_info),
    hasCartInfo: Boolean(detail?.cart_info),
    transactionInfoFields: Object.keys(info || {}).sort(),
    detailFields: Object.keys(detail || {}).sort(),
    candidateCount: Array.isArray(candidates) ? candidates.length : 0
  };
}

export function normalizePayPalTransactionDetails(details = []) {
  const entries = [];
  const exchangeLookup = buildPayPalExchangeLookup(details);
  details.forEach((detail, detailIndex) => {
    const info = detail?.transaction_info || {};
    const date = normalizeIsoDate(String(info.transaction_initiation_date || info.transaction_updated_date || "").slice(0, 10));
    const amount = normalizeMoney(info.transaction_amount);
    const fee = normalizeMoney(info.fee_amount);
    const rawFee = parsePayPalMoneyValue(info?.fee_amount);
    const feeAmount = rawFee === null ? null : Math.abs(Number(rawFee));
    const organization = getPayPalCounterparty(detail, info);
    const direction = getPayPalEntryDirection(info, amount.value);
    const entryKind = getPayPalEntryKind(detail, info, amount.value);
    const counterparty = buildPayPalCounterparty(detail, info, direction, entryKind, amount, exchangeLookup);
    const externalId = getPayPalExternalId(info);
    const grossAmount = Math.abs(amount.value);
    const hasFeeAmount = feeAmount !== null;
    const netAmount = direction === "income"
      ? (hasFeeAmount ? Math.max(0, grossAmount - feeAmount) : null)
      : grossAmount;
    if (date && amount.value) {
      entries.push({
        id: `paypal-${info.transaction_id || detailIndex}`,
        date,
        channel: getPayPalChannel(amount.currency),
        direction,
        localAmount: grossAmount,
        currency: amount.currency,
        usdAmount: amount.currency === "USD" && hasExplicitMoneyValue(netAmount) ? netAmount : null,
        grossAmount,
        amountGross: grossAmount,
        amount_gross: grossAmount,
        feeAmount,
        amountFee: feeAmount,
        amount_fee: feeAmount,
        feeCurrency: fee.currency || amount.currency,
        netAmount,
        amountNet: netAmount,
        amount_net: netAmount,
        suggestedCategory: getPayPalSuggestedCategory(direction),
        organization,
        ...counterparty,
        entryKind,
        externalId,
        external_id: externalId,
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
        grossAmount: Math.abs(fee.value),
        amountGross: Math.abs(fee.value),
        amount_gross: Math.abs(fee.value),
        feeAmount: null,
        amountFee: "",
        amount_fee: "",
        feeCurrency: fee.currency || amount.currency,
        netAmount: Math.abs(fee.value),
        amountNet: Math.abs(fee.value),
        amount_net: Math.abs(fee.value),
        suggestedCategory: "business",
        organization: `PayPal fee${organization ? `: ${organization}` : ""}`,
        ...buildPayPalFeeCounterparty(detail, info, counterparty, externalId),
        entryKind: "fee",
        externalId,
        external_id: externalId,
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

function addUtcDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function buildPayPalTransactionSearchWindow(date) {
  const parsed = parseUtcDate(date);
  return {
    startDate: formatUtcDate(addUtcDays(parsed, -1)),
    endDate: formatUtcDate(addUtcDays(parsed, 1))
  };
}

function getPayPalTransactionDate(info = {}) {
  return normalizeIsoDate(String(info.transaction_initiation_date || info.transaction_updated_date || "").slice(0, 10));
}

function normalizeMoney(value) {
  return {
    value: Number.parseFloat(String(value?.value || "0").replace(",", ".")) || 0,
    currency: String(value?.currency_code || value?.currency || "").trim().toUpperCase()
  };
}

function parsePayPalMoneyValue(raw = null) {
  const rawValue = String(raw?.value || "").trim().replace(",", ".");
  if (!rawValue) return null;
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExplicitMoneyValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
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

function buildPayPalCounterparty(detail, info, direction, entryKind, amount, exchangeLookup) {
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
  const readableCounterparty = getReadablePayPalCounterparty(detail, {
    direction,
    entryKind,
    payer,
    payee,
    merchantName,
    info,
  });
  const counterpartyName = readableCounterparty.name;
  const counterpartyEmail = firstNonEmpty(
    readableCounterparty.email,
    direction === "income" || entryKind === "refund" ? payer.email : "",
    direction === "expense" ? payee.email : "",
    ""
  );
  const labelValue = readableCounterparty.label;
  const normalizedFlow = buildPayPalNormalizedFlow({
    detail,
    info,
    direction,
    entryKind,
    amount,
    payer,
    payee,
    merchantName,
    fallback,
    labelValue,
    exchangeLookup
  });
  return {
    ...normalizedFlow,
    counterpartyName,
    counterpartyEmail,
    counterpartyType: inferCounterpartyType(counterpartyName || merchantName || ""),
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

function buildPayPalFeeCounterparty(detail, info, baseCounterparty = {}, externalId = "") {
  return {
    ...baseCounterparty,
    counterpartyName: "Комиссия PayPal",
    counterpartyEmail: "",
    counterpartyType: "company",
    counterpartyRole: "merchant",
    counterpartyLabel: "Кому: Комиссия PayPal",
    fromEntity: "me",
    toEntity: "PayPal Fee",
    from_entity: "me",
    to_entity: "PayPal Fee",
    displayFromTo: "Me → PayPal Fee",
    operationType: "fee",
    operation_type: "fee",
    exchangeGroupId: "",
    exchange_group_id: "",
    exchangeLeg: "",
    externalId,
    external_id: externalId
  };
}

function buildPayPalNormalizedFlow({
  detail,
  info,
  direction,
  entryKind,
  amount,
  payer,
  payee,
  merchantName,
  fallback,
  labelValue,
  exchangeLookup
}) {
  if (entryKind === "exchange" || direction === "exchange") {
    const exchange = resolvePayPalExchangeFlow(info, amount, exchangeLookup);
    return {
      fromEntity: exchange.fromEntity,
      toEntity: exchange.toEntity,
      from_entity: exchange.fromEntity.toLowerCase() === "me" ? "me" : exchange.fromEntity,
      to_entity: exchange.toEntity.toLowerCase() === "me" ? "me" : exchange.toEntity,
      displayFromTo: `${exchange.fromEntity} → ${exchange.toEntity}`,
      operationType: "exchange",
      operation_type: "exchange",
      exchangeGroupId: exchange.exchangeGroupId,
      exchange_group_id: exchange.exchangeGroupId,
      exchangeLeg: exchange.exchangeLeg,
      rawMetadata: getPayPalCounterparty(detail, info)
    };
  }
  if (direction === "income" || entryKind === "refund") {
    const fromEntity = labelValue || "counterparty unavailable";
    return {
      fromEntity,
      toEntity: "Me",
      from_entity: fromEntity,
      to_entity: "me",
      displayFromTo: `${fromEntity} → Me`,
      operationType: "service_in",
      operation_type: "service_in",
      exchangeGroupId: "",
      exchange_group_id: "",
      exchangeLeg: "",
      rawMetadata: getPayPalCounterparty(detail, info)
    };
  }
  const toEntity = labelValue || "counterparty unavailable";
  return {
    fromEntity: "me",
    toEntity,
    from_entity: "me",
    to_entity: toEntity,
    displayFromTo: `Me → ${toEntity}`,
    operationType: entryKind === "fee" ? "fee" : "payout",
    operation_type: entryKind === "fee" ? "fee" : "payout",
    exchangeGroupId: "",
    exchange_group_id: "",
    exchangeLeg: "",
    rawMetadata: getPayPalCounterparty(detail, info)
  };
}

function resolvePayPalExchangeFlow(info, amount, exchangeLookup) {
  const exchangeGroupId = getPayPalExchangeGroupId(info);
  const currencies = collectPayPalExchangeCurrencies(info, exchangeLookup);
  const ownCurrency = String(amount?.currency || "").trim().toUpperCase();
  const pairedCurrency = currencies.find((currency) => currency && currency !== ownCurrency) || ownCurrency;
  const isOutgoing = Number(amount?.value || 0) < 0;
  return {
    fromEntity: `PayPal ${isOutgoing ? ownCurrency : pairedCurrency}`,
    toEntity: `PayPal ${isOutgoing ? pairedCurrency : ownCurrency}`,
    exchangeGroupId,
    exchangeLeg: isOutgoing ? "out" : "in"
  };
}

function buildPayPalExchangeLookup(details = []) {
  const lookup = new Map();
  details.forEach((detail) => {
    const info = detail?.transaction_info || {};
    const eventCode = String(info?.transaction_event_code || "").trim().toUpperCase();
    if (!PAYPAL_EXCHANGE_EVENT_CODES.has(eventCode)) return;
    const currency = normalizeMoney(info.transaction_amount).currency;
    if (!currency) return;
    for (const key of getPayPalExchangeLookupKeys(info)) {
      const currencies = lookup.get(key) || [];
      if (!currencies.includes(currency)) currencies.push(currency);
      lookup.set(key, currencies);
    }
  });
  return lookup;
}

function getPayPalExchangeGroupId(info = {}) {
  return firstNonEmpty(info.invoice_id, info.paypal_reference_id, info.reference_id, info.transaction_id);
}

function getPayPalExternalId(info = {}) {
  return firstNonEmpty(info.invoice_id, info.transaction_id, info.paypal_reference_id, info.reference_id);
}

function getPayPalExchangeLookupKeys(info = {}) {
  return [...new Set([
    String(info.invoice_id || "").trim(),
    String(info.paypal_reference_id || "").trim(),
    String(info.reference_id || "").trim(),
    String(info.transaction_id || "").trim(),
  ].filter(Boolean))];
}

function collectPayPalExchangeCurrencies(info = {}, exchangeLookup = new Map()) {
  const merged = [];
  for (const key of getPayPalExchangeLookupKeys(info)) {
    for (const currency of exchangeLookup.get(key) || []) {
      if (!merged.includes(currency)) merged.push(currency);
    }
  }
  return merged;
}

export function getReadablePayPalCounterparty(detail, options = {}) {
  const payer = options.payer || normalizePayPalPartyInfo(detail?.payer_info, "payer");
  const payee = options.payee || normalizePayPalPartyInfo(detail?.payee_info || detail?.payee || detail?.seller_info, "payee");
  const itemNames = getPayPalCartItemNames(detail);
  const merchantName = firstNonEmpty(
    options.merchantName,
    detail?.cart_info?.merchant_name,
    detail?.incentive_info?.merchant_name,
    options.info?.business_partner_name
  );
  const shippingName = String(detail?.shipping_info?.name || "").trim();
  const info = options.info || detail?.transaction_info || {};
  const direction = String(options.direction || "").trim();
  const entryKind = String(options.entryKind || "").trim();
  const invoiceId = String(info.invoice_id || "").trim();
  const transactionId = String(info.transaction_id || "").trim();
  const customField = String(info.custom_field || "").trim();
  const blockedValues = new Set([invoiceId, transactionId, customField].filter(Boolean).map((value) => value.toLowerCase()));
  const orderedCandidates = (entryKind === "refund" || direction === "income")
    ? [
        { label: payer.name, name: payer.name, email: "" },
        { label: payer.email, name: "", email: payer.email },
        { label: payee.name, name: payee.name, email: "" },
        { label: merchantName, name: merchantName, email: "" },
        { label: payee.email, name: "", email: payee.email },
        { label: shippingName, name: shippingName, email: "" },
        { label: info.transaction_subject, name: "", email: "" },
        { label: info.transaction_note, name: "", email: "" },
        { label: itemNames, name: "", email: "" },
      ]
    : [
        { label: payee.name, name: payee.name, email: "" },
        { label: merchantName, name: merchantName, email: "" },
        { label: payee.email, name: "", email: payee.email },
        { label: shippingName, name: shippingName, email: "" },
        { label: payer.name, name: payer.name, email: "" },
        { label: payer.email, name: "", email: payer.email },
        { label: info.transaction_subject, name: "", email: "" },
        { label: info.transaction_note, name: "", email: "" },
        { label: itemNames, name: "", email: "" },
      ];

  for (const candidate of orderedCandidates) {
    const normalized = sanitizePayPalCounterpartyLabel(candidate.label, blockedValues);
    if (!normalized) continue;
    return {
      label: normalized,
      name: candidate.name && normalized === String(candidate.name).trim() ? normalized : "",
      email: candidate.email && normalized === String(candidate.email).trim() ? normalized : "",
      unavailable: false,
    };
  }

  return {
    label: "counterparty unavailable",
    name: "",
    email: "",
    unavailable: true,
  };
}

function normalizePayPalPartyInfo(raw, role) {
  const source = raw || {};
  const explicitName = firstNonEmpty(
    typeof source[`${role}_name`] === "string" ? source[`${role}_name`] : "",
    typeof source.name === "string" ? source.name : "",
    source[`${role}_name`]?.alternate_full_name,
    source?.payer_name?.alternate_full_name,
    source?.payee_name?.alternate_full_name,
    source.business_name,
    source.company_name,
    source.merchant_name,
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

function getPayPalCartItemNames(detail) {
  const items = Array.isArray(detail?.cart_info?.item_details) ? detail.cart_info.item_details : [];
  return items
    .map((item) => firstNonEmpty(item?.item_name, item?.item_description))
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
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

function sanitizePayPalCounterpartyLabel(value, blockedValues = new Set()) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  if (blockedValues.has(lower)) return "";
  if (isEmailValue(normalized)) return normalized;
  if (/^invoice\b/i.test(normalized) || /^event\s+t\d+$/i.test(normalized) || /^custom\b/i.test(normalized)) return "";
  if (/^\d+$/.test(normalized)) return "";
  if (/^[a-z0-9_:-]+$/i.test(normalized) && /[_:]/.test(normalized)) return "";
  if (/^[a-z0-9-]+$/i.test(normalized) && /\d/.test(normalized) && !/[aeiouаеиоуыэюя]/i.test(normalized)) return "";
  if (!/[a-zа-яё]/i.test(normalized)) return "";
  return normalized;
}

function isEmailValue(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}
