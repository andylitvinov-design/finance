import {
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "../server/manual-google-sheets.js";

const TARGET_SHEET = "Остатки";
const WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const HEADER = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"];

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });

  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      route: "save-balance-snapshot",
      target_sheet: TARGET_SHEET,
      method: "POST",
      contract: {
        rows: [
          {
            date: "YYYY-MM-DD",
            channel: "БАНК КАНАДА cad",
            amount: 10538,
            currency: "CAD",
            rate: 0.74,
            usdAmount: 7798.12,
            comment: "owner_confirmed",
          },
        ],
      },
    });
  }

  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  try {
    const payload = parseJsonBody(request.body);
    const rows = extractSnapshotRows(payload);
    const dryRun = isTruthy(payload.dryRun);

    if (!rows.length) {
      return response.status(400).json({
        ok: false,
        action: "saveBalanceSnapshot",
        target_sheet: TARGET_SHEET,
        error: "No valid balance snapshot rows supplied.",
      });
    }

    const plan = await buildOstatkiUpsertPlan({ rows });

    if (dryRun) {
      return response.status(200).json({
        ok: true,
        dryRun: true,
        action: "saveBalanceSnapshot",
        target_sheet: TARGET_SHEET,
        rowCount: rows.length,
        inserted: plan.inserted.length,
        updated: plan.updated.length,
        deduped: plan.deduped,
        rows,
      });
    }

    const save = await writeOstatkiRows(plan.outputRows);
    return response.status(200).json({
      ok: true,
      dryRun: false,
      action: "saveBalanceSnapshot",
      target_sheet: TARGET_SHEET,
      rowCount: rows.length,
      inserted: plan.inserted.length,
      updated: plan.updated.length,
      deduped: plan.deduped,
      updatedRange: save.updatedRange || null,
    });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      action: "saveBalanceSnapshot",
      target_sheet: TARGET_SHEET,
      error: String(error?.message || error),
    });
  }
}

export function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body || "{}");
  return body;
}

export function extractSnapshotRows(payload = {}) {
  const sourceRows = Array.isArray(payload.rows)
    ? payload.rows
    : Array.isArray(payload.balanceRows)
      ? payload.balanceRows
      : Array.isArray(payload.snapshotRows)
        ? payload.snapshotRows
        : Array.isArray(payload.data?.rows)
          ? payload.data.rows
          : Array.isArray(payload.data?.balanceRows)
            ? payload.data.balanceRows
            : [];

  if (sourceRows.length) return sourceRows.map((row) => normalizeSnapshotRow(row, payload)).filter(Boolean);

  const single = normalizeSnapshotRow(payload, payload);
  return single ? [single] : [];
}

export async function buildOstatkiUpsertPlan({ rows = [], fetchImpl = fetch } = {}) {
  const existingValues = await readOstatkiValues({ fetchImpl });
  const existingRows = parseOstatkiValues(existingValues);
  const outputByKey = new Map();
  let deduped = 0;

  for (const row of existingRows) {
    const key = buildOstatkiKey(row);
    const current = outputByKey.get(key);
    if (!current || rowPriority(row) >= rowPriority(current)) {
      if (current) deduped += 1;
      outputByKey.set(key, row);
    } else {
      deduped += 1;
    }
  }

  const inserted = [];
  const updated = [];
  for (const row of rows.map((entry) => normalizeSnapshotRow(entry)).filter(Boolean)) {
    const key = buildOstatkiKey(row);
    const existing = outputByKey.get(key);
    const merged = {
      ...(existing || {}),
      ...row,
      comment: row.comment || existing?.comment || "owner_confirmed",
      source: "owner_confirmed",
    };
    outputByKey.set(key, merged);
    if (existing) updated.push(merged);
    else inserted.push(merged);
  }

  const outputRows = Array.from(outputByKey.values()).sort(compareOstatkiRows);
  return { outputRows, inserted, updated, deduped };
}

export function parseOstatkiValues(values = []) {
  const rows = Array.isArray(values) ? values : [];
  const [header = [], ...body] = rows;
  const headerMap = buildHeaderMap(header);
  return body
    .map((row) => normalizeSnapshotRow({
      date: row[headerMap.date ?? 0],
      channel: row[headerMap.channel ?? 1],
      amount: row[headerMap.amount ?? 2],
      currency: row[headerMap.currency ?? 3],
      rate: row[headerMap.rate ?? 4],
      usdAmount: row[headerMap.usdAmount ?? 5],
      comment: row[headerMap.comment ?? 6],
    }))
    .filter(Boolean);
}

async function readOstatkiValues({ fetchImpl = fetch } = {}) {
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: WRITE_SCOPE, fetchImpl });
  const range = encodeURIComponent(`'${TARGET_SHEET}'!A:G`);
  const response = await fetchImpl(
    `${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Sheets Остатки read failed with HTTP ${response.status}`);
  }
  return payload.values || [];
}

async function writeOstatkiRows(rows = [], { fetchImpl = fetch } = {}) {
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: WRITE_SCOPE, fetchImpl });
  const range = encodeURIComponent(`'${TARGET_SHEET}'!A:G`);
  const response = await fetchImpl(
    `${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: buildOstatkiValues(rows) }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Sheets Остатки update failed with HTTP ${response.status}`);
  }
  return payload;
}

function normalizeSnapshotRow(row = {}, payload = {}) {
  const date = normalizeDate(row.date || row.snapshotDate || payload.date || payload.snapshotDate);
  const channel = String(row.channel || row.accountName || row.account || row.provider || "").trim();
  const currency = normalizeCurrency(row.currency || row.nativeCurrency || row.balanceCurrency);
  const amount = row.amount ?? row.balanceAmount ?? row.nativeAmount ?? row.value;
  if (!date || !channel || !currency || amount === undefined || amount === null || amount === "") return null;
  return {
    date,
    channel,
    currency,
    amount: normalizeNumberText(amount),
    rate: normalizeNumberText(row.rate ?? row.fxRate ?? ""),
    usdAmount: normalizeNumberText(row.usdAmount ?? row.amount_usd ?? row.amountUsd ?? ""),
    comment: String(row.comment || row.status || row.source || payload.comment || "owner_confirmed").trim() || "owner_confirmed",
  };
}

function buildOstatkiValues(rows = []) {
  return [HEADER, ...rows.map((row) => [
    row.date || "",
    row.channel || "",
    row.amount || "",
    row.currency || "",
    row.rate || "",
    row.usdAmount || "",
    row.comment || "",
  ])];
}

function buildHeaderMap(header = []) {
  const normalized = header.map((cell) => normalizeLookupText(cell));
  const find = (names) => normalized.findIndex((cell) => names.includes(cell));
  return {
    date: find(["дата", "date"]),
    channel: find(["канал", "channel", "account"]),
    amount: find(["сумма", "amount"]),
    currency: find(["валюта", "currency"]),
    rate: find(["курс", "rate"]),
    usdAmount: find(["сумма usd", "сумма_usd", "amount usd", "amount_usd", "usdamount"]),
    comment: find(["комментарий", "comment", "status", "source"]),
  };
}

function buildOstatkiKey(row) {
  return [row.date, normalizeLookupText(row.channel), normalizeCurrency(row.currency)].join("|");
}

function rowPriority(row) {
  const text = normalizeLookupText(`${row.comment || ""} ${row.source || ""}`);
  if (/owner confirmed|owner_confirmed|manual fact|manual_fact/.test(text)) return 50;
  if (/manual google sheets|manual-google-sheets|остатки/.test(text)) return 40;
  if (/provider auto|provider_auto/.test(text)) return 20;
  if (/derived/.test(text)) return 10;
  if (/missing/.test(text)) return 0;
  return 30;
}

function compareOstatkiRows(left, right) {
  return `${left.date}|${left.channel}|${left.currency}`.localeCompare(`${right.date}|${right.channel}|${right.currency}`, "ru");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  return raw.slice(0, 10);
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeNumberText(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\s+/g, "").replace(".", ",");
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_]+/g, " ")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}
