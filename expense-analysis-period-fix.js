// Additive guard for Учёт расходов → анализ финансов.
// Keeps Ledger/provider real-income and expense fallbacks scoped to the currently selected date range.
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

  function wrapPeriodScopedSummary(name, guardFlag) {
    const original = window[name];
    if (typeof original !== "function" || original[guardFlag]) return;

    function periodScopedSummary(rows, rateLookup, options = {}, ...rest) {
      const period = getSelectedPeriod(options || {});
      const scopedRows = scopeRowsToPeriod(rows, period);
      return original.call(this, scopedRows, rateLookup, options, ...rest);
    }

    periodScopedSummary[guardFlag] = true;
    periodScopedSummary.__original = original;
    window[name] = periodScopedSummary;
  }

  wrapPeriodScopedSummary("buildLedgerProviderExpenseByChannel", "__expenseAnalysisPeriodGuard");
  wrapPeriodScopedSummary("buildLedgerRealIncomeSummaryByChannel", "__expenseAnalysisRealIncomePeriodGuard");

  window.EzohataExpenseAnalysisPeriodFix = {
    normalizeDateValue,
    getRowDate,
    getSelectedPeriod,
    isRowInPeriod,
    scopeRowsToPeriod,
  };
})();
