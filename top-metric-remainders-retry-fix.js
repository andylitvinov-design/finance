// Ensures the top-card Остатки badge is refreshed from live remainders data after date/calculation changes.
// Scope: UI top metric only. Does not change balance/provider/ledger semantics.
(function initTopMetricRemaindersRetryFix(root) {
  "use strict";

  const RETRY_DELAYS_MS = [0, 250, 900, 1800, 3500, 7000];
  const BOUND_FLAG = "topMetricRemaindersRetryBound";

  function getBadgeNode() {
    return root.document?.getElementById?.("metricProfit") || null;
  }

  function getTopMetricApi() {
    return root.EzohataTopMetricPayableShareFix || null;
  }

  function getRemaindersApi() {
    return root.EzohataRemaindersSummaryPopup || null;
  }

  function applyLiveSummary(summary) {
    const node = getBadgeNode();
    const topApi = getTopMetricApi();
    if (!node || typeof topApi?.extractRemaindersClosingUsd !== "function" || typeof topApi?.applyRemaindersTopCardTotal !== "function") {
      return false;
    }
    const total = topApi.extractRemaindersClosingUsd(summary || {});
    if (!Number.isFinite(total) || total === 0) return false;
    return topApi.applyRemaindersTopCardTotal(node, total, "remaindersRetry.live.closingUsd");
  }

  function refreshOnce() {
    const node = getBadgeNode();
    const remaindersApi = getRemaindersApi();
    if (!node || typeof remaindersApi?.buildLiveRemaindersSummary !== "function") return false;
    node.dataset.remaindersRetryPending = "true";
    Promise.resolve(remaindersApi.buildLiveRemaindersSummary())
      .then((summary) => {
        applyLiveSummary(summary);
      })
      .catch((error) => {
        node.dataset.remaindersRetryError = String(error?.message || error).slice(0, 300);
      })
      .finally(() => {
        node.dataset.remaindersRetryPending = "false";
      });
    return true;
  }

  function refreshSoon() {
    RETRY_DELAYS_MS.forEach((delay) => root.setTimeout?.(refreshOnce, delay));
  }

  function bindRefreshTriggers() {
    const doc = root.document;
    const body = doc?.body;
    if (!body || body.dataset?.[BOUND_FLAG] === "true") return false;
    body.dataset[BOUND_FLAG] = "true";

    ["calculateButton", "todayButton", "weekButton", "balanceLauncherButton", "remaindersLauncherButton"].forEach((id) => {
      doc.getElementById?.(id)?.addEventListener?.("click", refreshSoon);
    });
    ["startDate", "endDate"].forEach((id) => {
      const input = doc.getElementById?.(id);
      input?.addEventListener?.("change", refreshSoon);
      input?.addEventListener?.("input", refreshSoon);
    });
    return true;
  }

  function start() {
    bindRefreshTriggers();
    refreshSoon();
  }

  start();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else root.setTimeout?.(start, 0);

  root.EzohataTopMetricRemaindersRetryFix = {
    RETRY_DELAYS_MS,
    applyLiveSummary,
    refreshOnce,
    refreshSoon,
    bindRefreshTriggers,
    start,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
