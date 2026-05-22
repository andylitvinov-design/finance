// ============================================================
// TOP METRIC PAYABLE SHARE FIX
// ============================================================

(function patchTopMetricPayableShare() {
  const PAYABLE_SHARE_RATE = 0.7;
  const BADGE_ID = "metricPersonalOrdersAfterDiscount";

  function parseMetricNumber(value) {
    if (typeof parseLooseNumber === "function") {
      const parsed = parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(",", ".");
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeMetricText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ");
  }

  function hasAnyCellValue(row) {
    return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
  }

  function findHeaderIndex(header, aliases) {
    const normalizedAliases = new Set((aliases || []).map(normalizeMetricText));
    return (header || []).findIndex((cell) => normalizedAliases.has(normalizeMetricText(cell)));
  }

  function isTotalRow(row) {
    const first = normalizeMetricText(row?.[0]);
    return first === "итого" || first === "total" || first === "итого за период";
  }

  function getMovementSummaryAccruedTotal() {
    const rows = typeof state !== "undefined" ? state?.data?.tabs?.movement?.summaryRows || [] : [];
    const row = (rows || []).find((item) => normalizeMetricText(item?.[0]).includes("начислено прайс"));
    const amount = parseMetricNumber(row?.[1]);
    return amount > 0 ? amount : null;
  }

  function getMovementAccruedPlusTotalFromState() {
    const summaryTotal = getMovementSummaryAccruedTotal();
    if (summaryTotal !== null) return summaryTotal;

    const values = typeof state !== "undefined" ? state?.data?.tabs?.movement?.values || [] : [];
    if (!Array.isArray(values) || !values.length) return null;

    const headerRowIndex = values.findIndex((row) =>
      (row || []).some((cell) => normalizeMetricText(cell) === "accrued +3%")
    );
    if (headerRowIndex === -1) return null;

    const header = values[headerRowIndex] || [];
    const accruedPlusIndex = findHeaderIndex(header, ["ACCRUED +3%"]);
    if (accruedPlusIndex === -1) return null;

    const dataRows = values.slice(headerRowIndex + 1);
    const totalRow = dataRows.find((row) => isTotalRow(row));
    if (totalRow) {
      const total = parseMetricNumber(totalRow[accruedPlusIndex]);
      return Number.isFinite(total) && total > 0 ? total : null;
    }

    const total = dataRows.reduce((sum, row) => {
      if (!hasAnyCellValue(row) || isTotalRow(row)) return sum;
      return sum + parseMetricNumber(row[accruedPlusIndex]);
    }, 0);
    return total > 0 ? total : null;
  }

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseMetricNumber(
      summary.personalOrdersAfterDiscount ?? summary.ordersSummary?.personalOrdersAfterDiscount
    );
  }

  function getServiceOrdersTotal(summary = {}) {
    const movementAccruedTotal = getMovementAccruedPlusTotalFromState();
    if (Number.isFinite(movementAccruedTotal) && movementAccruedTotal > 0) return movementAccruedTotal;
    return parseMetricNumber(summary.totalOrders);
  }

  function calculateTopMetricPayable(summary = {}) {
    const serviceOrdersTotal = getServiceOrdersTotal(summary);
    const totalPaid = Math.abs(parseMetricNumber(summary.totalPaid));
    const personalOrdersAfterDiscount = getPersonalOrdersAfterDiscount(summary);
    return serviceOrdersTotal * PAYABLE_SHARE_RATE - totalPaid + personalOrdersAfterDiscount;
  }

  function formatMetricNumber(value) {
    if (typeof formatSheetNumber === "function") return formatSheetNumber(value);
    return String(Math.round((Number(value) || 0) * 10000) / 10000).replace(".", ",");
  }

  function ensurePersonalOrdersBadge() {
    if (typeof document === "undefined") return null;
    const existing = document.getElementById(BADGE_ID);
    if (existing) return existing;
    const metricTransfers = document.getElementById("metricTransfers");
    const metricCard = metricTransfers?.closest?.(".metric");
    if (!metricCard?.insertAdjacentHTML) return null;
    metricCard.insertAdjacentHTML(
      "beforeend",
      '<div class="metric-sub"><span class="metric-sub-btn accent" id="metricPersonalOrdersAfterDiscount" title="Personal orders after discount">Мои заказы: 0</span></div>'
    );
    return document.getElementById(BADGE_ID);
  }

  function updatePersonalOrdersBadge(summary = {}) {
    const badge = ensurePersonalOrdersBadge();
    if (!badge) return;
    badge.textContent = `Мои заказы: ${formatMetricNumber(getPersonalOrdersAfterDiscount(summary))}`;
  }

  function patchBuildTopMetricsSummary() {
    if (typeof buildTopMetricsSummary !== "function") return false;
    if (buildTopMetricsSummary.__ezohataPayableSharePatched) return true;

    const originalBuildTopMetricsSummary = buildTopMetricsSummary;
    const patchedBuildTopMetricsSummary = function patchedBuildTopMetricsSummary(...args) {
      const summary = originalBuildTopMetricsSummary.apply(this, args) || {};
      const grossTotalOrdersIncludingPersonal = parseMetricNumber(summary.totalOrders);
      const serviceOrdersTotal = getServiceOrdersTotal(summary);
      const personalOrdersAfterDiscount = getPersonalOrdersAfterDiscount(summary);
      const payable = calculateTopMetricPayable(summary);
      const nextSummary = {
        ...summary,
        grossTotalOrdersIncludingPersonal,
        serviceOrdersTotal,
        personalOrdersAfterDiscount,
        totalOrders: serviceOrdersTotal,
        total: payable,
        payable,
        payableShare: payable,
        payableShareRate: PAYABLE_SHARE_RATE,
        payableFormula: "serviceOrdersTotal * 0.7 - abs(totalPaid) + personalOrdersAfterDiscount"
      };
      updatePersonalOrdersBadge(nextSummary);
      return nextSummary;
    };

    patchedBuildTopMetricsSummary.__ezohataPayableSharePatched = true;
    patchedBuildTopMetricsSummary.__ezohataOriginalBuildTopMetricsSummary = originalBuildTopMetricsSummary;

    buildTopMetricsSummary = patchedBuildTopMetricsSummary;
    if (typeof window !== "undefined") {
      window.buildTopMetricsSummary = patchedBuildTopMetricsSummary;
    }
    return true;
  }

  patchBuildTopMetricsSummary();

  if (typeof window !== "undefined") {
    window.EzohataTopMetricPayableShareFix = {
      PAYABLE_SHARE_RATE,
      calculateTopMetricPayable,
      getMovementAccruedPlusTotalFromState,
      getPersonalOrdersAfterDiscount,
      getServiceOrdersTotal,
      updatePersonalOrdersBadge,
      patchBuildTopMetricsSummary
    };
  }
})();