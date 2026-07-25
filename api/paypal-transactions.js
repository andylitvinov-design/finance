const DEFAULT_PAYPAL_ENVIRONMENT = "live";
const MAX_RANGE_DAYS = 366;
const PAYPAL_PAGE_SIZE = 500;
import { normalizeManualLedgerCategory } from "../server/manual-ledger-maps.js";

const PAYPAL_MCP_BASE_URL = "https://mcp.paypal.com";
const PAYPAL_MCP_PAGE_SIZE = 100;
const DEFAULT_PAYPAL_MCP_TOOL_NAME = "list_transactions";
const PAYPAL_ERROR_EXCERPT_LENGTH = 300;
const PAYPAL_MCP_FALLBACK_ACTION = "Reconnect PayPal MCP/OAuth, or use PayPal statement file import as a fallback.";
const PAYPAL_MANUAL_IMPORT_MESSAGE = "PayPal automatic import is not available with the current provider credentials. Reconnect PayPal MCP/OAuth for personal PayPal, or use Activity/CSV import as a fallback and confirm net only when the export proves it.";
export const PAYPAL_FEE_UNAVAILABLE_WARNING = "PayPal fee unavailable due to API permissions/auth";
const PAYPAL_EXCHANGE_EVENT_CODES = new Set(["T0200", "T1105"]);
const PAYPAL_REFUND_EVENT_CODES = new Set(["T1107", "T1108", "T1109", "T1110", "T1111"]);
const PAYPAL_NON_LEDGER_EVENT_CODES = new Set(["T1501", "T1503"]);
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
    const environment = process.env.PAYPAL_ENVIRONMENT || DEFAULT_PAYPAL_ENVIRONMENT;
    const importMode = normalizePayPalImportMode(payload.importMode || process.env.PAYPAL_IMPORT_MODE);
    const restConfig = { environment, clientId, clientSecret };
    const mcpConfig = { clientId: mcpClientId, refreshToken: mcpRefreshToken };
    if (isPayPalManualImportPayload(payload)) {
      const result = parsePayPalManualActivityRows(
        payload.manualRows || payload.rows || payload.activityRows || payload.activityText || payload.text,
        {
          source: payload.source || payload.provider || payload.mode,
          netSource: payload.net_source || payload.netSource,
        }
      );
      return response.status(200).json({ ok: true, ...result });
    }
    let result;
    if (importMode === "personal_mcp") {
      if (!mcpClientId || !mcpRefreshToken) {
        return response.status(200).json(buildPayPalManualImportRequiredPayload(
          "PayPal MCP credentials are not configured. Set PAYPAL_MCP_CLIENT_ID/PAYPAL_MCP_REFRESH_TOKEN.",
          { phase: "missing_credentials", providerStatus: "credentials_missing", restConfig, mcpConfig }
        ));
      }
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
        return response.status(200).json(buildPayPalManualImportRequiredPayload(mcpError, {
          phase: getPayPalFailurePhase(mcpError, "mcp_fallback"),
          providerStatus: getPayPalProviderStatus(mcpError),
          availableMcpTools: mcpError.availableMcpTools || [],
          restConfig,
          mcpConfig
        }));
      }
    } else if (clientId && clientSecret) {
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
        if (importMode === "business_rest") {
          return response.status(200).json(buildPayPalManualImportRequiredPayload(error, {
            phase: getPayPalFailurePhase(error, "provider_import"),
            providerStatus: getPayPalProviderStatus(error),
            warnings: [buildPayPalRestFallbackWarning(error)],
            restConfig
          }));
        }
        if (!mcpClientId || !mcpRefreshToken) {
          return response.status(200).json(buildPayPalManualImportRequiredPayload(error, {
            phase: getPayPalFailurePhase(error, "missing_credentials"),
            providerStatus: getPayPalProviderStatus(error),
            warnings: [buildPayPalRestFallbackWarning(error)],
            restConfig
          }));
        }
        const restWarning = buildPayPalRestFallbackWarning(error);
        const restDiagnostics = buildPayPalRestDiagnostics(error, restConfig);
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
          return response.status(200).json(buildPayPalManualImportRequiredPayload(mcpError, {
            phase: getPayPalFailurePhase(mcpError, "mcp_fallback"),
            providerStatus: getPayPalProviderStatus(mcpError),
            warnings: [restWarning],
            availableMcpTools: mcpError.availableMcpTools || [],
            restConfig,
            paypalRest: restDiagnostics,
            mcpConfig
          }));
        }
        result = {
          ...result,
          providerStatus: restDiagnostics.providerStatus,
          phase: restDiagnostics.phase,
          paypalRest: restDiagnostics,
          warnings: uniquePayPalWarnings([
            restWarning,
            buildPayPalProviderWarning(error, { environment }),
            ...(result.warnings || [])
          ])
        };
      }
    } else {
      if (importMode === "business_rest") {
        return response.status(200).json(buildPayPalManualImportRequiredPayload(
          "PayPal REST credentials are not configured. Set PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET.",
          { phase: "missing_credentials", providerStatus: "credentials_missing", restConfig }
        ));
      }
      if (!mcpClientId || !mcpRefreshToken) {
        return response.status(200).json(buildPayPalManualImportRequiredPayload(
          "PayPal credentials are not configured. Set PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET or PAYPAL_MCP_CLIENT_ID/PAYPAL_MCP_REFRESH_TOKEN.",
          { phase: "missing_credentials", providerStatus: "credentials_missing", restConfig }
        ));
      }
      try {
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
      } catch (mcpError) {
        return response.status(200).json(buildPayPalManualImportRequiredPayload(mcpError, {
          phase: getPayPalFailurePhase(mcpError, "mcp_fallback"),
          providerStatus: getPayPalProviderStatus(mcpError),
          availableMcpTools: mcpError.availableMcpTools || [],
          restConfig,
          mcpConfig
        }));
      }
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
      provider: "paypal",
      error: "paypal_provider_unavailable",
      phase: getPayPalFailurePhase(error, "provider_import"),
      message: getPayPalSafeErrorMessage(error),
      fallback: "manual_activity_import",
      canUseManualImport: true,
      providerStatus: getPayPalProviderStatus(error),
      shortExcerpt: getPayPalSafeErrorMessage(error)
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

export async function fetchPayPalCurrentBalances(options = {}) {
  const clientId = String(options.clientId || "").trim();
  const clientSecret = String(options.clientSecret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("PayPal REST credentials are not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  }
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = getPayPalBaseUrl(options.environment, options.baseUrl);
  const accessToken = await getPayPalAccessToken({ fetchImpl, baseUrl, clientId, clientSecret });
  const url = new URL(`${baseUrl}/v1/reporting/balances`);
  const asOfTime = normalizePayPalAsOfTime(options.asOfTime || options.date);
  if (asOfTime) url.searchParams.set("as_of_time", asOfTime);
  const upstream = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Accept-Language": "en_US",
      "Content-Type": "application/json"
    }
  });
  const payload = await readJsonOrTextResponse(upstream, "PayPal balances request failed");
  if (!upstream.ok) {
    throw createPayPalApiError(
      formatPayPalUpstreamError("PayPal balances request failed", upstream.status, payload),
      { status: upstream.status, payload, phase: "balances" }
    );
  }
  return normalizePayPalCurrentBalances(payload);
}

export function normalizePayPalCurrentBalances(payload = {}) {
  const details = Array.isArray(payload?.balances)
    ? payload.balances
    : (Array.isArray(payload?.items) ? payload.items : []);
  return details
    .map((item) => {
      const candidates = [
        item?.available_balance,
        item?.availableBalance,
        item?.total_balance,
        item?.totalBalance,
        item?.balance,
        item?.amount,
      ].filter(Boolean);
      return candidates.length ? normalizePayPalBalanceAmount(candidates[0], item) : null;
    })
    .filter((balance) => balance?.currency && Number.isFinite(balance.amount));
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
    throw createPayPalApiError(
      formatPayPalUpstreamError("PayPal MCP token refresh failed", upstream.status, payload),
      { status: upstream.status, payload, phase: "mcp_token" }
    );
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

export function parsePayPalManualActivityRows(input = [], options = {}) {
  const rows = normalizePayPalManualInputRows(input);
  const entries = [];
  const warnings = [];
  let duplicateCount = 0;
  const seen = new Set();
  rows.forEach((row, index) => {
    const entry = normalizePayPalManualActivityRow(row, index, options);
    if (!entry) return;
    if (seen.has(entry.sourceTransactionId)) {
      duplicateCount += 1;
      return;
    }
    seen.add(entry.sourceTransactionId);
    entries.push(entry);
  });
  return {
    entries,
    warnings,
    summary: summarizePayPalManualEntries(entries),
    transactionCount: rows.length,
    duplicateCount,
    duplicate_count: duplicateCount,
    source: "paypal_manual"
  };
}

function isPayPalManualImportPayload(payload = {}) {
  const source = String(payload?.source || payload?.provider || payload?.mode || "").trim().toLowerCase();
  return source === "paypal_manual" ||
    source === "paypal-personal-manual" ||
    source === "paypal_personal_manual" ||
    Array.isArray(payload?.manualRows) ||
    Array.isArray(payload?.activityRows) ||
    typeof payload?.activityText === "string";
}

function normalizePayPalManualInputRows(input = []) {
  if (Array.isArray(input)) return input;
  const text = String(input || "").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map((line) => parsePayPalManualDelimitedLine(line));
  const header = rows[0]?.map((cell) => normalizePayPalManualHeader(cell)) || [];
  if (!header.includes("date") || !header.includes("amount")) return [];
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((key, index) => [key || `col_${index}`, cells[index] || ""])));
}

function parsePayPalManualDelimitedLine(line) {
  const delimiter = line.includes("\t") ? "\t" : ",";
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizePayPalManualHeader(value) {
  const token = String(value || "").trim().toLowerCase().replace(/[^0-9a-z]+/g, " ").replace(/\s+/g, " ").trim();
  if (["date", "transaction date", "posted date"].includes(token)) return "date";
  if (["name", "counterparty", "merchant", "description", "details"].includes(token)) return token === "name" ? "counterparty" : token;
  if (["amount", "net", "total"].includes(token)) return "amount";
  if (["currency", "cur"].includes(token)) return "currency";
  if (["type", "transaction type"].includes(token)) return "type";
  return token.replace(/\s+/g, "_");
}

function normalizePayPalManualActivityRow(row = {}, index = 0, options = {}) {
  const date = normalizeIsoDate(String(firstNonEmpty(row.date, row.transactionDate, row.transaction_date)).slice(0, 10));
  const counterparty = firstNonEmpty(row.counterparty, row.name, row.merchant, row.description, row.details, "PayPal manual row");
  const type = String(firstNonEmpty(row.type, row.transactionType, row.transaction_type, "")).trim();
  const parsedAmount = parsePayPalManualSignedAmount(firstNonEmpty(row.amount, row.net, row.total), row.currency);
  if (!date || !parsedAmount || !parsedAmount.currency || !parsedAmount.value) return null;
  const signedAmount = round(parsedAmount.value);
  const manuallyConfirmed = hasPayPalManualNetConfirmation(row, options);
  const isRefund = signedAmount > 0 && /refund|refunded|возврат/i.test(`${type} ${counterparty}`);
  const direction = signedAmount < 0 ? "expense" : "income";
  const entryKind = isRefund ? "refund" : "payment";
  const stableType = isRefund ? "refund" : (type || direction);
  const sourceTransactionId = `paypal_manual:${date}:${stableIdPart(counterparty)}:${stableIdPart(signedAmount)}:${parsedAmount.currency.toLowerCase()}:${stableIdPart(stableType)}`;
  const channel = getPayPalChannel(parsedAmount.currency);
  const confirmedNet = manuallyConfirmed ? signedAmount : null;
  const source = manuallyConfirmed ? "paypal_personal_manual" : "paypal_manual";
  return {
    id: sourceTransactionId,
    date,
    channel,
    direction,
    ledgerDirection: signedAmount < 0 ? "out" : "in",
    ledger_direction: signedAmount < 0 ? "out" : "in",
    localAmount: Math.abs(signedAmount),
    currency: parsedAmount.currency,
    usdAmount: parsedAmount.currency === "USD" && manuallyConfirmed ? signedAmount : null,
    grossAmount: signedAmount,
    amountGross: signedAmount,
    amount_gross: signedAmount,
    feeAmount: null,
    amountFee: "",
    amount_fee: "",
    feeCurrency: parsedAmount.currency,
    netAmount: confirmedNet,
    amountNet: confirmedNet,
    amount_net: confirmedNet,
    netSource: manuallyConfirmed ? "manual_confirmed" : "unconfirmed",
    net_source: manuallyConfirmed ? "manual_confirmed" : "unconfirmed",
    manual_confirmation_marker: manuallyConfirmed ? "manual_confirmed" : "",
    suggestedCategory: isRefund ? "business" : getPayPalSuggestedCategory(direction),
    organization: counterparty,
    counterparty,
    counterpartyName: counterparty,
    counterpartyLabel: `${signedAmount < 0 ? "Кому" : "От"}: ${counterparty}`,
    description: counterparty,
    transactionSubject: type,
    entryKind,
    operationType: isRefund ? "refund" : (signedAmount < 0 ? "payout" : "service_in"),
    operation_type: isRefund ? "refund" : (signedAmount < 0 ? "payout" : "service_in"),
    is_refund: isRefund,
    fee_missing: true,
    needs_provider_permission: true,
    confidence: 0.9,
    source,
    sourceTransactionId,
    externalId: sourceTransactionId,
    external_id: sourceTransactionId,
    rawSourceId: sourceTransactionId,
    raw_source_id: sourceTransactionId,
    rawMetadata: manuallyConfirmed
      ? "PayPal personal manual import; fee_missing=true; needs_provider_permission=true; net_source=manual_confirmed"
      : "PayPal manual import; fee_missing=true; needs_provider_permission=true; net_source=unconfirmed"
  };
}

function hasPayPalManualNetConfirmation(row = {}, options = {}) {
  const source = String(firstNonEmpty(row.source, options.source)).trim().toLowerCase().replace(/[-\s]+/g, "_");
  const netSource = String(firstNonEmpty(row.net_source, row.netSource, row.manual_confirmation_marker, options.netSource)).trim().toLowerCase().replace(/[-\s]+/g, "_");
  return source === "paypal_personal_manual" ||
    source === "personal_manual" ||
    netSource === "manual_confirmed" ||
    netSource === "manual_provider_confirmed";
}

function parsePayPalManualSignedAmount(value, explicitCurrency = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const currency = String(explicitCurrency || "").trim().toUpperCase() ||
    (upper.includes("US$") || /\bUSD\b/.test(upper) ? "USD" :
      upper.includes("€") || /\bEUR\b/.test(upper) ? "EUR" :
        /\bCAD\b/.test(upper) ? "CAD" :
          upper.includes("$") ? "USD" : "");
  const negative = /[-−]/.test(raw) || /^\s*\(/.test(raw);
  const positive = /\+/.test(raw);
  const numeric = Number.parseFloat(raw.replace(/,/g, "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return {
    value: negative ? -numeric : (positive ? numeric : numeric),
    currency
  };
}

function summarizePayPalManualEntries(entries = []) {
  const totals = new Map();
  for (const entry of entries || []) {
    const currency = String(entry.currency || "").trim().toUpperCase();
    const amount = Number(entry.amount_net ?? entry.amountNet ?? 0);
    if (!currency || !Number.isFinite(amount)) continue;
    const row = totals.get(currency) || { currency, in: 0, out: 0, rows: 0 };
    if (amount < 0) row.out += Math.abs(amount);
    else row.in += amount;
    row.rows += 1;
    totals.set(currency, row);
  }
  return {
    totalsByCurrency: Array.from(totals.values())
      .sort((left, right) => left.currency.localeCompare(right.currency))
      .map((row) => ({ ...row, in: round(row.in), out: round(row.out) }))
  };
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function stableIdPart(value) {
  const negativeNumber = typeof value === "number" && value < 0;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!normalized) return "blank";
  return negativeNumber ? `-${normalized}` : normalized;
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

function normalizePayPalImportMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  if (mode === "personal_mcp" || mode === "business_rest" || mode === "auto") return mode;
  return "auto";
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
  error.phase = "mcp_tool_not_found";
  error.userMessage = message;
  error.availableMcpTools = Array.isArray(availableMcpTools) ? availableMcpTools : [];
  error.causeMessage = getPayPalSafeErrorMessage(cause);
  error.isPayPalMcpFallbackUnavailable = true;
  return error;
}

function isPayPalMcpFallbackUnavailableError(error) {
  return Boolean(error?.isPayPalMcpFallbackUnavailable);
}

function buildPayPalManualImportRequiredPayload(error, options = {}) {
  const phase = String(options.phase || getPayPalFailurePhase(error, "provider_import")).trim() || "provider_import";
  const providerStatus = String(options.providerStatus || getPayPalProviderStatus(error)).trim() || "provider_unavailable";
  const shortExcerpt = getPayPalSafeErrorMessage(error);
  const actionRequired = getPayPalActionRequired({ providerStatus, phase, shortExcerpt });
  return {
    ok: false,
    provider: "paypal",
    error: "paypal_manual_import_required",
    phase,
    message: PAYPAL_MANUAL_IMPORT_MESSAGE,
    fallback: "manual_activity_import",
    canUseManualImport: true,
    providerStatus,
    ...(actionRequired ? { actionRequired } : {}),
    ...(actionRequired === "reconnect_paypal_mcp" ? {
      manualStep: "Open the PayPal MCP/OAuth connector authorization page, sign in once to the personal PayPal account, then store the new PAYPAL_MCP_REFRESH_TOKEN in Vercel Production."
    } : {}),
    paypalRest: options.paypalRest || buildPayPalRestDiagnostics(error, options.restConfig || {}),
    ...(options.mcpConfig ? { paypalMcp: buildPayPalMcpDiagnostics(error, options.mcpConfig) } : {}),
    shortExcerpt,
    ...(Array.isArray(options.warnings) && options.warnings.length ? { warnings: uniquePayPalWarnings(options.warnings) } : {}),
    ...(Array.isArray(options.availableMcpTools) && options.availableMcpTools.length ? { availableMcpTools: options.availableMcpTools } : {})
  };
}

function getPayPalActionRequired({ providerStatus, phase, shortExcerpt }) {
  const text = `${providerStatus || ""} ${phase || ""} ${shortExcerpt || ""}`.toLowerCase();
  if (/mcp_grant_not_found|mcp_token|grant not found|invalid_grant/.test(text)) return "reconnect_paypal_mcp";
  return "";
}

function maskPayPalClientId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function buildPayPalRestDiagnostics(error, options = {}) {
  const environment = String(options.environment || DEFAULT_PAYPAL_ENVIRONMENT).trim().toLowerCase() || DEFAULT_PAYPAL_ENVIRONMENT;
  const phase = getPayPalFailurePhase(error, "provider_import");
  return {
    providerStatus: getPayPalProviderStatus(error),
    phase,
    environment,
    baseUrl: getPayPalBaseUrl(environment),
    hasClientId: Boolean(String(options.clientId || "").trim()),
    hasClientSecret: Boolean(String(options.clientSecret || "").trim()),
    maskedClientId: maskPayPalClientId(options.clientId)
  };
}

function buildPayPalMcpDiagnostics(error, options = {}) {
  return {
    phase: getPayPalFailurePhase(error, "mcp_fallback"),
    providerStatus: getPayPalProviderStatus(error),
    hasClientId: Boolean(String(options.clientId || "").trim()),
    hasRefreshToken: Boolean(String(options.refreshToken || "").trim())
  };
}

function getPayPalFailurePhase(error, fallback = "provider_import") {
  const explicit = String(error?.paypalPhase || error?.phase || "").trim();
  if (explicit) return explicit;
  const message = String(error?.message || error || "").toLowerCase();
  if (/mcp.*tool.*not found|tool list_transactions not found|method not found/.test(message)) return "mcp_tool_not_found";
  if (/grant not found|invalid_grant/.test(message)) return "mcp_token";
  if (/mcp.*timed out|event stream timed out|request timed out/.test(message)) return "mcp_fallback";
  if (/mcp.*non-json|mcp.*empty response|mcp.*failed/.test(message)) return "mcp_fallback";
  if (/refresh token|mcp token/.test(message)) return "mcp_token";
  if (/oauth|invalid_client|client authentication|unauthorized|authentication failed/.test(message)) return "oauth";
  if (/transaction search|transaction request|reporting|permission|not_authorized|permission_denied/.test(message)) return "transaction_search";
  if (/credential|client id|client secret/.test(message)) return "missing_credentials";
  return fallback;
}

function getPayPalProviderStatus(error) {
  if (error?.isPayPalMcpFallbackUnavailable) return "mcp_tool_not_found";
  const status = Number(error?.paypalStatus || error?.status || 0);
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.paypalError || error?.paypalName || "").toLowerCase();
  if (/grant not found|invalid_grant/.test(`${message} ${code}`)) return "mcp_grant_not_found";
  if (status === 401 || /invalid_client|client authentication failed|unauthorized|authentication failed/.test(`${message} ${code}`)) return "auth_failed";
  if (/tool list_transactions not found|tool not found|method not found/.test(message)) return "mcp_tool_not_found";
  if (status === 403 || /not_authorized|permission_denied|permission denied|permission|not authorized/.test(`${message} ${code}`)) return "permission_denied";
  if (/transaction search|reporting.*unavailable|reporting.*permission|personal account|personal paypal|business account/.test(message)) return "reporting_unavailable";
  if (/timed out|non-json|empty response|no transactions found/.test(message)) return "mcp_fallback_unavailable";
  if (/credential|client id|client secret|refresh token/.test(message)) return "credentials_missing";
  return "provider_unavailable";
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
    url.searchParams.set("balance_affecting_records_only", "Y");
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
    if (shouldSkipPayPalLedgerDetail(info, entryKind)) return;
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

function shouldSkipPayPalLedgerDetail(info = {}, entryKind = "") {
  const eventCode = String(info?.transaction_event_code || "").trim().toUpperCase();
  if (PAYPAL_NON_LEDGER_EVENT_CODES.has(eventCode)) return true;
  const status = String(info?.transaction_status || "").trim().toUpperCase();
  if (status && !["S", "V"].includes(status)) return true;
  const text = [
    info?.transaction_subject,
    info?.transaction_note,
    info?.paypal_reference_id_type,
    info?.protection_eligibility
  ].map((value) => String(value || "").trim().toLowerCase()).join(" | ");
  if (entryKind !== "exchange" && /\b(pre[- ]?auth|preauthorization|authorization hold|open authorization|pending|temporary hold)\b/.test(text)) {
    return true;
  }
  return false;
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

function normalizePayPalAsOfTime(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59Z`;
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : "";
}

function normalizePayPalBalanceAmount(amountValue = {}, parent = {}) {
  const value = typeof amountValue === "object"
    ? firstNonEmpty(amountValue.value, amountValue.amount)
    : amountValue;
  const currency = String(
    typeof amountValue === "object"
      ? firstNonEmpty(amountValue.currency_code, amountValue.currency, parent.currency_code, parent.currency)
      : firstNonEmpty(parent.currency_code, parent.currency)
  ).trim().toUpperCase();
  const amount = Number.parseFloat(String(value ?? "").replace(",", "."));
  return {
    id: String(firstNonEmpty(parent.account_id, parent.accountId, parent.currency_code, currency, "paypal-balance")).trim(),
    currency,
    amount: Number.isFinite(amount) ? roundPayPalSummaryAmount(amount) : NaN,
    raw: parent,
  };
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
