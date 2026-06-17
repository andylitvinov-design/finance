(function initBalancePairsTab(root) {
  "use strict";

  const TAB_ID = "balancePairs";
  const TAB_LABEL = "Остатки 2";

  function getAppState() {
    if (typeof state !== "undefined") return state;
    return root.state || {};
  }

  function getElements() {
    if (typeof elements !== "undefined") return elements;
    return root.elements || {};
  }

  function ensureBalancePairsTabConfig() {
    const appState = getAppState();
    if (!appState.config) appState.config = {};
    if (!Array.isArray(appState.config.tabs)) appState.config.tabs = [];
    if (!appState.config.tabs.some((tab) => tab.id === TAB_ID)) {
      appState.config.tabs.push({ id: TAB_ID, label: TAB_LABEL });
    }
  }

  function getDateValue(id, fallback) {
    const els = getElements();
    return String(els[id]?.value || root.document?.getElementById?.(id)?.value || fallback || "").trim();
  }

  function buildBalancePairsRequestUrl() {
    const from = getDateValue("startDate", "");
    const to = getDateValue("endDate", from);
    const params = new URLSearchParams({ from, to });
    return `/api/balance-pairs?${params.toString()}`;
  }

  async function fetchBalancePairs() {
    const requestUrl = buildBalancePairsRequestUrl();
    const response = await root.fetch(requestUrl, { cache: "no-store" });
    const status = response.status || 0;
    const contentType = response.headers?.get?.("content-type") || "";
    const responseText = await response.text();
    let payload = null;
    let parseError = "";
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      parseError = error?.message || String(error);
    }
    const meta = buildFetchMeta({ requestUrl, status, contentType, responseText, payload, parseError });
    if (!response.ok) throw createBalancePairsError(payload?.error || `balance-pairs HTTP ${status}`, meta);
    if (parseError) throw createBalancePairsError(`balance-pairs parse error: ${parseError}`, meta);
    if (!payload) throw createBalancePairsError("balance-pairs empty payload", meta);
    if (payload.ok !== true) throw createBalancePairsError(payload?.error || "balance-pairs payload ok=false", meta);
    if (!Array.isArray(payload.rows)) throw createBalancePairsError("balance-pairs payload.rows missing", meta);
    payload.__balancePairsMeta = meta;
    return payload;
  }

  async function loadBalancePairsTabContent(container, status) {
    if (!container) return null;
    if (status) {
      status.className = "finance-status";
      status.textContent = "Загружаю Остатки 2...";
    }
    let payload;
    try {
      payload = await fetchBalancePairs();
    } catch (error) {
      renderBalancePairsError(container, status, error);
      return null;
    }
    const rows = payload.rows;
    const diagnostics = renderDiagnostics(payload.__balancePairsMeta || buildFetchMeta({
      requestUrl: buildBalancePairsRequestUrl(),
      status: 200,
      contentType: "",
      responseText: "",
      payload,
      parseError: "",
    }));
    container.innerHTML = "";
    container.appendChild(diagnostics);
    if (status) {
      status.className = "finance-status";
      status.textContent = `balance-pairs HTTP ${payload.__balancePairsMeta?.status || 200} · rows ${rows.length} · summary ${isObject(payload?.summary) ? "yes" : "no"}`;
    }
    try {
      container.appendChild(renderBalancePairs(payload, rows));
    } catch (error) {
      appendDiagnosticLine(diagnostics, `render error: ${error?.message || "unknown"}`, "error");
      if (status) {
        status.className = "finance-status error";
        status.textContent = `balance-pairs HTTP 200 · rows ${rows.length} · render error`;
      }
    }
    return payload;
  }

  function buildFetchMeta({ requestUrl, status, contentType, responseText, payload, parseError }) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : null;
    return {
      requestUrl,
      status,
      contentType,
      bodyExcerpt: String(responseText || "").slice(0, 300),
      parseError,
      payloadKeys: getPayloadKeys(payload),
      payloadError: isObject(payload) ? payload.error || "" : "",
      payloadWarnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
      payloadDiagnostics: isObject(payload?.diagnostics) ? payload.diagnostics : null,
      rowsLength: rows ? rows.length : null,
      summaryPresent: isObject(payload?.summary),
    };
  }

  function createBalancePairsError(message, meta) {
    const error = new Error(message);
    error.balancePairsMeta = meta;
    return error;
  }

  function getBalancePairRows(payload) {
    if (!Array.isArray(payload?.rows)) {
      throw new Error("balance-pairs payload.rows missing");
    }
    return payload.rows;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function getPayloadKeys(payload) {
    return isObject(payload) ? Object.keys(payload) : [];
  }

  function renderDiagnostics({
    requestUrl,
    status,
    contentType,
    rowsLength,
    summaryPresent,
    payloadKeys,
    bodyExcerpt,
    parseError,
    payloadError,
    payloadWarnings,
    payloadDiagnostics,
  }) {
    const doc = root.document;
    const wrap = doc.createElement("div");
    wrap.className = "balance-pairs-debug";
    appendDiagnosticLine(wrap, `url: ${requestUrl || "missing"}`);
    appendDiagnosticLine(wrap, `status: ${status || "unknown"}`);
    appendDiagnosticLine(wrap, `content-type: ${contentType || "missing"}`);
    appendDiagnosticLine(wrap, `rows: ${rowsLength === null ? "missing" : rowsLength}`);
    appendDiagnosticLine(wrap, `summary: ${summaryPresent ? "yes" : "no"}`);
    appendDiagnosticLine(wrap, `payload keys: ${(payloadKeys || []).join(", ") || "none"}`, rowsLength === null ? "error" : "");
    if (payloadError) appendDiagnosticLine(wrap, `payload error: ${payloadError}`, "error");
    for (const warning of payloadWarnings || []) {
      appendDiagnosticLine(wrap, `payload warning: ${warning}`, "error");
    }
    if (payloadDiagnostics) {
      for (const [key, value] of Object.entries(payloadDiagnostics)) {
        appendDiagnosticLine(wrap, `payload diagnostic ${key}: ${formatDiagnosticValue(value)}`, "error");
      }
    }
    if (parseError) appendDiagnosticLine(wrap, `parse error: ${parseError}`, "error");
    if (rowsLength === null || parseError || payloadError || (payloadWarnings || []).length) appendDiagnosticLine(wrap, `body excerpt: ${bodyExcerpt || ""}`, "error");
    return wrap;
  }

  function renderBalancePairsError(container, status, error) {
    const meta = error?.balancePairsMeta || {
      requestUrl: buildBalancePairsRequestUrl(),
      status: 0,
      contentType: "",
      rowsLength: null,
      summaryPresent: false,
      payloadKeys: [],
      bodyExcerpt: "",
      parseError: "",
      payloadError: "",
      payloadWarnings: [],
      payloadDiagnostics: null,
    };
    container.innerHTML = "";
    const diagnostics = renderDiagnostics(meta);
    appendDiagnosticLine(diagnostics, `render error: ${error?.message || "Не удалось загрузить Остатки 2."}`, "error");
    container.appendChild(diagnostics);
    if (status) {
      status.className = "finance-status error";
      status.textContent = `balance-pairs HTTP ${meta.status || "unknown"} · rows ${meta.rowsLength === null ? "missing" : meta.rowsLength} · summary ${meta.summaryPresent ? "yes" : "no"}`;
    }
  }

  function appendDiagnosticLine(wrap, text, kind = "") {
    const item = root.document.createElement("div");
    item.className = `balance-pairs-debug-line${kind ? ` ${kind}` : ""}`;
    item.textContent = text;
    wrap.appendChild(item);
    return item;
  }

  function formatDiagnosticValue(value) {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function renderBalancePairs(payload, rows = getBalancePairRows(payload)) {
    const doc = root.document;
    const shell = doc.createElement("div");
    shell.className = "balance-pairs-content";
    shell.appendChild(renderSummary(payload));
    if (Array.isArray(payload.warnings) && payload.warnings.length) {
      shell.appendChild(renderWarnings(payload.warnings));
    }
    shell.appendChild(renderTable(rows));
    return shell;
  }

  function renderWarnings(warnings = []) {
    const doc = root.document;
    const wrap = doc.createElement("div");
    wrap.className = "balance-pairs-warnings";
    warnings.forEach((warning) => {
      const item = doc.createElement("div");
      item.className = "balance-pairs-warning";
      item.textContent = `warning: ${warning}`;
      wrap.appendChild(item);
    });
    return wrap;
  }

  function renderSummary(payload) {
    const doc = root.document;
    const summary = payload.summary || {};
    const period = payload.period || {};
    const wrap = doc.createElement("div");
    wrap.className = "balance-pairs-summary";
    [
      `Период: ${period.from || "-"} -> ${period.to || "-"}`,
      `Ожидаемых строк: ${summary.expected_rows ?? 0}`,
      `Найдено на начало: ${summary.found_start_rows ?? 0}`,
      `Найдено на конец: ${summary.found_end_rows ?? 0}`,
      `Нет на начало: ${summary.missing_start_rows ?? 0}`,
      `Нет на конец: ${summary.missing_end_rows ?? 0}`,
      `USD на начало рассчитан: ${summary.usd_complete_start ?? 0}`,
      `USD на конец рассчитан: ${summary.usd_complete_end ?? 0}`,
      `FX missing: ${summary.fx_missing ?? 0}`,
    ].forEach((text) => {
      const item = doc.createElement("span");
      item.className = "balance-pairs-summary-item";
      item.textContent = text;
      wrap.appendChild(item);
    });
    return wrap;
  }

  function renderTable(rows) {
    const doc = root.document;
    const wrap = doc.createElement("div");
    wrap.className = "table-wrap balance-pairs-table-wrap";
    if (!rows.length) {
      const empty = doc.createElement("div");
      empty.className = "empty";
      empty.textContent = "Нет balance-pairs строк за выбранный период.";
      wrap.appendChild(empty);
      return wrap;
    }
    const table = doc.createElement("table");
    const tbody = doc.createElement("tbody");
    const header = doc.createElement("tr");
    ["Канал", "Валюта", "Остатки вал1", "Курс1", "Остатки usd1", "Остатки вал2", "Курс2", "Остатки usd2"].forEach((label) => {
      const th = doc.createElement("th");
      th.textContent = label;
      header.appendChild(th);
    });
    tbody.appendChild(header);
    (rows || []).forEach((row) => {
      const tr = doc.createElement("tr");
      [
        row.channel || "-",
        row.currency || "-",
        formatNativeCell(row.start),
        formatRateCell(row.start),
        formatUsdCell(row.start),
        formatNativeCell(row.end),
        formatRateCell(row.end),
        formatUsdCell(row.end),
      ].forEach((value) => {
        const td = doc.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function formatNativeCell(side = {}) {
    if (side.status === "missing_snapshot") return side.message || "missing snapshot";
    return appendSnapshotNote(formatAmount(side.amount), side);
  }

  function formatRateCell(side = {}) {
    if (side.status === "missing_snapshot") return side.message || "missing snapshot";
    if (side.status === "missing_fx") return side.message || "missing FX";
    if (side.rate_to_usd === null || side.rate_to_usd === undefined) return side.status === "ok_zero" ? "0" : "-";
    return appendSnapshotNote(formatAmount(side.rate_to_usd), side);
  }

  function formatUsdCell(side = {}) {
    if (side.status === "missing_snapshot") return side.message || "missing snapshot";
    if (side.status === "missing_fx") return side.message || "missing FX";
    return appendSnapshotNote(formatAmount(side.amount_usd), side);
  }

  function appendSnapshotNote(value, side = {}) {
    if (side.snapshot_status === "latest_before" && side.snapshot_date) return `${value} (${side.snapshot_date})`;
    return value;
  }

  function formatAmount(value) {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return String(Math.round(numeric * 10000) / 10000);
  }

  function renderBalancePairsTabBlock() {
    const doc = root.document;
    const shell = doc.createElement("div");
    shell.className = "finance-shell balance-pairs-tab-shell";
    const header = doc.createElement("div");
    header.className = "tab-header";
    header.innerHTML = `<div><h2>${TAB_LABEL}</h2></div>`;
    shell.appendChild(header);
    const status = doc.createElement("div");
    status.className = "finance-status";
    status.textContent = "Загружаю Остатки 2...";
    shell.appendChild(status);
    const content = doc.createElement("div");
    content.className = "balance-pairs-tab-content";
    shell.appendChild(content);
    loadBalancePairsTabContent(content, status).catch((error) => {
      renderBalancePairsError(content, status, error);
    });
    return shell;
  }

  function patchRenderTabs() {
    const currentRenderTabs = typeof root.renderTabs === "function"
      ? root.renderTabs
      : (typeof renderTabs === "function" ? renderTabs : null);
    if (typeof currentRenderTabs !== "function" || currentRenderTabs.__ezohataBalancePairsTabPatched) return false;
    const patched = function renderTabsWithBalancePairsTab(...args) {
      ensureBalancePairsTabConfig();
      const result = currentRenderTabs.apply(this, args);
      if (getAppState()?.activeTab === TAB_ID) {
        const panel = getElements().tabPanels?.querySelector?.(".tab-panel.active");
        if (panel) {
          panel.innerHTML = "";
          panel.appendChild(renderBalancePairsTabBlock());
        }
      }
      return result;
    };
    patched.__ezohataBalancePairsTabPatched = true;
    root.renderTabs = patched;
    if (typeof renderTabs === "function") renderTabs = patched;
    return true;
  }

  function startBalancePairsTab() {
    ensureBalancePairsTabConfig();
    patchRenderTabs();
  }

  root.EzohataBalancePairsTab = {
    ensureBalancePairsTabConfig,
    fetchBalancePairs,
    loadBalancePairsTabContent,
    renderBalancePairs,
    renderBalancePairsTabBlock,
    startBalancePairsTab,
  };

  if (typeof module === "object" && module.exports) module.exports = root.EzohataBalancePairsTab;

  startBalancePairsTab();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startBalancePairsTab);
})(typeof globalThis !== "undefined" ? globalThis : window);
