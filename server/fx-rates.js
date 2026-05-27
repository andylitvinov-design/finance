export const FX_RATES_HEADERS = [
  "date",
  "currency",
  "base_currency",
  "rate_to_usd",
  "source",
  "source_url",
  "fetched_at",
  "status",
  "comment",
];

export const DEFAULT_PROVIDER_FX_CURRENCIES = ["EUR", "CAD", "UAH", "RUB", "CHF", "GBP", "THB"];

export function parseFxRateRows(values = []) {
  const { header, rows } = splitHeaderRows(values);
  const indexes = {
    date: findHeaderIndex(header, ["date", "дата"]),
    currency: findHeaderIndex(header, ["currency", "валюта"]),
    baseCurrency: findHeaderIndex(header, ["base_currency", "base currency", "base", "базовая валюта"]),
    rateToUsd: findHeaderIndex(header, ["rate_to_usd", "fx_rate_to_usd", "rate", "курс"]),
    source: findHeaderIndex(header, ["source", "источник"]),
    sourceUrl: findHeaderIndex(header, ["source_url", "source url", "url"]),
    fetchedAt: findHeaderIndex(header, ["fetched_at", "fetchedAt"]),
    status: findHeaderIndex(header, ["status", "статус"]),
    comment: findHeaderIndex(header, ["comment", "комментарий"]),
  };
  const diagnostics = {
    invalid_rows: [],
    status_counts: {},
  };
  if (indexes.date === -1 || indexes.currency === -1 || indexes.rateToUsd === -1) {
    diagnostics.status_counts.invalid_schema = 1;
    return { rates: [], diagnostics };
  }

  const rates = [];
  rows.forEach((row, rowIndex) => {
    const date = normalizeDate(row[indexes.date]);
    const currency = String(row[indexes.currency] || "").trim().toUpperCase();
    const baseCurrency = indexes.baseCurrency === -1 ? "USD" : String(row[indexes.baseCurrency] || "USD").trim().toUpperCase();
    const rateToUsd = parseNumber(row[indexes.rateToUsd]);
    const source = indexes.source === -1 ? "" : String(row[indexes.source] || "").trim();
    const sourceUrl = indexes.sourceUrl === -1 ? "" : String(row[indexes.sourceUrl] || "").trim();
    const fetchedAt = indexes.fetchedAt === -1 ? "" : String(row[indexes.fetchedAt] || "").trim();
    const status = indexes.status === -1 ? "ok" : String(row[indexes.status] || "ok").trim().toLowerCase();
    const comment = indexes.comment === -1 ? "" : String(row[indexes.comment] || "").trim();
    const parsed = {
      date,
      currency,
      base_currency: baseCurrency,
      rate_to_usd: rateToUsd,
      source,
      source_url: sourceUrl,
      fetched_at: fetchedAt,
      status,
      comment,
      row_number: rowIndex + 2,
    };
    const invalidStatus = getInvalidRateStatus(parsed);
    if (invalidStatus) {
      diagnostics.status_counts[invalidStatus] = (diagnostics.status_counts[invalidStatus] || 0) + 1;
      diagnostics.invalid_rows.push({ ...parsed, invalid_status: invalidStatus });
      return;
    }
    diagnostics.status_counts[status] = (diagnostics.status_counts[status] || 0) + 1;
    rates.push(parsed);
  });

  return { rates, diagnostics };
}

export function buildFxRateLookup(rates = []) {
  const lookup = new Map();
  for (const row of rates || []) {
    if (getInvalidRateStatus(row)) continue;
    lookup.set(makeFxRateKey(row.date, row.currency), { ...row, ok: true });
  }
  return lookup;
}

export function resolveFrozenFxRate(lookup, { date, currency } = {}) {
  const normalizedDate = normalizeDate(date);
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const row = lookup?.get?.(makeFxRateKey(normalizedDate, normalizedCurrency));
  if (row) {
    return {
      ok: true,
      date: row.date,
      currency: row.currency,
      base_currency: row.base_currency,
      rate_to_usd: row.rate_to_usd,
      source: row.source || "",
      source_url: row.source_url || "",
      fetched_at: row.fetched_at || "",
      status: row.status || "ok",
      comment: row.comment || "",
    };
  }
  return {
    ok: false,
    status: "needs_fx_rate",
    date: normalizedDate,
    currency: normalizedCurrency,
  };
}

export function isStableUsdCurrency(currency = "") {
  return ["USD", "USDT", "USDC"].includes(String(currency || "").trim().toUpperCase());
}

export async function ensureFxRates({
  from,
  to,
  currencies = DEFAULT_PROVIDER_FX_CURRENCIES,
  currentDate = todayUtcDate(),
  fetchedAt = new Date().toISOString(),
  fetchImpl = fetch,
  readFxRateSheetValues,
  fetchFxRowsForDate,
  applyFxRateRows,
} = {}) {
  if (typeof readFxRateSheetValues !== "function") throw new Error("readFxRateSheetValues is required");
  if (typeof fetchFxRowsForDate !== "function") throw new Error("fetchFxRowsForDate is required");
  if (typeof applyFxRateRows !== "function") throw new Error("applyFxRateRows is required");

  const normalizedFrom = normalizeDate(from) || normalizeDate(to) || normalizeDate(currentDate);
  const normalizedTo = normalizeDate(to) || normalizedFrom;
  const normalizedCurrentDate = normalizeDate(currentDate);
  const providerCurrencies = normalizeEnsureCurrencies(currencies);
  const dates = enumerateDates(normalizedFrom, normalizedTo);
  const sheetValues = await readFxRateSheetValues({ fetchImpl });
  const parsed = parseFxRateRows(sheetValues);
  const existingLookup = buildFxRateLookup(parsed.rates);
  const expectedPairs = [];
  for (const date of dates) {
    for (const currency of providerCurrencies) {
      expectedPairs.push({ date, currency });
    }
  }
  const missingPairs = expectedPairs.filter((pair) => !existingLookup.has(makeFxRateKey(pair.date, pair.currency)));
  const rowsToApply = [];
  const warnings = [];
  const errors = [];

  for (const date of Array.from(new Set(missingPairs.map((pair) => pair.date)))) {
    const missingCurrencies = missingPairs.filter((pair) => pair.date === date).map((pair) => pair.currency);
    try {
      const rows = await fetchFxRowsForDate({ date, currencies: missingCurrencies, fetchedAt, fetchImpl });
      rowsToApply.push(...(rows || []).filter((row) => missingCurrencies.includes(String(row.currency || "").toUpperCase())));
    } catch (error) {
      if (date === normalizedCurrentDate) {
        const fallbackRows = buildPreviousAvailableRows({
          date,
          currencies: missingCurrencies,
          rates: parsed.rates,
          fetchedAt,
        });
        rowsToApply.push(...fallbackRows);
        const fallbackCurrencies = new Set(fallbackRows.map((row) => row.currency));
        const unresolved = missingCurrencies.filter((currency) => !fallbackCurrencies.has(currency));
        if (fallbackRows.length) {
          warnings.push(`previous_available: ${fallbackRows.length} current-date FX rate(s) used because exact provider rates were unavailable.`);
        }
        if (unresolved.length) {
          errors.push({
            code: "provider_error",
            date,
            currency: unresolved.join(","),
            message: safeErrorMessage(error),
          });
        }
      } else {
        errors.push({
          code: "provider_error",
          date,
          currency: missingCurrencies.join(","),
          message: safeErrorMessage(error),
        });
      }
    }
  }

  const stagedLookup = buildFxRateLookup([...parsed.rates, ...rowsToApply]);
  const missingAfterEnsure = expectedPairs.filter((pair) => !stagedLookup.has(makeFxRateKey(pair.date, pair.currency))).length;
  const ok = missingAfterEnsure === 0 && errors.length === 0;
  let applyResult = { applied: false, skipped: missingPairs.length ? "not_ok" : "nothing_missing", target_sheet: "FX Rates" };
  if (ok && rowsToApply.length) {
    applyResult = await applyFxRateRows(rowsToApply, { fetchImpl });
  }

  return {
    ok,
    period: { from: normalizedFrom, to: normalizedTo },
    currencies: providerCurrencies,
    checked: expectedPairs.length,
    already_present: expectedPairs.length - missingPairs.length,
    missing_before_ensure: missingPairs.length,
    fetched_rows: rowsToApply.filter((row) => String(row.status || "ok").toLowerCase() === "ok").length,
    fallback_rows: rowsToApply.filter((row) => String(row.status || "").toLowerCase() === "previous_available").length,
    missing_after_ensure: missingAfterEnsure,
    apply_result: applyResult,
    warnings,
    errors,
  };
}

function getInvalidRateStatus(row = {}) {
  if (!row.date || !row.currency) return "invalid_key";
  if (String(row.base_currency || "").trim().toUpperCase() !== "USD") return "invalid_base_currency";
  if (!Number.isFinite(Number(row.rate_to_usd)) || Number(row.rate_to_usd) <= 0) return "invalid_rate";
  const status = String(row.status || "ok").trim().toLowerCase();
  if (!["ok", "previous_available"].includes(status)) return status || "invalid_status";
  return "";
}

function splitHeaderRows(values) {
  const rows = values || [];
  const headerIndex = rows.findIndex((row) => (row || []).some((cell) => ["date", "дата"].includes(normalizeText(cell))));
  if (headerIndex === -1) return { header: [], rows: [] };
  return {
    header: rows[headerIndex] || [],
    rows: rows.slice(headerIndex + 1).filter((row) => (row || []).some((cell) => String(cell || "").trim())),
  };
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map(normalizeText));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeText(cell)));
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  if (iso) return iso[1];
  const display = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
  return "";
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function makeFxRateKey(date, currency) {
  return `${normalizeDate(date)}|${String(currency || "").trim().toUpperCase()}`;
}

function normalizeEnsureCurrencies(value) {
  const input = Array.isArray(value) ? value.join(",") : String(value || "");
  const unsupported = new Set(["LOCAL", "UNKNOWN"]);
  return Array.from(new Set(input.split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .filter((currency) => !unsupported.has(currency))
    .filter((currency) => !isStableUsdCurrency(currency))));
}

function enumerateDates(from, to) {
  if (!from || !to || from > to) return [];
  const output = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function buildPreviousAvailableRows({ date, currencies, rates, fetchedAt }) {
  return (currencies || []).map((currency) => {
    const previous = findPreviousAvailableRate(rates, { date, currency });
    if (!previous) return null;
    return {
      date,
      currency,
      base_currency: "USD",
      rate_to_usd: previous.rate_to_usd,
      source: previous.source || "frankfurter",
      source_url: previous.source_url || "",
      fetched_at: fetchedAt,
      status: "previous_available",
      comment: `previous_available_rate from ${previous.date}; exact unavailable at fetch time`,
    };
  }).filter(Boolean);
}

function findPreviousAvailableRate(rates = [], { date, currency } = {}) {
  const normalizedDate = normalizeDate(date);
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  return (rates || [])
    .filter((row) => row.date < normalizedDate && row.currency === normalizedCurrency && !getInvalidRateStatus(row))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0] || null;
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function safeErrorMessage(error) {
  return String(error?.message || error || "fx_rate_error")
    .replace(/(token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, "[redacted-private-key]");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}
