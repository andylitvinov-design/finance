// ============================================================
// ORDERS STORAGE
// ============================================================

async function loadManualOrdersSheet(interactive = false) {
  state.manualOrders.loading = true;
  renderTabs();
  try {
    if (!hasConfiguredManualOrdersEndpoint()) {
      throw new Error(getManualOrdersUnavailableMessage());
    }
    const payload = await getManualOrdersSheetDirect();
    state.manualOrders.data = buildManualOrdersStateFromPayload(payload);
    state.manualOrders.dirty = false;
    setManualOrdersStatus("Orders открыты из manual workbook.", false);
    applyManualOrdersToDashboard(elements.startDate.value, elements.endDate.value);
  } catch (error) {
    openLocalManualOrders(error.message || getManualOrdersUnavailableMessage(), Boolean(state.googleAuth.accessToken));
    applyManualOrdersToDashboard(elements.startDate.value, elements.endDate.value);
  } finally {
    state.manualOrders.loading = false;
    renderTabs();
  }
}

function openLocalManualOrders(statusMessage, isError = true) {
  const saved = getLocalOrdersDraft();
  const config = getManualOrdersConfig();
  state.manualOrders.data = buildManualOrdersStateFromPayload({
    sheetName: config.sheetName,
    sourceSheetName: "",
    sourceType: "local",
    virtual: true,
    writeEnabled: false,
    headers: saved?.headers || MANUAL_ORDERS_HEADERS,
    rows: saved?.rows || buildDefaultManualOrdersRows(),
    spreadsheetUrl: config.spreadsheetUrl
  });
  state.manualOrders.dirty = false;
  setManualOrdersStatus(statusMessage, isError);
}

async function saveManualOrdersSheet() {
  if (!state.manualOrders.data) return;
  if (!hasConfiguredManualOrdersEndpoint()) {
    persistLocalOrdersDraft(state.manualOrders.data);
    state.manualOrders.dirty = false;
    setManualOrdersStatus("Локальный orders draft сохранён в браузере.", false);
    renderTabs();
    return;
  }
  state.manualOrders.loading = true;
  renderTabs();
  try {
    clearManualServerCache();
    const response = await saveManualOrdersSheetDirect({
      headers: state.manualOrders.data.headers,
      rows: state.manualOrders.data.rows
    });
    await loadManualOrdersSheet(false);
    setManualOrdersStatus(`Orders сохранены в manual workbook. ${response?.savedAt || ""}`.trim(), false);
    await loadDashboardData();
  } catch (error) {
    setManualOrdersStatus(error.message || "Не удалось сохранить orders.", true);
  } finally {
    state.manualOrders.loading = false;
    renderTabs();
  }
}

function buildManualOrdersStateFromPayload(data) {
  return {
    sheetName: data.sheetName || getManualOrdersConfig().sheetName,
    sourceSheetName: data.sourceSheetName || "",
    sourceType: data.sourceType || "local",
    virtual: Boolean(data.virtual),
    writeEnabled: Boolean(data.writeEnabled),
    headers: normalizeManualOrdersHeaders(data.headers),
    rows: normalizeManualOrdersRows(data.rows),
    spreadsheetUrl: data.spreadsheetUrl || getManualOrdersConfig().spreadsheetUrl
  };
}


// ============================================================
// ORDERS DATA AND UI STATE
// ============================================================

function buildDefaultManualOrdersRows() {
  return Array.from({ length: MANUAL_ORDERS_DEFAULT_ROWS }, () => Array.from({ length: MANUAL_ORDERS_HEADERS.length }, () => ""));
}

function normalizeManualOrdersHeaders(headers) {
  const mapped = ORDERS_HELPER.mapLegacyOrdersValues
    ? ORDERS_HELPER.mapLegacyOrdersValues([Array.isArray(headers) ? headers : MANUAL_ORDERS_HEADERS]).headers
    : MANUAL_ORDERS_HEADERS;
  return padRowToWidth((mapped || MANUAL_ORDERS_HEADERS).map((cell) => String(cell || "")), MANUAL_ORDERS_HEADERS.length).slice(0, MANUAL_ORDERS_HEADERS.length);
}

function normalizeManualOrdersRows(rows) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => padRowToWidth((Array.isArray(row) ? row : []).map((cell) => String(cell || "")), MANUAL_ORDERS_HEADERS.length).slice(0, MANUAL_ORDERS_HEADERS.length))
    .filter((row) => row.some((cell) => String(cell || "").trim()));
  return normalized.length ? normalized : buildDefaultManualOrdersRows();
}

function buildManualOrdersValuesFromState(headers, rows) {
  return [normalizeManualOrdersHeaders(headers), ...normalizeManualOrdersRows(rows)];
}

function parseManualOrdersValues(values) {
  if (!Array.isArray(values) || !values.length) {
    return { headers: MANUAL_ORDERS_HEADERS.slice(), rows: buildDefaultManualOrdersRows() };
  }
  const mapped = ORDERS_HELPER.mapLegacyOrdersValues
    ? ORDERS_HELPER.mapLegacyOrdersValues(values)
    : { headers: values[0], rows: values.slice(1) };
  return {
    headers: normalizeManualOrdersHeaders(mapped.headers),
    rows: normalizeManualOrdersRows(mapped.rows)
  };
}

function updateManualOrderValue(rowIndex, cellIndex, rawValue) {
  const row = state.manualOrders.data?.rows?.[rowIndex];
  if (!row) return;
  row[cellIndex] = rawValue;
  state.manualOrders.dirty = true;
}

function addManualOrderRow() {
  if (!state.manualOrders.data) return;
  state.manualOrders.data.rows.push(Array.from({ length: MANUAL_ORDERS_HEADERS.length }, () => ""));
  state.manualOrders.dirty = true;
  renderTabs();
}

function removeManualOrderRow(rowIndex) {
  if (!state.manualOrders.data) return;
  state.manualOrders.data.rows.splice(rowIndex, 1);
  if (!state.manualOrders.data.rows.length) {
    state.manualOrders.data.rows = buildDefaultManualOrdersRows();
  }
  state.manualOrders.dirty = true;
  renderTabs();
}

function appendManualOrdersFromText() {
  if (!state.manualOrders.data) {
    setManualOrdersStatus("Сначала откройте orders.", true);
    renderTabs();
    return;
  }
  const rawText = String(state.manualOrders.textDraft || "").trim();
  if (!rawText) {
    setManualOrdersStatus("Вставьте текст заказа перед разбором.", true);
    renderTabs();
    return;
  }
  const parser = ORDERS_HELPER.parseManualOrdersTextBlocks;
  const defaultDate = elements.endDate.value || elements.startDate.value || "";
  const rows = typeof parser === "function" ? parser(rawText, defaultDate) : [];
  if (!rows.length) {
    setManualOrdersStatus("Не удалось разобрать текст заказа.", true);
    renderTabs();
    return;
  }
  state.manualOrders.data.rows = rows.map((row) => row.slice());
  state.manualOrders.textDraft = "";
  state.manualOrders.dirty = true;
  setManualOrdersStatus(`Текст разобран в ${rows.length} строк(и). Таблица заказов пересобрана из текущего текста.`, false);
  applyManualOrdersToDashboard(elements.startDate.value, elements.endDate.value);
  renderTabs();
}


// ============================================================
// ORDERS STORAGE
// ============================================================

function persistLocalOrdersDraft(data) {
  localStorage.setItem("ezohata:v2:orders", JSON.stringify({
    headers: data.headers,
    rows: data.rows
  }));
}

function getLocalOrdersDraft() {
  try { return JSON.parse(localStorage.getItem("ezohata:v2:orders") || "null"); }
  catch { return null; }
}

function setManualOrdersStatus(message, isError = false) {
  state.manualOrders.status = message;
  state.manualOrders.error = Boolean(isError);
}

function getManualOrdersUnavailableMessage() {
  if (hasManualWorkbookServerAccess()) {
    return "Orders server access is unavailable. Browser OAuth fallback is debug-only.";
  }
  return "Orders server access is not configured.";
}

async function syncManualOrdersForCurrentRange(startDate, endDate) {
  if (!state.data) return;
  if (state.manualOrders.data) {
    applyManualOrdersToDashboard(startDate, endDate);
    return;
  }
  try {
    if (hasConfiguredManualOrdersEndpoint()) {
      const payload = await getManualOrdersSheetDirect();
      state.manualOrders.data = buildManualOrdersStateFromPayload(payload);
    } else if (getLocalOrdersDraft()) {
      openLocalManualOrders("Открыт локальный orders draft.", false);
    }
  } catch (error) {
    setManualOrdersStatus(error.message || "Не удалось загрузить orders.", true);
  }
  applyManualOrdersToDashboard(startDate, endDate);
}


// ============================================================
// ORDERS DATA AND UI STATE
// ============================================================

function applyManualOrdersToDashboard(startDate = elements.startDate.value, endDate = elements.endDate.value) {
  if (!state.data || !state.data.tabs) return;
  const visible = getVisibleManualOrdersRows(startDate, endDate);
  if (!visible.headers.length) return;
  state.data.tabs.orders = {
    ...(state.data.tabs.orders || {}),
    sheetName: state.manualOrders.data?.sheetName || state.data.tabs.orders?.sheetName || MANUAL_ORDERS_SHEET_NAME,
    values: [visible.headers.slice(), ...visible.rows.map((row) => row.slice())],
    headerRowIndex: 0,
    sourceType: state.manualOrders.data?.sourceType || state.data.tabs.orders?.sourceType || "manual-orders"
  };
  state.data.ordersSummary = buildOrdersSummaryFromClient(state.data.tabs.orders.values);
}


// ============================================================
// HELPERS
// ============================================================

function getVisibleManualOrdersRows(startDate = elements.startDate.value, endDate = elements.endDate.value) {
  const data = state.manualOrders.data;
  if (!data) {
    const fallbackValues = state.data?.tabs?.orders?.values || [];
    return {
      headers: (fallbackValues[0] || []).slice(),
      rows: fallbackValues.slice(1).map((row) => row.slice())
    };
  }
  const dateIndex = findDateColumnIndex(data.headers);
  const start = parseIsoDate(startDate || "1970-01-01");
  const end = parseIsoDate(endDate || startDate || "2999-12-31");
  const periodYear = start.getFullYear();
  const rows = data.rows.filter((row) => {
    if (!hasAnyValue(row)) return false;
    const cellDate = dateIndex === -1 ? null : parseDisplayDate(row[dateIndex], periodYear);
    if (!cellDate) return false;
    return cellDate >= start && cellDate <= end;
  });
  return {
    headers: data.headers.slice(),
    rows: rows.map((row) => padRowToWidth(row.slice(), data.headers.length))
  };
}


// ============================================================
// ORDERS DATA AND UI STATE
// ============================================================

function buildOrdersSummaryFromClient(values) {
  if (!values.length) {
    return { orderRows: 0, totalAccruedPlus3Pct: 0, totalReceivedUsd: 0, totalBalanceUsd: 0 };
  }
  const header = values[0] || [];
  const accruedIndex = findHeaderIndexByAliases(header, ["ACCRUED +3%", "СТОИМОСТЬ", "COST", "PRICE BASE"]);
  const receivedIndex = findHeaderIndexByAliases(header, ["ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "RECEIVED TOTAL USD"]);
  const balanceIndex = findHeaderIndexByAliases(header, ["BALANCE", "БАЛАНС"]);
  let totalAccrued = 0;
  let totalReceived = 0;
  let totalBalance = 0;
  let orderRows = 0;
  values.slice(1).forEach((row) => {
    if (!hasAnyValue(row)) return;
    if (isTableTotalRow(row)) return;
    orderRows += 1;
    if (accruedIndex !== -1 && accruedIndex < row.length) totalAccrued += parseLooseNumber(row[accruedIndex]);
    if (receivedIndex !== -1 && receivedIndex < row.length) totalReceived += parseLooseNumber(row[receivedIndex]);
    if (balanceIndex !== -1 && balanceIndex < row.length) totalBalance += parseLooseNumber(row[balanceIndex]);
  });
  if (balanceIndex === -1) totalBalance = totalAccrued - totalReceived;
  return {
    orderRows,
    totalAccruedPlus3Pct: roundTo2(totalAccrued),
    totalReceivedUsd: roundTo2(totalReceived),
    totalBalanceUsd: roundTo2(totalBalance)
  };
}
