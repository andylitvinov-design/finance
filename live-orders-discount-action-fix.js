// ============================================================
// LIVE ORDERS ACTION/DISCOUNT FIX
// ============================================================
// Handles current sheet patterns where the discount can be stored in an
// `action`/multiplier column and can apply to adjacent rows for the same
// date/client group.

(function attachOrdersActionDiscountFix(root) {
  if (!root) return;

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function parseLooseNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, "");
    if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value) {
    const numeric = typeof value === "number" ? value : parseLooseNumber(value);
    if (!Number.isFinite(numeric)) return "";
    return String(Math.round(numeric * 10000) / 10000).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
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

  function parseMultiplier(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 1;
    const amount = parseLooseNumber(raw);
    if (!Number.isFinite(amount) || amount === 0) return 1;
    if (!/%/.test(raw) && Math.abs(amount) > 0 && Math.abs(amount) <= 1) return Math.abs(amount);
    return Math.max(0, 1 - Math.min(Math.abs(amount), 100) / 100);
  }

  function computeDiscountedAmount(amountValue, discountValue) {
    const amount = parseLooseNumber(amountValue);
    if (!Number.isFinite(amount)) return null;
    return amount * parseMultiplier(discountValue);
  }

  function sameGroup(left, right, dateIndex, clientIndex) {
    if (!left || !right) return false;
    const leftDate = dateIndex === -1 ? "" : normalizeCell(readCell(left, dateIndex));
    const rightDate = dateIndex === -1 ? "" : normalizeCell(readCell(right, dateIndex));
    const leftClient = clientIndex === -1 ? "" : normalizeCell(readCell(left, clientIndex));
    const rightClient = clientIndex === -1 ? "" : normalizeCell(readCell(right, clientIndex));
    return Boolean(leftDate && rightDate && leftDate === rightDate && leftClient && rightClient && leftClient === rightClient);
  }

  function patchOrdersActionDiscountMapping() {
    const helper = root.EzohataOrdersHelper;
    if (!helper || typeof helper.mapLegacyOrdersValues !== "function" || helper.__ezohataActionDiscountPatchApplied) return false;
    const originalMapLegacyOrdersValues = helper.mapLegacyOrdersValues;

    helper.mapLegacyOrdersValues = function mapLegacyOrdersValuesWithActionDiscount(values) {
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
      const groupDiscount = (sourceRowIndex) => {
        const current = sourceRows[sourceRowIndex];
        const direct = explicitDiscount(current);
        if (direct) return direct;
        for (let index = sourceRowIndex - 1; index >= 0; index -= 1) {
          if (!sameGroup(current, sourceRows[index], dateIndex, clientIndex)) break;
          const value = explicitDiscount(sourceRows[index]);
          if (value) return value;
        }
        for (let index = sourceRowIndex + 1; index < sourceRows.length; index += 1) {
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

    helper.parseActionDiscountMultiplier = parseMultiplier;
    helper.computeActionDiscountedAmount = computeDiscountedAmount;
    helper.__ezohataActionDiscountPatchApplied = true;
    return true;
  }

  function install() {
    patchOrdersActionDiscountMapping();
  }

  root.EzohataOrdersActionDiscountFix = {
    install,
    parseMultiplier,
    computeDiscountedAmount,
    patchOrdersActionDiscountMapping,
  };

  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})(typeof window !== "undefined" ? window : globalThis);
