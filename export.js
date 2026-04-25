// ============================================================
// EXPORTS
// ============================================================

function downloadTabCsv(tabId) {
  const rows = getExportRowsForTab(tabId);
  if (!rows.length) return;
  const exportRows = prepareRowsForExport(rows, "csv");
  const csv = exportRows.map((row) => (row || []).map(escapeCsvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildDownloadFileName(getSheetNameForExport(tabId), "csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyTabTsv(tabId) {
  const rows = getExportRowsForTab(tabId);
  if (!rows.length) return;
  const exportRows = prepareRowsForExport(rows, "tsv");
  const tsv = exportRows.map((row) => (row || []).map((cell) => String(cell ?? "")).join("\t")).join("\n");
  try {
    await navigator.clipboard.writeText(tsv);
    setStatus("Таблица скопирована в Excel-совместимом формате.");
  } catch (error) {
    setStatus("Не удалось скопировать таблицу в буфер обмена.", true);
  }
}

function downloadTabXlsx(tabId) {
  const rows = getExportRowsForTab(tabId);
  if (!rows.length) return;
  if (typeof XLSX === "undefined" || !XLSX?.utils) {
    setStatus("XLSX библиотека не загрузилась.", true);
    return;
  }
  const exportRows = prepareRowsForExport(rows, "xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(exportRows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(getSheetNameForExport(tabId)));
  XLSX.writeFile(workbook, buildDownloadFileName(getSheetNameForExport(tabId), "xlsx"));
}

function prepareRowsForExport(rows, mode = "xlsx") {
  return (rows || []).map((row) => (row || []).map((cell) => coerceExportCell(cell, mode)));
}

function coerceExportCell(value, mode = "xlsx") {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim();
  if (isManualFinanceFormula(raw)) {
    const evaluated = evaluateManualFinanceFormula(raw, []);
    if (evaluated !== null && Number.isFinite(evaluated)) {
      return mode === "xlsx" ? evaluated : String(evaluated);
    }
  }
  if (!looksLikeExportNumber(raw)) return String(value ?? "");
  const numeric = parseLooseNumber(raw);
  if (!Number.isFinite(numeric)) return String(value ?? "");
  return mode === "xlsx" ? numeric : String(numeric);
}

function looksLikeExportNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (isManualFinanceFormula(raw) && evaluateManualFinanceFormula(raw, []) !== null) return true;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw) || /^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  if (!/^-?\d[\d\s.,]*$/.test(raw)) return false;
  return /\d/.test(raw);
}

function getSheetNameForExport(tabId) {
  if (tabId === "manualFinance") {
    return state.manualFinance.data?.sheetName || "incoming-ledger";
  }
  if (tabId === "orders") {
    return state.manualOrders.data?.sheetName || MANUAL_ORDERS_SHEET_NAME;
  }
  if (tabId === "savings") {
    return "Переводы";
  }
  return state.data?.tabs?.[tabId]?.sheetName || tabId;
}

function getExportRowsForTab(tabId) {
  if (tabId === "manualFinance") {
    return getManualFinanceExportRows();
  }
  if (tabId === "orders") {
    return getManualOrdersExportRows();
  }
  if (tabId === "savings") {
    return getTransfersExportRows();
  }
  const tabData = state.data?.tabs?.[tabId];
  const rows = clone2dArray(tabId === "analytics" ? getAnalyticsMergedValues() : (tabData?.values || []));
  if (tabId === "analytics") {
    return getAnalyticsExportRows(rows);
  }
  if (tabId === "payouts") {
    return getUnifiedPayoutExportRows(rows);
  }
  return rows;
}

function getUnifiedPayoutExportRows(payoutRows) {
  const rows = clone2dArray(payoutRows || []);
  if (!rows.length) return rows;
  const transferRows = getNormalizedPayoutTransferRows().rows;
  if (!transferRows.length) return rows;
  return mergePayoutsWithClosedTransfers(rows, transferRows);
}


// ============================================================
// HELPERS
// ============================================================

function getTransfersTabValues() {
  if (state.manualTransfers.data?.transferRows) {
    return [
      [state.manualTransfers.data.transferTitle || getManualTransfersSheetName()],
      (state.manualTransfers.data.transferHeaders || MANUAL_TRANSFER_HEADERS).slice(),
      ...state.manualTransfers.data.transferRows.map((row) => [
        row.transferDate || "",
        row.who || "",
        row.amount || "",
        row.currency || "",
        row.channel || "",
        row.rate || "",
        row.usdAmount || ""
      ]),
      [],
      [state.manualTransfers.data.commissionTitle || getManualCommissionsSheetName()],
      (state.manualTransfers.data.commissionHeaders || MANUAL_COMMISSION_HEADERS).slice(),
      ...normalizeManualCommissionRows(state.manualTransfers.data.commissionRows || [], { padToMinimum: false }).map((row) => [
        row.date || "",
        row.channel || "",
        row.usdAmount || "",
        row.comment || ""
      ])
    ];
  }
  return [];
}


// ============================================================
// EXPORTS
// ============================================================

function getTransfersExportRows() {
  return getTransfersTabValues();
}

function getAnalyticsExportRows(values) {
  const sections = getAnalyticsSections(values);
  if (!sections.length) return values;
  const output = [];
  sections.forEach((section, index) => {
    if (index > 0) output.push([]);
    output.push([section.title]);
    section.rows.forEach((row) => output.push((row || []).map((cell) => coerceAnalyticsExportCell(cell))));
  });
  return output;
}

function coerceAnalyticsExportCell(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (isManualFinanceFormula(raw)) {
    const evaluated = evaluateManualFinanceFormula(raw, []);
    if (evaluated !== null) return evaluated;
  }
  if (looksLikeExportNumber(raw)) {
    const numeric = parseLooseNumber(raw);
    if (Number.isFinite(numeric)) return numeric;
  }
  return value;
}

function getManualFinanceExportRows() {
  if (!state.manualFinance.data) return [];
  const moneyRows = state.manualFinance.data.moneyRows || [];
  const usdRateLookup = buildManualFinanceUsdRateLookup(
    state.manualFinance.data.transferRows,
    state.data?.tabs?.movement?.values || []
  );
  return [
    [state.manualFinance.data.moneyTitle || MANUAL_FINANCE_MONEY_TITLE],
    getManualFinanceDisplayHeaders(state.manualFinance.data.moneyHeaders || MANUAL_FINANCE_HEADERS),
    ...moneyRows.map((row, rowIndex) => [
      row.channel || "",
      normalizeManualFinancePersistedNumberInput(row.now, { rows: moneyRows, rowIndex, key: "now" }),
      normalizeManualFinancePersistedNumberInput(row.serviceIncome, { rows: moneyRows, rowIndex, key: "serviceIncome" }),
      normalizeManualFinancePersistedNumberInput(row.business, { rows: moneyRows, rowIndex, key: "business" }),
      normalizeManualFinancePersistedNumberInput(row.house, { rows: moneyRows, rowIndex, key: "house" }),
      normalizeManualFinancePersistedNumberInput(row.food, { rows: moneyRows, rowIndex, key: "food" }),
      normalizeManualFinancePersistedNumberInput(row.study, { rows: moneyRows, rowIndex, key: "study" }),
      normalizeManualFinancePersistedNumberInput(row.travelFun, { rows: moneyRows, rowIndex, key: "travelFun" }),
      row.total || "",
      normalizeManualFinancePersistedNumberInput(row.exchange, { rows: moneyRows, rowIndex, key: "exchange" }),
      getManualFinanceTotalUsdValue(row, usdRateLookup),
      getManualFinanceNowUsdValue(row, usdRateLookup)
    ]),
    [],
    [state.manualFinance.data.transferTitle || MANUAL_FINANCE_TRANSFER_TITLE],
    [...(state.manualFinance.data.transferHeaders || MANUAL_TRANSFER_HEADERS)],
    ...state.manualFinance.data.transferRows.map((row) => [
      row.transferDate ?? "",
      row.who ?? "",
      normalizeManualFinancePersistedNumberInput(row.amount),
      row.currency ?? "",
      row.channel ?? "",
      normalizeManualFinancePersistedNumberInput(row.rate),
      normalizeManualFinancePersistedNumberInput(row.usdAmount)
    ])
  ];
}

function getManualOrdersExportRows() {
  if (state.manualOrders.data) {
    return [state.manualOrders.data.headers.slice(), ...state.manualOrders.data.rows.map((row) => row.slice())];
  }
  return clone2dArray(state.data?.tabs?.orders?.values || []);
}

function sanitizeSheetName(value) {
  return String(value || "Sheet1").replace(/[\\/?*:[\]]/g, " ").trim().slice(0, 31) || "Sheet1";
}

function isTableTotalLabel(value) {
  const normalized = normalizeCell(value);
  return normalized === normalizeCell(MANUAL_FINANCE_TOTAL_LABEL) || normalized === normalizeCell("итого за период");
}

function isTableTotalRow(row) {
  return isTableTotalLabel(row?.[0]);
}

function buildDownloadFileName(sheetName, extension = "csv") {
  const datePart = `${elements.startDate.value || "start"}_${elements.endDate.value || "end"}`;
  const safeSheetName = String(sheetName || "dashboard").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");
  return `${safeSheetName || "dashboard"}_${datePart}.${extension}`;
}

function escapeCsvCell(value) {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}
