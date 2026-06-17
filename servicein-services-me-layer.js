// Dedicated servicein/services_me layer for personal services income.
// This file is intentionally a small post-load patch: it separates Андрей's
// personal service income from Ezohata order income without touching provider
// transports or amount_net/gross/fee semantics.

(function serviceInServicesMeLayer() {
  const SERVICE_TYPE = "services_me";
  const SERVICE_LABEL = "УСЛУГИ МНЕ";
  const SERVICE_NOTE = "УСЛУГИ МНЕ — личный доход Андрея из servicein. Входит в баланс, но не является оплатой заказов Ezohata.";
  let scheduled = false;

  function normalizeToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/_/g, " ")
      .replace(/[^0-9a-zа-я]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getValue(row, snakeKey, camelKey = "") {
    if (!row || typeof row !== "object") return "";
    if (row[snakeKey] !== undefined && row[snakeKey] !== null) return row[snakeKey];
    if (camelKey && row[camelKey] !== undefined && row[camelKey] !== null) return row[camelKey];
    return "";
  }

  function parseNumber(value) {
    if (value === null || value === undefined) return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatNumber(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return "0";
    return String(Math.round(numeric * 10000) / 10000).replace(".", ",");
  }

  function normalizeCategory(value) {
    const contract = window.EzohataManualLedgerContract || {};
    if (typeof contract.normalizeManualLedgerCategory === "function") {
      return contract.normalizeManualLedgerCategory(value, "");
    }
    const token = normalizeToken(value);
    if (!token) return "";
    if (["servicein", "service income", "serviceincome", "service", "services", "приход"].includes(token)) return "servicein";
    if (["ezoin", "ezofact", "ezohata", "ezo"].includes(token)) return "ezoin";
    return token.replace(/\s+/g, "_");
  }

  function normalizeOperation(value, category = "") {
    const contract = window.EzohataManualLedgerContract || {};
    if (typeof contract.normalizeManualLedgerOperation === "function") {
      return contract.normalizeManualLedgerOperation(value, category);
    }
    const token = normalizeToken(value).replace(/\s+/g, "_");
    if (token) return token;
    return ["servicein", "ezoin"].includes(normalizeCategory(category)) ? "income" : "";
  }

  function normalizeDirection(value, operation = "") {
    const contract = window.EzohataManualLedgerContract || {};
    if (typeof contract.normalizeManualLedgerDirection === "function") {
      return contract.normalizeManualLedgerDirection(value, operation);
    }
    const token = normalizeToken(value);
    if (token) return token;
    return operation === "income" || operation === "exchange_in" ? "in" : "";
  }

  function isServiceInRow(row) {
    if (!row || typeof row !== "object") return false;
    const category = normalizeCategory(getValue(row, "category"));
    const operation = normalizeOperation(getValue(row, "operation"), category);
    const direction = normalizeDirection(getValue(row, "direction"), operation);
    return operation === "income" && category === "servicein" && direction === "in";
  }

  function isServicesMeRow(row) {
    if (!isServiceInRow(row)) return false;
    const subcategory = normalizeToken(getValue(row, "subcategory"));
    return !subcategory ||
      subcategory === "services me" ||
      subcategory === "services_me" ||
      subcategory === "services-me" ||
      subcategory === "uslugi mne" ||
      subcategory === "услуги мне";
  }

  function getRowChannel(row) {
    const raw = getValue(row, "to_channel", "toChannel") || getValue(row, "channel") || getValue(row, "from_channel", "fromChannel");
    if (typeof window.canonicalManualFinanceChannel === "function") return window.canonicalManualFinanceChannel(raw || "");
    return String(raw || "").trim();
  }

  function getRowUsd(row) {
    return Math.abs(parseNumber(
      getValue(row, "amount_usd", "amountUsd") ||
      getValue(row, "amount_net", "amountNet") ||
      getValue(row, "amount") ||
      getValue(row, "usdAmount") ||
      getValue(row, "localAmount")
    ));
  }

  function buildServiceInIncomeLookup(rows = []) {
    return (rows || []).reduce((lookup, row) => {
      if (!isServicesMeRow(row)) return lookup;
      const channel = getRowChannel(row) || "unknown";
      const amountUsd = getRowUsd(row);
      lookup.byChannel[channel] = (lookup.byChannel[channel] || 0) + amountUsd;
      lookup.total += amountUsd;
      return lookup;
    }, { byChannel: {}, total: 0 });
  }

  function isIncomingRow(row) {
    const category = normalizeCategory(getValue(row, "category"));
    const operation = normalizeOperation(getValue(row, "operation") || getValue(row, "direction"), category);
    const direction = normalizeDirection(getValue(row, "direction"), operation);
    return direction === "in" && (operation === "income" || ["servicein", "ezoin"].includes(category));
  }

  function isTransferOrExchangeRow(row) {
    const operation = normalizeToken(getValue(row, "operation") || getValue(row, "direction")).replace(/\s+/g, "_");
    const category = normalizeCategory(getValue(row, "category"));
    return operation.includes("exchange") || operation.includes("transfer") || ["exchange", "partner"].includes(category);
  }

  function buildOrderCoverageCandidateSummary(rows = []) {
    const totalIncomingUsd = (rows || []).reduce((sum, row) => isIncomingRow(row) ? sum + getRowUsd(row) : sum, 0);
    const serviceinUsd = buildServiceInIncomeLookup(rows).total;
    const transferOrExchangeUsd = (rows || []).reduce((sum, row) => isTransferOrExchangeRow(row) ? sum + getRowUsd(row) : sum, 0);
    return {
      totalIncomingUsd,
      serviceinUsd,
      transferOrExchangeUsd,
      orderCandidateIncomingUsd: totalIncomingUsd - serviceinUsd - transferOrExchangeUsd
    };
  }

  function collectLedgerRows() {
    const candidates = [
      window.state?.manualFinance?.data?.ledgerRows,
      window.state?.data?.manual?.operations,
      window.state?.expenseAccounting?.operations,
      window.state?.expenseAccounting?.entries,
      window.state?.data?.manual?.ledgerRows
    ];
    const rows = [];
    candidates.forEach((candidate) => {
      if (Array.isArray(candidate)) rows.push(...candidate);
    });
    const seen = new Set();
    return rows.filter((row, index) => {
      const key = String(
        getValue(row, "raw_source_id", "rawSourceId") ||
        getValue(row, "external_id", "externalId") ||
        `${getValue(row, "date")}:${getRowChannel(row)}:${getValue(row, "amount")}:${index}`
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function patchManualLedgerContract() {
    const contract = window.EzohataManualLedgerContract || {};
    contract.isServiceInRow = contract.isServiceInRow || isServiceInRow;
    contract.isServicesMeRow = contract.isServicesMeRow || isServicesMeRow;
    contract.buildServiceInIncomeLookup = contract.buildServiceInIncomeLookup || buildServiceInIncomeLookup;
    contract.buildOrderCoverageCandidateSummary = contract.buildOrderCoverageCandidateSummary || buildOrderCoverageCandidateSummary;
    window.EzohataManualLedgerContract = contract;
    window.EzohataServiceInLayer = {
      isServiceInRow,
      isServicesMeRow,
      buildServiceInIncomeLookup,
      buildOrderCoverageCandidateSummary,
      collectLedgerRows
    };
  }

  function patchReceivedTypeMapping() {
    if (typeof window.normalizeReceivedEntryType === "function" && !window.normalizeReceivedEntryType.__servicesMePatched) {
      const original = window.normalizeReceivedEntryType;
      window.normalizeReceivedEntryType = function normalizeReceivedEntryTypeWithServicesMe(value) {
        const token = normalizeToken(value).replace(/\s+/g, "_");
        if (token === SERVICE_TYPE || token === "услуги_мне") return SERVICE_TYPE;
        return original.call(this, value);
      };
      window.normalizeReceivedEntryType.__servicesMePatched = true;
    }

    if (typeof window.mapReceivedTypeToAccountingCategory === "function" && !window.mapReceivedTypeToAccountingCategory.__servicesMePatched) {
      const original = window.mapReceivedTypeToAccountingCategory;
      window.mapReceivedTypeToAccountingCategory = function mapReceivedTypeToAccountingCategoryWithServicesMe(value) {
        const token = normalizeToken(value).replace(/\s+/g, "_");
        if (token === SERVICE_TYPE || token === "услуги_мне") return "servicein";
        return original.call(this, value);
      };
      window.mapReceivedTypeToAccountingCategory.__servicesMePatched = true;
    }
  }

  function isServicesMeEntry(entry) {
    if (!entry || entry.direction !== "income") return false;
    const token = normalizeToken(entry.receivedType || entry.received_type || entry.category || entry.subcategory || "").replace(/\s+/g, "_");
    return token === SERVICE_TYPE || token === "услуги_мне";
  }

  function patchLedgerRowBuilder() {
    if (typeof window.buildLedgerRowsFromAccountingEntries !== "function" || window.buildLedgerRowsFromAccountingEntries.__servicesMePatched) return;
    const original = window.buildLedgerRowsFromAccountingEntries;
    window.buildLedgerRowsFromAccountingEntries = function buildLedgerRowsFromAccountingEntriesWithServicesMe(entries = []) {
      const normalizedEntries = (entries || []).map((entry) => isServicesMeEntry(entry)
        ? { ...entry, category: "servicein", subcategory: SERVICE_TYPE, direction: "income" }
        : entry
      );
      const rows = original.call(this, normalizedEntries) || [];
      return rows.map((row, index) => {
        const sourceEntry = normalizedEntries[index];
        if (!isServicesMeEntry(sourceEntry)) return row;
        return {
          ...row,
          operation: "income",
          category: "servicein",
          subcategory: SERVICE_TYPE,
          direction: "in"
        };
      });
    };
    window.buildLedgerRowsFromAccountingEntries.__servicesMePatched = true;
  }

  function relabelServicesMeOptions(root = document) {
    root.querySelectorAll?.('option[value="services_me"]').forEach((option) => {
      option.textContent = SERVICE_LABEL;
    });
  }

  function buildServicesMeValues() {
    const rows = collectLedgerRows().filter(isServicesMeRow);
    const values = [["дата", "канал", "сумма", "валюта", "сумма_usd", "комментарий"]];
    rows
      .slice()
      .sort((left, right) => String(getValue(right, "date") || "").localeCompare(String(getValue(left, "date") || "")))
      .forEach((row) => {
        values.push([
          getValue(row, "date") || "",
          getRowChannel(row),
          getValue(row, "amount") || getValue(row, "amount_net", "amountNet") || "",
          getValue(row, "currency") || "",
          getValue(row, "amount_usd", "amountUsd") || "",
          getValue(row, "comment") || getValue(row, "description") || ""
        ]);
      });
    return values;
  }

  function renderServicesMeBlock() {
    const block = document.createElement("section");
    block.className = "services-me-layer-block table-wrap";
    const values = buildServicesMeValues();
    const hasRows = values.length > 1;
    const total = buildServiceInIncomeLookup(collectLedgerRows()).total;
    block.innerHTML = `
      <div class="tab-header services-me-layer-header">
        <div>
          <h3>${SERVICE_LABEL}</h3>
          <div class="tab-note">${SERVICE_NOTE}</div>
          <div class="config-note">Итого servicein: ${formatNumber(total)} USD. Новые строки должны сохраняться как income/servicein/services_me/in.</div>
        </div>
      </div>
    `;
    const tableWrap = document.createElement("div");
    if (hasRows && typeof window.renderResponsiveDataView === "function") {
      tableWrap.appendChild(window.renderResponsiveDataView(values, { mobileTableColumnCount: 2 }));
    } else if (hasRows && typeof window.renderPlainTable === "function") {
      tableWrap.appendChild(window.renderPlainTable(values));
    } else {
      tableWrap.innerHTML = `<div class="empty">Нет строк servicein/services_me за выбранный период.</div>`;
    }
    block.appendChild(tableWrap);
    return block;
  }

  function injectServicesMeBlock() {
    if (window.state?.activeTab !== "manualFinance") return;
    const manualPanel = Array.from(document.querySelectorAll(".tab-panel.active"))
      .find((panel) => /fact|остатки|наличные/i.test(panel.textContent || ""));
    if (!manualPanel || manualPanel.querySelector(".services-me-layer-block")) return;
    manualPanel.appendChild(renderServicesMeBlock());
  }

  function injectReconciliationCard() {
    const activePanel = document.querySelector(".tab-panel.active");
    if (!activePanel || activePanel.querySelector(".services-me-reconciliation-card")) return;
    if (!/анализ финансов|сверка|покрыт|баланс/i.test(activePanel.textContent || "")) return;
    const summary = buildOrderCoverageCandidateSummary(collectLedgerRows());
    const card = document.createElement("div");
    card.className = "expense-summary-card services-me-reconciliation-card";
    card.innerHTML = `
      <div class="expense-summary-label">${SERVICE_LABEL} / servicein</div>
      <div class="expense-summary-value">${formatNumber(summary.serviceinUsd)} USD</div>
      <div class="config-note">total incoming: ${formatNumber(summary.totalIncomingUsd)} USD · transfer/exchange: ${formatNumber(summary.transferOrExchangeUsd)} USD · order candidate: ${formatNumber(summary.orderCandidateIncomingUsd)} USD</div>
      <div class="config-note">Формула: orderCandidateIncomingUsd = totalIncomingUsd - serviceinUsd - transferOrExchangeUsd.</div>
    `;
    const target = activePanel.querySelector(".expense-summary-grid, .metrics, .tab-header") || activePanel;
    if (target === activePanel) target.prepend(card);
    else target.appendChild(card);
  }

  function applyServicesMeLayer() {
    scheduled = false;
    patchManualLedgerContract();
    patchReceivedTypeMapping();
    patchLedgerRowBuilder();
    relabelServicesMeOptions(document);
    injectServicesMeBlock();
    injectReconciliationCard();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(applyServicesMeLayer);
    setTimeout(applyServicesMeLayer, 0);
  }

  patchManualLedgerContract();
  patchReceivedTypeMapping();
  patchLedgerRowBuilder();

  const originalRenderTabs = window.renderTabs;
  if (typeof originalRenderTabs === "function" && !originalRenderTabs.__servicesMePatched) {
    window.renderTabs = function renderTabsWithServicesMe(...args) {
      const result = originalRenderTabs.apply(this, args);
      scheduleApply();
      return result;
    };
    window.renderTabs.__servicesMePatched = true;
  }

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleApply, { once: true });
  } else {
    scheduleApply();
  }
})();
