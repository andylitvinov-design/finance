// ============================================================
// ANALYTICS INDEPENDENT TABLE SCROLL FIX
// ============================================================
// Analytics renders many independent tables. The outer Analytics container
// must not be a .table-wrap; otherwise mobile browsers scroll the whole
// Analytics block/page instead of each individual table.

(function attachAnalyticsIndependentTableScrollFix(root) {
  if (!root) return;

  function queryAll(node, selector) {
    return Array.from(node?.querySelectorAll?.(selector) || []);
  }

  function directChildTable(node) {
    return Array.from(node?.children || []).some((child) => String(child?.tagName || "").toUpperCase() === "TABLE");
  }

  function isAnalyticsOuterTableWrap(node) {
    if (!node?.classList?.contains("table-wrap")) return false;
    if (node.classList.contains("analysis-table-wrap")) return false;
    if (node.classList.contains("period-balance-table-wrap")) return false;
    if (node.classList.contains("balance-snapshots-table-wrap")) return false;
    if (node.classList.contains("expense-operations-wrap")) return false;
    if (node.classList.contains("rate-table-wrap")) return false;
    if (directChildTable(node)) return false;
    return Boolean(node.querySelector?.(".analytics-section, .finance-analysis-section"));
  }

  function normalizeAnalyticsOuterContainers(doc = root.document) {
    let changed = 0;
    queryAll(doc, ".table-wrap").forEach((wrap) => {
      if (!isAnalyticsOuterTableWrap(wrap)) return;
      wrap.classList.remove("table-wrap");
      wrap.classList.add("analytics-root");
      wrap.style.overflow = "visible";
      wrap.style.border = "0";
      wrap.style.borderRadius = "0";
      wrap.style.background = "transparent";
      wrap.style.maxWidth = "100%";
      wrap.style.minWidth = "0";
      wrap.dataset.analyticsOuterScrollNormalized = "true";
      changed += 1;
    });
    return changed;
  }

  function install() {
    normalizeAnalyticsOuterContainers(root.document);
    const target = root.document?.getElementById?.("tabPanels") || root.document?.body;
    if (!target || target.dataset?.analyticsIndependentScrollObserver === "true") return;
    target.dataset = target.dataset || {};
    target.dataset.analyticsIndependentScrollObserver = "true";
    const Observer = root.MutationObserver || globalThis.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(() => normalizeAnalyticsOuterContainers(root.document));
    observer.observe(target, { childList: true, subtree: true });
  }

  root.EzohataAnalyticsIndependentTableScrollFix = {
    install,
    normalizeAnalyticsOuterContainers,
    isAnalyticsOuterTableWrap,
  };

  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})(typeof window !== "undefined" ? window : globalThis);
