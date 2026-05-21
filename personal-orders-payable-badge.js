// ============================================================
// PERSONAL ORDERS PAYABLE BADGE
// ============================================================

(function patchPersonalOrdersPayableBadge() {
  function parseBadgeNumber(value) {
    if (typeof parseLooseNumber === "function") {
      const parsed = parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(String(value ?? "").trim().replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatBadgeNumber(value) {
    if (typeof formatSheetNumber === "function") return formatSheetNumber(value, 4);
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseBadgeNumber(
      summary.personalOrdersAfterDiscount ??
      summary.ordersSummary?.personalOrdersAfterDiscount ??
      0
    );
  }

  function updatePersonalOrdersPayableBadge(summary = {}) {
    const node = (typeof elements !== "undefined" && elements.metricPersonalOrdersAfterDiscount) ||
      (typeof document !== "undefined" ? document.getElementById("metricPersonalOrdersAfterDiscount") : null);
    if (!node) return false;
    const personalOrdersAfterDiscount = getPersonalOrdersAfterDiscount(summary);
    node.textContent = `Мои личные: ${formatBadgeNumber(personalOrdersAfterDiscount)}`;
    return true;
  }

  function patchRenderMetrics() {
    if (typeof renderMetrics !== "function") return false;
    if (renderMetrics.__ezohataPersonalOrdersBadgePatched) return true;

    const originalRenderMetrics = renderMetrics;
    const patchedRenderMetrics = function patchedRenderMetrics(...args) {
      const result = originalRenderMetrics.apply(this, args);
      const summary = typeof buildTopMetricsSummary === "function" ? buildTopMetricsSummary() : {};
      updatePersonalOrdersPayableBadge(summary);
      return result;
    };

    patchedRenderMetrics.__ezohataPersonalOrdersBadgePatched = true;
    patchedRenderMetrics.__ezohataOriginalRenderMetrics = originalRenderMetrics;

    renderMetrics = patchedRenderMetrics;
    if (typeof window !== "undefined") {
      window.renderMetrics = patchedRenderMetrics;
    }
    return true;
  }

  patchRenderMetrics();

  if (typeof window !== "undefined") {
    window.EzohataPersonalOrdersPayableBadge = {
      getPersonalOrdersAfterDiscount,
      updatePersonalOrdersPayableBadge,
      patchRenderMetrics
    };
  }
})();
