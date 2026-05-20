import { fetchWiseBalances } from "../api/wise-transactions.js";
import { fetchMonobankClientInfo } from "../api/monobank-transactions.js";
import { fetchPayPalCurrentBalances } from "../api/paypal-transactions.js";
import { fetchYooMoneyCurrentBalance } from "../api/yoomoney-transactions.js";
import {
  fetchBinanceCurrentBalances,
  fetchBinanceEarnCurrentBalances,
  getBinanceProviderConfigFromEnv,
} from "./binance-transactions.js";
import {
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
  loadManualRepositoryFromGoogleSheets,
} from "./manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const AUTO_BALANCE_SHEET_NAME = "Авто Остатки";
export const AUTO_BALANCE_HEADERS = ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"];
const SNAPSHOT_COMMENT = "auto daily provider snapshot";
const PAYPAL_MANUAL_BALANCE_SOURCE = "paypal_manual_balance";
const PAYPAL_MANUAL_CONFIRMED_BALANCE_SOURCE = "paypal_manual_confirmed_balance";
const PAYPAL_DERIVED_BALANCE_SOURCE = "paypal_derived_balance";
const PAYPAL_MANUAL_BALANCE_COMMENT = "manual PayPal balance because REST balance API unavailable for personal account";
const PAYPAL_DERIVED_BALANCE_COMMENT_PREFIX = "Derived from latest confirmed PayPal balance";
const PAYPAL_DERIVED_BALANCE_COMMENT_SUFFIX = "plus Ledger amount_net movements because PayPal REST balance API is unavailable for this account.";
const PAYPAL_DERIVED_CHANNELS = [
  { provider: "paypal", channel: "пейпал дол", currency: "USD", source: PAYPAL_DERIVED_BALANCE_SOURCE },
  { provider: "paypal", channel: "пейпал евр", currency: "EUR", source: PAYPAL_DERIVED_BALANCE_SOURCE },
  { provider: "paypal", channel: "пейпал сad", currency: "CAD", source: PAYPAL_DERIVED_BALANCE_SOURCE },
];
const FALLBACK_USD_RATES = {
  USD: 1,
  EUR: 1.16,
  CAD: 0.74,
  UAH: 1 / 43.86,
  RUB: 1 / 84.5563,
  USDT: 1,
};

export const EXPECTED_PROVIDER_BALANCES = [
  { provider: "wise", channel: "трансервайз дол", currency: "USD", source: "wise_auto" },
  { provider: "wise", channel: "трансервайз евро", currency: "EUR", source: "wise_auto" },
  { provider: "monobank", channel: "монобанк грн", currency: "UAH", source: "monobank_auto" },
  { provider: "paypal", channel: "пейпал дол", currency: "USD", source: "paypal_auto" },
  { provider: "paypal", channel: "пейпал евр", currency: "EUR", source: "paypal_auto" },
  { provider: "paypal", channel: "пейпал сad", currency: "CAD", source: "paypal_auto" },
  { provider: "privatbank", channel: "приват 24-дол", currency: "USD", source: "privatbank_auto" },
  { provider: "privatbank", channel: "приват 24-евро", currency: "EUR", source: "privatbank_auto" },
  { provider: "privatbank", channel: "приват 24-грн", currency: "UAH", source: "privatbank_auto" },
  { provider: "privatbank", channel: "приват-фоп", currency: "UAH", source: "privatbank_auto" },
  { provider: "yoomoney", channel: "Яндекс руб", currency: "RUB", source: "yoomoney_auto" },
  { provider: "binance", channel: "Бинанс spot", currency: "USDT", source: "binance_auto" },
  { provider: "binance", channel: "binance save", currency: "USDT", source: "binance_auto" },
  { provider: "tdbank", channel: "БАНК КАНАДА cad", currency: "CAD", source: "tdbank_auto" },
  { provider: "payoneer", channel: "Payoneer - eur", currency: "EUR", source: "payoneer_auto" },
  { provider: "payoneer", channel: "Payoneer - dol", currency: "USD", source: "payoneer_auto" },
  { provider: "revolut", channel: "REVOLUT дол", currency: "USD", source: "revolut_auto" },
];

export function getProviderCurrentBalanceCapabilities(env = process.env) {
  return [
    {
      provider: "wise",
      provider_current_balance_status: String(env.WISE_API_TOKEN || "").trim() ? "available" : "needs_permission",
    },
    {
      provider: "monobank",
      provider_current_balance_status: String(env.MONOBANK_API_TOKEN || "").trim() ? "available" : "needs_permission",
    },
    {
      provider: "paypal",
      provider_current_balance_status: String(env.PAYPAL_CLIENT_ID || "").trim() && String(env.PAYPAL_CLIENT_SECRET || "").trim()
        ? "available"
        : "needs_permission",
    },
    { provider: "privatbank", provider_current_balance_status: "not_implemented" },
    {
      provider: "yoomoney",
      provider_current_balance_status: String(env.YOOMONEY_ACCESS_TOKEN || "").trim() ? "available" : "needs_permission",
    },
    {
      provider: "binance",
      provider_current_balance_status: getBinanceProviderConfigFromEnv(env) ? "available" : "needs_permission",
    },
    { provider: "tdbank", provider_current_balance_status: "not_implemented" },
    { provider: "payoneer", provider_current_balance_status: "not_implemented" },
    { provider: "revolut", provider_current_balance_status: "not_implemented" },
  ];
}

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "GET") {
    return response.status(405).json(buildStructuredError("method_not_allowed", `Unsupported method: ${request.method}`));
  }

  const result = await runAutoBalanceSnapshots({
    query: request.query || {},
    env: process.env,
    fetchImpl: fetch,
  });
  return response.status(result.ok ? 200 : 500).json(result);
}

export async function runAutoBalanceSnapshots(options = {}) {
  const query = options.query || {};
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const date = normalizeIsoDate(query.date) || todayUtcDate();
  const dryRun = isTruthy(query.dryRun);
  const warnings = [];
  const providerResults = await collectProviderBalanceRows({ date, env, fetchImpl });
  const rows = providerResults.flatMap((result) => result.rows || []);
  const skippedRows = providerResults.flatMap((result) => result.skipped_rows || []);

  if (!rows.length) {
    warnings.push("No provider returned a writable current balance row.");
  }
  for (const result of providerResults) {
    if (result.warning) warnings.push(result.warning);
    if (result.error) warnings.push(`${result.provider}: ${result.error}`);
  }

  let saveResult = { rowCount: 0, skipped: dryRun ? "dry_run" : "no_rows" };
  if (!dryRun && rows.length) {
    try {
      saveResult = await saveAutoBalanceSnapshotRows(rows, { fetchImpl });
    } catch (error) {
      return {
        ...buildBaseResponse({ date, dryRun, providerResults, rows, skippedRows, warnings }),
        ok: false,
        error: String(error?.message || error),
        saved_rows: 0,
      };
    }
  }

  return {
    ...buildBaseResponse({ date, dryRun, providerResults, rows, skippedRows, warnings }),
    ok: true,
    saved_rows: dryRun ? 0 : Number(saveResult.rowCount || 0),
    save: saveResult,
  };
}

function buildBaseResponse({ date, dryRun, providerResults, rows, skippedRows, warnings }) {
  return {
    ok: true,
    date,
    dryRun,
    target_sheet: AUTO_BALANCE_SHEET_NAME,
    saved_rows: 0,
    skipped_rows: skippedRows.length,
    providers_checked: providerResults.map((result) => result.provider),
    providers_succeeded: providerResults
      .filter((result) => result.provider_current_balance_status === "available" && result.rows?.some((row) => row.status === "ok" || row.status === "zero_balance"))
      .map((result) => result.provider),
    providers_failed: providerResults
      .filter((result) => ["error", "needs_permission"].includes(result.provider_current_balance_status))
      .map((result) => result.provider),
    provider_current_balance_status: Object.fromEntries(
      providerResults.map((result) => [result.provider, result.provider_current_balance_status])
    ),
    provider_results: providerResults.map((result) => ({
      provider: result.provider,
      provider_current_balance_status: result.provider_current_balance_status,
      rows: result.rows?.length || 0,
      writable_rows: result.rows?.filter((row) => ["ok", "zero_balance", "derived_from_confirmed_opening"].includes(row.status)).length || 0,
      skipped_rows: result.skipped_rows?.length || 0,
      error: result.error || null,
      original_provider_error: result.original_provider_error || null,
      derived: result.derived || null,
    })),
    warnings: unique(warnings).slice(0, 20),
    rows_preview: rows.slice(0, 30),
  };
}

export async function collectProviderBalanceRows({ date, env = process.env, fetchImpl = fetch } = {}) {
  return [
    await collectWiseBalanceRows({ date, env, fetchImpl }),
    await collectMonobankBalanceRows({ date, env, fetchImpl }),
    await collectPayPalBalanceRows({ date, env, fetchImpl }),
    buildUnavailableProviderResult("privatbank", "not_implemented", "PrivatBank current-balance endpoint is not wired yet.", date),
    await collectYooMoneyBalanceRows({ date, env, fetchImpl }),
    await collectBinanceBalanceRows({ date, env, fetchImpl }),
    buildUnavailableProviderResult("tdbank", "not_implemented", "TD Bank current-balance snapshot endpoint is not wired yet.", date),
    buildUnavailableProviderResult("payoneer", "not_implemented", "Payoneer current-balance snapshot endpoint is not wired yet.", date),
    buildUnavailableProviderResult("revolut", "not_implemented", "Revolut current-balance snapshot endpoint is not wired yet.", date),
  ];
}

async function collectWiseBalanceRows({ date, env, fetchImpl }) {
  const provider = "wise";
  try {
    if (!String(env.WISE_API_TOKEN || "").trim()) {
      return buildUnavailableProviderResult(provider, "needs_permission", "WISE_API_TOKEN is not configured.", date);
    }
    const balances = await fetchWiseBalances({
      apiToken: env.WISE_API_TOKEN,
      profileId: env.WISE_PROFILE_ID,
      baseUrl: env.WISE_API_BASE || "https://api.wise.com",
      fetchImpl,
    });
    const rows = buildExpectedProviderRows({ provider, date, status: "missing_provider_balance" });
    const skipped_rows = [];
    for (const balance of balances || []) {
      const currency = String(balance?.currency || "").trim().toUpperCase();
      const expected = findExpectedProviderBalance(provider, currency);
      if (!expected) {
        skipped_rows.push({ provider, currency, reason: "missing_configured_channel" });
        continue;
      }
      replaceExpectedRow(rows, buildSnapshotRow({
        ...expected,
        date,
        amount: balance.amount,
        amountUsd: balance.amountUsd,
        rawSourceId: String(balance.id || balance.balanceId || `${provider}:${currency}`).trim(),
        status: Number(balance.amount) === 0 ? "zero_balance" : "ok",
        comment: SNAPSHOT_COMMENT,
      }));
    }
    return { provider, provider_current_balance_status: "available", rows, skipped_rows };
  } catch (error) {
    return {
      provider,
      provider_current_balance_status: "error",
      rows: buildExpectedProviderRows({ provider, date, status: "provider_error", comment: String(error?.message || error) }),
      skipped_rows: [],
      error: String(error?.message || error),
    };
  }
}

async function collectMonobankBalanceRows({ date, env, fetchImpl }) {
  const provider = "monobank";
  try {
    if (!String(env.MONOBANK_API_TOKEN || "").trim()) {
      return buildUnavailableProviderResult(provider, "needs_permission", "MONOBANK_API_TOKEN is not configured.", date);
    }
    const clientInfo = await fetchMonobankClientInfo({
      apiToken: env.MONOBANK_API_TOKEN,
      baseUrl: env.MONOBANK_API_BASE || "https://api.monobank.ua",
      fetchImpl,
    });
    const accounts = collectMonobankRawAccounts(clientInfo.rawClient);
    const rows = buildExpectedProviderRows({ provider, date, status: "missing_provider_balance" });
    const skipped_rows = [];
    for (const account of accounts) {
      const mapped = mapMonobankAccountToSnapshotRow(account, date);
      if (mapped) replaceExpectedRow(rows, mapped);
      else skipped_rows.push({ provider, reason: "missing_real_balance_or_supported_channel" });
    }
    return { provider, provider_current_balance_status: "available", rows, skipped_rows };
  } catch (error) {
    return { provider, provider_current_balance_status: "error", rows: [], skipped_rows: [], error: String(error?.message || error) };
  }
}

async function collectPayPalBalanceRows({ date, env, fetchImpl }) {
  const provider = "paypal";
  try {
    if (!String(env.PAYPAL_CLIENT_ID || "").trim() || !String(env.PAYPAL_CLIENT_SECRET || "").trim()) {
      return buildUnavailableProviderResult(provider, "needs_permission", "PayPal current balance requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET with balances/reporting permission.", date);
    }
    const balances = await fetchPayPalCurrentBalances({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      environment: env.PAYPAL_ENVIRONMENT || "live",
      baseUrl: env.PAYPAL_API_BASE,
      date,
      fetchImpl,
    });
    const rows = buildExpectedProviderRows({ provider, date, status: "missing_provider_balance" });
    const skipped_rows = [];
    for (const balance of balances || []) {
      const currency = String(balance?.currency || "").trim().toUpperCase();
      const expected = findExpectedProviderBalance(provider, currency);
      if (!expected) {
        skipped_rows.push({ provider, currency, reason: "missing_configured_channel" });
        continue;
      }
      replaceExpectedRow(rows, buildSnapshotRow({
        ...expected,
        date,
        amount: balance.amount,
        rawSourceId: String(balance.id || `${provider}:${currency}`).trim(),
        status: Number(balance.amount) === 0 ? "zero_balance" : "ok",
        comment: SNAPSHOT_COMMENT,
      }));
    }
    return { provider, provider_current_balance_status: "available", rows, skipped_rows };
  } catch (error) {
    const status = isPermissionError(error) ? "needs_permission" : (isNotSupportedAccountError(error) ? "not_supported_for_account" : "error");
    const providerStatusRows = buildExpectedProviderRows({
      provider,
      date,
      status: status === "error" ? "provider_error" : mapUnavailableStatus(status),
      comment: String(error?.message || error),
    });
    if (["needs_permission", "not_supported_for_account"].includes(status)) {
      const derived = await collectDerivedPayPalBalanceRows({ date, fetchImpl, originalError: error });
      return {
        provider,
        provider_current_balance_status: derived.provider_current_balance_status,
        rows: [...providerStatusRows, ...derived.rows],
        skipped_rows: [],
        error: String(error?.message || error),
        original_provider_error: String(error?.message || error),
        derived: derived.derived,
      };
    }
    return {
      provider,
      provider_current_balance_status: status,
      rows: providerStatusRows,
      skipped_rows: [],
      error: String(error?.message || error),
    };
  }
}

async function collectDerivedPayPalBalanceRows({ date, fetchImpl, originalError }) {
  let repository = null;
  try {
    repository = await loadManualRepositoryFromGoogleSheets({ fetchImpl });
  } catch (error) {
    repository = { ok: false, warning: String(error?.message || error) };
  }

  if (!repository?.ok) {
    return {
      provider_current_balance_status: "needs_initial_paypal_balance",
      rows: PAYPAL_DERIVED_CHANNELS.map((expected) => buildPayPalDerivedStatusRow({
        ...expected,
        date,
        status: "needs_initial_paypal_balance",
        comment: "Enter one confirmed PayPal opening balance first; future dates can be auto-derived.",
      })),
      derived: PAYPAL_DERIVED_CHANNELS.map((expected) => ({
        channel: expected.channel,
        currency: expected.currency,
        written: false,
        blocked_reason: "repository_unavailable",
        original_provider_error: String(originalError?.message || originalError || ""),
        repository_warning: repository?.warning || null,
      })),
    };
  }

  const balances = [
    ...(Array.isArray(repository.balances) ? repository.balances : []),
    ...(Array.isArray(repository.autoBalances) ? repository.autoBalances : []),
  ];
  const operations = Array.isArray(repository.operations) ? repository.operations : [];
  const rows = [];
  const derived = [];

  for (const expected of PAYPAL_DERIVED_CHANNELS) {
    const result = derivePayPalBalanceRow({
      date,
      channel: expected.channel,
      currency: expected.currency,
      balances,
      operations,
    });
    derived.push({
      channel: expected.channel,
      currency: expected.currency,
      opening_date: result.opening_date || null,
      opening_amount: result.opening_amount ?? null,
      ledger_delta: result.ledger_delta ?? null,
      calculated_balance: result.calculated_balance ?? null,
      movement_row_count: result.movement_row_count || 0,
      written: Boolean(result.row),
      blocked_reason: result.blocked_reason || null,
      blocked_rows: result.blocked_rows || [],
    });
    rows.push(result.row || buildPayPalDerivedStatusRow({
      ...expected,
      date,
      status: result.blocked_reason || "needs_initial_paypal_balance",
      comment: result.comment || "Enter one confirmed PayPal opening balance first; future dates can be auto-derived.",
    }));
  }

  return {
    provider_current_balance_status: rows.some((row) => row.status === "derived_from_confirmed_opening")
      ? "derived_from_ledger"
      : "needs_initial_paypal_balance",
    rows,
    derived,
  };
}

export function derivePayPalBalanceRow({ date, channel, currency, balances = [], operations = [] } = {}) {
  const normalizedDate = normalizeIsoDate(date);
  const normalizedChannel = String(channel || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!normalizedDate || !normalizedChannel || !normalizedCurrency) {
    return { blocked_reason: "invalid_target" };
  }
  const sameDateFactual = findSameDatePayPalFactualBalance({ date: normalizedDate, channel: normalizedChannel, currency: normalizedCurrency, balances });
  if (sameDateFactual) {
    return {
      blocked_reason: "manual_or_provider_balance_exists",
      comment: "Manual or provider PayPal balance already exists for this date; derived row is lower priority.",
    };
  }
  const opening = findLatestConfirmedPayPalOpeningBalance({ date: normalizedDate, channel: normalizedChannel, currency: normalizedCurrency, balances });
  if (!opening) {
    return {
      blocked_reason: "needs_initial_paypal_balance",
      comment: "Enter one confirmed PayPal opening balance first; future dates can be auto-derived.",
    };
  }
  const movements = collectPayPalLedgerMovements({
    openingDate: opening.date,
    targetDate: normalizedDate,
    channel: normalizedChannel,
    currency: normalizedCurrency,
    operations,
  });
  if (movements.blocked_rows.length) {
    return {
      opening_date: opening.date,
      opening_amount: opening.amount,
      movement_row_count: movements.rows.length,
      blocked_reason: "missing_amount_net",
      blocked_rows: movements.blocked_rows,
      comment: "PayPal derived balance blocked because at least one relevant Ledger movement is missing amount_net.",
    };
  }
  const calculated = roundMoney(opening.amount + movements.ledger_delta);
  return {
    row: buildSnapshotRow({
      provider: "paypal",
      channel: normalizedChannel,
      currency: normalizedCurrency,
      date: normalizedDate,
      amount: calculated,
      source: PAYPAL_DERIVED_BALANCE_SOURCE,
      rawSourceId: `${PAYPAL_DERIVED_BALANCE_SOURCE}:${normalizedDate}:${normalizedCurrency}`,
      status: "derived_from_confirmed_opening",
      comment: `${PAYPAL_DERIVED_BALANCE_COMMENT_PREFIX} on ${opening.date} ${PAYPAL_DERIVED_BALANCE_COMMENT_SUFFIX}`,
    }),
    opening_date: opening.date,
    opening_amount: opening.amount,
    ledger_delta: movements.ledger_delta,
    calculated_balance: calculated,
    movement_row_count: movements.rows.length,
    blocked_rows: [],
  };
}

function buildPayPalDerivedStatusRow({ date, channel, currency, status, comment }) {
  return buildSnapshotRow({
    provider: "paypal",
    channel,
    currency,
    date,
    amount: "",
    amountUsd: "",
    source: PAYPAL_DERIVED_BALANCE_SOURCE,
    rawSourceId: `${PAYPAL_DERIVED_BALANCE_SOURCE}:${normalizeIsoDate(date)}:${String(currency || "").trim().toUpperCase()}`,
    status,
    comment,
  });
}

async function collectYooMoneyBalanceRows({ date, env, fetchImpl }) {
  const provider = "yoomoney";
  try {
    if (!String(env.YOOMONEY_ACCESS_TOKEN || "").trim()) {
      return buildUnavailableProviderResult(provider, "needs_permission", "YOOMONEY_ACCESS_TOKEN is not configured.", date);
    }
    const balance = await fetchYooMoneyCurrentBalance({
      accessToken: env.YOOMONEY_ACCESS_TOKEN,
      baseUrl: env.YOOMONEY_API_BASE,
      currency: env.YOOMONEY_CURRENCY || "RUB",
      fetchImpl,
    });
    const rows = buildExpectedProviderRows({ provider, date, status: "missing_provider_balance" });
    const expected = findExpectedProviderBalance(provider, balance.currency);
    if (expected) {
      replaceExpectedRow(rows, buildSnapshotRow({
        ...expected,
        date,
        amount: balance.amount,
        rawSourceId: String(balance.id || `${provider}:${balance.currency}`).trim(),
        status: Number(balance.amount) === 0 ? "zero_balance" : "ok",
        comment: SNAPSHOT_COMMENT,
      }));
    }
    return { provider, provider_current_balance_status: "available", rows, skipped_rows: expected ? [] : [{ provider, currency: balance.currency, reason: "missing_configured_channel" }] };
  } catch (error) {
    return {
      provider,
      provider_current_balance_status: isPermissionError(error) ? "needs_permission" : "error",
      rows: buildExpectedProviderRows({ provider, date, status: isPermissionError(error) ? "needs_provider_permission" : "provider_error", comment: String(error?.message || error) }),
      skipped_rows: [],
      error: String(error?.message || error),
    };
  }
}

async function collectBinanceBalanceRows({ date, env, fetchImpl }) {
  const provider = "binance";
  try {
    const config = getBinanceProviderConfigFromEnv(env);
    if (!config) {
      return buildUnavailableProviderResult(provider, "needs_permission", "BINANCE_API_KEY and BINANCE_API_SECRET are not configured.", date);
    }
    const [spotResult, earnResult] = await Promise.allSettled([
      fetchBinanceCurrentBalances({ ...config, fetchImpl }),
      fetchBinanceEarnCurrentBalances({ ...config, fetchImpl }),
    ]);
    const rows = buildExpectedProviderRows({ provider, date, status: "missing_provider_balance" });
    const errors = [];

    if (spotResult.status === "fulfilled") {
      const spotUsdt = spotResult.value.find((balance) => balance.wallet === "spot" && balance.currency === "USDT");
      if (spotUsdt) {
        replaceExpectedRow(rows, buildSnapshotRow({
          ...EXPECTED_PROVIDER_BALANCES.find((row) => row.provider === provider && row.channel === "Бинанс spot" && row.currency === "USDT"),
          date,
          amount: spotUsdt.amount,
          rawSourceId: spotUsdt.id,
          status: Number(spotUsdt.amount) === 0 ? "zero_balance" : "ok",
          comment: SNAPSHOT_COMMENT,
        }));
      }
    } else {
      errors.push(`spot: ${String(spotResult.reason?.message || spotResult.reason)}`);
      replaceExpectedRow(rows, buildSnapshotRow({
        ...EXPECTED_PROVIDER_BALANCES.find((row) => row.provider === provider && row.channel === "Бинанс spot" && row.currency === "USDT"),
        date,
        amount: "",
        amountUsd: "",
        rawSourceId: "binance:Бинанс spot:USDT",
        status: isPermissionError(spotResult.reason) ? "needs_provider_permission" : "provider_error",
        comment: toSafeComment(spotResult.reason),
      }));
    }

    if (earnResult.status === "fulfilled") {
      const earnUsdt = earnResult.value.find((balance) => balance.wallet === "earn" && balance.currency === "USDT");
      if (earnUsdt) {
        replaceExpectedRow(rows, buildSnapshotRow({
          ...EXPECTED_PROVIDER_BALANCES.find((row) => row.provider === provider && row.channel === "binance save" && row.currency === "USDT"),
          date,
          amount: earnUsdt.amount,
          rawSourceId: earnUsdt.id,
          status: Number(earnUsdt.amount) === 0 ? "zero_balance" : "ok",
          comment: SNAPSHOT_COMMENT,
        }));
      }
    } else {
      errors.push(`earn: ${String(earnResult.reason?.message || earnResult.reason)}`);
      replaceExpectedRow(rows, buildSnapshotRow({
        ...EXPECTED_PROVIDER_BALANCES.find((row) => row.provider === provider && row.channel === "binance save" && row.currency === "USDT"),
        date,
        amount: "",
        amountUsd: "",
        rawSourceId: "binance:binance save:USDT",
        status: isPermissionError(earnResult.reason) ? "needs_provider_permission" : "provider_error",
        comment: toSafeComment(earnResult.reason),
      }));
    }

    const hasWritable = rows.some((row) => ["ok", "zero_balance"].includes(row.status));
    return {
      provider,
      provider_current_balance_status: hasWritable ? "available" : (errors.every((error) => isPermissionError(error)) ? "needs_permission" : "error"),
      rows,
      skipped_rows: [],
      error: errors.length ? errors.join("; ") : null,
    };
  } catch (error) {
    return {
      provider,
      provider_current_balance_status: isPermissionError(error) ? "needs_permission" : "error",
      rows: buildExpectedProviderRows({ provider, date, status: isPermissionError(error) ? "needs_provider_permission" : "provider_error", comment: String(error?.message || error) }),
      skipped_rows: [],
      error: String(error?.message || error),
    };
  }
}

function collectMonobankRawAccounts(clientInfo) {
  return [
    ...(Array.isArray(clientInfo?.accounts) ? clientInfo.accounts : []),
    ...(Array.isArray(clientInfo?.jars) ? clientInfo.jars : []),
    ...(Array.isArray(clientInfo?.managedClients) ? clientInfo.managedClients : [])
      .flatMap((client) => Array.isArray(client?.accounts) ? client.accounts : []),
  ];
}

function mapMonobankAccountToSnapshotRow(account, date) {
  if (!Object.prototype.hasOwnProperty.call(account || {}, "balance")) return null;
  const currency = monobankCurrencyByCode(account?.currencyCode);
  const expected = findExpectedProviderBalance("monobank", currency);
  if (!expected) return null;
  const amount = Math.round((Number(account.balance) / 100) * 10000) / 10000;
  if (!Number.isFinite(amount)) return null;
  return buildSnapshotRow({
    ...expected,
    date,
    amount,
    rawSourceId: String(account.id || `monobank:${currency}`).trim(),
    status: amount === 0 ? "zero_balance" : "ok",
    comment: SNAPSHOT_COMMENT,
  });
}

function buildUnavailableProviderResult(provider, status, warning, date = "") {
  return {
    provider,
    provider_current_balance_status: status,
    rows: buildExpectedProviderRows({ provider, date, status: mapUnavailableStatus(status), comment: warning }),
    skipped_rows: [],
    warning,
  };
}

function mapUnavailableStatus(status) {
  if (status === "needs_permission") return "needs_provider_permission";
  if (status === "not_implemented") return "provider_not_implemented";
  if (status === "not_supported_for_account") return "not_supported_for_account";
  return status || "missing_provider_balance";
}

function findExpectedProviderBalance(provider, currency) {
  return EXPECTED_PROVIDER_BALANCES.find((row) => row.provider === provider && row.currency === currency) || null;
}

function buildExpectedProviderRows({ provider, date = "", status = "missing_provider_balance", comment = "" } = {}) {
  return EXPECTED_PROVIDER_BALANCES
    .filter((row) => row.provider === provider)
    .map((expected) => buildSnapshotRow({
      ...expected,
      date,
      amount: "",
      amountUsd: "",
      rawSourceId: `${expected.provider}:${expected.channel}:${expected.currency}`,
      status,
      comment: comment || status,
    }));
}

function replaceExpectedRow(rows, replacement) {
  if (!replacement) return;
  const index = rows.findIndex((row) =>
    row.provider === replacement.provider && row.channel === replacement.channel && row.currency === replacement.currency
  );
  if (index === -1) rows.push(replacement);
  else rows[index] = replacement;
}

function buildSnapshotRow({
  date,
  provider = "provider",
  channel,
  amount,
  currency,
  amountUsd,
  source,
  fetchedAt,
  rawSourceId = "",
  status,
  comment,
}) {
  const numericAmount = parseSheetNumber(amount);
  const hasAmount = Number.isFinite(numericAmount);
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const normalizedChannel = String(channel || "").trim();
  const normalizedProvider = normalizeProvider(provider);
  const rate = Number(FALLBACK_USD_RATES[normalizedCurrency] || 0);
  const numericUsd = parseSheetNumber(amountUsd);
  const usdAmount = Number.isFinite(numericUsd)
    ? numericUsd
    : (hasAmount && rate ? numericAmount * rate : "");
  if (!normalizedChannel || !normalizedCurrency) return null;
  return {
    date: normalizeIsoDate(date),
    provider: normalizedProvider,
    channel: normalizedChannel,
    amount: hasAmount ? formatSheetNumber(numericAmount) : "",
    currency: normalizedCurrency,
    rate: rate ? formatSheetNumber(rate, 6) : "",
    usdAmount: usdAmount === "" ? "" : formatSheetNumber(usdAmount),
    source: String(source || `${normalizedProvider}_auto`).trim(),
    fetchedAt: String(fetchedAt || new Date().toISOString()).trim(),
    rawSourceId: String(rawSourceId || `${normalizedProvider}:${normalizedChannel}:${normalizedCurrency}`).trim(),
    status: String(status || (hasAmount && numericAmount === 0 ? "zero_balance" : "ok")).trim(),
    comment: String(comment || SNAPSHOT_COMMENT).trim(),
  };
}

export async function saveAutoBalanceSnapshotRows(rows, { fetchImpl = fetch } = {}) {
  const snapshotRows = normalizeSnapshotRows(rows);
  if (!snapshotRows.length) return { rowCount: 0, savedAt: new Date().toISOString() };
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  await ensureBalanceSheetExists({ accessToken, fetchImpl });
  const existingValues = await getBalanceSheetValues({ accessToken, fetchImpl });
  const existingRows = parseBalanceSheetValues(existingValues);
  const mergedRows = mergeBalanceRowsByDateChannelCurrency(existingRows, snapshotRows);
  await putBalanceSheetValues(buildBalanceSheetValues(mergedRows), { accessToken, fetchImpl });
  return { rowCount: snapshotRows.length, savedAt: new Date().toISOString(), sheetName: AUTO_BALANCE_SHEET_NAME };
}

export function buildPayPalManualBalanceRows(input = {}) {
  const date = normalizeIsoDate(input.date);
  if (!date) throw new Error("date must be YYYY-MM-DD.");
  const fetchedAt = normalizeTimestamp(input.fetchedAt || input.fetched_at) || new Date().toISOString();
  const comment = [PAYPAL_MANUAL_BALANCE_COMMENT, String(input.comment || input.note || "").trim()]
    .filter(Boolean)
    .join(" | ");
  return [
    { currency: "USD", channel: "пейпал дол", value: input.USD ?? input.usd ?? input.usdBalance },
    { currency: "EUR", channel: "пейпал евр", value: input.EUR ?? input.eur ?? input.eurBalance },
    { currency: "CAD", channel: "пейпал сad", value: input.CAD ?? input.cad ?? input.cadBalance },
  ].map(({ currency, channel, value }) => {
    const amount = parseRequiredManualBalanceAmount(value, currency);
    return buildSnapshotRow({
      date,
      provider: "paypal",
      channel,
      amount,
      currency,
      source: PAYPAL_MANUAL_BALANCE_SOURCE,
      fetchedAt,
      rawSourceId: `${PAYPAL_MANUAL_BALANCE_SOURCE}:${date}:${currency}`,
      status: amount === 0 ? "zero_balance" : "ok",
      comment,
    });
  });
}

export async function savePayPalManualBalanceRows(input = {}, { fetchImpl = fetch } = {}) {
  const snapshotRows = buildPayPalManualBalanceRows(input);
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  await ensureBalanceSheetExists({ accessToken, fetchImpl });
  const existingValues = await getBalanceSheetValues({ accessToken, fetchImpl });
  const existingRows = parseBalanceSheetValues(existingValues);
  const merge = mergePayPalManualBalanceRows(existingRows, snapshotRows);
  await putBalanceSheetValues(buildBalanceSheetValues(merge.rows), { accessToken, fetchImpl });
  return {
    rowCount: snapshotRows.length,
    inserted: merge.inserted,
    updated: merge.updated,
    skipped: 0,
    sheetName: AUTO_BALANCE_SHEET_NAME,
    rows: snapshotRows,
    savedAt: new Date().toISOString(),
  };
}

function parseRequiredManualBalanceAmount(value, currency) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${currency} balance is required.`);
  const numeric = parseSheetNumber(raw);
  if (!Number.isFinite(numeric)) throw new Error(`${currency} balance must be numeric.`);
  return numeric;
}

function findSameDatePayPalFactualBalance({ date, channel, currency, balances = [] }) {
  return (balances || []).find((row) =>
    normalizeIsoDate(row?.date) === date &&
    sameBalanceChannelCurrency(row, channel, currency) &&
    isPayPalFactualOpening(row) &&
    Number.isFinite(parseSheetNumber(row?.balanceAmount ?? row?.amount))
  ) || null;
}

function findLatestConfirmedPayPalOpeningBalance({ date, channel, currency, balances = [] }) {
  return (balances || [])
    .filter((row) =>
      normalizeIsoDate(row?.date) &&
      normalizeIsoDate(row.date) <= date &&
      sameBalanceChannelCurrency(row, channel, currency) &&
      isPayPalConfirmedOpening(row)
    )
    .map((row) => ({
      ...row,
      date: normalizeIsoDate(row.date),
      amount: parseSheetNumber(row?.balanceAmount ?? row?.amount),
      priority: getPayPalOpeningPriority(row),
    }))
    .filter((row) => Number.isFinite(row.amount))
    .sort((left, right) => {
      const dateDiff = right.date.localeCompare(left.date);
      if (dateDiff) return dateDiff;
      return left.priority - right.priority;
    })[0] || null;
}

function isPayPalConfirmedOpening(row = {}) {
  const status = String(row?.status || row?.autoBalanceStatus || row?.auto_balance_status || "ok").trim();
  if (!["ok", "zero_balance", "derived_from_confirmed_opening"].includes(status)) return false;
  return getPayPalOpeningPriority(row) < 99;
}

function isPayPalFactualOpening(row = {}) {
  const priority = getPayPalOpeningPriority(row);
  return priority === 0 || priority === 1;
}

function getPayPalOpeningPriority(row = {}) {
  const source = String(row?.source || row?.fact_source || row?.balanceSource || row?.balance_source || "").trim().toLowerCase();
  const comment = String(row?.comment || "").trim().toLowerCase();
  if ([PAYPAL_MANUAL_BALANCE_SOURCE, PAYPAL_MANUAL_CONFIRMED_BALANCE_SOURCE].includes(source)) return 0;
  if (source === "manual_fact" && /paypal|пейпал/.test(String(row?.provider || row?.channel || "").toLowerCase())) return 0;
  if (source === "paypal_auto" || (source === "provider_auto" && String(row?.provider || "").toLowerCase() === "paypal")) return 1;
  if (source === PAYPAL_DERIVED_BALANCE_SOURCE && /derived from latest confirmed paypal balance/.test(comment)) return 2;
  return 99;
}

function sameBalanceChannelCurrency(row = {}, channel, currency) {
  return String(row?.channel || row?.accountName || row?.account || "").trim() === channel &&
    String(row?.currency || "").trim().toUpperCase() === currency;
}

function collectPayPalLedgerMovements({ openingDate, targetDate, channel, currency, operations = [] }) {
  const rows = [];
  const blocked_rows = [];
  let ledger_delta = 0;
  for (const row of operations || []) {
    const ledger = row?.ledgerV2 || {};
    const rowDate = normalizeIsoDate(row?.date || ledger.date);
    if (!rowDate || rowDate <= openingDate || rowDate > targetDate) continue;
    if (String(row?.currency || ledger.currency || "").trim().toUpperCase() !== currency) continue;
    const fromChannel = String(row?.fromChannel || ledger.from_channel || "").trim();
    const toChannel = String(row?.toChannel || ledger.to_channel || "").trim();
    if (fromChannel !== channel && toChannel !== channel) continue;
    const amountNetRaw = row?.amountNet ?? row?.amount_net ?? ledger.amount_net;
    const amountNet = parseSheetNumber(amountNetRaw);
    const rowRef = {
      row: row?.sheetRowNumber || row?.sourceRow || null,
      date: rowDate,
      raw_source_id: row?.rawSourceId || row?.raw_source_id || ledger.raw_source_id || ledger.external_id || "",
      reason: "missing_amount_net",
    };
    if (!String(amountNetRaw ?? "").trim() || !Number.isFinite(amountNet)) {
      blocked_rows.push(rowRef);
      continue;
    }
    const signed = getSignedLedgerAmountNet(row, amountNet, channel);
    if (!Number.isFinite(signed)) {
      blocked_rows.push({ ...rowRef, reason: "invalid_signed_amount_net" });
      continue;
    }
    rows.push(row);
    ledger_delta += signed;
  }
  return { rows, blocked_rows, ledger_delta: roundMoney(ledger_delta) };
}

function getSignedLedgerAmountNet(row = {}, amountNet, channel) {
  const ledger = row?.ledgerV2 || {};
  const balanceAmount = parseSheetNumber(row?.balanceAmount ?? ledger.balance_amount);
  if (Number.isFinite(balanceAmount)) return balanceAmount;
  const operation = String(row?.operation || ledger.operation || "").trim().toLowerCase();
  const direction = String(row?.direction || ledger.direction || "").trim().toLowerCase();
  const fromChannel = String(row?.fromChannel || ledger.from_channel || "").trim();
  const toChannel = String(row?.toChannel || ledger.to_channel || "").trim();
  if (operation === "income" || direction === "in" || toChannel === channel) return amountNet;
  if (operation === "expense" || direction === "out" || fromChannel === channel) return -Math.abs(amountNet);
  return amountNet;
}

function roundMoney(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function mergePayPalManualBalanceRows(existingRows = [], replacementRows = []) {
  const replacementByRawSourceId = new Map(
    (replacementRows || []).map((row) => [String(row.rawSourceId || "").trim(), row]).filter(([rawSourceId]) => rawSourceId)
  );
  let inserted = 0;
  let updated = 0;
  const rows = (existingRows || []).map((row) => {
    const rawSourceId = String(row?.rawSourceId || "").trim();
    const replacement = replacementByRawSourceId.get(rawSourceId);
    if (!replacement) return row;
    updated += 1;
    replacementByRawSourceId.delete(rawSourceId);
    return replacement;
  });
  for (const row of replacementByRawSourceId.values()) {
    inserted += 1;
    rows.push(row);
  }
  rows.sort((left, right) => {
    const dateDiff = String(left.date || "").localeCompare(String(right.date || ""));
    if (dateDiff) return dateDiff;
    const providerDiff = String(left.provider || "").localeCompare(String(right.provider || ""));
    if (providerDiff) return providerDiff;
    const channelDiff = String(left.channel || "").localeCompare(String(right.channel || ""));
    if (channelDiff) return channelDiff;
    const currencyDiff = String(left.currency || "").localeCompare(String(right.currency || ""));
    if (currencyDiff) return currencyDiff;
    return String(left.rawSourceId || "").localeCompare(String(right.rawSourceId || ""));
  });
  return { rows, inserted, updated };
}

function normalizeSnapshotRows(rows) {
  return (rows || []).map((row) => ({
    date: normalizeIsoDate(row?.date),
    provider: normalizeProvider(row?.provider),
    channel: String(row?.channel || "").trim(),
    amount: row?.amount === "" ? "" : formatSheetNumber(parseSheetNumber(row?.amount)),
    currency: String(row?.currency || "").trim().toUpperCase(),
    rate: row?.rate === "" ? "" : formatSheetNumber(parseSheetNumber(row?.rate), 6),
    usdAmount: (row?.amountUsd === "" || row?.amount_usd === "") ? "" : formatSheetNumber(parseSheetNumber(row?.amountUsd ?? row?.amount_usd)),
    source: normalizeAutoSource(row?.source, row?.provider),
    fetchedAt: normalizeTimestamp(row?.fetchedAt || row?.fetched_at) || new Date().toISOString(),
    rawSourceId: String(row?.rawSourceId || row?.raw_source_id || "").trim(),
    status: String(row?.status || "ok").trim() || "ok",
    comment: String(row?.comment || SNAPSHOT_COMMENT).trim(),
  })).filter((row) => row.date && row.provider && row.channel && row.currency && row.status);
}

export function mergeBalanceRowsByDateChannelCurrency(existingRows = [], replacementRows = []) {
  const replacementKeys = new Set((replacementRows || []).map(balanceRowKey));
  return [
    ...(existingRows || []).filter((row) => !replacementKeys.has(balanceRowKey(row))),
    ...(replacementRows || []),
  ];
}

function balanceRowKey(row) {
  if (isPayPalDerivedBalanceRow(row)) {
    return [
      normalizeIsoDate(row?.date),
      normalizeProvider(row?.provider),
      String(row?.rawSourceId || row?.raw_source_id || "").trim(),
    ].join("|");
  }
  return [
    normalizeIsoDate(row?.date),
    normalizeProvider(row?.provider),
    String(row?.channel || "").trim(),
    String(row?.currency || "").trim().toUpperCase(),
  ].join("|");
}

function isPayPalDerivedBalanceRow(row = {}) {
  return normalizeProvider(row?.provider) === "paypal" &&
    String(row?.source || "").trim().toLowerCase() === PAYPAL_DERIVED_BALANCE_SOURCE &&
    String(row?.rawSourceId || row?.raw_source_id || "").trim();
}

async function ensureBalanceSheetExists({ accessToken, fetchImpl }) {
  const metadataResponse = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const metadata = await metadataResponse.json().catch(() => ({}));
  if (!metadataResponse.ok) throw new Error(metadata?.error?.message || `Sheets metadata failed with HTTP ${metadataResponse.status}`);
  const exists = (metadata.sheets || []).some((sheet) => sheet?.properties?.title === AUTO_BALANCE_SHEET_NAME);
  if (exists) return;
  const createResponse = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: AUTO_BALANCE_SHEET_NAME } } }] }),
  });
  const payload = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) throw new Error(payload?.error?.message || `Create Авто Остатки sheet failed with HTTP ${createResponse.status}`);
}

async function getBalanceSheetValues({ accessToken, fetchImpl }) {
  const range = encodeURIComponent(`'${AUTO_BALANCE_SHEET_NAME}'!A:L`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Read Авто Остатки failed with HTTP ${response.status}`);
  return payload.values || [];
}

async function putBalanceSheetValues(values, { accessToken, fetchImpl }) {
  const range = encodeURIComponent(`'${AUTO_BALANCE_SHEET_NAME}'!A:L`);
  const response = await fetchImpl(
    `${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ range: `'${AUTO_BALANCE_SHEET_NAME}'!A:L`, majorDimension: "ROWS", values }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Write Авто Остатки failed with HTTP ${response.status}`);
}

function parseBalanceSheetValues(values) {
  return (values || []).slice(1).map((row) => ({
    date: normalizeIsoDate(row?.[0]),
    provider: normalizeProvider(row?.[1]),
    channel: String(row?.[2] || "").trim(),
    amount: formatSheetNumber(parseSheetNumber(row?.[3])),
    currency: String(row?.[4] || "").trim().toUpperCase(),
    rate: row?.[5] === undefined || row?.[5] === "" ? "" : formatSheetNumber(parseSheetNumber(row?.[5]), 6),
    usdAmount: row?.[6] === undefined || row?.[6] === "" ? "" : formatSheetNumber(parseSheetNumber(row?.[6])),
    source: normalizeAutoSource(row?.[7], row?.[1]),
    fetchedAt: String(row?.[8] || "").trim(),
    rawSourceId: String(row?.[9] || "").trim(),
    status: String(row?.[10] || "ok").trim() || "ok",
    comment: String(row?.[11] || "").trim(),
  })).filter((row) => row.date && row.provider && row.channel && row.currency && (row.status || row.amount || row.usdAmount));
}

function buildBalanceSheetValues(rows) {
  return [
    AUTO_BALANCE_HEADERS.slice(),
    ...(rows || []).map((row) => [
      row.date || "",
      row.provider || "",
      row.channel || "",
      row.amount || "",
      row.currency || "",
      row.rate || "",
      row.usdAmount || "",
      row.source || "",
      row.fetchedAt || "",
      row.rawSourceId || "",
      row.status || "",
      row.comment || "",
    ]),
  ];
}

function normalizeProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/wise|transferwise|трансервайз/.test(raw)) return "wise";
  if (/mono|monobank|монобанк/.test(raw)) return "monobank";
  if (/paypal|пейпал/.test(raw)) return "paypal";
  if (/binance|бинанс/.test(raw)) return "binance";
  if (/privat|приват/.test(raw)) return "privatbank";
  if (/yoomoney|юmoney|юмани|яндекс/.test(raw)) return "yoomoney";
  return raw || "provider";
}

function normalizeAutoSource(value, provider) {
  const raw = String(value || "").trim().toLowerCase();
  if ([PAYPAL_MANUAL_BALANCE_SOURCE, PAYPAL_MANUAL_CONFIRMED_BALANCE_SOURCE, PAYPAL_DERIVED_BALANCE_SOURCE].includes(raw)) return raw;
  if (["wise_auto", "paypal_auto", "binance_auto", "monobank_auto", "privatbank_auto", "yoomoney_auto", "tdbank_auto", "payoneer_auto", "revolut_auto", "provider_auto"].includes(raw)) return raw;
  const normalizedProvider = normalizeProvider(provider);
  if (["wise", "paypal", "binance", "monobank", "privatbank", "yoomoney", "tdbank", "payoneer", "revolut"].includes(normalizedProvider)) return `${normalizedProvider}_auto`;
  return "provider_auto";
}

function normalizeTimestamp(value) {
  const raw = String(value || "").trim();
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : "";
}

function monobankCurrencyByCode(code) {
  const lookup = { 124: "CAD", 840: "USD", 978: "EUR", 980: "UAH" };
  return lookup[Number(code)] || "UAH";
}

function parseSheetNumber(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  const numeric = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function formatSheetNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * (10 ** digits)) / (10 ** digits);
  return String(rounded).replace(".", ",");
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function isPermissionError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.paypalStatus || error?.status || 0);
  return status === 401 || status === 403 || /permission|unauthori[sz]ed|forbidden|auth|credential|token|scope|access_denied|not configured/.test(text);
}

function toSafeComment(error) {
  return String(error?.message || error || "Provider current balance request failed.").slice(0, 240);
}

function isNotSupportedAccountError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.paypalStatus || error?.status || 0);
  return status === 404 || /not supported|unsupported|not enabled|not available|personal account|business account required/.test(text);
}

function buildStructuredError(code, message) {
  return { ok: false, error: message, code };
}
