export const OWNER_MAY_OPENING_BALANCE_DATE = "2026-05-01";
export const OWNER_MAY_OPENING_BALANCE_SOURCE = "manual_owner_confirmed_2026_05_01";

export const OWNER_MAY_OPENING_BALANCES = [
  { inputChannel: "смано ЯД", channel: "Яндекс руб", currency: "RUB", amount: "", amountUsd: 1722 },
  { inputChannel: "пейпал дол", channel: "пейпал дол", currency: "USD", amount: 435, amountUsd: 435 },
  { inputChannel: "пейпал евр", channel: "пейпал евр", currency: "EUR", amount: 0, amountUsd: 0 },
  { inputChannel: "деп24-дол", channel: "деп24-дол", currency: "USD", amount: 0, amountUsd: 0 },
  { inputChannel: "деп24-евро", channel: "деп24-евро", currency: "EUR", amount: 0, amountUsd: 0 },
  { inputChannel: "пейпал cad", channel: "пейпал сad", currency: "CAD", amount: 0, amountUsd: 0 },
  { inputChannel: "24-грн", channel: "приват 24-грн", currency: "UAH", amount: 11239, amountUsd: 254 },
  { inputChannel: "монобанк", channel: "монобанк грн", currency: "UAH", amount: 26670, amountUsd: 603 },
  { inputChannel: "трансервайз евро", channel: "трансервайз евро", currency: "EUR", amount: 0, amountUsd: 0 },
  { inputChannel: "трансервайз дол", channel: "трансервайз дол", currency: "USD", amount: 2639, amountUsd: 2639 },
  { inputChannel: "REVOLUT", channel: "REVOLUT дол", currency: "USD", amount: 378, amountUsd: 378 },
  { inputChannel: "Payoneer - eur", channel: "Payoneer - eur", currency: "EUR", amount: "", amountUsd: 1284 },
  { inputChannel: "Payoneer - dol", channel: "Payoneer - dol", currency: "USD", amount: 3, amountUsd: 3 },
  { inputChannel: "Бинанс spot", channel: "Бинанс spot", currency: "USDT", amount: 1090, amountUsd: 1090 },
  { inputChannel: "binance save", channel: "binance save", currency: "USDT", amount: 8519, amountUsd: 8519 },
  { inputChannel: "Нал-я-евр", channel: "Налично -я-евр", currency: "EUR", amount: "", amountUsd: 91 },
  { inputChannel: "местная валюты", channel: "местная валюты", currency: "LOCAL", amount: 0, amountUsd: 0 },
  { inputChannel: "БАНК КАНАДА", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "", amountUsd: 7351 },
  { inputChannel: "ФОП - мамо", channel: "приват-фоп", currency: "UAH", amount: 0, amountUsd: 0 },
  { inputChannel: "24-евро", channel: "приват 24-евро", currency: "EUR", amount: "", amountUsd: 1 },
  { inputChannel: "карта тай", channel: "карта тай", currency: "THB", amount: 0, amountUsd: 0 },
  { inputChannel: "нал-мам-е", channel: "нал-мам-евро", currency: "EUR", amount: "", amountUsd: 580 },
  { inputChannel: "нал-мам-д", channel: "нал-мам-дол", currency: "USD", amount: 0, amountUsd: 0 },
  { inputChannel: "24-дол", channel: "приват 24-дол", currency: "USD", amount: 43, amountUsd: 43 },
  { inputChannel: "переплата Богдану", channel: "переплата Богдану", currency: "USD", amount: 0, amountUsd: 0 },
];

const SUPERSEDED_MAY_OPENING_KEYS = new Set([
  ...OWNER_MAY_OPENING_BALANCES.map((row) => balanceKey(row.channel, row.currency)),
  balanceKey("binance save", "USD"),
  balanceKey("binance save", "USDC"),
  balanceKey("legacy_combined_binance_spot_funding", "USDT"),
  balanceKey("Бинанс spot", "USD"),
  balanceKey("Бинанс spot", "USDC"),
  balanceKey("REVOLUT евро", "EUR"),
  balanceKey("карта май", "UNKNOWN"),
]);

const DETECTION_KEYS = new Set([
  balanceKey("пейпал дол", "USD"),
  balanceKey("приват 24-грн", "UAH"),
  balanceKey("монобанк грн", "UAH"),
  balanceKey("БАНК КАНАДА cad", "CAD"),
  balanceKey("binance save", "USDT"),
  balanceKey("Яндекс руб", "RUB"),
  balanceKey("Payoneer - eur", "EUR"),
  balanceKey("трансервайз дол", "USD"),
  balanceKey("Налично -я-евр", "EUR"),
  balanceKey("нал-мам-евро", "EUR"),
]);

export function buildOwnerMayOpeningBalanceRows(rows = OWNER_MAY_OPENING_BALANCES) {
  const validation = validateOwnerMayOpeningBalances(rows);
  if (!validation.ok) {
    throw new Error(`Invalid owner-confirmed 2026-05-01 opening balances: ${validation.errors.join("; ")}`);
  }
  return rows.map((row) => ({
    date: OWNER_MAY_OPENING_BALANCE_DATE,
    channel: row.channel,
    accountName: row.channel,
    currency: row.currency,
    amount: row.amount,
    balanceAmount: row.amount,
    usdAmount: row.amountUsd,
    amountUsd: row.amountUsd,
    amount_usd: row.amountUsd,
    balance_usd: row.amountUsd,
    source: OWNER_MAY_OPENING_BALANCE_SOURCE,
    fact_source: OWNER_MAY_OPENING_BALANCE_SOURCE,
    balanceSource: "manual_fact",
    sourceSheet: "Owner Confirmed",
    comment: `Owner-confirmed opening balance for ${OWNER_MAY_OPENING_BALANCE_DATE}; input channel: ${row.inputChannel}.`,
  }));
}

export function applyOwnerMayOpeningBalanceSeed(balanceRows = [], options = {}) {
  if (!shouldApplyOwnerMayOpeningSeed(balanceRows, options)) {
    return {
      rows: balanceRows,
      applied: false,
      owner_total_usd: ownerMayOpeningTotalUsd(),
      warnings: [],
    };
  }
  const ownerRows = buildOwnerMayOpeningBalanceRows(options.ownerRows || OWNER_MAY_OPENING_BALANCES);
  const filtered = (balanceRows || []).filter((row) => {
    if (normalizeDate(row?.date) !== OWNER_MAY_OPENING_BALANCE_DATE) return true;
    return !SUPERSEDED_MAY_OPENING_KEYS.has(balanceKey(row?.channel || row?.accountName || row?.account, row?.currency));
  });
  return {
    rows: [...filtered, ...ownerRows],
    applied: true,
    owner_total_usd: ownerMayOpeningTotalUsd(options.ownerRows || OWNER_MAY_OPENING_BALANCES),
    warnings: [`owner-confirmed ${OWNER_MAY_OPENING_BALANCE_DATE} opening balance seed applied; total_usd=24993`],
  };
}

export function shouldApplyOwnerMayOpeningSeed(balanceRows = [], options = {}) {
  if (options.force === true) return true;
  if (options.force === false) return false;
  let detected = 0;
  for (const row of balanceRows || []) {
    if (normalizeDate(row?.date) !== OWNER_MAY_OPENING_BALANCE_DATE) continue;
    if (DETECTION_KEYS.has(balanceKey(row?.channel || row?.accountName || row?.account, row?.currency))) detected += 1;
  }
  return detected >= 6;
}

export function validateOwnerMayOpeningBalances(rows = OWNER_MAY_OPENING_BALANCES) {
  const errors = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (!String(row?.inputChannel || "").trim()) errors.push("missing inputChannel");
    if (!String(row?.channel || "").trim() || !String(row?.currency || "").trim()) {
      errors.push(`unmapped owner balance channel: ${row?.inputChannel || "unknown"}`);
      continue;
    }
    const key = balanceKey(row.channel, row.currency);
    if (seen.has(key)) errors.push(`duplicate mapped owner balance key: ${key}`);
    seen.add(key);
    if (!Number.isFinite(Number(row.amountUsd))) errors.push(`missing amount_usd for ${row.inputChannel}`);
  }
  const total = ownerMayOpeningTotalUsd(rows);
  if (total !== 24993) errors.push(`owner total_usd mismatch: ${total} !== 24993`);
  return { ok: errors.length === 0, errors, total_usd: total };
}

export function ownerMayOpeningTotalUsd(rows = OWNER_MAY_OPENING_BALANCES) {
  return round((rows || []).reduce((sum, row) => sum + Number(row?.amountUsd || 0), 0));
}

export function isSupersededOwnerMayOpeningBalanceKey(channel, currency) {
  return SUPERSEDED_MAY_OPENING_KEYS.has(balanceKey(channel, currency));
}

function balanceKey(channel, currency) {
  return `${String(channel || "").trim()}|${String(currency || "").trim().toUpperCase()}`;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function round(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}
