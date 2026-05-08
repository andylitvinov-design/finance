(function (root) {
  const originalBuildTopMetricsSummary = root.buildTopMetricsSummary;
  if (typeof originalBuildTopMetricsSummary !== "function") return;

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseLooseNumber(value) {
    if (typeof root.parseLooseNumber === "function") return root.parseLooseNumber(value);
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function findHeaderIndexByAliases(header, aliases) {
    if (typeof root.findHeaderIndexByAliases === "function") {
      return root.findHeaderIndexByAliases(header, aliases);
    }
    const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
    return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
  }

  function isTotalRow(row) {
    const firstCell = normalizeCell(row?.[0]);
    return firstCell === "итого" || firstCell === "итого за период" || firstCell === "всего выплат";
  }

  function getRows(values) {
    return Array.isArray(values) ? values : [];
  }

  function normalizeDateKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const displayMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (displayMatch) {
      return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
    }
    return raw;
  }

  function getSelectedPeriod() {
    const startDate = root.elements?.startDate?.value || root.document?.querySelector?.("#startDate")?.value || "";
    const endDate = root.elements?.endDate?.value || root.document?.querySelector?.("#endDate")?.value || "";
    return {
      startDate: normalizeDateKey(startDate),
      endDate: normalizeDateKey(endDate),
    };
  }

  function isDateInSelectedPeriod(value) {
    const date = normalizeDateKey(value);
    const { startDate, endDate } = getSelectedPeriod();
    if (!date || (!startDate && !endDate)) return true;
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    return true;
  }

  function buildTransferTableFromObjects(rows) {
    return [
      ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
      ...getRows(rows).map((row) => [
        row?.transferDate || row?.date || "",
        row?.who || row?.fromAccount || "",
        row?.amount || "",
        row?.currency || row?.localCurrency || "",
        row?.channel || row?.destination || row?.toAccount || "",
        row?.rate || "",
        row?.usdAmount || row?.amountUsd || row?.amount_usd || "",
      ]),
    ];
  }

  function calculateUsdTotalFromPayoutTable(values) {
    const rows = getRows(values);
    if (!rows.length) return 0;
    if (root.EzohataAnalyticsPayoutsHelper?.calculatePayoutUsdTotalFromTable) {
      return root.EzohataAnalyticsPayoutsHelper.calculatePayoutUsdTotalFromTable(rows);
    }
    const header = rows[0] || [];
    const usdIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)", "сумма в долларах"]);
    if (usdIndex === -1) return 0;
    const totalRow = rows.slice(1).find(isTotalRow);
    if (totalRow) return parseLooseNumber(totalRow[usdIndex]);
    return rows.slice(1).reduce((sum, row) => sum + parseLooseNumber(row?.[usdIndex]), 0);
  }

  function calculatePayoutTransferUsdTotal(values) {
    const rows = getRows(values);
    if (!rows.length) return 0;
    const header = rows[0] || [];
    const destinationIndex = findHeaderIndexByAliases(header, [
      "канал куда",
      "PAYMENT METHOD",
      "DESTINATION",
      "payment method"
    ]);
    const usdIndex = findHeaderIndexByAliases(header, ["сумма в долларах", "AMOUNT (USD)"]);
    const amountIndex = findHeaderIndexByAliases(header, ["сумма", "СУММА ТЕКУЩАЯ"]);
    const rateIndex = findHeaderIndexByAliases(header, ["курс", "КУРС ПЕРЕВОДА"]);
    if (usdIndex === -1 && (amountIndex === -1 || rateIndex === -1)) return 0;

    const dateIndex = findHeaderIndexByAliases(header, ["дата перевода", "DATE", "date"]);

    return rows.slice(1).reduce((sum, row) => {
      if (!row || isTotalRow(row)) return sum;
      if (dateIndex !== -1 && !isDateInSelectedPeriod(row[dateIndex])) return sum;
      if (destinationIndex !== -1 && !String(row[destinationIndex] || "").trim()) return sum;
      const usd = usdIndex !== -1 ? parseLooseNumber(row[usdIndex]) : 0;
      if (usd) return sum + Math.abs(usd);
      const amount = amountIndex !== -1 ? parseLooseNumber(row[amountIndex]) : 0;
      const rate = rateIndex !== -1 ? parseLooseNumber(row[rateIndex]) : 0;
      return amount && rate ? sum + Math.abs(amount / rate) : sum;
    }, 0);
  }

  function applyPaidSign(currentPaid, additionalPaid) {
    if (!additionalPaid) return currentPaid;
    return currentPaid < 0 ? currentPaid - additionalPaid : currentPaid + additionalPaid;
  }

  root.calculateCurrentPayoutTransferUsdTotal = function calculateCurrentPayoutTransferUsdTotal() {
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
      const total = calculatePayoutTransferUsdTotal(table);
      if (total) return total;
    }
    return 0;
  };

  root.buildTopMetricsSummary = function buildTopMetricsSummaryWithPayoutTransfers() {
    const metrics = originalBuildTopMetricsSummary();
    const transferPaidUsd = root.calculateCurrentPayoutTransferUsdTotal();
    if (!transferPaidUsd) return metrics;

    const payoutRowsPaidUsd = Math.abs(calculateUsdTotalFromPayoutTable(root.state?.data?.tabs?.payouts?.values || []));
    const currentPaidAbs = Math.abs(parseLooseNumber(metrics.totalPaid));
    const expectedPaidAbs = payoutRowsPaidUsd + transferPaidUsd;

    if (expectedPaidAbs && currentPaidAbs >= expectedPaidAbs - 0.0001) {
      return metrics;
    }

    return {
      ...metrics,
      totalPaid: applyPaidSign(parseLooseNumber(metrics.totalPaid), transferPaidUsd),
      balance: parseLooseNumber(metrics.balance) - transferPaidUsd,
      total: parseLooseNumber(metrics.total) - transferPaidUsd,
      payoutTransfersPaidUsd: transferPaidUsd,
    };
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
