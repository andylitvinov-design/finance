(function initAuditSiteTab(root) {
  "use strict";

  const AUDIT_TAB_ID = "audit";

  function createNode(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  function getAuditBridgeApi() {
    const api = root.AuditBridge;
    if (!api?.createAuditBridge) {
      throw new Error("Audit bridge is unavailable.");
    }
    return api;
  }

  function renderAuditDebuggerBlock() {
    const block = createNode("div", "audit-tab-block");

    const header = createNode("div", "tab-header");
    const titleWrap = createNode("div");
    titleWrap.innerHTML = [
      "<div>",
      "<h2>Аудит / EzoHata Debugger</h2>",
      "<div class=\"tab-note\">Кнопка берёт свежий <code>/api/audit-snapshot</code>, собирает Debugger prompt, копирует его в буфер и открывает новый чат ChatGPT / EzoHata Debugger.</div>",
      "</div>",
    ].join("");
    header.appendChild(titleWrap);
    block.appendChild(header);

    const panel = createNode("section", "panel audit-panel-inline");
    const controls = createNode("div", "controls audit-controls");
    const actions = createNode("div", "actions audit-actions");
    const runButton = createNode("button", "primary", "Запустить аудит");
    runButton.type = "button";
    const copyButton = createNode("button", "secondary", "Скопировать prompt");
    copyButton.type = "button";
    actions.append(runButton, copyButton);
    controls.appendChild(actions);

    const status = createNode("div", "status", "Готово. Нажми «Запустить аудит».");
    status.setAttribute("aria-live", "polite");
    controls.appendChild(status);
    panel.appendChild(controls);

    const fallback = createNode("div", "field audit-fallback");
    fallback.hidden = true;
    const label = createNode("label", "", "Prompt");
    const textarea = createNode("textarea", "");
    textarea.readOnly = true;
    const fallbackActions = createNode("div", "actions audit-fallback-actions");
    const selectButton = createNode("button", "secondary", "Выделить всё");
    selectButton.type = "button";
    fallbackActions.appendChild(selectButton);
    fallback.append(label, textarea, fallbackActions);
    panel.appendChild(fallback);

    const note = createNode("p", "tab-note", "Ограничение браузера: сайт может скопировать текст и открыть ChatGPT, но не может сам вставить prompt в чужое окно. После открытия нового чата нажми Cmd/Ctrl+V, если текст не вставился автоматически.");
    panel.appendChild(note);
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
      openWindow(url) {
        root.open(url, "_blank", "noopener");
      },
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

  function installAuditTabRenderer() {
    const originalRenderStandardTab = root.renderStandardTab;
    if (typeof originalRenderStandardTab !== "function") return false;
    if (root.__ezohataAuditTabInstalled) return true;

    root.renderStandardTab = function renderStandardTabWithAudit(tabId, label) {
      if (tabId === AUDIT_TAB_ID) return renderAuditDebuggerBlock();
      return originalRenderStandardTab.call(this, tabId, label);
    };
    root.__ezohataAuditTabInstalled = true;
    return true;
  }

  const api = {
    AUDIT_TAB_ID,
    installAuditTabRenderer,
    renderAuditDebuggerBlock,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.EzohataAuditSiteTab = api;
  installAuditTabRenderer();
})(typeof globalThis !== "undefined" ? globalThis : window);