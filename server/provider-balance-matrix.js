const PROVIDERS_WITH_TRANSACTION_IMPORT = new Set(["wise", "monobank", "paypal", "privatbank", "yoomoney", "binance"]);
const PROVIDERS_WITH_CURRENT_BALANCE_REFRESH = new Set(["wise", "monobank", "paypal", "yoomoney", "binance"]);
const MANUAL_ONLY_PROVIDERS = new Set(["cash", "manual", "local", "unknown"]);
const RED_STATUSES = new Set([
  "manual_only",
  "stale_fact",
  "needs_permission",
  "not_implemented",
  "provider_error",
  "error",
  "fx_missing",
  "missing_fact",
]);

export function buildProviderBalanceMatrix({
  selectedDate = "",
  expectedProviderBalances = [],
  selectedRows = [],
  allRows = [],
  operations = [],
  providerStatuses = [],
} = {}) {
  const expected = normalizeExpectedPairs(expectedProviderBalances);
  const providerStatusByProvider = new Map((providerStatuses || []).map((row) => [
    normalizeProvider(row.provider),
    String(row.provider_current_balance_status || row.access_status || "unknown").trim() || "unknown",
  ]));
  const lastOperationByKey = buildLastOperationDateByKey(operations, selectedDate);
  const allBalanceRows = [...(allRows || []), ...(selectedRows || [])];
  const lastBalanceByKey = buildLastBalanceRowByKey(allBalanceRows, selectedDate);
  const selectedByKey = new Map((selectedRows || []).map((row) => [makeKey(row.channel, row.currency), row]));

  return expected.map((pair) => {
    const key = makeKey(pair.channel, pair.currency);
    const provider = normalizeProvider(pair.provider || inferProvider(pair.channel));
    const selected = selectedByKey.get(key) || null;
    const lastBalance = selected || lastBalanceByKey.get(key) || null;
    const lastBalanceDate = normalizeDate(lastBalance?.date) || null;
    const lastImportDate = lastOperationByKey.get(key) || null;
    const currentBalanceAuto = PROVIDERS_WITH_CURRENT_BALANCE_REFRESH.has(provider);
    const transactionImport = PROVIDERS_WITH_TRANSACTION_IMPORT.has(provider);
    const rawAccessStatus = providerStatusByProvider.get(provider) || (MANUAL_ONLY_PROVIDERS.has(provider) ? "manual_only" : "not_implemented");
    const factSource = classifyFactSource(lastBalance, provider);
    const lastFactDate = lastBalanceDate;
    const reasons = [];

    if (!currentBalanceAuto) reasons.push("current balance auto refresh unsupported");
    if (currentBalanceAuto && rawAccessStatus !== "available") reasons.push("provider token not available");
    if (!transactionImport) reasons.push("transaction import unsupported");
    if (!lastFactDate) reasons.push("missing balance fact");
    else if (selectedDate && lastFactDate < selectedDate) reasons.push("last balance fact before selected date");
    if (transactionImport && (!lastImportDate || (selectedDate && lastImportDate < selectedDate))) {
      reasons.push("last imported operation before selected date");
    }
    if (String(lastBalance?.status || "").toLowerCase() === "fx_missing") reasons.push("fx_missing");

    const accessStatus = normalizeAccessStatus(rawAccessStatus, provider);
    const staleReason = reasons.join("; ") || "";
    return {
      channel: pair.channel,
      currency: String(pair.currency || "").trim().toUpperCase(),
      provider,
      current_balance_auto: currentBalanceAuto,
      transaction_import: transactionImport,
      access_status: accessStatus,
      last_import_date: lastImportDate,
      last_balance_date: lastBalanceDate,
      last_fact_date: lastFactDate,
      last_fact_source: factSource,
      stale_reason: staleReason,
      action_required: buildActionRequired({ accessStatus, currentBalanceAuto, transactionImport, factSource, staleReason }),
      severity: resolveSeverity({ accessStatus, staleReason, factSource }),

      supports_current_balance_auto_refresh: currentBalanceAuto,
      supports_transaction_import: transactionImport,
      provider_token_status: accessStatus,
      last_successful_operation_import_date: lastImportDate,
      last_successful_balance_refresh_date: lastBalanceDate,
      last_manual_screenshot_snapshot_date: isManualFactSource(factSource) ? lastBalanceDate : null,
      source: factSource,
      stale: Boolean(staleReason),
      reason: staleReason || "fresh",
    };
  }).sort(compareProviderMatrixRows);
}

function buildLastOperationDateByKey(operations = [], selectedDate = "") {
  const map = new Map();
  for (const operation of operations || []) {
    const date = normalizeDate(operation?.date || operation?.ledgerV2?.date);
    if (!date || (selectedDate && date > selectedDate)) continue;
    for (const pair of getOperationChannelCurrencyPairs(operation)) {
      const key = makeKey(pair.channel, pair.currency);
      if (!map.has(key) || date > map.get(key)) map.set(key, date);
    }
  }
  return map;
}

function buildLastBalanceRowByKey(rows = [], selectedDate = "") {
  const map = new Map();
  for (const row of rows || []) {
    const date = normalizeDate(row?.date);
    if (!date || (selectedDate && date > selectedDate)) continue;
    const key = makeKey(row.channel || row.accountName || row.account, row.currency);
    if (!key) continue;
    const current = map.get(key);
    if (!current || compareBalanceRows(row, current) > 0) map.set(key, row);
  }
  return map;
}

function getOperationChannelCurrencyPairs(operation = {}) {
  const ledger = operation.ledgerV2 || {};
  const currency = String(ledger.currency || operation.currency || "").trim().toUpperCase();
  if (!currency) return [];
  const operationName = String(ledger.operation || operation.operation || "").trim().toLowerCase();
  const from = String(ledger.from_channel || operation.fromChannel || operation.from_channel || "").trim();
  const to = String(ledger.to_channel || operation.toChannel || operation.to_channel || "").trim();
  const fallback = String(operation.channel || operation.accountName || operation.account || "").trim();
  if (operationName === "income") return [{ channel: to || fallback, currency }];
  if (["expense", "business_expense", "personal_expense"].includes(operationName)) return [{ channel: from || fallback, currency }];
  if (operationName === "exchange_in") return [{ channel: to || fallback, currency }];
  if (operationName === "exchange_out") return [{ channel: from || fallback, currency }];
  if (["transfer", "partner_transfer"].includes(operationName)) {
    return [from, to].filter(Boolean).map((channel) => ({ channel, currency }));
  }
  return [fallback || from || to].filter(Boolean).map((channel) => ({ channel, currency }));
}

function classifyFactSource(row = {}, provider = "") {
  if (!row) return "missing";
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
    row.status,
  ].map((value) => String(value || "").trim().toLowerCase()).join(" ");
  if (/owner|manual_owner/.test(text)) return "manual_owner";
  if (/screenshot/.test(text)) return "screenshot";
  if (/авто остатки|provider|auto|wise|paypal|binance|monobank|privat|yoomoney/.test(text)) return "provider";
  if (/manual|confirmed|остатки/.test(text) || MANUAL_ONLY_PROVIDERS.has(provider)) return MANUAL_ONLY_PROVIDERS.has(provider) ? "manual_owner" : "manual";
  return "unknown";
}

function buildActionRequired({ accessStatus, currentBalanceAuto, transactionImport, factSource, staleReason }) {
  const actions = [];
  if (["needs_permission", "provider_error", "error"].includes(accessStatus)) actions.push("refresh token or provider permission");
  if (["not_implemented", "manual_only"].includes(accessStatus) || !currentBalanceAuto) actions.push("manual balance or screenshot required");
  if (!transactionImport) actions.push("manual transaction review required");
  if (!factSource || factSource === "missing" || staleReason) actions.push("refresh balance fact or enter owner-confirmed fact");
  return unique(actions).join(" / ") || "none";
}

function resolveSeverity({ accessStatus, staleReason, factSource }) {
  if (RED_STATUSES.has(accessStatus)) return "red";
  if (staleReason) return "red";
  if (!factSource || factSource === "missing") return "red";
  return "ok";
}

function normalizeAccessStatus(status, provider) {
  const normalized = String(status || "").trim().toLowerCase();
  if (MANUAL_ONLY_PROVIDERS.has(provider)) return "manual_only";
  if (normalized === "error") return "provider_error";
  return normalized || "unknown";
}

function isManualFactSource(source = "") {
  return ["manual", "manual_owner", "screenshot"].includes(String(source || "").trim());
}

function normalizeExpectedPairs(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const channel = String(row?.channel || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    if (!channel || !currency) continue;
    map.set(makeKey(channel, currency), { ...row, channel, currency });
  }
  return Array.from(map.values());
}

function inferProvider(channel = "") {
  const text = String(channel || "").toLowerCase();
  if (/wise|трансервайз|transferwise/.test(text)) return "wise";
  if (/binance|бинанс/.test(text)) return "binance";
  if (/paypal|пейпал/.test(text)) return "paypal";
  if (/mono|моно/.test(text)) return "monobank";
  if (/yandex|яндекс|yoomoney/.test(text)) return "yoomoney";
  if (/payoneer/.test(text)) return "payoneer";
  if (/privat|приват/.test(text)) return "privatbank";
  if (/revolut/.test(text)) return "revolut";
  if (/canada|td|канада/.test(text)) return "tdbank";
  if (/cash|нал/.test(text)) return "cash";
  return "unknown";
}

function normalizeProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  if (["yandex", "юмани", "yoomoney"].includes(provider)) return "yoomoney";
  if (["privat24", "privat", "privatbank"].includes(provider)) return "privatbank";
  if (["bank canada", "td", "tdbank"].includes(provider)) return "tdbank";
  return provider || "unknown";
}

function makeKey(channel, currency) {
  const normalizedChannel = String(channel || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  return normalizedChannel && normalizedCurrency ? `${normalizedChannel}|${normalizedCurrency}` : "";
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  if (iso) return iso[1];
  return "";
}

function compareBalanceRows(left, right) {
  const leftDate = normalizeDate(left?.date);
  const rightDate = normalizeDate(right?.date);
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  return sourcePriority(right) - sourcePriority(left);
}

function sourcePriority(row = {}) {
  const source = classifyFactSource(row);
  if (source === "manual_owner") return 0;
  if (source === "manual" || source === "screenshot") return 1;
  if (source === "provider") return 2;
  return 3;
}

function compareProviderMatrixRows(left, right) {
  if (left.provider !== right.provider) return left.provider.localeCompare(right.provider);
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}
