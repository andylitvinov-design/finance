import { appendManualOstatkiRows } from "../server/manual-google-sheets.js";

const TARGET_SHEET = "Остатки";

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

    if (dryRun) {
      return response.status(200).json({
        ok: true,
        dryRun: true,
        action: "saveBalanceSnapshot",
        target_sheet: TARGET_SHEET,
        rowCount: rows.length,
        rows,
      });
    }

    const result = await appendManualOstatkiRows({ rows });
    return response.status(200).json({
      ok: true,
      dryRun: false,
      action: "saveBalanceSnapshot",
      target_sheet: TARGET_SHEET,
      rowCount: rows.length,
      inserted: result.appended?.length || 0,
      updated: result.updated?.length || 0,
      skipped: result.skipped?.length || 0,
      save: result,
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

function normalizeSnapshotRow(row = {}, payload = {}) {
  const date = normalizeDate(row.date || row.snapshotDate || payload.date || payload.snapshotDate);
  const channel = String(row.channel || row.accountName || row.account || row.provider || "").trim();
  const currency = String(row.currency || row.nativeCurrency || row.balanceCurrency || "").trim().toUpperCase();
  const amount = row.amount ?? row.balanceAmount ?? row.nativeAmount ?? row.value;
  if (!date || !channel || !currency || amount === undefined || amount === null || amount === "") return null;
  return {
    date,
    channel,
    currency,
    amount,
    comment: String(row.comment || row.status || row.source || payload.comment || "owner_confirmed").trim() || "owner_confirmed",
  };
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/) || raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return raw.slice(0, 10);
  if (match[1].length === 4) return `${match[1]}-${match[2]}-${match[3]}`;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}
