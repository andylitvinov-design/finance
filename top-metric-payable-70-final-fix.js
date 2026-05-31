// Final UI-only payable correction: Оплатить = 70% of order total + personal orders - paid.
// Scope: top metric DOM only. Does not change Ledger/provider/balance semantics.
(function initTopMetricPayable70FinalFix(root) {
  "use strict";

  const RETRY_DELAYS_MS = [0, 120, 400, 1000, 2200, 5000, 8000];
  const PAYABLE_ORDER_SHARE_RATE = 0.7;

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatNumber(value) {
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value, 4);
    return String(Math.round((Number(value) || 0) * 10000) / 10000).replace(".", ",");
  }

  function getNode(id) {
    return root.document?.getElementById?.(id) || null;
  }

  function buildSummary() {
    return typeof root.buildTopMetricsSummary === "function" ? (root.buildTopMetricsSummary() || {}) : {};
  }

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseNumber(
      summary.personalOrdersAfterDiscount ??
      summary.ordersSummary?.personalOrdersAfterDiscount ??
      getNode("metricPersonalOrdersAfterDiscount")?.textContent ??
      0
    );
  }

  function getOrderTotal(summary = {}) {
    return parseNumber(
      summary.ordersAccruedWithPercent ??
      summary.totalOrdersPlusPercent ??
      summary.totalOrders ??
      getNode("metricPeriod")?.textContent ??
      0
    );
  }

  function getPaid(summary = {}) {
    const paidFromDom = parseNumber(getNode("metricBalances")?.textContent || "");
    if (paidFromDom) return Math.abs(paidFromDom);
    return Math.abs(parseNumber(summary.totalPaid));
  }

  function calculatePayable70(summary = buildSummary()) {
    const orderTotal = getOrderTotal(summary);
    const personalOrders = getPersonalOrdersAfterDiscount(summary);
    const paid = getPaid(summary);
    return orderTotal * PAYABLE_ORDER_SHARE_RATE + personalOrders - paid;
  }

  function syncPayable70() {
    const node = getNode("metricTransfers");
    if (!node) return false;
    const summary = buildSummary();
    const payable = calculatePayable70(summary);
    if (!Number.isFinite(payable)) return false;
    node.textContent = formatNumber(payable);
    node.dataset.payableFormula = "ordersAccruedWithPercent * 0.7 + personalOrdersAfterDiscount - paid";
    node.dataset.displaySource = "topMetricPayable70FinalFix";
    return true;
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__topMetricPayable70FinalPatched) return false;
    const original = root.renderMetrics;
    const patched = function renderMetricsWithPayable70(...args) {
      const result = original.apply(this, args);
      root.setTimeout?.(syncPayable70, 0);
      return result;
    };
    patched.__topMetricPayable70FinalPatched = true;
    patched.__original = original;
    root.renderMetrics = patched;
    renderMetrics = patched;
    return true;
  }

  function scheduleSync() {
    RETRY_DELAYS_MS.forEach((delay) => root.setTimeout?.(syncPayable70, delay));
  }

  function bindTriggers() {
    const doc = root.document;
    const body = doc?.body;
    if (!body || body.dataset.topMetricPayable70FinalTriggersBound === "true") return false;
    body.dataset.topMetricPayable70FinalTriggersBound = "true";
    ["calculateButton", "todayButton", "weekButton", "balanceLauncherButton", "remaindersLauncherButton"].forEach((id) => {
      doc.getElementById?.(id)?.addEventListener?.("click", scheduleSync);
    });
    ["startDate", "endDate"].forEach((id) => {
      const input = doc.getElementById?.(id);
      input?.addEventListener?.("input", scheduleSync);
      input?.addEventListener?.("change", scheduleSync);
    });
    return true;
  }

  function start() {
    patchRenderMetrics();
    bindTriggers();
    scheduleSync();
  }

  start();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else root.setTimeout?.(start, 0);

  root.EzohataTopMetricPayable70FinalFix = {
    PAYABLE_ORDER_SHARE_RATE,
    calculatePayable70,
    syncPayable70,
    patchRenderMetrics,
    scheduleSync,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
