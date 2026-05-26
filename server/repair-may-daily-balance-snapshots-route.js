export const MAY_REPAIR_CONFIRMATION = "repair-may-2026-daily-balance-snapshots";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });

  const result = await runMayDailyBalanceSnapshotRepairRoute({
    method: request.method,
    query: request.query || {},
  });
  return response.status(result.status).json(result.body);
}

export async function runMayDailyBalanceSnapshotRepairRoute(options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) {
    return jsonResult(405, { ok: false, error: "method_not_allowed", message: `Unsupported method: ${method}` });
  }

  const query = options.query || {};
  const from = normalizeDate(query.from);
  const to = normalizeDate(query.to);
  if (!from || !to || from > to) {
    return jsonResult(400, {
      ok: false,
      error: "valid_date_range_required",
      message: "Pass from and to as YYYY-MM-DD with from <= to.",
    });
  }

  const apply = isTruthy(query.apply || query.write);
  const confirm = String(query.confirm || "").trim();
  if (apply && confirm !== MAY_REPAIR_CONFIRMATION) {
    return jsonResult(403, {
      ok: false,
      error: "apply_confirmation_required",
      message: `Pass confirm=${MAY_REPAIR_CONFIRMATION} with apply=1 to rewrite Авто Остатки.`,
    });
  }

  const buildReport = options.buildReport || await loadRepairReportBuilder();
  const report = await buildReport({ from, to, apply, confirm });
  return jsonResult(report.ok ? 200 : 500, {
    ...report,
    dryRun: !apply,
    route_guard: {
      apply_requires_confirmation: true,
      confirmation: apply ? "accepted" : "not_requested",
      mutates_only: "Авто Остатки",
    },
  });
}

function jsonResult(status, body) {
  return { status, body };
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function isTruthy(value) {
  return ["1", "true", "yes", "apply"].includes(String(value || "").trim().toLowerCase());
}

async function loadRepairReportBuilder() {
  const module = await import("../scripts/repair-may-daily-balance-snapshots.mjs");
  return module.buildRepairMayDailyBalanceSnapshotsReport;
}
