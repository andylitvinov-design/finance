(function initRemaindersTab(root) {
  "use strict";

  const REMAINDERS_TAB_ID = "remainders";
  const REMAINDERS_TAB_LABEL = "Остатки";
  const MONTH_START_BUTTON_ID = "remaindersLauncherButton";
  const MONTH_START_BUTTON_TEXT = "1 число";

  function getAppState() {
    if (typeof state !== "undefined") return state;
    return root.state || {};
  }

  function getElements() {
    if (typeof elements !== "undefined") return elements;
    return root.elements || {};
  }

  function formatIsoDate(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function getCurrentMonthStartIso(now = new Date()) {
    const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    return formatIsoDate(date.getFullYear(), date.getMonth(), 1);
  }

  function setStartDateToCurrentMonthStart() {
    const appElements = getElements();
    const input = appElements.startDate || root.document?.getElementById?.("startDate");
    if (!input) return false;
    input.value = getCurrentMonthStartIso();
    const requestLoad = typeof root.requestDashboardLoad === "function"
      ? root.requestDashboardLoad
      : (typeof requestDashboardLoad === "function" ? requestDashboardLoad : null);
    if (typeof requestLoad === "function") requestLoad();
    return true;
  }

  function installMonthStartButton() {
    const doc = root.document;
    const button = doc?.getElementById?.(MONTH_START_BUTTON_ID);
    if (!button || button.__ezohataMonthStartButton) return Boolean(button);
    const replacement = button.cloneNode(true);
    replacement.id = MONTH_START_BUTTON_ID;
    replacement.type = "button";
    replacement.className = button.className || "secondary";
    replacement.textContent = MONTH_START_BUTTON_TEXT;
    replacement.title = "Выставить дату начала периода на 1 число текущего месяца";
    replacement.setAttribute("aria-label", replacement.title);
    replacement.__ezohataMonthStartButton = true;
    replacement.__ezohataRemaindersLauncherBound = true;
    replacement.addEventListener("click", (event) => {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      setStartDateToCurrentMonthStart();
    });
    button.parentNode?.replaceChild?.(replacement, button);
    return true;
  }

  function ensureRemaindersTabConfig() {
    const appState = getAppState();
    const tabs = appState?.config?.tabs;
    if (!Array.isArray(tabs)) return false;
    if (tabs.some((tab) => tab?.id === REMAINDERS_TAB_ID)) return true;
    const tabConfig = {
      id: REMAINDERS_TAB_ID,
      label: REMAINDERS_TAB_LABEL,
      sheetName: "Остатки",
      virtual: true,
    };
    const analyticsIndex = tabs.findIndex((tab) => tab?.id === "analytics");
    tabs.splice(analyticsIndex >= 0 ? analyticsIndex + 1 : tabs.length, 0, tabConfig);
    return true;
  }

  async function loadRemaindersTabContent(content, status) {
    const api = root.EzohataRemaindersSummaryPopup;
    if (!api?.buildLiveRemaindersSummary || !api?.renderRemaindersSummaryBlock) {
      throw new Error("Remainders renderer is unavailable.");
    }
    const summary = await api.buildLiveRemaindersSummary(getAppState()?.data || {});
    const block = api.renderRemaindersSummaryBlock(summary, root.document);
    block.id = "remaindersTabSummaryBlock";
    block.classList.add("remainders-tab-summary-block");
    const details = block.querySelector?.(".remainders-diagnostics-details");
    if (details) details.open = true;
    content.innerHTML = "";
    content.appendChild(block);
    if (status) {
      status.className = "finance-status";
      status.textContent = "Остатки загружены как отдельная вкладка. Диагностика раскрыта, чтобы видеть все строки источников.";
    }
  }

  function makeSubtabButton(doc, label, active) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `remainders-subtab${active ? " is-active" : ""}`;
    button.textContent = label;
    return button;
  }

  function renderRemaindersTabBlock() {
    const doc = root.document;
    const shell = doc.createElement("div");
    shell.className = "finance-shell remainders-tab-shell";

    const header = doc.createElement("div");
    header.className = "tab-header";
    header.innerHTML = `<div><h2>${REMAINDERS_TAB_LABEL}</h2><div class="tab-note">Отдельная вкладка остатков: primary USD total + раскрытая диагностика выбранной даты, периода и provider matrix.</div></div>`;
    shell.appendChild(header);

    const nav = doc.createElement("div");
    nav.className = "remainders-subtab-nav";
    const summaryButton = makeSubtabButton(doc, "Сводка", true);
    const entryButton = makeSubtabButton(doc, "Внести остатки", false);
    nav.appendChild(summaryButton);
    nav.appendChild(entryButton);
    shell.appendChild(nav);

    const status = doc.createElement("div");
    status.className = "finance-status";
    status.textContent = "Загружаю остатки...";
    shell.appendChild(status);

    const content = doc.createElement("div");
    content.className = "remainders-tab-content";
    shell.appendChild(content);

    const setActive = (active) => {
      summaryButton.classList?.[active === "summary" ? "add" : "remove"]?.("is-active");
      entryButton.classList?.[active === "entry" ? "add" : "remove"]?.("is-active");
    };

    const showSummary = () => {
      setActive("summary");
      status.className = "finance-status";
      status.textContent = "Загружаю остатки...";
      loadRemaindersTabContent(content, status).catch((error) => {
        status.className = "finance-status error";
        status.textContent = error?.message || "Не удалось загрузить остатки.";
      });
    };

    const showEntry = () => {
      setActive("entry");
      status.className = "finance-status";
      status.textContent = "Внесение остатков по скриншоту. Сохранение в БД только после подтверждения.";
      content.innerHTML = "";
      const entryApi = root.EzohataBalanceScreenshotEntry;
      if (entryApi?.renderEntryPanel) {
        const startInput = getElements().startDate || doc.getElementById?.("startDate");
        content.appendChild(entryApi.renderEntryPanel(doc, { defaultDate: startInput?.value }));
      } else {
        content.textContent = "Модуль внесения остатков не загрузился.";
      }
    };

    summaryButton.addEventListener("click", showSummary);
    entryButton.addEventListener("click", showEntry);

    showSummary();

    return shell;
  }

  function patchRenderTabs() {
    const currentRenderTabs = typeof root.renderTabs === "function"
      ? root.renderTabs
      : (typeof renderTabs === "function" ? renderTabs : null);
    if (typeof currentRenderTabs !== "function" || currentRenderTabs.__ezohataRemaindersTabPatched) return false;

    const patched = function renderTabsWithRemaindersTab(...args) {
      ensureRemaindersTabConfig();
      const result = currentRenderTabs.apply(this, args);
      if (getAppState()?.activeTab === REMAINDERS_TAB_ID) {
        const panel = getElements().tabPanels?.querySelector?.(".tab-panel.active");
        if (panel) {
          panel.innerHTML = "";
          panel.appendChild(renderRemaindersTabBlock());
        }
      }
      return result;
    };
    patched.__ezohataRemaindersTabPatched = true;
    root.renderTabs = patched;
    if (typeof renderTabs === "function") renderTabs = patched;
    return true;
  }

  function startRemaindersTab() {
    installMonthStartButton();
    ensureRemaindersTabConfig();
    patchRenderTabs();
  }

  root.EzohataRemaindersTab = {
    ensureRemaindersTabConfig,
    getCurrentMonthStartIso,
    installMonthStartButton,
    renderRemaindersTabBlock,
    setStartDateToCurrentMonthStart,
    startRemaindersTab,
  };

  if (typeof module === "object" && module.exports) module.exports = root.EzohataRemaindersTab;

  startRemaindersTab();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startRemaindersTab);
})(typeof globalThis !== "undefined" ? globalThis : window);
