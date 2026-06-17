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

  async function fetchBalancePairs() {
    const from = getDateValue("startDate", "");
    const to = getDateValue("endDate", from);
    const params = new URLSearchParams({ from, to });
    const response = await root.fetch(`/api/balance-pairs?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `balance-pairs HTTP ${response.status}`);
    return payload;
  }

  async function loadBalancePairsTabContent(container, status) {
    if (!container) return null;
    if (status) {
      status.className = "finance-status";
      status.textContent = "Загружаю Остатки 2...";
    }
    const payload = await fetchBalancePairs();
    container.innerHTML = "";
    container.appendChild(renderBalancePairs(payload));
    if (status) {
      status.className = "finance-status";
      status.textContent = "Остатки 2 загружены.";
    }
    return payload;
  }

  function renderBalancePairs(payload) {
    const doc = root.document;
    const shell = doc.createElement("div");
    shell.className = "balance-pairs-content";
    shell.appendChild(renderSummary(payload));
    shell.appendChild(renderTable(payload.rows || []));
    return shell;
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
    const content = doc.createElement("div");
    content.className = "balance-pairs-tab-content";
    shell.appendChild(content);
    loadBalancePairsTabContent(content).catch((error) => {
      content.innerHTML = "";
      const message = doc.createElement("div");
      message.className = "finance-status error";
      message.textContent = error?.message || "Не удалось загрузить Остатки 2.";
      content.appendChild(message);
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
