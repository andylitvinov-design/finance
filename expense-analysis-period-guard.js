(function (root) {
  function parseIsoDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`);
    const displayMatch = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (displayMatch) {
      const [, day, month, year] = displayMatch;
      return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`);
    }
    return null;
  }

  function getSelectedPeriodOptions(options = {}) {
    const startDate = String(options.startDate || root.elements?.startDate?.value || "").trim();
    const endDate = String(options.endDate || root.elements?.endDate?.value || "").trim();
    return { ...options, startDate, endDate };
  }

  function rowDateValue(row) {
    if (!row || typeof row !== "object") return "";
    return row.date || row.operationDate || row.transactionDate || row.postedDate || row.createdAt || row.created_at || "";
  }

  function isRowInSelectedPeriod(row, options = {}) {
    const { startDate, endDate } = getSelectedPeriodOptions(options);
    if (!startDate && !endDate) return true;
    const parsed = parseIsoDate(rowDateValue(row));
    if (!parsed) return true;
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    if (start && parsed < start) return false;
    if (end && parsed > end) return false;
    return true;
  }

  function filterRowsBySelectedPeriod(rows, options = {}) {
    if (!Array.isArray(rows)) return rows;
    const periodOptions = getSelectedPeriodOptions(options);
    if (!periodOptions.startDate && !periodOptions.endDate) return rows;
    return rows.filter((row) => isRowInSelectedPeriod(row, periodOptions));
  }

  function wrapSummaryFunction(name) {
    const original = root[name];
    if (typeof original !== "function" || original.__periodGuarded) return;
    const wrapped = function expenseAnalysisPeriodGuardedSummary(rows, rateLookup, options = {}) {
      const periodOptions = getSelectedPeriodOptions(options || {});
      const filteredRows = filterRowsBySelectedPeriod(rows, periodOptions);
      return original.call(this, filteredRows, rateLookup, periodOptions);
    };
    wrapped.__periodGuarded = true;
    root[name] = wrapped;
  }

  wrapSummaryFunction("buildLedgerRealIncomeSummaryByChannel");
  wrapSummaryFunction("buildLedgerProviderExpenseByChannel");

  root.EzohataExpenseAnalysisPeriodGuard = {
    getSelectedPeriodOptions,
    isRowInSelectedPeriod,
    filterRowsBySelectedPeriod,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
