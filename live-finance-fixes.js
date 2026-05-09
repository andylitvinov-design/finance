// ============================================================
// LIVE FINANCE UI/NORMALIZATION FIXES
// ============================================================
// Minimal runtime fixes for the current live finance repo:
// 1) display paid total as positive without changing payout semantics;
// 2) normalize text discount cells in wide orders mapping;
// 3) keep the original internal formulas untouched.

(function attachLiveFinanceFixes(root) {
  if (!root) return;

  function normalizeNumberText(value) {
    return String(value ?? "").trim().replace(/\s+/g, "");
  }

  function parseLooseNumber(value) {
    const normalized = normalizeNumberText(value)
      .replace(/,/g, ".")
      .replace(/[^0-9.+-]/g, "");
    if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatLikePrevious(value, previousText = "") {
    const decimals = (String(previousText).split(/[,.]/)[1] || "").replace(/[^0-9]/g, "").length;
    const safeDecimals = Math.min(Math.max(decimals || 4, 0), 6);
    return Number(value || 0).toFixed(safeDecimals).replace(".", ",");
  }

  function normalizePaidTotalDisplay() {
    const node = root.document?.getElementById?.("metricBalances");
    if (!node) return false;
    const currentText = node.textContent || "";
    const numeric = parseLooseNumber(currentText);
    if (numeric === null || numeric >= 0) return false;
    node.textContent = formatLikePrevious(Math.abs(numeric), currentText);
    node.dataset.displaySignNormalized = "absolute-paid-total";
    return true;
  }

  function installPaidTotalDisplayFix() {
    normalizePaidTotalDisplay();
    const node = root.document?.getElementById?.("metricBalances");
    if (!node || node.dataset.paidTotalDisplayObserver === "true") return;
    node.dataset.paidTotalDisplayObserver = "true";
    const observer = new MutationObserver(() => normalizePaidTotalDisplay());
    observer.observe(node, { childList: true, characterData: true, subtree: true });
  }

  function wrapRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__ezohataPaidDisplayWrapped) return false;
    const originalRenderMetrics = root.renderMetrics;
    root.renderMetrics = function renderMetricsWithPaidDisplayFix(...args) {
      const result = originalRenderMetrics.apply(this, args);
      normalizePaidTotalDisplay();
      return result;
    };
    root.renderMetrics.__ezohataPaidDisplayWrapped = true;
    return true;
  }

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function findHeaderIndex(header, aliases) {
    const normalizedAliases = new Set((aliases || []).map(normalizeCell));
    return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
  }

  function readCell(row, index) {
    return index >= 0 && index < (row || []).length ? String(row[index] || "").trim() : "";
  }

  function firstNonEmpty(values) {
    for (const value of values || []) {
      if (String(value || "").trim()) return value;
    }
    return "";
  }

  function formatNumber(value) {
    const numeric = typeof value === "number" ? value : parseLooseNumber(value);
    if (!Number.isFinite(numeric)) return "";
    return String(Math.round(numeric * 10000) / 10000).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function parseDiscountMultiplier(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 1;
    const amount = parseLooseNumber(raw);
    if (!Number.isFinite(amount) || amount === 0) return 1;
    const hasPercent = /%/.test(raw);
    const looksLikeFraction = !hasPercent && Math.abs(amount) > 0 && Math.abs(amount) <= 1;
    if (looksLikeFraction) return Math.max(0, 1 - Math.abs(amount));
    const percent = Math.min(Math.abs(amount), 100);
    return Math.max(0, 1 - percent / 100);
  }

  function computeDiscountedAmount(amountValue, discountValue) {
    const amount = parseLooseNumber(amountValue);
    if (!Number.isFinite(amount)) return null;
    return amount * parseDiscountMultiplier(discountValue);
  }

  function patchOrdersDiscountMapping() {
    const helper = root.EzohataOrdersHelper;
    if (!helper || typeof helper.mapLegacyOrdersValues !== "function" || helper.__ezohataDiscountPatchApplied) return false;
    const originalMapLegacyOrdersValues = helper.mapLegacyOrdersValues;

    helper.mapLegacyOrdersValues = function mapLegacyOrdersValuesWithDiscount(values) {
      const mapped = originalMapLegacyOrdersValues(values);
      const rows = Array.isArray(values) ? values : [];
      const header = Array.isArray(rows[0]) ? rows[0].map((cell) => String(cell || "").trim()) : [];
      if (!header.length || header.length <= 4 || !mapped?.rows?.length) return mapped;

      const discountIndex = findHeaderIndex(header, [
        "discount", "discount %", "discount pct", "скидка", "скидка %", "% скидки", "скидок", "disc"
      ]);
      if (discountIndex === -1) return mapped;

      const costIndexes = [
        findHeaderIndex(header, ["accrued +3%", "стоимость", "cost"]),
        findHeaderIndex(header, ["accrued"]),
        findHeaderIndex(header, ["price base", "price"]),
        findHeaderIndex(header, ["получено в долларах итого (сводный)", "received total usd"]),
      ];

      const nextRows = mapped.rows.map((row, rowIndex) => {
        const sourceRow = rows[rowIndex + 1] || [];
        const discountRaw = readCell(sourceRow, discountIndex);
        if (!discountRaw) return row;
        const rawCost = firstNonEmpty(costIndexes.map((index) => readCell(sourceRow, index)));
        const discounted = computeDiscountedAmount(rawCost, discountRaw);
        if (!Number.isFinite(discounted)) return row;
        const nextRow = row.slice();
        nextRow[3] = formatNumber(discounted);
        return nextRow;
      });

      return { ...mapped, rows: nextRows };
    };

    helper.parseDiscountMultiplier = parseDiscountMultiplier;
    helper.computeDiscountedAmount = computeDiscountedAmount;
    helper.__ezohataDiscountPatchApplied = true;
    return true;
  }

  function install() {
    patchOrdersDiscountMapping();
    wrapRenderMetrics();
    installPaidTotalDisplayFix();
  }

  root.EzohataLiveFinanceFixes = {
    install,
    normalizePaidTotalDisplay,
    parseDiscountMultiplier,
    computeDiscountedAmount,
    patchOrdersDiscountMapping,
  };

  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})(typeof window !== "undefined" ? window : globalThis);
