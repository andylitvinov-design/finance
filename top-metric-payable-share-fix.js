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

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseMetricNumber(
      summary.personalOrdersAfterDiscount ?? summary.ordersSummary?.personalOrdersAfterDiscount
    );
  }

  function calculateTopMetricPayable(summary = {}) {
    const totalOrders = parseMetricNumber(summary.totalOrders);
    const totalPaid = Math.abs(parseMetricNumber(summary.totalPaid));
    const personalOrdersAfterDiscount = getPersonalOrdersAfterDiscount(summary);
    return totalOrders * PAYABLE_SHARE_RATE - totalPaid + personalOrdersAfterDiscount;
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
      const personalOrdersAfterDiscount = getPersonalOrdersAfterDiscount(summary);
      const payable = calculateTopMetricPayable(summary);
      const nextSummary = {
        ...summary,
        personalOrdersAfterDiscount,
        total: payable,
        payable,
        payableShare: payable,
        payableShareRate: PAYABLE_SHARE_RATE,
        payableFormula: "totalOrders * 0.7 - abs(totalPaid) + personalOrdersAfterDiscount"
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
      getPersonalOrdersAfterDiscount,
      updatePersonalOrdersBadge,
      patchBuildTopMetricsSummary
    };
  }
})();
