import { createHmac } from "node:crypto";

const BINANCE_BASE_URL = "https://api.binance.com";
const BINANCE_RECV_WINDOW = 5000;
const BINANCE_MAX_RANGE_DAYS = 90;
const BINANCE_ENDPOINT_WARNING = "Binance real income: endpoint/permission needs verification";
export const BINANCE_SPOT_CHANNEL = "Бинанс spot";
export const BINANCE_FUNDING_CHANNEL = "Binance funding";
export const BINANCE_SAVE_CHANNEL = "binance save";
const BINANCE_WALLET_CHANNELS = new Set([BINANCE_SPOT_CHANNEL, BINANCE_FUNDING_CHANNEL, BINANCE_SAVE_CHANNEL]);

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
      csvText: payload.csvText || payload.csv || payload.transactionHistoryCsv,
      emailText: payload.emailText || payload.gmailText,
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
  const hasFallbackInput = Boolean(String(options.csvText || options.emailText || "").trim());
  if ((!apiKey || !apiSecret) && !hasFallbackInput) {
    throw new Error("Binance credentials are not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET.");
  }

  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || BINANCE_BASE_URL).replace(/\/+$/, "");
  const clock = typeof options.now === "function" ? options.now : Date.now;
  const signedOptions = { fetchImpl, baseUrl, apiKey, apiSecret, now: clock };
  const warnings = [];
  const raw = { account: null, deposits: [], withdrawals: [], pay: [], csv: [], email: [] };

  const account = apiKey && apiSecret ? await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/api/v3/account"
  }) : { ok: false, skipped: true, error: "Binance API credentials are not configured; using import fallback." };
  if (account.ok) {
    raw.account = account.payload || {};
  } else {
    warnings.push(formatBinanceWarning("/api/v3/account", account));
  }

  const rangeQuery = {
    startTime: String(toBinanceTime(startDate, false)),
    endTime: String(toBinanceTime(endDate, true))
  };
  const deposits = apiKey && apiSecret ? await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/sapi/v1/capital/deposit/hisrec",
    query: rangeQuery
  }) : { ok: false, skipped: true, error: "Binance API credentials are not configured; using import fallback." };
  if (deposits.ok) {
    raw.deposits = Array.isArray(deposits.payload) ? deposits.payload : [];
  } else {
    warnings.push(formatBinanceWarning("/sapi/v1/capital/deposit/hisrec", deposits));
  }

  const withdrawals = apiKey && apiSecret ? await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/sapi/v1/capital/withdraw/history",
    query: rangeQuery
  }) : { ok: false, skipped: true, error: "Binance API credentials are not configured; using import fallback." };
  if (withdrawals.ok) {
    raw.withdrawals = Array.isArray(withdrawals.payload) ? withdrawals.payload : [];
  } else {
    warnings.push(formatBinanceWarning("/sapi/v1/capital/withdraw/history", withdrawals));
  }

  const pay = apiKey && apiSecret ? await fetchBinanceSignedJson({
    ...signedOptions,
    path: "/sapi/v1/pay/transactions",
    query: { ...rangeQuery, limit: "100" }
  }) : { ok: false, skipped: true, error: "Binance API credentials are not configured; using import fallback." };
  if (pay.ok) {
    raw.pay = extractBinancePayloadRows(pay.payload);
  } else {
    warnings.push(formatBinanceWarning("/sapi/v1/pay/transactions", pay));
    warnings.push("Binance Pay operations may be missing; use Gmail/CSV fallback.");
  }

  if (!raw.deposits.length && !raw.withdrawals.length && !raw.pay.length && warnings.length) {
    warnings.unshift(BINANCE_ENDPOINT_WARNING);
  }

  if (String(options.csvText || "").trim()) {
    raw.csv = parseBinanceTransactionHistoryCsv(options.csvText);
  }
  if (String(options.emailText || "").trim()) {
    raw.email = parseBinanceTransactionalEmailText(options.emailText);
  }

  const entries = [
    ...raw.deposits.map((deposit, index) => normalizeBinanceDeposit(deposit, index)),
    ...raw.withdrawals.map((withdrawal, index) => normalizeBinanceWithdrawal(withdrawal, index)),
    ...raw.pay.map((payTransaction, index) => normalizeBinancePayTransaction(payTransaction, index)),
    ...raw.csv.flatMap((csvRow, index) => normalizeBinanceCsvTransaction(csvRow, index)),
    ...raw.email.flatMap((emailRow, index) => normalizeBinanceCsvTransaction(emailRow, index))
  ].filter((entry) => entry.date && entry.localAmount > 0);
  const dedupedEntries = dedupeBinanceEntries(entries);

  return {
    entries: dedupedEntries,
    summary: summarizeBinanceStatementEntries(dedupedEntries),
    transactionCount: raw.deposits.length + raw.withdrawals.length + raw.pay.length + raw.csv.length + raw.email.length,
    periodStart: startDate,
    periodEnd: endDate,
    source: "binance",
    warnings: [...new Set(warnings.filter(Boolean))],
    endpointStatus: {
      account: account.ok ? "ok" : "warning",
      deposits: deposits.ok ? "ok" : "warning",
      withdrawals: withdrawals.ok ? "ok" : "warning",
      pay: pay.ok ? "ok" : "warning",
      csv: raw.csv.length ? "ok" : "not_provided",
      email: raw.email.length ? "ok" : "not_provided"
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
  if (Array.isArray(payload?.data)) return payload.data;
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
  const hasErrorCode = payload?.code !== undefined && payload?.code !== null && String(payload.code) !== "000000";
  if (!upstream.ok || hasErrorCode || payload?.success === false) {
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
    channel: BINANCE_SPOT_CHANNEL,
    toChannel: BINANCE_SPOT_CHANNEL,
    operation: "income",
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
    source: "binance_deposit",
    sourceTransactionId: buildBinanceGenericRawSourceId("binance_deposit", { dateTime: deposit.completeTime || deposit.insertTime, amount, currency, detail: id }),
    externalId: buildBinanceGenericRawSourceId("binance_deposit", { dateTime: deposit.completeTime || deposit.insertTime, amount, currency, detail: id }),
    rawSourceId: buildBinanceGenericRawSourceId("binance_deposit", { dateTime: deposit.completeTime || deposit.insertTime, amount, currency, detail: id }),
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
    channel: BINANCE_SPOT_CHANNEL,
    fromChannel: BINANCE_SPOT_CHANNEL,
    operation: "expense",
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
    source: "binance_withdrawal",
    sourceTransactionId: buildBinanceGenericRawSourceId("binance_withdrawal", { dateTime: withdrawal.completeTime || withdrawal.applyTime, amount: netAmount || amount, currency, detail: id }),
    externalId: buildBinanceGenericRawSourceId("binance_withdrawal", { dateTime: withdrawal.completeTime || withdrawal.applyTime, amount: netAmount || amount, currency, detail: id }),
    rawSourceId: buildBinanceGenericRawSourceId("binance_withdrawal", { dateTime: withdrawal.completeTime || withdrawal.applyTime, amount: netAmount || amount, currency, detail: id }),
    suggestedCategory: "exchange",
    needsVerification: !isUsdLikeCurrency(currency),
    raw: withdrawal
  };
}

export function normalizeBinancePayTransaction(transaction = {}, index = 0) {
  const signedAmount = parseBinanceSignedAmount(firstNonEmpty(transaction.amount, transaction.orderAmount));
  const amount = Math.abs(signedAmount);
  const currency = normalizeBinanceCurrency(transaction.currency || transaction.asset || transaction.coin);
  const transactionTime = firstNonEmpty(transaction.transactionTime, transaction.time, transaction.createTime);
  const date = dateFromBinanceTime(transactionTime);
  const direction = signedAmount >= 0 ? "income" : "out";
  const channel = direction === "income" ? BINANCE_FUNDING_CHANNEL : getBinanceChannel(transaction, { fallback: BINANCE_SPOT_CHANNEL });
  const counterparty = getBinancePayCounterparty(transaction, direction);
  const id = firstNonEmpty(
    transaction.transactionId,
    transaction.orderId,
    transaction.payId,
    transaction.merchantTradeNo,
    `${direction}:${transactionTime}:${amount}:${currency}:${counterparty || index}`
  );
  const operationLabel = direction === "income" ? "Receive Crypto" : "Send Crypto";
  const description = compactDescription([
    `Binance Pay ${operationLabel}${counterparty ? ` ${direction === "income" ? "from" : "to"} ${counterparty}` : ""}`,
    transaction.orderType ? `type ${transaction.orderType}` : "",
    transaction.status ? `status ${transaction.status}` : ""
  ]);
  const rawSourceId = buildBinancePayRawSourceId({
    direction,
    transactionTime,
    amount,
    currency,
    counterparty,
    fallbackId: id
  });
  return {
    id: `binance-pay-${id}`,
    date,
    channel,
    fromChannel: direction === "out" ? channel : "",
    toChannel: direction === "income" ? channel : "",
    operation: direction === "income" ? "income" : "expense",
    direction,
    currency,
    localAmount: amount,
    grossAmount: amount,
    netAmount: direction === "income" ? amount : -amount,
    realNetUsd: direction === "income" && isUsdLikeCurrency(currency) ? amount : null,
    feeAmount: 0,
    feeCurrency: currency,
    counterparty: counterparty || (direction === "income" ? "Binance Pay sender" : "Binance Pay recipient"),
    description,
    organization: description,
    source: "binance_pay",
    sourceTransactionId: rawSourceId,
    externalId: rawSourceId,
    rawSourceId,
    suggestedCategory: direction === "income" ? "serviceIncome" : "business",
    needsVerification: !counterparty || !isUsdLikeCurrency(currency),
    raw: transaction
  };
}

export function parseBinanceTransactionHistoryCsv(text = "") {
  const rows = parseDelimitedRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(normalizeHeaderName);
  return rows.slice(1)
    .map((cells, index) => {
      const row = {};
      header.forEach((key, cellIndex) => {
        if (key) row[key] = String(cells[cellIndex] || "").trim();
      });
      row.__rowIndex = index;
      row.__rowHash = hashSourceRow(cells.join("|"));
      return row;
    })
    .filter((row) => row.date || row.time || row.datetime || row.operation || row.change || row.amount);
}

export function parseBinanceTransactionalEmailText(text = "") {
  const raw = String(text || "");
  if (!/binance/i.test(raw)) return [];
  if (/security|login|password|device|marketing|newsletter|promotion/i.test(raw)) return [];
  const match = raw.match(/(receive|received|send|sent|deposit|withdrawal|interest)[\s\S]{0,160}?([+-]?\d+(?:[.,]\d+)?)\s*(USDT|USDC|USD|BUSD|FDUSD|TUSD)/i);
  if (!match) return [];
  const dateMatch = raw.match(/20\d{2}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/);
  return [{
    account: /funding|pay/i.test(raw) ? "Funding" : "",
    operation: match[1],
    change: match[2],
    coin: match[3],
    time: dateMatch ? dateMatch[0] : "",
    remark: raw.replace(/\s+/g, " ").slice(0, 240),
    status: "email_evidence",
    __rowIndex: 0,
    __rowHash: hashSourceRow(raw),
  }];
}

export function normalizeBinanceCsvTransaction(row = {}, index = 0) {
  const operationRaw = firstNonEmpty(row.operation, row.type, row.action);
  let operation = normalizeBinanceOperation(operationRaw);
  const currency = normalizeBinanceCurrency(firstNonEmpty(row.coin, row.asset, row.currency));
  const signedAmount = parseBinanceSignedAmount(firstNonEmpty(row.change, row.amount, row.value));
  const amount = Math.abs(signedAmount);
  if (operation === "pay") operation = signedAmount >= 0 ? "pay_receive" : "pay_send";
  const time = firstNonEmpty(row.time, row.datetime, row.date);
  const date = dateFromBinanceTime(time);
  const accountChannel = resolveBinanceAccountChannel(firstNonEmpty(row.account, row.wallet, row.wallet_type));
  const remark = firstNonEmpty(row.remark, row.notes, row.description, row.status);
  const rowHash = row.__rowHash || hashSourceRow(JSON.stringify(row));
  const counterparty = extractCounterparty(remark);
  if ((!operation || operation === "send") && /^send$/i.test(String(operationRaw || "").trim()) && /binance pay/i.test(remark)) {
    operation = signedAmount >= 0 ? "pay_receive" : "pay_send";
  }

  if (!date || !currency || !amount || !operation) {
    return buildAmbiguousBinanceEntry({ row, index, date, currency, amount, operation, reason: "missing required Binance CSV fields" });
  }

  if (operation === "pay_receive") {
    const channel = accountChannel === BINANCE_SPOT_CHANNEL ? BINANCE_SPOT_CHANNEL : BINANCE_FUNDING_CHANNEL;
    const rawSourceId = buildBinanceGenericRawSourceId("binance_pay_receive", { dateTime: time, amount, currency, detail: counterparty || rowHash });
    return buildBinanceEntry({
      id: rawSourceId,
      date,
      operation: "income",
      direction: "income",
      channel,
      toChannel: channel,
      amount,
      currency,
      source: "binance_pay",
      rawSourceId,
      category: "serviceIncome",
      counterparty,
      description: compactDescription(["Binance Pay Receive", remark]),
      needsVerification: !counterparty || !accountChannel,
      comment: accountChannel ? `wallet evidence: ${accountChannel}` : "needs wallet evidence: defaulted Binance Pay Receive to Funding"
    });
  }

  if (operation === "pay_send") {
    const channel = accountChannel || BINANCE_SPOT_CHANNEL;
    const rawSourceId = buildBinanceGenericRawSourceId("binance_pay_send", { dateTime: time, amount, currency, detail: counterparty || rowHash });
    return buildBinanceEntry({
      id: rawSourceId,
      date,
      operation: "expense",
      direction: "out",
      channel,
      fromChannel: channel,
      amount,
      currency,
      source: "binance_pay",
      rawSourceId,
      category: "business",
      counterparty,
      description: compactDescription(["Binance Pay Send", remark]),
      needsVerification: !accountChannel,
      comment: accountChannel ? `wallet evidence: ${accountChannel}` : "needs wallet evidence: defaulted Binance Pay Send to Spot"
    });
  }

  if (operation === "deposit") {
    const rawSourceId = buildBinanceGenericRawSourceId("binance_deposit", { dateTime: time, amount, currency, detail: firstNonEmpty(row.txid, row.tx_id, rowHash) });
    return buildBinanceEntry({
      id: rawSourceId,
      date,
      operation: "income",
      direction: "income",
      channel: BINANCE_SPOT_CHANNEL,
      toChannel: BINANCE_SPOT_CHANNEL,
      amount,
      currency,
      source: "binance_deposit",
      rawSourceId,
      category: "serviceIncome",
      description: compactDescription(["Binance Deposit", remark]),
      comment: "wallet evidence: deposit to Spot"
    });
  }

  if (operation === "withdrawal") {
    const rawSourceId = buildBinanceGenericRawSourceId("binance_withdrawal", { dateTime: time, amount, currency, detail: firstNonEmpty(row.txid, row.tx_id, rowHash) });
    return buildBinanceEntry({
      id: rawSourceId,
      date,
      operation: "expense",
      direction: "out",
      channel: BINANCE_SPOT_CHANNEL,
      fromChannel: BINANCE_SPOT_CHANNEL,
      amount,
      currency,
      source: "binance_withdrawal",
      rawSourceId,
      category: "exchange",
      description: compactDescription(["Binance Withdrawal", remark]),
      comment: "wallet evidence: withdrawal from Spot"
    });
  }

  if (operation === "funding_transfer") {
    const channel = accountChannel || "";
    const rawSourceId = buildBinanceGenericRawSourceId("binance_internal_transfer", { dateTime: time, amount, currency, detail: `${time}:${amount}:${currency}` });
    const isOut = signedAmount < 0;
    return buildBinanceEntry({
      id: `${rawSourceId}:${isOut ? "out" : "in"}:${channel || rowHash}`,
      date,
      operation: "transfer",
      direction: isOut ? "out" : "income",
      channel,
      fromChannel: isOut ? channel : "",
      toChannel: isOut ? "" : channel,
      amount,
      currency,
      source: "binance_csv",
      rawSourceId: `${rawSourceId}:${isOut ? "out" : "in"}:${channel || rowHash}`,
      transferGroupId: rawSourceId,
      category: "exchange",
      description: compactDescription(["Binance internal wallet transfer", remark]),
      needsVerification: !channel,
      comment: channel ? "wallet evidence: Transfer Between Main and Funding Wallet" : "needs wallet evidence: internal Binance transfer wallet missing"
    });
  }

  if (operation === "earn_subscribe") {
    const fromChannel = accountChannel && accountChannel !== BINANCE_SAVE_CHANNEL ? accountChannel : "";
    const rawSourceId = buildBinanceGenericRawSourceId("binance_earn_subscribe", { dateTime: time, amount, currency, detail: rowHash });
    return [
      buildBinanceEntry({
        id: `${rawSourceId}:out`,
        date,
        operation: "transfer",
        direction: "out",
        channel: fromChannel || "",
        fromChannel,
        amount,
        currency,
        source: "binance_csv",
        rawSourceId: `${rawSourceId}:out`,
        transferGroupId: rawSourceId,
        category: "exchange",
        description: compactDescription(["Simple Earn Subscribe out", remark]),
        needsVerification: !fromChannel,
        comment: fromChannel ? `wallet evidence: ${fromChannel} -> ${BINANCE_SAVE_CHANNEL}` : "needs wallet evidence: Earn Subscribe source wallet missing"
      }),
      buildBinanceEntry({
        id: `${rawSourceId}:in`,
        date,
        operation: "transfer",
        direction: "income",
        channel: BINANCE_SAVE_CHANNEL,
        toChannel: BINANCE_SAVE_CHANNEL,
        amount,
        currency,
        source: "binance_csv",
        rawSourceId: `${rawSourceId}:in`,
        transferGroupId: rawSourceId,
        category: "exchange",
        description: compactDescription(["Simple Earn Subscribe in", remark]),
        needsVerification: !fromChannel,
        comment: fromChannel ? `wallet evidence: ${fromChannel} -> ${BINANCE_SAVE_CHANNEL}` : "needs wallet evidence: Earn Subscribe source wallet missing"
      })
    ];
  }

  if (operation === "earn_redemption") {
    const toChannel = accountChannel && accountChannel !== BINANCE_SAVE_CHANNEL ? accountChannel : "";
    const rawSourceId = buildBinanceGenericRawSourceId("binance_earn_redemption", { dateTime: time, amount, currency, detail: rowHash });
    return [
      buildBinanceEntry({
        id: `${rawSourceId}:out`,
        date,
        operation: "transfer",
        direction: "out",
        channel: BINANCE_SAVE_CHANNEL,
        fromChannel: BINANCE_SAVE_CHANNEL,
        amount,
        currency,
        source: "binance_csv",
        rawSourceId: `${rawSourceId}:out`,
        transferGroupId: rawSourceId,
        category: "exchange",
        description: compactDescription(["Simple Earn Redemption out", remark]),
        needsVerification: !toChannel,
        comment: toChannel ? `wallet evidence: ${BINANCE_SAVE_CHANNEL} -> ${toChannel}` : "needs wallet evidence: Earn Redemption target wallet missing"
      }),
      buildBinanceEntry({
        id: `${rawSourceId}:in`,
        date,
        operation: "transfer",
        direction: "income",
        channel: toChannel || "",
        toChannel,
        amount,
        currency,
        source: "binance_csv",
        rawSourceId: `${rawSourceId}:in`,
        transferGroupId: rawSourceId,
        category: "exchange",
        description: compactDescription(["Simple Earn Redemption in", remark]),
        needsVerification: !toChannel,
        comment: toChannel ? `wallet evidence: ${BINANCE_SAVE_CHANNEL} -> ${toChannel}` : "needs wallet evidence: Earn Redemption target wallet missing"
      })
    ];
  }

  if (operation === "earn_interest") {
    const channel = accountChannel || BINANCE_SAVE_CHANNEL;
    const rawSourceId = buildBinanceGenericRawSourceId("binance_earn_interest", { dateTime: time, amount, currency, detail: rowHash });
    return buildBinanceEntry({
      id: rawSourceId,
      date,
      operation: "income",
      direction: "income",
      channel,
      toChannel: channel,
      amount,
      currency,
      source: "binance_earn_interest",
      rawSourceId,
      category: "serviceIncome",
      description: compactDescription(["Simple Earn Interest", remark]),
      needsVerification: !accountChannel,
      comment: accountChannel ? `wallet evidence: interest credited to ${accountChannel}` : "needs wallet evidence: defaulted Earn interest to Save"
    });
  }

  return buildAmbiguousBinanceEntry({ row, index, date, currency, amount, operation, reason: `unmapped Binance operation: ${operationRaw}` });
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

function getBinancePayCounterparty(transaction = {}, direction = "") {
  const payer = transaction.payerInfo || {};
  const receiver = transaction.receiverInfo || {};
  const counterparty = direction === "income" ? payer : receiver;
  return firstNonEmpty(
    counterparty.name,
    counterparty.nickname,
    counterparty.email,
    counterparty.accountId,
    counterparty.binanceId,
    transaction.counterparty,
    transaction.counterpartyName,
    transaction.from,
    transaction.to,
    transaction.note
  );
}

function buildBinanceEntry({
  id,
  date,
  operation,
  direction,
  channel,
  fromChannel = "",
  toChannel = "",
  amount,
  currency,
  source,
  rawSourceId,
  transferGroupId = "",
  category = "",
  counterparty = "",
  description = "",
  needsVerification = false,
  comment = "",
}) {
  const signedNet = direction === "out" ? -Math.abs(amount) : Math.abs(amount);
  return {
    id,
    date,
    operation,
    channel,
    fromChannel,
    toChannel,
    direction,
    currency,
    localAmount: Math.abs(amount),
    grossAmount: Math.abs(amount),
    netAmount: signedNet,
    amountNet: signedNet,
    amount_net: signedNet,
    realNetUsd: direction === "income" && isUsdLikeCurrency(currency) ? Math.abs(amount) : null,
    feeAmount: 0,
    feeCurrency: currency,
    counterparty,
    description,
    organization: description,
    source,
    sourceTransactionId: rawSourceId,
    externalId: rawSourceId,
    rawSourceId,
    transferGroupId,
    transfer_group_id: transferGroupId,
    suggestedCategory: category,
    category,
    needsVerification,
    reviewStatus: needsVerification ? "needs_verification" : "",
    comment,
  };
}

function buildAmbiguousBinanceEntry({ row = {}, index = 0, date = "", currency = "", amount = 0, operation = "", reason = "" }) {
  const rawSourceId = `binance_needs_verification:${date || "no-date"}:${currency || "no-currency"}:${row.__rowHash || index}`;
  return {
    id: rawSourceId,
    date,
    operation: "needs_verification",
    channel: "",
    fromChannel: "",
    toChannel: "",
    direction: "neutral",
    currency,
    localAmount: Math.abs(amount),
    grossAmount: Math.abs(amount),
    netAmount: 0,
    feeAmount: 0,
    source: "binance_csv",
    sourceTransactionId: rawSourceId,
    externalId: rawSourceId,
    rawSourceId,
    suggestedCategory: "extra",
    needsVerification: true,
    reviewStatus: "needs_verification",
    description: reason,
    comment: reason,
    raw: row,
  };
}

function buildBinancePayRawSourceId({ direction, transactionTime, amount, currency, counterparty, fallbackId }) {
  const type = direction === "income" ? "receive" : "send";
  const timestamp = isoTimestampFromBinanceTime(transactionTime);
  const normalizedCounterparty = String(counterparty || "unknown").trim().replace(/\s+/g, " ");
  if (timestamp && amount && currency) {
    return `binance_pay_${type}:${timestamp}:${roundBinanceAmount(amount)}:${currency}:${normalizedCounterparty}`;
  }
  return `binance_pay_${type}:${fallbackId}`;
}

function buildBinanceGenericRawSourceId(prefix, { dateTime, amount, currency, detail }) {
  const timestamp = isoTimestampFromBinanceTime(dateTime) || String(dateTime || "").trim() || "unknown-time";
  const normalizedDetail = String(detail || "unknown").trim().replace(/\s+/g, " ");
  return `${prefix}:${timestamp}:${roundBinanceAmount(amount)}:${currency}:${normalizedDetail}`;
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
  const parsed = parseBinanceCsvDateTime(value);
  return parsed ? parsed.slice(0, 10) : "";
}

function isoTimestampFromBinanceTime(value) {
  if (typeof value === "number" || /^\d+$/.test(String(value || "").trim())) {
    const parsed = new Date(Number(value));
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().replace(".000Z", "Z");
  }
  const raw = String(value || "").trim();
  if (!raw) return "";
  const csvTimestamp = parseBinanceCsvDateTime(raw);
  if (csvTimestamp) return csvTimestamp;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().replace(".000Z", "Z");
}

function parseBinanceCsvDateTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2,4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return "";
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const iso = `${year}-${match[2]}-${match[3]}T${match[4] || "00"}:${match[5] || "00"}:${match[6] || "00"}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().replace(".000Z", "Z");
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

function getBinanceChannel(row = {}, options = {}) {
  const accountChannel = resolveBinanceAccountChannel(firstNonEmpty(row.account, row.accountType, row.wallet, row.walletType, row.transferType, row.type));
  if (accountChannel) return accountChannel;
  const description = `${row.sourceAddress || ""} ${row.address || ""} ${row.info || ""} ${row.remark || ""}`.toLowerCase();
  if (/earn|saving|savings|simple earn|flexible|locked|save/.test(description)) return BINANCE_SAVE_CHANNEL;
  if (/funding|pay wallet|binance pay/.test(description)) return BINANCE_FUNDING_CHANNEL;
  return options.fallback || BINANCE_SPOT_CHANNEL;
}

function resolveBinanceAccountChannel(value) {
  const token = normalizeLookupText(value);
  if (!token) return "";
  if (["spot", "api", "account", "binance spot", "main"].includes(token)) return BINANCE_SPOT_CHANNEL;
  if (["funding", "funding wallet", "binance funding", "pay", "pay wallet", "binance pay", "2"].includes(token)) return BINANCE_FUNDING_CHANNEL;
  if (["earn", "simple earn", "flexible earn", "locked earn", "saving", "savings", "save", "5"].includes(token)) return BINANCE_SAVE_CHANNEL;
  return "";
}

function normalizeBinanceOperation(value) {
  const token = normalizeLookupText(value);
  if (!token) return "";
  if (/pay/.test(token) && /\b(receive|received|in)\b/.test(token)) return "pay_receive";
  if (/pay/.test(token) && /\b(send|sent|out)\b/.test(token)) return "pay_send";
  if (/pay/.test(token)) return "pay";
  if (/deposit/.test(token)) return "deposit";
  if (/withdraw|withdrawal/.test(token)) return "withdrawal";
  if (/transfer between main and funding wallet|main.*funding|funding.*main/.test(token)) return "funding_transfer";
  if (/subscribe|subscription|purchase/.test(token) && /earn|saving|savings|simple/.test(token)) return "earn_subscribe";
  if (/redeem|redemption/.test(token) && /earn|saving|savings|simple/.test(token)) return "earn_redemption";
  if (/interest|reward|distribution/.test(token) && /earn|saving|savings|simple/.test(token)) return "earn_interest";
  if (/simple earn flexible subscription|simple earn locked subscription/.test(token)) return "earn_subscribe";
  if (/simple earn flexible redemption|simple earn locked redemption/.test(token)) return "earn_redemption";
  if (/simple earn flexible interest|simple earn locked interest/.test(token)) return "earn_interest";
  return token;
}

function extractCounterparty(value) {
  const raw = String(value || "").trim();
  const binancePay = raw.match(/binance pay\s*-\s*([^|,;\s]+)/i);
  if (binancePay?.[1]) return binancePay[1].trim();
  const match = raw.match(/(?:from|to|counterparty|контрагент)[:\s]+([^|,;]+)/i);
  return String(match?.[1] || "").trim();
}

function parseDelimitedRows(text = "") {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = raw.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}

function normalizeHeaderName(value) {
  const token = normalizeLookupText(value);
  if (["time", "utc time"].includes(token)) return "time";
  if (["date", "datetime", "date time"].includes(token)) return token === "date" ? "date" : "datetime";
  if (["account", "wallet", "wallet type"].includes(token)) return token.replace(/\s+/g, "_");
  if (["coin", "asset", "currency"].includes(token)) return token === "asset" ? "coin" : token;
  if (["operation", "type", "action"].includes(token)) return token;
  if (["change", "amount", "value"].includes(token)) return token;
  if (["remark", "remarks", "note", "notes", "description"].includes(token)) return token.replace(/s$/, "");
  if (["status"].includes(token)) return token;
  if (["txid", "tx id", "transaction id"].includes(token)) return token.replace(/\s+/g, "_");
  return token.replace(/\s+/g, "_");
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashSourceRow(value) {
  return createHmac("sha256", "binance-row").update(String(value || "")).digest("hex").slice(0, 16);
}

function dedupeBinanceEntries(entries = []) {
  const seen = new Set();
  const output = [];
  for (const entry of entries || []) {
    const key = String(entry.rawSourceId || entry.sourceTransactionId || entry.id || "").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    output.push(entry);
  }
  return output;
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
