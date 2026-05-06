// ============================================================
// MONOBANK ONE-CLICK UX
// ============================================================

(function initMonobankOneClickUx() {
  const missingTokenPattern = /MONOBANK_TOKEN_MISSING|token is not configured|credentials are not configured|MONOBANK_API_TOKEN/i;
  const originalRenderTabs = window.renderTabs;
  const originalLoadMonobankExpenseStatement = window.loadMonobankExpenseStatement;

  function getExpenseAccountingState() {
    try {
      return typeof state !== "undefined" ? state.expenseAccounting : null;
    } catch (_error) {
      return null;
    }
  }

  if (typeof originalLoadMonobankExpenseStatement !== "function") return;

  async function startMonobankOneClickImport() {
    const accounting = getExpenseAccountingState();
    if (!accounting) return originalLoadMonobankExpenseStatement();

    const manualToken = String(accounting.monobankToken || "").trim();
    accounting.monobankConnectOpen = false;
    accounting.monobankValidationMessage = "";
    accounting.monobankValidationError = false;

    await originalLoadMonobankExpenseStatement();

    const status = String(accounting.status || accounting.monobankValidationMessage || "").trim();
    if (!manualToken && accounting.error && missingTokenPattern.test(status)) {
      accounting.monobankConnectOpen = true;
      accounting.monobankValidationMessage = "На сервере нет MONOBANK_API_TOKEN. Вставьте Monobank personal token вручную — он останется только в памяти текущей страницы.";
      accounting.monobankValidationError = true;
      if (typeof window.renderTabs === "function") window.renderTabs();
    }
  }

  window.loadMonobankExpenseStatement = startMonobankOneClickImport;

  function replaceMonobankButton(button) {
    if (!button || button.dataset.monobankOneClick === "1") return;
    const accounting = getExpenseAccountingState();
    const clone = button.cloneNode(true);
    clone.dataset.monobankOneClick = "1";
    clone.textContent = accounting?.monobankLoading
      ? "Загружаю Monobank..."
      : "Подтянуть Monobank";
    clone.addEventListener("click", startMonobankOneClickImport);
    button.replaceWith(clone);
  }

  function simplifyMonobankConnectButton(button) {
    if (!button) return;
    const accounting = getExpenseAccountingState();
    if (accounting?.monobankConnectOpen) {
      button.textContent = "Скрыть ручной token";
      return;
    }
    button.style.display = "none";
  }

  function simplifyMonobankPanel(panel) {
    if (!panel || panel.dataset.monobankOneClickPanel === "1") return;
    panel.dataset.monobankOneClickPanel = "1";
    const notes = Array.from(panel.querySelectorAll(".config-note"));
    const instruction = notes.find((note) => /Откройте|API cabinet|Скопируйте personal token/i.test(note.textContent || ""));
    if (instruction) {
      instruction.innerHTML = "Ручной fallback: вставьте Monobank personal token только если one-click импорт не сработал. Token не сохраняется в браузере.";
    }
  }

  function enhanceMonobankUx() {
    const buttons = Array.from(document.querySelectorAll("button"));
    buttons.forEach((button) => {
      const text = String(button.textContent || "").trim();
      if (/^(Подтянуть Mono|Загружаю Mono|Подтянуть Monobank|Загружаю Monobank)/.test(text)) {
        replaceMonobankButton(button);
      }
      if (/^(Подключить Monobank|Скрыть Monobank|Скрыть ручной token)/.test(text)) {
        simplifyMonobankConnectButton(button);
      }
    });

    document.querySelectorAll(".provider-connect-card").forEach((panel) => {
      if (/Monobank/i.test(panel.textContent || "")) simplifyMonobankPanel(panel);
    });
  }

  if (typeof originalRenderTabs === "function") {
    window.renderTabs = function renderTabsWithMonobankOneClick(...args) {
      const result = originalRenderTabs.apply(this, args);
      enhanceMonobankUx();
      return result;
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceMonobankUx, { once: true });
  } else {
    enhanceMonobankUx();
  }
})();
