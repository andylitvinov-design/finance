// Restores services_me top metric and prevents payout-transfer double counting.
// Scope: UI/top metrics + payouts helper only. Does not change Ledger/provider/balance semantics.
(function initTopMetricServicesPayoutDedupeFix(root) {
  "use strict";

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") return root.parseLooseNumber(value);
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatNumber(value) {
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value, 4);
    return String(Math.round((Number(value) || 0) * 10000) / 10000).replace(".", ",");
  }

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeDate(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const display = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
    return raw.slice(0, 10);
  }

  function getSelectedPeriod() {
    return {
      startDate: normalizeDate(root.elements?.startDate?.value || root.document?.getElementById?.("startDate")?.value || ""),
      endDate: normalizeDate(root.elements?.endDate?.value || root.document?.getElementById?.("endDate")?.value || ""),
    };
  }

  function isDateInPeriod(date, period = getSelectedPeriod()) {
    const normalized = normalizeDate(date);
    if (!normalized) return true;
    if (period.startDate && normalized < period.startDate) return false;
    if (period.endDate && normalized > period.endDate) return false;
    return true;
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

  function amountKey(date, amountUsd) {
    const amount = Math.round(Math.abs(parseNumber(amountUsd)) * 10000) / 10000;
    if (!date || !amount) return "";
    return `${normalizeDate(date)}|${amount.toFixed(4)}`;
  }

  function buildPayoutPaidKeys() {
    const values = root.state?.data?.tabs?.payouts?.values || [];
    if (!Array.isArray(values) || values.length < 2) return new Set();
    const header = values[0] || [];
    const dateIndex = findHeaderIndex(header, ["date", "DATE", "дата"]);
    const usdIndex = findHeaderIndex(header, ["AMOUNT (USD)", "сумма в долларах", "amount_usd", "usd"]);
    if (dateIndex === -1 || usdIndex === -1) return new Set();
    const keys = new Set();
    values.slice(1).forEach((row) => {
      if (!row || isTotalRow(row)) return;
      const date = row[dateIndex];
      if (!isDateInPeriod(date)) return;
      const key = amountKey(date, row[usdIndex]);
      if (key) keys.add(key);
    });
    return keys;
  }

  function transferObjectToRow(row) {
    return [
      row?.transferDate || row?.date || "",
      row?.who || row?.fromAccount || "",
      row?.amount || "",
      row?.currency || row?.localCurrency || "",
      row?.channel || row?.destination || row?.toAccount || "",
      row?.rate || "",
      row?.usdAmount || row?.amountUsd || row?.amount_usd || "",
    ];
  }

  function buildTransferTableFromObjects(rows) {
    return [
      ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
      ...(Array.isArray(rows) ? rows : []).map(transferObjectToRow),
    ];
  }

  function calculateDedupedTransferTotal(table, payoutKeys = buildPayoutPaidKeys()) {
    const rows = Array.isArray(table) ? table : [];
    if (!rows.length) return 0;
    const header = rows[0] || [];
    const dateIndex = findHeaderIndex(header, ["дата перевода", "DATE", "date"]);
    const destinationIndex = findHeaderIndex(header, ["канал куда", "PAYMENT METHOD", "DESTINATION", "payment method"]);
    const usdIndex = findHeaderIndex(header, ["сумма в долларах", "AMOUNT (USD)", "amount_usd"]);
    const amountIndex = findHeaderIndex(header, ["сумма", "СУММА ТЕКУЩАЯ", "amount"]);
    const rateIndex = findHeaderIndex(header, ["курс", "КУРС ПЕРЕВОДА", "rate"]);
    if (usdIndex === -1 && (amountIndex === -1 || rateIndex === -1)) return 0;

    return rows.slice(1).reduce((sum, row) => {
      if (!row || isTotalRow(row)) return sum;
      const date = dateIndex === -1 ? "" : row[dateIndex];
      if (dateIndex !== -1 && !isDateInPeriod(date)) return sum;
      if (destinationIndex !== -1 && !String(row[destinationIndex] || "").trim()) return sum;
      const usd = usdIndex !== -1 ? parseNumber(row[usdIndex]) : 0;
      const amount = usd || (parseNumber(row[amountIndex]) && parseNumber(row[rateIndex]) ? parseNumber(row[amountIndex]) / parseNumber(row[rateIndex]) : 0);
      if (!amount) return sum;
      const key = amountKey(date, amount);
      if (key && payoutKeys.has(key)) return sum;
      return sum + Math.abs(amount);
    }, 0);
  }

  function patchPayoutTransferTotal() {
    if (root.calculateCurrentPayoutTransferUsdTotal?.__dedupedAgainstPayoutRows) return false;
    const patched = function calculateCurrentPayoutTransferUsdTotalDeduped() {
      const payoutKeys = buildPayoutPaidKeys();
      const candidateTables = [
        buildTransferTableFromObjects(root.state?.manualTransfers?.data?.transferRows || []),
        buildTransferTableFromObjects(root.state?.aggregatedManualRange?.transferRows || []),
        root.state?.data?.tabs?.payouts?.closedFactTransfers?.length
          ? [["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"], ...root.state.data.tabs.payouts.closedFactTransfers]
          : [],
        buildTransferTableFromObjects(root.state?.manualFinance?.data?.transferRows || []),
        buildTransferTableFromObjects(root.state?.data?.manual?.transfers || []),
        root.state?.data?.tabs?.savings?.values || [],
      ];
      for (const table of candidateTables) {
        const total = calculateDedupedTransferTotal(table, payoutKeys);
        if (total) return total;
      }
      return 0;
    };
    patched.__dedupedAgainstPayoutRows = true;
    root.calculateCurrentPayoutTransferUsdTotal = patched;
    return true;
  }

  function getServicesMeTotal() {
    const layer = root.EzohataServiceInLayer;
    if (typeof layer?.collectLedgerRows !== "function" || typeof layer?.buildServiceInIncomeLookup !== "function") return 0;
    const period = getSelectedPeriod();
    const rows = layer.collectLedgerRows().filter((row) => isDateInPeriod(row?.date || row?.operationDate || row?.transactionDate || "", period));
    return parseNumber(layer.buildServiceInIncomeLookup(rows)?.total);
  }

  function patchTopMetricsServicesMe() {
    if (typeof root.buildTopMetricsSummary !== "function" || root.buildTopMetricsSummary.__servicesMeTopMetricPatched) return false;
    const original = root.buildTopMetricsSummary;
    const patched = function buildTopMetricsSummaryWithServicesMe(...args) {
      const metrics = original.apply(this, args) || {};
      const servicesMeTotal = getServicesMeTotal();
      const currentServices = parseNumber(metrics.myServices);
      if (!servicesMeTotal || currentServices >= servicesMeTotal - 0.0001) return metrics;
      const delta = servicesMeTotal - currentServices;
      return {
        ...metrics,
        myServices: servicesMeTotal,
        profit: parseNumber(metrics.profit) + delta,
        servicesMeTopMetricRestored: true,
      };
    };
    patched.__servicesMeTopMetricPatched = true;
    patched.__original = original;
    root.buildTopMetricsSummary = patched;
    return true;
  }

  function syncServicesBadgeFromSummary() {
    if (typeof root.buildTopMetricsSummary !== "function") return false;
    const summary = root.buildTopMetricsSummary();
    const node = root.document?.getElementById?.("metricMyServices");
    if (!node) return false;
    const value = parseNumber(summary.myServices);
    if (!value) return false;
    node.textContent = `Мои услуги: ${formatNumber(value)}`;
    node.dataset.displaySource = summary.servicesMeTopMetricRestored ? "services_me_ledger" : "buildTopMetricsSummary.myServices";
    return true;
  }

  function install() {
    patchPayoutTransferTotal();
    patchTopMetricsServicesMe();
    root.setTimeout?.(syncServicesBadgeFromSummary, 0);
  }

  function start() {
    install();
    [100, 500, 1200, 2500].forEach((delay) => root.setTimeout?.(() => {
      install();
      syncServicesBadgeFromSummary();
    }, delay));
  }

  start();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else root.setTimeout?.(start, 0);

  root.EzohataTopMetricServicesPayoutDedupeFix = {
    normalizeDate,
    buildPayoutPaidKeys,
    calculateDedupedTransferTotal,
    patchPayoutTransferTotal,
    getServicesMeTotal,
    patchTopMetricsServicesMe,
    syncServicesBadgeFromSummary,
    start,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
