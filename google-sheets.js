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

function getSpreadsheetSheetProperties(metadata, title) {
  return (metadata?.sheets || []).find((sheet) => sheet?.properties?.title === title)?.properties || null;
}

async function ensureManualLedgerSourceColumn() {
  const spreadsheetId = getManualFinanceSpreadsheetId();
  const sheetTitle = getManualLedgerSheetName();
  const metadata = await getManualSpreadsheetMetadata();
  const sheetProperties = getSpreadsheetSheetProperties(metadata, sheetTitle);
  if (!sheetProperties?.sheetId) {
    return { insertedSourceColumn: false, backfilledRows: 0, missingSheet: true };
  }
  const sourceIndex = MANUAL_LEDGER_HEADERS.indexOf("source");
  const rawSourceIndex = MANUAL_LEDGER_HEADERS.indexOf("raw_source_id");
  const sourceColumnLetter = columnLetter(sourceIndex + 1);
  const initialValues = await getSheetValuesByTitle(sheetTitle, spreadsheetId);
  const initialHeader = (initialValues[0] || []).map((cell) => String(cell || "").trim());
  if (!initialHeader.some(Boolean)) {
    return { insertedSourceColumn: false, backfilledRows: 0, missingHeader: true };
  }
  const hasSourceColumn = initialHeader[sourceIndex] === "source";
  if (!hasSourceColumn) {
    const hasLegacyHeader = initialHeader[sourceIndex] === "raw_source_id" && !initialHeader.includes("source");
    if (!hasLegacyHeader) {
      throw new Error(`Ledger sheet header mismatch. Expected source at column ${sourceIndex + 1}.`);
    }
    await googleSheetsFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            insertDimension: {
              range: {
                sheetId: sheetProperties.sheetId,
                dimension: "COLUMNS",
                startIndex: sourceIndex,
                endIndex: sourceIndex + 1
              },
              inheritFromBefore: true
            }
          }
        ]
      })
    });
    await batchUpdateSheetValues([
      {
        range: `'${sheetTitle.replace(/'/g, "''")}'!${sourceColumnLetter}1`,
        values: [["source"]]
      }
    ], spreadsheetId);
  }

  const ledgerValues = hasSourceColumn ? initialValues : await getSheetValuesByTitle(sheetTitle, spreadsheetId);
  const header = (ledgerValues[0] || []).map((cell) => String(cell || "").trim());
  if (header[sourceIndex] !== "source") {
    throw new Error("Ledger source column migration did not complete successfully.");
  }
  const updates = [];
  for (let rowIndex = 1; rowIndex < ledgerValues.length; rowIndex += 1) {
    const row = ledgerValues[rowIndex] || [];
    const sourceValue = String(row[sourceIndex] || "").trim();
    const rawSourceId = String(row[rawSourceIndex] || "").trim();
    if (sourceValue || !/^migration:/i.test(rawSourceId)) continue;
    updates.push({
      range: `'${sheetTitle.replace(/'/g, "''")}'!${sourceColumnLetter}${rowIndex + 1}`,
      values: [["manual"]]
    });
  }
  await batchUpdateSheetValues(updates, spreadsheetId);
  return {
    insertedSourceColumn: !hasSourceColumn,
    backfilledRows: updates.length
  };
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

async function batchUpdateSheetValues(data, spreadsheetId = getManualFinanceSpreadsheetId()) {
  const updates = (data || []).filter((item) => item?.range && Array.isArray(item.values));
  if (!updates.length) return;
  await googleSheetsFetch(`/spreadsheets/${spreadsheetId}/values:batchUpdate?valueInputOption=USER_ENTERED`, {
    method: "POST",
    body: JSON.stringify({
      data: updates.map((item) => ({
        range: item.range,
        majorDimension: "ROWS",
        values: item.values
      })),
      valueInputOption: "USER_ENTERED"
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

function getManualLedgerSheetName() {
  return String(state.config?.manualFinance?.ledgerSheetName || MANUAL_FINANCE_LEDGER_TITLE).trim() || MANUAL_FINANCE_LEDGER_TITLE;
}

function normalizeManualLedgerSource(value, fallback = "") {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback;
  if (["manual", "mcp", "photo"].includes(token)) return token;
  if (["fact", "manual fact"].includes(token)) return "manual";
  if (["paypal", "wise", "yoomoney", "monobank", "privatbank", "tdbank", "provider", "paypal-mcp"].includes(token)) return "mcp";
  if (["ocr", "browser ocr", "screenshot", "image"].includes(token)) return "photo";
  return fallback;
}

function resolveManualLedgerSource(value, rawSourceId = "", fallback = "") {
  const normalized = normalizeManualLedgerSource(value, "");
  if (normalized) return normalized;
  if (/^migration:/i.test(String(rawSourceId || "").trim())) return "manual";
  return fallback;
}

function getManualLedgerDisplaySource(value, rawSourceId = "") {
  return resolveManualLedgerSource(value, rawSourceId, "") || "unknown";
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

function assertManualLedgerHeaders(values) {
  const rows = values || [];
  if (!rows.length || !rows[0]?.some((cell) => String(cell || "").trim())) return;
  const actual = (rows[0] || []).map((cell) => String(cell || "").trim());
  const legacyExpected = MANUAL_LEDGER_HEADERS.filter((name) => name !== "source");
  const nextExpected = MANUAL_LEDGER_HEADERS.slice();
  const actualNext = nextExpected.map((_, index) => actual[index] || "");
  const actualLegacy = legacyExpected.map((_, index) => actual[index] || "");
  const matchesNext = JSON.stringify(actualNext) === JSON.stringify(nextExpected);
  const matchesLegacy = JSON.stringify(actualLegacy) === JSON.stringify(legacyExpected);
  if (!matchesNext && !matchesLegacy) {
    throw new Error(`Ledger sheet header mismatch. Expected ${nextExpected.join(" | ")} or legacy ${legacyExpected.join(" | ")}, got ${actual.join(" | ")}`);
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

function parseManualLedgerSheetValues(values) {
  const rows = values || [];
  assertManualLedgerHeaders(rows);
  const header = rows[0] || MANUAL_LEDGER_HEADERS;
  const indexByName = Object.fromEntries(MANUAL_LEDGER_HEADERS.map((name) => [name, findHeaderIndexByAliases(header, [name])]));
  const warnings = [];
  const seenRawSourceIds = new Set();
  const ledgerRows = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    const read = (key) => row[indexByName[key]] ?? "";
    const date = normalizeIncomingSheetDateValue(read("date"));
    if (!date) {
      warnings.push(`Ledger row ${rowIndex + 1}: skipped empty date.`);
      continue;
    }
    const amount = normalizeManualFinancePersistedNumberInput(read("amount"));
    if (!String(amount || "").trim() || !Number.isFinite(parseLooseNumber(amount))) {
      warnings.push(`Ledger row ${rowIndex + 1}: skipped invalid amount.`);
      continue;
    }
    const rawCategory = String(read("category") || "").trim();
    const category = normalizeManualLedgerCategoryForStorage(rawCategory, "extra");
    const warningParts = [];
    if (rawCategory && category === "extra" && normalizeCell(rawCategory) !== "extra") {
      warningParts.push(`unknown category: ${rawCategory}`);
    }
    const rawFrom = String(read("from_channel") || "").trim();
    const rawTo = String(read("to_channel") || "").trim();
    const fromChannel = canonicalManualFinanceChannel(rawFrom);
    const toChannel = canonicalManualFinanceChannel(rawTo);
    if (rawFrom && fromChannel === rawFrom && !getManualFinanceChannels().includes(fromChannel)) warningParts.push(`unknown from_channel: ${rawFrom}`);
    if (rawTo && toChannel === rawTo && !getManualFinanceChannels().includes(toChannel)) warningParts.push(`unknown to_channel: ${rawTo}`);
    const rawSourceId = String(read("raw_source_id") || "").trim();
    if (rawSourceId) {
      if (seenRawSourceIds.has(rawSourceId)) {
        warnings.push(`Ledger row ${rowIndex + 1}: skipped duplicate raw_source_id ${rawSourceId}.`);
        continue;
      }
      seenRawSourceIds.add(rawSourceId);
    }
    if (warningParts.length) warnings.push(`Ledger row ${rowIndex + 1}: ${warningParts.join("; ")}.`);
    const operation = normalizeManualLedgerOperation(read("operation"), category);
    ledgerRows.push({
      date,
      operation,
      fromChannel,
      toChannel,
      amount,
      currency: String(read("currency") || inferManualFinanceChannelCurrency(fromChannel || toChannel)).trim().toUpperCase(),
      amountUsd: normalizeManualFinancePersistedNumberInput(read("amount_usd")),
      category,
      subcategory: String(read("subcategory") || "").trim(),
      direction: normalizeManualLedgerDirection(read("direction"), operation),
      comment: [String(read("comment") || "").trim(), ...warningParts].filter(Boolean).join(" | "),
      source: resolveManualLedgerSource(indexByName.source === -1 ? "" : read("source"), rawSourceId, ""),
      displaySource: getManualLedgerDisplaySource(indexByName.source === -1 ? "" : read("source"), rawSourceId),
      rawSourceId,
      transferGroupId: String(read("transfer_group_id") || "").trim(),
      createdAt: String(read("created_at") || "").trim(),
      updatedAt: String(read("updated_at") || "").trim(),
      sheetRowNumber: rowIndex + 1
    });
  }
  return { rows: ledgerRows, warnings };
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

function buildManualLedgerSheetValues(rows) {
  return [
    MANUAL_LEDGER_HEADERS.slice(),
    ...(rows || []).map((row) => [
      row.date || "",
      row.operation || "",
      row.fromChannel || row.from_channel || "",
      row.toChannel || row.to_channel || "",
      row.amount || "",
      row.currency || "",
      row.amountUsd || row.amount_usd || "",
      row.category || "",
      row.subcategory || "",
      row.direction || "",
      row.comment || "",
      normalizeManualLedgerSource(row.source, ""),
      row.rawSourceId || row.raw_source_id || "",
      row.transferGroupId || row.transfer_group_id || "",
      row.createdAt || row.created_at || "",
      row.updatedAt || row.updated_at || ""
    ])
  ];
}

function normalizeManualLedgerRowsForSave(rows, existingRows = []) {
  const warnings = [];
  const seen = new Set((existingRows || []).map((row) => String(row.rawSourceId || "").trim()).filter(Boolean));
  const timestamp = new Date().toISOString();
  const output = [];
  (rows || []).forEach((row, index) => {
    const date = normalizeIncomingSheetDateValue(row?.date);
    if (!date) {
      warnings.push(`Ledger save row ${index + 1}: skipped empty date.`);
      return;
    }
    const amount = normalizeManualFinancePersistedNumberInput(row?.amount);
    const amountNumber = parseLooseNumber(amount);
    if (!String(amount || "").trim() || !Number.isFinite(amountNumber)) {
      warnings.push(`Ledger save row ${index + 1}: skipped invalid amount.`);
      return;
    }
    const category = normalizeManualLedgerCategoryForStorage(row?.category, "extra");
    const fromChannel = canonicalManualFinanceChannel(row?.fromChannel || row?.from_channel || "");
    const toChannel = canonicalManualFinanceChannel(row?.toChannel || row?.to_channel || "");
    const rawSourceId = String(row?.rawSourceId || row?.raw_source_id || "").trim();
    if (rawSourceId && seen.has(rawSourceId)) {
      warnings.push(`Ledger save row ${index + 1}: skipped duplicate raw_source_id ${rawSourceId}.`);
      return;
    }
    if (rawSourceId) seen.add(rawSourceId);
    const operation = normalizeManualLedgerOperation(row?.operation, category);
    const amountUsd = normalizeManualFinancePersistedNumberInput(row?.amountUsd ?? row?.amount_usd ?? "");
    output.push({
      date,
      operation,
      fromChannel,
      toChannel,
      amount,
      currency: String(row?.currency || inferManualFinanceChannelCurrency(fromChannel || toChannel)).trim().toUpperCase(),
      amountUsd,
      category,
      subcategory: String(row?.subcategory || "").trim(),
      direction: normalizeManualLedgerDirection(row?.direction, operation),
      comment: String(row?.comment || "").trim(),
      source: normalizeManualLedgerSource(row?.source, ""),
      rawSourceId,
      transferGroupId: String(row?.transferGroupId || row?.transfer_group_id || "").trim(),
      createdAt: String(row?.createdAt || row?.created_at || "").trim() || timestamp,
      updatedAt: timestamp
    });
  });
  return { rows: output, warnings };
}

function trimTrailingEmptySheetRows(values) {
  const next = (values || []).map((row) => Array.isArray(row) ? row.slice() : []);
  while (next.length > 1 && !next[next.length - 1].some((cell) => String(cell || "").trim())) {
    next.pop();
  }
  return next;
}

function buildUpdatedManualLedgerSheetValues(values, rowPatch) {
  const rows = (values || []).map((row) => Array.isArray(row) ? row.slice() : []);
  assertManualLedgerHeaders(rows);
  const sheetRowNumber = Number(rowPatch?.sheetRowNumber || 0);
  if (!Number.isInteger(sheetRowNumber) || sheetRowNumber < 2 || sheetRowNumber > rows.length) {
    throw new Error("Ledger row was not found. Reload the Operations list and try again.");
  }
  if (!rows[sheetRowNumber - 1]?.some((cell) => String(cell || "").trim())) {
    throw new Error("Ledger row was not found. Reload the Operations list and try again.");
  }
  const ledgerParse = parseManualLedgerSheetValues(rows);
  const targetRow = ledgerParse.rows.find((row) => row.sheetRowNumber === sheetRowNumber);
  if (!targetRow) {
    throw new Error("Ledger row was not found. Reload the Operations list and try again.");
  }
  const normalized = normalizeManualLedgerRowsForSave(
    [{ ...targetRow, ...rowPatch }],
    ledgerParse.rows.filter((row) => row.sheetRowNumber !== sheetRowNumber)
  );
  if (!normalized.rows.length) {
    throw new Error(normalized.warnings[0] || "Ledger row update failed.");
  }
  rows[sheetRowNumber - 1] = buildManualLedgerSheetValues(normalized.rows).slice(1)[0];
  return trimTrailingEmptySheetRows(rows);
}

function buildDeletedManualLedgerSheetValues(values, sheetRowNumber) {
  const rows = (values || []).map((row) => Array.isArray(row) ? row.slice() : []);
  assertManualLedgerHeaders(rows);
  const rowNumber = Number(sheetRowNumber || 0);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > rows.length) {
    throw new Error("Ledger row was not found. Reload the Operations list and try again.");
  }
  if (!rows[rowNumber - 1]?.some((cell) => String(cell || "").trim())) {
    throw new Error("Ledger row was not found. Reload the Operations list and try again.");
  }
  rows.splice(rowNumber - 1, 1);
  return trimTrailingEmptySheetRows(rows);
}

async function updateManualLedgerRowDirect(rowPatch) {
  await ensureManualLedgerSourceColumn();
  const ledgerValues = await getSheetValuesByTitle(getManualLedgerSheetName());
  const updatedValues = buildUpdatedManualLedgerSheetValues(ledgerValues, rowPatch);
  await ensureSheetExists(getManualLedgerSheetName(), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualLedgerSheetName(), updatedValues, getManualFinanceSpreadsheetId());
  return { sheetRowNumber: Number(rowPatch?.sheetRowNumber || 0), savedAt: new Date().toLocaleString("ru-RU") };
}

async function deleteManualLedgerRowDirect(sheetRowNumber) {
  await ensureManualLedgerSourceColumn();
  const ledgerValues = await getSheetValuesByTitle(getManualLedgerSheetName());
  const updatedValues = buildDeletedManualLedgerSheetValues(ledgerValues, sheetRowNumber);
  await ensureSheetExists(getManualLedgerSheetName(), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualLedgerSheetName(), updatedValues, getManualFinanceSpreadsheetId());
  return { sheetRowNumber: Number(sheetRowNumber || 0), savedAt: new Date().toLocaleString("ru-RU") };
}

function buildLedgerRowsFromExpenseRows(expenseRows, options = {}) {
  const rows = [];
  const timestamp = options.timestamp || new Date().toISOString();
  const ledgerSource = normalizeManualLedgerSource(options.ledgerSource || options.source, "manual");
  (expenseRows || []).forEach((expenseRow, rowIndex) => {
    const date = normalizeIncomingSheetDateValue(expenseRow?.date || options.date);
    if (!date) return;
    const legacyCategory = normalizeManualExpenseCategory(expenseRow?.category);
    if (!legacyCategory || legacyCategory === MANUAL_NOW_CATEGORY) return;
    const category = normalizeManualLedgerCategoryForStorage(legacyCategory, "extra");
    const canonicalAmounts = getCanonicalManualExpenseAmounts(expenseRow.amounts || {});
    const exchangeEntries = [];
    Object.entries(canonicalAmounts).forEach(([channel, rawAmount]) => {
      const amount = parseLooseNumber(rawAmount);
      if (!amount) return;
      if (category === "exchange") {
        exchangeEntries.push({ channel, amount });
        return;
      }
      const isIncome = category === "servicein" || category === "ezoin";
      const operation = isIncome ? "income" : (category === "business" ? "business_expense" : "personal_expense");
        rows.push({
          date,
          operation,
          fromChannel: isIncome ? "" : channel,
          toChannel: isIncome ? channel : "",
        amount: formatSheetNumber(Math.abs(amount)),
        currency: inferManualFinanceChannelCurrency(channel),
        amountUsd: "",
          category,
          subcategory: "",
          direction: isIncome ? "in" : "out",
          comment: options.comment || "legacy fact save",
          source: ledgerSource,
          rawSourceId: `${options.source || "legacy"}:${date}:${legacyCategory}:${channel}:${rowIndex}`,
          transferGroupId: "",
          createdAt: timestamp,
          updatedAt: timestamp
      });
    });
    if (exchangeEntries.length) {
      const groupId = `${options.source || "legacy"}:exchange:${date}:${rowIndex}`;
      const firstOut = exchangeEntries.find((entry) => entry.amount < 0);
      const firstIn = exchangeEntries.find((entry) => entry.amount > 0);
      exchangeEntries.forEach((entry, entryIndex) => {
        const isIn = entry.amount > 0;
        rows.push({
          date,
          operation: isIn ? "exchange_in" : "exchange_out",
          fromChannel: isIn ? (firstOut?.channel || "") : entry.channel,
          toChannel: isIn ? entry.channel : (firstIn?.channel || ""),
          amount: formatSheetNumber(Math.abs(entry.amount)),
          currency: inferManualFinanceChannelCurrency(entry.channel),
          amountUsd: "",
          category: "exchange",
          subcategory: "",
          direction: isIn ? "in" : "out",
          comment: options.comment || "legacy exchange save",
          source: ledgerSource,
          rawSourceId: `${groupId}:${entry.channel}:${entryIndex}`,
          transferGroupId: groupId,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      });
    }
  });
  return rows;
}

function buildExpenseRowsFromLedgerRows(ledgerRows, startDate, endDate) {
  const lookup = new Map();
  (ledgerRows || []).forEach((row) => {
    const date = normalizeIncomingSheetDateValue(row?.date);
    if (!date || date < startDate || date > endDate) return;
    const legacyCategory = mapManualLedgerCategoryToLegacy(row?.category);
    if (!legacyCategory || legacyCategory === MANUAL_NOW_CATEGORY) return;
    const operation = normalizeManualLedgerOperation(row?.operation, row?.category);
    const channel = operation === "income" || operation === "exchange_in"
      ? canonicalManualFinanceChannel(row?.toChannel || row?.to_channel || row?.fromChannel || row?.from_channel || "")
      : canonicalManualFinanceChannel(row?.fromChannel || row?.from_channel || row?.toChannel || row?.to_channel || "");
    if (!channel) return;
    const rawAmount = parseLooseNumber(row?.amount);
    if (!rawAmount) return;
    const signedAmount = legacyCategory === "exchange" && operation === "exchange_out"
      ? -Math.abs(rawAmount)
      : Math.abs(rawAmount);
    const key = `${date}|${legacyCategory}`;
    if (!lookup.has(key)) lookup.set(key, createManualFinanceExpenseRow(date, legacyCategory));
    const expenseRow = lookup.get(key);
    expenseRow.amounts[channel] = formatSheetNumber(parseLooseNumber(expenseRow.amounts[channel]) + signedAmount);
  });
  return Array.from(lookup.values()).sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return String(left.category).localeCompare(String(right.category));
  });
}

function buildLedgerRowsFromAccountingEntries(entries) {
  const timestamp = new Date().toISOString();
  const rows = [];
  const normalizeLedgerSource = typeof normalizeManualLedgerSource === "function"
    ? normalizeManualLedgerSource
    : (value, fallback = "") => {
        const normalized = String(value || "").trim().toLowerCase();
        return normalized || String(fallback || "").trim().toLowerCase();
      };
  (entries || []).forEach((entry, index) => {
    const date = normalizeIncomingSheetDateValue(entry.date);
    const channel = canonicalManualFinanceChannel(entry.channel || "");
    const amount = Math.abs(parseLooseNumber(entry.localAmount));
    if (!date || !channel || !amount) return;
    const category = normalizeManualLedgerCategoryForStorage(entry.category, "extra");
    const rawSourceId = String(entry.sourceTransactionId || entry.id || `expense-accounting:${date}:${channel}:${index}`).trim();
    const ledgerSource = normalizeLedgerSource(
      entry.source ||
        (Number.isInteger(entry.sourceImageIndex) ? "photo" : ""),
      Number.isInteger(entry.sourceImageIndex) ? "photo" : "mcp"
    );
    if (entry.direction === "income") {
      rows.push({
        date,
        operation: category === "ezoin" ? "income" : "income",
        fromChannel: "",
        toChannel: channel,
        amount: formatSheetNumber(amount),
        currency: String(entry.currency || inferManualFinanceChannelCurrency(channel)).trim().toUpperCase(),
        amountUsd: entry.usdAmount ? formatSheetNumber(parseLooseNumber(entry.usdAmount)) : "",
        category: category === "extra" ? "servicein" : category,
        direction: "in",
        comment: entry.manualCounterpartyComment || entry.description || entry.transactionSubject || entry.organization || "",
        source: ledgerSource,
        rawSourceId,
        transferGroupId: "",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      return;
    }
    if (entry.direction === "exchange") {
      rows.push({
        date,
        operation: "exchange_out",
        fromChannel: channel,
        toChannel: canonicalManualFinanceChannel(entry.toChannel || ""),
        amount: formatSheetNumber(amount),
        currency: String(entry.currency || inferManualFinanceChannelCurrency(channel)).trim().toUpperCase(),
        amountUsd: entry.usdAmount ? formatSheetNumber(parseLooseNumber(entry.usdAmount)) : "",
        category: "exchange",
        direction: "out",
        comment: entry.manualCounterpartyComment || entry.description || entry.transactionSubject || "exchange import without paired in-row",
        source: ledgerSource,
        rawSourceId,
        transferGroupId: String(entry.transferGroupId || entry.rawSourceId || rawSourceId).trim(),
        createdAt: timestamp,
        updatedAt: timestamp
      });
      if (entry.toChannel && parseLooseNumber(entry.toAmount || entry.receivedAmount)) {
        const toChannel = canonicalManualFinanceChannel(entry.toChannel);
        rows.push({
          date,
          operation: "exchange_in",
          fromChannel: channel,
          toChannel,
          amount: formatSheetNumber(Math.abs(parseLooseNumber(entry.toAmount || entry.receivedAmount))),
          currency: String(entry.toCurrency || inferManualFinanceChannelCurrency(toChannel)).trim().toUpperCase(),
          amountUsd: entry.toUsdAmount ? formatSheetNumber(parseLooseNumber(entry.toUsdAmount)) : "",
          category: "exchange",
          direction: "in",
          comment: entry.manualCounterpartyComment || entry.description || entry.transactionSubject || "exchange paired in-row",
          source: ledgerSource,
          rawSourceId: `${rawSourceId}:in`,
          transferGroupId: String(entry.transferGroupId || entry.rawSourceId || rawSourceId).trim(),
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }
      return;
    }
    rows.push({
      date,
      operation: category === "business" ? "business_expense" : "personal_expense",
      fromChannel: channel,
      toChannel: "",
      amount: formatSheetNumber(amount),
      currency: String(entry.currency || inferManualFinanceChannelCurrency(channel)).trim().toUpperCase(),
      amountUsd: entry.usdAmount ? formatSheetNumber(parseLooseNumber(entry.usdAmount)) : "",
      category,
      direction: "out",
      comment: entry.manualCounterpartyComment || entry.description || entry.transactionSubject || entry.organization || "",
      source: ledgerSource,
      rawSourceId,
      transferGroupId: "",
      createdAt: timestamp,
      updatedAt: timestamp
    });
  });
  return rows;
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
  await ensureManualLedgerSourceColumn();
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const transferValues = titles.has(getManualTransfersSheetName())
    ? await getSheetValuesByTitle(getManualTransfersSheetName())
    : [];
  const balanceValues = titles.has(getManualBalancesSheetName())
    ? await getSheetValuesByTitle(getManualBalancesSheetName())
    : [];
  const commissionValues = titles.has(getManualCommissionsSheetName())
    ? await getSheetValuesByTitle(getManualCommissionsSheetName())
    : [];
  const ledgerValues = titles.has(getManualLedgerSheetName())
    ? await getSheetValuesByTitle(getManualLedgerSheetName())
    : [];
  const dates = new Set();
  parseManualLedgerSheetValues(ledgerValues).rows.forEach((row) => row.date && dates.add(row.date));
  parseIncomingTransferSheetValues(transferValues).forEach((row) => row.transferDate && dates.add(row.transferDate));
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
  await ensureManualLedgerSourceColumn();
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const [ledgerValues, transferValues, balanceValues, commissionValues] = await Promise.all([
    titles.has(getManualLedgerSheetName())
      ? getSheetValuesByTitle(getManualLedgerSheetName())
      : Promise.resolve(buildManualLedgerSheetValues([])),
    titles.has(getManualTransfersSheetName())
      ? getSheetValuesByTitle(getManualTransfersSheetName())
      : Promise.resolve(buildIncomingTransferSheetValues([])),
    titles.has(getManualBalancesSheetName())
      ? getSheetValuesByTitle(getManualBalancesSheetName())
      : Promise.resolve(buildIncomingBalanceSheetValues([])),
    titles.has(getManualCommissionsSheetName())
      ? getSheetValuesByTitle(getManualCommissionsSheetName())
      : Promise.resolve(buildIncomingCommissionSheetValues([]))
  ]);
  const ledgerParse = parseManualLedgerSheetValues(ledgerValues);
  const ledgerExpenseRows = buildExpenseRowsFromLedgerRows(ledgerParse.rows, snapshotDate, snapshotDate);
  const transferRows = parseIncomingTransferSheetValues(transferValues).filter((row) => {
    return row.transferDate && row.transferDate === snapshotDate;
  });
  const expenseRows = ledgerExpenseRows.filter((row) => {
    return row.date && row.date === snapshotDate;
  });
  const flowExpenseRows = filterManualFlowExpenseRows(expenseRows);
  const latestNowEntriesByChannel = mergeLatestNowEntries(
    buildLatestBalanceEntriesByChannel(parseIncomingBalanceSheetValues(balanceValues), snapshotDate),
    buildLatestNowEntriesByChannel(ledgerExpenseRows, snapshotDate)
  );
  return {
    sheetName: MANUAL_INCOMING_TITLE,
    displayName: `${MANUAL_INCOMING_TITLE}: ${snapshotDate}`,
    sourceSheetName: `${getManualLedgerSheetName()} + ${getManualTransfersSheetName()} + ${getManualBalancesSheetName()}`,
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
    ledgerTitle: getManualLedgerSheetName(),
    ledgerRows: ledgerParse.rows,
    ledgerWarnings: ledgerParse.warnings,
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
  await ensureManualLedgerSourceColumn();
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const existingTransfers = titles.has(getManualTransfersSheetName())
    ? parseIncomingTransferSheetValues(await getSheetValuesByTitle(getManualTransfersSheetName()))
    : [];
  const existingLedgerParse = titles.has(getManualLedgerSheetName())
    ? parseManualLedgerSheetValues(await getSheetValuesByTitle(getManualLedgerSheetName()))
    : { rows: [], warnings: [] };
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
  const mergedTransfers = replaceManualRowsForDateRange(existingTransfers, transferRows, snapshotDate, snapshotDate, "transferDate");
  const mergedBalances = mergeManualBalanceRows(existingBalances, balanceRows);
  const factLedgerRows = buildLedgerRowsFromExpenseRows(rawExpenseRows, {
    date: snapshotDate,
    source: "fact",
    ledgerSource: "manual",
    comment: `fact ${snapshotDate}`
  });
  const preservedLedgerRows = (existingLedgerParse.rows || []).filter((row) => {
    if (row.date !== snapshotDate) return true;
    return !String(row.rawSourceId || "").startsWith(`fact:${snapshotDate}:`) &&
      !String(row.rawSourceId || "").startsWith(`fact:exchange:${snapshotDate}:`);
  });
  const ledgerSave = normalizeManualLedgerRowsForSave([...preservedLedgerRows, ...factLedgerRows]);
  await ensureSheetExists(getManualTransfersSheetName(), getManualFinanceSpreadsheetId());
  await ensureSheetExists(getManualBalancesSheetName(), getManualFinanceSpreadsheetId());
  await ensureSheetExists(getManualLedgerSheetName(), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualLedgerSheetName(), buildManualLedgerSheetValues(ledgerSave.rows), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualTransfersSheetName(), buildIncomingTransferSheetValues(mergedTransfers), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(getManualBalancesSheetName(), buildIncomingBalanceSheetValues(mergedBalances), getManualFinanceSpreadsheetId());
  return {
    periodStart: snapshotDate,
    periodEnd: snapshotDate,
    status: "saved",
    sourceSheetName: `${getManualLedgerSheetName()} + ${getManualTransfersSheetName()} + ${getManualBalancesSheetName()}`,
    ledgerWarnings: [...existingLedgerParse.warnings, ...ledgerSave.warnings],
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
