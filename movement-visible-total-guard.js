// ============================================================
// MOVEMENT VISIBLE TOTAL GUARD
// ============================================================
// Final UI guard: the movement table total under BALANCE must match the
// currently visible numeric movement rows for the selected period.

(function installMovementVisibleTotalGuard(root) {
  const MODULE_NAME = "EzohataMovementVisibleTotalGuard";
  const TOTAL_LABEL = "итого";

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function parseNumber(value) {
    const normalized = String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/,/g, ".")
      .replace(/[^0-9.+-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value) {
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value);
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function findHeaderIndexByAliases(header, aliases) {
    const normalizedAliases = (aliases || []).map(normalizeCell).filter(Boolean);
    return (header || []).findIndex((cell) => normalizedAliases.includes(normalizeCell(cell)));
  }

  function isVisibleMovementDataRow(row) {
    return /^\d+$/.test(String(row?.[0] || "").trim());
  }

  function findMovementTotalRowIndex(values) {
    return (values || []).findIndex((row, index) => index > 0 && normalizeCell(row?.[0]) === TOTAL_LABEL);
  }

  function normalizeMovementVisibleBalanceTotal(values) {
    if (!Array.isArray(values) || values.length < 2) {
      return { ok: false, reason: "values_missing", changed: false };
    }
    const header = values[0] || [];
    const balanceIndex = findHeaderIndexByAliases(header, ["BALANCE", "БАЛАНС"]);
    if (balanceIndex === -1) {
      return { ok: false, reason: "balance_column_missing", changed: false };
    }
    const totalRowIndex = findMovementTotalRowIndex(values);
    if (totalRowIndex === -1) {
      return { ok: false, reason: "total_row_missing", changed: false };
    }
    const rows = values.slice(1, totalRowIndex).filter(isVisibleMovementDataRow);
    const visibleSum = rows.reduce((sum, row) => sum + parseNumber(row?.[balanceIndex]), 0);
    const totalRow = values[totalRowIndex];
    const previous = parseNumber(totalRow?.[balanceIndex]);
    const changed = Math.abs(previous - visibleSum) > 0.00005;
    totalRow[balanceIndex] = formatNumber(visibleSum);
    totalRow.__movementBalanceTotalSource = "visible_rows_sum";
    totalRow.__movementBalancePreviousTotal = previous;
    totalRow.__movementBalanceRows = rows.length;
    return {
      ok: true,
      changed,
      balanceIndex,
      totalRowIndex,
      rows: rows.length,
      previous,
      visibleSum,
    };
  }

  function getGlobalFunction(name) {
    const value = root[name];
    return typeof value === "function" ? value : null;
  }

  function setGlobalFunction(name, value) {
    root[name] = value;
    const tempName = `__ezohata_${name}_movement_visible_total_guard`;
    try {
      root[tempName] = value;
      // eslint-disable-next-line no-eval
      (0, eval)(`${name} = ${tempName}`);
    } catch {
      // Classic browser globals are normally writable window properties.
    } finally {
      try { delete root[tempName]; } catch {}
    }
  }

  function normalizeCurrentMovementTable() {
    const values = root.state?.data?.tabs?.movement?.values;
    return normalizeMovementVisibleBalanceTotal(values);
  }

  function installRenderGuard() {
    const original = getGlobalFunction("renderStandardTab");
    if (typeof original !== "function" || original.__movementVisibleTotalGuardWrapped) return false;
    function renderStandardTabWithMovementVisibleTotalGuard(tabId) {
      if (tabId === "movement") normalizeCurrentMovementTable();
      return original.apply(this, arguments);
    }
    renderStandardTabWithMovementVisibleTotalGuard.__movementVisibleTotalGuardWrapped = true;
    renderStandardTabWithMovementVisibleTotalGuard.__original = original;
    setGlobalFunction("renderStandardTab", renderStandardTabWithMovementVisibleTotalGuard);
    return true;
  }

  function installRenderTabsGuard() {
    const original = getGlobalFunction("renderTabs");
    if (typeof original !== "function" || original.__movementVisibleTotalGuardWrapped) return false;
    function renderTabsWithMovementVisibleTotalGuard() {
      normalizeCurrentMovementTable();
      return original.apply(this, arguments);
    }
    renderTabsWithMovementVisibleTotalGuard.__movementVisibleTotalGuardWrapped = true;
    renderTabsWithMovementVisibleTotalGuard.__original = original;
    setGlobalFunction("renderTabs", renderTabsWithMovementVisibleTotalGuard);
    return true;
  }

  function install() {
    installRenderGuard();
    installRenderTabsGuard();
    normalizeCurrentMovementTable();
  }

  const api = {
    findHeaderIndexByAliases,
    findMovementTotalRowIndex,
    install,
    normalizeCurrentMovementTable,
    normalizeMovementVisibleBalanceTotal,
  };

  root[MODULE_NAME] = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  install();
  if (typeof setTimeout === "function") setTimeout(install, 0);
})(typeof window !== "undefined" ? window : globalThis);
