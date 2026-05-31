// Canonical UI-only renderer for top metric cards.
// Scope: DOM display only. Does not mutate Ledger/provider/balance data.
(function initTopMetricCanonicalFinalizer(root) {
  "use strict";

  const PAYABLE_ORDER_SHARE_RATE = 0.7;
  const RETRY_DELAYS_MS = [0, 120, 400, 1000, 2200, 5000, 8000, 10000];
  let liveRemaindersRequestId = 0;
  let syncing = false;

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
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function getNode(id) {
    return root.document?.getElementById?.(id) || null;
  }

  function setText(node, text, dataset = {}) {
    if (!node) return false;
    let changed = false;
    if (node.textContent !== text) {
      node.textContent = text;
      changed = true;
    }
    Object.entries(dataset).forEach(([key, value]) => {
      if (!node.dataset || node.dataset[key] === value) return;
      node.dataset[key] = value;
      changed = true;
    });
    return changed;
  }

  function buildSummary() {
    const builder = root.buildTopMetricsSummary?.__ezohataOriginalBuildTopMetricsSummary || root.buildTopMetricsSummary;
    return typeof builder === "function" ? (builder() || {}) : {};
  }

  function getOrdersTotal(summary = {}) {
    return parseNumber(
      summary.ordersAccruedWithPercent ??
      summary.totalOrdersPlusPercent ??
      summary.totalOrders ??
      getNode("metricPeriod")?.textContent ??
      0
    );
  }

  function getPersonalOrdersAfterDiscount(summary = {}) {
    return parseNumber(
      summary.personalOrdersAfterDiscount ??
      summary.ordersSummary?.personalOrdersAfterDiscount ??
      getNode("metricPersonalOrdersAfterDiscount")?.textContent ??
      0
    );
  }

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase();
  }

  function findHeaderIndex(header, aliases) {
    if (typeof root.findHeaderIndexByAliases === "function") return root.findHeaderIndexByAliases(header || [], aliases || []);
    const allowed = new Set((aliases || []).map(normalizeCell));
    return (header || []).findIndex((cell) => allowed.has(normalizeCell(cell)));
  }

  function isTotalRow(row) {
    const first = normalizeCell(row?.[0]);
    return first === "итого" || first === "итого за период" || first === "всего выплат";
  }

  function calculatePayoutRowsPaidTotal() {
    const values = root.state?.data?.tabs?.payouts?.values || [];
    if (!Array.isArray(values) || values.length < 2) return 0;
    const header = values[0] || [];
    const usdIndex = findHeaderIndex(header, ["AMOUNT (USD)", "сумма в долларах", "amount_usd", "usd"]);
    if (usdIndex === -1) return 0;
    return Math.abs(values.slice(1).reduce((sum, row) => {
      if (!row || isTotalRow(row)) return sum;
      return sum + parseNumber(row[usdIndex]);
    }, 0));
  }

  function nearlyEqual(a, b) {
    return Math.abs(parseNumber(a) - parseNumber(b)) < 0.0002;
  }

  function getCanonicalPaid(summary = {}) {
    const rawPaid = Math.abs(parseNumber(summary.totalPaid));
    const duplicateTransfer = Math.abs(parseNumber(summary.payoutTransfersPaidUsd));
    if (!rawPaid || !duplicateTransfer) return rawPaid;

    const currentAdditionalTransfer = typeof root.calculateCurrentPayoutTransferUsdTotal === "function"
      ? Math.abs(parseNumber(root.calculateCurrentPayoutTransferUsdTotal()))
      : 0;
    if (currentAdditionalTransfer > 0.0001) return rawPaid;

    const dedupedPaid = Math.max(0, rawPaid - duplicateTransfer);
    const payoutRowsPaid = calculatePayoutRowsPaidTotal();
    if (payoutRowsPaid) {
      if (nearlyEqual(payoutRowsPaid, rawPaid)) return rawPaid;
      if (nearlyEqual(payoutRowsPaid, dedupedPaid)) return dedupedPaid;
    }

    const formulaBase = getOrdersTotal(summary) * PAYABLE_ORDER_SHARE_RATE + getPersonalOrdersAfterDiscount(summary);
    if (!formulaBase) return rawPaid;
    return Math.abs(formulaBase - dedupedPaid) < Math.abs(formulaBase - rawPaid) ? dedupedPaid : rawPaid;
  }

  function getServicesMeTotal() {
    const layer = root.EzohataServiceInLayer;
    if (typeof layer?.collectLedgerRows !== "function" || typeof layer?.buildServiceInIncomeLookup !== "function") return 0;
    try {
      const rows = layer.collectLedgerRows();
      return parseNumber(layer.buildServiceInIncomeLookup(rows)?.total);
    } catch (_error) {
      return 0;
    }
  }

  function extractRemaindersClosingUsd(summary = {}) {
    const api = root.EzohataTopMetricPayableShareFix;
    if (typeof api?.extractRemaindersClosingUsd === "function") return api.extractRemaindersClosingUsd(summary);
    return parseNumber(
      summary?.periodReconciliation?.total_usd_row?.confirmed_end_usd ??
      summary?.periodReconciliation?.total_usd_row?.closing_usd ??
      summary?.selectedDateSnapshot?.total_usd ??
      summary?.selectedDateSnapshot?.closing_usd ??
      summary?.totals?.closingUsd ??
      0
    );
  }

  function getLocalRemaindersClosingUsd() {
    const api = root.EzohataRemaindersSummaryPopup;
    if (typeof api?.buildRemaindersSummary !== "function") return null;
    try {
      const total = extractRemaindersClosingUsd(api.buildRemaindersSummary(root.state || {}));
      return Number.isFinite(total) ? total : null;
    } catch (_error) {
      return null;
    }
  }

  function applyRemainders(total, source) {
    if (!Number.isFinite(total)) return false;
    const node = getNode("metricProfit");
    if (node) node.title = "Сумма текущих USD-остатков по всем каналам";
    return setText(node, `Остатки: ${formatNumber(total)}`, { displaySource: source });
  }

  function refreshLiveRemainders() {
    const api = root.EzohataRemaindersSummaryPopup;
    const node = getNode("metricProfit");
    if (!node || typeof api?.buildLiveRemaindersSummary !== "function") return false;
    const requestId = ++liveRemaindersRequestId;
    Promise.resolve(api.buildLiveRemaindersSummary())
      .then((summary) => {
        if (requestId !== liveRemaindersRequestId) return;
        applyRemainders(extractRemaindersClosingUsd(summary || {}), "topMetricCanonicalFinalizer.liveRemainders");
      })
      .catch((error) => {
        if (node.dataset) node.dataset.remaindersCanonicalError = String(error?.message || error).slice(0, 300);
      });
    return true;
  }

  function syncTopMetrics() {
    if (syncing) return false;
    syncing = true;
    try {
      const summary = buildSummary();
      const ordersTotal = getOrdersTotal(summary);
      const personalOrders = getPersonalOrdersAfterDiscount(summary);
      const paid = getCanonicalPaid(summary);
      const payable = ordersTotal * PAYABLE_ORDER_SHARE_RATE + personalOrders - paid;
      const services = parseNumber(summary.myServices) || getServicesMeTotal();

      setText(getNode("metricBalances"), formatNumber(paid), {
        displaySource: "topMetricCanonicalFinalizer.dedupedPaid",
      });
      setText(getNode("metricTransfers"), formatNumber(payable), {
        displaySource: "topMetricCanonicalFinalizer.payable70",
        payableFormula: "ordersTotal * 0.7 + personalOrdersAfterDiscount - dedupedPaid",
      });
      setText(getNode("metricPersonalOrdersAfterDiscount"), `Мои заказы: ${formatNumber(personalOrders)}`, {
        displaySource: "topMetricCanonicalFinalizer.personalOrdersAfterDiscount",
      });
      if (services) {
        setText(getNode("metricMyServices"), `Мои услуги: ${formatNumber(services)}`, {
          displaySource: parseNumber(summary.myServices) ? "buildTopMetricsSummary.myServices" : "services_me_ledger_canonical",
        });
      }

      const localRemainders = getLocalRemaindersClosingUsd();
      if (localRemainders !== null) applyRemainders(localRemainders, "topMetricCanonicalFinalizer.localRemainders");
      refreshLiveRemainders();
      return true;
    } finally {
      syncing = false;
    }
  }

  function scheduleSync() {
    RETRY_DELAYS_MS.forEach((delay) => root.setTimeout?.(syncTopMetrics, delay));
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__topMetricCanonicalFinalizerPatched) return false;
    const original = root.renderMetrics;
    const patched = function renderMetricsWithCanonicalTopMetrics(...args) {
      const result = original.apply(this, args);
      root.setTimeout?.(syncTopMetrics, 0);
      return result;
    };
    patched.__topMetricCanonicalFinalizerPatched = true;
    patched.__original = original;
    root.renderMetrics = patched;
    if (typeof renderMetrics === "function") renderMetrics = patched;
    return true;
  }

  function installObserver() {
    const target = root.document?.querySelector?.(".metrics") || root.document?.body;
    const Observer = root.MutationObserver || globalThis.MutationObserver;
    if (!target || !Observer || target.dataset?.topMetricCanonicalObserver === "true") return false;
    target.dataset.topMetricCanonicalObserver = "true";
    const observer = new Observer(() => root.setTimeout?.(syncTopMetrics, 0));
    observer.observe(target, { childList: true, characterData: true, subtree: true });
    return true;
  }

  function bindTriggers() {
    const doc = root.document;
    const body = doc?.body;
    if (!body || body.dataset.topMetricCanonicalTriggersBound === "true") return false;
    body.dataset.topMetricCanonicalTriggersBound = "true";
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
    installObserver();
    bindTriggers();
    scheduleSync();
  }

  start();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else root.setTimeout?.(start, 0);

  root.EzohataTopMetricCanonicalFinalizer = {
    PAYABLE_ORDER_SHARE_RATE,
    getOrdersTotal,
    getPersonalOrdersAfterDiscount,
    calculatePayoutRowsPaidTotal,
    getCanonicalPaid,
    getServicesMeTotal,
    extractRemaindersClosingUsd,
    syncTopMetrics,
    scheduleSync,
    patchRenderMetrics,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
