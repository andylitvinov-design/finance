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
    diagnostics.status_counts.ok = (diagnostics.status_counts.ok || 0) + 1;
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

function getInvalidRateStatus(row = {}) {
  if (!row.date || !row.currency) return "invalid_key";
  if (String(row.base_currency || "").trim().toUpperCase() !== "USD") return "invalid_base_currency";
  if (!Number.isFinite(Number(row.rate_to_usd)) || Number(row.rate_to_usd) <= 0) return "invalid_rate";
  const status = String(row.status || "ok").trim().toLowerCase();
  if (status !== "ok") return status || "invalid_status";
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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}
