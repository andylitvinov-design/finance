// ============================================================
// HELPERS
// ============================================================

function hasConfiguredManualFinanceEndpoint() {
  return Boolean(state.googleAuth.configured && state.googleAuth.accessToken);
}

function hasManualFinanceEndpointConfig() {
  return Boolean(state.googleAuth.configured && getManualFinanceSpreadsheetId());
}


// ============================================================
// READING SHEETS
// ============================================================

function getManualFinanceSpreadsheetId() {
  return String(state.config?.manualFinance?.spreadsheetId || "").trim();
}

function getManualOrdersConfig() {
  const manualOrders = state.config?.manualOrders || {};
  const manualFinance = state.config?.manualFinance || {};
  return {
    spreadsheetId: String(manualOrders.spreadsheetId || manualFinance.spreadsheetId || "").trim(),
    spreadsheetUrl: String(manualOrders.spreadsheetUrl || manualFinance.spreadsheetUrl || "").trim(),
    title: String(manualOrders.title || manualFinance.title || "EzoHata Manual Inputs").trim(),
    sheetName: String(manualOrders.sheetName || MANUAL_ORDERS_SHEET_NAME).trim() || MANUAL_ORDERS_SHEET_NAME
  };
}


// ============================================================
// HELPERS
// ============================================================

function hasConfiguredManualOrdersEndpoint() {
  return Boolean(state.googleAuth.configured && state.googleAuth.accessToken && getManualOrdersConfig().spreadsheetId);
}

async function googleSheetsFetch(path, options = {}) {
  if (!state.googleAuth.accessToken) {
    await connectGoogle(true);
  }
  const response = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.googleAuth.accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload?.error?.message || `Google Sheets API HTTP ${response.status}`;
    if (response.status === 401) {
      state.googleAuth.accessToken = "";
      refreshAuthButtons();
    }
    throw new Error(message);
  }
  return payload;
}


// ============================================================
// READING SHEETS
// ============================================================

async function getManualSpreadsheetMetadata() {
  return await getSpreadsheetMetadata(getManualFinanceSpreadsheetId());
}

async function getSpreadsheetMetadata(spreadsheetId) {
  if (!spreadsheetId) {
    throw new Error("Spreadsheet ID is not configured.");
  }
  return await googleSheetsFetch(`/spreadsheets/${spreadsheetId}?fields=spreadsheetId,sheets(properties(sheetId,title,index,hidden))`);
}

function parseManualPeriodSheetName(value) {
  const match = MANUAL_PERIOD_SHEET_RE.exec(String(value || "").trim());
  if (!match) return null;
  return { startDate: match[1], endDate: match[2], status: match[3] };
}

async function getSheetValuesByTitle(sheetTitle, spreadsheetId = getManualFinanceSpreadsheetId()) {
  const range = encodeURIComponent(`'${sheetTitle.replace(/'/g, "''")}'`);
  const payload = await googleSheetsFetch(`/spreadsheets/${spreadsheetId}/values/${range}`);
  return payload.values || [];
}

function normalizePeriod(startDate, endDate) {
  if (!MANUAL_DATE_RE.test(String(startDate || "")) || !MANUAL_DATE_RE.test(String(endDate || ""))) {
    throw new Error("startDate and endDate must be in YYYY-MM-DD format.");
  }
  if (startDate > endDate) throw new Error("startDate cannot be later than endDate.");
  return { startDate, endDate };
}


// ============================================================
// WRITING SHEETS
// ============================================================

function buildManualPeriodSheetName(startDate, endDate, status) {
  return `PERIOD__${startDate}__${endDate}__${status}`;
}

function buildManualPeriodLabel(startDate, endDate) {
  return startDate === endDate ? formatDisplayDate(endDate) : `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
}


// ============================================================
// SHEET MANAGEMENT
// ============================================================

async function ensureSheetExists(title, spreadsheetId = getManualFinanceSpreadsheetId()) {
  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  const existing = (metadata.sheets || []).find((sheet) => sheet?.properties?.title === title);
  if (existing) return existing.properties.sheetId;
  const payload = await googleSheetsFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title } } }]
    })
  });
  return payload.replies?.[0]?.addSheet?.properties?.sheetId || null;
}

async function deleteSheetIfExists(title, spreadsheetId = getManualFinanceSpreadsheetId()) {
  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  const existing = (metadata.sheets || []).find((sheet) => sheet?.properties?.title === title);
  if (!existing) return false;
  await googleSheetsFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }]
    })
  });
  return true;
}


// ============================================================
// WRITING SHEETS
// ============================================================

async function overwriteSheetValues(sheetTitle, values, spreadsheetId = getManualFinanceSpreadsheetId()) {
  const baseRange = encodeURIComponent(`'${sheetTitle.replace(/'/g, "''")}'!A:Z`);
  await googleSheetsFetch(`/spreadsheets/${spreadsheetId}/values/${baseRange}:clear`, {
    method: "POST",
    body: "{}"
  });
  const endColumn = columnLetter(Math.max(...values.map((row) => row.length), 8));
  const endRow = values.length;
  const updateRange = encodeURIComponent(`'${sheetTitle.replace(/'/g, "''")}'!A1:${endColumn}${endRow}`);
  await googleSheetsFetch(`/spreadsheets/${spreadsheetId}/values/${updateRange}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({
      range: `'${sheetTitle}'!A1:${endColumn}${endRow}`,
      majorDimension: "ROWS",
      values
    })
  });
}


// ============================================================
// READING SHEETS
// ============================================================

function getManualTransfersSheetName() {
  return String(state.config?.manualFinance?.transfersSheetName || MANUAL_FINANCE_TRANSFER_TITLE).trim() || MANUAL_FINANCE_TRANSFER_TITLE;
}

function getManualExpensesSheetName() {
  return String(state.config?.manualFinance?.expensesSheetName || MANUAL_FINANCE_EXPENSE_TITLE).trim() || MANUAL_FINANCE_EXPENSE_TITLE;
}

function getManualBalancesSheetName() {
  return String(state.config?.manualFinance?.balancesSheetName || MANUAL_FINANCE_BALANCE_TITLE).trim() || MANUAL_FINANCE_BALANCE_TITLE;
}

function getManualCommissionsSheetName() {
  return String(state.config?.manualFinance?.commissionsSheetName || MANUAL_FINANCE_COMMISSION_TITLE).trim() || MANUAL_FINANCE_COMMISSION_TITLE;
}

function assertIncomingTransferHeaders(values) {
  const rows = values || [];
  if (!rows.length || !rows[0]?.some((cell) => String(cell || "").trim())) return;
  const actual = MANUAL_TRANSFER_HEADERS.map((_, index) => String(rows[0]?.[index] || "").trim());
  const expected = MANUAL_TRANSFER_HEADERS.slice();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Transfer sheet header mismatch. Expected ${expected.join(" | ")}, got ${actual.join(" | ")}`);
  }
}

function assertIncomingExpenseHeaders(values) {
  const rows = values || [];
  if (!rows.length || !rows[0]?.some((cell) => String(cell || "").trim())) return;
  const expected = ["дата", "категория", ...getManualFinanceChannels()];
  const actual = expected.map((_, index) => {
    const cell = String(rows[0]?.[index] || "").trim();
    if (index < 2) return cell;
    return canonicalManualFinanceChannel(cell);
  });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expense sheet header mismatch. Expected ${expected.join(" | ")}, got ${actual.join(" | ")}`);
  }
}

function assertIncomingBalanceHeaders(values) {
  const rows = values || [];
  if (!rows.length || !rows[0]?.some((cell) => String(cell || "").trim())) return;
  const actual = MANUAL_BALANCE_HEADERS.map((_, index) => String(rows[0]?.[index] || "").trim());
  if (JSON.stringify(actual) !== JSON.stringify(MANUAL_BALANCE_HEADERS)) {
    throw new Error(`Balance sheet header mismatch. Expected ${MANUAL_BALANCE_HEADERS.join(" | ")}, got ${actual.join(" | ")}`);
  }
}

function assertIncomingCommissionHeaders(values) {
  const rows = values || [];
  if (!rows.length || !rows[0]?.some((cell) => String(cell || "").trim())) return;
  const actual = MANUAL_COMMISSION_HEADERS.map((_, index) => String(rows[0]?.[index] || "").trim());
  if (JSON.stringify(actual) !== JSON.stringify(MANUAL_COMMISSION_HEADERS)) {
    throw new Error(`Commission sheet header mismatch. Expected ${MANUAL_COMMISSION_HEADERS.join(" | ")}, got ${actual.join(" | ")}`);
  }
}

function parseIncomingTransferSheetValues(values) {
  const rows = values || [];
  assertIncomingTransferHeaders(rows);
  const transferRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    const transferDate = normalizeIncomingSheetDateValue(row[0]);
    const amount = row[2] || "";
    const currency = row[3] || "";
    const channel = row[4] || "";
    const rate = row[5] || "";
    const usdAmount = row[6] || "";
    const hasMeaningfulTransferData = Boolean(
      transferDate &&
      (
        String(amount || "").trim() ||
        String(currency || "").trim() ||
        String(channel || "").trim() ||
        String(rate || "").trim() ||
        String(usdAmount || "").trim()
      )
    );
    if (!hasMeaningfulTransferData) continue;
    transferRows.push({
      transferDate,
      who: row[1] || "",
      amount,
      currency,
      channel,
      rate,
      usdAmount
    });
  }
  return transferRows;
}

function parseIncomingExpenseSheetValues(values) {
  const rows = values || [];
  assertIncomingExpenseHeaders(rows);
  const expenseRows = [];
  const channels = (rows[0] || []).slice(2).map((cell) => canonicalManualFinanceChannel(String(cell || "").trim()));
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    const amounts = buildEmptyExpenseAmounts();
    channels.forEach((channel, channelIndex) => {
      if (!channel || !(channel in amounts)) return;
      amounts[channel] = normalizeManualFinancePersistedNumberInput(row[channelIndex + 2] || "");
    });
    const normalizedDate = normalizeIncomingSheetDateValue(row[0]);
    const category = normalizeManualExpenseCategory(row[1]);
    if (!normalizedDate || !category) continue;
    expenseRows.push({
      date: normalizedDate,
      category,
      amounts
    });
  }
  return expenseRows;
}

function parseIncomingBalanceSheetValues(values) {
  const rows = values || [];
  assertIncomingBalanceHeaders(rows);
  const balanceRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    const date = normalizeIncomingSheetDateValue(row[0]);
    const channel = String(row[1] || "").trim();
    const amount = normalizeManualFinancePersistedNumberInput(row[2] || "");
    const currency = String(row[3] || "").trim().toUpperCase();
    const rate = normalizeManualFinancePersistedNumberInput(row[4] || "");
    const usdAmount = normalizeManualFinancePersistedNumberInput(row[5] || "");
    const comment = String(row[6] || "").trim();
    if (!date || !channel) continue;
    if (!String(amount || "").trim() && !String(usdAmount || "").trim()) continue;
    balanceRows.push({
      date,
      channel,
      amount,
      currency: currency || inferManualFinanceChannelCurrency(channel),
      rate,
      usdAmount,
      comment
    });
  }
  return balanceRows;
}

function parseIncomingCommissionSheetValues(values) {
  const rows = values || [];
  assertIncomingCommissionHeaders(rows);
  const commissionRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    const date = normalizeIncomingSheetDateValue(row[0]);
    const channel = String(row[1] || "").trim();
    const usdAmount = normalizeManualFinancePersistedNumberInput(row[2] || "");
    const comment = String(row[3] || "").trim();
    if (!date || (!channel && !String(usdAmount || "").trim() && !comment)) continue;
    commissionRows.push({ date, channel, usdAmount, comment });
  }
  return commissionRows;
}

function normalizeIncomingSheetDateValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = parseDisplayDate(raw);
  return parsed ? parseDisplayDateToIso(raw) : "";
}


// ============================================================
// WRITING SHEETS
// ============================================================

function buildIncomingTransferSheetValues(rows) {
  return [
    MANUAL_TRANSFER_HEADERS.slice(),
    ...rows.map((row) => [
      row.transferDate || "",
      row.who || "",
      row.amount || "",
      row.currency || "",
      row.channel || "",
      row.rate || "",
      row.usdAmount || ""
    ])
  ];
}

function buildIncomingCommissionSheetValues(rows) {
  return [
    MANUAL_COMMISSION_HEADERS.slice(),
    ...rows.map((row) => [
      row.date || "",
      row.channel || "",
      row.usdAmount || "",
      row.comment || ""
    ])
  ];
}

function buildIncomingExpenseSheetValues(rows) {
  const channels = getManualFinanceChannels();
  return [
    ["дата", "категория", ...channels],
    ...rows.map((row) => [
      row.date || "",
      row.category || "",
      ...channels.map((channel) => row.amounts?.[channel] || "")
    ])
  ];
}

function buildIncomingBalanceSheetValues(rows) {
  return [
    MANUAL_BALANCE_HEADERS.slice(),
    ...(rows || []).map((row) => [
      row.date || "",
      row.channel || "",
      row.amount || "",
      row.currency || "",
      row.rate || "",
      row.usdAmount || "",
      row.comment || ""
    ])
  ];
}

function replaceManualRowsForDateRange(existingRows, replacementRows, startDate, endDate, dateKey) {
  const preserved = (existingRows || []).filter((row) => {
    const rowDate = normalizeIncomingSheetDateValue(row?.[dateKey] || "");
    return !rowDate || rowDate < startDate || rowDate > endDate;
  });
  const merged = [...preserved, ...(replacementRows || [])];
  return merged.sort((a, b) => {
    const left = normalizeIncomingSheetDateValue(a?.[dateKey] || "");
    const right = normalizeIncomingSheetDateValue(b?.[dateKey] || "");
    if (left !== right) return left.localeCompare(right);
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  });
}

function mergeManualBalanceRows(existingRows = [], replacementRows = []) {
  const replacementKeys = new Set(
    (replacementRows || []).map((row) => `${normalizeIncomingSheetDateValue(row?.date || "")}|${String(row?.channel || "").trim()}`)
  );
  const preserved = (existingRows || []).filter((row) => {
    const key = `${normalizeIncomingSheetDateValue(row?.date || "")}|${String(row?.channel || "").trim()}`;
    return !replacementKeys.has(key);
  });
  return [...preserved, ...(replacementRows || [])].sort((a, b) => {
    const leftDate = normalizeIncomingSheetDateValue(a?.date || "");
    const rightDate = normalizeIncomingSheetDateValue(b?.date || "");
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(a?.channel || "").localeCompare(String(b?.channel || ""));
  });
}

function mergeLatestNowEntries(primary = {}, fallback = {}) {
  return { ...(fallback || {}), ...(primary || {}) };
}


// ============================================================
// READING SHEETS
// ============================================================

async function listManualSheetDatesDirect() {
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const transferValues = titles.has(getManualTransfersSheetName())
    ? await getSheetValuesByTitle(getManualTransfersSheetName())
    : [];
  const expenseValues = titles.has(getManualExpensesSheetName())
    ? await getSheetValuesByTitle(getManualExpensesSheetName())
    : [];
  const balanceValues = titles.has(getManualBalancesSheetName())
    ? await getSheetValuesByTitle(getManualBalancesSheetName())
    : [];
  const commissionValues = titles.has(getManualCommissionsSheetName())
    ? await getSheetValuesByTitle(getManualCommissionsSheetName())
    : [];
  const dates = new Set();
  parseIncomingTransferSheetValues(transferValues).forEach((row) => row.transferDate && dates.add(row.transferDate));
  parseIncomingExpenseSheetValues(expenseValues).forEach((row) => row.date && dates.add(row.date));
  parseIncomingBalanceSheetValues(balanceValues).forEach((row) => row.date && dates.add(row.date));
  parseIncomingCommissionSheetValues(commissionValues).forEach((row) => row.date && dates.add(row.date));
  return {
    dates: [...dates].sort().reverse(),
    spreadsheetUrl: state.config?.manualFinance?.spreadsheetUrl || "",
    title: state.config?.manualFinance?.title || "EzoHata Manual Inputs",
    writeEnabled: true
  };
}

async function getManualSheetDirect(startDate, endDate) {
  const period = normalizePeriod(startDate, endDate);
  const snapshotDate = period.endDate;
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const [transferValues, expenseValues, balanceValues, commissionValues] = await Promise.all([
    titles.has(getManualTransfersSheetName())
      ? getSheetValuesByTitle(getManualTransfersSheetName())
      : Promise.resolve(buildIncomingTransferSheetValues([])),
    titles.has(getManualExpensesSheetName())
      ? getSheetValuesByTitle(getManualExpensesSheetName())
      : Promise.resolve(buildIncomingExpenseSheetValues([])),
    titles.has(getManualBalancesSheetName())
      ? getSheetValuesByTitle(getManualBalancesSheetName())
      : Promise.resolve(buildIncomingBalanceSheetValues([])),
    titles.has(getManualCommissionsSheetName())
      ? getSheetValuesByTitle(getManualCommissionsSheetName())
      : Promise.resolve(buildIncomingCommissionSheetValues([]))
  ]);
  const transferRows = parseIncomingTransferSheetValues(transferValues).filter((row) => {
    return row.transferDate && row.transferDate === snapshotDate;
  });
  const parsedExpenseRows = parseIncomingExpenseSheetValues(expenseValues);
  const expenseRows = parsedExpenseRows.filter((row) => {
    return row.date && row.date === snapshotDate;
  });
  const flowExpenseRows = filterManualFlowExpenseRows(expenseRows);
  const latestNowEntriesByChannel = mergeLatestNowEntries(
    buildLatestBalanceEntriesByChannel(parseIncomingBalanceSheetValues(balanceValues), snapshotDate),
    buildLatestNowEntriesByChannel(parsedExpenseRows, snapshotDate)
  );
  return {
    sheetName: MANUAL_INCOMING_TITLE,
    displayName: `${MANUAL_INCOMING_TITLE}: ${snapshotDate}`,
    sourceSheetName: `${getManualTransfersSheetName()} + ${getManualExpensesSheetName()} + ${getManualBalancesSheetName()}`,
    created: false,
    virtual: false,
    sourceType: "incoming-repository",
    periodStart: snapshotDate,
    periodEnd: snapshotDate,
    status: "saved",
    moneyTitle: MANUAL_FINANCE_MONEY_TITLE,
    moneyHeaders: MANUAL_FINANCE_HEADERS,
    moneyRows: buildLegacyFactMoneyRowsFromExpenseRows(
      flowExpenseRows.length || Object.keys(latestNowEntriesByChannel).length
        ? normalizeManualFinanceExpenseRows(flowExpenseRows, snapshotDate, snapshotDate)
            .concat(Object.entries(latestNowEntriesByChannel).map(([channel, entry]) => ({
              date: entry.date || snapshotDate,
              category: MANUAL_NOW_CATEGORY,
              amounts: Object.fromEntries(getManualFinanceChannels().map((item) => [item, item === channel ? entry.value : ""]))
            })))
        : []
    ),
    transferTitle: getManualTransfersSheetName(),
    transferHeaders: MANUAL_TRANSFER_HEADERS,
    transferRows,
    emptyFact: !expenseRows.length && !Object.keys(latestNowEntriesByChannel).length,
    expenseTitle: getManualExpensesSheetName(),
    expenseHeaders: buildManualExpenseHeaders(),
    expenseRows,
    writeEnabled: true,
    spreadsheetUrl: state.config?.manualFinance?.spreadsheetUrl || ""
  };
}

async function getManualTransfersSheetDirect(startDate, endDate) {
  const period = normalizePeriod(startDate, endDate);
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const transferValues = titles.has(getManualTransfersSheetName())
    ? await getSheetValuesByTitle(getManualTransfersSheetName())
    : buildIncomingTransferSheetValues([]);
  const commissionValues = titles.has(getManualCommissionsSheetName())
    ? await getSheetValuesByTitle(getManualCommissionsSheetName())
    : buildIncomingCommissionSheetValues([]);
  const transferRows = parseIncomingTransferSheetValues(transferValues)
    .filter((row) => row.transferDate && row.transferDate >= period.startDate && row.transferDate <= period.endDate);
  const commissionRows = parseIncomingCommissionSheetValues(commissionValues)
    .filter((row) => row.date && row.date >= period.startDate && row.date <= period.endDate);
  return {
    sheetName: getManualTransfersSheetName(),
    sourceSheetName: `${getManualTransfersSheetName()} + ${getManualCommissionsSheetName()}`,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    status: "saved",
    transferTitle: getManualTransfersSheetName(),
    transferHeaders: MANUAL_TRANSFER_HEADERS,
    transferRows: normalizeManualFinanceTransferRows(transferRows),
    commissionTitle: getManualCommissionsSheetName(),
    commissionHeaders: MANUAL_COMMISSION_HEADERS,
    commissionRows: normalizeManualCommissionRows(commissionRows),
    writeEnabled: true,
    spreadsheetUrl: state.config?.manualFinance?.spreadsheetUrl || ""
  };
}


// ============================================================
// WRITING SHEETS
// ============================================================

async function saveManualTransfersSheetDirect(startDate, endDate, rawTransferRows, rawCommissionRows = []) {
  const period = normalizePeriod(startDate, endDate);
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const existingTransfers = titles.has(getManualTransfersSheetName())
    ? parseIncomingTransferSheetValues(await getSheetValuesByTitle(getManualTransfersSheetName()))
    : [];
  const existingCommissions = titles.has(getManualCommissionsSheetName())
    ? parseIncomingCommissionSheetValues(await getSheetValuesByTitle(getManualCommissionsSheetName()))
    : [];
  const transferRows = normalizeManualFinanceTransferRows(rawTransferRows, { padToMinimum: false })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()))
    .map((row) => ({
      transferDate: normalizeIncomingSheetDateValue(row.transferDate) || period.endDate,
      who: String(row.who || "").trim(),
      amount: normalizeManualFinancePersistedNumberInput(row.amount),
      currency: String(row.currency || "").trim(),
      channel: String(row.channel || "").trim(),
      rate: normalizeManualFinancePersistedNumberInput(row.rate),
      usdAmount: normalizeManualFinancePersistedNumberInput(row.usdAmount)
    }));
  const commissionRows = normalizeManualCommissionRows(rawCommissionRows, { padToMinimum: false })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()))
    .map((row) => ({
      date: normalizeIncomingSheetDateValue(row.date) || period.endDate,
      channel: String(row.channel || "").trim(),
      usdAmount: normalizeManualFinancePersistedNumberInput(row.usdAmount),
      comment: String(row.comment || "").trim()
    }));
  const mergedTransfers = replaceManualRowsForDateRange(
    existingTransfers,
    transferRows,
    period.startDate,
    period.endDate,
    "transferDate"
  );
  const mergedCommissions = replaceManualRowsForDateRange(
    existingCommissions,
    commissionRows,
    period.startDate,
    period.endDate,
    "date"
  );
  await ensureSheetExists(getManualTransfersSheetName(), getManualFinanceSpreadsheetId());
  await ensureSheetExists(getManualCommissionsSheetName(), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualTransfersSheetName(), buildIncomingTransferSheetValues(mergedTransfers), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualCommissionsSheetName(), buildIncomingCommissionSheetValues(mergedCommissions), getManualFinanceSpreadsheetId());
  return {
    periodStart: period.startDate,
    periodEnd: period.endDate,
    sourceSheetName: `${getManualTransfersSheetName()} + ${getManualCommissionsSheetName()}`,
    savedAt: new Date().toLocaleString("ru-RU"),
    writeEnabled: true
  };
}

async function saveManualSheetDirect(params) {
  const period = normalizePeriod(params.startDate, params.endDate);
  const snapshotDate = period.endDate;
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const existingTransfers = titles.has(getManualTransfersSheetName())
    ? parseIncomingTransferSheetValues(await getSheetValuesByTitle(getManualTransfersSheetName()))
    : [];
  const existingExpenses = titles.has(getManualExpensesSheetName())
    ? parseIncomingExpenseSheetValues(await getSheetValuesByTitle(getManualExpensesSheetName()))
    : [];
  const existingBalances = titles.has(getManualBalancesSheetName())
    ? parseIncomingBalanceSheetValues(await getSheetValuesByTitle(getManualBalancesSheetName()))
    : [];
  const transferRows = normalizeManualFinanceTransferRows(params.transferRows, { padToMinimum: false })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()))
    .map((row) => ({
      transferDate: snapshotDate,
      who: String(row.who || "").trim(),
      amount: normalizeManualFinancePersistedNumberInput(row.amount),
      currency: String(row.currency || "").trim(),
      channel: String(row.channel || "").trim(),
      rate: normalizeManualFinancePersistedNumberInput(row.rate),
      usdAmount: normalizeManualFinancePersistedNumberInput(row.usdAmount)
    }));
  const isLegacyFactSnapshotSave = Array.isArray(params.moneyRows) && params.moneyRows.length;
  const movementValues = state.data?.tabs?.movement?.values || [];
  const rawExpenseRows = isLegacyFactSnapshotSave
    ? convertLegacyFactMoneyRowsToExpenseRows(params.moneyRows, snapshotDate)
    : normalizeManualFinanceExpenseRows(params.expenseRows, snapshotDate, snapshotDate);
  const balanceRows = isLegacyFactSnapshotSave
    ? buildManualBalanceRowsFromMoneyRows(params.moneyRows, snapshotDate, transferRows, movementValues)
    : buildManualBalanceRowsFromNowExpenseRows(rawExpenseRows, snapshotDate, transferRows, movementValues);
  const expenseRows = filterManualFlowExpenseRows(rawExpenseRows)
    .map((row) => ({
      date: snapshotDate,
      category: row.category,
      amounts: Object.fromEntries(
        getManualFinanceChannels().map((channel) => [channel, normalizeManualFinancePersistedNumberInput(row.amounts?.[channel])])
      )
    }));
  const expenseReplaceStart = snapshotDate;
  const expenseReplaceEnd = snapshotDate;
  const mergedTransfers = replaceManualRowsForDateRange(existingTransfers, transferRows, snapshotDate, snapshotDate, "transferDate");
  const mergedExpenses = replaceManualRowsForDateRange(existingExpenses, expenseRows, expenseReplaceStart, expenseReplaceEnd, "date");
  const mergedBalances = mergeManualBalanceRows(existingBalances, balanceRows);
  await ensureSheetExists(getManualTransfersSheetName(), getManualFinanceSpreadsheetId());
  await ensureSheetExists(getManualExpensesSheetName(), getManualFinanceSpreadsheetId());
  await ensureSheetExists(getManualBalancesSheetName(), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualTransfersSheetName(), buildIncomingTransferSheetValues(mergedTransfers), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualExpensesSheetName(), buildIncomingExpenseSheetValues(mergedExpenses), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualBalancesSheetName(), buildIncomingBalanceSheetValues(mergedBalances), getManualFinanceSpreadsheetId());
  return {
    periodStart: snapshotDate,
    periodEnd: snapshotDate,
    status: "saved",
    sourceSheetName: `${getManualTransfersSheetName()} + ${getManualExpensesSheetName()} + ${getManualBalancesSheetName()}`,
    savedAt: new Date().toLocaleString("ru-RU"),
    writeEnabled: true
  };
}


// ============================================================
// READING SHEETS
// ============================================================

async function getManualOrdersSheetDirect() {
  const config = getManualOrdersConfig();
  const metadata = await getSpreadsheetMetadata(config.spreadsheetId);
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const sourceSheetName = titles.has(config.sheetName)
    ? config.sheetName
    : (titles.has(MANUAL_ORDERS_LEGACY_SHEET_NAME) ? MANUAL_ORDERS_LEGACY_SHEET_NAME : "");
  const values = sourceSheetName
    ? await getSheetValuesByTitle(sourceSheetName, config.spreadsheetId)
    : buildManualOrdersValuesFromState(MANUAL_ORDERS_HEADERS, buildDefaultManualOrdersRows());
  const parsed = parseManualOrdersValues(values);
  return {
    sheetName: config.sheetName,
    sourceSheetName,
    sourceType: sourceSheetName ? "sheet" : "template",
    virtual: !sourceSheetName,
    writeEnabled: true,
    headers: parsed.headers,
    rows: parsed.rows,
    spreadsheetUrl: config.spreadsheetUrl
  };
}


// ============================================================
// WRITING SHEETS
// ============================================================

async function saveManualOrdersSheetDirect(params) {
  const config = getManualOrdersConfig();
  const headers = normalizeManualOrdersHeaders(params.headers);
  const rows = normalizeManualOrdersRows(params.rows);
  const values = buildManualOrdersValuesFromState(headers, rows);
  await ensureSheetExists(config.sheetName, config.spreadsheetId);
  await overwriteSheetValues(config.sheetName, values, config.spreadsheetId);
  return {
    sheetName: config.sheetName,
    savedAt: new Date().toLocaleString("ru-RU"),
    writeEnabled: true
  };
}


// ============================================================
// HELPERS
// ============================================================

async function selectClosedManualPeriodSheetsDirect(startDate, endDate) {
  return [
    { sheetName: getManualExpensesSheetName(), startDate, endDate, status: "saved" },
    { sheetName: getManualBalancesSheetName(), startDate, endDate, status: "saved" }
  ];
}


// ============================================================
// READING SHEETS
// ============================================================

async function loadManualSheetByTitleDirect(sheetTitle) {
  if (sheetTitle === getManualTransfersSheetName()) {
    return { transferRows: parseIncomingTransferSheetValues(await getSheetValuesByTitle(sheetTitle, getManualFinanceSpreadsheetId())) };
  }
  if (sheetTitle === getManualExpensesSheetName()) {
    return { expenseRows: parseIncomingExpenseSheetValues(await getSheetValuesByTitle(sheetTitle, getManualFinanceSpreadsheetId())) };
  }
  if (sheetTitle === getManualBalancesSheetName()) {
    return { balanceRows: parseIncomingBalanceSheetValues(await getSheetValuesByTitle(sheetTitle, getManualFinanceSpreadsheetId())) };
  }
  if (sheetTitle === getManualCommissionsSheetName()) {
    return { commissionRows: parseIncomingCommissionSheetValues(await getSheetValuesByTitle(sheetTitle, getManualFinanceSpreadsheetId())) };
  }
  return { transferRows: [], expenseRows: [] };
}
