(function initAuditBridgeModule(root) {
  "use strict";

  const SNAPSHOT_URL = "/api/audit-snapshot";
  const DEFAULT_DEBUGGER_URL = "https://chatgpt.com/g/g-p-69f388d310288191a55fdcd2cd90edef-ezohata-auditor/project";
  const DEFAULT_LIVE_URL = "https://ezohata-incoming-ledger.vercel.app/";
  const SUCCESS_MESSAGE = "Prompt copied. Открыл EzoHata Auditor.";

  function normalizeUrl(value, fallback) {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    try {
      return new URL(raw).toString();
    } catch {
      return fallback;
    }
  }

  function getDebuggerUrl(options = {}) {
    return normalizeUrl(
      options.debuggerUrl || root.EZOHATA_AUDIT_DEBUGGER_URL || DEFAULT_DEBUGGER_URL,
      DEFAULT_DEBUGGER_URL
    );
  }

  function getLiveUrl(options = {}) {
    const currentOrigin = root.location?.origin && root.location.origin !== "null"
      ? `${root.location.origin}/`
      : "";
    return normalizeUrl(options.liveUrl || currentOrigin || DEFAULT_LIVE_URL, DEFAULT_LIVE_URL);
  }

  function buildAuditPrompt(snapshot, options = {}) {
    const liveUrl = getLiveUrl(options);
    return [
      "EzoHata Debugger task.",
      "First prove the failing layer before patching.",
      "Use this audit snapshot as the primary source. Do not ask me to copy anything else unless live verification fails.",
      "",
      `Live URL: ${liveUrl}`,
      `Snapshot endpoint: ${SNAPSHOT_URL}`,
      "Repo: andylitvinov-design/finance",
      "",
      "Required checks:",
      "- failing layer: UI → API route → provider/import → normalization → ledger save → balance → analytics",
      "- balance and amount_net invariant",
      "- fallback_amount_rows",
      "- PayPal gross/net/fee completeness",
      "- exchange amount_usd completeness",
      "- source unknown rows",
      "- warnings and provider transport errors",
      "",
      "Output format:",
      "1. Root cause / failing layer",
      "2. Evidence for / against",
      "3. Severity table",
      "4. Minimal safe fix plan or Codex prompt",
      "5. Live verification checklist",
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
    debuggerUrl,
    promptOptions = {},
  }) {
    let prompt = "";
    const resolvedDebuggerUrl = getDebuggerUrl({ debuggerUrl });

    async function loadPrompt() {
      const snapshot = await fetchAuditSnapshot(fetchImpl);
      prompt = buildAuditPrompt(snapshot, promptOptions);
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
      openWindow(resolvedDebuggerUrl);
      setStatus(SUCCESS_MESSAGE);
      return { ...result, debuggerUrl: resolvedDebuggerUrl };
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
      getDebuggerUrl: () => resolvedDebuggerUrl,
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
      debuggerUrl: root.EZOHATA_AUDIT_DEBUGGER_URL,
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
    getDebuggerUrl,
    getLiveUrl,
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
