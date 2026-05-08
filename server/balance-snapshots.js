import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";

const PROJECT_NAME = "ezohata-incoming-ledger";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  const snapshot = await buildBalanceSnapshotsSnapshot({
    query: request.query || {},
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
  });
  return response.status(200).json(snapshot);
}

export async function buildBalanceSnapshotsSnapshot(options = {}) {
  const query = options.query || {};
  const generatedAt = new Date().toISOString();
  const periodFilter = parsePeriodFilter(query);
  const warnings = [];
  const auditChecks = [];
  const repository = await loadRepository(options.repositoryLoader);

  if (!repository.ok) {
    warnings.push("needs verification: manual Google Sheets read access is unavailable.");
    if (repository.warning) warnings.push(toSafeWarning(repository.warning));
    auditChecks.push({
      name: "manual_google_sheets_access",
      status: "needs verification",
      message: "Balance snapshots inventory could not read live Google Sheets data.",
    });
    return emptySnapshot({ generatedAt, period: periodFilter.period, warnings, auditChecks });
  }

  const balanceSnapshots = buildBalanceSnapshotsSummary(repository.balances || [], periodFilter);
  auditChecks.push(
    {
      name: "manual_google_sheets_access",
      status: "ok",
      message: "Balance snapshots inventory read Google Sheets repository data.",
    },
    {
      name: "balance_snapshots_inventory",
      status: balanceSnapshots.valid_rows && !balanceSnapshots.incomplete_rows ? "ok" : "needs verification",
      message: balanceSnapshots.valid_rows
        ? `Остатки inventory: ${balanceSnapshots.valid_rows}/${balanceSnapshots.total_rows} valid row(s), ${balanceSnapshots.dates.length} date(s), ${balanceSnapshots.by_channel_currency.length} account-currency pair(s).`
        : "No valid Остатки rows found for the selected period.",
    }
  );

  if (balanceSnapshots.incomplete_rows) {
    warnings.push(`needs verification: ${balanceSnapshots.incomplete_rows} Остатки row(s) are incomplete.`);
  }

  return {
    ok: true,
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period: resolvePeriod(periodFilter, balanceSnapshots.dates),
    balance_snapshots: balanceSnapshots,
    warnings: unique([...(repository.warnings || []).map(toSafeWarning), ...warnings]),
    audit_checks: auditChecks,
  };
}

async function loadRepository(repositoryLoader = loadManualRepositoryFromGoogleSheets) {
  try {
    return await repositoryLoader();
  } catch (error) {
    return {
      ok: false,
      warning: `Manual Google Sheets overlay failed: ${String(error?.message || error)}`,
    };
  }
}

function emptySnapshot({ generatedAt, period, warnings, auditChecks }) {
  return {
    ok: true,
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period,
    balance_snapshots: emptyBalanceSnapshotsSummary(),
    warnings: unique(warnings),
    audit_checks: auditChecks,
  };
}

export function buildBalanceSnapshotsSummary(balanceRows = [], periodFilter = {}) {
  const normalizedRows = (balanceRows || []).map(normalizeBalanceSnapshotRow);
  const filteredRows = normalizedRows.filter((row) => isBalanceRowInPeriod(row, periodFilter));
  const validRows = filteredRows.filter((row) => row.valid);
  const invalidRows = filteredRows.filter((row) => !row.valid);
  const dates = unique(validRows.map((row) => row.date)).sort();

  return {
    total_rows: filteredRows.length,
    valid_rows: validRows.length,
    incomplete_rows: invalidRows.length,
    dates,
    by_date: buildByDate(validRows),
    by_channel_currency: buildByChannelCurrency(validRows),
    missing_date_rows: invalidRows.filter((row) => row.missing.date).length,
    missing_channel_rows: invalidRows.filter((row) => row.missing.channel).length,
    missing_currency_rows: invalidRows.filter((row) => row.missing.currency).length,
    missing_amount_rows: invalidRows.filter((row) => row.missing.amount).length,
    incomplete_preview: invalidRows.slice(0, 10).map((row) => ({
      date: row.date || null,
      channel: row.channel || null,
      currency: row.currency || null,
      reason: row.reason,
    })),
  };
}

function emptyBalanceSnapshotsSummary() {
  return {
    total_rows: 0,
    valid_rows: 0,
    incomplete_rows: 0,
    dates: [],
    by_date: [],
    by_channel_currency: [],
    missing_date_rows: 0,
    missing_channel_rows: 0,
    missing_currency_rows: 0,
    missing_amount_rows: 0,
    incomplete_preview: [],
  };
}

function normalizeBalanceSnapshotRow(row) {
  const date = normalizeDate(row?.date);
  const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
  const currency = String(row?.currency || "").trim().toUpperCase();
  const amount = parseNumber(row?.balanceAmount ?? row?.amount);
  const missing = {
    date: !date,
    channel: !channel,
    currency: !currency,
    amount: amount === null,
  };
  const reason = Object.entries(missing)
    .filter(([, value]) => value)
    .map(([key]) => `missing_${key}`)
    .join(", ");
  return {
    date,
    channel,
    currency,
    amount,
    valid: !reason,
    missing,
    reason,
  };
}

function buildByDate(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const entry = grouped.get(row.date) || {
      date: row.date,
      rows: 0,
      channel_currency_pairs: new Set(),
    };
    entry.rows += 1;
    entry.channel_currency_pairs.add(makeKey(row.channel, row.currency));
    grouped.set(row.date, entry);
  }
  return Array.from(grouped.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => ({
      date: row.date,
      rows: row.rows,
      channel_currency_pairs: row.channel_currency_pairs.size,
    }));
}

function buildByChannelCurrency(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = makeKey(row.channel, row.currency);
    const entry = grouped.get(key) || {
      channel: row.channel,
      currency: row.currency,
      rows: 0,
      dates: new Set(),
    };
    entry.rows += 1;
    entry.dates.add(row.date);
    grouped.set(key, entry);
  }
  return Array.from(grouped.values())
    .map((entry) => {
      const dates = Array.from(entry.dates).sort();
      return {
        channel: entry.channel,
        currency: entry.currency,
        rows: entry.rows,
        dates,
        first_date: dates[0] || null,
        last_date: dates.at(-1) || null,
      };
    })
    .sort((left, right) => {
      if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
      return left.currency.localeCompare(right.currency);
    });
}

function isBalanceRowInPeriod(row, periodFilter = {}) {
  if (!periodFilter.from && !periodFilter.to) return true;
  if (!row.date) return false;
  if (periodFilter.from && row.date < periodFilter.from) return false;
  if (periodFilter.to && row.date > periodFilter.to) return false;
  return true;
}

function parsePeriodFilter(query = {}) {
  const period = String(query.period || "").trim();
  if (/^\d{4}-\d{2}$/.test(period)) {
    return {
      from: `${period}-01`,
      to: lastDayOfMonth(period),
      period: { from: `${period}-01`, to: lastDayOfMonth(period) },
    };
  }
  const from = normalizeDate(query.from);
  const to = normalizeDate(query.to);
  return {
    from,
    to,
    period: {
      from: from || "needs verification",
      to: to || "needs verification",
    },
  };
}

function resolvePeriod(periodFilter, dates = []) {
  if (periodFilter.from || periodFilter.to) return periodFilter.period;
  return {
    from: dates[0] || "needs verification",
    to: dates.at(-1) || "needs verification",
  };
}

function makeKey(channel, currency) {
  return `${channel}|${currency}`;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function lastDayOfMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== null && value !== undefined && String(value).trim()))];
}

function toSafeWarning(value) {
  return String(value || "")
    .replace(/service account credentials/gi, "service account access")
    .replace(/\bcredentials\b/gi, "access")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=._~-]+/gi, "Basic [redacted]")
    .replace(/access_token['\":=\s]+[A-Za-z0-9._~+/-]+/gi, "access_token [redacted]")
    .replace(/refresh_token['\":=\s]+[A-Za-z0-9._~+/-]+/gi, "refresh_token [redacted]")
    .trim();
}
