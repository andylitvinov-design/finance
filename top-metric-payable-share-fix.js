// ============================================================
// TOP METRIC PAYABLE SHARE FIX
// ============================================================

(function patchTopMetricPayableShare() {
  const PAYABLE_SHARE_RATE = 0.3;

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

  function calculateTopMetricPayable(summary = {}) {
    const totalOrders = parseMetricNumber(summary.totalOrders);
    const totalPaid = parseMetricNumber(summary.totalPaid);
    return totalOrders * PAYABLE_SHARE_RATE - totalPaid;
  }

  function patchBuildTopMetricsSummary() {
    if (typeof buildTopMetricsSummary !== "function") return false;
    if (buildTopMetricsSummary.__ezohataPayableSharePatched) return true;

    const originalBuildTopMetricsSummary = buildTopMetricsSummary;
    const patchedBuildTopMetricsSummary = function patchedBuildTopMetricsSummary(...args) {
      const summary = originalBuildTopMetricsSummary.apply(this, args) || {};
      const payable = calculateTopMetricPayable(summary);
      return {
        ...summary,
        total: payable,
        payable,
        payableShare: payable,
        payableShareRate: PAYABLE_SHARE_RATE,
        payableFormula: "totalOrders * 0.3 - totalPaid"
      };
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
      patchBuildTopMetricsSummary
    };
  }
})();
