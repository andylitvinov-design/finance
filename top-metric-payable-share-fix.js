// ============================================================
// TOP METRIC PAYABLE SHARE FIX
// ============================================================

(function patchTopMetricPayableShare() {
  const root = typeof window !== "undefined" ? window : globalThis;
  const BADGE_ID = "metricPersonalOrdersAfterDiscount";
  const DEFAULT_PERCENT_RATE = 3;
  const PAYABLE_ORDER_SHARE_RATE = 0.7;
  const REMAINDERS_LIVE_REFRESH_THROTTLE_MS = 30000;
  let latestTopMetricsSummary = null;
  let latestLiveRemaindersRefreshMs = 0;
  let latestLiveRemaindersRequestId = 0;

  function parseMetricNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".");
    const parsed = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatMetricNumber(value) {
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value, 4);
    return String(Math.round((Number(value) || 0) * 10000) / 10000).replace(".", ",");
  }

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseMetricNumber(summary.personalOrdersAfterDiscount ?? summary.ordersSummary?.personalOrdersAfterDiscount);
  }

  function getPersonalOrdersGross(summary = {}) {
    return parseMetricNumber(
      summary.personalOrdersGross ?? summary.ordersSummary?.personalOrdersGross ?? summary.personalOrdersBeforeDiscount ??
      summary.ordersSummary?.personalOrdersBeforeDiscount ?? summary.grossPersonalOrders ?? getPersonalOrdersAfterDiscount(summary)
    );
  }

  function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  }

  function buildOrdersPaymentSummary(summary = {}) {
    const ordersAccruedWithPercent = parseMetricNumber(summary.ordersAccruedWithPercent ?? summary.totalOrdersPlusPercent ?? summary.totalOrders);
    const totalPaid = Math.abs(parseMetricNumber(summary.totalPaid));
    const myOrdersDiscounted = getPersonalOrdersAfterDiscount(summary);
    const myOrdersGross = getPersonalOrdersGross(summary);
    const ordersPayableShare = ordersAccruedWithPercent * PAYABLE_ORDER_SHARE_RATE;
    const totalAccrued = hasOwn(summary, "totalAccrued") ? parseMetricNumber(summary.totalAccrued) : ordersAccruedWithPercent + myOrdersDiscounted;
    const remainingToPay = totalAccrued - totalPaid;
    const percentRate = parseMetricNumber(summary.percentRate || DEFAULT_PERCENT_RATE);
    return { ordersAccruedWithPercent, ordersPayableShare, payableOrderShareRate: PAYABLE_ORDER_SHARE_RATE, percentRate, myOrdersGross, myOrdersDiscounted, totalAccrued, totalPaid, remainingToPay, payable: remainingToPay, payableFormula: "totalAccrued - abs(totalPaid)" };
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
    metricCard.insertAdjacentHTML("beforeend", '<div class="metric-sub"><span class="metric-sub-btn accent" id="metricPersonalOrdersAfterDiscount" title="Personal orders after discount">Мои заказы: 0</span></div>');
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
    const value = ordersAccruedWithPercent + myOrdersDiscounted - totalPaid;
    const nextText = formatMetricNumber(value);
    if (node.textContent === nextText) return false;
    node.textContent = nextText;
    node.dataset.payableFormula = "ordersAccruedWithPercent + personalOrdersAfterDiscount - totalPaid";
    node.dataset.totalPaidSource = "metricBalances";
    return true;
  }

  function syncMyProfitTopCard() {
    const node = root.document?.getElementById?.("metricMyCosts");
    if (!node) return false;
    const profit = parseMetricNumber(latestTopMetricsSummary?.profit);
    const nextText = `Моя прибыль: ${formatMetricNumber(profit)}`;
    if (node.textContent === nextText) return false;
    node.textContent = nextText;
    node.title = "Моя прибыль за выбранный период";
    node.dataset.displaySource = "buildTopMetricsSummary.profit";
    return true;
  }

  function applyRemaindersTopCardTotal(node, total, source) {
    if (!node || !Number.isFinite(total)) return false;
    const nextText = `Остатки: ${formatMetricNumber(total)}`;
    if (node.textContent === nextText && node.dataset.displaySource === source) return false;
    node.textContent = nextText;
    node.title = "Сумма текущих USD-остатков по всем каналам";
    node.dataset.displaySource = source;
    return true;
  }

  function pickFirstNumber(row, fields = []) {
    for (const field of fields) {
      const raw = row?.[field];
      if (raw === null || raw === undefined || raw === "") continue;
      const parsed = parseMetricNumber(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function sumSelectedDateSnapshotUsdRows(snapshot = {}) {
    const rows = Array.isArray(snapshot?.selected_date_rows) ? snapshot.selected_date_rows : [];
    return rows.reduce((sum, row) => {
      const explicitUsd = pickFirstNumber(row, ["amount_usd", "balance_usd", "closing_amount_usd", "closingUsd", "end_amount_usd", "endUsd", "confirmed_end_usd"]);
      if (explicitUsd !== null) return sum + explicitUsd;
      const currency = String(row?.currency || row?.balance_currency || row?.account_currency || "").trim().toUpperCase();
      if (currency === "USD" || currency === "USDT" || currency === "USDC") {
        const amount = pickFirstNumber(row, ["amount", "balance", "closing_amount", "closing", "value"]);
        if (amount !== null) return sum + amount;
      }
      return sum;
    }, 0);
  }

  function firstNonZeroCandidate(candidates = []) {
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === "") continue;
      const total = parseMetricNumber(candidate);
      if (Number.isFinite(total) && total !== 0) return total;
    }
    return null;
  }

  function extractRemaindersClosingUsdWithSource(summary = {}) {
    const canonicalTotal = firstNonZeroCandidate([
      summary?.periodReconciliation?.total_usd_row?.confirmed_end_usd,
      summary?.periodReconciliation?.total_usd_row?.closing_usd,
      summary?.periodReconciliation?.total_usd_row?.end_usd,
      summary?.selectedDateSnapshot?.total_usd,
      summary?.selectedDateSnapshot?.closing_usd,
      summary?.selectedDateSnapshot?.confirmed_end_usd,
      summary?.visibleUsdTotals?.closingUsd,
    ]);
    if (canonicalTotal !== null) return { total: canonicalTotal, source: "canonical" };
    const selectedDateRowsTotal = sumSelectedDateSnapshotUsdRows(summary?.selectedDateSnapshot || {});
    if (Number.isFinite(selectedDateRowsTotal) && selectedDateRowsTotal !== 0) return { total: selectedDateRowsTotal, source: "selectedDateRowsUsd" };
    const localTotal = firstNonZeroCandidate([summary?.totals?.closingUsd]);
    return { total: localTotal !== null ? localTotal : 0, source: localTotal !== null ? "localTotals" : "none" };
  }

  function extractRemaindersClosingUsd(summary = {}) {
    return extractRemaindersClosingUsdWithSource(summary).total;
  }

  function shouldFetchLiveRemainders(node) {
    if (node?.dataset?.remaindersLivePending === "true") return false;
    const now = Number(root.Date?.now?.() || Date.now());
    if (latestLiveRemaindersRefreshMs && now - latestLiveRemaindersRefreshMs < REMAINDERS_LIVE_REFRESH_THROTTLE_MS) return false;
    latestLiveRemaindersRefreshMs = now;
    return true;
  }

  function refreshRemaindersTopCardFromLive(node, api) {
    if (!node || typeof api?.buildLiveRemaindersSummary !== "function" || !shouldFetchLiveRemainders(node)) return false;
    node.dataset.remaindersLivePending = "true";
    const requestId = ++latestLiveRemaindersRequestId;
    Promise.resolve(api.buildLiveRemaindersSummary())
      .then((summary) => {
        if (requestId !== latestLiveRemaindersRequestId) return;
        const result = extractRemaindersClosingUsdWithSource(summary);
        if (result.source === "localTotals") {
          node.dataset.remaindersLiveLocalTotal = formatMetricNumber(result.total);
          return;
        }
        applyRemaindersTopCardTotal(node, result.total, `remaindersSummary.live.${result.source}`);
      })
      .catch((error) => {
        node.dataset.remaindersLiveError = String(error?.message || error).slice(0, 300);
      })
      .finally(() => {
        if (requestId === latestLiveRemaindersRequestId && node.dataset) node.dataset.remaindersLivePending = "false";
      });
    return true;
  }

  function syncRemaindersTopCard() {
    const node = root.document?.getElementById?.("metricProfit");
    const api = root.EzohataRemaindersSummaryPopup;
    if (!node) return false;
    let updated = false;
    if (typeof api?.buildRemaindersSummary === "function") {
      const summary = api.buildRemaindersSummary(root.state || {});
      const result = extractRemaindersClosingUsdWithSource(summary);
      if (result.source === "localTotals") {
        node.dataset.remaindersLocalTotal = formatMetricNumber(result.total);
      } else if (Number.isFinite(result.total) && (result.total !== 0 || (summary?.rows || []).length > 0)) {
        updated = applyRemaindersTopCardTotal(node, result.total, `remaindersSummary.local.${result.source}`) || updated;
      }
    }
    refreshRemaindersTopCardFromLive(node, api);
    return updated;
  }

  function syncTopCardsFromDom() {
    if (typeof root.EzohataTopMetricCanonicalFinalizer?.syncTopMetrics === "function") {
      return root.EzohataTopMetricCanonicalFinalizer.syncTopMetrics();
    }
    syncPayableTopCardFromDom();
    syncMyProfitTopCard();
    syncRemaindersTopCard();
  }

  function patchBuildTopMetricsSummary() {
    if (typeof root.buildTopMetricsSummary !== "function") return false;
    if (root.buildTopMetricsSummary.__ezohataPayableSharePatched) return true;
    const originalBuildTopMetricsSummary = root.buildTopMetricsSummary;
    const patchedBuildTopMetricsSummary = function patchedBuildTopMetricsSummary(...args) {
      const summary = originalBuildTopMetricsSummary.apply(this, args) || {};
      const canonical = buildOrdersPaymentSummary(summary);
      const nextSummary = { ...summary, ordersPaymentSummary: canonical, ordersAccruedWithPercent: canonical.ordersAccruedWithPercent, ordersPayableShare: canonical.ordersPayableShare, payableOrderShareRate: canonical.payableOrderShareRate, totalOrders: canonical.ordersAccruedWithPercent, percentRate: canonical.percentRate, personalOrdersGross: canonical.myOrdersGross, personalOrdersAfterDiscount: canonical.myOrdersDiscounted, totalAccrued: canonical.totalAccrued, total: canonical.remainingToPay, payable: canonical.remainingToPay, payableShare: canonical.remainingToPay, payableFormula: canonical.payableFormula };
      latestTopMetricsSummary = nextSummary;
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

  root.EzohataTopMetricPayableShareFix = { DEFAULT_PERCENT_RATE, PAYABLE_ORDER_SHARE_RATE, REMAINDERS_LIVE_REFRESH_THROTTLE_MS, buildOrdersPaymentSummary, calculateTopMetricPayable, getPersonalOrdersAfterDiscount, getPersonalOrdersGross, updatePersonalOrdersBadge, applyRemaindersTopCardTotal, pickFirstNumber, sumSelectedDateSnapshotUsdRows, firstNonZeroCandidate, extractRemaindersClosingUsdWithSource, extractRemaindersClosingUsd, refreshRemaindersTopCardFromLive, syncPayableTopCardFromDom, syncMyProfitTopCard, syncRemaindersTopCard, syncTopCardsFromDom, patchBuildTopMetricsSummary, patchRenderMetrics };
})();
