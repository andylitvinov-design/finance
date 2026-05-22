// ============================================================
// TOP METRIC PAYABLE SHARE FIX
// ============================================================

(function patchTopMetricPayableShare() {
  const BADGE_ID = "metricPersonalOrdersAfterDiscount";
  const DEFAULT_PERCENT_RATE = 3;

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

  function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  }

  function buildOrdersPaymentSummary(summary = {}) {
    const ordersAccruedWithPercent = parseMetricNumber(
      summary.ordersAccruedWithPercent ??
      summary.totalOrders ??
      summary.totalOrdersPlusPercent
    );
    const totalPaid = Math.abs(parseMetricNumber(summary.totalPaid));
    const myOrdersDiscounted = getPersonalOrdersAfterDiscount(summary);
    const totalAccrued = hasOwn(summary, "totalAccrued")
      ? parseMetricNumber(summary.totalAccrued)
      : ordersAccruedWithPercent + myOrdersDiscounted;
    const remainingToPay = totalAccrued - totalPaid;
    const percentRate = parseMetricNumber(summary.percentRate || DEFAULT_PERCENT_RATE);
    return {
      ordersAccruedWithPercent,
      percentRate,
      myOrdersDiscounted,
      totalAccrued,
      totalPaid,
      remainingToPay,
      payable: remainingToPay,
      payableFormula: "totalAccrued - abs(totalPaid)"
    };
  }

  function calculateTopMetricPayable(summary = {}) {
    return buildOrdersPaymentSummary(summary).remainingToPay;
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
      const canonical = buildOrdersPaymentSummary(summary);
      const nextSummary = {
        ...summary,
        ordersPaymentSummary: canonical,
        ordersAccruedWithPercent: canonical.ordersAccruedWithPercent,
        percentRate: canonical.percentRate,
        personalOrdersAfterDiscount: canonical.myOrdersDiscounted,
        total: canonical.remainingToPay,
        payable: canonical.remainingToPay,
        payableShare: canonical.remainingToPay,
        payableFormula: canonical.payableFormula
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
      DEFAULT_PERCENT_RATE,
      buildOrdersPaymentSummary,
      calculateTopMetricPayable,
      getPersonalOrdersAfterDiscount,
      updatePersonalOrdersBadge,
      patchBuildTopMetricsSummary
    };
  }
})();
