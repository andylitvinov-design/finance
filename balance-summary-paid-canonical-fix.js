(function initBalanceSummaryPaidCanonicalFix(root) {
  "use strict";

  const DIAGNOSTIC = "needs verification: totalPaid metrics differed from actual payments by channel; using actual payments by channel as canonical paid total.";

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isActualPaymentsDistribution(distribution = {}) {
    const source = String(distribution.source || "");
    const title = String(distribution.title || "");
    return source === "realIncome.actualPaymentSummaryByChannel" || title === "Факт оплат по каналам";
  }

  function getCanonicalPaidTotal(summary = {}) {
    const distribution = summary.incomeChannelDistribution || null;
    const total = parseNumber(distribution?.total);
    if (!distribution || !isActualPaymentsDistribution(distribution) || total <= 0) return null;
    return total;
  }

  function applyCanonicalPaidSummary(summary = {}) {
    const canonicalPaid = getCanonicalPaidTotal(summary);
    if (canonicalPaid === null) return summary;
    const currentPaid = parseNumber(summary.totalPaid);
    const totalAccrued = parseNumber(summary.totalAccrued);
    const next = {
      ...summary,
      totalPaid: canonicalPaid,
      remainingToPay: totalAccrued - canonicalPaid,
      diagnostics: Array.isArray(summary.diagnostics) ? [...summary.diagnostics] : [],
      sources: {
        ...(summary.sources || {}),
        totalPaid: "realIncome.actualPaymentSummaryByChannel",
      },
    };
    if (Math.abs(currentPaid - canonicalPaid) > 0.0001 && !next.diagnostics.includes(DIAGNOSTIC)) {
      next.diagnostics.push(DIAGNOSTIC);
    }
    return next;
  }

  function getApi() {
    return root.EzohataBalanceSummaryPopup || null;
  }

  function replaceExistingSummaryBlock(doc = root.document) {
    const api = getApi();
    const blockId = api?.BALANCE_BLOCK_ID || "balanceSummaryBlock";
    const existing = doc?.getElementById?.(blockId);
    if (!existing || typeof api?.buildBalanceTextSummary !== "function" || typeof api?.renderBalanceSummaryBlock !== "function") return false;
    const summary = applyCanonicalPaidSummary(api.buildBalanceTextSummary());
    const next = api.renderBalanceSummaryBlock(summary, doc);
    existing.parentNode?.replaceChild?.(next, existing);
    return true;
  }

  function scheduleReplace() {
    root.setTimeout?.(() => replaceExistingSummaryBlock(root.document), 0);
  }

  function patchApi() {
    const api = getApi();
    if (!api || api.__ezohataCanonicalPaidPatched) return false;
    if (typeof api.buildBalanceTextSummary === "function") {
      const originalBuild = api.buildBalanceTextSummary;
      api.buildBalanceTextSummary = function buildBalanceTextSummaryWithCanonicalPaid(...args) {
        return applyCanonicalPaidSummary(originalBuild.apply(this, args));
      };
    }
    api.__ezohataCanonicalPaidPatched = true;
    return true;
  }

  function bind() {
    patchApi();
    const doc = root.document;
    doc?.getElementById?.("balanceLauncherButton")?.addEventListener?.("click", scheduleReplace);
    if (typeof root.renderMetrics === "function" && !root.renderMetrics.__ezohataCanonicalPaidPatched) {
      const original = root.renderMetrics;
      root.renderMetrics = function renderMetricsWithCanonicalPaid(...args) {
        const result = original.apply(this, args);
        patchApi();
        scheduleReplace();
        return result;
      };
      root.renderMetrics.__ezohataCanonicalPaidPatched = true;
    }
    scheduleReplace();
  }

  const api = {
    DIAGNOSTIC,
    getCanonicalPaidTotal,
    applyCanonicalPaidSummary,
    replaceExistingSummaryBlock,
    bind,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataBalanceSummaryPaidCanonicalFix = api;
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", bind);
  else bind();
})(typeof globalThis !== "undefined" ? globalThis : window);
