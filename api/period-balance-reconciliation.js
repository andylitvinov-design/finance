import { loadAutoBalanceRowsFromGoogleSheets } from "../server/auto-balance-repository.js";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import { buildPeriodBalanceReconciliationSnapshot } from "../server/period-balance-reconciliation-route.js";

export default async function periodBalanceReconciliationHandler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }
  if (String(request.query?.mode || "").trim().toLowerCase() === "apply") {
    return response.status(400).json({
      ok: false,
      error: "period balance reconciliation is dry-run only; apply mode is not available on this endpoint",
    });
  }

  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: request.query || {},
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
    autoBalanceLoader: loadAutoBalanceRowsFromGoogleSheets,
  });
  clarifyOpeningRepairTemplates(snapshot);
  return response.status(200).json(snapshot);
}

function clarifyOpeningRepairTemplates(snapshot = {}) {
  const reconciliation = snapshot.period_balance_reconciliation || {};
  const periodFrom = snapshot.period?.from || reconciliation.period?.from || "";
  if (!periodFrom) return snapshot;

  const seen = new Set();
  const rows = [
    ...(Array.isArray(reconciliation.by_channel_currency) ? reconciliation.by_channel_currency : []),
    ...(Array.isArray(reconciliation.actionable_rows) ? reconciliation.actionable_rows : []),
  ];

  for (const row of rows) {
    if (!row || row.status !== "missing_opening_balance") continue;
    const key = `${row.channel || ""}|${row.currency || ""}`;
    if (seen.has(key) && row.repair_template?.date === periodFrom) continue;
    seen.add(key);
    row.repair_template = {
      ...(row.repair_template || {}),
      sheet: "Остатки",
      date: periodFrom,
      channel: row.channel,
      currency: row.currency,
      amount: null,
      date_requirement: "on_or_before_period_start",
      latest_allowed_date: periodFrom,
      safe_fill: "amount must be a factual opening balance on or before the period start; do not use derived reverse-calculation or period-end closing as opening fact",
    };
  }
  return snapshot;
}
