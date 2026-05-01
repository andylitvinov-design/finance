(function initAuditBridgeModule(root) {
  "use strict";

  const SNAPSHOT_URL = "/api/audit-snapshot";
  const CHATGPT_URL = "https://chat.openai.com/";
  const SUCCESS_MESSAGE = "Prompt copied. Вставь в Agent-Auditor";

  function buildAuditPrompt(snapshot) {
    return [
      "Сделай аудит ezohata-incoming-ledger по snapshot.",
      "",
      "Проверь:",
      "- balance",
      "- fallback_amount_rows",
      "- PayPal gross/net",
      "- exchange amount_usd",
      "- source unknown",
      "- warnings",
      "",
      "Snapshot:",
      JSON.stringify(snapshot, null, 2),
    ].join("\n");
  }

  function getAuditSnapshotUrl() {
    return SNAPSHOT_URL;
  }

  async function fetchAuditSnapshot(fetchImpl) {
    const doFetch = fetchImpl || root.fetch;
    if (typeof doFetch !== "function") {
      throw new Error("Fetch is unavailable.");
    }

    const response = await doFetch(SNAPSHOT_URL, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `Audit snapshot failed (${response.status}).`);
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("Audit snapshot returned invalid JSON.");
    }
    return payload;
  }

  function createAuditBridge({
    fetchImpl,
    clipboard,
    openWindow,
    setStatus,
    showFallback,
  }) {
    let prompt = "";

    async function loadPrompt() {
      const snapshot = await fetchAuditSnapshot(fetchImpl);
      prompt = buildAuditPrompt(snapshot);
      return prompt;
    }

    async function copyPrompt(nextPrompt) {
      const value = nextPrompt || prompt || await loadPrompt();
      if (!clipboard?.writeText) {
        showFallback(value);
        return { copied: false, prompt: value };
      }

      try {
        await clipboard.writeText(value);
        return { copied: true, prompt: value };
      } catch {
        showFallback(value);
        return { copied: false, prompt: value };
      }
    }

    async function runAudit() {
      setStatus("Loading snapshot...");
      const nextPrompt = await loadPrompt();
      const result = await copyPrompt(nextPrompt);
      if (!result.copied) {
        setStatus("Clipboard unavailable. Скопируй prompt вручную.", true);
        return result;
      }
      openWindow(CHATGPT_URL);
      setStatus(SUCCESS_MESSAGE);
      return result;
    }

    async function copyCurrentPrompt() {
      setStatus("Copying prompt...");
      const result = await copyPrompt();
      if (result.copied) {
        setStatus(SUCCESS_MESSAGE);
      } else {
        setStatus("Clipboard unavailable. Скопируй prompt вручную.", true);
      }
      return result;
    }

    return {
      runAudit,
      copyCurrentPrompt,
      loadPrompt,
      getPrompt: () => prompt,
    };
  }

  function initAuditBridge(documentRef) {
    const documentObject = documentRef || root.document;
    if (!documentObject) return null;

    const runButton = documentObject.getElementById("runAuditButton");
    const copyButton = documentObject.getElementById("copyPromptButton");
    const status = documentObject.getElementById("auditStatus");
    const fallback = documentObject.getElementById("auditFallback");
    const textarea = documentObject.getElementById("auditPromptText");
    const selectButton = documentObject.getElementById("selectPromptButton");
    if (!runButton || !copyButton || !status || !fallback || !textarea || !selectButton) return null;

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle("error", Boolean(isError));
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

    const bridge = createAuditBridge({
      fetchImpl: root.fetch?.bind(root),
      clipboard: root.navigator?.clipboard,
      openWindow(url) {
        root.open(url, "_blank", "noopener");
      },
      setStatus,
      showFallback,
    });

    async function handleAction(action) {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        setStatus(error?.message || "Audit bridge failed.", true);
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

    return bridge;
  }

  const api = {
    buildAuditPrompt,
    createAuditBridge,
    fetchAuditSnapshot,
    getAuditSnapshotUrl,
    initAuditBridge,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.AuditBridge = api;

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => initAuditBridge(root.document));
    } else {
      initAuditBridge(root.document);
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
