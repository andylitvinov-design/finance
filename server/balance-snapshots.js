import fs from "node:fs";
import path from "node:path";

import { getProviderCurrentBalanceCapabilities } from "./auto-balance-snapshots.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";

const PROJECT_NAME = "ezohata-incoming-ledger";
const BALANCE_SHEET_NAME = "Остатки";
const FACT_SHEET_NAME = "Факт";
const FACT_BALANCE_WARNING = "Остатки внесены во вкладку Факт, но сверка использует вкладку Остатки.";
const BALANCE_TARGET_COLUMNS = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"];

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

  const balanceSnapshots = buildBalanceSnapshotsSummary(repository.balances || [], periodFilter, repository);
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
  if (balanceSnapshots.fact_balance_rows?.some((row) => row.status === "missing_in_ostatki")) {
    warnings.push(FACT_BALANCE_WARNING);
  }

  return {
    ok: true,
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period: resolvePeriod(periodFilter, balanceSnapshots.dates),
    balance_snapshots: balanceSnapshots,
    provider_current_balance_status: getProviderCurrentBalanceCapabilities(),
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

export function buildBalanceSnapshotsSummary(balanceRows = [], periodFilter = {}, repository = {}) {
  const normalizedRows = (balanceRows || []).map(normalizeBalanceSnapshotRow);
  const filteredRows = normalizedRows.filter((row) => isBalanceRowInPeriod(row, periodFilter));
  const validRows = filteredRows.filter((row) => row.valid);
  const invalidRows = filteredRows.filter((row) => !row.valid);
  const dates = unique(validRows.map((row) => row.date)).sort();
  const targetDate = resolveInputTargetDate(periodFilter, validRows);
  const factBalanceRows = buildFactBalanceRows(repository, periodFilter, normalizedRows.filter((row) => row.valid));

  return {
    total_rows: filteredRows.length,
    valid_rows: validRows.length,
    incomplete_rows: invalidRows.length,
    dates,
    rows: buildDetailedRows(validRows),
    fact_balance_rows: factBalanceRows,
    input_rows: buildInputRows({
      targetDate,
      balanceRows: normalizedRows.filter((row) => row.valid),
      operations: repository.operations || [],
    }),
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
    rows: [],
    input_rows: [],
    by_date: [],
    by_channel_currency: [],
    missing_date_rows: 0,
    missing_channel_rows: 0,
    missing_currency_rows: 0,
    missing_amount_rows: 0,
    incomplete_preview: [],
    fact_balance_rows: [],
  };
}

function buildInputRows({ targetDate, balanceRows = [], operations = [] } = {}) {
  if (!targetDate) return [];
  const activePairs = new Map();
  for (const channel of loadConfiguredChannels()) {
    const currency = inferCurrencyFromChannel(channel);
    if (currency) addActivePair(activePairs, { channel, currency });
  }
  for (const row of balanceRows || []) {
    addActivePair(activePairs, row);
  }
  for (const operation of operations || []) {
    for (const pair of getOperationChannelCurrencyPairs(operation)) {
      addActivePair(activePairs, pair);
    }
  }

  const existingByKey = new Map();
  for (const row of balanceRows || []) {
    if (row.date === targetDate) existingByKey.set(makeKey(row.channel, row.currency), row);
  }

  return Array.from(activePairs.values())
    .sort(compareChannelCurrency)
    .map((pair) => {
      const existing = existingByKey.get(makeKey(pair.channel, pair.currency));
      const existingAmount = existing ? existing.amount : null;
      return {
        date: targetDate,
        channel: pair.channel,
        currency: pair.currency,
        sheet: BALANCE_SHEET_NAME,
        amount_required: true,
        target_columns: BALANCE_TARGET_COLUMNS,
        existing_amount: existingAmount,
        amount: existingAmount,
        needs_input: existingAmount === null,
        source: existingAmount === null ? "active_channel_missing_balance" : "existing_balance",
        status: existingAmount === null ? "needs_input" : "already_entered",
      };
    });
}

function buildFactBalanceRows(repository = {}, periodFilter = {}, balanceRows = []) {
  const rows = [];
  for (const row of repository.legacyExpenseRows || []) {
    if (normalizeFactCategory(row?.category) !== "now") continue;
    const date = normalizeDate(row?.date);
    if (!date || !isDateInPeriod(date, periodFilter)) continue;
    for (const [channel, rawAmount] of Object.entries(row.amounts || {})) {
      const amount = parseNumber(rawAmount);
      if (!String(channel || "").trim() || amount === null) continue;
      const currency = inferCurrencyFromChannel(channel);
      if (!currency) continue;
      const exists = balanceRows.some((balance) =>
        balance.date === date
        && makeKey(balance.channel, balance.currency) === makeKey(channel, currency)
      );
      rows.push({
        date,
        channel,
        currency,
        amount,
        sheet: FACT_SHEET_NAME,
        expected_sheet: BALANCE_SHEET_NAME,
        status: exists ? "matched_ostatki" : "missing_in_ostatki",
      });
    }
  }
  return rows.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
    return left.currency.localeCompare(right.currency);
  });
}

function normalizeFactCategory(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function getOperationChannelCurrencyPairs(operation) {
  const ledger = operation?.ledgerV2 || {};
  const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
  if (!currency) return [];
  const operationName = String(ledger.operation || operation?.operation || "").trim().toLowerCase();
  const from = String(ledger.from_channel || operation?.fromChannel || operation?.from_channel || "").trim();
  const to = String(ledger.to_channel || operation?.toChannel || operation?.to_channel || "").trim();
  const fallback = String(operation?.channel || operation?.accountName || operation?.account || "").trim();
  if (operationName === "income") return [{ channel: to || fallback, currency }];
  if (["expense", "business_expense", "personal_expense"].includes(operationName)) return [{ channel: from || fallback, currency }];
  if (operationName === "exchange_in") return [{ channel: to || fallback, currency }];
  if (operationName === "exchange_out") return [{ channel: from || fallback, currency }];
  if (operationName === "transfer" || operationName === "partner_transfer") {
    return [from, to].filter(Boolean).map((channel) => ({ channel, currency }));
  }
  return [fallback || from || to].filter(Boolean).map((channel) => ({ channel, currency }));
}

function addActivePair(map, pair) {
  const channel = String(pair?.channel || "").trim();
  const currency = String(pair?.currency || "").trim().toUpperCase();
  if (!channel || !currency) return;
  const key = makeKey(channel, currency);
  if (!map.has(key)) map.set(key, { channel, currency });
}

function resolveInputTargetDate(periodFilter = {}, rows = []) {
  if (periodFilter.to) return periodFilter.to;
  const dates = unique((rows || []).map((row) => row.date)).sort();
  return dates.at(-1) || "";
}

function loadConfiguredChannels() {
  try {
    const configPath = path.join(process.cwd(), "sheet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return Array.isArray(config?.manualFinance?.channels) ? config.manualFinance.channels : [];
  } catch {
    return [];
  }
}

function inferCurrencyFromChannel(channel) {
  const normalized = String(channel || "").toLowerCase();
  if (/\b(cad|сad)\b|канад/.test(normalized)) return "CAD";
  if (/\b(eur|euro)\b|евр|евро/.test(normalized)) return "EUR";
  if (/\b(uah)\b|грн/.test(normalized)) return "UAH";
  if (/\b(rub)\b|руб|яндекс/.test(normalized)) return "RUB";
  if (/\b(usd|usdt|usdc)\b|дол|dol|spot|save|binance|wise/.test(normalized)) return "USD";
  return "";
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

function buildDetailedRows(rows) {
  return (rows || [])
    .map((row) => ({
      date: row.date,
      channel: row.channel,
      currency: row.currency,
      amount: row.amount,
    }))
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
      return left.currency.localeCompare(right.currency);
    });
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

function compareChannelCurrency(left, right) {
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function isBalanceRowInPeriod(row, periodFilter = {}) {
  if (!periodFilter.from && !periodFilter.to) return true;
  if (!row.date) return false;
  return isDateInPeriod(row.date, periodFilter);
}

function isDateInPeriod(date, periodFilter = {}) {
  if (!periodFilter.from && !periodFilter.to) return true;
  if (periodFilter.from && date < periodFilter.from) return false;
  if (periodFilter.to && date > periodFilter.to) return false;
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
