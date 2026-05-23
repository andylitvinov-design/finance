(function initAuditBridgeModule(root) {
  "use strict";

  const SNAPSHOT_URL = "/api/audit-snapshot";
  const HANDOFF_SNAPSHOT_URL = "/api/audit-snapshot?mode=handoff";
  const DEFAULT_FETCH_TIMEOUT_MS = 20000;
  const MAX_PROMPT_CHARS = 40000;
  const DEFAULT_DEBUGGER_URL = "https://chatgpt.com/g/g-p-69f388d310288191a55fdcd2cd90edef-ezohata-auditor/project";
  const DEFAULT_LIVE_URL = "https://ezohata-incoming-ledger.vercel.app/";
  const SUCCESS_MESSAGE = "Prompt copied. Открыл EzoHata Auditor.";
  const COPY_SUCCESS_MESSAGE = "Prompt copied.";
  const MOBILE_SAFE_MESSAGE = "Prompt copied. Mobile safe mode: открой EzoHata Auditor вручную и вставь prompt.";
  const TIMEOUT_MESSAGE = "Audit snapshot timed out after 20s. Скопируй prompt позже или проверь /api/audit-snapshot?mode=handoff.";

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

  function isMobileUserAgent(userAgent) {
    return /\b(Android|iPhone|iPad|iPod|Mobile|Windows Phone)\b/i.test(String(userAgent || ""));
  }

  function isChatGptDebuggerUrl(debuggerUrl) {
    try {
      return new URL(debuggerUrl).hostname.toLowerCase() === "chatgpt.com";
    } catch {
      return false;
    }
  }

  function shouldUseMobileSafeMode(options = {}) {
    return isMobileUserAgent(options.userAgent) && isChatGptDebuggerUrl(getDebuggerUrl(options));
  }

  function buildAuditPrompt(snapshot, options = {}) {
    const liveUrl = getLiveUrl(options);
    const maxPromptChars = Number(options.maxPromptChars || MAX_PROMPT_CHARS);
    const prefix = [
      "EzoHata Debugger task.",
      "First prove the failing layer before patching.",
      "Use this audit snapshot as the primary source. Do not ask me to copy anything else unless live verification fails.",
      "",
      `Live URL: ${liveUrl}`,
      `Snapshot endpoint: ${HANDOFF_SNAPSHOT_URL}`,
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
    ].join("\n");
    const source = compactSnapshotForPrompt(snapshot);
    const fullPrompt = `${prefix}\n${JSON.stringify(source, null, 2)}`;
    if (fullPrompt.length <= maxPromptChars) return fullPrompt;

    const truncated = truncateSnapshotForPrompt(source, maxPromptChars - prefix.length - 1);
    return `${prefix}\n${JSON.stringify(truncated, null, 2)}`.slice(0, maxPromptChars);
  }

  function getAuditSnapshotUrl() {
    return HANDOFF_SNAPSHOT_URL;
  }

  function createTimeoutError(timeoutMs) {
    const error = new Error(`Audit snapshot timed out after ${Math.round(timeoutMs / 1000)}s.`);
    error.code = "AUDIT_SNAPSHOT_TIMEOUT";
    error.userMessage = TIMEOUT_MESSAGE;
    return error;
  }

  async function fetchAuditSnapshot(fetchImpl, options = {}) {
    const doFetch = fetchImpl || root.fetch;
    if (typeof doFetch !== "function") {
      throw new Error("Fetch is unavailable.");
    }

    const timeoutMs = Number(options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS);
    const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
    let timeoutId = null;
    if (controller && timeoutMs > 0) {
      timeoutId = root.setTimeout(() => controller.abort(), timeoutMs);
    }

    let response;
    try {
      response = await doFetch(HANDOFF_SNAPSHOT_URL, {
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      if (error?.name === "AbortError") throw createTimeoutError(timeoutMs);
      throw error;
    } finally {
      if (timeoutId) root.clearTimeout(timeoutId);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `Audit snapshot failed (${response.status}).`);
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("Audit snapshot returned invalid JSON.");
    }
    return payload;
  }

  function compactSnapshotForPrompt(snapshot = {}) {
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    const dailyBalances = snapshot.daily_balances || {};
    const balanceCoverage = snapshot.balance_coverage || {};
    const alreadyCompact = snapshot.audit_handoff?.compact;
    if (alreadyCompact) return snapshot;
    return {
      ok: snapshot.ok,
      generated_at: snapshot.generated_at,
      project: snapshot.project,
      period: snapshot.period,
      schema: snapshot.schema,
      summary: snapshot.summary,
      balances: snapshot.balances,
      daily_balances: {
        uses_amount_net: dailyBalances.uses_amount_net,
        summary: dailyBalances.summary,
        actionable_rows: (dailyBalances.actionable_rows || []).slice(0, 10).map(compactActionableRow),
      },
      balance_coverage: {
        summary: balanceCoverage.summary,
        weekly_summary: {
          ...(balanceCoverage.weekly_summary || {}),
          actionable_accounts: (balanceCoverage.weekly_summary?.actionable_accounts || []).slice(0, 10).map(compactActionableRow),
          copyable_ostatki_rows: balanceCoverage.weekly_summary?.copyable_ostatki_rows
            ? "[omitted in prompt]"
            : balanceCoverage.weekly_summary?.copyable_ostatki_rows,
        },
        actionable_accounts: (balanceCoverage.actionable_accounts || []).slice(0, 10).map(compactActionableRow),
      },
      paypal: snapshot.paypal,
      exchange: snapshot.exchange,
      sources: snapshot.sources,
      warnings: warnings.slice(0, 20),
      audit_checks: snapshot.audit_checks,
      audit_handoff: {
        compact: true,
        mode: "prompt",
        omitted_paths: [
          "daily_balances.rows",
          "balance_coverage.accounts",
          "balance_fixes",
          ...(warnings.length > 20 ? ["warnings[20..]"] : []),
        ],
      },
    };
  }

  function compactActionableRow(row = {}) {
    return {
      date: row.date,
      channel: row.channel,
      currency: row.currency,
      status: row.status,
      opening_balance: row.opening_balance,
      movement_amount: row.movement_amount,
      expected_closing_balance: row.expected_closing_balance,
      provider_balance: row.provider_balance,
      closing_balance: row.closing_balance,
      difference: row.difference,
      action: row.action,
      reason: row.reason,
    };
  }

  function truncateSnapshotForPrompt(snapshot, maxJsonChars) {
    const maxChars = Math.max(1000, Number(maxJsonChars || 0));
    const truncated = {
      ok: snapshot.ok,
      generated_at: snapshot.generated_at,
      project: snapshot.project,
      period: snapshot.period,
      schema: snapshot.schema,
      summary: snapshot.summary,
      balances: snapshot.balances,
      paypal: snapshot.paypal,
      exchange: snapshot.exchange,
      sources: snapshot.sources,
      warnings: (snapshot.warnings || []).slice(0, 10),
      audit_checks: snapshot.audit_checks,
      audit_handoff: {
        ...(snapshot.audit_handoff || {}),
        compact: true,
        prompt_truncated: true,
        max_prompt_chars: MAX_PROMPT_CHARS,
      },
    };
    const serialized = JSON.stringify(truncated, null, 2);
    if (serialized.length <= maxChars) return truncated;
    return {
      ok: snapshot.ok,
      project: snapshot.project,
      period: snapshot.period,
      summary: snapshot.summary,
      audit_handoff: {
        compact: true,
        prompt_truncated: true,
        max_prompt_chars: MAX_PROMPT_CHARS,
        note: "Snapshot was shortened in the browser because it exceeded prompt size guardrails.",
      },
    };
  }

  function createAuditBridge({
    fetchImpl,
    clipboard,
    openWindow,
    setStatus,
    showFallback,
    debuggerUrl,
    userAgent = root.navigator?.userAgent,
    promptOptions = {},
  }) {
    let prompt = "";
    const resolvedDebuggerUrl = getDebuggerUrl({ debuggerUrl });
    const useMobileSafeMode = shouldUseMobileSafeMode({ debuggerUrl: resolvedDebuggerUrl, userAgent });

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
      if (useMobileSafeMode) {
        setStatus(MOBILE_SAFE_MESSAGE);
        return { ...result, debuggerUrl: resolvedDebuggerUrl, mobileSafeMode: true };
      }
      openWindow(resolvedDebuggerUrl);
      setStatus(SUCCESS_MESSAGE);
      return { ...result, debuggerUrl: resolvedDebuggerUrl };
    }

    async function copyCurrentPrompt() {
      setStatus("Copying prompt...");
      const result = await copyPrompt();
      if (result.copied) {
        setStatus(COPY_SUCCESS_MESSAGE);
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
      userAgent: root.navigator?.userAgent,
    });

    async function handleAction(action) {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        setStatus(error?.userMessage || error?.message || "Audit bridge failed.", true);
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
    compactSnapshotForPrompt,
    createAuditBridge,
    fetchAuditSnapshot,
    HANDOFF_SNAPSHOT_URL,
    MAX_PROMPT_CHARS,
    DEFAULT_FETCH_TIMEOUT_MS,
    getAuditSnapshotUrl,
    getDebuggerUrl,
    getLiveUrl,
    isChatGptDebuggerUrl,
    isMobileUserAgent,
    initAuditBridge,
    shouldUseMobileSafeMode,
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
