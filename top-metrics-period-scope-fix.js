// Additive guard for top summary metrics.
// Keeps "Мои услуги" / "Мои затраты" / "Прибыль" scoped to the selected date range.
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
      // This is built by the selected-period loader and should be preferred over rendered analytics fallbacks.
      { source: aggregated, rows: aggregated?.moneyRows || aggregated?.rows || [], trustRange: true },
      { source: analyticsFact, rows: analyticsFact?.moneyRows || [], trustRange: isExplicitlySelectedRange(analyticsFact, period) },
      { source: manualFinanceData, rows: manualFinanceData?.moneyRows || manualFinanceData?.rows || [], trustRange: isExplicitlySelectedRange(manualFinanceData, period) },
    ];

    for (const candidate of candidates) {
      const rows = filterRowsByPeriod(candidate.rows, period);
      if (!rows.length) continue;
      const hasRowDates = rows.some((row) => Boolean(getRowDate(row)));
      if (hasRowDates || candidate.trustRange || isExplicitlySelectedRange(candidate.source, period)) {
        return rows;
      }
    }
    return [];
  }

  function getScopedManualTotals() {
    if (typeof root.sumManualFinanceFieldUsdNumber !== "function" || typeof root.sumManualFinanceSpendUsdNumber !== "function") {
      return null;
    }
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
