export const OWNER_MAY_CURRENT_BALANCE_DATE = "2026-05-28";
export const OWNER_MAY_CURRENT_BALANCE_SOURCE = "manual_owner_confirmed_2026_05_28";
export const OWNER_JUNE_CURRENT_BALANCE_DATE = "2026-06-01";
export const OWNER_JUNE_CURRENT_BALANCE_SOURCE = "manual_owner_confirmed_2026_06_01";

export const OWNER_MAY_CURRENT_BALANCE_CORRECTIONS = [
  { channel: "binance save", currency: "USDT", amount: 5412, amount_usd: 5412 },
  { channel: "binance save", currency: "USDC", amount: 2020, amount_usd: 2020 },
  { channel: "Бинанс spot", currency: "USDT", amount: 1162, amount_usd: 1162 },
  { channel: "Бинанс spot", currency: "USDC", amount: 0, amount_usd: 0 },
  { channel: "БАНК КАНАДА cad", currency: "CAD", amount: 10538, amount_usd: 7798 },
  {
    channel: "монобанк грн",
    currency: "UAH",
    delta_amount: 10313,
    amount_usd_strategy: "preserve_existing_rate",
    date: OWNER_JUNE_CURRENT_BALANCE_DATE,
    source: OWNER_JUNE_CURRENT_BALANCE_SOURCE,
    comment: "Owner-confirmed 2026-06-01 Monobank correction from 2026-05-30: +10313 UAH.",
  },
  { channel: "Яндекс руб", currency: "RUB", amount: null, amount_usd: 1376 },
  {
    channel: "Payoneer - eur",
    currency: "EUR",
    delta_amount: 410.2,
    amount_usd_strategy: "preserve_existing_rate",
    date: OWNER_JUNE_CURRENT_BALANCE_DATE,
    source: OWNER_JUNE_CURRENT_BALANCE_SOURCE,
    comment: "Owner-confirmed 2026-06-01 Payoneer payments: 64 + 298 + 48.2 EUR.",
  },
  {
    channel: "пейпал дол",
    currency: "USD",
    delta_amount: 51.59,
    amount_usd_strategy: "native_usd",
    date: OWNER_JUNE_CURRENT_BALANCE_DATE,
    source: OWNER_JUNE_CURRENT_BALANCE_SOURCE,
    comment: "Owner-confirmed 2026-06-01 PayPal USD correction from 2026-05-28: +51.59 USD.",
  },
];

const RETIRED_CURRENT_KEYS = new Set([
  balanceKey("binance save", "USD"),
  balanceKey("Бинанс spot", "USD"),
  balanceKey("legacy_combined_binance_spot_funding", "USDT"),
]);

export function applyOwnerMayCurrentBalanceSnapshot(balanceRows = [], options = {}) {
  if (!shouldApplyOwnerMayCurrentBalanceSnapshot({
    ...(options.period || {}),
    ownerOpeningSeedApplied: options.ownerOpeningSeedApplied,
  })) {
    return { rows: balanceRows, applied: false, warnings: [] };
  }

  const targetDate = normalizeDate(options.targetDate || options.period?.to) || OWNER_MAY_CURRENT_BALANCE_DATE;
  const sourceRows = Array.isArray(balanceRows) ? balanceRows : [];
  const corrections = buildOwnerMayCurrentBalanceRows(sourceRows, {
    date: options.rowDate || OWNER_MAY_CURRENT_BALANCE_DATE,
  });
  const correctionKeys = new Set(corrections.map((row) => balanceKey(row.channel, row.currency)));
  const filteredRows = sourceRows.filter((row) => {
    const date = normalizeDate(row?.date);
    const channel = canonicalChannel(row?.channel || row?.accountName || row?.account, row?.currency);
    const currency = normalizeCurrency(row?.currency);
    const key = balanceKey(channel, currency);
    const correction = corrections.find((entry) => balanceKey(entry.channel, entry.currency) === key);
    const correctionDate = normalizeDate(correction?.date) || OWNER_MAY_CURRENT_BALANCE_DATE;
    if (RETIRED_CURRENT_KEYS.has(key)) return false;
    if (!correctionKeys.has(key)) return true;
    if (!date || date < correctionDate) return true;
    return isManualOwnerConfirmedRow(row) && date > correctionDate;
  });

  return {
    rows: [...filteredRows, ...corrections],
    applied: true,
    owner_current_date: OWNER_MAY_CURRENT_BALANCE_DATE,
    target_date: targetDate,
    warnings: [],
  };
}

export function shouldApplyOwnerMayCurrentBalanceSnapshot(period = {}) {
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  if (!to || to < OWNER_MAY_CURRENT_BALANCE_DATE) return false;
  if (to < "2026-06-01" && period.ownerOpeningSeedApplied !== true) return false;
  if (from && from > OWNER_MAY_CURRENT_BALANCE_DATE) return false;
  return true;
}

function buildOwnerMayCurrentBalanceRows(existingRows = [], options = {}) {
  const date = normalizeDate(options.date) || OWNER_MAY_CURRENT_BALANCE_DATE;
  return OWNER_MAY_CURRENT_BALANCE_CORRECTIONS
    .map((correction) => {
      const existing = findLatestExistingRow(existingRows, correction);
      const amount = resolveCorrectionAmount(correction, existing);
      if (amount === null) return null;
      const rowDate = normalizeDate(correction.date) || date;
      const amountUsd = resolveCorrectionAmountUsd(correction, existing, amount);
      const source = correction.source || OWNER_MAY_CURRENT_BALANCE_SOURCE;
      return {
        date: rowDate,
        channel: correction.channel,
        accountName: correction.channel,
        currency: correction.currency,
        amount,
        balanceAmount: amount,
        usdAmount: amountUsd,
        amountUsd,
        amount_usd: amountUsd,
        balance_usd: amountUsd,
        source,
        fact_source: source,
        balanceSource: "manual_fact",
        sourceSheet: "Owner Confirmed",
        comment: correction.comment || `Owner-confirmed current balance for ${rowDate}.`,
      };
    })
    .filter(Boolean);
}

function resolveCorrectionAmount(correction = {}, existing = {}) {
  if (correction.amount !== null && correction.amount !== undefined) return correction.amount;
  const existingAmount = parseNumber(existing?.amount ?? existing?.balanceAmount);
  if (correction.delta_amount !== null && correction.delta_amount !== undefined) {
    const delta = parseNumber(correction.delta_amount);
    if (existingAmount === null || delta === null) return null;
    return round(existingAmount + delta);
  }
  return existingAmount;
}

function resolveCorrectionAmountUsd(correction = {}, existing = {}, amount = null) {
  if (correction.amount_usd !== null && correction.amount_usd !== undefined) return correction.amount_usd;
  if (correction.amount_usd_strategy === "native_usd") return round(amount);
  if (correction.amount_usd_strategy === "preserve_existing_rate") {
    const existingAmount = parseNumber(existing?.amount ?? existing?.balanceAmount);
    const existingUsd = parseNumber(existing?.amount_usd ?? existing?.amountUsd ?? existing?.usdAmount ?? existing?.balance_usd);
    if (existingAmount !== null && existingAmount !== 0 && existingUsd !== null && amount !== null) {
      return round(amount * (existingUsd / existingAmount));
    }
    const existingRate = parseNumber(existing?.rate ?? existing?.fx_rate_to_usd ?? existing?.fxRateToUsd);
    if (existingRate !== null && amount !== null) return round(amount * existingRate);
  }
  return null;
}

function findLatestExistingRow(rows = [], correction = {}) {
  const key = balanceKey(correction.channel, correction.currency);
  const correctionDate = normalizeDate(correction.date) || OWNER_MAY_CURRENT_BALANCE_DATE;
  return [...rows]
    .filter((row) => balanceKey(row?.channel || row?.accountName || row?.account, row?.currency) === key)
    .filter((row) => normalizeDate(row?.date) <= correctionDate)
    .sort((left, right) => normalizeDate(left?.date).localeCompare(normalizeDate(right?.date)))
    .at(-1) || null;
}

function isManualOwnerConfirmedRow(row = {}) {
  return /manual[_ -]owner[_ -]confirmed|owner[_ -]confirmed/i.test([
    row.source,
    row.fact_source,
    row.comment,
    row.sourceSheet,
  ].map((value) => String(value || "")).join(" "));
}

function balanceKey(channel, currency) {
  return `${canonicalChannel(channel, currency)}|${normalizeCurrency(currency)}`;
}

function canonicalChannel(value, currency = "") {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  if (!raw) return "";
  if (normalized === "legacy_combined_binance_spot_funding") return "legacy_combined_binance_spot_funding";
  if (/^binance\s+spot$/.test(normalized) || /^бинанс\s+spot$/.test(normalized)) return "Бинанс spot";
  if (/^binance\s+save$/.test(normalized)) return "binance save";
  if (/^банк\s+канада\s+cad(?:\s+cad)?$/i.test(raw)) return "БАНК КАНАДА cad";
  const normalizedCurrency = normalizeCurrency(currency);
  if (normalizedCurrency && normalized.endsWith(` ${normalizedCurrency.toLowerCase()}`)) {
    return raw.slice(0, -(normalizedCurrency.length + 1)).trim();
  }
  return raw;
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  return "";
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round((parsed + Number.EPSILON) * factor) / factor;
}
