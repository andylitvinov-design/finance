(function initBalanceIncomeChannelBreakdown(root) {
  "use strict";

  const BALANCE_BLOCK_ID = "balanceSummaryBlock";
  const BALANCE_BUTTON_ID = "balanceLauncherButton";
  const BREAKDOWN_CLASS = "balance-income-channel-breakdown";

  function getRootState() {
    if (typeof state !== "undefined") return state;
    return root.state || {};
  }

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ");
  }

  function normalizeHeaderKey(value) {
    return normalizeText(value)
      .replace(/\s+/g, "")
      .replace(/[^0-9a-zа-яіїєґ_%+-]/g, "");
  }

  function findHeaderIndexByAliases(header, aliases) {
    const exact = new Set((aliases || []).map((alias) => normalizeText(alias)));
    const exactIndex = (header || []).findIndex((cell) => exact.has(normalizeText(cell)));
    if (exactIndex !== -1) return exactIndex;
    const loose = new Set((aliases || []).map((alias) => normalizeHeaderKey(alias)));
    return (header || []).findIndex((cell) => loose.has(normalizeHeaderKey(cell)));
  }

  function findFirstHeaderIndex(header, aliasGroups) {
    for (const aliases of aliasGroups) {
      const index = findHeaderIndexByAliases(header, aliases);
      if (index !== -1) return index;
    }
    return -1;
  }

  function normalizeDateKey(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const display = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
    return raw.slice(0, 10);
  }

  function getSelectedPeriod(options = {}) {
    const appState = options.state || getRootState();
    const doc = options.document || root.document;
    const appElements = typeof elements !== "undefined" ? elements : root.elements || {};
    return {
      startDate: normalizeDateKey(options.startDate || appElements?.startDate?.value || doc?.getElementById?.("startDate")?.value || appState?.analyticsFact?.periodStart || ""),
      endDate: normalizeDateKey(options.endDate || appElements?.endDate?.value || doc?.getElementById?.("endDate")?.value || appState?.analyticsFact?.periodEnd || ""),
    };
  }

  function isDateInPeriod(date, period) {
    if (!date) return true;
    if (period.startDate && date < period.startDate) return false;
    if (period.endDate && date > period.endDate) return false;
    return true;
  }

  function hasAnyValue(row) {
    return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
  }

  function classifyChannel(channel) {
    const normalized = normalizeText(channel);
    if (!normalized) return "Не указан";
    if (/paypal|пейпал/.test(normalized)) return "PayPal";
    if (/wise|transferwise|трансервайз/.test(normalized)) return "Wise / TransferWise";
    if (/mono|монобанк/.test(normalized)) return "Monobank";
    if (/приват|privat|фоп|fop/.test(normalized)) return "Приват / ФОП";
    if (/binance|бинанс|usdt|crypto|крипт/.test(normalized)) return "Binance / crypto";
    if (/yoo|юmoney|юмани|яндекс|yandex|руб/.test(normalized)) return "YooMoney / Яндекс";
    if (/td|canada|канада|cad|банк канада/.test(normalized)) return "TD / Canada bank";
    if (/cash|налич/.test(normalized)) return "Наличные";
    return "Другие каналы";
  }

  function isIncomingRow(row, indexes) {
    const operation = normalizeText(indexes.operation === -1 ? "" : row[indexes.operation]);
    const direction = normalizeText(indexes.direction === -1 ? "" : row[indexes.direction]);
    if (/transfer|перевод|exchange|обмен/.test(operation) || /transfer|перевод|exchange|обмен/.test(direction)) return false;
    if (/expense|out|расход|списание/.test(operation) || /expense|out|расход|списание/.test(direction)) return false;
    if (/income|inflow|in|приход|зачисление|оплачено|fact|service/.test(operation)) return true;
    if (/income|inflow|in|приход|зачисление/.test(direction)) return true;
    const amount = parseNumber(indexes.amount === -1 ? 0 : row[indexes.amount]);
    return amount > 0 && (indexes.toChannel !== -1 || indexes.channel !== -1);
  }

  function getRowAmountUsd(row, indexes) {
    const usd = indexes.amountUsd === -1 ? 0 : parseNumber(row[indexes.amountUsd]);
    if (usd) return Math.abs(usd);
    const net = indexes.amountNet === -1 ? 0 : parseNumber(row[indexes.amountNet]);
    if (net) return Math.abs(net);
    const amount = indexes.amount === -1 ? 0 : parseNumber(row[indexes.amount]);
    return Math.abs(amount);
  }

  function getChannel(row, indexes) {
    return String(
      (indexes.toChannel !== -1 && row[indexes.toChannel]) ||
      (indexes.channel !== -1 && row[indexes.channel]) ||
      (indexes.fromChannel !== -1 && row[indexes.fromChannel]) ||
      "Не указан"
    ).trim() || "Не указан";
  }

  function getCandidateTables(appState) {
    const tabs = appState?.data?.tabs || {};
    const preferred = ["ledger", "Ledger", "fact", "Факт", "income", "incomes"];
    const tables = [];
    preferred.forEach((key) => {
      if (Array.isArray(tabs[key]?.values)) tables.push({ key, values: tabs[key].values });
    });
    Object.entries(tabs).forEach(([key, tab]) => {
      if (preferred.includes(key)) return;
      if (!Array.isArray(tab?.values)) return;
      const header = tab.values[0] || [];
      const headerText = normalizeHeaderKey(header.join(" "));
      if (/amount_net|amountusd|amount_usd|direction|operation|to_channel|from_channel|канал|приход/.test(headerText)) {
        tables.push({ key, values: tab.values });
      }
    });
    return tables;
  }

  function buildIncomeChannelBreakdown(input = {}, options = {}) {
    const appState = options.state || input.state || (input.data ? input : null) || getRootState();
    const period = getSelectedPeriod({ ...options, state: appState });
    const byType = new Map();
    let sourceRows = 0;

    getCandidateTables(appState).forEach(({ values }) => {
      const rows = Array.isArray(values) ? values : [];
      if (rows.length < 2) return;
      const header = rows[0] || [];
      const indexes = {
        date: findHeaderIndexByAliases(header, ["date", "DATE", "дата"]),
        operation: findHeaderIndexByAliases(header, ["operation", "операция", "type", "тип"]),
        direction: findHeaderIndexByAliases(header, ["direction", "направление"]),
        fromChannel: findHeaderIndexByAliases(header, ["from_channel", "from channel", "из канала", "откуда"]),
        toChannel: findHeaderIndexByAliases(header, ["to_channel", "to channel", "куда", "канал получатель", "канал оплаты"]),
        channel: findHeaderIndexByAliases(header, ["channel", "канал", "payment_channel", "payment channel", "source channel"]),
        amountUsd: findFirstHeaderIndex(header, [["amount_usd", "amount usd", "usd_amount", "usd amount", "сумма usd"], ["usd"]]),
        amountNet: findHeaderIndexByAliases(header, ["amount_net", "amount net", "net", "net amount"]),
        amount: findHeaderIndexByAliases(header, ["amount", "сумма", "value", "total"]),
      };
      const hasLedgerShape = indexes.amountUsd !== -1 || indexes.amountNet !== -1 || indexes.amount !== -1;
      if (!hasLedgerShape) return;
      rows.slice(1).forEach((row) => {
        if (!hasAnyValue(row)) return;
        const date = indexes.date === -1 ? "" : normalizeDateKey(row[indexes.date]);
        if (!isDateInPeriod(date, period)) return;
        if (!isIncomingRow(row, indexes)) return;
        const amount = getRowAmountUsd(row, indexes);
        if (!amount) return;
        const channel = getChannel(row, indexes);
        const type = classifyChannel(channel);
        if (!byType.has(type)) byType.set(type, { type, total: 0, count: 0, channels: new Map() });
        const typeBucket = byType.get(type);
        typeBucket.total += amount;
        typeBucket.count += 1;
        const channelBucket = typeBucket.channels.get(channel) || { channel, total: 0, count: 0 };
        channelBucket.total += amount;
        channelBucket.count += 1;
        typeBucket.channels.set(channel, channelBucket);
        sourceRows += 1;
      });
    });

    const buckets = Array.from(byType.values())
      .map((bucket) => ({
        type: bucket.type,
        total: bucket.total,
        count: bucket.count,
        channels: Array.from(bucket.channels.values()).sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);
    const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
    return {
      period,
      total,
      sourceRows,
      byType: buckets,
      diagnostics: sourceRows ? [] : ["needs verification: incoming Ledger/fact rows were not found in client state."],
    };
  }

  function formatMoney(value) {
    if (!Number.isFinite(Number(value))) return "needs verification";
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value, 2);
    return Number(value).toFixed(2).replace(".", ",");
  }

  function renderIncomeChannelBreakdown(breakdown = {}, doc = root.document) {
    const wrapper = doc.createElement("div");
    wrapper.className = BREAKDOWN_CLASS;
    const title = doc.createElement("div");
    title.className = "balance-income-channel-title";
    title.textContent = "Распределение приходов по типам каналов";
    wrapper.appendChild(title);

    if (!breakdown.byType?.length) {
      const empty = doc.createElement("div");
      empty.className = "balance-income-channel-empty";
      empty.textContent = "Нет найденных приходов за выбранный период.";
      wrapper.appendChild(empty);
      return wrapper;
    }

    const list = doc.createElement("ul");
    breakdown.byType.forEach((bucket) => {
      const item = doc.createElement("li");
      const channels = bucket.channels?.length
        ? ` — ${bucket.channels.map((row) => `${row.channel}: ${formatMoney(row.total)}`).join("; ")}`
        : "";
      item.textContent = `${bucket.type}: ${formatMoney(bucket.total)}${channels}`;
      list.appendChild(item);
    });
    wrapper.appendChild(list);
    return wrapper;
  }

  function appendIncomeChannelBreakdown(block, breakdown = buildIncomeChannelBreakdown(), doc = root.document) {
    if (!block || block.querySelector?.(`.${BREAKDOWN_CLASS}`)) return false;
    block.appendChild(renderIncomeChannelBreakdown(breakdown, doc));
    return true;
  }

  function enrichBalanceSummaryBlock() {
    const doc = root.document;
    const block = doc?.getElementById?.(BALANCE_BLOCK_ID);
    if (!block) return false;
    return appendIncomeChannelBreakdown(block, buildIncomeChannelBreakdown(), doc);
  }

  function bindBalanceButton() {
    const doc = root.document;
    const button = doc?.getElementById?.(BALANCE_BUTTON_ID);
    if (!button || button.__ezohataIncomeBreakdownBound) return Boolean(button);
    button.__ezohataIncomeBreakdownBound = true;
    button.addEventListener("click", () => root.setTimeout?.(enrichBalanceSummaryBlock, 0));
    return true;
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__ezohataIncomeBreakdownPatched) return false;
    const original = root.renderMetrics;
    root.renderMetrics = function renderMetricsWithIncomeBreakdown(...args) {
      const result = original.apply(this, args);
      root.setTimeout?.(enrichBalanceSummaryBlock, 0);
      return result;
    };
    root.renderMetrics.__ezohataIncomeBreakdownPatched = true;
    return true;
  }

  function startBalanceIncomeChannelBreakdown() {
    bindBalanceButton();
    patchRenderMetrics();
    enrichBalanceSummaryBlock();
  }

  const api = {
    buildIncomeChannelBreakdown,
    renderIncomeChannelBreakdown,
    appendIncomeChannelBreakdown,
    enrichBalanceSummaryBlock,
    startBalanceIncomeChannelBreakdown,
    classifyChannel,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataBalanceIncomeChannelBreakdown = api;
  startBalanceIncomeChannelBreakdown();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startBalanceIncomeChannelBreakdown);
})(typeof globalThis !== "undefined" ? globalThis : window);
