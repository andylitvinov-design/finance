// ============================================================
// LIVE FINANCE UI/NORMALIZATION FIXES
// ============================================================
// Minimal runtime fixes for the current live finance repo:
// 1) display paid total as positive without changing payout semantics;
// 2) normalize text discount/action cells in wide orders mapping;
// 3) normalize movement balance variance sign as fact minus plan;
// 4) keep the original internal formulas untouched.

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

  function normalizeLookupText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function collectElements(node, predicate, matches = []) {
    if (!node) return matches;
    if (predicate(node)) matches.push(node);
    const children = Array.isArray(node.children) ? node.children : Array.from(node.children || []);
    children.forEach((child) => collectElements(child, predicate, matches));
    return matches;
  }

  function queryAll(node, selector) {
    if (!node) return [];
    if (typeof node.querySelectorAll === "function") return Array.from(node.querySelectorAll(selector));
    const tagName = String(selector || "").trim().toUpperCase();
    if (!tagName || /[^A-Z0-9-]/.test(tagName)) return [];
    return collectElements(node, (item) => String(item.tagName || "").toUpperCase() === tagName);
  }

  function findColumnByAliases(cells, aliases) {
    const normalizedAliases = (aliases || []).map(normalizeLookupText).filter(Boolean);
    return (cells || []).findIndex((cell) => {
      const text = normalizeLookupText(cell?.textContent ?? cell);
      if (!text) return false;
      return normalizedAliases.some((alias) => text === alias || text.includes(alias));
    });
  }

  function normalizeMovementBalanceVarianceTables(rootNode = root.document) {
    const tables = queryAll(rootNode, "table");
    let changed = 0;
    tables.forEach((table) => {
      const rows = queryAll(table, "tr");
      if (rows.length < 2) return;
      const headerCells = Array.from(rows[0].children || []);
      if (!headerCells.length) return;
      const planIndex = findColumnByAliases(headerCells, [
        "план", "план = accrued", "planned", "plan", "accrued", "стоимость", "cost"
      ]);
      const actualIndex = findColumnByAliases(headerCells, [
        "пришло", "пришло в долларах", "получено", "получено в долларах", "факт", "оплачено", "paid", "received", "actual"
      ]);
      const balanceIndex = findColumnByAliases(headerCells, [
        "баланс", "balance", "остаток", "отклонение", "delta", "variance"
      ]);
      if (planIndex === -1 || actualIndex === -1 || balanceIndex === -1) return;
      if (balanceIndex === planIndex || balanceIndex === actualIndex) return;

      rows.slice(1).forEach((row) => {
        const cells = Array.from(row.children || []);
        const planCell = cells[planIndex];
        const actualCell = cells[actualIndex];
        const balanceCell = cells[balanceIndex];
        if (!planCell || !actualCell || !balanceCell) return;
        const planned = parseLooseNumber(planCell.textContent);
        const actual = parseLooseNumber(actualCell.textContent);
        if (planned === null || actual === null) return;
        const previousText = String(balanceCell.textContent || "");
        const nextText = formatLikePrevious(actual - planned, previousText);
        if (previousText === nextText) return;
        balanceCell.textContent = nextText;
        balanceCell.dataset = balanceCell.dataset || {};
        balanceCell.dataset.displaySignNormalized = "movement-fact-minus-plan";
        changed += 1;
      });
    });
    return changed;
  }

  function installPaidTotalDisplayFix() {
    normalizePaidTotalDisplay();
    const node = root.document?.getElementById?.("metricBalances");
    if (!node || node.dataset.paidTotalDisplayObserver === "true") return;
    node.dataset.paidTotalDisplayObserver = "true";
    const Observer = root.MutationObserver || globalThis.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(() => normalizePaidTotalDisplay());
    observer.observe(node, { childList: true, characterData: true, subtree: true });
  }

  function installMovementBalanceDisplayFix() {
    normalizeMovementBalanceVarianceTables(root.document);
    const target = root.document?.getElementById?.("tabPanels") || root.document?.body;
    if (!target || target.dataset?.movementBalanceDisplayObserver === "true") return;
    target.dataset = target.dataset || {};
    target.dataset.movementBalanceDisplayObserver = "true";
    const Observer = root.MutationObserver || globalThis.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(() => normalizeMovementBalanceVarianceTables(root.document));
    observer.observe(target, { childList: true, characterData: true, subtree: true });
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

  function wrapRenderTabsForMovementBalance() {
    if (typeof root.renderTabs !== "function" || root.renderTabs.__ezohataMovementBalanceDisplayWrapped) return false;
    const originalRenderTabs = root.renderTabs;
    root.renderTabs = function renderTabsWithMovementBalanceSignFix(...args) {
      const result = originalRenderTabs.apply(this, args);
      normalizeMovementBalanceVarianceTables(root.document);
      return result;
    };
    root.renderTabs.__ezohataMovementBalanceDisplayWrapped = true;
    return true;
  }

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function findHeaderIndex(header, aliases) {
    const normalizedAliases = new Set((aliases || []).map(normalizeCell));
    return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
  }

  function findHeaderIndexes(header, aliases) {
    const normalizedAliases = new Set((aliases || []).map(normalizeCell));
    return (header || [])
      .map((cell, index) => [cell, index])
      .filter(([cell]) => normalizedAliases.has(normalizeCell(cell)))
      .map(([, index]) => index);
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
    if (looksLikeFraction) return Math.abs(amount);
    const percent = Math.min(Math.abs(amount), 100);
    return Math.max(0, 1 - percent / 100);
  }

  function computeDiscountedAmount(amountValue, discountValue) {
    const amount = parseLooseNumber(amountValue);
    if (!Number.isFinite(amount)) return null;
    return amount * parseDiscountMultiplier(discountValue);
  }

  function sameGroup(left, right, dateIndex, clientIndex) {
    if (!left || !right) return false;
    const leftDate = dateIndex === -1 ? "" : normalizeCell(readCell(left, dateIndex));
    const rightDate = dateIndex === -1 ? "" : normalizeCell(readCell(right, dateIndex));
    const leftClient = clientIndex === -1 ? "" : normalizeCell(readCell(left, clientIndex));
    const rightClient = clientIndex === -1 ? "" : normalizeCell(readCell(right, clientIndex));
    return Boolean(leftDate && rightDate && leftDate === rightDate && leftClient && rightClient && leftClient === rightClient);
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

      const discountIndexes = findHeaderIndexes(header, [
        "action", "actions", "коэффициент", "коэф", "factor", "multiplier",
        "discount", "discount %", "discount pct", "скидка", "скидка %", "% скидки", "скидок", "disc"
      ]);
      if (!discountIndexes.length) return mapped;

      const dateIndex = findHeaderIndex(header, ["date", "дата"]);
      const clientIndex = findHeaderIndex(header, ["client", "имя", "name", "клиент"]);
      const costIndexes = [
        findHeaderIndex(header, ["accrued +3%", "стоимость", "cost"]),
        findHeaderIndex(header, ["accrued"]),
        findHeaderIndex(header, ["price base", "price"]),
        findHeaderIndex(header, ["получено в долларах итого (сводный)", "received total usd"]),
      ];
      const sourceRows = rows.slice(1);
      const explicitDiscount = (sourceRow) => firstNonEmpty(discountIndexes.map((index) => readCell(sourceRow, index)));
      const groupDiscount = (rowIndex) => {
        const current = sourceRows[rowIndex];
        const direct = explicitDiscount(current);
        if (direct) return direct;
        for (let index = rowIndex - 1; index >= 0; index -= 1) {
          if (!sameGroup(current, sourceRows[index], dateIndex, clientIndex)) break;
          const value = explicitDiscount(sourceRows[index]);
          if (value) return value;
        }
        for (let index = rowIndex + 1; index < sourceRows.length; index += 1) {
          if (!sameGroup(current, sourceRows[index], dateIndex, clientIndex)) break;
          const value = explicitDiscount(sourceRows[index]);
          if (value) return value;
        }
        return "";
      };

      const nextRows = mapped.rows.map((row, rowIndex) => {
        const sourceRow = sourceRows[rowIndex] || [];
        const discountRaw = groupDiscount(rowIndex);
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
    wrapRenderTabsForMovementBalance();
    installPaidTotalDisplayFix();
    installMovementBalanceDisplayFix();
  }

  root.EzohataLiveFinanceFixes = {
    install,
    normalizePaidTotalDisplay,
    normalizeMovementBalanceVarianceTables,
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
