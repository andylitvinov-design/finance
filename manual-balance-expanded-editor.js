(function (root) {
  "use strict";

  function getGlobalFunction(name, fallback) {
    return typeof root[name] === "function" ? root[name] : fallback;
  }

  function normalizeDate(value) {
    const fn = getGlobalFunction("normalizeIncomingSheetDateValue", (raw) => String(raw || "").trim());
    return fn(value) || String(value || "").trim();
  }

  function getDefaultBalanceDate(options = {}) {
    return normalizeDate(
      options.defaultDate ||
      root.state?.manualFinance?.data?.periodEnd ||
      root.elements?.endDate?.value ||
      ""
    );
  }

  function getConfiguredBalanceChannels() {
    const fn = getGlobalFunction("getManualFinanceChannels", () => []);
    return Array.from(new Set(
      (fn() || [])
        .map((channel) => String(channel || "").trim())
        .filter(Boolean)
    ));
  }

  function canonicalBalanceChannel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const fn = getGlobalFunction("canonicalManualFinanceChannel", (channel) => String(channel || "").trim());
    return String(fn(raw) || raw).trim();
  }

  function inferBalanceCurrency(channel) {
    const fn = getGlobalFunction("inferManualFinanceChannelCurrency", () => "");
    return String(fn(channel) || "").trim().toUpperCase();
  }

  function normalizeBalanceNumber(value) {
    const fn = getGlobalFunction("normalizeManualFinancePersistedNumberInput", (raw) => String(raw ?? "").trim());
    return fn(value);
  }

  function hasEnteredBalanceValue(row = {}) {
    return [row.amount, row.usdAmount, row.rate, row.comment]
      .some((value) => String(value ?? "").trim());
  }

  function createExpandedBalanceRow(channel, defaultDate, row = {}) {
    const canonicalChannel = canonicalBalanceChannel(row.channel || row.accountName || channel || "");
    const currency = String(row.currency || inferBalanceCurrency(canonicalChannel)).trim().toUpperCase();
    return {
      date: normalizeDate(row.date || defaultDate),
      channel: canonicalChannel,
      amount: normalizeBalanceNumber(row.amount ?? row.actual_balance ?? row.balanceAmount),
      currency,
      rate: normalizeBalanceNumber(row.rate),
      usdAmount: normalizeBalanceNumber(row.usdAmount ?? row.amountUsd),
      comment: String(row.comment || "").trim()
    };
  }

  function buildExpandedManualFinanceBalanceEditorRows(rows = [], options = {}) {
    const defaultDate = getDefaultBalanceDate(options);
    const configuredChannels = getConfiguredBalanceChannels();
    const configuredSet = new Set(configuredChannels);
    const firstConfiguredRows = new Map();
    const extraRows = [];

    (Array.isArray(rows) ? rows : []).forEach((sourceRow) => {
      const row = createExpandedBalanceRow("", defaultDate, sourceRow || {});
      if (!row.channel && !hasEnteredBalanceValue(row)) return;
      if (row.channel && configuredSet.has(row.channel) && !firstConfiguredRows.has(row.channel)) {
        firstConfiguredRows.set(row.channel, row);
        return;
      }
      if (row.channel || hasEnteredBalanceValue(row)) extraRows.push(row);
    });

    return [
      ...configuredChannels.map((channel) => (
        firstConfiguredRows.get(channel) || createExpandedBalanceRow(channel, defaultDate)
      )),
      ...extraRows.filter((row) => !configuredSet.has(row.channel) || hasEnteredBalanceValue(row))
    ];
  }

  function ensureExpandedBalanceRowsInState() {
    const data = root.state?.manualFinance?.data;
    if (!data) return [];
    const rows = buildExpandedManualFinanceBalanceEditorRows(data.balanceRows || [], {
      defaultDate: data.periodEnd || root.elements?.endDate?.value || ""
    });
    data.balanceRows = rows;
    return rows;
  }

  function appendBalanceChannelCell(tr, row, rowIndex) {
    if (String(row.channel || "").trim()) {
      root.appendManualFinanceReadonlyCell(tr, row.channel || "");
      return;
    }
    root.appendManualFinanceSelectCell(
      tr,
      row.channel || "",
      getConfiguredBalanceChannels(),
      (value) => root.updateManualFinanceBalanceValue(rowIndex, "channel", value)
    );
  }

  function renderManualFinanceBalanceEditor() {
    const block = root.document.createElement("div");
    const note = root.document.createElement("div");
    note.className = "config-note";
    note.style.marginBottom = "12px";
    note.textContent = "Все каналы раскрыты: внесите actual_balance в нужных строках и сохраните Остатки.";
    block.appendChild(note);

    const wrap = root.document.createElement("div");
    wrap.className = "table-wrap";
    const table = root.document.createElement("table");
    const body = root.document.createElement("tbody");
    const header = root.document.createElement("tr");
    ["дата", "канал / счет", "валюта", "actual_balance", "курс", "сумма_usd", "комментарий"].forEach((label) => {
      const th = root.document.createElement("th");
      th.textContent = label;
      header.appendChild(th);
    });
    body.appendChild(header);

    const rows = ensureExpandedBalanceRowsInState();
    rows.forEach((row, rowIndex) => {
      const tr = root.document.createElement("tr");
      root.appendManualFinanceInputCell(tr, row.date || "", "date", (value) => root.updateManualFinanceBalanceValue(rowIndex, "date", value));
      appendBalanceChannelCell(tr, row, rowIndex);
      root.appendManualFinanceInputCell(tr, row.currency || "", "text", (value) => root.updateManualFinanceBalanceValue(rowIndex, "currency", value));
      root.appendManualFinanceInputCell(tr, row.amount || "", "text", (value) => root.updateManualFinanceBalanceValue(rowIndex, "amount", value));
      root.appendManualFinanceReadonlyCell(tr, row.rate || "");
      root.appendManualFinanceReadonlyCell(tr, row.usdAmount || "");
      root.appendManualFinanceInputCell(tr, row.comment || "", "text", (value) => root.updateManualFinanceBalanceValue(rowIndex, "comment", value));
      body.appendChild(tr);
    });

    table.appendChild(body);
    wrap.appendChild(table);
    block.appendChild(wrap);
    return block;
  }

  root.EzohataManualBalanceExpandedEditor = {
    buildExpandedManualFinanceBalanceEditorRows,
    createExpandedBalanceRow,
    hasEnteredBalanceValue
  };

  if (typeof root.document !== "undefined") {
    root.renderManualFinanceBalanceEditor = renderManualFinanceBalanceEditor;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.EzohataManualBalanceExpandedEditor;
  }
})(typeof window !== "undefined" ? window : globalThis);
