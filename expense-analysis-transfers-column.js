// Additive UI diagnostic for Учёт расходов → анализ финансов.
// Shows transfer/exchange outflow as a separate column near real expenses
// without changing balance, provider import, ledger save, or finance semantics.
(function applyExpenseAnalysisTransfersColumn() {
  if (typeof window === "undefined") return;

  const COLUMN_LABEL = "Переводы";
  const GUARD_FLAG = "__expenseAnalysisTransfersColumnGuard";

  function normalizeText(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function normalizeDate(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const display = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
    return raw.slice(0, 10);
  }

  function getDomValue(id) {
    if (typeof document === "undefined" || !document.getElementById) return "";
    return document.getElementById(id)?.value || "";
  }

  function getSelectedPeriod() {
    const startDate = normalizeDate(getDomValue("startDate"));
    const endDate = normalizeDate(getDomValue("endDate"));
    return { startDate, endDate };
  }

  function isRowInPeriod(row, period = getSelectedPeriod()) {
    const date = normalizeDate(
      row?.date ||
      row?.operationDate ||
      row?.operation_date ||
      row?.transactionDate ||
      row?.transaction_date ||
      row?.postedDate ||
      row?.posted_date ||
      row?.createdAt ||
      row?.created_at ||
      row?.ledgerV2?.date ||
      ""
    );
    if (!date) return true;
    if (period.startDate && date < period.startDate) return false;
    if (period.endDate && date > period.endDate) return false;
    return true;
  }

  function parseAmount(value) {
    if (typeof window.parseLooseNumber === "function") return window.parseLooseNumber(value);
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatAmount(value) {
    if (typeof window.formatSheetNumber === "function") return window.formatSheetNumber(value);
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function canonicalChannel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (typeof window.canonicalManualFinanceChannel === "function") return window.canonicalManualFinanceChannel(raw);
    if (typeof window.getCanonicalManualChannelKey === "function") return window.getCanonicalManualChannelKey(raw);
    const normalized = normalizeText(raw);
    const aliases = {
      "wise": "трансервайз дол",
      "wise usd": "трансервайз дол",
      "transferwise": "трансервайз дол",
      "transferwise usd": "трансервайз дол",
      "paypal usd": "пейпал дол",
      "paypal eur": "пейпал евр",
      "paypal cad": "пейпал сad",
      "mono": "монобанк грн",
      "monobank": "монобанк грн",
      "privat fop": "приват-фоп",
      "приват фоп": "приват-фоп"
    };
    return aliases[normalized] || raw;
  }

  function getField(row, camel, snake) {
    return row?.[camel] ?? row?.[snake] ?? row?.ledgerV2?.[camel] ?? row?.ledgerV2?.[snake] ?? "";
  }

  function getAmountUsd(row) {
    const amountUsd = getField(row, "amountUsd", "amount_usd");
    if (String(amountUsd ?? "").trim()) return parseAmount(amountUsd);
    const amountNetUsd = getField(row, "amountNetUsd", "amount_net_usd");
    if (String(amountNetUsd ?? "").trim()) return parseAmount(amountNetUsd);
    const currency = normalizeText(getField(row, "currency", "currency"));
    if (!currency || currency === "usd" || currency === "дол") return parseAmount(getField(row, "amountNet", "amount_net") || getField(row, "amount", "amount"));
    return 0;
  }

  function isTransferOrExchangeRow(row) {
    const operation = normalizeText(getField(row, "operation", "operation"));
    const category = normalizeText(getField(row, "category", "category"));
    const direction = normalizeText(getField(row, "direction", "direction"));
    const text = normalizeText([
      row?.comment,
      row?.description,
      row?.raw_source_id,
      row?.rawSourceId,
      row?.ledgerV2?.comment,
      row?.ledgerV2?.description
    ].filter(Boolean).join(" "));

    if (/transfer|перевод|internal movement|internal account|partner transfer/.test(operation)) return true;
    if (/exchange|обмен/.test(operation)) return true;
    if (["exchange", "partner", "transfer", "перевод", "обмен"].includes(category)) return true;
    if (/перевод|обмен|internal movement|internal account|partner transfer|sent money/.test(text)) return true;
    if (/^(in|out)$/.test(direction) && /transfer|перевод|обмен/.test(text)) return true;
    return false;
  }

  function getRowKey(row) {
    return [
      row?.sourceTransactionId,
      row?.source_transaction_id,
      row?.rawSourceId,
      row?.raw_source_id,
      row?.id,
      row?.ledgerV2?.sourceTransactionId,
      row?.ledgerV2?.raw_source_id,
      normalizeDate(row?.date || row?.ledgerV2?.date || ""),
      getField(row, "operation", "operation"),
      getField(row, "fromChannel", "from_channel"),
      getField(row, "toChannel", "to_channel"),
      getAmountUsd(row),
      row?.comment || row?.description || ""
    ].join("|");
  }

  function collectLedgerRows() {
    const state = window.state || {};
    const buckets = [
      state.aggregatedManualRange?.rows,
      state.analyticsFact?.moneyRows,
      state.analyticsFact?.transferRows,
      state.data?.manual?.operations,
      state.data?.manual?.ledgerV2Rows,
      state.data?.manual?.transferRows,
      state.data?.manual?.expenseRows,
      state.data?.manual?.incomeRows,
      state.data?.tabs?.manualFinance?.rows
    ];
    const seen = new Set();
    const rows = [];
    buckets.forEach((bucket) => {
      if (!Array.isArray(bucket)) return;
      bucket.forEach((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return;
        const key = getRowKey(row);
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(row);
      });
    });
    return rows;
  }

  function buildTransferOutByChannel(rows = collectLedgerRows(), period = getSelectedPeriod()) {
    return rows.reduce((totals, row) => {
      if (!isTransferOrExchangeRow(row) || !isRowInPeriod(row, period)) return totals;
      const amountUsd = getAmountUsd(row);
      if (!amountUsd) return totals;
      const direction = normalizeText(getField(row, "direction", "direction"));
      const fromChannel = canonicalChannel(getField(row, "fromChannel", "from_channel"));
      const toChannel = canonicalChannel(getField(row, "toChannel", "to_channel"));
      const operation = normalizeText(getField(row, "operation", "operation"));
      const isOut = direction === "out" || amountUsd < 0 || /out|расход|expense|exchange out|transfer out/.test(operation);
      const channel = isOut ? fromChannel : toChannel;
      if (!channel) return totals;
      totals[channel] = (totals[channel] || 0) + Math.abs(amountUsd);
      return totals;
    }, {});
  }

  function getCellText(cell) {
    return normalizeText(cell?.textContent || cell?.innerText || "");
  }

  function findInsertIndex(headerCells) {
    const labels = headerCells.map(getCellText);
    if (labels.includes(normalizeText(COLUMN_LABEL))) return -1;
    const realSpentIndex = labels.findIndex((label) => label.includes("потрачено реал"));
    const diffIndex = labels.findIndex((label) => label.includes("разница"));
    if (realSpentIndex !== -1 && diffIndex !== -1 && realSpentIndex < diffIndex) return diffIndex;
    if (realSpentIndex !== -1) return realSpentIndex + 1;
    if (diffIndex !== -1) return diffIndex;
    return -1;
  }

  function insertCell(row, index, tagName, text) {
    const cell = document.createElement(tagName);
    cell.textContent = text;
    const before = row.children[index] || null;
    row.insertBefore(cell, before);
    return cell;
  }

  function enhanceExpenseAnalysisTable(root) {
    if (!root || !root.querySelectorAll) return root;
    const transfersByChannel = buildTransferOutByChannel();
    root.querySelectorAll("table").forEach((table) => {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (!rows.length) return;
      const headerRow = rows.find((row) => Array.from(row.children || []).some((cell) => getCellText(cell).includes("потрачено реал")));
      if (!headerRow) return;
      const headerCells = Array.from(headerRow.children || []);
      const insertIndex = findInsertIndex(headerCells);
      if (insertIndex === -1) return;
      insertCell(headerRow, insertIndex, "th", COLUMN_LABEL);

      rows.slice(rows.indexOf(headerRow) + 1).forEach((row) => {
        const cells = Array.from(row.children || []);
        if (!cells.length) return;
        const channel = canonicalChannel(cells[0]?.textContent || "");
        const value = transfersByChannel[channel] || 0;
        insertCell(row, insertIndex, "td", formatAmount(value));
      });
    });
    return root;
  }

  function wrapRenderer() {
    const original = window.renderExpenseAnalysisChannelBlock;
    if (typeof original !== "function" || original[GUARD_FLAG]) return false;
    function renderExpenseAnalysisChannelBlockWithTransfers(...args) {
      const node = original.apply(this, args);
      try {
        enhanceExpenseAnalysisTable(node);
      } catch (error) {
        console.warn("Expense analysis transfers column failed", error);
      }
      return node;
    }
    renderExpenseAnalysisChannelBlockWithTransfers[GUARD_FLAG] = true;
    renderExpenseAnalysisChannelBlockWithTransfers.__original = original;
    window.renderExpenseAnalysisChannelBlock = renderExpenseAnalysisChannelBlockWithTransfers;
    return true;
  }

  wrapRenderer();

  window.EzohataExpenseAnalysisTransfersColumn = {
    normalizeText,
    normalizeDate,
    isTransferOrExchangeRow,
    getAmountUsd,
    canonicalChannel,
    buildTransferOutByChannel,
    enhanceExpenseAnalysisTable,
    wrapRenderer,
  };
})();
