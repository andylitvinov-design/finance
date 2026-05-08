// Additive guard for Учёт расходов → анализ финансов.
// Keeps Ledger/provider expense fallback scoped to the currently selected date range.
(function applyExpenseAnalysisPeriodFix() {
  if (typeof window === "undefined") return;
  const original = window.buildLedgerProviderExpenseByChannel;
  if (typeof original !== "function" || original.__expenseAnalysisPeriodGuard) return;

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
      row.transactionDate ||
      row.postedDate ||
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

  function patchedBuildLedgerProviderExpenseByChannel(rows, rateLookup, options = {}, ...rest) {
    const period = getSelectedPeriod(options || {});
    const scopedRows = Array.isArray(rows) && (period.startDate || period.endDate)
      ? rows.filter((row) => isRowInPeriod(row, period))
      : rows;
    return original.call(this, scopedRows, rateLookup, options, ...rest);
  }

  patchedBuildLedgerProviderExpenseByChannel.__expenseAnalysisPeriodGuard = true;
  patchedBuildLedgerProviderExpenseByChannel.__original = original;
  window.buildLedgerProviderExpenseByChannel = patchedBuildLedgerProviderExpenseByChannel;
})();
