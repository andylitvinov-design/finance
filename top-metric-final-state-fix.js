// Final UI-only reconciliation for top metric cards.
// Scope: DOM/top metrics only. Does not change Ledger, provider imports, balances, or amount_net semantics.
(function initTopMetricFinalStateFix(root) {
  "use strict";

  const RETRY_DELAYS_MS = [0, 150, 500, 1200, 2500, 5000, 8000];
  let remaindersRequestId = 0;

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

  function buildCurrentSummary() {
    return typeof root.buildTopMetricsSummary === "function" ? (root.buildTopMetricsSummary() || {}) : {};
  }

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseNumber(
      summary.personalOrdersAfterDiscount ??
      summary.ordersSummary?.personalOrdersAfterDiscount ??
      0
    );
  }

  function getServicesMeTotal() {
    const layer = root.EzohataServiceInLayer;
    if (typeof layer?.collectLedgerRows !== "function" || typeof layer?.buildServiceInIncomeLookup !== "function") return 0;
    try {
      return parseNumber(layer.buildServiceInIncomeLookup(layer.collectLedgerRows())?.total);
    } catch (_error) {
      return 0;
    }
  }

  function getDuplicateTransferAmountAlreadyInPayouts(summary = {}) {
    const transferAddedBySummary = parseNumber(summary.payoutTransfersPaidUsd);
    if (!transferAddedBySummary) return 0;
    const currentAdditionalTransfer = typeof root.calculateCurrentPayoutTransferUsdTotal === "function"
      ? parseNumber(root.calculateCurrentPayoutTransferUsdTotal())
      : 0;
    if (currentAdditionalTransfer > 0.0001) return 0;
    return transferAddedBySummary;
  }

  function syncServicesBadge(summary = buildCurrentSummary()) {
    const node = getNode("metricMyServices");
    if (!node) return false;
    const summaryValue = parseNumber(summary.myServices);
    const servicesMeTotal = getServicesMeTotal();
    const value = summaryValue || servicesMeTotal;
    if (!value) return false;
    node.textContent = `Мои услуги: ${formatNumber(value)}`;
    node.dataset.displaySource = summaryValue ? "buildTopMetricsSummary.myServices" : "services_me_ledger_finalizer";
    return true;
  }

  function syncPersonalOrdersBadge(summary = buildCurrentSummary()) {
    const node = getNode("metricPersonalOrdersAfterDiscount");
    if (!node) return false;
    const value = getPersonalOrdersAfterDiscount(summary);
    node.textContent = `Мои заказы: ${formatNumber(value)}`;
    node.dataset.displaySource = "buildTopMetricsSummary.personalOrdersAfterDiscount";
    return true;
  }

  function syncPaidAndPayableCards(summary = buildCurrentSummary()) {
    const paidNode = getNode("metricBalances");
    const payableNode = getNode("metricTransfers");
    if (!paidNode && !payableNode) return false;
    const duplicateTransfer = getDuplicateTransferAmountAlreadyInPayouts(summary);
    const currentPaid = Math.abs(parseNumber(summary.totalPaid));
    const paid = duplicateTransfer ? Math.max(0, currentPaid - duplicateTransfer) : currentPaid;
    const personalOrders = getPersonalOrdersAfterDiscount(summary);
    const totalAccrued = Object.prototype.hasOwnProperty.call(summary, "totalAccrued")
      ? parseNumber(summary.totalAccrued)
      : parseNumber(summary.totalOrders) + personalOrders;
    const payable = totalAccrued - paid;

    if (paidNode && Number.isFinite(paid)) {
      paidNode.textContent = formatNumber(paid);
      paidNode.dataset.displaySource = duplicateTransfer ? "topMetricFinalizer.dedupedPaid" : "buildTopMetricsSummary.totalPaid";
      if (duplicateTransfer) paidNode.dataset.removedDuplicateTransferUsd = formatNumber(duplicateTransfer);
    }
    if (payableNode && Number.isFinite(payable)) {
      payableNode.textContent = formatNumber(payable);
      payableNode.dataset.payableFormula = "totalAccrued - paid";
      payableNode.dataset.displaySource = duplicateTransfer ? "topMetricFinalizer.dedupedPayable" : "buildTopMetricsSummary.total";
    }
    return true;
  }

  function extractRemaindersClosingUsd(summary = {}) {
    const api = root.EzohataTopMetricPayableShareFix;
    if (typeof api?.extractRemaindersClosingUsd === "function") return api.extractRemaindersClosingUsd(summary);
    const total = parseNumber(summary?.totals?.closingUsd ?? summary?.selectedDateSnapshot?.total_usd ?? 0);
    return Number.isFinite(total) ? total : 0;
  }

  function applyRemaindersBadge(total, source) {
    const node = getNode("metricProfit");
    if (!node || !Number.isFinite(total) || total === 0) return false;
    node.textContent = `Остатки: ${formatNumber(total)}`;
    node.title = "Сумма текущих USD-остатков по всем каналам";
    node.dataset.displaySource = source;
    return true;
  }

  function refreshRemaindersBadge() {
    const api = root.EzohataRemaindersSummaryPopup;
    const node = getNode("metricProfit");
    if (!node || typeof api?.buildLiveRemaindersSummary !== "function") return false;
    const requestId = ++remaindersRequestId;
    Promise.resolve(api.buildLiveRemaindersSummary())
      .then((summary) => {
        if (requestId !== remaindersRequestId) return;
        applyRemaindersBadge(extractRemaindersClosingUsd(summary), "topMetricFinalizer.liveRemainders");
      })
      .catch((error) => {
        node.dataset.remaindersFinalizerError = String(error?.message || error).slice(0, 300);
      });
    return true;
  }

  function syncTopMetricFinalState() {
    const summary = buildCurrentSummary();
    syncServicesBadge(summary);
    syncPersonalOrdersBadge(summary);
    syncPaidAndPayableCards(summary);
    refreshRemaindersBadge();
    return true;
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__topMetricFinalStatePatched) return false;
    const original = root.renderMetrics;
    const patched = function renderMetricsWithFinalState(...args) {
      const result = original.apply(this, args);
      root.setTimeout?.(syncTopMetricFinalState, 0);
      return result;
    };
    patched.__topMetricFinalStatePatched = true;
    patched.__original = original;
    root.renderMetrics = patched;
    renderMetrics = patched;
    return true;
  }

  function scheduleSync() {
    RETRY_DELAYS_MS.forEach((delay) => root.setTimeout?.(syncTopMetricFinalState, delay));
  }

  function bindTriggers() {
    const doc = root.document;
    const body = doc?.body;
    if (!body || body.dataset.topMetricFinalStateTriggersBound === "true") return false;
    body.dataset.topMetricFinalStateTriggersBound = "true";
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

  root.EzohataTopMetricFinalStateFix = {
    getServicesMeTotal,
    getDuplicateTransferAmountAlreadyInPayouts,
    syncServicesBadge,
    syncPersonalOrdersBadge,
    syncPaidAndPayableCards,
    refreshRemaindersBadge,
    syncTopMetricFinalState,
    patchRenderMetrics,
    scheduleSync,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
