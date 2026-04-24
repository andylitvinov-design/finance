(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.EzohataAnalyticsPayoutsHelper = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TOTAL_LABEL = "Итого";

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseLooseNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatPayoutNumber(value) {
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function findHeaderIndexByAliases(header, aliases) {
    const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
    return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
  }

  function buildPayoutTotalRow(header, rows) {
    const width = Math.max(header.length, ...rows.map((row) => row.length), 1);
    const totalRow = Array.from({ length: width }, () => "");
    totalRow[0] = TOTAL_LABEL;
    const currentAmountIndex = findHeaderIndexByAliases(header, ["СУММА ТЕКУЩАЯ"]);
    const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)"]);
    if (currentAmountIndex !== -1) {
      totalRow[currentAmountIndex] = formatPayoutNumber(
        rows.reduce((sum, row) => sum + parseLooseNumber(row[currentAmountIndex]), 0)
      );
    }
    if (usdAmountIndex !== -1) {
      totalRow[usdAmountIndex] = formatPayoutNumber(
        rows.reduce((sum, row) => sum + parseLooseNumber(row[usdAmountIndex]), 0)
      );
    }
    return totalRow;
  }

  function calculatePayoutUsdTotalFromTable(values) {
    if (!Array.isArray(values) || !values.length) return 0;
    const header = values[0] || [];
    const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)"]);
    if (usdAmountIndex === -1) return 0;

    const summaryRow = values.slice(1).find((row) => {
      const firstCell = normalizeCell(row?.[0]);
      return firstCell === normalizeCell(TOTAL_LABEL) || firstCell === normalizeCell("итого за период");
    });
    if (summaryRow) {
      return parseLooseNumber(summaryRow[usdAmountIndex] || "");
    }

    return values.slice(1).reduce((sum, row) => sum + parseLooseNumber(row?.[usdAmountIndex] || ""), 0);
  }

  function calculatePayoutTotalsByChannel(values, channels) {
    const output = {};
    (channels || []).forEach((channel) => {
      output[channel] = { local: 0, usd: 0 };
    });
    if (!Array.isArray(values) || !values.length) return output;

    const header = values[0] || [];
    const paymentMethodIndex = findHeaderIndexByAliases(header, ["PAYMENT METHOD", "DESTINATION", "канал куда"]);
    const currentAmountIndex = findHeaderIndexByAliases(header, ["СУММА ТЕКУЩАЯ", "сумма"]);
    const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)", "сумма в долларах"]);
    if (paymentMethodIndex === -1 || usdAmountIndex === -1) return output;

    values.slice(1).forEach((row) => {
      if (!row || normalizeCell(row[0]) === normalizeCell(TOTAL_LABEL)) return;
      const paymentMethod = String(row[paymentMethodIndex] || "").trim();
      if (!paymentMethod) return;
      const channel = (channels || []).find((candidate) => normalizeCell(candidate) === normalizeCell(paymentMethod));
      if (!channel) return;
      output[channel] = output[channel] || { local: 0, usd: 0 };
      if (currentAmountIndex !== -1) output[channel].local += parseLooseNumber(row[currentAmountIndex]);
      output[channel].usd += parseLooseNumber(row[usdAmountIndex]);
    });

    return output;
  }

  function mapAnalyticsTopRows(manualRows) {
    return (manualRows || []).map((row) => [
      row.channel || "",
      row.now || "",
      row.serviceIncome || "",
      row.business || "",
      row.flat || "",
      row.food || "",
      row.fun || "",
      row.travel || "",
      row.total || "",
      row.exchange || "",
      row.totalUsd || "",
      row.nowUsd || ""
    ]);
  }

  return {
    TOTAL_LABEL,
    buildPayoutTotalRow,
    calculatePayoutTotalsByChannel,
    calculatePayoutUsdTotalFromTable,
    mapAnalyticsTopRows,
  };
});
