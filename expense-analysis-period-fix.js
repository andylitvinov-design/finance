// Additive guard for Учёт расходов → анализ финансов.
// Keeps Ledger/provider real-income, expense fallbacks, transfers/savings, and income counters scoped to the selected date range.
(function applyExpenseAnalysisPeriodFix() {
  if (typeof window === "undefined") return;

  function normalizeDateValue(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dotted = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (dotted) {
      const day = dotted[1].padStart(2, "0");
      const month = dotted[2].padStart(2, "0");
      return `${dotted[3]}-${month}-${day}`;
    }
    return raw.slice(0, 10);
  }

  function getRowDate(row) {
    if (!row || typeof row !== "object") return "";
    return normalizeDateValue(
      row.date ||
      row.operationDate ||
      row.operation_date ||
      row.transactionDate ||
      row.transaction_date ||
      row.postedDate ||
      row.posted_date ||
      row.createdAt ||
      row.created_at ||
      row.updatedAt ||
      row.updated_at ||
      ""
    );
  }

  function getDomDate(id) {
    if (typeof document === "undefined" || !document.getElementById) return "";
    return normalizeDateValue(document.getElementById(id)?.value || "");
  }

  function getSelectedPeriod(options = {}) {
    const startDate = normalizeDateValue(options.startDate || options.from || "") || getDomDate("startDate");
    const endDate = normalizeDateValue(options.endDate || options.to || "") || getDomDate("endDate");
    return { startDate, endDate };
  }

  function isRowInPeriod(row, period) {
    const date = getRowDate(row);
    if (!date) return true;
    if (period.startDate && date < period.startDate) return false;
    if (period.endDate && date > period.endDate) return false;
    return true;
  }

  function scopeRowsToPeriod(rows, period) {
    return Array.isArray(rows) && (period.startDate || period.endDate)
      ? rows.filter((row) => isRowInPeriod(row, period))
      : rows;
  }

  function wrapPeriodScopedSummary(name, guardFlag, optionsArgOffset = 1) {
    const original = window[name];
    if (typeof original !== "function" || original[guardFlag]) return;

    function periodScopedSummary(rows, ...args) {
      const periodOptions = args[optionsArgOffset] || {};
      const period = getSelectedPeriod(periodOptions);
      const scopedRows = scopeRowsToPeriod(rows, period);
      return original.call(this, scopedRows, ...args);
    }

    periodScopedSummary[guardFlag] = true;
    periodScopedSummary.__original = original;
    window[name] = periodScopedSummary;
  }

  function findDateColumnIndexFromHeader(header = []) {
    return (header || []).findIndex((cell) => {
      const normalized = String(cell || "").trim().toLowerCase();
      return normalized.includes("date") || normalized.includes("дата");
    });
  }

  function getSavingsHeaderRowIndex(values = []) {
    const limit = Math.min(3, values.length);
    for (let index = 0; index < limit; index += 1) {
      if (findDateColumnIndexFromHeader(values[index] || []) !== -1) return index;
    }
    return 0;
  }

  function isTotalLikeTableRow(row = []) {
    const firstCell = String(row?.[0] || "").trim().toLowerCase();
    return firstCell === "итого" || firstCell === "total";
  }

  function filterTableValuesToPeriod(values, startDate, endDate, headerRowIndex = 0) {
    if (!Array.isArray(values) || !values.length) return values || [];
    const header = values[headerRowIndex] || [];
    const dateIndex = findDateColumnIndexFromHeader(header);
    if (dateIndex === -1) return values.slice(headerRowIndex);
    const period = getSelectedPeriod({ startDate, endDate });
    const rows = values.slice(headerRowIndex + 1).filter((row) => {
      if (isTotalLikeTableRow(row)) return false;
      const date = normalizeDateValue(row?.[dateIndex]);
      if (!date) return false;
      if (period.startDate && date < period.startDate) return false;
      if (period.endDate && date > period.endDate) return false;
      return true;
    });
    return [header, ...rows];
  }

  function prepareSavingsValuesForSelectedPeriod(values, startDate, endDate) {
    if (!Array.isArray(values) || !values.length) return values || [];
    const headerRowIndex = getSavingsHeaderRowIndex(values);
    if (typeof window.filterStructuredTable === "function") {
      return window.filterStructuredTable(values, startDate, endDate, headerRowIndex);
    }
    return filterTableValuesToPeriod(values, startDate, endDate, headerRowIndex);
  }

  function installPrepareTabValuesGuard() {
    const original = window.prepareTabValues;
    if (typeof original !== "function") return false;
    if (original.__savingsPeriodScopeGuardInstalled) return true;

    function prepareTabValuesWithSavingsPeriodScope(tabId, values, startDate, endDate) {
      if (tabId === "savings") {
        return {
          values: prepareSavingsValuesForSelectedPeriod(values, startDate, endDate),
          headerRowIndex: 0,
          periodScoped: true
        };
      }
      return original.apply(this, arguments);
    }

    prepareTabValuesWithSavingsPeriodScope.__savingsPeriodScopeGuardInstalled = true;
    prepareTabValuesWithSavingsPeriodScope.__original = original;
    window.prepareTabValues = prepareTabValuesWithSavingsPeriodScope;
    return true;
  }

  function installBuildPreparedDashboardDataGuard() {
    const original = window.buildPreparedDashboardData;
    if (typeof original !== "function") return false;
    if (original.__savingsPeriodScopeGuardInstalled) return true;

    function buildPreparedDashboardDataWithSavingsPeriodScope(data, startDate, endDate) {
      const prepared = original.apply(this, arguments);
      const rawSavingsValues = data?.tabs?.savings?.values;
      if (prepared?.tabs?.savings && Array.isArray(rawSavingsValues)) {
        prepared.tabs.savings = {
          ...prepared.tabs.savings,
          values: prepareSavingsValuesForSelectedPeriod(rawSavingsValues, startDate, endDate),
          periodScoped: true
        };
      }
      return prepared;
    }

    buildPreparedDashboardDataWithSavingsPeriodScope.__savingsPeriodScopeGuardInstalled = true;
    buildPreparedDashboardDataWithSavingsPeriodScope.__original = original;
    window.buildPreparedDashboardData = buildPreparedDashboardDataWithSavingsPeriodScope;
    return true;
  }

  function installMainDashboardPeriodGuards() {
    return {
      prepareTabValues: installPrepareTabValuesGuard(),
      buildPreparedDashboardData: installBuildPreparedDashboardDataGuard()
    };
  }

  wrapPeriodScopedSummary("buildLedgerProviderExpenseByChannel", "__expenseAnalysisPeriodGuard", 1);
  wrapPeriodScopedSummary("buildLedgerRealIncomeSummaryByChannel", "__expenseAnalysisRealIncomePeriodGuard", 1);
  wrapPeriodScopedSummary("buildLedgerIncomeCountSummaryByChannel", "__expenseAnalysisIncomeCountPeriodGuard", 0);
  installMainDashboardPeriodGuards();
  if (typeof window.setTimeout === "function") {
    window.setTimeout(installMainDashboardPeriodGuards, 0);
    window.setTimeout(installMainDashboardPeriodGuards, 50);
  }

  window.EzohataExpenseAnalysisPeriodFix = {
    normalizeDateValue,
    getRowDate,
    getSelectedPeriod,
    isRowInPeriod,
    scopeRowsToPeriod,
    findDateColumnIndexFromHeader,
    getSavingsHeaderRowIndex,
    filterTableValuesToPeriod,
    prepareSavingsValuesForSelectedPeriod,
    installMainDashboardPeriodGuards,
  };
})();
