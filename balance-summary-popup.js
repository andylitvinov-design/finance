(function initBalanceSummaryPopup(root) {
  "use strict";

  const BALANCE_BUTTON_ID = "balanceLauncherButton";
  const BALANCE_BLOCK_ID = "balanceSummaryBlock";
  const PAYABLE_RATE = 0.7;
  const PERSONAL_ORDERS_RATE = 0.5;

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

  function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  }

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function findHeaderIndexByAliases(header, aliases) {
    if (typeof root.findHeaderIndexByAliases === "function") return root.findHeaderIndexByAliases(header, aliases);
    const normalized = new Set((aliases || []).map((alias) => normalizeCell(alias)));
    return (header || []).findIndex((cell) => normalized.has(normalizeCell(cell)));
  }

  function normalizeDateKey(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const display = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
    return raw.slice(0, 10);
  }

  function getSelectedPeriod(options = {}) {
    const doc = options.document || root.document;
    return {
      startDate: normalizeDateKey(options.startDate || root.elements?.startDate?.value || doc?.getElementById?.("startDate")?.value || root.state?.analyticsFact?.periodStart || ""),
      endDate: normalizeDateKey(options.endDate || root.elements?.endDate?.value || doc?.getElementById?.("endDate")?.value || root.state?.analyticsFact?.periodEnd || ""),
    };
  }

  function isDateInPeriod(date, period) {
    if (!date) return true;
    if (period.startDate && date < period.startDate) return false;
    if (period.endDate && date > period.endDate) return false;
    return true;
  }

  function isTotalRow(row) {
    const first = normalizeCell(row?.[0]);
    return first === "итого" || first === "total" || first === "итого за период";
  }

  function hasAnyValue(row) {
    return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
  }

  function findHeaderRowIndex(values) {
    return (values || []).findIndex((row) => {
      const normalized = (row || []).map((cell) => normalizeCell(cell));
      return normalized.includes("accrued") || normalized.includes("accrued +3%") || normalized.includes("стоимость");
    });
  }

  function sumTableTotals(values, period) {
    const rows = Array.isArray(values) ? values : [];
    if (!rows.length) return { orders: null, totalOrdersPlusPercent: null, percentToOrders: null, sourceFound: false };
    const headerRowIndex = findHeaderRowIndex(rows);
    if (headerRowIndex === -1) return { orders: null, totalOrdersPlusPercent: null, percentToOrders: null, sourceFound: false };

    const header = rows[headerRowIndex] || [];
    const dateIndex = findHeaderIndexByAliases(header, ["DATE", "ДАТА"]);
    const baseIndex = findHeaderIndexByAliases(header, ["ACCRUED", "PRICE BASE", "СТОИМОСТЬ", "COST"]);
    const accruedPlusIndex = findHeaderIndexByAliases(header, ["ACCRUED +3%", "ИТОГО"]);
    const dataRows = rows.slice(headerRowIndex + 1).filter((row) => {
      if (!hasAnyValue(row) || isTotalRow(row)) return false;
      if (dateIndex !== -1) return isDateInPeriod(normalizeDateKey(row[dateIndex]), period);
      return true;
    });

    const orders = baseIndex === -1 ? null : dataRows.reduce((sum, row) => sum + parseNumber(row[baseIndex]), 0);
    const totalOrdersPlusPercent = accruedPlusIndex === -1 ? null : dataRows.reduce((sum, row) => sum + parseNumber(row[accruedPlusIndex]), 0);
    const percentToOrders = orders === null || totalOrdersPlusPercent === null ? null : totalOrdersPlusPercent - orders;
    return { orders, totalOrdersPlusPercent, percentToOrders, sourceFound: orders !== null || totalOrdersPlusPercent !== null };
  }

  function getMetrics(input, options) {
    if (options?.metrics) return options.metrics;
    if (input && (hasOwn(input, "totalOrders") || hasOwn(input, "totalPaid") || hasOwn(input, "personalOrdersAfterDiscount"))) return input;
    if (typeof root.buildTopMetricsSummary === "function") return root.buildTopMetricsSummary() || {};
    return {};
  }

  function getState(input, options) {
    return options?.state || input?.state || (input?.data ? input : null) || root.state || {};
  }

  function firstFinite(...values) {
    for (const value of values) {
      if (Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  }

  function buildBalanceTextSummary(metricsOrState = {}, options = {}) {
    const diagnostics = [];
    const metrics = getMetrics(metricsOrState, options);
    const appState = getState(metricsOrState, options);
    const period = getSelectedPeriod(options);
    const movementTotals = sumTableTotals(appState?.data?.tabs?.movement?.values || [], period);
    const ordersTotals = sumTableTotals(appState?.data?.tabs?.orders?.values || [], period);
    const explicitOrders = hasOwn(metricsOrState, "orders") ? parseNumber(metricsOrState.orders) : null;
    const explicitPercent = hasOwn(metricsOrState, "percentToOrders") ? parseNumber(metricsOrState.percentToOrders) : null;

    let orders = explicitOrders;
    let percentToOrders = explicitPercent;
    let totalOrdersPlusPercent = hasOwn(metricsOrState, "totalOrdersPlusPercent") ? parseNumber(metricsOrState.totalOrdersPlusPercent) : null;

    if (orders === null) {
      if (movementTotals.orders !== null || ordersTotals.orders !== null) {
        orders = firstFinite(movementTotals.orders, 0) + firstFinite(ordersTotals.orders, 0);
      } else if (hasOwn(metrics, "totalOrders")) {
        orders = parseNumber(metrics.totalOrders);
        diagnostics.push("needs verification: source not found for exact orders base; using top metrics totalOrders.");
      } else {
        orders = 0;
        diagnostics.push("needs verification: source not found for orders.");
      }
    }

    if (percentToOrders === null) {
      if (movementTotals.percentToOrders !== null || ordersTotals.percentToOrders !== null) {
        percentToOrders = firstFinite(movementTotals.percentToOrders, 0) + firstFinite(ordersTotals.percentToOrders, 0);
      } else {
        percentToOrders = 0;
        diagnostics.push("needs verification: source not found for percentToOrders.");
      }
    }

    if (totalOrdersPlusPercent === null) {
      if (movementTotals.totalOrdersPlusPercent !== null || ordersTotals.totalOrdersPlusPercent !== null) {
        totalOrdersPlusPercent = firstFinite(movementTotals.totalOrdersPlusPercent, 0) + firstFinite(ordersTotals.totalOrdersPlusPercent, 0);
      } else if (hasOwn(metrics, "totalOrders")) {
        totalOrdersPlusPercent = parseNumber(metrics.totalOrders);
      } else {
        totalOrdersPlusPercent = orders + percentToOrders;
      }
    }

    const personalSourceFound = hasOwn(metricsOrState, "myOrders") || hasOwn(metrics, "personalOrdersAfterDiscount") || hasOwn(metrics?.ordersSummary || {}, "personalOrdersAfterDiscount");
    const myOrders = hasOwn(metricsOrState, "myOrders") ? parseNumber(metricsOrState.myOrders) : parseNumber(metrics.personalOrdersAfterDiscount ?? metrics.ordersSummary?.personalOrdersAfterDiscount ?? 0);
    if (!personalSourceFound) diagnostics.push("needs verification: source not found for myOrders.");

    const paidSourceFound = hasOwn(metricsOrState, "paid") || hasOwn(metricsOrState, "totalPaid") || hasOwn(metrics, "totalPaid");
    const totalPaid = Math.abs(parseNumber(metricsOrState.paid ?? metricsOrState.totalPaid ?? metrics.totalPaid ?? 0));
    if (!paidSourceFound) diagnostics.push("needs verification: source not found for totalPaid.");

    const seventyPercent = totalOrdersPlusPercent * PAYABLE_RATE;
    const myOrdersHalf = myOrders * PERSONAL_ORDERS_RATE;
    const totalAccrued = seventyPercent + myOrdersHalf;
    const remainingToPay = totalAccrued - totalPaid;

    return {
      period,
      orders,
      percentToOrders,
      totalOrdersPlusPercent,
      seventyPercent,
      myOrders,
      myOrdersHalf,
      totalAccrued,
      totalPaid,
      remainingToPay,
      diagnostics,
      sources: {
        orders: explicitOrders !== null ? "input.orders" : "movement/orders table ACCRUED or top metrics fallback",
        percentToOrders: explicitPercent !== null ? "input.percentToOrders" : "movement/orders ACCRUED +3% minus ACCRUED",
        totalPaid: "buildTopMetricsSummary.totalPaid",
        myOrders: "buildTopMetricsSummary.personalOrdersAfterDiscount",
      },
    };
  }

  function formatMoney(value) {
    if (!Number.isFinite(Number(value))) return "needs verification";
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value, 4);
    return Number(value).toFixed(4).replace(".", ",");
  }

  function renderBalanceSummaryBlock(summary, doc = root.document) {
    const block = doc.createElement("div");
    block.id = BALANCE_BLOCK_ID;
    block.className = "balance-summary-block";
    block.setAttribute("aria-live", "polite");
    const lines = [
      ["Сумма заказов за период", summary.orders],
      ["Процент к заказам", summary.percentToOrders],
      ["Итого: Заказы + %", summary.totalOrdersPlusPercent],
      ["70% от Итого", summary.seventyPercent],
      ["Мои заказы", summary.myOrders],
      ["50% от моих заказов", summary.myOrdersHalf],
      ["ВСЕГО НАЧИСЛЕНО (70% от итого + 50% моих)", summary.totalAccrued],
      ["ВСЕГО оплачено", summary.totalPaid],
      ["ОСТАТОК оплатить", summary.remainingToPay],
    ];
    const list = doc.createElement("ol");
    lines.forEach(([label, value]) => {
      const item = doc.createElement("li");
      item.textContent = `${label}: ${formatMoney(value)}`;
      list.appendChild(item);
    });
    block.appendChild(list);
    if (summary.diagnostics?.length) {
      const diagnostics = doc.createElement("div");
      diagnostics.className = "balance-summary-diagnostics";
      diagnostics.textContent = summary.diagnostics.join(" ");
      block.appendChild(diagnostics);
    }
    return block;
  }

  function getSummaryMount(doc = root.document) {
    return doc?.querySelector?.(".hero .controls") || doc?.getElementById?.(BALANCE_BUTTON_ID)?.parentNode || doc?.body || null;
  }

  function updateBalanceSummaryBlock() {
    const doc = root.document;
    const existing = doc?.getElementById?.(BALANCE_BLOCK_ID);
    if (!existing) return false;
    const next = renderBalanceSummaryBlock(buildBalanceTextSummary(), doc);
    existing.parentNode?.replaceChild?.(next, existing);
    return true;
  }

  function bindBalanceLauncherButton() {
    const doc = root.document;
    const launcher = doc?.getElementById?.(BALANCE_BUTTON_ID);
    if (!launcher || launcher.__ezohataBalanceLauncherBound) return Boolean(launcher);
    launcher.__ezohataBalanceLauncherBound = true;
    launcher.addEventListener("click", () => {
      const existing = doc.getElementById(BALANCE_BLOCK_ID);
      if (existing) {
        existing.remove?.();
        return;
      }
      const block = renderBalanceSummaryBlock(buildBalanceTextSummary(), doc);
      const mount = getSummaryMount(doc);
      if (mount?.insertAdjacentElement) mount.insertAdjacentElement("afterend", block);
      else mount?.appendChild?.(block);
    });
    return true;
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__ezohataBalanceSummaryPatched) return false;
    const original = root.renderMetrics;
    root.renderMetrics = function renderMetricsWithBalanceSummary(...args) {
      const result = original.apply(this, args);
      updateBalanceSummaryBlock();
      return result;
    };
    root.renderMetrics.__ezohataBalanceSummaryPatched = true;
    return true;
  }

  function startBalanceSummary() {
    bindBalanceLauncherButton();
    patchRenderMetrics();
  }

  const api = {
    BALANCE_BUTTON_ID,
    BALANCE_BLOCK_ID,
    bindBalanceLauncherButton,
    buildBalanceTextSummary,
    renderBalanceSummaryBlock,
    startBalanceSummary,
    updateBalanceSummaryBlock,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataBalanceSummaryPopup = api;
  startBalanceSummary();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startBalanceSummary);
})(typeof globalThis !== "undefined" ? globalThis : window);
