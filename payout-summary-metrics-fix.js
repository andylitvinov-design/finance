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

  function normalizeRowText(row) {
    return (row || []).map(normalizeCell).join(" ");
  }

  function isKovalevNotMineWiseTransfer(row) {
    const text = normalizeRowText(row);
    const hasKovalev = text.includes("сергей ковалев") || text.includes("ковалев");
    const hasNemisha = text.includes("немиша");
    const hasNotMine = text.includes("не мне") || text.includes("not mine");
    const hasWiseBoleslav = /wise\s*@?bol(?:e|ie)slav/.test(text) || text.includes("wise boleslav usd");
    return hasKovalev && hasNemisha && hasNotMine && hasWiseBoleslav;
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
      if (isKovalevNotMineWiseTransfer(row)) return sum;
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

(function applyTopMetricsPeriodScopeFix(root) {
  if (!root || typeof root.buildTopMetricsSummary !== "function") return;
  if (root.buildTopMetricsSummary.__topMetricsPeriodScopeGuard) return;

  const originalBuildTopMetricsSummary = root.buildTopMetricsSummary;

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") return root.parseLooseNumber(value);
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function normalizeDateKey(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const display = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (display) {
      return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
    }
    return raw.slice(0, 10);
  }

  function getSelectedPeriod() {
    return {
      startDate: normalizeDateKey(
        root.elements?.startDate?.value ||
        root.document?.getElementById?.("startDate")?.value ||
        root.state?.analyticsFact?.periodStart ||
        ""
      ),
      endDate: normalizeDateKey(
        root.elements?.endDate?.value ||
        root.document?.getElementById?.("endDate")?.value ||
        root.state?.analyticsFact?.periodEnd ||
        ""
      ),
    };
  }

  function getRowDate(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return "";
    return normalizeDateKey(
      row.date ||
      row.operationDate ||
      row.transactionDate ||
      row.transferDate ||
      row.createdAt ||
      row.created_at ||
      row.updatedAt ||
      row.updated_at ||
      ""
    );
  }

  function isDateInPeriod(date, period) {
    if (!date) return true;
    if (period.startDate && date < period.startDate) return false;
    if (period.endDate && date > period.endDate) return false;
    return true;
  }

  function filterRowsByPeriod(rows, period) {
    const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (!sourceRows.length) return [];
    const hasRowDates = sourceRows.some((row) => Boolean(getRowDate(row)));
    if (!hasRowDates) return sourceRows;
    return sourceRows.filter((row) => isDateInPeriod(getRowDate(row), period));
  }

  function isExplicitlySelectedRange(source, period) {
    if (!source || typeof source !== "object") return false;
    const sourceStart = normalizeDateKey(source.periodStart || source.startDate || source.from || source.dateFrom || "");
    const sourceEnd = normalizeDateKey(source.periodEnd || source.endDate || source.to || source.dateTo || "");
    return Boolean(
      sourceStart &&
      sourceEnd &&
      (!period.startDate || sourceStart === period.startDate) &&
      (!period.endDate || sourceEnd === period.endDate)
    );
  }

  function getRowsFromSelectedRangeSource(period) {
    const aggregated = root.state?.aggregatedManualRange;
    const analyticsFact = root.state?.analyticsFact;
    const manualFinanceData = root.state?.manualFinance?.data;
    const candidates = [
      { source: aggregated, rows: aggregated?.moneyRows || aggregated?.rows || [], trustRange: true },
      { source: analyticsFact, rows: analyticsFact?.moneyRows || [], trustRange: isExplicitlySelectedRange(analyticsFact, period) },
      { source: manualFinanceData, rows: manualFinanceData?.moneyRows || manualFinanceData?.rows || [], trustRange: isExplicitlySelectedRange(manualFinanceData, period) },
    ];
    for (const candidate of candidates) {
      const rows = filterRowsByPeriod(candidate.rows, period);
      if (!rows.length) continue;
      const hasRowDates = rows.some((row) => Boolean(getRowDate(row)));
      if (hasRowDates || candidate.trustRange || isExplicitlySelectedRange(candidate.source, period)) return rows;
    }
    return [];
  }

  function getScopedManualTotals() {
    if (typeof root.sumManualFinanceFieldUsdNumber !== "function" || typeof root.sumManualFinanceSpendUsdNumber !== "function") return null;
    const period = getSelectedPeriod();
    const rows = getRowsFromSelectedRangeSource(period);
    if (!rows.length) return null;
    const transferRows = root.state?.aggregatedManualRange?.transferRows || root.state?.analyticsFact?.transferRows || [];
    const movementValues = root.state?.data?.tabs?.movement?.values || [];
    const rateLookup = typeof root.buildManualFinanceUsdRateLookup === "function"
      ? root.buildManualFinanceUsdRateLookup(transferRows, movementValues, { endDate: period.endDate })
      : { byChannel: {}, byCurrency: {} };
    return {
      myServices: root.sumManualFinanceFieldUsdNumber(rows, "serviceIncome", rateLookup),
      myCosts: root.sumManualFinanceSpendUsdNumber(rows, rateLookup),
      rowsCount: rows.length,
    };
  }

  function applyScopedTotals(metrics, scoped) {
    if (!scoped) return metrics;
    const previousProfit = parseNumber(metrics?.profit);
    const previousServices = parseNumber(metrics?.myServices);
    const previousCosts = parseNumber(metrics?.myCosts);
    const nextServices = parseNumber(scoped.myServices);
    const nextCosts = parseNumber(scoped.myCosts);
    return {
      ...metrics,
      myServices: nextServices,
      myCosts: nextCosts,
      profit: previousProfit - previousServices + previousCosts + nextServices - nextCosts,
      topMetricsPeriodScoped: true,
      topMetricsPeriodScopedRows: scoped.rowsCount,
    };
  }

  function buildTopMetricsSummaryPeriodScoped() {
    const metrics = originalBuildTopMetricsSummary.apply(this, arguments);
    const scoped = getScopedManualTotals();
    return applyScopedTotals(metrics, scoped);
  }

  buildTopMetricsSummaryPeriodScoped.__topMetricsPeriodScopeGuard = true;
  buildTopMetricsSummaryPeriodScoped.__original = originalBuildTopMetricsSummary;
  root.buildTopMetricsSummary = buildTopMetricsSummaryPeriodScoped;
  root.__EzohataTopMetricsPeriodScopeFix = {
    normalizeDateKey,
    filterRowsByPeriod,
    getSelectedPeriod,
    getRowsFromSelectedRangeSource,
    getScopedManualTotals,
    applyScopedTotals,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
