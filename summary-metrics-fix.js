// ============================================================
// SUMMARY METRICS SAFETY PATCH
// ============================================================
// Runtime-only UI normalization for top dashboard cards.
// It does not change Ledger save, balance, amount_net, gross/net/fee, or provider semantics.

(function installSummaryMetricsPatch() {
  const root = typeof window !== "undefined" ? window : globalThis;
  const previousRenderMetrics = typeof root.renderMetrics === "function" ? root.renderMetrics : null;

  function parseSummaryMetricNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatSummaryMetricNumber(value) {
    const rounded = Math.round((Number(value) || 0) * 10000) / 10000;
    return String(rounded)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*[1-9])0+$/, "$1")
      .replace(".", ",");
  }

  function setSummaryMetricText(node, value) {
    if (!node) return;
    node.textContent = formatSummaryMetricNumber(value);
  }

  function getSelectedSummaryPeriod() {
    const startDate = String(root.elements?.startDate?.value || "").trim();
    const endDate = String(root.elements?.endDate?.value || "").trim();
    return { startDate, endDate };
  }

  function normalizeSummaryDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const match = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  }

  function isSummaryRowInSelectedPeriod(row) {
    const { startDate, endDate } = getSelectedSummaryPeriod();
    if (!startDate && !endDate) return true;
    const rowDate = normalizeSummaryDate(row?.date || row?.operationDate || row?.createdAt || row?.updatedAt || "");
    if (!rowDate) return true;
    if (startDate && rowDate < startDate) return false;
    if (endDate && rowDate > endDate) return false;
    return true;
  }

  function getSummaryMetricRows() {
    const manual = root.state?.data?.manual || {};
    const candidates = [
      manual.operations,
      manual.ledgerV2Rows,
      root.state?.manualFinance?.data?.ledgerRows,
      root.state?.manualFinance?.data?.operations,
    ];
    return candidates.find((rows) => Array.isArray(rows) && rows.length) || [];
  }

  function getSummaryRowOperation(row) {
    const value = String(row?.operation || row?.type || row?.category || "").trim().toLowerCase().replace(/\s+/g, "_");
    if (value === "servicein") return "income";
    if (value === "ezoin") return "income";
    return value;
  }

  function getSummaryRowSource(row) {
    return String(row?.source || row?.displaySource || "").trim().toLowerCase();
  }

  function isSummaryExpenseOperation(row) {
    return ["expense", "business_expense", "personal_expense"].includes(getSummaryRowOperation(row));
  }

  function isSummaryIncomeOperation(row) {
    return ["income", "service_income"].includes(getSummaryRowOperation(row));
  }

  function isSummaryProviderIncome(row) {
    const source = getSummaryRowSource(row);
    if (["", "manual", "fact", "migration", "photo", "unknown"].includes(source)) return false;
    return true;
  }

  function getSummaryRowUsdAmount(row) {
    const amountUsdRaw = String(row?.amountUsd ?? row?.amount_usd ?? "").trim();
    if (amountUsdRaw && parseSummaryMetricNumber(amountUsdRaw)) return Math.abs(parseSummaryMetricNumber(amountUsdRaw));
    const amountNetRaw = String(row?.amountNet ?? row?.amount_net ?? "").trim();
    if (amountNetRaw && parseSummaryMetricNumber(amountNetRaw)) return Math.abs(parseSummaryMetricNumber(amountNetRaw));
    return Math.abs(parseSummaryMetricNumber(row?.amount || row?.grossAmount || row?.gross_amount || 0));
  }

  function buildSummaryMetricFallbackTotals() {
    const rows = getSummaryMetricRows().filter(isSummaryRowInSelectedPeriod);
    return rows.reduce((totals, row) => {
      const amount = getSummaryRowUsdAmount(row);
      if (!amount) return totals;
      if (isSummaryExpenseOperation(row)) totals.myCosts += amount;
      if (isSummaryIncomeOperation(row) && !isSummaryProviderIncome(row)) totals.myServices += amount;
      return totals;
    }, { myCosts: 0, myServices: 0 });
  }

  function getDisplayedMetricValue(node) {
    return parseSummaryMetricNumber(node?.textContent || "");
  }

  function applySummaryMetricCorrections() {
    const elements = root.elements || {};
    const totalOrders = getDisplayedMetricValue(elements.metricPeriod);
    const paid = getDisplayedMetricValue(elements.metricBalances);
    const toPay = paid - totalOrders;

    // User-facing convention: underpayment to me is negative. Persisted balance semantics stay untouched.
    if (elements.metricOrders) setSummaryMetricText(elements.metricOrders, toPay);
    if (elements.metricTransfers) setSummaryMetricText(elements.metricTransfers, toPay);

    const fallbackTotals = buildSummaryMetricFallbackTotals();
    const displayedCosts = parseSummaryMetricNumber(String(elements.metricMyCosts?.textContent || "").replace(/^.*?:/, ""));
    const myCosts = fallbackTotals.myCosts || displayedCosts;
    if (elements.metricMyCosts && fallbackTotals.myCosts) {
      elements.metricMyCosts.textContent = `Мои затраты: ${formatSummaryMetricNumber(myCosts)}`;
    }

    const displayedServices = parseSummaryMetricNumber(String(elements.metricMyServices?.textContent || "").replace(/^.*?:/, ""));
    const myServices = fallbackTotals.myServices || displayedServices;
    if (elements.metricMyServices && fallbackTotals.myServices) {
      elements.metricMyServices.textContent = `Мои услуги: ${formatSummaryMetricNumber(myServices)}`;
    }

    if (elements.metricProfit && (fallbackTotals.myCosts || fallbackTotals.myServices)) {
      elements.metricProfit.textContent = `Прибыль: ${formatSummaryMetricNumber(myServices - myCosts)}`;
    }
  }

  if (previousRenderMetrics) {
    root.renderMetrics = function patchedRenderMetrics(...args) {
      const result = previousRenderMetrics.apply(this, args);
      applySummaryMetricCorrections();
      return result;
    };
  } else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", applySummaryMetricCorrections);
  }

  root.EzohataSummaryMetricsPatch = {
    parseSummaryMetricNumber,
    formatSummaryMetricNumber,
    buildSummaryMetricFallbackTotals,
    applySummaryMetricCorrections,
  };
})();
