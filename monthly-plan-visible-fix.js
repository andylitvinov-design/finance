// ============================================================
// MONTHLY PLAN TAB VISIBILITY GUARD
// ============================================================

(function installMonthlyPlanVisibilityGuard() {
  const MONTHLY_PLAN_TAB_ID = "monthlyPlan";
  const MONTHLY_PLAN_LABEL = "План";

  function hasRequiredGlobals() {
    return typeof state !== "undefined" &&
      typeof elements !== "undefined" &&
      elements.tabs &&
      elements.tabPanels &&
      typeof renderMonthlyPlanBlock === "function";
  }

  function insertMonthlyPlanExpenseBalance(block) {
    const renderer = globalThis.MonthlyPlanExpenseBalance?.renderMonthlyPlanExpenseBalance;
    if (!block || typeof renderer !== "function") return false;
    block.querySelector?.("#monthly-plan-expense-balance")?.remove();
    const section = renderer();
    const status = block.querySelector?.(".finance-status");
    if (status?.parentNode) status.parentNode.insertBefore(section, status.nextSibling);
    else block.prepend(section);
    return true;
  }

  function renderMonthlyPlanPanel() {
    if (!hasRequiredGlobals()) return false;
    state.activeTab = MONTHLY_PLAN_TAB_ID;
    elements.tabPanels.innerHTML = "";
    const panel = document.createElement("section");
    panel.className = "tab-panel active";
    const block = renderMonthlyPlanBlock();
    insertMonthlyPlanExpenseBalance(block);
    panel.appendChild(block);
    elements.tabPanels.appendChild(panel);
    Array.from(elements.tabs.querySelectorAll(".tab")).forEach((button) => {
      button.classList.toggle("active", button.dataset.tabId === MONTHLY_PLAN_TAB_ID || button.textContent === MONTHLY_PLAN_LABEL);
    });
    if (typeof refreshGoogleControlsVisibility === "function") refreshGoogleControlsVisibility();
    return true;
  }

  async function openMonthlyPlanTab() {
    if (!renderMonthlyPlanPanel()) return;
    if (typeof loadMonthlyPlanSheetForCurrentRange === "function") {
      await loadMonthlyPlanSheetForCurrentRange();
      renderMonthlyPlanPanel();
    }
  }

  function ensureMonthlyPlanTabButton() {
    if (!hasRequiredGlobals()) return false;
    const existing = Array.from(elements.tabs.querySelectorAll("button"))
      .find((button) => button.dataset.tabId === MONTHLY_PLAN_TAB_ID || button.textContent === MONTHLY_PLAN_LABEL);
    if (existing) {
      existing.dataset.tabId = MONTHLY_PLAN_TAB_ID;
      existing.classList.toggle("active", state.activeTab === MONTHLY_PLAN_TAB_ID);
      return true;
    }
    const button = document.createElement("button");
    button.className = "tab" + (state.activeTab === MONTHLY_PLAN_TAB_ID ? " active" : "");
    button.type = "button";
    button.dataset.tabId = MONTHLY_PLAN_TAB_ID;
    button.textContent = MONTHLY_PLAN_LABEL;
    button.addEventListener("click", openMonthlyPlanTab);
    elements.tabs.appendChild(button);
    return true;
  }

  function startMonthlyPlanTabGuard() {
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      const ok = ensureMonthlyPlanTabButton();
      if (ok && ticks > 10) window.clearInterval(timer);
      if (ticks > 60) window.clearInterval(timer);
    }, 250);
    window.addEventListener("focus", ensureMonthlyPlanTabButton);
    window.addEventListener("DOMContentLoaded", ensureMonthlyPlanTabButton);
  }

  globalThis.ensureMonthlyPlanTabButton = ensureMonthlyPlanTabButton;
  globalThis.openMonthlyPlanTab = openMonthlyPlanTab;
  globalThis.insertMonthlyPlanExpenseBalance = insertMonthlyPlanExpenseBalance;

  startMonthlyPlanTabGuard();
})();
