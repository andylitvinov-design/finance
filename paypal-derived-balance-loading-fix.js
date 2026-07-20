// UI-only lifecycle fix for PayPal derived-balance requests.
// Does not change provider, Ledger, balance, or persistence semantics.
(function initPayPalDerivedBalanceLoadingFix(root) {
  "use strict";

  const TIMEOUT_MS = 30000;

  function createPayPalDerivedBalanceRunner(deps = {}) {
    const {
      normalizeDate,
      getStartDate,
      getEndDate,
      expenseState,
      setStatus,
      render,
      fetchImpl,
      loadDashboard,
      AbortControllerImpl,
      setTimeoutImpl,
      clearTimeoutImpl,
    } = deps;

    return async function runPayPalDerivedBalanceSnapshotFixed() {
      const date = normalizeDate(getEndDate() || getStartDate());
      if (!date) {
        setStatus("Выберите дату для расчета PayPal остатков.", true);
        render();
        return;
      }

      expenseState.paypalDerivedBalanceLoading = true;
      setStatus("Рассчитываю PayPal остатки по Ledger движениям...", false);
      render();

      const controller = typeof AbortControllerImpl === "function"
        ? new AbortControllerImpl()
        : null;
      const timeoutId = controller && typeof setTimeoutImpl === "function"
        ? setTimeoutImpl(() => controller.abort(), TIMEOUT_MS)
        : null;

      try {
        const fetchOptions = controller ? { signal: controller.signal } : undefined;
        const response = await fetchImpl(
          `./api/auto-balance-snapshots?date=${encodeURIComponent(date)}`,
          fetchOptions
        );
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) {
          throw new Error(result?.error || `PayPal auto balance failed (${response.status}).`);
        }

        const paypal = (result.provider_results || []).find((item) => item.provider === "paypal") || {};
        if (paypal.provider_current_balance_status === "needs_initial_paypal_balance") {
          expenseState.paypalManualBalanceRequired = true;
          setStatus(
            "Введите один подтвержденный PayPal остаток вручную; после этого следующие даты будут рассчитаны автоматически.",
            false
          );
        } else {
          setStatus(`PayPal авто-остатки: ${paypal.writable_rows || 0} строк. Обновляю сверку...`, false);
        }

        if (typeof loadDashboard === "function") {
          await loadDashboard();
        } else {
          render();
        }
      } catch (error) {
        const message = error?.name === "AbortError"
          ? "Не удалось рассчитать PayPal остатки автоматически: API не ответил за 30 секунд."
          : (error?.message || "Не удалось рассчитать PayPal остатки автоматически.");
        setStatus(message, true);
        render();
      } finally {
        if (timeoutId !== null && typeof clearTimeoutImpl === "function") {
          clearTimeoutImpl(timeoutId);
        }
        expenseState.paypalDerivedBalanceLoading = false;
        render();
      }
    };
  }

  function install() {
    if (
      typeof runPayPalDerivedBalanceSnapshot !== "function" ||
      typeof state === "undefined" ||
      typeof elements === "undefined" ||
      typeof normalizeIncomingSheetDateValue !== "function" ||
      typeof setExpenseAccountingStatus !== "function" ||
      typeof renderTabs !== "function" ||
      typeof root.fetch !== "function"
    ) {
      return false;
    }

    runPayPalDerivedBalanceSnapshot = createPayPalDerivedBalanceRunner({
      normalizeDate: normalizeIncomingSheetDateValue,
      getStartDate: () => elements.startDate.value,
      getEndDate: () => elements.endDate.value,
      expenseState: state.expenseAccounting,
      setStatus: setExpenseAccountingStatus,
      render: renderTabs,
      fetchImpl: root.fetch.bind(root),
      loadDashboard: typeof loadDashboardDataDeduped === "function" ? loadDashboardDataDeduped : null,
      AbortControllerImpl: root.AbortController,
      setTimeoutImpl: typeof root.setTimeout === "function" ? root.setTimeout.bind(root) : null,
      clearTimeoutImpl: typeof root.clearTimeout === "function" ? root.clearTimeout.bind(root) : null,
    });
    return true;
  }

  const api = {
    TIMEOUT_MS,
    createPayPalDerivedBalanceRunner,
    install,
  };

  if (root) root.EzohataPayPalDerivedBalanceLoadingFix = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  install();
})(typeof globalThis !== "undefined" ? globalThis : window);
