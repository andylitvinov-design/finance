// ============================================================
// TOP METRIC PAYABLE SHARE FIX
// ============================================================

(function patchTopMetricPayableShare() {
  const root = typeof window !== "undefined" ? window : globalThis;
  const BADGE_ID = "metricPersonalOrdersAfterDiscount";
  const DEFAULT_PERCENT_RATE = 3;
  const PAYABLE_ORDER_SHARE_RATE = 0.7;

  function parseMetricNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(",", ".");
    const parsed = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatMetricNumber(value) {
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value, 4);
    return String(Math.round((Number(value) || 0) * 10000) / 10000).replace(".", ",");
  }

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseMetricNumber(
      summary.personalOrdersAfterDiscount ?? summary.ordersSummary?.personalOrdersAfterDiscount
    );
  }

  function getPersonalOrdersGross(summary = {}) {
    return parseMetricNumber(
      summary.personalOrdersGross ??
      summary.ordersSummary?.personalOrdersGross ??
      summary.personalOrdersBeforeDiscount ??
      summary.ordersSummary?.personalOrdersBeforeDiscount ??
      summary.grossPersonalOrders ??
      getPersonalOrdersAfterDiscount(summary)
    );
  }

  function buildOrdersPaymentSummary(summary = {}) {
    const ordersAccruedWithPercent = parseMetricNumber(
      summary.ordersAccruedWithPercent ??
      summary.totalOrdersPlusPercent ??
      summary.totalOrders
    );
    const totalPaid = Math.abs(parseMetricNumber(summary.totalPaid));
    const myOrdersDiscounted = getPersonalOrdersAfterDiscount(summary);
    const myOrdersGross = getPersonalOrdersGross(summary);
    const ordersPayableShare = ordersAccruedWithPercent * PAYABLE_ORDER_SHARE_RATE;
    const totalAccrued = ordersPayableShare + myOrdersDiscounted;
    const remainingToPay = totalAccrued - totalPaid;
    const percentRate = parseMetricNumber(summary.percentRate || DEFAULT_PERCENT_RATE);
    return {
      ordersAccruedWithPercent,
      ordersPayableShare,
      payableOrderShareRate: PAYABLE_ORDER_SHARE_RATE,
      percentRate,
      myOrdersGross,
      myOrdersDiscounted,
      totalAccrued,
      totalPaid,
      remainingToPay,
      payable: remainingToPay,
      payableFormula: "ordersAccruedWithPercent * 0.7 + myOrdersDiscounted - abs(totalPaid)"
    };
  }

  function calculateTopMetricPayable(summary = {}) {
    return buildOrdersPaymentSummary(summary).remainingToPay;
  }

  function getMetricNumber(id) {
    const node = root.document?.getElementById?.(id);
    return parseMetricNumber(node?.textContent || "");
  }

  function ensurePersonalOrdersBadge() {
    if (typeof root.document === "undefined") return null;
    const existing = root.document.getElementById(BADGE_ID);
    if (existing) return existing;
    const metricTransfers = root.document.getElementById("metricTransfers");
    const metricCard = metricTransfers?.closest?.(".metric");
    if (!metricCard?.insertAdjacentHTML) return null;
    metricCard.insertAdjacentHTML(
      "beforeend",
      '<div class="metric-sub"><span class="metric-sub-btn accent" id="metricPersonalOrdersAfterDiscount" title="Personal orders after discount">Мои заказы: 0</span></div>'
    );
    return root.document.getElementById(BADGE_ID);
  }

  function updatePersonalOrdersBadge(summary = {}) {
    const badge = ensurePersonalOrdersBadge();
    if (!badge) return;
    badge.textContent = `Мои заказы: ${formatMetricNumber(getPersonalOrdersAfterDiscount(summary))}`;
  }

  function syncPayableTopCardFromDom() {
    const node = root.document?.getElementById?.("metricTransfers");
    if (!node) return false;
    const ordersAccruedWithPercent = getMetricNumber("metricPeriod");
    const totalPaid = Math.abs(getMetricNumber("metricBalances"));
    const myOrdersDiscounted = getMetricNumber("metricPersonalOrdersAfterDiscount");
    if (!ordersAccruedWithPercent && !totalPaid && !myOrdersDiscounted) return false;
    const value = ordersAccruedWithPercent * PAYABLE_ORDER_SHARE_RATE + myOrdersDiscounted - totalPaid;
    const nextText = formatMetricNumber(value);
    if (node.textContent === nextText) return false;
    node.textContent = nextText;
    node.dataset.payableFormula = "ordersAccruedWithPercent * 0.7 + personalOrdersAfterDiscount - totalPaid";
    node.dataset.totalPaidSource = "metricBalances";
    return true;
  }

  function syncRemaindersTopCard() {
    const node = root.document?.getElementById?.("metricProfit");
    const api = root.EzohataRemaindersSummaryPopup;
    if (!node || typeof api?.buildRemaindersSummary !== "function") return false;
    const summary = api.buildRemaindersSummary(root.state || {});
    const total = Number(summary?.totals?.closingUsd || 0);
    if (!Number.isFinite(total)) return false;
    const nextText = `Остатки: ${formatMetricNumber(total)}`;
    if (node.textContent === nextText) return false;
    node.textContent = nextText;
    node.title = "Сумма текущих USD-остатков по всем каналам";
    node.dataset.displaySource = "remaindersSummary.totals.closingUsd";
    return true;
  }

  function syncTopCardsFromDom() {
    syncPayableTopCardFromDom();
    syncRemaindersTopCard();
  }

  function patchBuildTopMetricsSummary() {
    if (typeof root.buildTopMetricsSummary !== "function") return false;
    if (root.buildTopMetricsSummary.__ezohataPayableSharePatched) return true;

    const originalBuildTopMetricsSummary = root.buildTopMetricsSummary;
    const patchedBuildTopMetricsSummary = function patchedBuildTopMetricsSummary(...args) {
      const summary = originalBuildTopMetricsSummary.apply(this, args) || {};
      const canonical = buildOrdersPaymentSummary(summary);
      const nextSummary = {
        ...summary,
        ordersPaymentSummary: canonical,
        ordersAccruedWithPercent: canonical.ordersAccruedWithPercent,
        ordersPayableShare: canonical.ordersPayableShare,
        payableOrderShareRate: canonical.payableOrderShareRate,
        totalOrders: canonical.ordersAccruedWithPercent,
        percentRate: canonical.percentRate,
        personalOrdersGross: canonical.myOrdersGross,
        personalOrdersAfterDiscount: canonical.myOrdersDiscounted,
        totalAccrued: canonical.totalAccrued,
        total: canonical.remainingToPay,
        payable: canonical.remainingToPay,
        payableShare: canonical.remainingToPay,
        payableFormula: canonical.payableFormula
      };
      updatePersonalOrdersBadge(nextSummary);
      root.setTimeout?.(syncTopCardsFromDom, 0);
      return nextSummary;
    };

    patchedBuildTopMetricsSummary.__ezohataPayableSharePatched = true;
    patchedBuildTopMetricsSummary.__ezohataOriginalBuildTopMetricsSummary = originalBuildTopMetricsSummary;

    root.buildTopMetricsSummary = patchedBuildTopMetricsSummary;
    buildTopMetricsSummary = patchedBuildTopMetricsSummary;
    return true;
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__ezohataPayableShareDomPatched) return false;
    const originalRenderMetrics = root.renderMetrics;
    root.renderMetrics = function renderMetricsWithPayableShareCards(...args) {
      const result = originalRenderMetrics.apply(this, args);
      root.setTimeout?.(syncTopCardsFromDom, 0);
      return result;
    };
    root.renderMetrics.__ezohataPayableShareDomPatched = true;
    return true;
  }

  function installDomObserver() {
    const target = root.document?.querySelector?.(".metrics") || root.document?.body;
    if (!target || target.dataset?.payableShareCardsObserver === "true") return;
    target.dataset.payableShareCardsObserver = "true";
    const Observer = root.MutationObserver || globalThis.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(() => syncTopCardsFromDom());
    observer.observe(target, { childList: true, characterData: true, subtree: true });
  }

  function install() {
    patchBuildTopMetricsSummary();
    patchRenderMetrics();
    installDomObserver();
    root.setTimeout?.(syncTopCardsFromDom, 0);
  }

  install();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", install);
  else root.setTimeout?.(install, 0);
  root.setTimeout?.(install, 50);
  root.setTimeout?.(install, 250);

  root.EzohataTopMetricPayableShareFix = {
    DEFAULT_PERCENT_RATE,
    PAYABLE_ORDER_SHARE_RATE,
    buildOrdersPaymentSummary,
    calculateTopMetricPayable,
    getPersonalOrdersAfterDiscount,
    getPersonalOrdersGross,
    updatePersonalOrdersBadge,
    syncPayableTopCardFromDom,
    syncRemaindersTopCard,
    syncTopCardsFromDom,
    patchBuildTopMetricsSummary,
    patchRenderMetrics
  };
})();
