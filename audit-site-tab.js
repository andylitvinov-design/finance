(function initAuditSiteTab(root) {
  "use strict";

  const AUDIT_TAB_ID = "audit";
  const AUDIT_TAB_LABEL = "Аудит";
  const RETRY_LIMIT = 40;
  const RETRY_DELAY_MS = 250;

  function getState() {
    return typeof state !== "undefined" ? state : root.state;
  }

  function getElements() {
    return typeof elements !== "undefined" ? elements : root.elements;
  }

  function createNode(tag, className, textContent) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  function getAuditBridgeApi() {
    const api = root.AuditBridge;
    if (!api?.createAuditBridge) throw new Error("Audit bridge is unavailable.");
    return api;
  }

  function renderAuditDebuggerBlock() {
    const block = createNode("div", "audit-tab-block");
    const header = createNode("div", "tab-header");
    const titleWrap = createNode("div");
    titleWrap.innerHTML = [
      "<div>",
      "<h2>Аудит / EzoHata Auditor</h2>",
      "<div class=\"tab-note\">Кнопка берёт свежий <code>/api/audit-snapshot</code>, копирует prompt и открывает EzoHata Auditor.</div>",
      "</div>",
    ].join("");
    header.appendChild(titleWrap);
    block.appendChild(header);

    const panel = createNode("section", "panel audit-panel-inline");
    const controls = createNode("div", "controls audit-controls");
    const actions = createNode("div", "actions audit-actions");
    const runButton = createNode("button", "primary", "Запустить аудит");
    const copyButton = createNode("button", "secondary", "Скопировать prompt");
    runButton.type = "button";
    copyButton.type = "button";
    actions.append(runButton, copyButton);

    const status = createNode("div", "status", "Готово. Нажми «Запустить аудит».");
    status.setAttribute("aria-live", "polite");
    controls.append(actions, status);
    panel.appendChild(controls);

    const fallback = createNode("div", "field audit-fallback");
    fallback.hidden = true;
    const textarea = createNode("textarea", "");
    textarea.readOnly = true;
    const fallbackActions = createNode("div", "actions audit-fallback-actions");
    const selectButton = createNode("button", "secondary", "Выделить всё");
    selectButton.type = "button";
    fallbackActions.appendChild(selectButton);
    fallback.append(createNode("label", "", "Prompt"), textarea, fallbackActions);
    panel.appendChild(fallback);
    panel.appendChild(createNode("p", "tab-note", "Если текст не вставился автоматически, нажми Cmd/Ctrl+V в новом чате."));
    block.appendChild(panel);

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.className = "status" + (isError ? " error" : "");
    }

    function showFallback(prompt) {
      textarea.value = prompt;
      fallback.hidden = false;
      textarea.focus();
      textarea.select();
    }

    function setBusy(isBusy) {
      runButton.disabled = isBusy;
      copyButton.disabled = isBusy;
    }

    const bridge = getAuditBridgeApi().createAuditBridge({
      fetchImpl: root.fetch?.bind(root),
      clipboard: root.navigator?.clipboard,
      openWindow(url) { root.open(url, "_blank", "noopener"); },
      setStatus,
      showFallback,
      debuggerUrl: root.EZOHATA_AUDIT_DEBUGGER_URL,
    });

    async function handleAction(action) {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        setStatus(error?.message || "Audit debugger failed.", true);
      } finally {
        setBusy(false);
      }
    }

    runButton.addEventListener("click", () => handleAction(bridge.runAudit));
    copyButton.addEventListener("click", () => handleAction(bridge.copyCurrentPrompt));
    selectButton.addEventListener("click", () => {
      textarea.focus();
      textarea.select();
    });
    return block;
  }

  function renderAuditTabPanel() {
    const appElements = getElements();
    if (!appElements?.tabPanels) return false;
    appElements.tabPanels.innerHTML = "";
    const panel = createNode("section", "tab-panel active");
    panel.appendChild(renderAuditDebuggerBlock());
    appElements.tabPanels.appendChild(panel);
    return true;
  }

  function markOnlyAuditActive() {
    const appElements = getElements();
    appElements?.tabs?.querySelectorAll?.(".tab.active").forEach((button) => button.classList.remove("active"));
    appElements?.tabs?.querySelector?.(`[data-tab-id="${AUDIT_TAB_ID}"]`)?.classList.add("active");
  }

  function appendAuditTabButton() {
    const appState = getState();
    const appElements = getElements();
    if (!appElements?.tabs) return false;

    const selector = `[data-tab-id="${AUDIT_TAB_ID}"]`;
    const existing = appElements.tabs.querySelector?.(selector);
    if (existing) {
      existing.classList.toggle("active", appState?.activeTab === AUDIT_TAB_ID);
      return true;
    }

    const button = createNode("button", "tab" + (appState?.activeTab === AUDIT_TAB_ID ? " active" : ""), AUDIT_TAB_LABEL);
    button.type = "button";
    button.dataset.tabId = AUDIT_TAB_ID;
    button.addEventListener("click", () => {
      const nextState = getState();
      if (nextState) nextState.activeTab = AUDIT_TAB_ID;
      if (typeof root.renderTabs === "function") {
        root.renderTabs();
      } else {
        markOnlyAuditActive();
        renderAuditTabPanel();
      }
    });
    appElements.tabs.appendChild(button);
    return true;
  }

  function bindAuditLauncherButton() {
    const launcher = root.document?.getElementById?.("auditLauncherButton");
    if (!launcher || launcher.__ezohataAuditLauncherBound) return Boolean(launcher);
    launcher.__ezohataAuditLauncherBound = true;
    launcher.addEventListener("click", () => {
      const appState = getState();
      if (appState) appState.activeTab = AUDIT_TAB_ID;
      if (typeof root.renderTabs === "function") {
        root.renderTabs();
      } else {
        markOnlyAuditActive();
        renderAuditTabPanel();
      }
    });
    return true;
  }

  function installAuditTabRenderer() {
    const originalRenderTabs = root.renderTabs;
    if (typeof originalRenderTabs !== "function") return false;
    if (root.__ezohataAuditTabInstalled) return true;

    root.renderTabs = function renderTabsWithAudit() {
      const appState = getState();
      const shouldShowAudit = appState?.activeTab === AUDIT_TAB_ID;
      if (shouldShowAudit) {
        const fallbackTab = appState?.config?.tabs?.[0]?.id || "movement";
        appState.activeTab = fallbackTab;
        originalRenderTabs.call(this);
        appState.activeTab = AUDIT_TAB_ID;
        appendAuditTabButton();
        markOnlyAuditActive();
        renderAuditTabPanel();
        return;
      }
      originalRenderTabs.call(this);
      appendAuditTabButton();
    };
    root.__ezohataAuditTabInstalled = true;
    return true;
  }

  function ensureAuditTabVisible() {
    installAuditTabRenderer();
    const tabVisible = appendAuditTabButton();
    const launcherBound = bindAuditLauncherButton();
    return tabVisible || launcherBound;
  }

  function startAuditTabRetries() {
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      const visible = ensureAuditTabVisible();
      if (visible || attempts >= RETRY_LIMIT) return;
      root.setTimeout(tick, RETRY_DELAY_MS);
    };
    tick();
  }

  const api = {
    AUDIT_TAB_ID,
    AUDIT_TAB_LABEL,
    appendAuditTabButton,
    bindAuditLauncherButton,
    ensureAuditTabVisible,
    installAuditTabRenderer,
    renderAuditDebuggerBlock,
    renderAuditTabPanel,
    startAuditTabRetries,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataAuditSiteTab = api;

  startAuditTabRetries();
  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", startAuditTabRetries);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
