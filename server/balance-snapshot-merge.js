const MANUAL_BALANCE_SHEET_NAME = "Остатки";
const AUTO_BALANCE_SHEET_NAME = "Авто Остатки";
import { composeAuthoritativeSnapshotRows } from "./authoritative-balance-snapshot-contract.js";

export function mergeManualAndAutoBalances(manualBalances = [], autoBalances = []) {
  const manualRows = (manualBalances || []).map((row) => {
    const source = normalizeBalanceSource(row, "manual_fact");
    return {
      ...row,
      source,
      fact_source: source,
      sourceSheet: row.sourceSheet || MANUAL_BALANCE_SHEET_NAME,
    };
  });
  const manualFactKeys = new Set(manualRows
    .filter((row) => normalizeBalanceSource(row, "manual_fact") === "manual_fact")
    .map(balanceKey));
  const manualFactAccountDates = buildManualFactAccountDates(manualRows);
  const manualBalanceKeys = new Set(manualRows.map(balanceKey));
  const autoFallbackRows = [];
  let autoIgnored = 0;
  let autoIgnoredStaleCurrent = 0;

  for (const row of autoBalances || []) {
    if (manualFactKeys.has(balanceKey(row)) || manualBalanceKeys.has(balanceKey(row))) {
      autoIgnored += 1;
      continue;
    }
    if (isRetiredAutoBalanceChannel(row) || isDerivedAutoSupersededByManualFact(row, manualFactAccountDates)) {
      autoIgnored += 1;
      continue;
    }
    if (isStaleCurrentOnlyAutoSnapshot(row)) {
      autoIgnoredStaleCurrent += 1;
      continue;
    }
    const source = normalizeBalanceSource(row, "provider_auto");
    autoFallbackRows.push({
      ...row,
      source,
      fact_source: source,
      balanceSource: source,
      sourceSheet: row.sourceSheet || AUTO_BALANCE_SHEET_NAME,
    });
  }

  const composition = composeAuthoritativeSnapshotRows([...manualRows, ...autoFallbackRows]);
  const rows = composition.rows;
  return {
    rows,
    merged: rows,
    excluded_from_authoritative_total: composition.excluded_rows,
    authoritative_batches: composition.authoritative_batches,
    authoritative_snapshot_conflicts: composition.conflicts,
    autoUsed: autoFallbackRows.length,
    autoIgnored,
    auto_balance_rows_used_as_fallback: autoFallbackRows.length,
    auto_balance_rows_ignored_due_to_manual: autoIgnored,
    autoIgnoredStaleCurrent,
    auto_balance_rows_ignored_as_stale_current: autoIgnoredStaleCurrent,
  };
}

function balanceKey(row = {}) {
  return [
    normalizeDate(row.date),
    canonicalBalanceChannel(row.channel || row.accountName || row.account, row.currency),
    String(row.currency || "").trim().toUpperCase(),
  ].join("|");
}

function accountKey(row = {}) {
  return [
    canonicalBalanceChannel(row.channel || row.accountName || row.account, row.currency),
    String(row.currency || "").trim().toUpperCase(),
  ].join("|");
}

function buildManualFactAccountDates(rows = []) {
  const datesByKey = new Map();
  for (const row of rows || []) {
    if (normalizeBalanceSource(row, "manual_fact") !== "manual_fact") continue;
    const date = normalizeDate(row.date);
    const key = accountKey(row);
    if (!date || key === "|") continue;
    const dates = datesByKey.get(key) || [];
    dates.push(date);
    datesByKey.set(key, dates);
  }
  for (const dates of datesByKey.values()) dates.sort();
  return datesByKey;
}

function isDerivedAutoSupersededByManualFact(row = {}, manualFactAccountDates = new Map()) {
  if (normalizeBalanceSource(row, "provider_auto") !== "derived_balance") return false;
  if (!isOwnerConfirmedCurrentOverrideKey(row)) return false;
  const rowDate = normalizeDate(row.date);
  if (!rowDate) return false;
  const dates = manualFactAccountDates.get(accountKey(row)) || [];
  return dates.some((date) => date <= rowDate);
}

function isOwnerConfirmedCurrentOverrideKey(row = {}) {
  return new Set([
    "binance save|USD",
    "Бинанс spot|USD",
    "БАНК КАНАДА cad|CAD",
    "монобанк грн|UAH",
    "приват 24-грн|UAH",
  ]).has(accountKey(row));
}

function isRetiredAutoBalanceChannel(row = {}) {
  if (normalizeBalanceSource(row, "provider_auto") !== "derived_balance") return false;
  return canonicalBalanceChannel(row.channel || row.accountName || row.account, row.currency) === "";
}

function normalizeBalanceSource(row = {}, fallback = "manual_fact") {
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.status,
    row.comment,
    row.sourceSheet,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/derived_from_confirmed_balance|paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed paypal balance/.test(text)) return "derived_balance";
  if (/manual[_ -]owner[_ -]confirmed|owner[_ -]confirmed/.test(text)) return "manual_fact";
  if (/manual_fact|paypal_manual_balance|paypal_manual_confirmed_balance|manual paypal balance|manual confirmed|manual fact/.test(text)) return "manual_fact";
  if (/auto snapshot|provider_auto|provider|wise|paypal|monobank|binance|privat|yoomoney/.test(text)) return "provider_auto";
  return fallback;
}

function isStaleCurrentOnlyAutoSnapshot(row = {}) {
  const source = normalizeBalanceSource(row, "provider_auto");
  if (source !== "provider_auto") return false;
  const rowDate = normalizeDate(row.date);
  const fetchedDate = normalizeDate(String(row.fetchedAt || row.fetched_at || "").slice(0, 10));
  if (!rowDate || !fetchedDate || rowDate === fetchedDate) return false;
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
    row.status,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  return /auto daily provider snapshot|current[- ]?balance|current balance|provider current/.test(text);
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  return "";
}

function canonicalBalanceChannel(value, currency = "") {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  if (!raw) return "";
  if (normalized === "legacy_combined_binance_spot_funding") return "";
  if (/^binance\s+spot$/.test(normalized)) return "Бинанс spot";
  if (/^бинанс\s+spot$/.test(normalized)) return "Бинанс spot";
  if (/^binance\s+save$/.test(normalized)) return "binance save";
  if (/^банк\s+канада\s+cad(?:\s+cad)?$/i.test(raw)) return "БАНК КАНАДА cad";
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (normalizedCurrency && normalized.endsWith(` ${normalizedCurrency.toLowerCase()}`)) {
    return raw.slice(0, -(normalizedCurrency.length + 1)).trim();
  }
  return raw;
}
