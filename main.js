// ============================================================
// APP BOOTSTRAP AND DATA LOADING
// ============================================================

async function init() {
  state.config = await loadConfig();
  elements.endpointLabel.textContent = `Server dashboard API | v${getConfiguredAppVersion()} | build ${APP_BUILD_VERSION}`;
  state.googleAuth.clientId = String(state.config?.googleAuth?.clientId || "").trim();
  state.googleAuth.scopes = String(state.config?.googleAuth?.scopes || "https://www.googleapis.com/auth/spreadsheets").trim();
  state.googleAuth.configured = Boolean(
    state.googleAuth.clientId &&
    state.googleAuth.clientId !== "PASTE_GOOGLE_OAUTH_CLIENT_ID"
  );
  elements.manualEndpointLabel.textContent = state.googleAuth.configured
    ? getOAuthReadinessMessage()
    : "Set googleAuth.clientId in sheet-config.json for fact/orders editing";
  await applyDefaultDatesFromSnapshot();
  elements.todayButton.addEventListener("click", setToday);
  elements.weekButton.addEventListener("click", setWeekRange);
  elements.calculateButton.addEventListener("click", () => requestDashboardLoad());
  elements.connectGoogleButton.addEventListener("click", () => connectGoogle(true));
  elements.disconnectGoogleButton.addEventListener("click", disconnectGoogle);
  window.addEventListener("focus", handleTdBankWindowFocus);
  refreshAuthButtons();
  renderMetrics();
  renderTabs();
  void updateLiveCadRate();
  await initializeGoogleAuth();
  if (state.googleAuth.readyError) {
    setManualFinanceStatus(state.googleAuth.readyError, true);
  }
  refreshAuthButtons();
  renderTabs();
  await requestDashboardLoad();
}

async function fetchLiveCadUsdRate() {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const cadPerUsd = parseLooseNumber(payload?.rates?.CAD);
    return cadPerUsd > 0 ? 1 / cadPerUsd : null;
  } catch {
    return null;
  }
}

async function updateLiveCadRate() {
  const liveRate = await fetchLiveCadUsdRate();
  if (!liveRate || liveRate <= 0) return false;
  MANUAL_FINANCE_FALLBACK_USD_RATES.CAD = liveRate;
  renderMetrics();
  return true;
}

function normalizeEndpointUrl(value) {
  const raw = String(value || "").trim();
  return raw ? raw.replace(/\/+$/, "") : "";
}

function getDashboardEndpoint() {
  const endpoint = normalizeEndpointUrl(state.config?.endpoint || "/api");
  if (!endpoint) return "";
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  if (window.location.protocol === "file:") {
    return `${FILE_PROTOCOL_DASHBOARD_ORIGIN}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  }
  return endpoint;
}

function hasConfiguredDashboardEndpoint() {
  return Boolean(getDashboardEndpoint());
}

async function callDashboardApi(startDate, endDate) {
  const endpoint = getDashboardEndpoint();
  const url = new URL(endpoint, window.location.href);
  url.searchParams.set("action", "getDashboardData");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await readDashboardJsonResponse(response, "Dashboard endpoint");
  if (!response.ok || !payload?.ok || !payload?.data?.tabs) {
    throw new Error(payload?.error || `Dashboard endpoint failed (${response.status}).`);
  }
  return payload;
}

async function readDashboardJsonResponse(response, label = "Dashboard endpoint") {
  const contentType = String(response.headers?.get?.("content-type") || "");
  const text = await response.text();
  const bodyExcerpt = text.slice(0, 300);
  if (!contentType.toLowerCase().includes("application/json")) {
    throw buildDashboardResponseError(label, response, contentType, bodyExcerpt, "returned non-JSON response");
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw buildDashboardResponseError(label, response, contentType, bodyExcerpt, "returned invalid JSON");
  }
}

function buildDashboardResponseError(label, response, contentType, bodyExcerpt, reason) {
  const status = Number(response?.status) || 0;
  const safeContentType = contentType || "unknown content-type";
  const excerpt = bodyExcerpt ? ` Body: ${bodyExcerpt}` : "";
  const error = new Error(`${label} ${reason} (${status}, ${safeContentType}).${excerpt}`);
  error.status = status;
  error.contentType = safeContentType;
  error.bodyExcerpt = bodyExcerpt;
  return error;
}

function getConfiguredAppVersion() {
  return String(state.config?.appVersion || "").trim() || "unversioned";
}

async function loadConfig() {
  const response = await fetch("./sheet-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить sheet-config.json.");
  const config = await response.json();
  if (!config?.tabs) throw new Error("sheet-config.json имеет неверный формат.");
  return config;
}

async function getSnapshotPayload() {
  if (state.snapshotPayload) return state.snapshotPayload;
  const response = await fetch("./sheet-snapshot.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить sheet-snapshot.json.");
  const payload = await response.json();
  if (!payload?.data?.tabs) throw new Error("sheet-snapshot.json имеет неверный формат.");
  state.snapshotPayload = payload;
  return payload;
}

async function applyDefaultDatesFromSnapshot() {
  const payload = await getSnapshotPayload();
  const movementRows = payload?.data?.tabs?.movement?.values || [];
  const startIso = parseDisplayDateToIso(movementRows?.[0]?.[1]);
  const endIso = parseDisplayDateToIso(movementRows?.[0]?.[3]);
  const today = new Date().toISOString().slice(0, 10);
  elements.startDate.value = startIso || today;
  elements.endDate.value = endIso || today;
}

async function loadDashboardData() {
  const startDate = elements.startDate.value;
  const endDate = elements.endDate.value;
  if (!startDate || !endDate) {
    setStatus("Выберите обе даты.", true);
    return;
  }
  setLoading(true);
  setStatus("Загружаю данные...");
  try {
    state.data = await loadDashboardDataDirect(startDate, endDate);
    if (hasConfiguredManualFinanceEndpoint()) {
      const manualResults = await Promise.allSettled([
        syncManualFinanceForCurrentPeriod(),
        syncManualTransfersForCurrentRange(startDate, endDate),
        syncManualOrdersForCurrentRange(startDate, endDate)
      ]);
      manualResults.forEach((result, index) => {
        if (result.status !== "rejected") return;
        const message = result.reason?.message || "Manual workbook block failed.";
        console.warn("Manual workbook block failed.", result.reason);
        if (index === 0 && typeof setManualFinanceStatus === "function") {
          setManualFinanceStatus(message, true);
        } else if (index === 1 && typeof setManualTransfersStatus === "function") {
          setManualTransfersStatus(message, true);
        } else if (index === 2 && typeof setManualOrdersStatus === "function") {
          setManualOrdersStatus(message, true);
        }
      });
    } else {
      state.manualFinance.data = null;
      state.manualTransfers.data = null;
      state.manualOrders.data = null;
    }
    await applyClientSideDerivedData(startDate, endDate);
    renderMetrics();
    renderTabs();
    setStatus(buildLoadedStatus());
  } catch (error) {
    setStatus(error.message || "Не удалось загрузить данные.", true);
  } finally {
    setLoading(false);
  }
}

function requestDashboardLoad() {
  if (state.dashboardRequests.debounceTimer) {
    window.clearTimeout(state.dashboardRequests.debounceTimer);
  }
  return new Promise((resolve, reject) => {
    state.dashboardRequests.debounceTimer = window.setTimeout(() => {
      state.dashboardRequests.debounceTimer = null;
      loadDashboardDataDeduped().then(resolve, reject);
    }, 200);
  });
}

async function loadDashboardDataDeduped() {
  const startDate = elements.startDate.value;
  const endDate = elements.endDate.value;
  const key = `${startDate}|${endDate}`;
  if (state.dashboardRequests.inFlight.has(key)) {
    return await state.dashboardRequests.inFlight.get(key);
  }
  const promise = loadDashboardData();
  state.dashboardRequests.inFlight.set(key, promise);
  try {
    await promise;
    state.dashboardRequests.lastLoadedAt.set(key, Date.now());
  } finally {
    state.dashboardRequests.inFlight.delete(key);
  }
}

async function loadDashboardDataDirect(startDate, endDate) {
  const endpoint = getDashboardEndpoint();
  if (endpoint) {
    try {
      const payload = await loadDashboardDataViaEndpoint(startDate, endDate);
      return buildPreparedDashboardData(payload, startDate, endDate);
    } catch (error) {
      console.warn("Dashboard endpoint failed.", error);
      if (!state.googleAuth.accessToken || hasManualWorkbookServerAccess()) throw error;
    }
  }

  const tabConfigs = state.config.tabs.filter((tab) => tab.id !== "manualFinance");
  const entries = await Promise.all(tabConfigs.map(async (tab) => {
    const values = await getSheetValuesByTitle(tab.sheetName, state.config.spreadsheetId);
    return [tab.id, { sheetName: tab.sheetName || tab.id, values, sourceType: "google-sheets-direct" }];
  }));
  return buildPreparedDashboardData({ tabs: Object.fromEntries(entries) }, startDate, endDate);
}

async function loadDashboardDataViaEndpoint(startDate, endDate) {
  const endpoint = getDashboardEndpoint();
  if (!endpoint) {
    throw new Error("Dashboard endpoint is not configured.");
  }
  const url = new URL(endpoint, window.location.href);
  url.searchParams.set("action", "getDashboardData");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await readDashboardJsonResponse(response, "Dashboard endpoint");
  if (!response.ok || !payload?.ok || !payload?.data?.tabs) {
    throw new Error(payload?.error || `Dashboard endpoint failed (${response.status}).`);
  }
  return payload.data;
}

function buildPreparedDashboardData(data, startDate, endDate) {
  const tabs = {};
  for (const tab of state.config.tabs) {
    if (tab.id === "manualFinance") continue;
    const rawTable = data?.tabs?.[tab.id];
    if (!rawTable) continue;
    const prepared = prepareTabValues(tab.id, rawTable.values || [], startDate, endDate);
    tabs[tab.id] = {
      sheetName: rawTable.sheetName || tab.sheetName || tab.id,
      values: prepared.values,
      summaryRows: prepared.summaryRows || [],
      headerRowIndex: prepared.headerRowIndex ?? 0,
      spreadsheetUrl: rawTable.spreadsheetUrl || "",
      sourceType: rawTable.sourceType || data?.sourceType || ""
    };
  }
  return {
    period: data?.period || { startDate: formatDisplayDate(startDate), endDate: formatDisplayDate(endDate) },
    manual: data?.manual || null,
    realIncome: data?.realIncome || null,
    tabs,
    fetchedAt: data?.fetchedAt || new Date().toLocaleString("ru-RU"),
    ordersSummary: data?.ordersSummary || undefined
  };
}


// ============================================================
// HELPERS
// ============================================================

function getMovementSourceSpreadsheetUrl() {
  return String(
    state.data?.tabs?.movement?.spreadsheetUrl ||
    MOVEMENT_SOURCE_SPREADSHEET_FALLBACK_URL
  ).trim();
}


// ============================================================
// APP BOOTSTRAP AND DATA LOADING
// ============================================================

async function applyClientSideDerivedData(startDate, endDate) {
  if (!state.data?.tabs) return;
  applyManualOrdersToDashboard(startDate, endDate);
  let aggregatedManual = null;
  if (hasConfiguredManualFinanceEndpoint()) {
    try {
      aggregatedManual = await aggregateClosedManualPeriodDataDirect(startDate, endDate);
    } catch (error) {
      setManualFinanceStatus(error.message || "Не удалось собрать агрегированные входящие данные.", true);
    }
  }
  if (!aggregatedManual && state.manualFinance.data) {
    aggregatedManual = {
      rows: buildAnalyticsManualRowsFromFactMoneyRows(
        state.manualFinance.data.moneyRows || [],
        state.manualFinance.data.transferRows || []
      ),
      transferRows: buildAnalyticsTransfersFromFactRows(state.manualFinance.data.transferRows || []),
      selectedSheets: [state.manualFinance.data.sourceSheetName || MANUAL_INCOMING_TITLE]
    };
  }
  if (!aggregatedManual && state.data.manual) {
    aggregatedManual = buildAggregatedManualDataFromServerPayload(state.data.manual, startDate, endDate);
  }
  state.aggregatedManualRange = aggregatedManual || null;

  const payoutsValues = state.data.tabs.payouts?.values || [];
  if (state.data.tabs.payouts) {
    state.data.tabs.payouts = {
      ...state.data.tabs.payouts,
      closedFactTransferHeaders: MANUAL_TRANSFER_HEADERS.slice(),
      closedFactTransfers: aggregatedManual
        ? (aggregatedManual.transferRows || []).map((row) => [
            row.date || "",
            row.who || "",
            row.amount || "",
            row.localCurrency || "",
            row.destination || "",
            row.rate || "",
            row.usdAmount || ""
          ])
        : []
    };
  }

  const shouldRebuildAnalytics = Boolean(
    state.data.tabs.analytics && (
      aggregatedManual ||
      state.data.tabs.movement?.sourceType === "live-source-csv" ||
      state.data.tabs.payouts?.sourceType === "live-source-csv"
    )
  );
  if (shouldRebuildAnalytics) {
    state.data.tabs.analytics = {
      ...state.data.tabs.analytics,
      values: normalizePlanGrowthFormula(
        buildFullRangeBasedAnalyticsValuesFromClosedFact(
          state.data.tabs.analytics.values || [],
          state.data.tabs.movement?.values || [],
          payoutsValues,
          state.data.tabs.savings?.values || [],
          aggregatedManual || { rows: [], transferRows: [], selectedSheets: [] }
        )
      ),
      headerRowIndex: -1,
      sourceType: aggregatedManual ? "closed-range-aggregation" : "live-overlay-aggregation",
      selectedClosedSheets: aggregatedManual?.selectedSheets || []
    };
  }

  if (state.data.tabs.movement) {
    state.data.tabs.movement.summaryRows = buildMovementSummaryRows(
      state.data.tabs.movement.values || [],
      state.data.tabs.orders?.values || [],
      state.data.tabs.payouts?.values || [],
      state.data.tabs.movement.summaryRows || []
    );
  }
  state.data.ordersSummary = buildOrdersSummaryFromClient(state.data.tabs.orders?.values || []);
}


// ============================================================
// SHARED UTILITIES
// ============================================================

function clone2dArray(values) {
  return (values || []).map((row) => (row || []).slice());
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setToday() {
  const today = formatDateInputValue(new Date());
  elements.endDate.value = today;
}

function setWeekRange() {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  elements.startDate.value = formatDateInputValue(startDate);
  elements.endDate.value = formatDateInputValue(endDate);
}

function prepareTabValues(tabId, values, startDate, endDate) {
  switch (tabId) {
    case "movement":
      return { ...prepareMovementValues(values, startDate, endDate), headerRowIndex: 0 };
    case "orders":
      return { values: filterStructuredTable(values, startDate, endDate, 0), headerRowIndex: 0 };
    case "analytics":
      return { values: extractAnalyticsTopTables(values), headerRowIndex: -1 };
    case "savings":
      return { values, headerRowIndex: 0 };
    case "payouts":
      return { values: preparePayoutValues(values, startDate, endDate), headerRowIndex: 0 };
    default:
      return { values, headerRowIndex: 0 };
  }
}

function preparePayoutValues(values, startDate, endDate) {
  if (!Array.isArray(values) || !values.length) return values || [];
  const hasTitleRow = normalizeCell(values?.[0]?.[0]) === normalizeCell("Выплаты");
  const headerRowIndex = hasTitleRow ? 1 : 0;
  const header = values[headerRowIndex] || [];
  const dateColumn = findDateColumnIndex(header);
  if (dateColumn === -1) return values.slice(headerRowIndex);
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const filteredRows = values.slice(headerRowIndex + 1).filter((row) => {
    if (isTableTotalRow(row)) return false;
    const cellDate = parseDisplayDate(row[dateColumn]);
    return cellDate && cellDate >= start && cellDate <= end;
  });
  const totalRow = ANALYTICS_PAYOUTS_HELPER.buildPayoutTotalRow
    ? ANALYTICS_PAYOUTS_HELPER.buildPayoutTotalRow(header, filteredRows)
    : null;
  return totalRow ? [header, ...filteredRows, totalRow] : [header, ...filteredRows];
}

function filterStructuredTable(values, startDate, endDate, headerRowIndex) {
  if (!values.length || values.length <= headerRowIndex) return values;
  const header = values[headerRowIndex] || [];
  const dateColumn = findDateColumnIndex(header);
  if (dateColumn === -1) return values.slice(headerRowIndex);
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const filteredRows = values.slice(headerRowIndex + 1).filter((row) => {
    if (isTableTotalRow(row)) return false;
    const cellDate = parseDisplayDate(row[dateColumn]);
    return cellDate && cellDate >= start && cellDate <= end;
  });
  return [header, ...filteredRows];
}

function prepareMovementValues(values, startDate, endDate) {
  if (!values.length || values.length <= 2) return { values, summaryRows: [] };
  const header = values[2] || [];
  const reviewNoteIndex = header.findIndex((cell) => normalizeCell(cell) === "review note");
  const width = reviewNoteIndex === -1 ? header.length : reviewNoteIndex + 1;
  const normalizedHeader = padRowToWidth(header.slice(0, width), width);
  const dateColumn = findDateColumnIndex(normalizedHeader);
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const rows = [];
  const summaryRows = extractMovementSummaryRows(values);
  for (let index = 3; index < values.length; index += 1) {
    const row = values[index] || [];
    const firstCell = normalizeCell(row[0]);
    if (!hasAnyValue(row)) break;
    if (firstCell === "итого" || firstCell === "показатели" || firstCell === "number") break;
    const trimmed = padRowToWidth(row.slice(0, width), width);
    if (!/^\d+$/.test(String(trimmed[0] || "").trim())) continue;
    const cellDate = dateColumn === -1 ? null : parseDisplayDate(trimmed[dateColumn]);
    if (!cellDate || cellDate < start || cellDate > end) continue;
    rows.push(trimmed);
  }
  const totalRow = buildMovementTotalRow(normalizedHeader, rows);
  const percentRow = buildMovementPercentRow(normalizedHeader, totalRow);
  return { values: [normalizedHeader, ...rows, totalRow, percentRow], summaryRows };
}

function extractMovementSummaryRows(values) {
  const summaryRows = [];
  let started = false;
  for (let index = 3; index < values.length; index += 1) {
    const row = values[index] || [];
    const firstCell = normalizeCell(row[0]);
    if (!started) {
      if (firstCell === "показатели") started = true;
      continue;
    }
    if (!hasAnyValue(row)) {
      if (summaryRows.length) break;
      continue;
    }
    const label = String(row[0] || "").trim();
    const value = String(row[1] || "").trim();
    if (!label) continue;
    const nonEmptyCount = row.filter((cell) => String(cell || "").trim()).length;
    if (firstCell === normalizeCell(SUMMARY_LABELS.totalBalance) || firstCell === "number" || nonEmptyCount > 2) {
      summaryRows.push([label, value]);
      break;
    }
    summaryRows.push([label, value]);
  }
  return summaryRows;
}

function extractAnalyticsTopTables(values) {
  if (!values.length) return values;
  const repeatIndex = values.findIndex((row, index) => index >= 5 && normalizeCell(row?.[0]) === "личные расходы");
  return repeatIndex === -1 ? values : values.slice(0, repeatIndex);
}

function findDateColumnIndex(header) {
  return header.findIndex((cell) => {
    const normalized = String(cell || "").trim().toLowerCase();
    return normalized.includes("date") || normalized.includes("дата");
  });
}

function parseIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseDisplayDate(value, fallbackYear) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{5}$/.test(raw)) return excelSerialToDate(Number(raw));
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return parseIsoDate(raw);
  const isoTimestampMatch = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/);
  if (isoTimestampMatch) return parseIsoDate(isoTimestampMatch[1]);
  const fullDateMatch = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (fullDateMatch) return new Date(Number(fullDateMatch[3]), Number(fullDateMatch[2]) - 1, Number(fullDateMatch[1]));
  const shortDateMatch = raw.match(/^(\d{2})[./](\d{2})$/);
  const year = Number(fallbackYear);
  if (shortDateMatch && Number.isFinite(year)) {
    return new Date(year, Number(shortDateMatch[2]) - 1, Number(shortDateMatch[1]));
  }
  return null;
}

function parseDisplayDateToIso(value) {
  const date = parseDisplayDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate());
}

function formatDisplayDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  return `${day}.${month}.${year}`;
}

function normalizeCell(value) { return String(value || "").trim().toLowerCase(); }

function hasAnyValue(row) {
  if (Array.isArray(row)) return row.some((cell) => String(cell || "").trim());
  return Object.values(row || {}).some((cell) => String(cell || "").trim());
}

function padRowToWidth(row, width) {
  const output = row.slice(0, width);
  while (output.length < width) output.push("");
  return output;
}

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  if (isManualFinanceFormula(raw)) {
    const evaluated = evaluateManualFinanceFormula(raw, []);
    if (evaluated !== null) return evaluated;
  }
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatCellForDisplay(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (isManualFinanceFormula(raw)) {
    const evaluated = evaluateManualFinanceFormula(raw, []);
    if (evaluated !== null) return formatNumber(evaluated);
  }
  return raw;
}

function roundTo2(value) { return Math.round(Number(value || 0) * 100) / 100; }

function formatNumber(value) { return String(roundTo2(value || 0)).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1"); }

function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.className = "status" + (isError ? " error" : "");
}

function setLoading(isLoading) { state.loading = isLoading; }

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

init().catch((error) => setStatus(error.message || "Не удалось инициализировать dashboard.", true));
