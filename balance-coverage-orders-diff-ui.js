(function initBalanceCoverageOrdersDiffUi(root) {
  "use strict";

  const COVERAGE_SECTION_CLASS = "balance-coverage-by-channel";
  const ENHANCED_MARKER = "coverage-orders-diff-v1";

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function roundNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.round(number * 10000) / 10000;
  }

  function formatMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "needs verification";
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(number, 4);
    return number.toFixed(4).replace(".", ",");
  }

  function formatSharePercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "needs verification";
    return `${number.toFixed(1)}%`;
  }

  function isExcludedCoverageRow(row = {}) {
    return String(row?.status || "").trim().toLowerCase() === "excluded";
  }

  function getCoverageChannel(row = {}) {
    return String(row?.channel || "").trim() || "Без канала";
  }

  function addCoverageRow(target, source = {}) {
    const ordersUsd = parseNumber(source.ordersUsd ?? source.accruedOrdersUsd ?? source.accruedPlus3Usd ?? source.totalAccruedOrdersUsd);
    const coveredUsd = parseNumber(source.allocatedPaidUsd ?? source.coveredUsd ?? source.amount);
    const cappedCoveredUsd = parseNumber(source.coveredUsd);
    if (ordersUsd === null || coveredUsd === null) return false;
    target.ordersUsd = roundNumber((target.ordersUsd || 0) + ordersUsd);
    target.coveredUsd = roundNumber((target.coveredUsd || 0) + coveredUsd);
    target.cappedCoveredUsd = roundNumber((target.cappedCoveredUsd || 0) + (cappedCoveredUsd ?? Math.min(coveredUsd, ordersUsd)));
    target.rowCount = (target.rowCount || 0) + Number(source.rowCount || 1);
    return true;
  }

  function aggregateRawCoverageRows(rawRows = []) {
    const byChannel = new Map();
    (rawRows || []).forEach((row) => {
      if (!row || isExcludedCoverageRow(row)) return;
      const channel = getCoverageChannel(row);
      const existing = byChannel.get(channel) || { channel, ordersUsd: 0, coveredUsd: 0, cappedCoveredUsd: 0, rowCount: 0 };
      if (addCoverageRow(existing, row)) byChannel.set(channel, existing);
    });
    return Array.from(byChannel.values());
  }

  function mergeSummaryRowsWithRawRows(summaryRows = [], rawRows = []) {
    const rawByChannel = new Map(aggregateRawCoverageRows(rawRows).map((row) => [row.channel, row]));
    return (summaryRows || []).map((summaryRow) => {
      const channel = getCoverageChannel(summaryRow);
      const raw = rawByChannel.get(channel);
      const ordersUsd = parseNumber(summaryRow.ordersUsd ?? summaryRow.accruedOrdersUsd ?? summaryRow.totalAccruedOrdersUsd);
      const coveredUsd = parseNumber(summaryRow.allocatedPaidUsd ?? summaryRow.coveredUsd ?? summaryRow.amount);
      return {
        channel,
        ordersUsd: ordersUsd ?? raw?.ordersUsd ?? null,
        coveredUsd: coveredUsd ?? raw?.coveredUsd ?? null,
        cappedCoveredUsd: parseNumber(summaryRow.coveredUsd) ?? raw?.cappedCoveredUsd ?? null,
        rowCount: Number(summaryRow.rowCount || raw?.rowCount || 0),
      };
    });
  }

  function buildCoverageChannelRows(orderPaymentCoverage = {}) {
    const diagnostics = [];
    const summaryRows = Object.values(orderPaymentCoverage?.summaryByChannel || {});
    const rawRows = orderPaymentCoverage?.rows || [];
    const sourceRows = summaryRows.length
      ? mergeSummaryRowsWithRawRows(summaryRows, rawRows)
      : aggregateRawCoverageRows(rawRows);
    if (!sourceRows.length) {
      diagnostics.push("needs verification: source not found for order payment coverage by channel");
    }
    const totals = { ordersUsd: 0, coveredUsd: 0, differenceUsd: 0, cappedCoveredUsd: 0 };
    const rows = [];
    (sourceRows || []).forEach((sourceRow) => {
      const ordersUsd = parseNumber(sourceRow.ordersUsd);
      const coveredUsd = parseNumber(sourceRow.coveredUsd);
      if (ordersUsd === null || coveredUsd === null) {
        diagnostics.push(`needs verification: missing orders/coverage source for ${getCoverageChannel(sourceRow)}`);
        return;
      }
      const row = {
        channel: getCoverageChannel(sourceRow),
        ordersUsd: roundNumber(ordersUsd),
        coveredUsd: roundNumber(coveredUsd),
        differenceUsd: roundNumber(coveredUsd - ordersUsd),
        cappedCoveredUsd: roundNumber(parseNumber(sourceRow.cappedCoveredUsd) ?? Math.min(coveredUsd, ordersUsd)),
      };
      totals.ordersUsd = roundNumber(totals.ordersUsd + row.ordersUsd);
      totals.coveredUsd = roundNumber(totals.coveredUsd + row.coveredUsd);
      totals.differenceUsd = roundNumber(totals.differenceUsd + row.differenceUsd);
      totals.cappedCoveredUsd = roundNumber(totals.cappedCoveredUsd + row.cappedCoveredUsd);
      rows.push(row);
    });
    rows.forEach((row) => {
      row.percent = totals.coveredUsd > 0 ? roundNumber((row.coveredUsd / totals.coveredUsd) * 100) : 0;
    });
    return {
      rows: rows.sort((left, right) => Number(right.coveredUsd || 0) - Number(left.coveredUsd || 0)),
      totals: {
        ...totals,
        percent: rows.length && totals.coveredUsd > 0 ? 100 : 0,
      },
      diagnostics,
    };
  }

  function appendCell(rowNode, tag, text, doc) {
    const cell = doc.createElement(tag);
    cell.textContent = String(text);
    rowNode.appendChild(cell);
    return cell;
  }

  function renderCoverageTable(orderPaymentCoverage = {}, doc = root.document) {
    const { rows, totals, diagnostics } = buildCoverageChannelRows(orderPaymentCoverage);
    const table = doc.createElement("table");
    table.setAttribute?.("data-enhanced-by", ENHANCED_MARKER);
    const tbody = doc.createElement("tbody");
    const header = doc.createElement("tr");
    ["channel", "заказы USD", "покрыто USD", "разница USD", "%"].forEach((label) => appendCell(header, "th", label, doc));
    tbody.appendChild(header);
    rows.forEach((row) => {
      const tr = doc.createElement("tr");
      [row.channel, formatMoney(row.ordersUsd), formatMoney(row.coveredUsd), formatMoney(row.differenceUsd), formatSharePercent(row.percent)].forEach((value) => appendCell(tr, "td", value, doc));
      tbody.appendChild(tr);
    });
    if (rows.length) {
      const total = doc.createElement("tr");
      total.className = "balance-income-channel-total";
      ["Итого", formatMoney(totals.ordersUsd), formatMoney(totals.coveredUsd), formatMoney(totals.differenceUsd), formatSharePercent(totals.percent)].forEach((value) => appendCell(total, "td", value, doc));
      tbody.appendChild(total);
    }
    table.appendChild(tbody);
    return { table, diagnostics };
  }

  function getOrderPaymentCoverage() {
    const popupApi = root.EzohataBalanceSummaryPopup;
    if (typeof popupApi?.buildBalanceTextSummary === "function") {
      try {
        const summary = popupApi.buildBalanceTextSummary();
        if (summary?.orderPaymentCoverage) return summary.orderPaymentCoverage;
      } catch {
        // Fall through to direct state lookup.
      }
    }
    return root.state?.data?.realIncome?.orderPaymentCoverage || root.state?.realIncome?.orderPaymentCoverage || null;
  }

  function enhanceBalanceCoverageUi(doc = root.document, orderPaymentCoverage = getOrderPaymentCoverage()) {
    if (!doc || !orderPaymentCoverage) return false;
    const sections = Array.from(doc.querySelectorAll?.(`.${COVERAGE_SECTION_CLASS}`) || []);
    if (!sections.length) return false;
    let changed = false;
    sections.forEach((section) => {
      const existingTable = section.querySelector?.("table");
      if (!existingTable || existingTable.getAttribute?.("data-enhanced-by") === ENHANCED_MARKER) return;
      const { table, diagnostics } = renderCoverageTable(orderPaymentCoverage, doc);
      existingTable.parentNode?.replaceChild?.(table, existingTable);
      changed = true;
      if (diagnostics.length) {
        const diagnostic = doc.createElement("div");
        diagnostic.className = "balance-summary-diagnostics";
        diagnostic.textContent = diagnostics.join(" ");
        section.appendChild(diagnostic);
      }
    });
    return changed;
  }

  function bindEnhancer() {
    const doc = root.document;
    const schedule = () => root.setTimeout?.(() => enhanceBalanceCoverageUi(doc), 0);
    doc?.getElementById?.("balanceLauncherButton")?.addEventListener?.("click", schedule);
    if (typeof root.renderMetrics === "function" && !root.renderMetrics.__ezohataCoverageOrdersDiffPatched) {
      const original = root.renderMetrics;
      root.renderMetrics = function renderMetricsWithCoverageOrdersDiff(...args) {
        const result = original.apply(this, args);
        schedule();
        return result;
      };
      root.renderMetrics.__ezohataCoverageOrdersDiffPatched = true;
    }
    schedule();
  }

  const api = {
    buildCoverageChannelRows,
    renderCoverageTable,
    enhanceBalanceCoverageUi,
    bindEnhancer,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataBalanceCoverageOrdersDiffUi = api;
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", bindEnhancer);
  else bindEnhancer();
})(typeof globalThis !== "undefined" ? globalThis : window);
