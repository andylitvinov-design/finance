export const MAY_OWNER_OPENING_BALANCE_DATE = "2026-05-01";
export const MAY_OWNER_OPENING_BALANCE_SOURCE = "manual_owner_confirmed_2026_05_01";

export const BINANCE_SAVE_OWNER_OPENING_SPLIT_SOURCE = "owner_combined_usdt_usdc_split";

const MAY_OWNER_OPENING_BALANCE_CURRENCIES = new Set(["usd", "usdt", "usdc"]);

export const MAY_OWNER_OPENING_BALANCES = [
  {
    inputChannel: "binance save",
    channel: "binance save",
    currency: "USDT",
    amount: 5411.6278,
    amountUsd: 5411.6278,
    reason: BINANCE_SAVE_OWNER_OPENING_SPLIT_SOURCE,
    adjustmentReason: BINANCE_SAVE_OWNER_OPENING_SPLIT_SOURCE,
    confidence: "medium",
    confidenceNote: "Owner clarified that combined Binance Save opening 8519 is composed of USDT + USDC.",
  },
  {
    inputChannel: "binance save",
    channel: "binance save",
    currency: "USDC",
    amount: 3107.3722,
    amountUsd: 3107.3722,
    reason: BINANCE_SAVE_OWNER_OPENING_SPLIT_SOURCE,
    adjustmentReason: BINANCE_SAVE_OWNER_OPENING_SPLIT_SOURCE,
    confidence: "medium",
    confidenceNote: "Owner clarified that combined Binance Save opening 8519 is composed of USDT + USDC.",
  },
];

const SPLIT_TOTAL = 8519;
const SPLIT_SOURCE_CURRENCY = "USD";

const SPLIT_INPUT = {
  channel: "binance save",
  currency: "USD",
  amount: SPLIT_TOTAL,
  amountUsd: SPLIT_TOTAL,
  date: MAY_OWNER_OPENING_BALANCE_DATE,
};

export function applyOwnerMayOpeningBalanceSeed(rows = []) {
  const normalized = Array.isArray(rows) ? rows : [];
  const hasCombined = normalized.some((row) => isOwnerCombinedBinanceSaveRow(row));
  if (!hasCombined) return normalized;
  const splitRows = buildSplitRows();
  return normalized.filter((row) => !isOwnerCombinedBinanceSaveRow(row) && !isMayOwnerOpeningAnchorRow(row)).concat(splitRows);
}

export function isOwnerCombinedBinanceSaveRow(row = {}) {
  if (!row) return false;
  const channel = normalizeText(row.channel || row.accountName || row.account || "");
  const currency = normalizeText(row.currency || "");
  const date = String(row.date || "");
  const amount = parseAmount(row.amount ?? row.balanceAmount);
  const amountUsd = parseAmount(row.usdAmount ?? row.amountUsd);
  return date === MAY_OWNER_OPENING_BALANCE_DATE
    && channel === "binance save"
    && currency === SPLIT_SOURCE_CURRENCY.toLowerCase()
    && amount !== null
    && amountUsd !== null
    && Math.abs(amount - SPLIT_TOTAL) <= 0.0001
    && Math.abs(amountUsd - SPLIT_TOTAL) <= 0.0001;
}

function buildSplitRows() {
  const templates = MAY_OWNER_OPENING_BALANCES;
  if (!templates.length) return [];

  const splitRows = templates.map((row) => ({
    date: MAY_OWNER_OPENING_BALANCE_DATE,
    channel: row.channel,
    accountName: row.channel,
    amount: String(row.amount),
    balanceAmount: String(row.amount),
    currency: row.currency,
    rate: "1",
    usdAmount: String(row.amountUsd),
    amountUsd: String(row.amountUsd),
    balance_usd: row.amountUsd,
    source: MAY_OWNER_OPENING_BALANCE_SOURCE,
    comment: `Owner-confirmed opening balance split from ${SPLIT_TOTAL} combined ${SPLIT_INPUT.channel} ${SPLIT_INPUT.currency} row.`,
    reason: row.reason,
    adjustmentReason: row.adjustmentReason,
    confidence: row.confidence,
    confidenceNote: row.confidenceNote,
    split_from: `${SPLIT_INPUT.channel}|${SPLIT_INPUT.currency}|${SPLIT_INPUT.amount}`,
  }));

  return splitRows;
}

function isMayOwnerOpeningAnchorRow(row = {}) {
  const date = String(row.date || "");
  const channel = normalizeText(row.channel || row.accountName || row.account || "");
  const currency = normalizeText(row.currency || "");
  return date === MAY_OWNER_OPENING_BALANCE_DATE
    && channel === "binance save"
    && MAY_OWNER_OPENING_BALANCE_CURRENCIES.has(currency);
}

function parseAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}
