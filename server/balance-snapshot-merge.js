const MANUAL_BALANCE_SHEET_NAME = "Остатки";
const AUTO_BALANCE_SHEET_NAME = "Авто Остатки";

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
  const autoFallbackRows = [];
  let autoIgnored = 0;

  for (const row of autoBalances || []) {
    const source = normalizeBalanceSource(row, "provider_auto");
    if (source !== "planned_daily_balance" && manualFactKeys.has(balanceKey(row))) {
      autoIgnored += 1;
      continue;
    }
    autoFallbackRows.push({
      ...row,
      source,
      fact_source: source,
      balanceSource: source,
      sourceSheet: row.sourceSheet || AUTO_BALANCE_SHEET_NAME,
    });
  }

  const rows = [...manualRows, ...autoFallbackRows];
  return {
    rows,
    merged: rows,
    autoUsed: autoFallbackRows.length,
    autoIgnored,
    auto_balance_rows_used_as_fallback: autoFallbackRows.length,
    auto_balance_rows_ignored_due_to_manual: autoIgnored,
  };
}

function balanceKey(row = {}) {
  return [
    normalizeDate(row.date),
    String(row.channel || row.accountName || row.account || "").trim(),
    String(row.currency || "").trim().toUpperCase(),
  ].join("|");
}

function normalizeBalanceSource(row = {}, fallback = "manual_fact") {
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/paypal_manual_balance|paypal_manual_confirmed_balance|manual paypal balance|manual confirmed|manual fact/.test(text)) return "manual_fact";
  if (/paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed paypal balance/.test(text)) return "derived_balance";
  if (/planned_daily_balance|planned daily balance/.test(text)) return "planned_daily_balance";
  if (/auto snapshot|provider_auto|provider|wise|paypal|monobank|binance|privat|yoomoney/.test(text)) return "provider_auto";
  return fallback;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  return "";
}
