import { loadAutoBalanceRowsFromGoogleSheets } from "./auto-balance-repository.js";
import { saveAutoBalanceSnapshotRows } from "./auto-balance-snapshots.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";

const PROJECT_NAME = "ezohata-incoming-ledger";
const PLANNED_SOURCE = "planned_daily_balance";
const AUTO_BALANCE_SHEET_NAME = "Авто Остатки";
const FALLBACK_USD_RATES = {
  USD: 1,
  EUR: 1.16,
  CAD: 0.74,
  UAH: 1 / 43.86,
  RUB: 1 / 84.5563,
  USDT: 1,
  LOCAL: 1 / 18,
};

export default async function dailyPlannedBalancesHandler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  const body = request.method === "POST" ? parseBody(request.body) : {};
  const result = await runDailyPlannedBalances({
    query: { ...(request.query || {}), ...body },
    fetchImpl: fetch,
  });
  return response.status(result.ok ? 200 : 500).json(result);
}

export async function runDailyPlannedBalances(options = {}) {
  const query = options.query || {};
  const fetchImpl = options.fetchImpl || fetch;
  const period = parsePeriod(query);
  const dryRun = isDryRun(query);
  const filters = parseFilters(query);
  const generatedAt = normalizeTimestamp(query.generatedAt || query.generated_at) || new Date().toISOString();
  const repository = await loadRepository(options.repositoryLoader || loadManualRepositoryFromGoogleSheets, fetchImpl);
  const autoBalances = Array.isArray(repository?.autoBalances)
    ? { ok: true, balances: repository.autoBalances, warnings: [] }
    : await loadAutoBalances(options.autoBalanceLoader || loadAutoBalanceRowsFromGoogleSheets, fetchImpl);

  if (!repository.ok) {
    return {
      ok: false,
      project: PROJECT_NAME,
      target_sheet: AUTO_BALANCE_SHEET_NAME,
      dryRun,
      period,
      error: repository.warning || "Manual Google Sheets repository unavailable.",
      warnings: [...(repository.warnings || []), ...(autoBalances.warnings || [])],
    };
  }

  const generated = generateDailyPlannedBalanceRows({
    operations: repository.operations || [],
    balanceRows: repository.balances || [],
    autoBalanceRows: autoBalances.balances || [],
    from: period.from,
    to: period.to,
    channels: filters.channels,
    currencies: filters.currencies,
    generatedAt,
  });

  let save = { rowCount: 0, inserted: 0, updated: 0, skipped: dryRun ? "dry_run" : "no_rows" };
  if (!dryRun && generated.rows.length) {
    save = await (options.saveRows || saveAutoBalanceSnapshotRows)(generated.rows, { fetchImpl });
  }

  return {
    ok: true,
    project: PROJECT_NAME,
    target_sheet: AUTO_BALANCE_SHEET_NAME,
    dryRun,
    period,
    source: PLANNED_SOURCE,
    generated: generated.rows.length,
    updated: dryRun ? 0 : Number(save.updated || 0),
    saved_rows: dryRun ? 0 : Number(save.rowCount || 0),
    skipped_fact_exists: generated.skipped_fact_exists,
    blocked_missing_amount_net: generated.blocked_missing_amount_net,
    missing_previous_balance: generated.missing_previous_balance,
    fallback_amount_rows: 0,
    rows_preview: generated.rows.slice(0, 50),
    report: generated.report,
    save,
    warnings: [...(repository.warnings || []), ...(autoBalances.warnings || [])].filter(Boolean),
  };
}

export function generateDailyPlannedBalanceRows({
  operations = [],
  balanceRows = [],
  autoBalanceRows = [],
  from = "",
  to = "",
  channels = [],
  currencies = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedFrom = normalizeDate(from);
  const normalizedTo = normalizeDate(to || from);
  if (!normalizedFrom || !normalizedTo || normalizedFrom > normalizedTo) {
    throw new Error("from/to date must be YYYY-MM-DD and from must be before or equal to to");
  }

  const channelFilter = new Set((channels || []).map((value) => normalizeFilterText(value)).filter(Boolean));
  const currencyFilter = new Set((currencies || []).map((value) => String(value || "").trim().toUpperCase()).filter(Boolean));
  const movementIndex = buildMovementIndex(operations, { from: normalizedFrom, to: normalizedTo, channelFilter, currencyFilter });
  const snapshots = buildSnapshotIndex([...balanceRows, ...autoBalanceRows], { channelFilter, currencyFilter });
  const rows = [];
  const report = [];
  let skippedFactExists = 0;
  let blockedMissingAmountNet = 0;
  let missingPreviousBalance = 0;

  for (const date of dateRange(normalizedFrom, normalizedTo)) {
    const keys = collectCandidateKeys({ snapshots, movementIndex, date, channelFilter, currencyFilter });
    for (const key of keys) {
      const [channel, currency] = splitKey(key);
      const missingRows = movementIndex.missingByDateKey.get(`${date}|${key}`) || [];
      if (missingRows.length) {
        blockedMissingAmountNet += 1;
        report.push({ date, channel, currency, status: "missing_amount_net", rows: missingRows });
        continue;
      }

      const previousDate = addDays(date, -1);
      const basis = findBestSnapshot(snapshots, key, previousDate);
      if (!basis) {
        missingPreviousBalance += 1;
        report.push({ date, channel, currency, status: "missing_previous_balance", basis_date: previousDate });
        continue;
      }

      const movement = movementIndex.deltaByDateKey.get(`${date}|${key}`) || { delta: 0, rows: 0 };
      const amount = roundMoney(basis.amount + movement.delta);
      const fact = findBestFactSnapshot(snapshots, key, date);
      if (fact) skippedFactExists += 1;

      const row = buildPlannedSnapshotRow({
        date,
        channel,
        currency,
        amount,
        generatedAt,
        basis,
        ledgerDelta: movement.delta,
      });
      rows.push(row);
      addSnapshot(snapshots, normalizeSnapshotRow(row));
      report.push({
        date,
        channel,
        currency,
        status: fact ? "generated_fact_exists" : "generated",
        amount,
        basis_date: basis.date,
        basis_source: basis.sourceType,
        ledger_delta: roundMoney(movement.delta),
        raw_source_id: row.rawSourceId,
      });
    }
  }

  return {
    rows,
    skipped_fact_exists: skippedFactExists,
    blocked_missing_amount_net: blockedMissingAmountNet,
    missing_previous_balance: missingPreviousBalance,
    report,
  };
}

function buildMovementIndex(operations = [], { from, to, channelFilter, currencyFilter }) {
  const deltaByDateKey = new Map();
  const missingByDateKey = new Map();
  for (const operation of operations || []) {
    const ledger = operation?.ledgerV2 || {};
    const date = normalizeDate(operation?.date || ledger.date);
    if (!date || date < from || date > to) continue;
    const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
    if (!currency || (currencyFilter.size && !currencyFilter.has(currency))) continue;
    const amountNetRaw = ledger.amount_net ?? operation?.amountNet ?? operation?.amount_net;
    const signedAmount = getSignedLedgerDelta(operation);
    const channel = getMovementChannel(operation, signedAmount);
    if (!channel || (channelFilter.size && !channelFilter.has(normalizeFilterText(channel)))) continue;
    const key = makeKey(channel, currency);
    const dateKey = `${date}|${key}`;

    if (!String(amountNetRaw ?? "").trim() || signedAmount === null) {
      const rows = missingByDateKey.get(dateKey) || [];
      rows.push({
        row: operation?.sheetRowNumber || operation?.sourceRow || null,
        date,
        channel,
        currency,
        raw_source_id: operation?.rawSourceId || operation?.raw_source_id || ledger.raw_source_id || ledger.external_id || "",
        reason: "missing_amount_net",
      });
      missingByDateKey.set(dateKey, rows);
      continue;
    }

    const current = deltaByDateKey.get(dateKey) || { delta: 0, rows: 0 };
    current.delta += signedAmount;
    current.rows += 1;
    deltaByDateKey.set(dateKey, current);
  }
  return { deltaByDateKey, missingByDateKey };
}

function buildSnapshotIndex(rows = [], { channelFilter, currencyFilter }) {
  const index = new Map();
  for (const row of rows || []) {
    const normalized = normalizeSnapshotRow(row);
    if (!normalized) continue;
    if (channelFilter.size && !channelFilter.has(normalizeFilterText(normalized.channel))) continue;
    if (currencyFilter.size && !currencyFilter.has(normalized.currency)) continue;
    addSnapshot(index, normalized);
  }
  return index;
}

function normalizeSnapshotRow(row = {}) {
  const date = normalizeDate(row.date);
  const channel = String(row.channel || row.accountName || row.account || "").trim();
  const currency = String(row.currency || "").trim().toUpperCase();
  const amount = parseNumber(row.balanceAmount ?? row.amount);
  if (!date || !channel || !currency || amount === null) return null;
  const sourceType = classifySnapshotSource(row);
  if (!sourceType) return null;
  return {
    date,
    channel,
    currency,
    amount,
    sourceType,
    rawSourceId: String(row.rawSourceId || row.raw_source_id || "").trim(),
    source: String(row.source || row.fact_source || "").trim(),
    status: String(row.status || row.autoBalanceStatus || row.auto_balance_status || "").trim(),
  };
}

function classifySnapshotSource(row = {}) {
  const status = String(row.status || row.autoBalanceStatus || row.auto_balance_status || "").trim();
  const source = normalizeText(`${row.source || ""} ${row.fact_source || ""} ${row.balanceSource || ""} ${row.balance_source || ""} ${row.provider || ""} ${row.comment || ""} ${row.sourceSheet || ""}`);
  if (/planned_daily_balance|planned daily balance/.test(source) && status === "planned") return "planned";
  if (/paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed paypal balance/.test(source)) return "derived";
  if (/paypal_manual_balance|paypal_manual_confirmed_balance|manual confirmed|manual fact|manual balance/.test(source)) return "manual_fact";
  if (status && !["ok", "zero_balance", "derived_from_confirmed_opening"].includes(status)) return null;
  if (/auto snapshot|provider_auto|wise_auto|paypal_auto|binance_auto|monobank_auto|privatbank_auto|yoomoney_auto|tdbank_auto|payoneer_auto|revolut_auto|provider/.test(source)) return "provider_auto";
  if (/остатики|остатки/.test(source)) return "manual_fact";
  return row.sourceSheet === "Авто Остатки" ? "provider_auto" : "manual_fact";
}

function addSnapshot(index, snapshot) {
  const key = makeKey(snapshot.channel, snapshot.currency);
  const rows = index.get(key) || [];
  const next = rows.filter((row) => !(row.date === snapshot.date && row.sourceType === snapshot.sourceType && row.rawSourceId === snapshot.rawSourceId));
  next.push(snapshot);
  next.sort(compareSnapshots);
  index.set(key, next);
}

function collectCandidateKeys({ snapshots, movementIndex, date, channelFilter, currencyFilter }) {
  const previousDate = addDays(date, -1);
  const keys = new Set();
  for (const [key, rows] of snapshots.entries()) {
    if (rows.some((row) => row.date === previousDate)) keys.add(key);
  }
  for (const map of [movementIndex.deltaByDateKey, movementIndex.missingByDateKey]) {
    for (const dateKey of map.keys()) {
      if (!dateKey.startsWith(`${date}|`)) continue;
      keys.add(dateKey.slice(date.length + 1));
    }
  }
  return Array.from(keys)
    .filter((key) => {
      const [channel, currency] = splitKey(key);
      if (channelFilter.size && !channelFilter.has(normalizeFilterText(channel))) return false;
      if (currencyFilter.size && !currencyFilter.has(currency)) return false;
      return !isAggregateChannel(channel);
    })
    .sort();
}

function findBestSnapshot(index, key, date) {
  return (index.get(key) || [])
    .filter((row) => row.date === date)
    .sort(compareSnapshotPriority)[0] || null;
}

function findBestFactSnapshot(index, key, date) {
  return (index.get(key) || [])
    .filter((row) => row.date === date && row.sourceType !== "planned")
    .sort(compareSnapshotPriority)[0] || null;
}

function compareSnapshots(left, right) {
  const dateDiff = left.date.localeCompare(right.date);
  if (dateDiff) return dateDiff;
  return compareSnapshotPriority(left, right);
}

function compareSnapshotPriority(left, right) {
  return snapshotPriority(left.sourceType) - snapshotPriority(right.sourceType);
}

function snapshotPriority(sourceType) {
  if (sourceType === "manual_fact") return 0;
  if (sourceType === "provider_auto") return 1;
  if (sourceType === "derived") return 2;
  if (sourceType === "planned") return 3;
  return 9;
}

function buildPlannedSnapshotRow({ date, channel, currency, amount, generatedAt, basis, ledgerDelta }) {
  const rawSourceId = `planned_daily_balance:${date}:${normalizeRawSourceChannel(channel)}:${currency}`;
  const amountUsd = roundMoney(amount * (FALLBACK_USD_RATES[currency] || 0));
  return {
    date,
    provider: "planned",
    channel,
    amount,
    currency,
    rate: FALLBACK_USD_RATES[currency] || "",
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : "",
    source: PLANNED_SOURCE,
    fetchedAt: generatedAt,
    rawSourceId,
    status: "planned",
    comment: [
      "Planned daily balance = previous balance + Ledger amount_net movement.",
      `basis_date=${basis.date}`,
      `basis_source=${basis.sourceType}`,
      `ledger_delta=${roundMoney(ledgerDelta)}`,
      `planned_from_raw_source_id=${basis.rawSourceId || ""}`,
    ].join(" "),
  };
}

function getSignedLedgerDelta(row = {}) {
  const ledger = row.ledgerV2 || {};
  const amountNet = parseNumber(ledger.amount_net ?? row.amountNet ?? row.amount_net);
  if (amountNet === null) return null;
  const signedBalanceAmount = parseNumber(ledger.balance_amount ?? row.balanceAmount);
  if (signedBalanceAmount !== null) return signedBalanceAmount;
  const operation = String(ledger.operation || row.operation || "").trim().toLowerCase();
  const direction = String(ledger.direction || row.direction || "").trim().toLowerCase();
  if (operation === "expense" || direction === "out") return -Math.abs(amountNet);
  return amountNet;
}

function getMovementChannel(row = {}, signedAmount = 0) {
  const ledger = row.ledgerV2 || {};
  const from = String(ledger.from_channel || row.fromChannel || row.from_channel || "").trim();
  const to = String(ledger.to_channel || row.toChannel || row.to_channel || "").trim();
  if (signedAmount < 0) return from || to;
  return to || from;
}

function parsePeriod(query = {}) {
  const date = normalizeDate(query.date);
  const from = normalizeDate(query.from) || date || todayUtcDate();
  const to = normalizeDate(query.to) || date || from;
  return { from, to };
}

function parseFilters(query = {}) {
  return {
    channels: parseList(query.channels || query.channel),
    currencies: parseList(query.currencies || query.currency),
  };
}

function parseList(value) {
  if (Array.isArray(value)) return value.flatMap(parseList);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isDryRun(query = {}) {
  if (isTruthy(query.apply)) return false;
  if (query.dryRun === undefined && query.dry_run === undefined) return false;
  return isTruthy(query.dryRun ?? query.dry_run);
}

async function loadRepository(loader, fetchImpl) {
  try {
    return await loader({ fetchImpl });
  } catch (error) {
    return { ok: false, warning: String(error?.message || error), warnings: [] };
  }
}

async function loadAutoBalances(loader, fetchImpl) {
  try {
    return await loader({ fetchImpl });
  } catch (error) {
    return { ok: false, balances: [], warnings: [String(error?.message || error)] };
  }
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body || "{}");
    } catch {
      return {};
    }
  }
  return typeof body === "object" ? body : {};
}

function dateRange(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function makeKey(channel, currency) {
  return `${String(channel || "").trim()}|${String(currency || "").trim().toUpperCase()}`;
}

function splitKey(key) {
  const index = String(key || "").lastIndexOf("|");
  if (index === -1) return [String(key || ""), ""];
  return [key.slice(0, index), key.slice(index + 1)];
}

function isAggregateChannel(channel) {
  const text = normalizeText(channel);
  return /combined binance|binance combined|binance total|бинанс total|бинанс итог/.test(text);
}

function normalizeRawSourceChannel(channel) {
  return normalizeText(channel).replace(/\s+/g, "_") || "channel";
}

function normalizeFilterText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function normalizeText(value) {
  return normalizeFilterText(value).replace(/[^0-9a-zа-я]+/g, " ").trim();
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeTimestamp(value) {
  const raw = String(value || "").trim();
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : "";
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}
