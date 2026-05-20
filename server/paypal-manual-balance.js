import {
  AUTO_BALANCE_SHEET_NAME,
  buildPayPalManualBalanceRows,
  savePayPalManualBalanceRows,
} from "./auto-balance-snapshots.js";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const apply = isTruthy(payload.apply || payload.write);
    const dryRun = !apply || isTruthy(payload.dryRun);
    const rows = buildPayPalManualBalanceRows(payload);
    if (dryRun) {
      return response.status(200).json({
        ok: true,
        dryRun: true,
        target_sheet: AUTO_BALANCE_SHEET_NAME,
        rowCount: rows.length,
        rows,
      });
    }
    const save = await savePayPalManualBalanceRows(payload);
    return response.status(200).json({
      ok: true,
      dryRun: false,
      target_sheet: AUTO_BALANCE_SHEET_NAME,
      rowCount: save.rowCount,
      inserted: save.inserted,
      updated: save.updated,
      rows: save.rows,
      save,
    });
  } catch (error) {
    return response.status(400).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}
