export const MAY_2026_BACKFILL_CONFIRMATION = "apply-may-2026-daily-balance-backfill";
export const DAILY_BALANCE_BACKFILL_CONFIRMATION = "apply-daily-balance-backfill";

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
  if (!isValidDateWindow(from, to)) {
    return jsonResult(400, {
      ok: false,
      error: "valid_date_range_required",
      message: "Pass from and to as YYYY-MM-DD with from <= to.",
    });
  }

  const apply = isTruthy(query.apply || query.write);
  if (apply && !isAcceptedConfirmation({ from, to, confirm: query.confirm })) {
    return jsonResult(403, {
      ok: false,
      error: "apply_confirmation_required",
      message: `Pass confirm=${DAILY_BALANCE_BACKFILL_CONFIRMATION} with apply=1 to write derived rows outside the legacy May 2026 backfill window.`,
    });
  }

  const buildReport = options.buildReport || await loadBackfillReportBuilder();
  const report = await buildReport({ from, to, apply });
  const write = report?.save || {};
  return jsonResult(report.ok ? 200 : 500, {
    ...report,
    dryRun: !apply,
    applied: Boolean(apply && write.applied),
    write_summary: {
      inserted: Number(write.inserted || 0),
      updated: Number(write.updated || 0),
      skipped: Number(write.skipped || 0),
    },
    route_guard: {
      may_2026_only: false,
      range_limited_to_may_2026: false,
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

function isValidDateWindow(from, to) {
  return Boolean(from && to && from <= to);
}

function isMay2026Window(from, to) {
  return from >= "2026-05-01" && to <= "2026-05-31" && from <= to;
}

function isAcceptedConfirmation({ from, to, confirm }) {
  const value = String(confirm || "").trim();
  if (value === DAILY_BALANCE_BACKFILL_CONFIRMATION) return true;
  return isMay2026Window(from, to) && value === MAY_2026_BACKFILL_CONFIRMATION;
}

function isTruthy(value) {
  return ["1", "true", "yes", "apply"].includes(String(value || "").trim().toLowerCase());
}

async function loadBackfillReportBuilder() {
  const module = await import("../scripts/backfill-daily-balance-snapshots.mjs");
  return module.buildBackfillDailyBalanceSnapshotsReport;
}
