import { createHmac } from "node:crypto";

const BINANCE_BASE_URL = "https://api.binance.com";
const BINANCE_RECV_WINDOW = 5000;
const BINANCE_MAX_RANGE_DAYS = 90;
const BINANCE_ENDPOINT_WARNING = "Binance real income: endpoint/permission needs verification";

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
    const result = await fetchBinanceStatementEntries({
      startDate: payload.startDate,
      endDate: payload.endDate,
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
      baseUrl: process.env.BINANCE_API_BASE_URL || BINANCE_BASE_URL,
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

export function getBinanceProviderConfigFromEnv(env = process.env) {
  const apiKey = String(env.BINANCE_API_KEY || "").trim();
  const apiSecret = String(env.BINANCE_API_SECRET || "").trim();
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    baseUrl: String(env.BINANCE_API_BASE_URL || BINANCE_BASE_URL).trim() || BINANCE_BASE_URL
  };
}

export async function fetchBinanceStatementEntries(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  validateDateRange(startDate, endDate);
  const apiKey = String(options.apiKey || "").trim();
  const apiSecret = String(options.apiSecret || "").trim();
  if (!apiKey || !apiSecret) {
    throw new Error("Binance credentials are not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET.");
  }

  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || BINANCE_BASE_URL).replace(/\/+$/, "");
  const clock = typeof options.now === "function" ? options.now : Date.now;
  const signedOptions = { fetchImpl, baseUrl, apiKey, apiSecret, now: clock };
  const warnings = [];
  const raw = { account: null, deposits: [], withdrawals: [] };

  const account = await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/api/v3/account"
  });
  if (account.ok) {
    raw.account = account.payload || {};
  } else {
    warnings.push(formatBinanceWarning("/api/v3/account", account));
  }

  const rangeQuery = {
    startTime: String(toBinanceTime(startDate, false)),
    endTime: String(toBinanceTime(endDate, true))
  };
  const deposits = await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/sapi/v1/capital/deposit/hisrec",
    query: rangeQuery
  });
  if (deposits.ok) {
    raw.deposits = Array.isArray(deposits.payload) ? deposits.payload : [];
  } else {
    warnings.push(formatBinanceWarning("/sapi/v1/capital/deposit/hisrec", deposits));
  }

  const withdrawals = await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/sapi/v1/capital/withdraw/history",
    query: rangeQuery
  });
  if (withdrawals.ok) {
    raw.withdrawals = Array.isArray(withdrawals.payload) ? withdrawals.payload : [];
  } else {
    warnings.push(formatBinanceWarning("/sapi/v1/capital/withdraw/history", withdrawals));
  }

  if (!raw.deposits.length && !raw.withdrawals.length && warnings.length) {
    warnings.unshift(BINANCE_ENDPOINT_WARNING);
  }

  const entries = [
    ...raw.deposits.map((deposit, index) => normalizeBinanceDeposit(deposit, index)),
    ...raw.withdrawals.map((withdrawal, index) => normalizeBinanceWithdrawal(withdrawal, index))
  ].filter((entry) => entry.date && entry.localAmount > 0);

  return {
    entries,
    summary: summarizeBinanceStatementEntries(entries),
    transactionCount: raw.deposits.length + raw.withdrawals.length,
    periodStart: startDate,
    periodEnd: endDate,
    source: "binance",
    warnings: [...new Set(warnings.filter(Boolean))],
    endpointStatus: {
      account: account.ok ? "ok" : "warning",
      deposits: deposits.ok ? "ok" : "warning",
      withdrawals: withdrawals.ok ? "ok" : "warning"
    }
  };
}

export async function fetchBinanceCurrentBalances(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const apiSecret = String(options.apiSecret || "").trim();
  if (!apiKey || !apiSecret) {
    throw new Error("Binance credentials are not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET.");
  }
  const result = await fetchBinanceSignedJson({
    fetchImpl: options.fetchImpl || fetch,
    baseUrl: String(options.baseUrl || BINANCE_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    apiSecret,
    now: typeof options.now === "function" ? options.now : Date.now,
    path: "/api/v3/account"
  });
  if (!result.ok) {
    throw new Error(result.error || `Binance account request failed (${result.status || "unknown"}).`);
  }
  return normalizeBinanceCurrentBalances(result.payload);
}

export async function fetchBinanceEarnCurrentBalances(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const apiSecret = String(options.apiSecret || "").trim();
  if (!apiKey || !apiSecret) {
    throw new Error("Binance credentials are not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET.");
  }
  const signedOptions = {
    fetchImpl: options.fetchImpl || fetch,
    baseUrl: String(options.baseUrl || BINANCE_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    apiSecret,
    now: typeof options.now === "function" ? options.now : Date.now,
    query: { asset: options.asset || "USDT" },
  };
  const flexible = await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/sapi/v1/simple-earn/flexible/position",
  });
  const locked = await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/sapi/v1/simple-earn/locked/position",
  });
  const errors = [];
  if (!flexible.ok) errors.push(`/sapi/v1/simple-earn/flexible/position: ${flexible.error || `HTTP ${flexible.status || "unknown"}`}`);
  if (!locked.ok) errors.push(`/sapi/v1/simple-earn/locked/position: ${locked.error || `HTTP ${locked.status || "unknown"}`}`);
  if (errors.length === 2) {
    const error = new Error(errors.join("; "));
    error.status = flexible.status || locked.status || 0;
    throw error;
  }
  return normalizeBinanceEarnCurrentBalances({
    flexible: flexible.ok ? flexible.payload : {},
    locked: locked.ok ? locked.payload : {},
  });
}

export function normalizeBinanceCurrentBalances(account = {}) {
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  return balances
    .map((balance) => {
      const currency = normalizeBinanceCurrency(balance.asset || balance.coin);
      const free = parseBinanceSignedAmount(balance.free);
      const locked = parseBinanceSignedAmount(balance.locked);
      const amount = roundBinanceAmount(free + locked);
      return {
        id: `binance-spot-${currency}`,
        currency,
        amount,
        wallet: "spot",
        raw: balance,
      };
    })
    .filter((balance) => balance.currency && Number.isFinite(balance.amount));
}

export function normalizeBinanceEarnCurrentBalances(payload = {}) {
  const totals = new Map();
  const rows = [
    ...extractBinancePayloadRows(payload.flexible),
    ...extractBinancePayloadRows(payload.locked),
  ];
  for (const row of rows) {
    const currency = normalizeBinanceCurrency(row.asset || row.coin);
    if (!currency) continue;
    const amount = parseBinanceSignedAmount(firstNonEmpty(row.totalAmount, row.amount));
    totals.set(currency, roundBinanceAmount((totals.get(currency) || 0) + amount));
  }
  return Array.from(totals.entries())
    .map(([currency, amount]) => ({
      id: `binance-earn-${currency}`,
      currency,
      amount,
      wallet: "earn",
      raw: rows.filter((row) => normalizeBinanceCurrency(row.asset || row.coin) === currency),
    }))
    .filter((balance) => balance.currency && Number.isFinite(balance.amount));
}

function extractBinancePayloadRows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

export async function fetchBinanceSignedJson(options = {}) {
  const url = buildBinanceSignedUrl({
    baseUrl: options.baseUrl || BINANCE_BASE_URL,
    path: options.path,
    query: options.query,
    apiSecret: options.apiSecret,
    now: options.now
  });
  const upstream = await options.fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": options.apiKey,
      Accept: "application/json"
    }
  });
  const text = await upstream.text().catch(() => "");
  const payload = parseJsonPayload(text);
  if (payload === null && text.trim()) {
    return {
      ok: false,
      status: upstream.status,
      error: `Binance returned non-JSON response (${upstream.status}).`,
      code: "NON_JSON"
    };
  }
  if (!upstream.ok || payload?.code) {
    return {
      ok: false,
      status: upstream.status,
      error: String(payload?.msg || payload?.message || `Binance request failed (${upstream.status}).`),
      code: payload?.code ?? null
    };
  }
  return { ok: true, status: upstream.status, payload: payload ?? {} };
}

export function buildBinanceSignedUrl(options = {}) {
  const baseUrl = String(options.baseUrl || BINANCE_BASE_URL).replace(/\/+$/, "");
  const url = new URL(options.path || "/", baseUrl);
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  url.searchParams.set("recvWindow", String(BINANCE_RECV_WINDOW));
  url.searchParams.set("timestamp", String(typeof options.now === "function" ? options.now() : Date.now()));
  const signature = signBinanceQuery(url.searchParams.toString(), options.apiSecret);
  url.searchParams.set("signature", signature);
  return url;
}

export function signBinanceQuery(queryString, apiSecret) {
  return createHmac("sha256", String(apiSecret || "")).update(String(queryString || "")).digest("hex");
}

export function normalizeBinanceDeposit(deposit = {}, index = 0) {
  const amount = parseBinanceAmount(deposit.amount);
  const currency = normalizeBinanceCurrency(deposit.coin || deposit.asset);
  const id = firstNonEmpty(deposit.id, deposit.txId, deposit.tranId, `${currency}-${dateFromBinanceTime(deposit.completeTime || deposit.insertTime)}-${index}`);
  const date = dateFromBinanceTime(deposit.completeTime || deposit.insertTime);
  const status = String(deposit.status ?? "").trim();
  const description = compactDescription([
    "Binance deposit",
    deposit.network,
    deposit.addressTag ? `tag ${deposit.addressTag}` : "",
    deposit.txId ? `tx ${deposit.txId}` : "",
    status ? `status ${status}` : ""
  ]);
  return {
    id: `binance-deposit-${id}`,
    date,
    channel: getBinanceChannel(deposit),
    direction: "income",
    currency,
    localAmount: amount,
    grossAmount: amount,
    netAmount: amount,
    realNetUsd: isUsdLikeCurrency(currency) ? amount : null,
    feeAmount: 0,
    feeCurrency: currency,
    counterparty: firstNonEmpty(deposit.address, deposit.sourceAddress, "Binance spot deposit"),
    description,
    organization: description,
    source: "binance",
    sourceTransactionId: String(id),
    suggestedCategory: "serviceIncome",
    needsVerification: !isUsdLikeCurrency(currency),
    raw: deposit
  };
}

export function normalizeBinanceWithdrawal(withdrawal = {}, index = 0) {
  const amount = parseBinanceAmount(withdrawal.amount);
  const feeAmount = parseBinanceAmount(withdrawal.transactionFee || withdrawal.fee);
  const currency = normalizeBinanceCurrency(withdrawal.coin || withdrawal.asset);
  const id = firstNonEmpty(withdrawal.id, withdrawal.applyId, withdrawal.txId, `${currency}-${dateFromBinanceTime(withdrawal.completeTime || withdrawal.applyTime)}-${index}`);
  const date = dateFromBinanceTime(withdrawal.completeTime || withdrawal.applyTime);
  const netAmount = Math.max(0, amount - feeAmount);
  const status = String(withdrawal.status ?? "").trim();
  const description = compactDescription([
    "Binance withdrawal",
    withdrawal.network,
    withdrawal.txId ? `tx ${withdrawal.txId}` : "",
    status ? `status ${status}` : ""
  ]);
  return {
    id: `binance-withdrawal-${id}`,
    date,
    channel: getBinanceChannel(withdrawal),
    direction: "out",
    currency,
    localAmount: amount,
    grossAmount: amount,
    netAmount,
    realNetUsd: isUsdLikeCurrency(currency) ? netAmount : null,
    feeAmount,
    feeCurrency: currency,
    counterparty: firstNonEmpty(withdrawal.address, "Binance spot withdrawal"),
    description,
    organization: description,
    source: "binance",
    sourceTransactionId: String(id),
    suggestedCategory: "exchange",
    needsVerification: !isUsdLikeCurrency(currency),
    raw: withdrawal
  };
}

export function summarizeBinanceStatementEntries(entries = []) {
  const totalsByCurrency = new Map();
  for (const entry of entries || []) {
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Math.abs(Number(entry?.localAmount || 0));
    if (!currency || !amount) continue;
    if (!totalsByCurrency.has(currency)) totalsByCurrency.set(currency, { income: 0, out: 0, net: 0 });
    const totals = totalsByCurrency.get(currency);
    if (entry.direction === "income") {
      totals.income += amount;
      totals.net += amount;
    } else {
      totals.out += amount;
      totals.net -= amount;
    }
  }
  return {
    totalsByCurrency: Object.fromEntries(
      Array.from(totalsByCurrency.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, totals]) => [currency, {
          income: roundBinanceAmount(totals.income),
          out: roundBinanceAmount(totals.out),
          net: roundBinanceAmount(totals.net)
        }])
    )
  };
}

function formatBinanceWarning(path, result) {
  return `Binance real income: ${path} ${result.error || `request failed (${result.status || "unknown"})`}`;
}

function parseJsonPayload(text) {
  if (!String(text || "").trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : raw;
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) throw new Error("Select a valid Binance statement period.");
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (start > end) throw new Error("Binance statement start date must be before end date.");
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > BINANCE_MAX_RANGE_DAYS) {
    throw new Error(`Binance statement period is too large. Maximum is ${BINANCE_MAX_RANGE_DAYS} days.`);
  }
}

function toBinanceTime(date, endOfDay) {
  return new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`).getTime();
}

function dateFromBinanceTime(value) {
  if (typeof value === "number" || /^\d+$/.test(String(value || "").trim())) {
    const parsed = new Date(Number(value));
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }
  return normalizeIsoDate(String(value || "").slice(0, 10));
}

function parseBinanceAmount(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function parseBinanceSignedAmount(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBinanceCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function isUsdLikeCurrency(currency) {
  return ["USD", "USDT", "USDC", "BUSD", "FDUSD", "TUSD"].includes(String(currency || "").trim().toUpperCase());
}

function getBinanceChannel(row = {}) {
  const walletType = String(row.walletType ?? row.transferType ?? row.type ?? "").trim().toLowerCase();
  const description = `${row.sourceAddress || ""} ${row.address || ""} ${row.info || ""}`.toLowerCase();
  if (walletType.includes("earn") || walletType.includes("saving") || description.includes("save")) return "binance save";
  return "Бинанс spot";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function compactDescription(parts = []) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(" | ");
}

function roundBinanceAmount(value) {
  return Math.round((Number(value) || 0) * 100000000) / 100000000;
}
