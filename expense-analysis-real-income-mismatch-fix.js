// ============================================================
// EXPENSE ANALYSIS REAL INCOME MISMATCH FIX
// ============================================================
// Provider/API real income is the source of truth when present.
// Ledger fallback is only a fallback/diagnostic. For non-USD rows where
// Ledger USD was derived from a local currency rate, a difference against
// provider USD/net is expected and should not be emitted as console.warn noise.

(function installExpenseAnalysisRealIncomeMismatchFix() {
  if (typeof window === "undefined") return;
  if (window.__expenseAnalysisRealIncomeMismatchFixInstalled) return;
  window.__expenseAnalysisRealIncomeMismatchFixInstalled = true;

  const originalBuildLedgerRealIncomeSummaryByChannel = window.buildLedgerRealIncomeSummaryByChannel;
  const originalMergeExpenseAnalysisRealIncomeSummaryByChannel = window.mergeExpenseAnalysisRealIncomeSummaryByChannel;
  if (typeof originalBuildLedgerRealIncomeSummaryByChannel !== "function") return;
  if (typeof originalMergeExpenseAnalysisRealIncomeSummaryByChannel !== "function") return;

  function getIsoDate(value) {
    if (typeof normalizeIncomingSheetDateValue === "function") return normalizeIncomingSheetDateValue(value || "");
    return String(value || "").slice(0, 10);
  }

  function getRoundAmount(value) {
    if (typeof roundProviderSummaryAmount === "function") return roundProviderSummaryAmount(value);
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  function getNumber(value) {
    if (typeof parseLooseNumber === "function") return parseLooseNumber(value);
    const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isKnownProviderIncome(row) {
    return typeof isLedgerProviderIncomeSource === "function" && isLedgerProviderIncomeSource(row);
  }

  function isKnownProviderNonIncome(row) {
    return typeof isLedgerProviderNonIncomeRow === "function" && isLedgerProviderNonIncomeRow(row);
  }

  function getOperation(row) {
    return typeof getNormalizedLedgerFactOperation === "function"
      ? getNormalizedLedgerFactOperation(row)
      : String(row?.operation || "").trim().toLowerCase();
  }

  function getIncomeChannel(row) {
    return typeof getLedgerIncomeChannel === "function" ? getLedgerIncomeChannel(row) : "";
  }

  function buildLedgerRealIncomeDerivationMeta(rows = [], period = {}) {
    const startDate = getIsoDate(period?.startDate || "");
    const endDate = getIsoDate(period?.endDate || "");
    const channels = Array.isArray(window.MANUAL_FINANCE_MONEY_CHANNELS)
      ? window.MANUAL_FINANCE_MONEY_CHANNELS
      : [];
    const meta = Object.fromEntries(channels.map((channel) => [channel, {
      explicitUsdRows: 0,
      rateDerivedRows: 0,
    }]));

    (rows || []).forEach((row) => {
      const date = getIsoDate(row?.date || "");
      if ((startDate || endDate) && !date) return;
      if (startDate && date < startDate) return;
      if (endDate && date > endDate) return;
      if (!isKnownProviderIncome(row)) return;
      if (isKnownProviderNonIncome(row)) return;
      if (!["income", "servicein", "ezoin"].includes(getOperation(row))) return;
      const channel = getIncomeChannel(row);
      if (!channel || !meta[channel]) return;
      const amountUsdRaw = String(row?.amountUsd ?? row?.amount_usd ?? "").trim();
      const hasExplicitUsd = amountUsdRaw && Math.abs(getNumber(amountUsdRaw)) > 0;
      if (hasExplicitUsd) {
        meta[channel].explicitUsdRows += 1;
      } else {
        meta[channel].rateDerivedRows += 1;
      }
    });
    return meta;
  }

  function isExpectedRateDerivedFallbackMismatch(apiSummary, ledgerSummary) {
    const currency = String(apiSummary?.currency || ledgerSummary?.currency || "").trim().toUpperCase();
    if (!currency || currency === "USD") return false;
    return Number(ledgerSummary?.rateDerivedRows || 0) > 0 && Number(ledgerSummary?.explicitUsdRows || 0) === 0;
  }

  function hasExpenseAnalysisRealIncomeValue(summary) {
    const value = summary?.realNetUsd;
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  window.buildLedgerRealIncomeSummaryByChannel = function patchedBuildLedgerRealIncomeSummaryByChannel(rows, usdRateLookup = { byChannel: {}, byCurrency: {} }, period = {}) {
    const summary = originalBuildLedgerRealIncomeSummaryByChannel.call(this, rows, usdRateLookup, period) || {};
    const meta = buildLedgerRealIncomeDerivationMeta(rows, period);
    Object.entries(meta).forEach(([channel, rowMeta]) => {
      if (!summary[channel]) return;
      summary[channel] = { ...summary[channel], ...rowMeta };
    });
    return summary;
  };

  window.mergeExpenseAnalysisRealIncomeSummaryByChannel = function patchedMergeExpenseAnalysisRealIncomeSummaryByChannel(apiSummaryByChannel = {}, ledgerSummaryByChannel = {}, period = {}) {
    const merged = { ...(apiSummaryByChannel || {}) };
    Object.entries(ledgerSummaryByChannel || {}).forEach(([channel, ledgerSummary]) => {
      const ledgerAmount = getRoundAmount(ledgerSummary?.realNetUsd);
      if (ledgerAmount <= 0) return;
      const apiSummary = merged[channel];
      if (!hasExpenseAnalysisRealIncomeValue(apiSummary)) {
        merged[channel] = ledgerSummary;
        return;
      }
      const apiAmount = getRoundAmount(apiSummary?.realNetUsd);
      if (apiAmount !== ledgerAmount && !isExpectedRateDerivedFallbackMismatch(apiSummary, ledgerSummary) && typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[expense-analysis] API real income summary differs from Ledger fallback", {
          channel,
          apiRealNetUsd: apiAmount,
          ledgerRealNetUsd: ledgerAmount,
          startDate: period?.startDate || "",
          endDate: period?.endDate || ""
        });
      }
    });
    return merged;
  };
})();
