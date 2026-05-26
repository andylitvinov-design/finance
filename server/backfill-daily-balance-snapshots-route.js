import { buildBackfillDailyBalanceSnapshotsReport } from "../scripts/backfill-daily-balance-snapshots.mjs";

export const MAY_2026_BACKFILL_CONFIRMATION = "apply-may-2026-daily-balance-backfill";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });

  const result = await runDailyBalanceBackfillRoute({
    method: request.method,
    query: request.query || {},
  });
  return response.status(result.status).json(result.body);
}

export async function runDailyBalanceBackfillRoute(options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) {
    return jsonResult(405, { ok: false, error: "method_not_allowed", message: `Unsupported method: ${method}` });
  }

  const query = options.query || {};
  const from = normalizeDate(query.from);
  const to = normalizeDate(query.to);
  if (!isMay2026Window(from, to)) {
    return jsonResult(400, {
      ok: false,
      error: "may_2026_window_required",
      message: "This guarded route only backfills dates inside 2026-05-01..2026-05-31.",
    });
  }

  const apply = isTruthy(query.apply || query.write);
  if (apply && String(query.confirm || "").trim() !== MAY_2026_BACKFILL_CONFIRMATION) {
    return jsonResult(403, {
      ok: false,
      error: "apply_confirmation_required",
      message: `Pass confirm=${MAY_2026_BACKFILL_CONFIRMATION} with apply=1 to write derived rows.`,
    });
  }

  const buildReport = options.buildReport || buildBackfillDailyBalanceSnapshotsReport;
  const report = await buildReport({ from, to, apply });
  return jsonResult(report.ok ? 200 : 500, {
    ...report,
    dryRun: !apply,
    route_guard: {
      may_2026_only: true,
      apply_requires_confirmation: true,
      confirmation: apply ? "accepted" : "not_requested",
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

function isMay2026Window(from, to) {
  return from >= "2026-05-01" && to <= "2026-05-31" && from <= to;
}

function isTruthy(value) {
  return ["1", "true", "yes", "apply"].includes(String(value || "").trim().toLowerCase());
}
