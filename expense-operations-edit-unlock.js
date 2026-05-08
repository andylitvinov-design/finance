// Minimal safety patch for imported Ledger rows in Expense Accounting → Operations.
// Root cause: some provider/import rows (YooMoney) are rendered from the Ledger
// but their operation action buttons can remain disabled by the UI guard even
// when the row is a physical Ledger row and the edit/delete handlers are bound.
// This patch only unlocks actions for visible YooMoney rows after UI rendering;
// it does not change amount/gross/net/fee/balance semantics.

(function expenseOperationsEditUnlock() {
  const TARGET_SOURCES = new Set(["yoomoney"]);
  const ACTION_TEXT_RE = /^(редактировать|удалить)$/i;
  let scheduled = false;

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function isExpenseOperationsViewActive() {
    const activeSubtabs = Array.from(document.querySelectorAll(".expense-subtab.active"));
    return activeSubtabs.some((node) => normalize(node.textContent) === "операции");
  }

  function isTargetProviderRow(row) {
    const firstCell = row?.querySelector?.("td");
    return TARGET_SOURCES.has(normalize(firstCell?.textContent));
  }

  function unlockRowActionButtons(row) {
    let changed = false;
    for (const button of Array.from(row.querySelectorAll("button"))) {
      if (!ACTION_TEXT_RE.test(normalize(button.textContent))) continue;
      if (!button.disabled) continue;
      button.disabled = false;
      button.removeAttribute("aria-disabled");
      button.title = "Доступно: строка YooMoney уже находится в Ledger.";
      changed = true;
    }
    return changed;
  }

  function unlockYooMoneyOperationActions() {
    scheduled = false;
    if (window.state?.expenseAccounting?.loading) return;
    if (!isExpenseOperationsViewActive()) return;

    let changed = 0;
    for (const row of Array.from(document.querySelectorAll("table tr"))) {
      if (!isTargetProviderRow(row)) continue;
      if (unlockRowActionButtons(row)) changed += 1;
    }

    if (changed && window.state?.expenseAccounting) {
      const currentStatus = String(window.state.expenseAccounting.status || "").trim();
      if (!/yoomoney.+редакт/i.test(currentStatus)) {
        window.state.expenseAccounting.status = currentStatus || "YooMoney операции из Ledger доступны для редактирования.";
      }
    }
  }

  function scheduleUnlock() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(unlockYooMoneyOperationActions);
    setTimeout(unlockYooMoneyOperationActions, 0);
  }

  const originalRenderTabs = window.renderTabs;
  if (typeof originalRenderTabs === "function") {
    window.renderTabs = function renderTabsWithExpenseOperationUnlock(...args) {
      const result = originalRenderTabs.apply(this, args);
      scheduleUnlock();
      return result;
    };
  }

  const observer = new MutationObserver(scheduleUnlock);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleUnlock, { once: true });
  } else {
    scheduleUnlock();
  }
})();
