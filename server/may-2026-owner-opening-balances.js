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

export function buildOwnerMayOpeningBalanceRows(rows = OWNER_MAY_OPENING_BALANCES, options = {}) {
  const validation = validateOwnerMayOpeningBalances(rows);
  const adjustedTotalOnly = options.allowAdjustedTotal === true
    && validation.errors.every((error) => /^owner total_usd mismatch: /.test(error));
  if (!validation.ok && !adjustedTotalOnly) {
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
      owner_input_opening_total_usd: ownerMayOpeningTotalUsd(),
      reconciliation_adjusted_opening: buildReconciliationAdjustedMayOpening({
        ownerRows: options.ownerRows || OWNER_MAY_OPENING_BALANCES,
        balanceRows,
        operations: options.operations || [],
        period: options.period || {},
      }),
      warnings: [],
    };
  }
  const reconciliationAdjustedOpening = buildReconciliationAdjustedMayOpening({
    ownerRows: options.ownerRows || OWNER_MAY_OPENING_BALANCES,
    balanceRows,
    operations: options.operations || [],
    period: options.period || {},
  });
  const ownerRows = buildOwnerMayOpeningBalanceRows(
    buildAdjustedOwnerRows(options.ownerRows || OWNER_MAY_OPENING_BALANCES, reconciliationAdjustedOpening),
    { allowAdjustedTotal: true }
  );
  const filtered = (balanceRows || []).filter((row) => {
    if (normalizeDate(row?.date) !== OWNER_MAY_OPENING_BALANCE_DATE) return true;
    return !SUPERSEDED_MAY_OPENING_KEYS.has(balanceKey(row?.channel || row?.accountName || row?.account, row?.currency));
  });
  return {
    rows: [...filtered, ...ownerRows],
    applied: true,
    owner_total_usd: ownerMayOpeningTotalUsd(options.ownerRows || OWNER_MAY_OPENING_BALANCES),
    owner_input_opening_total_usd: reconciliationAdjustedOpening.owner_input_opening_total_usd,
    reconciliation_adjusted_opening_total_usd: reconciliationAdjustedOpening.reconciliation_adjusted_opening_total_usd,
    diff_from_owner_input_total_usd: reconciliationAdjustedOpening.diff_from_owner_input_total_usd,
    reconciliation_adjusted_opening: reconciliationAdjustedOpening,
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

export function buildReconciliationAdjustedMayOpening({
  ownerRows = OWNER_MAY_OPENING_BALANCES,
  balanceRows = [],
  operations = [],
  period = {},
} = {}) {
  const ownerByKey = new Map();
  for (const row of ownerRows || []) {
    ownerByKey.set(balanceKey(row.channel, row.currency), row);
  }
  const latestFacts = buildLatestLaterConfirmedBalanceIndex(balanceRows, period);
  const keys = new Set([...ownerByKey.keys(), ...latestFacts.keys()]);
  const rows = Array.from(keys).map((key) => {
    const [channel, currency] = splitBalanceKey(key);
    const owner = ownerByKey.get(key) || null;
    const fact = latestFacts.get(key) || null;
    const movement = fact
      ? sumLedgerMovements({ operations, channel, currency, from: addDays(OWNER_MAY_OPENING_BALANCE_DATE, 1), to: fact.date })
      : { native: 0, usd: 0, hasUsd: false };
    const ownerInput = parseNumber(owner?.amount);
    const ownerInputUsd = parseNumber(owner?.amountUsd);
    const impliedOpening = fact ? round(fact.amount - movement.native) : null;
    const impliedOpeningUsd = fact && fact.amount_usd !== null
      ? round(fact.amount_usd - (movement.hasUsd ? movement.usd : 0))
      : estimateAdjustedUsd({ ownerInput, ownerInputUsd, adjustedOpening: impliedOpening });
    const diff = ownerInput !== null && impliedOpening !== null ? round(impliedOpening - ownerInput) : null;
    const tolerance = getOpeningTolerance(currency);
    const withinTolerance = diff !== null && Math.abs(diff) <= tolerance;

    let reason = "missing_later_confirmed_balance";
    let confidence = "medium";
    let adjustedOpening = ownerInput;
    let adjustedOpeningUsd = ownerInputUsd;

    if (owner && fact && withinTolerance) {
      reason = "rounding_or_fx";
      confidence = "high";
      adjustedOpening = impliedOpening;
      adjustedOpeningUsd = impliedOpeningUsd ?? estimateAdjustedUsd({ ownerInput, ownerInputUsd, adjustedOpening });
    } else if (owner && fact) {
      reason = "needs_verification";
      confidence = "low";
    } else if (!owner && fact) {
      reason = "candidate_missing_opening";
      confidence = "low";
      adjustedOpening = null;
      adjustedOpeningUsd = null;
    }

    return {
      channel,
      currency,
      owner_input: ownerInput,
      owner_input_usd: ownerInputUsd,
      owner_input_total_usd: ownerInputUsd,
      implied_opening: impliedOpening,
      implied_opening_usd: impliedOpeningUsd,
      adjusted_opening: adjustedOpening,
      adjusted_opening_usd: adjustedOpeningUsd,
      diff,
      tolerance,
      reason,
      adjustment_reason: reason,
      confidence,
      later_confirmed_balance: fact?.amount ?? null,
      later_confirmed_balance_usd: fact?.amount_usd ?? null,
      later_confirmed_balance_date: fact?.date || null,
      ledger_movement_from_2026_05_02_to_confirmed_date: fact ? movement.native : null,
      ledger_movement_usd_from_2026_05_02_to_confirmed_date: fact && movement.hasUsd ? movement.usd : null,
      source: owner ? "owner_input" : "candidate_from_later_confirmed_balance",
    };
  }).sort((left, right) => left.channel === right.channel ? left.currency.localeCompare(right.currency) : left.channel.localeCompare(right.channel));

  const ownerTotal = ownerMayOpeningTotalUsd(ownerRows);
  const adjustedTotal = round(rows.reduce((sum, row) => sum + Number(row.adjusted_opening_usd ?? row.owner_input_usd ?? 0), 0));
  const adjustedRows = rows.filter((row) => row.reason === "rounding_or_fx" && Math.abs(Number(row.diff || 0)) > 0);
  const needsVerificationRows = rows.filter((row) => row.reason === "needs_verification" || row.reason === "candidate_missing_opening");

  return {
    owner_input_opening_total_usd: ownerTotal,
    owner_input_total_usd: ownerTotal,
    reconciliation_adjusted_opening_total_usd: adjustedTotal,
    adjusted_total_usd: adjustedTotal,
    diff_from_owner_input_total_usd: round(adjustedTotal - ownerTotal),
    rows,
    per_channel_table: rows,
    adjusted_rows: adjustedRows,
    needs_verification_rows: needsVerificationRows,
    no_silent_overwrites: true,
  };
}

export function isSupersededOwnerMayOpeningBalanceKey(channel, currency) {
  return SUPERSEDED_MAY_OPENING_KEYS.has(balanceKey(channel, currency));
}

function balanceKey(channel, currency) {
  return `${String(channel || "").trim()}|${String(currency || "").trim().toUpperCase()}`;
}

function splitBalanceKey(key) {
  const [channel, currency] = String(key || "").split("|");
  return [channel || "", currency || ""];
}

function buildAdjustedOwnerRows(ownerRows, report) {
  const rowsByKey = new Map((report?.rows || []).map((row) => [balanceKey(row.channel, row.currency), row]));
  return (ownerRows || []).map((row) => {
    const adjustment = rowsByKey.get(balanceKey(row.channel, row.currency));
    if (!adjustment || adjustment.reason !== "rounding_or_fx") return row;
    return {
      ...row,
      amount: adjustment.adjusted_opening ?? row.amount,
      amountUsd: adjustment.adjusted_opening_usd ?? row.amountUsd,
      ownerInputAmount: row.amount,
      ownerInputAmountUsd: row.amountUsd,
      adjustmentReason: adjustment.reason,
    };
  });
}

function buildLatestLaterConfirmedBalanceIndex(balanceRows = [], period = {}) {
  const latest = new Map();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    if (!date || date <= OWNER_MAY_OPENING_BALANCE_DATE) continue;
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    if (!channel || !currency || amount === null) continue;
    const key = balanceKey(channel, currency);
    const current = latest.get(key);
    if (current && current.date > date) continue;
    latest.set(key, {
      date,
      channel,
      currency,
      amount,
      amount_usd: resolveUsdAmount(row, amount, currency),
    });
  }
  return latest;
}

function sumLedgerMovements({ operations = [], channel, currency, from, to }) {
  let native = 0;
  let usd = 0;
  let hasUsd = false;
  for (const operation of operations || []) {
    const ledger = operation?.ledgerV2 || {};
    const date = normalizeDate(operation?.date ?? ledger.date);
    if (!date || date < from || date > to) continue;
    const operationCurrency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
    if (operationCurrency !== currency) continue;
    const amount = parseNumber(ledger.balance_amount ?? operation?.balanceAmount);
    if (amount === null) continue;
    if (getMovementChannel(operation, amount) !== channel) continue;
    native += amount;
    const amountUsd = parseSignedUsdAmount(operation, amount, currency);
    if (amountUsd !== null) {
      usd += amountUsd;
      hasUsd = true;
    }
  }
  return { native: round(native), usd: round(usd), hasUsd };
}

function getMovementChannel(operation, amount) {
  const ledger = operation?.ledgerV2 || {};
  const from = String(ledger.from_channel || operation?.fromChannel || operation?.from_channel || "").trim();
  const to = String(ledger.to_channel || operation?.toChannel || operation?.to_channel || "").trim();
  const fallback = String(operation?.channel || operation?.accountName || operation?.account || "").trim();
  return Number(amount) < 0 ? (from || fallback || to) : (to || fallback || from);
}

function parseSignedUsdAmount(operation, amount, currency) {
  const ledger = operation?.ledgerV2 || {};
  const parsed = parseNumber(ledger.amount_usd ?? operation?.amountUsd ?? operation?.amount_usd);
  if (parsed !== null) return Number(amount) < 0 ? -Math.abs(parsed) : Math.abs(parsed);
  if (isStableUsdCurrency(currency)) return amount;
  return null;
}

function resolveUsdAmount(row, amount, currency) {
  const parsed = parseNumber(row?.amount_usd ?? row?.amountUsd ?? row?.usdAmount ?? row?.balance_usd);
  if (parsed !== null) return parsed;
  if (isStableUsdCurrency(currency)) return amount;
  return null;
}

function estimateAdjustedUsd({ ownerInput, ownerInputUsd, adjustedOpening }) {
  if (ownerInput === null || ownerInputUsd === null || adjustedOpening === null) return ownerInputUsd;
  if (ownerInput === 0) return ownerInputUsd;
  return round(adjustedOpening * (ownerInputUsd / ownerInput));
}

function getOpeningTolerance(currency) {
  const normalized = String(currency || "").trim().toUpperCase();
  if (normalized === "UAH") return 5;
  if (["BTC", "ETH", "BNB"].includes(normalized)) return 0.00000001;
  return 0.5;
}

function isStableUsdCurrency(currency) {
  return ["USD", "USDT", "USDC"].includes(String(currency || "").trim().toUpperCase());
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(",", ".").replace(/\s+/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}
