const MATCH_TOLERANCE_USD = 0.01;

export function buildCanonicalBalanceTotal({
  selectedDateTotalUsd = null,
  selectedDateStatus = "",
  periodTotalUsd = null,
  periodStatus = "",
} = {}) {
  const selected = parseNumber(selectedDateTotalUsd);
  const period = parseNumber(periodTotalUsd);
  const selectedUsable = selected !== null && !isBlockingStatus(selectedDateStatus);
  const periodUsable = period !== null && !isBlockingStatus(periodStatus);
  const delta = selected !== null && period !== null ? round(selected - period) : null;
  const totalsMatch = selected !== null && period !== null && Math.abs(delta) <= MATCH_TOLERANCE_USD;

  if (selectedUsable && periodUsable && !totalsMatch) {
    return {
      source: "needs_verification",
      selected_date_total_usd: selected,
      period_total_usd: period,
      canonical_total_usd: null,
      delta_usd: delta,
      totals_match: false,
      status: "mismatch",
      explanation: "Selected-date and period USD totals differ beyond tolerance; canonical total needs verification.",
    };
  }

  if (selected !== null && !selectedUsable) {
    return {
      source: "needs_verification",
      selected_date_total_usd: selected,
      period_total_usd: period,
      canonical_total_usd: null,
      delta_usd: delta,
      totals_match: totalsMatch,
      status: normalizeUntrustedSelectedStatus(selectedDateStatus),
      explanation: "Selected-date balance snapshot is incomplete, stale, missing FX, or otherwise not trusted.",
    };
  }

  if (selectedUsable) {
    return {
      source: "selected_date_snapshot",
      selected_date_total_usd: selected,
      period_total_usd: period,
      canonical_total_usd: selected,
      delta_usd: delta,
      totals_match: totalsMatch,
      status: selectedDateStatus || (totalsMatch || period === null ? "ok" : "mismatch"),
      explanation: "Using selected-date balance snapshot as canonical total.",
    };
  }

  if (periodUsable) {
    return {
      source: "period_reconciliation",
      selected_date_total_usd: selected,
      period_total_usd: period,
      canonical_total_usd: period,
      delta_usd: delta,
      totals_match: totalsMatch,
      status: periodStatus || "ok",
      explanation: selected === null
        ? "Using period reconciliation because selected-date total is unavailable."
        : "Using period reconciliation because selected-date total needs verification.",
    };
  }

  if (period !== null && !periodUsable) {
    return {
      source: "needs_verification",
      selected_date_total_usd: selected,
      period_total_usd: period,
      canonical_total_usd: null,
      delta_usd: delta,
      totals_match: totalsMatch,
      status: normalizeStatus(periodStatus) || "needs_verification",
      explanation: "Period reconciliation total is incomplete, stale, missing FX, or otherwise not trusted.",
    };
  }

  return {
    source: "needs_verification",
    selected_date_total_usd: selected,
    period_total_usd: period,
    canonical_total_usd: null,
    delta_usd: delta,
    totals_match: false,
    status: "needs_verification",
    explanation: "No trusted selected-date or period USD total is available.",
  };
}

export function buildCanonicalBalanceTotalFromSnapshots({
  selectedDateSnapshot = null,
  periodReconciliation = null,
} = {}) {
  return buildCanonicalBalanceTotal({
    selectedDateTotalUsd: extractSelectedDateTotalUsd(selectedDateSnapshot),
    selectedDateStatus: extractSelectedDateStatus(selectedDateSnapshot),
    periodTotalUsd: extractPeriodTotalUsd(periodReconciliation),
    periodStatus: periodReconciliation?.total_usd_row?.status || periodReconciliation?.status || "",
  });
}

export function extractSelectedDateTotalUsd(snapshot = {}) {
  const explicit = parseNumber(
    snapshot?.canonical_total_usd ??
    snapshot?.total_usd ??
    snapshot?.closing_usd ??
    snapshot?.totals?.closingUsd
  );
  if (explicit !== null) return explicit;
  const rows = Array.isArray(snapshot?.selected_date_rows)
    ? snapshot.selected_date_rows
    : Array.isArray(snapshot?.selected_rows)
      ? snapshot.selected_rows
      : [];
  if (!rows.length) return null;
  let total = 0;
  let finiteRows = 0;
  for (const row of rows) {
    const value = parseNumber(row.amount_usd ?? row.usdAmount ?? row.closingUsd ?? row.closing_usd);
    if (value === null) continue;
    total += value;
    finiteRows += 1;
  }
  return finiteRows ? round(total) : null;
}

export function extractPeriodTotalUsd(reconciliation = {}) {
  return parseNumber(
    reconciliation?.canonical_total?.canonical_total_usd ??
    reconciliation?.total_usd_row?.confirmed_end_usd ??
    reconciliation?.total_usd_row?.closing_usd ??
    reconciliation?.canonical_total_usd_row?.confirmed_end_usd
  );
}

function extractSelectedDateStatus(snapshot = {}) {
  const coverageStatus = String(snapshot?.selected_date_coverage?.status || "").trim();
  const status = String(snapshot?.status || coverageStatus || "").trim();
  if (status) return status;
  const diagnostics = Array.isArray(snapshot?.selected_date_diagnostics) ? snapshot.selected_date_diagnostics.join(" ") : "";
  return /needs verification|fx_missing|missing/i.test(diagnostics) ? "needs_verification" : "ok";
}

function isBlockingStatus(status = "") {
  const normalized = normalizeStatus(status);
  return [
    "missing",
    "partial",
    "needs_verification",
    "error",
    "fx_missing",
    "mismatch",
    "stale",
    "blocked",
    "failed",
  ].includes(normalized);
}

function normalizeStatus(status = "") {
  return String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeUntrustedSelectedStatus(status = "") {
  const normalized = normalizeStatus(status);
  if (!normalized || normalized === "partial" || normalized === "missing") return "needs_verification";
  return normalized;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}
