import {
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "./manual-google-sheets.js";

export const CALCULATED_BALANCE_SHEET_NAME = "Расчетные Остатки";
export const CALCULATED_BALANCE_HEADERS = [
  "date",
  "channel",
  "currency",
  "opening_balance",
  "movement",
  "calculated_eod",
  "source",
  "anchor_date",
  "anchor_source",
  "status",
  "created_at",
  "updated_at",
];

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const STATUS_CALCULATED = "calculated_from_previous";

export function buildDailyCalculatedBalances({
  operations = [],
  balanceRows = [],
  period = {},
  activePairs = [],
  now = new Date(),
} = {}) {
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  const dates = buildDateRange(from, to);
  const movements = buildMovementIndex(operations);
  const balanceIndex = buildAnchorIndex(balanceRows);
  const pairs = buildPairs({ operations, balanceRows, activePairs });
  const timestamp = normalizeTimestamp(now) || new Date().toISOString();
  const rows = [];

  for (const pair of pairs) {
    const key = makeKey(pair.channel, pair.currency);
    let current = null;
    let anchorDate = null;
    let anchorSource = null;

    for (const date of dates) {
      const exactAnchor = balanceIndex.byDateKey.get(`${date}|${key}`) || null;
      if (exactAnchor) {
        current = round(exactAnchor.amount);
        anchorDate = exactAnchor.anchor_date || exactAnchor.date;
        anchorSource = exactAnchor.anchor_source || exactAnchor.sourceType;
        continue;
      }

      if (current === null) {
        const priorAnchor = findLatestAnchorBeforeOrOn(balanceIndex, key, date);
        if (!priorAnchor) continue;
        current = round(priorAnchor.amount);
        anchorDate = priorAnchor.anchor_date || priorAnchor.date;
        anchorSource = priorAnchor.anchor_source || priorAnchor.sourceType;
      }

      const movement = movements.byDateKey.get(`${date}|${key}`) || emptyMovement({ date, pair });
      if (movement.missing_amount_net_rows) {
        rows.push(buildBlockedRow({ date, pair, current, movement, anchorDate, anchorSource, timestamp }));
        current = null;
        continue;
      }

      const opening = current;
      const calculated = round(opening + movement.net_change);
      rows.push({
        date,
        channel: pair.channel,
        currency: pair.currency,
        opening_balance: opening,
        movement: round(movement.net_change),
        calculated_eod: calculated,
        source: "calculated",
        balanceSource: "calculated_balance",
        balance_source: "calculated_balance",
        sourceSheet: CALCULATED_BALANCE_SHEET_NAME,
        anchor_date: anchorDate,
        anchor_source: anchorSource,
        status: STATUS_CALCULATED,
        created_at: timestamp,
        updated_at: timestamp,
      });
      current = calculated;
    }
  }

  rows.sort(compareRows);
  return {
    rows,
    summary: {
      rows: rows.length,
      calculated_rows: rows.filter((row) => row.status === STATUS_CALCULATED).length,
      missing_amount_net_rows: movements.missing_amount_net_rows,
      excluded_missing_amount_net_rows: movements.missing_amount_net_rows,
      active_pairs: pairs.length,
      period_from: from || "",
      period_to: to || "",
    },
    warnings: movements.missing_amount_net_rows
      ? [`${movements.missing_amount_net_rows} Ledger row(s) skipped because amount_net is missing.`]
      : [],
  };
}

export async function materializeDailyCalculatedBalances({
  rows = [],
  apply = false,
  fetchImpl = fetch,
  spreadsheetId = MANUAL_SPREADSHEET_ID,
  now = new Date(),
} = {}) {
  const calculatedRows = (rows || [])
    .filter((row) => row?.status === STATUS_CALCULATED)
    .map((row) => normalizeCalculatedRow(row, now))
    .filter(Boolean);
  if (!apply) {
    return {
      ok: true,
      dryRun: true,
      sheetName: CALCULATED_BALANCE_SHEET_NAME,
      rowCount: calculatedRows.length,
      rows: calculatedRows,
    };
  }
  if (!calculatedRows.length) {
    return { ok: true, dryRun: false, sheetName: CALCULATED_BALANCE_SHEET_NAME, rowCount: 0, inserted: 0, updated: 0 };
  }

  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  await ensureCalculatedSheet({ accessToken, fetchImpl, spreadsheetId });
  const existingValues = await getCalculatedSheetValues({ accessToken, fetchImpl, spreadsheetId });
  const existingRows = parseCalculatedSheetValues(existingValues);
  const merge = mergeCalculatedRows(existingRows, calculatedRows);
  await putCalculatedSheetValues(buildCalculatedSheetValues(merge.rows), { accessToken, fetchImpl, spreadsheetId });
  return {
    ok: true,
    dryRun: false,
    sheetName: CALCULATED_BALANCE_SHEET_NAME,
    rowCount: calculatedRows.length,
    inserted: merge.inserted,
    updated: merge.updated,
  };
}

export function toCalculatedBalanceSnapshotRows(rows = []) {
  return (rows || [])
    .filter((row) => row?.status === STATUS_CALCULATED)
    .map((row) => ({
      date: row.date,
      channel: row.channel,
      accountName: row.channel,
      currency: row.currency,
      amount: row.calculated_eod,
      balanceAmount: row.calculated_eod,
      source: "calculated",
      fact_source: "calculated",
      balanceSource: "calculated_balance",
      sourceSheet: CALCULATED_BALANCE_SHEET_NAME,
      comment: `calculated from ${row.anchor_date || "previous"} ${row.anchor_source || "anchor"} plus Ledger amount_net movement`,
      anchor_date: row.anchor_date || "",
      anchor_source: row.anchor_source || "",
      opening_balance: row.opening_balance,
      movement: row.movement,
      status: STATUS_CALCULATED,
    }));
}

function buildMovementIndex(operations = []) {
  const byDateKey = new Map();
  let missingAmountNetRows = 0;

  for (const operation of operations || []) {
    const ledger = operation?.ledgerV2 || {};
    const date = normalizeDate(operation?.date ?? ledger.date);
    const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
    const amount = parseNumber(ledger.balance_amount ?? operation?.balanceAmount);
    const channel = amount === null ? getMovementChannel(operation, 1) : getMovementChannel(operation, amount);
    const key = channel && currency ? makeKey(channel, currency) : "";
    if (!date || !key) continue;

    const hasAmountNet = String(ledger.amount_net ?? operation?.amountNet ?? operation?.amount_net ?? "").trim();
    const current = byDateKey.get(`${date}|${key}`) || {
      date,
      channel,
      currency,
      inflow: 0,
      outflow: 0,
      net_change: 0,
      missing_amount_net_rows: 0,
    };
    if (!hasAmountNet) {
      current.missing_amount_net_rows += 1;
      missingAmountNetRows += 1;
      byDateKey.set(`${date}|${key}`, current);
      continue;
    }
    if (amount === null) continue;
    if (amount >= 0) current.inflow += amount;
    else current.outflow += Math.abs(amount);
    current.net_change += amount;
    byDateKey.set(`${date}|${key}`, current);
  }

  return { byDateKey, missing_amount_net_rows: missingAmountNetRows };
}

function buildAnchorIndex(balanceRows = []) {
  const byKey = new Map();
  const byDateKey = new Map();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    if (!date || !channel || !currency || amount === null) continue;
    const sourceType = resolveAnchorSource(row);
    if (!["manual_fact", "provider_auto", "derived_balance", "calculated_balance"].includes(sourceType)) continue;
    const key = makeKey(channel, currency);
    const normalized = {
      date,
      channel,
      currency,
      amount,
      sourceType,
      anchor_date: sourceType === "calculated_balance" ? normalizeDate(row?.anchor_date) : date,
      anchor_source: sourceType === "calculated_balance" ? String(row?.anchor_source || "").trim() : sourceType,
    };
    setPreferredAnchor(byDateKey, `${date}|${key}`, normalized);
    const rows = byKey.get(key) || [];
    rows.push(normalized);
    byKey.set(key, rows);
  }
  for (const rows of byKey.values()) rows.sort(compareAnchors);
  return { byKey, byDateKey };
}

function buildPairs({ operations = [], balanceRows = [], activePairs = [] } = {}) {
  const pairs = new Map();
  for (const pair of activePairs || []) addPair(pairs, pair.channel, pair.currency);
  for (const row of balanceRows || []) addPair(pairs, row?.channel || row?.accountName || row?.account, row?.currency);
  for (const row of operations || []) {
    const ledger = row?.ledgerV2 || {};
    const amount = parseNumber(ledger.balance_amount ?? row?.balanceAmount);
    const currency = String(ledger.currency || row?.currency || "").trim().toUpperCase();
    addPair(pairs, getMovementChannel(row, amount === null ? 1 : amount), currency);
  }
  return Array.from(pairs.values()).sort((left, right) =>
    left.channel === right.channel ? left.currency.localeCompare(right.currency) : left.channel.localeCompare(right.channel)
  );
}

function addPair(pairs, channel, currency) {
  const normalizedChannel = String(channel || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!normalizedChannel || !normalizedCurrency) return;
  pairs.set(makeKey(normalizedChannel, normalizedCurrency), { channel: normalizedChannel, currency: normalizedCurrency });
}

function findLatestAnchorBeforeOrOn(balanceIndex, key, date) {
  return (balanceIndex.byKey.get(key) || []).filter((row) => row.date <= date).at(-1) || null;
}

function setPreferredAnchor(map, key, row) {
  const existing = map.get(key);
  if (!existing || sourcePriority(row) < sourcePriority(existing)) map.set(key, row);
}

function compareAnchors(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  return sourcePriority(left) - sourcePriority(right);
}

function sourcePriority(row = {}) {
  const source = resolveAnchorSource(row);
  if (source === "manual_fact") return 0;
  if (source === "provider_auto") return 1;
  if (source === "derived_balance") return 2;
  if (source === "calculated_balance") return 3;
  return 4;
}

function resolveAnchorSource(row = {}) {
  const explicit = String(row.balanceSource || row.balance_source || "").trim();
  if (["manual_fact", "provider_auto", "derived_balance", "calculated_balance"].includes(explicit)) return explicit;
  const text = [row.source, row.fact_source, row.provider, row.comment, row.sourceSheet]
    .map((value) => String(value || "").trim().toLowerCase())
    .join(" ");
  if (/calculated_balance|calculated|расчетные остатки/.test(text)) return "calculated_balance";
  if (/manual[_ -]owner[_ -]confirmed|owner[_ -]confirmed|manual_fact|manual confirmed|manual balance|paypal_manual_balance|paypal_manual_confirmed_balance/.test(text)) return "manual_fact";
  if (/derived_from_confirmed_balance|paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed paypal balance/.test(text)) return "derived_balance";
  if (/provider_auto|auto snapshot|provider|wise|paypal|binance|monobank|privat|yoomoney/.test(text)) return "provider_auto";
  return "manual_fact";
}

function buildBlockedRow({ date, pair, current, movement, anchorDate, anchorSource, timestamp }) {
  return {
    date,
    channel: pair.channel,
    currency: pair.currency,
    opening_balance: current === null ? null : round(current),
    movement: null,
    calculated_eod: null,
    source: "calculated",
    balanceSource: "calculated_balance",
    balance_source: "calculated_balance",
    sourceSheet: CALCULATED_BALANCE_SHEET_NAME,
    anchor_date: anchorDate,
    anchor_source: anchorSource,
    status: "missing_amount_net",
    missing_amount_net_rows: movement.missing_amount_net_rows,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function emptyMovement({ date, pair }) {
  return { date, channel: pair.channel, currency: pair.currency, inflow: 0, outflow: 0, net_change: 0, missing_amount_net_rows: 0 };
}

async function ensureCalculatedSheet({ accessToken, fetchImpl, spreadsheetId }) {
  const metadata = await sheetsFetchJson({
    path: `/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title,hidden))`,
    accessToken,
    fetchImpl,
  });
  const existing = (metadata.sheets || []).find((sheet) => sheet?.properties?.title === CALCULATED_BALANCE_SHEET_NAME);
  if (existing) {
    if (!existing.properties.hidden) {
      await sheetsFetchJson({
        path: `/spreadsheets/${spreadsheetId}:batchUpdate`,
        method: "POST",
        accessToken,
        fetchImpl,
        body: {
          requests: [{
            updateSheetProperties: {
              properties: { sheetId: existing.properties.sheetId, hidden: true },
              fields: "hidden",
            },
          }],
        },
      });
    }
    return existing.properties.sheetId;
  }
  const payload = await sheetsFetchJson({
    path: `/spreadsheets/${spreadsheetId}:batchUpdate`,
    method: "POST",
    accessToken,
    fetchImpl,
    body: {
      requests: [{ addSheet: { properties: { title: CALCULATED_BALANCE_SHEET_NAME, hidden: true } } }],
    },
  });
  return payload.replies?.[0]?.addSheet?.properties?.sheetId || null;
}

async function getCalculatedSheetValues({ accessToken, fetchImpl, spreadsheetId }) {
  const range = encodeURIComponent(`'${CALCULATED_BALANCE_SHEET_NAME}'!A:L`);
  const payload = await sheetsFetchJson({
    path: `/spreadsheets/${spreadsheetId}/values/${range}`,
    accessToken,
    fetchImpl,
  });
  return payload.values || [];
}

async function putCalculatedSheetValues(values, { accessToken, fetchImpl, spreadsheetId }) {
  const range = encodeURIComponent(`'${CALCULATED_BALANCE_SHEET_NAME}'!A:L`);
  await sheetsFetchJson({
    path: `/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    method: "PUT",
    accessToken,
    fetchImpl,
    body: { values },
  });
}

async function sheetsFetchJson({ path, method = "GET", accessToken, fetchImpl, body }) {
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Sheets API HTTP ${response.status}`);
  }
  return payload;
}

function parseCalculatedSheetValues(values = []) {
  const [header = [], ...rows] = values || [];
  const indexes = Object.fromEntries(CALCULATED_BALANCE_HEADERS.map((name) => [name, findHeaderIndex(header, name)]));
  if (indexes.date === -1 || indexes.channel === -1 || indexes.currency === -1) return [];
  return rows
    .map((row) => normalizeCalculatedRow({
      date: row[indexes.date],
      channel: row[indexes.channel],
      currency: row[indexes.currency],
      opening_balance: row[indexes.opening_balance],
      movement: row[indexes.movement],
      calculated_eod: row[indexes.calculated_eod],
      source: row[indexes.source],
      anchor_date: row[indexes.anchor_date],
      anchor_source: row[indexes.anchor_source],
      status: row[indexes.status],
      created_at: row[indexes.created_at],
      updated_at: row[indexes.updated_at],
    }))
    .filter(Boolean);
}

function buildCalculatedSheetValues(rows = []) {
  return [
    CALCULATED_BALANCE_HEADERS,
    ...rows.sort(compareRows).map((row) => [
      row.date,
      row.channel,
      row.currency,
      formatNumber(row.opening_balance),
      formatNumber(row.movement),
      formatNumber(row.calculated_eod),
      "calculated",
      row.anchor_date,
      row.anchor_source,
      STATUS_CALCULATED,
      row.created_at,
      row.updated_at,
    ]),
  ];
}

function mergeCalculatedRows(existingRows = [], nextRows = []) {
  const merged = new Map();
  for (const row of existingRows || []) merged.set(calculatedKey(row), row);
  let inserted = 0;
  let updated = 0;
  for (const row of nextRows || []) {
    const key = calculatedKey(row);
    if (!key) continue;
    const existing = merged.get(key);
    if (existing) updated += 1;
    else inserted += 1;
    merged.set(key, {
      ...existing,
      ...row,
      created_at: existing?.created_at || row.created_at,
      updated_at: row.updated_at,
    });
  }
  return { rows: Array.from(merged.values()), inserted, updated };
}

function normalizeCalculatedRow(row = {}, now = new Date()) {
  const date = normalizeDate(row.date);
  const channel = String(row.channel || "").trim();
  const currency = String(row.currency || "").trim().toUpperCase();
  const opening = parseNumber(row.opening_balance);
  const movement = parseNumber(row.movement);
  const calculated = parseNumber(row.calculated_eod ?? row.amount ?? row.balanceAmount);
  if (!date || !channel || !currency || opening === null || movement === null || calculated === null) return null;
  const timestamp = normalizeTimestamp(now) || new Date().toISOString();
  return {
    date,
    channel,
    currency,
    opening_balance: round(opening),
    movement: round(movement),
    calculated_eod: round(calculated),
    source: "calculated",
    anchor_date: normalizeDate(row.anchor_date),
    anchor_source: String(row.anchor_source || "").trim(),
    status: STATUS_CALCULATED,
    created_at: String(row.created_at || timestamp).trim(),
    updated_at: String(row.updated_at || timestamp).trim(),
  };
}

function calculatedKey(row = {}) {
  const date = normalizeDate(row.date);
  const channel = String(row.channel || "").trim();
  const currency = String(row.currency || "").trim().toUpperCase();
  return date && channel && currency ? `${date}|${channel}|${currency}` : "";
}

function findHeaderIndex(header, name) {
  const normalized = normalizeHeader(name);
  return (header || []).findIndex((cell) => normalizeHeader(cell) === normalized);
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function buildDateRange(from, to) {
  if (!from || !to || from > to) return [];
  const dates = [];
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function getMovementChannel(row, amount) {
  const ledger = row?.ledgerV2 || {};
  if (amount < 0) return String(ledger.from_channel || row?.fromChannel || row?.from_channel || row?.toChannel || row?.to_channel || "").trim();
  return String(ledger.to_channel || row?.toChannel || row?.to_channel || row?.fromChannel || row?.from_channel || "").trim();
}

function makeKey(channel, currency) {
  return `${String(channel || "").trim()}|${String(currency || "").trim().toUpperCase()}`;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = String(value || "").trim();
  return raw || "";
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatNumber(value) {
  const numeric = parseNumber(value);
  return numeric === null ? "" : String(round(numeric));
}

function round(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function compareRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}
