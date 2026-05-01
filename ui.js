// ============================================================
// RENDERING
// ============================================================

function renderTabs() {
  elements.tabs.innerHTML = "";
  elements.tabPanels.innerHTML = "";
  for (const tab of state.config.tabs) {
    const button = document.createElement("button");
    button.className = "tab" + (tab.id === state.activeTab ? " active" : "");
    button.type = "button";
    button.textContent = tab.label;
    button.addEventListener("click", () => handleTabClick(tab.id));
    elements.tabs.appendChild(button);

    const panel = document.createElement("section");
    panel.className = "tab-panel" + (tab.id === state.activeTab ? " active" : "");
    if (tab.id === "expenseAccounting") {
      panel.appendChild(renderExpenseAccountingBlock());
    } else if (tab.id === "manualFinance") {
      panel.appendChild(renderManualFinanceBlock());
    } else if (tab.id === "savings") {
      panel.appendChild(renderManualTransfersBlock());
    } else if (tab.id === "orders") {
      panel.appendChild(renderManualOrdersBlock());
    } else {
      panel.appendChild(renderStandardTab(tab.id, tab.label));
    }
    elements.tabPanels.appendChild(panel);
  }
  refreshGoogleControlsVisibility();
}


// ============================================================
// HELPERS
// ============================================================

const PAYPAL_COUNTERPARTY_OVERRIDES_STORAGE_KEY = "ezohata:paypal-counterparty-overrides:v1";

async function handleTabClick(tabId) {
  if (tabId === "manualFinance") {
    await openManualFinanceToday();
    return;
  }
  state.activeTab = tabId;
  renderTabs();
}


// ============================================================
// RENDERING
// ============================================================

async function openManualFinanceToday() {
  setToday();
  state.activeTab = "manualFinance";
  setManualFinanceStatus("Подключаю Google и открываю fact за сегодня.", false);
  renderTabs();
  try {
    await ensureGoogleAccess(true);
    await loadManualFinanceSheet(elements.startDate.value, elements.endDate.value, true);
  } catch (error) {
    setManualFinanceStatus(error.message || "Не удалось открыть fact за сегодня.", true);
    renderTabs();
  }
}

function renderStandardTab(tabId, label) {
  const block = document.createElement("div");
  const header = document.createElement("div");
  header.className = "tab-header";
  const sourceType = String(state.data?.tabs?.[tabId]?.sourceType || "").trim();
  const note = tabId === "savings"
    ? "Переводы за выбранный период читаются из workbook fact/Переводы."
    : (sourceType === "live-source-csv"
        ? "Актуальные данные загружаются сервером без Google-авторизации."
        : "Данные за выбранный период загружаются через серверный API. Google нужен только для ручных вкладок.");
  const titleWrap = document.createElement("div");
  const movementSourceUrl = tabId === "movement"
    ? getMovementSourceSpreadsheetUrl()
    : "";
  const manualWorkbookUrl = tabId === "savings"
    ? String(state.config?.manualFinance?.spreadsheetUrl || "").trim()
    : "";
  titleWrap.innerHTML = `<div><h2>${escapeHtml(label)}</h2><div class="tab-note">${escapeHtml(note)}${
    movementSourceUrl
      ? ` <a href="${escapeHtml(movementSourceUrl)}" target="_blank" rel="noreferrer">Открыть онлайн-документ источника</a>.`
      : ""
  }${
    manualWorkbookUrl
      ? ` <a href="${escapeHtml(manualWorkbookUrl)}" target="_blank" rel="noreferrer">Открыть workbook переводов</a>.`
      : ""
  }</div></div>`;
  header.appendChild(titleWrap);
  const headerActions = renderTabExportActions(tabId);
  if (headerActions.childNodes.length && tabId !== "movement") header.appendChild(headerActions);
  block.appendChild(header);
  if (tabId === "movement" && headerActions.childNodes.length) {
    headerActions.classList.add("movement-export-actions");
    block.appendChild(headerActions);
  }
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const values = tabId === "analytics"
    ? getAnalyticsMergedValues()
    : (state.data?.tabs?.[tabId]?.values || []);
  if (!values.length) {
    wrap.innerHTML = `<div class="empty">Нет данных для отображения.</div>`;
    block.appendChild(wrap);
    return block;
  }
  if (tabId === "analytics") {
    renderAnalyticsSections(wrap, values);
  } else {
    wrap.appendChild(renderResponsiveDataView(
      values,
      tabId === "movement" ? {} : { mobileTableColumnCount: 1 }
    ));
  }
  block.appendChild(wrap);
  if (tabId === "payouts") {
    const transfersBlock = renderPayoutTransfersBlock();
    if (transfersBlock) block.appendChild(transfersBlock);
  }
  return block;
}

function renderPlainTable(values) {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  values.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const tag = rowIndex === 0 ? "th" : "td";
      const node = document.createElement(tag);
      node.textContent = formatCellForDisplay(cell);
      tr.appendChild(node);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderResponsiveDataView(values, options = {}) {
  const shell = document.createElement("div");
  const desktopTable = document.createElement("div");
  const mobileTableColumnCount = Number(options.mobileTableColumnCount || 0);
  desktopTable.className = "desktop-table";
  desktopTable.appendChild(renderPlainTable(values));
  shell.appendChild(desktopTable);

  if (mobileTableColumnCount > 0) {
    const mobileTable = document.createElement("div");
    mobileTable.className = "mobile-table";
    mobileTable.appendChild(renderPlainTable(truncateTableValues(values, mobileTableColumnCount)));
    shell.appendChild(mobileTable);
    return shell;
  }

  const mobileCards = renderMobileCards(values);
  if (mobileCards) shell.appendChild(mobileCards);
  return shell;
}

function truncateTableValues(values, columnCount) {
  const count = Number(columnCount || 0);
  if (!count) return clone2dArray(values || []);
  return (values || []).map((row) => (row || []).slice(0, count));
}

function renderMobileCards(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const headers = (values[0] || []).map((cell) => String(cell || "").trim());
  const rows = values.slice(1).filter((row) => hasAnyValue(row));
  if (!rows.length) return null;
  const container = document.createElement("div");
  container.className = "mobile-cards";
  rows.forEach((row, rowIndex) => {
    const card = document.createElement("article");
    card.className = "mobile-card";
    const firstMeaningful = row.find((cell) => String(cell || "").trim()) || `Запись ${rowIndex + 1}`;
    const title = document.createElement("div");
    title.className = "mobile-card-title";
    title.textContent = String(firstMeaningful || `Запись ${rowIndex + 1}`);
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "mobile-card-grid";
    row.forEach((cell, cellIndex) => {
      const value = String(cell || "").trim();
      const label = String(headers[cellIndex] || "").trim();
      if (!value && !label) return;
      const item = document.createElement("div");
      item.className = "mobile-card-row";
      const labelNode = document.createElement("div");
      labelNode.className = "mobile-card-label";
      labelNode.textContent = label || `Колонка ${cellIndex + 1}`;
      const valueNode = document.createElement("div");
      valueNode.className = "mobile-card-value";
      valueNode.textContent = value || "—";
      item.append(labelNode, valueNode);
      grid.appendChild(item);
    });
    card.appendChild(grid);
    container.appendChild(card);
  });
  return container;
}

function renderExpenseAccountingBlock() {
  const shell = document.createElement("div");
  shell.className = "finance-shell";

  const header = document.createElement("div");
  header.className = "tab-header";
  header.innerHTML = `<div><h2>Учет расходов</h2><div class="tab-note">Загрузка скриншотов с телефона, проверка ленты и запись агрегированных расходов в репозиторий.</div></div>`;
  shell.appendChild(header);

  const subtabs = document.createElement("div");
  subtabs.className = "expense-subtabs";
  [["list", "список затрат"], ["operations", "операции"], ["analysis", "анализ финансов"]].forEach(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "expense-subtab" + (state.expenseAccounting.activeSubtab === id ? " active" : "");
    button.textContent = label;
    button.addEventListener("click", () => {
      state.expenseAccounting.activeSubtab = id;
      renderTabs();
    });
    subtabs.appendChild(button);
  });
  shell.appendChild(subtabs);

  const status = document.createElement("div");
  status.className = `finance-status${state.expenseAccounting.error ? " error" : ""}`;
  status.textContent = state.expenseAccounting.status || "Выберите скриншоты расходов для разбора.";
  shell.appendChild(status);

  if (state.expenseAccounting.activeSubtab === "analysis") {
    shell.appendChild(renderExpenseFinancialAnalysis());
    return shell;
  }

  if (state.expenseAccounting.activeSubtab === "operations") {
    shell.appendChild(renderExpenseOperationsBlock());
    return shell;
  }

  const upload = document.createElement("div");
  upload.className = "expense-upload";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.multiple = true;
  input.disabled = state.expenseAccounting.loading;
  const parseButton = document.createElement("button");
  parseButton.type = "button";
  parseButton.className = "primary";
  parseButton.textContent = state.expenseAccounting.loading ? "Разбираю..." : "Разобрать скриншоты";
  parseButton.disabled = state.expenseAccounting.loading;
  parseButton.addEventListener("click", async () => {
    await parseExpenseScreenshotFiles(Array.from(input.files || []));
  });
  const actions = document.createElement("div");
  actions.className = "expense-actions";
  const statementLoading = state.expenseAccounting.paypalLoading
    || state.expenseAccounting.wiseLoading
    || state.expenseAccounting.yoomoneyLoading
    || state.expenseAccounting.monobankLoading
    || state.expenseAccounting.privatBankLoading
    || state.expenseAccounting.tdBankLoading;
  const paypalButton = document.createElement("button");
  paypalButton.type = "button";
  paypalButton.className = "secondary";
  paypalButton.textContent = state.expenseAccounting.paypalLoading ? "Загружаю PayPal..." : "Подтянуть PayPal";
  paypalButton.disabled = state.expenseAccounting.loading || statementLoading;
  paypalButton.addEventListener("click", loadPayPalExpenseStatement);
  const wiseButton = document.createElement("button");
  wiseButton.type = "button";
  wiseButton.className = "secondary";
  wiseButton.textContent = state.expenseAccounting.wiseLoading ? "Загружаю Wise..." : "Подтянуть Wise";
  wiseButton.disabled = state.expenseAccounting.loading || statementLoading;
  wiseButton.addEventListener("click", loadWiseExpenseStatement);
  const yoomoneyButton = document.createElement("button");
  yoomoneyButton.type = "button";
  yoomoneyButton.className = "secondary";
  yoomoneyButton.textContent = state.expenseAccounting.yoomoneyLoading ? "Загружаю ЮMoney..." : "Подтянуть ЮMoney";
  yoomoneyButton.disabled = state.expenseAccounting.loading || statementLoading;
  yoomoneyButton.addEventListener("click", loadYooMoneyExpenseStatement);
  const monobankConnectButton = document.createElement("button");
  monobankConnectButton.type = "button";
  monobankConnectButton.className = "secondary";
  monobankConnectButton.textContent = state.expenseAccounting.monobankConnectOpen ? "Скрыть Monobank" : "Подключить Monobank";
  monobankConnectButton.disabled = state.expenseAccounting.loading || state.expenseAccounting.monobankValidating || statementLoading;
  monobankConnectButton.addEventListener("click", toggleMonobankConnectPanel);
  const monobankButton = document.createElement("button");
  monobankButton.type = "button";
  monobankButton.className = "secondary";
  monobankButton.textContent = state.expenseAccounting.monobankLoading ? "Загружаю Mono..." : "Подтянуть Mono";
  monobankButton.disabled = state.expenseAccounting.loading || state.expenseAccounting.monobankValidating || statementLoading;
  monobankButton.addEventListener("click", loadMonobankExpenseStatement);
  const privatBankButton = document.createElement("button");
  privatBankButton.type = "button";
  privatBankButton.className = "secondary";
  privatBankButton.textContent = state.expenseAccounting.privatBankLoading ? "Загружаю Privat..." : "Подтянуть Privat";
  privatBankButton.disabled = state.expenseAccounting.loading || statementLoading;
  privatBankButton.addEventListener("click", loadPrivatBankExpenseStatement);
  const tdBankButton = document.createElement("button");
  tdBankButton.type = "button";
  tdBankButton.className = "secondary";
  tdBankButton.textContent = state.expenseAccounting.tdBankLoading ? "Импортирую TD Bank..." : "Подтянуть TD Bank";
  tdBankButton.disabled = state.expenseAccounting.loading || statementLoading;
  tdBankButton.addEventListener("click", loadTdBankExpenseStatementFromClipboard);
  actions.append(parseButton, paypalButton, wiseButton, yoomoneyButton, monobankConnectButton, monobankButton, privatBankButton, tdBankButton);
  upload.append(input, actions);
  shell.appendChild(upload);
  if (state.expenseAccounting.monobankConnectOpen) shell.appendChild(renderMonobankConnectPanel());
  shell.appendChild(renderTdBankExpenseHelper());
  shell.appendChild(renderExpenseAccountingResultTabs());

  const topSave = renderExpenseAccountingSaveButton();
  if (topSave) shell.appendChild(topSave);
  shell.appendChild(renderExpenseAccountingFeed());
  const bottomSave = renderExpenseAccountingSaveButton();
  if (bottomSave) shell.appendChild(bottomSave);
  return shell;
}

function renderExpenseAccountingSaveButton() {
  if (!state.expenseAccounting.entries.length) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = "внести значения";
  button.disabled = state.expenseAccounting.loading;
  button.addEventListener("click", saveExpenseAccountingEntries);
  return button;
}

function renderMonobankConnectPanel() {
  const panel = document.createElement("div");
  panel.className = "provider-connect-card";

  const title = document.createElement("div");
  title.className = "provider-connect-title";
  title.textContent = "Подключить Monobank";
  panel.appendChild(title);

  const note = document.createElement("div");
  note.className = "config-note";
  note.append("1. Откройте ");
  const link = document.createElement("a");
  link.href = "https://api.monobank.ua/";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Monobank API cabinet";
  note.appendChild(link);
  note.append(" 2. Скопируйте personal token. 3. Вставьте его ниже и нажмите `Проверить токен`.");
  panel.appendChild(note);

  const securityNote = document.createElement("div");
  securityNote.className = "config-note";
  securityNote.textContent = "Токен хранится только в памяти текущей страницы и уходит только в server request на проверку/импорт. localStorage не используется.";
  panel.appendChild(securityNote);

  const controls = document.createElement("div");
  controls.className = "provider-connect-controls";

  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.className = "finance-input provider-token-input";
  tokenInput.placeholder = "Вставьте Monobank personal token";
  tokenInput.value = state.expenseAccounting.monobankToken;
  tokenInput.autocomplete = "off";
  tokenInput.spellcheck = false;
  tokenInput.disabled = state.expenseAccounting.monobankValidating || state.expenseAccounting.monobankLoading;
  tokenInput.addEventListener("input", (event) => {
    state.expenseAccounting.monobankToken = String(event.target.value || "");
  });

  const validateButton = document.createElement("button");
  validateButton.type = "button";
  validateButton.className = "secondary";
  validateButton.textContent = state.expenseAccounting.monobankValidating ? "Проверяю токен..." : "Проверить токен";
  validateButton.disabled = state.expenseAccounting.monobankValidating || state.expenseAccounting.monobankLoading;
  validateButton.addEventListener("click", validateMonobankConnection);

  controls.append(tokenInput, validateButton);
  panel.appendChild(controls);

  if (state.expenseAccounting.monobankAccounts.length) {
    const accountWrap = document.createElement("div");
    accountWrap.className = "provider-connect-controls";

    const accountSelect = document.createElement("select");
    accountSelect.className = "finance-input";
    accountSelect.disabled = state.expenseAccounting.monobankLoading;
    [
      { id: "", label: "Все найденные счета" },
      ...state.expenseAccounting.monobankAccounts
    ].forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id || "";
      option.textContent = account.label || "Счет Monobank";
      option.selected = state.expenseAccounting.monobankSelectedAccountId === option.value;
      accountSelect.appendChild(option);
    });
    accountSelect.addEventListener("change", (event) => {
      state.expenseAccounting.monobankSelectedAccountId = String(event.target.value || "");
    });
    accountWrap.appendChild(accountSelect);

    const accountNote = document.createElement("div");
    accountNote.className = "config-note";
    accountNote.textContent = state.expenseAccounting.monobankClientName
      ? `Найдено счетов: ${state.expenseAccounting.monobankAccounts.length}. Клиент: ${state.expenseAccounting.monobankClientName}.`
      : `Найдено счетов: ${state.expenseAccounting.monobankAccounts.length}.`;
    accountWrap.appendChild(accountNote);
    panel.appendChild(accountWrap);
  }

  if (state.expenseAccounting.monobankValidationMessage) {
    const status = document.createElement("div");
    status.className = `provider-connect-status${state.expenseAccounting.monobankValidationError ? " error" : ""}`;
    status.textContent = state.expenseAccounting.monobankValidationMessage;
    panel.appendChild(status);
  }

  return panel;
}

function renderExpenseAccountingResultTabs() {
  const wrap = document.createElement("div");
  wrap.className = "expense-result-tabs";
  const counts = getExpenseAccountingDirectionCounts();
  [["spent", `Spent (${counts.spent})`], ["received", `Received (${counts.received})`]].forEach(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "expense-subtab" + (state.expenseAccounting.resultTab === id ? " active" : "");
    button.textContent = label;
    button.addEventListener("click", () => {
      state.expenseAccounting.resultTab = id;
      renderTabs();
    });
    wrap.appendChild(button);
  });
  return wrap;
}

function renderExpenseAccountingFeed() {
  const feed = document.createElement("div");
  feed.className = "expense-feed";
  const visibleEntries = getExpenseAccountingVisibleEntries();
  if (!visibleEntries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.expenseAccounting.resultTab === "received"
      ? "После разбора здесь появятся входящие поступления."
      : "После разбора здесь появится лента расходов.";
    feed.appendChild(empty);
    return feed;
  }
  const grouped = new Map();
  visibleEntries
    .slice()
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .forEach((entry) => {
      if (!grouped.has(entry.date)) grouped.set(entry.date, []);
      grouped.get(entry.date).push(entry);
    });
  grouped.forEach((entries, date) => {
    const day = document.createElement("section");
    day.className = "expense-day";
    const title = document.createElement("div");
    title.className = "expense-day-title";
    title.textContent = date;
    day.appendChild(title);
    day.appendChild(renderExpenseAccountingTable(entries));
    feed.appendChild(day);
  });
  return feed;
}

function renderExpenseAccountingTable(entries) {
  const shell = document.createElement("div");
  shell.className = "expense-table-shell";

  const desktopWrap = document.createElement("div");
  desktopWrap.className = "table-wrap expense-table-desktop";
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  const header = document.createElement("tr");
  ["Канал", "Сумма", "Клиент заплатил", "Net получено", "Категория"].forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell;
    header.appendChild(th);
  });
  const counterpartyHeader = document.createElement("th");
  counterpartyHeader.textContent = "От кого / Кому";
  header.appendChild(counterpartyHeader);
  tbody.appendChild(header);
  entries.forEach((entry) => tbody.appendChild(renderExpenseAccountingTableRow(entry)));
  table.appendChild(tbody);
  desktopWrap.appendChild(table);
  shell.appendChild(desktopWrap);

  const mobileWrap = document.createElement("div");
  mobileWrap.className = "expense-table-mobile";
  entries.forEach((entry) => mobileWrap.appendChild(renderExpenseAccountingMobileCard(entry)));
  shell.appendChild(mobileWrap);

  return shell;
}

function renderExpenseAccountingTableRow(entry) {
  const row = document.createElement("tr");
  const channel = document.createElement("td");
  channel.appendChild(buildExpenseAccountingChannelNode(entry));
  const amount = document.createElement("td");
  amount.className = "expense-amount";
  amount.innerHTML = `${escapeHtml(formatSheetNumber(entry.localAmount))} ${escapeHtml(entry.currency || "")}<div class="expense-usd">${escapeHtml(entry.usdAmount ? `${formatSheetNumber(entry.usdAmount)} USD` : "USD не распознан")}</div>`;
  const clientPaid = document.createElement("td");
  clientPaid.className = "expense-amount";
  clientPaid.textContent = formatOptionalProviderAmount(entry.amountClientPaid, entry.currency);
  const netReceived = document.createElement("td");
  netReceived.className = "expense-amount";
  netReceived.textContent = formatOptionalProviderAmount(entry.amountNetReceived, entry.currency);
  const category = document.createElement("td");
  category.appendChild(buildExpenseAccountingCategorySelect(entry));
  const counterparty = document.createElement("td");
  counterparty.className = "expense-table-counterparty";
  counterparty.appendChild(buildExpenseAccountingCounterpartyNode(entry));
  row.append(channel, amount, clientPaid, netReceived, category, counterparty);
  return row;
}

function renderExpenseAccountingMobileCard(entry) {
  const card = document.createElement("article");
  card.className = "expense-table-mobile-card";
  card.appendChild(buildExpenseAccountingChannelNode(entry));

  const amount = document.createElement("div");
  amount.className = "expense-amount";
  amount.innerHTML = `${escapeHtml(formatSheetNumber(entry.localAmount))} ${escapeHtml(entry.currency || "")}<div class="expense-usd">${escapeHtml(entry.usdAmount ? `${formatSheetNumber(entry.usdAmount)} USD` : "USD не распознан")}</div>`;
  card.appendChild(amount);

  const clientPaidLabel = document.createElement("div");
  clientPaidLabel.className = "expense-mobile-label";
  clientPaidLabel.textContent = "Клиент заплатил";
  card.appendChild(clientPaidLabel);
  const clientPaid = document.createElement("div");
  clientPaid.className = "expense-amount";
  clientPaid.textContent = formatOptionalProviderAmount(entry.amountClientPaid, entry.currency);
  card.appendChild(clientPaid);

  const netReceivedLabel = document.createElement("div");
  netReceivedLabel.className = "expense-mobile-label";
  netReceivedLabel.textContent = "Net получено";
  card.appendChild(netReceivedLabel);
  const netReceived = document.createElement("div");
  netReceived.className = "expense-amount";
  netReceived.textContent = formatOptionalProviderAmount(entry.amountNetReceived, entry.currency);
  card.appendChild(netReceived);

  const counterpartyLabel = document.createElement("div");
  counterpartyLabel.className = "expense-mobile-label";
  counterpartyLabel.textContent = "От кого / Кому";
  card.appendChild(counterpartyLabel);
  card.appendChild(buildExpenseAccountingCounterpartyNode(entry));
  card.appendChild(buildExpenseAccountingCategorySelect(entry));
  return card;
}

function formatOptionalProviderAmount(value, currency) {
  const amount = parseLooseNumber(value);
  if (!amount) return "—";
  return `${formatSheetNumber(amount)} ${currency || ""}`.trim();
}

function renderExpenseFinancialAnalysis() {
  const block = document.createElement("div");
  block.className = "finance-shell expense-analysis-shell";
  const header = document.createElement("div");
  header.className = "tab-header";
  header.innerHTML = `<div><div class="tab-note">Сводка по расходам, приходам и сверка по каналам за выбранный период.</div></div>`;
  const headerActions = document.createElement("div");
  headerActions.className = "finance-actions";
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "secondary";
  refreshButton.textContent = state.expenseAccounting.loading ? "Обновляю..." : "Обновить";
  refreshButton.disabled = state.expenseAccounting.loading;
  refreshButton.addEventListener("click", refreshExpenseFinancialAnalysis);
  headerActions.appendChild(refreshButton);
  header.appendChild(headerActions);
  block.appendChild(header);
  const manualOverlayWarning = getManualOverlayUnavailableMessage();
  if (manualOverlayWarning) {
    const warning = document.createElement("div");
    warning.className = "config-note";
    warning.style.marginBottom = "12px";
    warning.textContent = manualOverlayWarning;
    block.appendChild(warning);
  }
  if (manualOverlayWarning) {
    const paypalSummary = getActivePayPalSummary();
    if (hasProviderSummaryData(paypalSummary)) {
      block.appendChild(renderProviderMonthlyStatement("PayPal за месяц", paypalSummary));
    }
    const wiseSummary = getActiveWiseSummary();
    if (hasProviderSummaryData(wiseSummary)) {
      block.appendChild(renderProviderMonthlyStatement("Wise за месяц", wiseSummary));
    }
    const yoomoneySummary = getActiveYooMoneySummary();
    if (hasProviderSummaryData(yoomoneySummary)) {
      block.appendChild(renderProviderMonthlyStatement("ЮMoney за месяц", yoomoneySummary));
    }
    const monobankSummary = getActiveMonobankSummary();
    if (hasProviderSummaryData(monobankSummary)) {
      block.appendChild(renderProviderMonthlyStatement("Monobank за месяц", monobankSummary));
    }
    const privatBankSummary = getActivePrivatBankSummary();
    if (hasProviderSummaryData(privatBankSummary)) {
      block.appendChild(renderProviderMonthlyStatement("PrivatBank за месяц", privatBankSummary));
    }
    const tdBankSummary = getActiveTdBankSummary();
    if (hasProviderSummaryData(tdBankSummary)) {
      block.appendChild(renderProviderMonthlyStatement("TD Bank за месяц", tdBankSummary));
    }
    return block;
  }
  const channelReconciliation = getExpenseAnalysisChannelSummary();
  block.appendChild(renderExpenseAnalysisChannelBlock(channelReconciliation));
  const paypalSummary = getActivePayPalSummary();
  if (hasProviderSummaryData(paypalSummary)) {
    block.appendChild(renderProviderMonthlyStatement("PayPal за месяц", paypalSummary));
  }
  const wiseSummary = getActiveWiseSummary();
  if (hasProviderSummaryData(wiseSummary)) {
    block.appendChild(renderProviderMonthlyStatement("Wise за месяц", wiseSummary));
  }
  const yoomoneySummary = getActiveYooMoneySummary();
  if (hasProviderSummaryData(yoomoneySummary)) {
    block.appendChild(renderProviderMonthlyStatement("ЮMoney за месяц", yoomoneySummary));
  }
  const monobankSummary = getActiveMonobankSummary();
  if (hasProviderSummaryData(monobankSummary)) {
    block.appendChild(renderProviderMonthlyStatement("Monobank за месяц", monobankSummary));
  }
  const privatBankSummary = getActivePrivatBankSummary();
  if (hasProviderSummaryData(privatBankSummary)) {
    block.appendChild(renderProviderMonthlyStatement("PrivatBank за месяц", privatBankSummary));
  }
  const tdBankSummary = getActiveTdBankSummary();
  if (hasProviderSummaryData(tdBankSummary)) {
    block.appendChild(renderProviderMonthlyStatement("TD Bank за месяц", tdBankSummary));
  }
  const manualRows = getCurrentAnalyticsManualRows();
  const usdRateLookup = buildManualFinanceUsdRateLookup(
    state.aggregatedManualRange?.transferRows || state.manualTransfers.data?.transferRows || state.manualFinance.data?.transferRows || [],
    state.data?.tabs?.movement?.values || []
  );
  const expenseUsd = Object.fromEntries(MANUAL_EXPENSE_ACCOUNTING_CATEGORIES.map((category) => [category, 0]));
  manualRows.forEach((row) => {
    if (!row?.channel || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    expenseUsd.business += getManualFinanceFieldUsdNumber(row, "business", usdRateLookup);
    expenseUsd.flat += getManualFinanceFieldUsdNumber(row, "flat", usdRateLookup);
    expenseUsd.food += getManualFinanceFieldUsdNumber(row, "food", usdRateLookup);
    expenseUsd.fun += getManualFinanceFieldUsdNumber(row, "fun", usdRateLookup);
    expenseUsd.travel += getManualFinanceFieldUsdNumber(row, "travel", usdRateLookup);
    expenseUsd.study += getManualFinanceFieldUsdNumber(row, "study", usdRateLookup);
  });
  const incomeUsd = manualRows.reduce((sum, row) => {
    if (!row?.channel || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return sum;
    return sum + getManualFinanceFieldUsdNumber(row, "serviceIncome", usdRateLookup);
  }, 0);
  const movementStats = calculateMovementChannelStats(state.data?.tabs?.movement?.values || []);
  const movementIncomeUsd = Object.values(movementStats.usdByChannel || {}).reduce((sum, value) => sum + parseLooseNumber(value), 0);
  const totalExpensesUsd = Object.values(expenseUsd).reduce((sum, value) => sum + value, 0);
  const totalIncomeUsd = incomeUsd + movementIncomeUsd;
  const cards = document.createElement("div");
  cards.className = "expense-summary-grid";
  [["прибыль", totalIncomeUsd - totalExpensesUsd], ["приход", totalIncomeUsd], ["расходы", totalExpensesUsd]]
    .forEach(([label, value]) => cards.appendChild(renderExpenseSummaryCard(label, `${formatSheetNumber(value)} USD`)));
  block.appendChild(cards);
  const rows = [
    ["тип расходов", "USD"],
    ...MANUAL_EXPENSE_ACCOUNTING_CATEGORIES.map((category) => [category, formatSheetNumber(expenseUsd[category])])
  ];
  const wrap = document.createElement("div");
  wrap.className = "table-wrap analysis-table-wrap";
  wrap.appendChild(renderPlainTable(rows));
  block.appendChild(wrap);
  return block;
}

function renderExpenseAnalysisChannelBlock(summary) {
  const block = document.createElement("div");
  block.className = "analytics-section";
  const title = document.createElement("div");
  title.className = "tab-note";
  title.style.marginBottom = "10px";
  title.style.fontWeight = "700";
  title.textContent = "Сверка по каналам";
  block.appendChild(title);
  const cards = document.createElement("div");
  cards.className = "expense-summary-grid";
  cards.appendChild(renderExpenseSummaryCard("план заказы", `${formatSheetNumber(summary.incomeTotals.ordersPlanUsd)} USD`));
  cards.appendChild(renderExpenseSummaryCard("план услуги", `${formatSheetNumber(summary.incomeTotals.servicePlanUsd)} USD`));
  cards.appendChild(renderExpenseSummaryCard("план всего", `${formatSheetNumber(summary.incomeTotals.plannedUsd)} USD`));
  cards.appendChild(renderExpenseSummaryCard("пришло реально", `${formatSheetNumber(summary.incomeTotals.realUsd)} USD`));
  cards.appendChild(renderExpenseSummaryCard("потрачено план", `${formatSheetNumber(summary.expenseTotals.plannedUsd)} USD`));
  cards.appendChild(renderExpenseSummaryCard("потрачено реал", `${formatSheetNumber(summary.expenseTotals.realUsd)} USD`));
  block.appendChild(cards);
  const wrap = document.createElement("div");
  wrap.className = "table-wrap analysis-table-wrap";
  wrap.appendChild(renderPlainTable(summary.rows));
  block.appendChild(wrap);
  return block;
}

function getExpenseAnalysisChannelSummary() {
  const manualRows = getCurrentAnalyticsManualRows();
  const usdRateLookup = buildManualFinanceUsdRateLookup(
    state.aggregatedManualRange?.transferRows || state.manualTransfers.data?.transferRows || state.manualFinance.data?.transferRows || [],
    state.data?.tabs?.movement?.values || []
  );
  return buildExpenseAnalysisChannelSummary({
    manualRows,
    movementValues: state.data?.tabs?.movement?.values || [],
    realIncomeSummaryByChannel: state.data?.realIncome?.summaryByChannel || {},
    providerExpenseByChannel: getExpenseAnalysisProviderExpenseByChannel(usdRateLookup),
    usdRateLookup
  });
}

function getExpenseAnalysisProviderExpenseByChannel(rateLookup) {
  const totals = Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  (state.expenseAccounting.entries || []).forEach((entry) => {
    if (!entry?.channel || !["expense", "exchange"].includes(entry.direction)) return;
    const channel = canonicalManualFinanceChannel(entry.channel);
    if (!channel || !Object.prototype.hasOwnProperty.call(totals, channel)) return;
    const usdAmount = parseLooseNumber(entry.usdAmount);
    const convertedUsd = usdAmount || getManualFinanceFieldUsdNumber({
      channel,
      business: entry.localAmount,
      currency: entry.currency,
      localAmount: entry.localAmount
    }, "business", rateLookup);
    totals[channel] += convertedUsd;
  });
  if ((state.expenseAccounting.entries || []).length) {
    return Object.fromEntries(
      Object.entries(totals).map(([channel, amount]) => [channel, roundProviderSummaryAmount(amount)])
    );
  }

  [
    [getActivePayPalSummary(), { USD: "пейпал дол", EUR: "пейпал евр", CAD: "пейпал сad" }],
    [getActiveWiseSummary(), { USD: "трансервайз дол", EUR: "трансервайз евро" }],
    [getActiveYooMoneySummary(), { RUB: "Яндекс руб" }],
    [getActiveMonobankSummary(), { UAH: "монобанк грн" }],
    [getActivePrivatBankSummary(), { USD: "приват 24-дол", EUR: "приват 24-евро", UAH: "приват 24-грн" }]
  ].forEach(([summary, channelByCurrency]) => {
    Object.entries(summary?.totalsByCurrency || {}).forEach(([currency, currencyTotals]) => {
      const channel = channelByCurrency[String(currency || "").trim().toUpperCase()];
      if (!channel || !Object.prototype.hasOwnProperty.call(totals, channel)) return;
      totals[channel] += parseLooseNumber(currencyTotals?.expense) + parseLooseNumber(currencyTotals?.exchange);
    });
  });

  return Object.fromEntries(
    Object.entries(totals).map(([channel, amount]) => [channel, roundProviderSummaryAmount(amount)])
  );
}

function renderProviderMonthlyStatement(titleText, summary) {
  const block = document.createElement("div");
  block.className = "analytics-section";
  const title = document.createElement("div");
  title.className = "tab-note";
  title.style.marginBottom = "10px";
  title.style.fontWeight = "700";
  title.textContent = titleText;
  block.appendChild(title);

  const cards = document.createElement("div");
  cards.className = "expense-summary-grid";
  cards.appendChild(renderProviderSummaryCard("приход", summary.totalsByCurrency, "income"));
  cards.appendChild(renderProviderSummaryCard("расход", summary.totalsByCurrency, "expense"));
  cards.appendChild(renderProviderSummaryCard("итог", summary.totalsByCurrency, "net"));
  block.appendChild(cards);

  const rows = [["месяц", "валюта", "приход", "расход", "обмен", "итог"]];
  (summary.months || []).forEach((monthRow) => {
    Object.entries(monthRow.totalsByCurrency || {}).forEach(([currency, totals]) => {
      rows.push([
        monthRow.month,
        currency,
        formatProviderSummaryValue(totals.income, currency),
        formatProviderSummaryValue(totals.expense, currency),
        formatProviderSummaryValue(totals.exchange || 0, currency),
        formatProviderSummaryValue(totals.net, currency)
      ]);
    });
  });
  const wrap = document.createElement("div");
  wrap.className = "table-wrap analysis-table-wrap";
  wrap.appendChild(renderPlainTable(rows));
  block.appendChild(wrap);
  return block;
}

function renderProviderSummaryCard(label, totalsByCurrency, key) {
  const card = document.createElement("div");
  card.className = "expense-summary-card";
  const labelNode = document.createElement("div");
  labelNode.className = "expense-summary-label";
  labelNode.textContent = label;
  const valueNode = document.createElement("div");
  valueNode.className = "expense-summary-value";
  const entries = Object.entries(totalsByCurrency || {});
  if (!entries.length) {
    valueNode.textContent = "0,0000";
  } else {
    entries.forEach(([currency, totals]) => {
      const line = document.createElement("div");
      line.className = "expense-currency-line";
      line.textContent = formatProviderSummaryValue(totals?.[key], currency);
      valueNode.appendChild(line);
    });
  }
  card.append(labelNode, valueNode);
  return card;
}

function getActivePayPalSummary() {
  if (hasProviderSummaryData(state.expenseAccounting.paypalSummary)) return state.expenseAccounting.paypalSummary;
  const paypalEntries = state.expenseAccounting.entries.filter((entry) => entry.source === "paypal");
  return buildProviderExpenseSummary(paypalEntries);
}

function getActiveWiseSummary() {
  if (hasProviderSummaryData(state.expenseAccounting.wiseSummary)) return state.expenseAccounting.wiseSummary;
  const wiseEntries = state.expenseAccounting.entries.filter((entry) => entry.source === "wise");
  return buildProviderExpenseSummary(wiseEntries);
}

function getActiveYooMoneySummary() {
  if (hasProviderSummaryData(state.expenseAccounting.yoomoneySummary)) return state.expenseAccounting.yoomoneySummary;
  const yoomoneyEntries = state.expenseAccounting.entries.filter((entry) => entry.source === "yoomoney");
  return buildProviderExpenseSummary(yoomoneyEntries);
}

function getActiveMonobankSummary() {
  if (hasProviderSummaryData(state.expenseAccounting.monobankSummary)) return state.expenseAccounting.monobankSummary;
  const monobankEntries = state.expenseAccounting.entries.filter((entry) => entry.source === "monobank");
  return buildProviderExpenseSummary(monobankEntries);
}

function getActivePrivatBankSummary() {
  if (hasProviderSummaryData(state.expenseAccounting.privatBankSummary)) return state.expenseAccounting.privatBankSummary;
  const privatBankEntries = state.expenseAccounting.entries.filter((entry) => entry.source === "privatbank");
  return buildProviderExpenseSummary(privatBankEntries);
}

function getActiveTdBankSummary() {
  if (hasProviderSummaryData(state.expenseAccounting.tdBankSummary)) return state.expenseAccounting.tdBankSummary;
  const tdBankEntries = state.expenseAccounting.entries.filter((entry) => entry.source === "tdbank");
  return buildProviderExpenseSummary(tdBankEntries);
}

function renderTdBankExpenseHelper() {
  const helper = document.createElement("details");
  helper.className = "expense-helper";
  const summary = document.createElement("summary");
  summary.textContent = "TD Bank import helper";
  const note = document.createElement("ol");
  note.className = "tab-note";
  [
    "Скопировать bookmarklet",
    "Открыть TD EasyWeb Activity",
    "Запустить bookmarklet",
    "Вернуться в Ledger",
    "Импортировать TD из буфера"
  ].forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    note.appendChild(item);
  });
  const runner = document.createElement("textarea");
  runner.readOnly = true;
  runner.spellcheck = false;
  runner.value = buildTdBankBookmarklet();
  const actions = document.createElement("div");
  actions.className = "expense-helper-actions";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "ghost";
  copyButton.textContent = "Скопировать bookmarklet";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(runner.value);
      setExpenseAccountingStatus("TD Bank bookmarklet скопирован. Запустите его на странице TD EasyWeb activity.", false);
    } catch (error) {
      setExpenseAccountingStatus(error.message || "Не удалось скопировать TD Bank bookmarklet.", true);
    }
    renderTabs();
  });
  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "ghost";
  importButton.textContent = state.expenseAccounting.tdBankLoading ? "Импортирую TD Bank..." : "Импортировать TD из буфера";
  importButton.disabled = state.expenseAccounting.loading || state.expenseAccounting.paypalLoading || state.expenseAccounting.wiseLoading || state.expenseAccounting.yoomoneyLoading || state.expenseAccounting.tdBankLoading;
  importButton.addEventListener("click", loadTdBankExpenseStatementFromClipboard);
  actions.append(copyButton, importButton);
  helper.append(summary, note, runner, actions);
  return helper;
}

function buildTdBankBookmarklet() {
  const startDate = normalizeIncomingSheetDateValue(elements.startDate?.value) || "";
  const endDate = normalizeIncomingSheetDateValue(elements.endDate?.value) || "";
  const origin = window.location.origin.replace(/\/+$/, "");
  const payload = JSON.stringify({ startDate, endDate, importerUrl: `${origin}/td-easyweb-importer.js` });
  return `javascript:(async()=>{const cfg=${payload};const s=document.createElement('script');s.src=cfg.importerUrl+'?ts='+Date.now();document.body.appendChild(s);await new Promise((r,e)=>{s.onload=r;s.onerror=e});const out=window.TD_EASYWEB_IMPORTER.collect({from:cfg.startDate,to:cfg.endDate});await navigator.clipboard.writeText(JSON.stringify(out));alert('TD Bank rows copied: '+(out.items||[]).length+'. Return to ledger and import from clipboard.');})().catch(e=>alert(e.message||e))`;
}

function hasProviderSummaryData(summary) {
  return Boolean((summary?.months || []).some((monthRow) => Object.keys(monthRow.totalsByCurrency || {}).length));
}

function buildProviderExpenseSummary(entries) {
  const monthLookup = new Map();
  const totalLookup = new Map();
  entries.forEach((entry) => {
    const date = normalizeIncomingSheetDateValue(entry.date);
    const currency = String(entry.currency || "").trim().toUpperCase();
    const amount = Math.abs(parseLooseNumber(entry.localAmount));
    if (!date || !currency || !amount) return;
    const month = date.slice(0, 7);
    if (!monthLookup.has(month)) monthLookup.set(month, new Map());
    addProviderSummaryAmount(monthLookup.get(month), currency, entry.direction, amount);
    addProviderSummaryAmount(totalLookup, currency, entry.direction, amount);
  });
  return {
    months: Array.from(monthLookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, currencyLookup]) => ({
        month,
        totalsByCurrency: serializeProviderSummaryCurrencyTotals(currencyLookup)
      })),
    totalsByCurrency: serializeProviderSummaryCurrencyTotals(totalLookup)
  };
}

function addProviderSummaryAmount(lookup, currency, direction, amount) {
  if (!lookup.has(currency)) lookup.set(currency, { income: 0, expense: 0, exchange: 0, net: 0 });
  const totals = lookup.get(currency);
  if (direction === "income") {
    totals.income += amount;
    totals.net += amount;
  } else if (direction === "expense") {
    totals.expense += amount;
    totals.net -= amount;
  } else if (direction === "exchange") {
    totals.exchange += amount;
  }
}

function serializeProviderSummaryCurrencyTotals(lookup) {
  return Object.fromEntries(
    Array.from(lookup.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => [
        currency,
        {
          income: roundProviderSummaryAmount(totals.income),
          expense: roundProviderSummaryAmount(totals.expense),
          ...(totals.exchange ? { exchange: roundProviderSummaryAmount(totals.exchange) } : {}),
          net: roundProviderSummaryAmount(totals.net)
        }
      ])
  );
}

function roundProviderSummaryAmount(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function formatProviderSummaryValue(value, currency) {
  return `${formatSheetNumber(value)} ${currency}`;
}

function renderExpenseSummaryCard(label, value) {
  const card = document.createElement("div");
  card.className = "expense-summary-card";
  card.innerHTML = `<div class="expense-summary-label">${escapeHtml(label)}</div><div class="expense-summary-value">${escapeHtml(value)}</div>`;
  return card;
}

function getExpenseAccountingDirectionCounts() {
  return (state.expenseAccounting.entries || []).reduce((acc, entry) => {
    if (entry?.direction === "income") acc.received += 1;
    else acc.spent += 1;
    return acc;
  }, { received: 0, spent: 0 });
}

function getExpenseAccountingVisibleEntries() {
  const expectedDirection = state.expenseAccounting.resultTab === "received" ? "income" : "spent";
  return (state.expenseAccounting.entries || []).filter((entry) => {
    if (expectedDirection === "income") return entry.direction === "income";
    return entry.direction === "expense" || entry.direction === "exchange" || !entry.direction;
  });
}

function buildExpenseAccountingMeta(entry) {
  const parts = [entry.date || ""];
  if (entry.dateSource === "upload_fallback") parts.push("дата = fallback по загрузке");
  if (entry.entryKind === "fee") parts.push("PayPal fee");
  else if (entry.entryKind === "refund") parts.push("Refund");
  else if (entry.direction === "income") parts.push("Received");
  else if (entry.direction === "exchange") parts.push("Exchange");
  else parts.push("Spent");
  return parts.filter(Boolean).join(" · ");
}

function buildExpenseAccountingChannelNode(entry) {
  const channel = document.createElement("div");
  channel.className = "expense-primary";
  const title = document.createElement("div");
  title.textContent = entry.channel || "";
  const meta = document.createElement("div");
  meta.className = "expense-meta";
  meta.textContent = buildExpenseAccountingMeta(entry);
  channel.append(title, meta);
  return channel;
}

function buildExpenseAccountingCategorySelect(entry) {
  const select = document.createElement("select");
  select.className = "expense-select";
  if (entry.direction === "income") {
    MANUAL_RECEIVED_ENTRY_TYPES.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      option.selected = entry.receivedType === category;
      select.appendChild(option);
    });
  } else {
    MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES.forEach((category) => {
      if (!MANUAL_EXPENSE_ACCOUNTING_CATEGORIES.includes(category)) return;
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      option.selected = entry.category === category;
      select.appendChild(option);
    });
  }
  select.addEventListener("change", (event) => {
    if (entry.direction === "income") {
      entry.receivedType = normalizeReceivedEntryType(event.target.value);
      entry.category = mapReceivedTypeToAccountingCategory(entry.receivedType);
      return;
    }
    entry.category = event.target.value;
  });
  return select;
}

function buildExpenseAccountingCounterpartyNode(entry) {
  const wrap = document.createElement("div");
  wrap.className = "expense-table-counterparty";
  const label = buildExpenseAccountingReadableCounterparty(entry);
  const details = buildExpenseAccountingTechnicalDetails(entry);

  const labelNode = document.createElement("div");
  labelNode.className = "expense-counterparty-label";
  labelNode.textContent = label;
  labelNode.title = label;
  wrap.appendChild(labelNode);

  if (isUnknownPayPalCounterparty(entry)) {
    const hintNode = document.createElement("div");
    hintNode.className = "expense-counterparty-hint";
    hintNode.textContent = "PayPal MCP не передал имя/компанию";
    hintNode.title = "PayPal MCP не передал имя/компанию. Для точного получателя нужен PayPal transaction details endpoint или CSV/export с полем Name.";
    wrap.appendChild(hintNode);
    wrap.appendChild(buildExpenseAccountingManualCounterpartyNode(entry));
  }

  if (details) {
    const detailsNode = document.createElement("details");
    detailsNode.className = "expense-counterparty-details";
    const summary = document.createElement("summary");
    summary.textContent = "технические детали";
    const body = document.createElement("div");
    body.className = "expense-counterparty-details-body";
    body.textContent = details;
    body.title = details;
    detailsNode.append(summary, body);
    wrap.appendChild(detailsNode);
  }
  return wrap;
}

function buildExpenseAccountingReadableCounterparty(entry) {
  if (isPayPalExchangeEntry(entry)) {
    const flow = buildExpenseAccountingFromToLabel(entry);
    return flow ? `Обмен: ${flow}` : "Обмен PayPal";
  }
  if (entry.entryKind === "fee" || String(entry.operationType || entry.operation_type || "").trim().toLowerCase() === "fee") {
    return "Me → Комиссия PayPal";
  }
  if (isUnknownPayPalCounterparty(entry)) {
    return "Получатель не распознан";
  }
  const paypalName = getReadablePayPalCounterpartyName(entry);
  if (paypalName) {
    return entry.direction === "income" ? `${paypalName} → Me` : `Me → ${paypalName}`;
  }
  return buildExpenseAccountingFromToLabel(entry);
}

function buildExpenseAccountingFromToLabel(entry) {
  const explicit = String(entry.displayFromTo || "").trim();
  if (explicit) return explicit;
  const fromEntity = normalizeExpenseAccountingEntityLabel(entry.fromEntity || entry.from_entity || "");
  const toEntity = normalizeExpenseAccountingEntityLabel(entry.toEntity || entry.to_entity || "");
  if (fromEntity || toEntity) return `${fromEntity || "Unknown"} → ${toEntity || "Unknown"}`;
  return buildExpenseAccountingCounterpartyLabel(entry);
}

function normalizeExpenseAccountingEntityLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.toLowerCase() === "me") return "Me";
  return normalized;
}

function isPayPalExchangeEntry(entry) {
  return entry?.source === "paypal" && (
    entry.direction === "exchange" ||
    String(entry.operationType || entry.operation_type || "").trim().toLowerCase() === "exchange" ||
    entry.entryKind === "exchange"
  );
}

function isUnknownPayPalCounterparty(entry) {
  if (entry?.source !== "paypal" || isPayPalExchangeEntry(entry) || entry.entryKind === "fee") return false;
  if (getReadablePayPalCounterpartyName(entry)) return false;
  const flowValues = [
    entry.displayFromTo,
    entry.fromEntity,
    entry.from_entity,
    entry.toEntity,
    entry.to_entity,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  if (!flowValues.length) return true;
  return flowValues.some((value) => (
    value.includes("counterparty unavailable") ||
    value.includes("контрагент не определен") ||
    value.includes("получатель не распознан") ||
    isTechnicalPayPalCounterpartyValue(value)
  ));
}

function getReadablePayPalCounterpartyName(entry) {
  if (entry?.source !== "paypal") return "";
  return [
    entry.counterpartyName,
    entry.counterpartyEmail,
    entry.payeeName,
    entry.payeeEmail,
    entry.merchantName,
    entry.payerName,
    entry.payerEmail,
  ].map((value) => String(value || "").trim())
    .find((value) => value && !/counterparty unavailable|контрагент не определен|получатель не распознан/i.test(value) && !isTechnicalPayPalCounterpartyValue(value)) || "";
}

function isTechnicalPayPalCounterpartyValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  const parts = normalized.split(/[→|]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts.some((part) => isTechnicalPayPalCounterpartyValue(part))) return true;
  if (/\b(invoice|event|external id|exchange group|raw)\b/.test(normalized)) return true;
  if (/^[:\w!\\-]{10,}$/.test(normalized) && /[0-9_!:\\-]/.test(normalized)) return true;
  if (/\b[0-9a-z]{10,}_[0-9a-z_]+\b/i.test(normalized)) return true;
  return false;
}

function buildExpenseAccountingOperationTypeLabel(entry) {
  const value = String(entry.operationType || entry.operation_type || "").trim().toLowerCase();
  if (value === "service_in") return "service_in";
  if (value === "payout") return "payout";
  if (value === "exchange") {
    const leg = String(entry.exchangeLeg || "").trim().toLowerCase();
    return leg ? `exchange (${leg})` : "exchange";
  }
  if (value === "fee") return "fee";
  return "";
}

function buildExpenseAccountingCounterpartyLabel(entry) {
  const explicit = String(entry.counterpartyLabel || "").trim();
  if (explicit) return explicit;
  const legacy = String(entry.counterparty || entry.organization || "").trim();
  if (legacy) {
    return `${entry.direction === "income" ? "От" : "Кому"}: ${legacy}`;
  }
  return "Контрагент не определен";
}

function buildExpenseAccountingCounterpartyDetails(entry) {
  return buildExpenseAccountingTechnicalDetails(entry);
}

function buildExpenseAccountingTechnicalDetails(entry) {
  const parts = [
    entry.operationType || entry.operation_type ? `operation: ${entry.operationType || entry.operation_type}` : "",
    entry.externalId || entry.external_id ? `external id: ${entry.externalId || entry.external_id}` : "",
    entry.exchangeGroupId || entry.exchange_group_id ? `exchange group: ${entry.exchangeGroupId || entry.exchange_group_id}` : "",
    entry.counterpartyName ? `name: ${entry.counterpartyName}` : "",
    entry.counterpartyEmail ? `email: ${entry.counterpartyEmail}` : "",
    entry.payerId ? `payer id: ${entry.payerId}` : "",
    entry.referenceNumber ? `reference: ${entry.referenceNumber}` : "",
    entry.payeeName && entry.payeeName !== entry.counterpartyName ? `payee: ${entry.payeeName}` : "",
    entry.payeeEmail && entry.payeeEmail !== entry.counterpartyEmail ? `payee email: ${entry.payeeEmail}` : "",
    entry.merchantName && entry.merchantName !== entry.counterpartyName ? `merchant: ${entry.merchantName}` : "",
    entry.transactionSubject ? `subject: ${entry.transactionSubject}` : "",
    entry.counterIban ? `iban: ${entry.counterIban}` : "",
    entry.counterEdrpou ? `edrpou: ${entry.counterEdrpou}` : "",
    entry.mcc ? `mcc: ${entry.mcc}` : "",
    entry.description ? `details: ${entry.description}` : "",
    entry.rawMetadata ? `raw: ${entry.rawMetadata}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function buildExpenseAccountingManualCounterpartyNode(entry) {
  const wrap = document.createElement("div");
  wrap.className = "expense-counterparty-manual";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "finance-input expense-counterparty-manual-input";
  input.placeholder = "Имя или компания";
  input.value = String(entry.manualCounterpartyDraft || "").trim();
  input.addEventListener("input", (event) => {
    entry.manualCounterpartyDraft = event.target.value;
  });
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary expense-counterparty-manual-button";
  button.textContent = "Указать вручную";
  button.addEventListener("click", () => {
    const saved = savePayPalCounterpartyOverride(entry, input.value);
    if (!saved) {
      setExpenseAccountingStatus("Введите имя или компанию получателя PayPal.", true);
      renderTabs();
      return;
    }
    setExpenseAccountingStatus("Получатель PayPal сохранён локально и будет применён при следующем импорте в этом браузере.", false);
    renderTabs();
  });
  wrap.append(input, button);
  return wrap;
}

function getPayPalCounterpartyOverrideKey(entry) {
  if (entry?.source !== "paypal") return "";
  const id = String(entry.sourceTransactionId || entry.externalId || entry.external_id || "").trim();
  return id ? `paypal:${id}` : "";
}

function loadPayPalCounterpartyOverrides() {
  try {
    const raw = localStorage.getItem(PAYPAL_COUNTERPARTY_OVERRIDES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savePayPalCounterpartyOverride(entry, value) {
  const readable = String(value || "").trim();
  const key = getPayPalCounterpartyOverrideKey(entry);
  if (!key || !readable) return false;
  const overrides = loadPayPalCounterpartyOverrides();
  overrides[key] = {
    name: readable,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(PAYPAL_COUNTERPARTY_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  applyPayPalCounterpartyOverride(entry, overrides);
  return true;
}

function applyPayPalCounterpartyOverride(entry, overrides = loadPayPalCounterpartyOverrides()) {
  const key = getPayPalCounterpartyOverrideKey(entry);
  const readable = String(overrides?.[key]?.name || "").trim();
  if (!key || !readable) return entry;
  entry.counterpartyName = readable;
  entry.counterpartyEmail = "";
  entry.counterpartyLabel = `${entry.direction === "income" ? "От" : "Кому"}: ${readable}`;
  if (entry.direction === "income") {
    entry.fromEntity = readable;
    entry.from_entity = readable;
    entry.toEntity = "me";
    entry.to_entity = "me";
    entry.displayFromTo = `${readable} → Me`;
  } else {
    entry.fromEntity = "me";
    entry.from_entity = "me";
    entry.toEntity = readable;
    entry.to_entity = readable;
    entry.displayFromTo = `Me → ${readable}`;
  }
  entry.manualCounterpartyOverride = true;
  entry.manualCounterpartyComment = `PayPal counterparty override: ${readable}`;
  return entry;
}
function normalizeReceivedEntryType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  if (MANUAL_RECEIVED_ENTRY_TYPES.includes(normalized)) return normalized;
  if (/ezo\s*fact|ezofact/.test(normalized)) return "ezofact";
  if (/exchange|обмен|crypto|крипт|p2p|binance/.test(normalized)) return "exchange_in";
  return DEFAULT_MANUAL_RECEIVED_ENTRY_TYPE;
}

function mapReceivedTypeToAccountingCategory(value) {
  return normalizeReceivedEntryType(value) === "exchange_in" ? "exchange" : "serviceIncome";
}

function buildLocalTodayIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function parseExpenseScreenshotFiles(files) {
  if (!files.length) {
    setExpenseAccountingStatus("Выберите один или несколько скриншотов.", true);
    renderTabs();
    return;
  }
  state.expenseAccounting.loading = true;
  setExpenseAccountingStatus("Подготавливаю скриншоты...", false);
  renderTabs();
  let images = [];
  try {
    images = await Promise.all(files.map((file) => prepareExpenseScreenshotImage(file)));
    setExpenseAccountingStatus("Отправляю скриншоты на разбор...", false);
    renderTabs();
    const response = await fetch("./api/expense-screenshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodStart: elements.startDate.value,
        periodEnd: elements.endDate.value,
        channels: getManualFinanceChannels(),
        categories: MANUAL_EXPENSE_ACCOUNTING_CATEGORIES,
        images
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Разбор скриншотов не удался (${response.status}).`);
    }
    const entries = (payload.entries || []).map((entry, index) => normalizeExpenseAccountingEntry(entry, index));
    const needsBrowserOcr = payload.source === "browser-ocr-required" || (!entries.length && (payload.warnings || []).some((warning) => /browser OCR/i.test(String(warning))));
    if (needsBrowserOcr) {
      const fallback = await parseExpenseScreenshotsWithBrowserOcr(images);
      state.expenseAccounting.entries = fallback.entries;
      state.expenseAccounting.paypalSummary = null;
      state.expenseAccounting.wiseSummary = null;
      state.expenseAccounting.yoomoneySummary = null;
      state.expenseAccounting.monobankSummary = null;
      state.expenseAccounting.privatBankSummary = null;
      state.expenseAccounting.tdBankSummary = null;
      state.expenseAccounting.warnings = [...(payload.warnings || []), ...fallback.warnings];
    } else {
      state.expenseAccounting.entries = entries;
      state.expenseAccounting.paypalSummary = null;
      state.expenseAccounting.wiseSummary = null;
      state.expenseAccounting.yoomoneySummary = null;
      state.expenseAccounting.monobankSummary = null;
      state.expenseAccounting.privatBankSummary = null;
      state.expenseAccounting.tdBankSummary = null;
      state.expenseAccounting.warnings = payload.warnings || [];
    }
    state.expenseAccounting.resultTab = getExpenseAccountingDirectionCounts().spent ? "spent" : "received";
    const counts = getExpenseAccountingDirectionCounts();
    setExpenseAccountingStatus(
      state.expenseAccounting.entries.length
        ? `Распознано строк: ${state.expenseAccounting.entries.length} (Spent: ${counts.spent}, Received: ${counts.received}). Проверьте значения перед внесением.`
        : "Скриншоты разобраны, но расходов не найдено.",
      false
    );
  } catch (error) {
    try {
      if (!images.length) images = await Promise.all(files.map((file) => prepareExpenseScreenshotImage(file)));
      const fallback = await parseExpenseScreenshotsWithBrowserOcr(images);
      state.expenseAccounting.entries = fallback.entries;
      state.expenseAccounting.paypalSummary = null;
      state.expenseAccounting.wiseSummary = null;
      state.expenseAccounting.yoomoneySummary = null;
      state.expenseAccounting.monobankSummary = null;
      state.expenseAccounting.privatBankSummary = null;
      state.expenseAccounting.tdBankSummary = null;
      state.expenseAccounting.warnings = [String(error.message || error), ...fallback.warnings];
      state.expenseAccounting.resultTab = getExpenseAccountingDirectionCounts().spent ? "spent" : "received";
      const counts = getExpenseAccountingDirectionCounts();
      setExpenseAccountingStatus(
        state.expenseAccounting.entries.length
          ? `Серверный разбор недоступен, использован OCR в браузере. Найдено строк: ${state.expenseAccounting.entries.length} (Spent: ${counts.spent}, Received: ${counts.received}).`
          : "OCR в браузере завершен, но строки расходов не найдены.",
        !state.expenseAccounting.entries.length
      );
    } catch (fallbackError) {
      setExpenseAccountingStatus(fallbackError.message || "Не удалось разобрать скриншоты.", true);
    }
  } finally {
    state.expenseAccounting.loading = false;
    renderTabs();
  }
}

async function parseExpenseScreenshotsWithBrowserOcr(images) {
  if (!window.Tesseract?.recognize) {
    throw new Error("OCR в браузере недоступен: Tesseract.js не загрузился.");
  }
  const entries = [];
  const warnings = [];
  for (const [imageIndex, image] of images.entries()) {
    setExpenseAccountingStatus(`OCR в браузере: скриншот ${imageIndex + 1} из ${images.length}...`, false);
    renderTabs();
    const result = await window.Tesseract.recognize(image.dataUrl, "eng+rus+ukr", { logger: () => {} });
    const parsed = parseExpenseOcrText(result?.data?.text || "", imageIndex, image.uploadedAtDate);
    entries.push(...parsed.entries);
    warnings.push(...parsed.warnings);
  }
  if (!entries.length) warnings.push("Browser OCR did not find expense-like rows.");
  return { entries, warnings };
}

async function loadPayPalExpenseStatement() {
  const startDate = normalizeIncomingSheetDateValue(elements.startDate.value);
  const endDate = normalizeIncomingSheetDateValue(elements.endDate.value);
  if (!startDate || !endDate) {
    setExpenseAccountingStatus("Выберите период для PayPal-выписки.", true);
    renderTabs();
    return;
  }
  state.expenseAccounting.paypalLoading = true;
  setExpenseAccountingStatus("Запрашиваю PayPal-выписку за выбранный период...", false);
  renderTabs();
  try {
    const response = await fetch("./api/paypal-transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `PayPal вернул ошибку (${response.status}).`);
    }
    const entries = (payload.entries || []).map((entry, index) => normalizeExpenseAccountingEntry(entry, index));
    state.expenseAccounting.entries = [
      ...state.expenseAccounting.entries.filter((entry) => entry.source !== "paypal"),
      ...entries
    ];
    state.expenseAccounting.paypalSummary = hasProviderSummaryData(payload.summary)
      ? payload.summary
      : buildProviderExpenseSummary(entries);
    state.expenseAccounting.warnings = payload.warnings || [];
    state.expenseAccounting.resultTab = getExpenseAccountingDirectionCounts().spent ? "spent" : "received";
    setExpenseAccountingStatus(
      entries.length
        ? `PayPal-выписка загружена: ${entries.length} строк из ${payload.transactionCount || entries.length} транзакций. Проверьте категории перед внесением.`
        : "PayPal-выписка загружена, но расходных строк за период не найдено.",
      false
    );
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось загрузить PayPal-выписку.", true);
  } finally {
    state.expenseAccounting.paypalLoading = false;
    renderTabs();
  }
}

async function loadWiseExpenseStatement() {
  const startDate = normalizeIncomingSheetDateValue(elements.startDate.value);
  const endDate = normalizeIncomingSheetDateValue(elements.endDate.value);
  if (!startDate || !endDate) {
    setExpenseAccountingStatus("Выберите период для Wise-выписки.", true);
    renderTabs();
    return;
  }
  state.expenseAccounting.wiseLoading = true;
  setExpenseAccountingStatus("Запрашиваю Wise-выписку за выбранный период...", false);
  renderTabs();
  try {
    const response = await fetch("./api/wise-transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Wise вернул ошибку (${response.status}).`);
    }
    const entries = (payload.entries || []).map((entry, index) => normalizeExpenseAccountingEntry(entry, index));
    state.expenseAccounting.entries = [
      ...state.expenseAccounting.entries.filter((entry) => entry.source !== "wise"),
      ...entries
    ];
    state.expenseAccounting.wiseSummary = hasProviderSummaryData(payload.summary)
      ? payload.summary
      : buildProviderExpenseSummary(entries);
    state.expenseAccounting.warnings = payload.warnings || [];
    state.expenseAccounting.resultTab = getExpenseAccountingDirectionCounts().spent ? "spent" : "received";
    setExpenseAccountingStatus(
      entries.length
        ? `Wise-выписка загружена: ${entries.length} строк из ${payload.transactionCount || entries.length} транзакций. Проверьте категории перед внесением.`
        : "Wise-выписка загружена, но строк за период не найдено.",
      false
    );
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось загрузить Wise-выписку.", true);
  } finally {
    state.expenseAccounting.wiseLoading = false;
    renderTabs();
  }
}

async function loadYooMoneyExpenseStatement() {
  const startDate = normalizeIncomingSheetDateValue(elements.startDate.value);
  const endDate = normalizeIncomingSheetDateValue(elements.endDate.value);
  if (!startDate || !endDate) {
    setExpenseAccountingStatus("Выберите период для ЮMoney-выписки.", true);
    renderTabs();
    return;
  }
  state.expenseAccounting.yoomoneyLoading = true;
  setExpenseAccountingStatus("Запрашиваю ЮMoney-выписку за выбранный период...", false);
  renderTabs();
  try {
    const response = await fetch("./api/yoomoney-transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `ЮMoney вернул ошибку (${response.status}).`);
    }
    const entries = (payload.entries || []).map((entry, index) => normalizeExpenseAccountingEntry(entry, index));
    state.expenseAccounting.entries = [
      ...state.expenseAccounting.entries.filter((entry) => entry.source !== "yoomoney"),
      ...entries
    ];
    state.expenseAccounting.yoomoneySummary = hasProviderSummaryData(payload.summary)
      ? payload.summary
      : buildProviderExpenseSummary(entries);
    state.expenseAccounting.warnings = payload.warnings || [];
    state.expenseAccounting.resultTab = getExpenseAccountingDirectionCounts().spent ? "spent" : "received";
    setExpenseAccountingStatus(
      entries.length
        ? `ЮMoney-выписка загружена: ${entries.length} строк из ${payload.transactionCount || entries.length} операций. Проверьте категории перед внесением.`
        : "ЮMoney-выписка загружена, но строк за период не найдено.",
      false
    );
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось загрузить ЮMoney-выписку.", true);
  } finally {
    state.expenseAccounting.yoomoneyLoading = false;
    renderTabs();
  }
}

async function loadMonobankExpenseStatement() {
  await loadBankExpenseStatement({
    provider: "monobank",
    apiPath: "./api/monobank-transactions",
    loadingKey: "monobankLoading",
    summaryKey: "monobankSummary",
    title: "Monobank",
    progressMessage: "Запрашиваю Monobank-выписку за выбранный период...",
    emptyMessage: "Monobank-выписка загружена, но строк за период не найдено.",
    buildRequestPayload: () => buildMonobankRequestPayload()
  });
}

async function loadPrivatBankExpenseStatement() {
  await loadBankExpenseStatement({
    provider: "privatbank",
    apiPath: "./api/privatbank-transactions",
    loadingKey: "privatBankLoading",
    summaryKey: "privatBankSummary",
    title: "PrivatBank",
    progressMessage: "Запрашиваю PrivatBank-выписку за выбранный период...",
    emptyMessage: "PrivatBank-выписка загружена, но строк за период не найдено."
  });
}

async function loadBankExpenseStatement(config) {
  const startDate = normalizeIncomingSheetDateValue(elements.startDate.value);
  const endDate = normalizeIncomingSheetDateValue(elements.endDate.value);
  if (!startDate || !endDate) {
    setExpenseAccountingStatus(`Выберите период для ${config.title}-выписки.`, true);
    renderTabs();
    return;
  }
  state.expenseAccounting[config.loadingKey] = true;
  setExpenseAccountingStatus(config.progressMessage, false);
  renderTabs();
  try {
    const extraPayload = typeof config.buildRequestPayload === "function" ? (config.buildRequestPayload() || {}) : {};
    const response = await fetch(config.apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, ...extraPayload })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `${config.title} вернул ошибку (${response.status}).`);
    }
    const entries = (payload.entries || []).map((entry, index) => normalizeExpenseAccountingEntry(entry, index));
    state.expenseAccounting.entries = [
      ...state.expenseAccounting.entries.filter((entry) => entry.source !== config.provider),
      ...entries
    ];
    state.expenseAccounting[config.summaryKey] = hasProviderSummaryData(payload.summary)
      ? payload.summary
      : buildProviderExpenseSummary(entries);
    state.expenseAccounting.warnings = payload.warnings || [];
    state.expenseAccounting.resultTab = getExpenseAccountingDirectionCounts().spent ? "spent" : "received";
    setExpenseAccountingStatus(
      entries.length
        ? `${config.title}-выписка загружена: ${entries.length} строк из ${payload.transactionCount || entries.length} операций. Проверьте категории перед внесением.`
        : config.emptyMessage,
      false
    );
  } catch (error) {
    setExpenseAccountingStatus(error.message || `Не удалось загрузить ${config.title}-выписку.`, true);
  } finally {
    state.expenseAccounting[config.loadingKey] = false;
    renderTabs();
  }
}

function toggleMonobankConnectPanel() {
  state.expenseAccounting.monobankConnectOpen = !state.expenseAccounting.monobankConnectOpen;
  renderTabs();
}

function buildMonobankRequestPayload() {
  const payload = {};
  const token = String(state.expenseAccounting.monobankToken || "").trim();
  const accountId = String(state.expenseAccounting.monobankSelectedAccountId || "").trim();
  if (token) payload.apiToken = token;
  if (accountId) payload.accountId = accountId;
  return payload;
}

async function validateMonobankConnection() {
  const token = String(state.expenseAccounting.monobankToken || "").trim();
  if (!token) {
    state.expenseAccounting.monobankValidationMessage = "Вставьте Monobank personal token перед проверкой.";
    state.expenseAccounting.monobankValidationError = true;
    renderTabs();
    return;
  }
  state.expenseAccounting.monobankValidating = true;
  state.expenseAccounting.monobankValidationMessage = "Проверяю токен Monobank...";
  state.expenseAccounting.monobankValidationError = false;
  renderTabs();
  try {
    const response = await fetch("./api/monobank-transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "validate",
        apiToken: token
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Monobank вернул ошибку (${response.status}).`);
    }
    const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    const selected = String(state.expenseAccounting.monobankSelectedAccountId || "").trim();
    if (selected && !accounts.some((account) => String(account.id || "") === selected)) {
      state.expenseAccounting.monobankSelectedAccountId = "";
    }
    state.expenseAccounting.monobankAccounts = accounts;
    state.expenseAccounting.monobankClientName = String(payload.client?.name || "").trim();
    state.expenseAccounting.monobankMode = String(payload.mode || "manual").trim();
    state.expenseAccounting.monobankValidationMessage = accounts.length
      ? `Токен подтверждён. Найдено счетов: ${accounts.length}. Можно подтягивать выписку за период до 31 дня.`
      : "Токен подтверждён, но доступные счета не найдены.";
    state.expenseAccounting.monobankValidationError = false;
    setExpenseAccountingStatus(state.expenseAccounting.monobankValidationMessage, false);
  } catch (error) {
    state.expenseAccounting.monobankAccounts = [];
    state.expenseAccounting.monobankClientName = "";
    state.expenseAccounting.monobankValidationMessage = error.message || "Не удалось проверить Monobank token.";
    state.expenseAccounting.monobankValidationError = true;
    setExpenseAccountingStatus(state.expenseAccounting.monobankValidationMessage, true);
  } finally {
    state.expenseAccounting.monobankValidating = false;
    renderTabs();
  }
}

async function loadTdBankExpenseStatementFromClipboard() {
  state.expenseAccounting.tdBankLoading = true;
  setExpenseAccountingStatus("Читаю TD Bank JSON из буфера обмена...", false);
  renderTabs();
  try {
    const raw = await readTdBankPayloadText();
    const payload = parseTdBankClipboardPayload(raw);
    const entries = normalizeTdBankClipboardEntries(payload);
    state.expenseAccounting.entries = [
      ...state.expenseAccounting.entries.filter((entry) => entry.source !== "tdbank"),
      ...entries
    ];
    state.expenseAccounting.tdBankSummary = buildProviderExpenseSummary(entries);
    state.expenseAccounting.warnings = [];
    state.expenseAccounting.resultTab = getExpenseAccountingDirectionCounts().spent ? "spent" : "received";
    setExpenseAccountingStatus(
      entries.length
        ? `TD Bank импортирован: ${entries.length} строк. Проверьте категории перед внесением.`
        : "TD Bank импортирован, но строки за выбранный период не найдены.",
      false
    );
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось импортировать TD Bank из буфера.", true);
  } finally {
    state.expenseAccounting.tdBankLoading = false;
    renderTabs();
  }
}

function parseTdBankClipboardPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    throw new Error("Буфер обмена пуст. Сначала запустите TD Bank bookmarklet на странице EasyWeb activity.");
  }
  const firstCharCode = text.charCodeAt(0);
  if (firstCharCode !== 123 && firstCharCode !== 91) {
    throw new Error("В буфере обмена не TD Bank JSON. Сначала нажмите ‘Скопировать TD bookmarklet’, запустите его на странице TD EasyWeb Activity, затем вернитесь и нажмите ‘Импортировать TD из буфера’.");
  }

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("В буфере обмена повреждён TD Bank JSON. Скопируйте payload заново через TD Bank bookmarklet.");
  }

  if (String(payload?.source?.provider || "").trim() !== "tdbank") {
    throw new Error("В буфере нет TD Bank payload. Скопируйте его bookmarklet-ом из TD EasyWeb.");
  }
  return payload;
}

async function readTdBankPayloadText() {
  let clipboardError = null;
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      clipboardError = error;
    }
  }
  const prompted = typeof window.prompt === "function"
    ? window.prompt("Вставьте TD Bank JSON из буфера обмена", "")
    : "";
  if (typeof prompted === "string" && prompted.trim()) {
    return prompted.trim();
  }
  if (clipboardError) {
    throw new Error(`Не удалось прочитать буфер обмена. Вставьте TD Bank JSON вручную. ${clipboardError.message || clipboardError}`);
  }
  throw new Error("Буфер обмена недоступен. Вставьте TD Bank JSON вручную.");
}

async function refreshExpenseFinancialAnalysis() {
  state.expenseAccounting.loading = true;
  setExpenseAccountingStatus("Обновляю анализ финансов...", false);
  renderTabs();
  try {
    if (state.googleAuth.accessToken) {
      await connectGoogle(false);
    } else {
      await loadDashboardData();
      setExpenseAccountingStatus("Анализ финансов обновлён. Активной Google-сессии не было, обновлены серверные данные.", false);
    }
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось обновить анализ финансов.", true);
  } finally {
    state.expenseAccounting.loading = false;
    renderTabs();
  }
}

function normalizeTdBankClipboardEntries(payload) {
  const requestedStart = normalizeIncomingSheetDateValue(payload?.source?.requestedStartDate || payload?.startDate || elements.startDate.value);
  const requestedEnd = normalizeIncomingSheetDateValue(payload?.source?.requestedEndDate || payload?.endDate || elements.endDate.value);
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((entry, index) => normalizeExpenseAccountingEntry({
      date: entry.occurredAt,
      channel: "БАНК КАНАДА cad",
      direction: entry.direction,
      localAmount: entry.amount,
      currency: entry.currency || "CAD",
      usdAmount: null,
      suggestedCategory: entry.direction === "income" ? "serviceIncome" : "business",
      organization: compactTdBankDescription(entry),
      confidence: 0.95,
      source: "tdbank",
      sourceTransactionId: String(entry.providerTransactionId || `${entry.accountId || "tdbank"}-${entry.occurredAt || index}`),
    }, index))
    .filter((entry) => entry.date && (!requestedStart || entry.date >= requestedStart) && (!requestedEnd || entry.date <= requestedEnd));
}

function compactTdBankDescription(entry) {
  return [
    String(entry?.name || "").trim(),
    entry?.accountName ? `account ${entry.accountName}` : "",
    entry?.runningBalance ? `balance ${entry.runningBalance} ${entry.runningBalanceCurrency || entry.currency || "CAD"}` : ""
  ].filter(Boolean).join(" | ").slice(0, 240);
}

function parseExpenseOcrText(text, sourceImageIndex = 0, uploadedAtDate = "") {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const entries = [];
  const warnings = [];
  const fallbackDate = normalizeIncomingSheetDateValue(uploadedAtDate);
  let currentDate = "";
  lines.forEach((line) => {
    const date = extractExpenseOcrDate(line);
    if (date) currentDate = date;
    const amountInfo = extractExpenseOcrAmount(line);
    if (!amountInfo) return;
    entries.push(normalizeExpenseAccountingEntry({
      date: currentDate || fallbackDate,
      dateSource: currentDate ? "screenshot" : "upload_fallback",
      uploadedAtDate: fallbackDate,
      channel: inferExpenseOcrChannel(line),
      direction: inferExpenseOcrDirection(line),
      localAmount: amountInfo.amount,
      currency: amountInfo.currency,
      usdAmount: null,
      suggestedCategory: inferExpenseOcrCategory(line),
      organization: cleanupExpenseOcrOrganization(line),
      counterparty: cleanupExpenseOcrOrganization(line),
      confidence: 0.45,
      sourceImageIndex
    }, entries.length));
  });
  if (!entries.length && lines.length) warnings.push(`OCR text had ${lines.length} lines, but no amount rows were recognized.`);
  return { entries, warnings };
}

function extractExpenseOcrDate(line) {
  const raw = String(line || "");
  const iso = raw.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const dotted = raw.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}))?\b/);
  if (!dotted) return "";
  const year = dotted[3] || String(elements.endDate.value || "").slice(0, 4);
  return year ? `${year}-${String(dotted[2]).padStart(2, "0")}-${String(dotted[1]).padStart(2, "0")}` : "";
}

function extractExpenseOcrAmount(line) {
  const normalizedLine = String(line || "").replace(/\s+/g, " ").trim();
  const matches = Array.from(normalizedLine.matchAll(/([+-]?\s?\d[\d\s.,]*)(?:\s*)(uah|грн|rub|руб|usd|дол|\$|eur|евро|cad|c\$)?/ig));
  if (!matches.length) return null;
  const filtered = matches.filter((match) => {
    const around = normalizedLine.slice(Math.max(0, match.index - 20), Math.min(normalizedLine.length, match.index + match[0].length + 20)).toLowerCase();
    return !/balance|available|остат|комисс|fee|итог|total/.test(around);
  });
  const candidates = filtered.length ? filtered : matches;
  const chosen = candidates.find((match) => /[+-]/.test(match[1])) || candidates[candidates.length - 1];
  const amount = Math.abs(parseLooseNumber(chosen?.[1]));
  if (!amount) return null;
  return { amount, currency: normalizeExpenseOcrCurrency(chosen?.[2] || normalizedLine) };
}

function normalizeExpenseOcrCurrency(value) {
  const raw = String(value || "").toLowerCase();
  if (/uah|грн/.test(raw)) return "UAH";
  if (/rub|руб/.test(raw)) return "RUB";
  if (/eur|евро/.test(raw)) return "EUR";
  if (/cad|c\$|канада/.test(raw)) return "CAD";
  if (/usd|дол|\$/.test(raw)) return "USD";
  return inferManualFinanceChannelCurrency(getManualFinanceChannels()[0]);
}

function inferExpenseOcrDirection(line) {
  const raw = String(line || "").toLowerCase();
  return /[+]\s?\d|зачисл|поступ|income|received|приход/.test(raw) ? "income" : "expense";
}

function inferExpenseOcrChannel(line) {
  const normalized = normalizeLookupText(line);
  const direct = getManualFinanceChannels().find((channel) => normalized.includes(normalizeLookupText(channel)));
  if (direct) return direct;
  const currency = normalizeExpenseOcrCurrency(line);
  return getManualFinanceChannels().find((channel) => inferManualFinanceChannelCurrency(channel) === currency) || getManualFinanceChannels()[0];
}

function inferExpenseOcrCategory(line) {
  const normalized = normalizeLookupText(line);
  if (/курс|обуч|учеб|school|course|study/.test(normalized)) return "study";
  if (/еда|food|продукт|кафе|coffee|restaurant|маркет/.test(normalized)) return "food";
  if (/кварт|аренд|rent|flat|house|дом/.test(normalized)) return "flat";
  if (/такси|hotel|flight|travel|поезд|билет/.test(normalized)) return "travel";
  if (/кино|бар|game|fun|развлеч/.test(normalized)) return "fun";
  return "business";
}

function cleanupExpenseOcrOrganization(line) {
  return String(line || "")
    .replace(/\b(20\d{2}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]20\d{2})?)\b/g, "")
    .replace(/[+-]?\s?\d[\d\s.,]*(?:\s*)(uah|грн|rub|руб|usd|дол|\$|eur|евро|cad|c\$)?/ig, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function prepareExpenseScreenshotImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type || "")) {
      reject(new Error(`Файл ${file.name || ""} должен быть PNG, JPEG или WEBP.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name || "скриншот"}.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`Не удалось открыть ${file.name || "скриншот"}.`));
      image.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.width || maxSide, image.height || maxSide));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((image.width || maxSide) * scale));
        canvas.height = Math.max(1, Math.round((image.height || maxSide) * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({
          name: file.name || "screenshot",
          dataUrl: canvas.toDataURL("image/jpeg", 0.82),
          uploadedAtDate: buildLocalTodayIsoDate()
        });
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function normalizeExpenseAccountingEntry(entry, index = 0) {
  const normalizedDate = normalizeIncomingSheetDateValue(entry.date);
  const fallbackDate = normalizeIncomingSheetDateValue(entry.uploadedAtDate) || elements.endDate.value;
  const direction = entry.direction === "income" || entry.direction === "exchange" ? entry.direction : "expense";
  const receivedType = direction === "income" ? normalizeReceivedEntryType(entry.receivedType || entry.suggestedCategory || entry.category) : "";
  const normalized = {
    id: `expense-${Date.now()}-${index}`,
    date: normalizedDate || fallbackDate,
    dateSource: entry.dateSource === "screenshot" || normalizedDate ? "screenshot" : "upload_fallback",
    channel: canonicalManualFinanceChannel(entry.channel || "") || getManualFinanceChannels()[0],
    direction,
    localAmount: Math.abs(parseLooseNumber(entry.localAmount)),
    currency: String(entry.currency || inferManualFinanceChannelCurrency(entry.channel)).trim().toUpperCase(),
    usdAmount: parseLooseNumber(entry.usdAmount),
    amountClientPaid: parseLooseNumber(entry.amountClientPaid ?? entry.amount_client_paid ?? entry.localAmount),
    amount_client_paid: parseLooseNumber(entry.amountClientPaid ?? entry.amount_client_paid ?? entry.localAmount),
    amountNetReceived: parseLooseNumber(entry.amountNetReceived ?? entry.amount_net_received ?? entry.localAmount),
    amount_net_received: parseLooseNumber(entry.amountNetReceived ?? entry.amount_net_received ?? entry.localAmount),
    category: direction === "income"
      ? mapReceivedTypeToAccountingCategory(receivedType)
      : (normalizeManualExpenseCategory(entry.suggestedCategory || entry.category) || "business"),
    receivedType,
    organization: String(entry.organization || entry.counterparty || "").trim(),
    counterparty: String(entry.counterparty || entry.organization || "").trim(),
    counterpartyName: String(entry.counterpartyName || "").trim(),
    counterpartyEmail: String(entry.counterpartyEmail || "").trim(),
    counterpartyType: String(entry.counterpartyType || "").trim(),
    counterpartyRole: String(entry.counterpartyRole || "").trim(),
    counterpartyLabel: String(entry.counterpartyLabel || "").trim(),
    fromEntity: String(entry.fromEntity || entry.from_entity || "").trim(),
    from_entity: String(entry.fromEntity || entry.from_entity || "").trim(),
    toEntity: String(entry.toEntity || entry.to_entity || "").trim(),
    to_entity: String(entry.toEntity || entry.to_entity || "").trim(),
    operationType: String(entry.operationType || entry.operation_type || "").trim(),
    operation_type: String(entry.operationType || entry.operation_type || "").trim(),
    externalId: String(entry.externalId || entry.external_id || "").trim(),
    external_id: String(entry.externalId || entry.external_id || "").trim(),
    exchangeGroupId: String(entry.exchangeGroupId || entry.exchange_group_id || "").trim(),
    exchange_group_id: String(entry.exchangeGroupId || entry.exchange_group_id || "").trim(),
    exchangeLeg: String(entry.exchangeLeg || "").trim(),
    displayFromTo: String(entry.displayFromTo || "").trim(),
    rawMetadata: String(entry.rawMetadata || "").trim(),
    manualCounterpartyOverride: Boolean(entry.manualCounterpartyOverride),
    manualCounterpartyComment: String(entry.manualCounterpartyComment || "").trim(),
    entryKind: String(entry.entryKind || "").trim(),
    payerName: String(entry.payerName || "").trim(),
    payerEmail: String(entry.payerEmail || "").trim(),
    payerId: String(entry.payerId || "").trim(),
    payeeName: String(entry.payeeName || "").trim(),
    payeeEmail: String(entry.payeeEmail || "").trim(),
    merchantName: String(entry.merchantName || "").trim(),
    transactionSubject: String(entry.transactionSubject || "").trim(),
    description: String(entry.description || "").trim(),
    transactionEventCode: String(entry.transactionEventCode || "").trim(),
    referenceNumber: String(entry.referenceNumber || "").trim(),
    transferType: String(entry.transferType || "").trim(),
    counterIban: String(entry.counterIban || "").trim(),
    counterEdrpou: String(entry.counterEdrpou || "").trim(),
    mcc: String(entry.mcc || "").trim(),
    confidence: Number(entry.confidence || 0),
    sourceImageIndex: Number(entry.sourceImageIndex || 0),
    source: String(entry.source || "").trim(),
    sourceTransactionId: String(entry.sourceTransactionId || "").trim()
  };
  return applyPayPalCounterpartyOverride(normalized);
}

async function saveExpenseAccountingEntries() {
  const entries = state.expenseAccounting.entries.filter((entry) => entry.date && entry.channel && entry.localAmount > 0);
  if (!entries.length) {
    setExpenseAccountingStatus("Нет строк для внесения.", true);
    renderTabs();
    return;
  }
  state.expenseAccounting.loading = true;
  renderTabs();
  try {
    if (!hasConfiguredManualFinanceEndpoint() && hasManualFinanceEndpointConfig()) {
      await ensureGoogleAccess(true);
    }
    if (!hasConfiguredManualFinanceEndpoint()) {
      throw new Error(getManualFinanceUnavailableMessage());
    }
    const response = await saveExpenseAccountingEntriesDirect(entries);
    setExpenseAccountingStatus(`Значения внесены: ${response.rowCount} агрегированных строк. ${response.savedAt || ""}`.trim(), false);
    state.expenseAccounting.entries = [];
    state.expenseAccounting.paypalSummary = null;
    state.expenseAccounting.wiseSummary = null;
    state.expenseAccounting.yoomoneySummary = null;
    state.expenseAccounting.monobankSummary = null;
    state.expenseAccounting.privatBankSummary = null;
    state.expenseAccounting.tdBankSummary = null;
    await loadDashboardData();
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось внести расходы.", true);
  } finally {
    state.expenseAccounting.loading = false;
    renderTabs();
  }
}

async function saveExpenseAccountingEntriesDirect(entries) {
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const existingLedgerParse = titles.has(getManualLedgerSheetName())
    ? parseManualLedgerSheetValues(await getSheetValuesByTitle(getManualLedgerSheetName()))
    : { rows: [], warnings: [] };
  const existingExpenses = titles.has(getManualExpensesSheetName())
    ? parseIncomingExpenseSheetValues(await getSheetValuesByTitle(getManualExpensesSheetName()))
    : [];
  const replacementRows = buildExpenseRowsFromAccountingEntries(entries);
  const ledgerRows = buildLedgerRowsFromAccountingEntries(entries);
  const ledgerSave = normalizeManualLedgerRowsForSave(ledgerRows, existingLedgerParse.rows);
  const dates = replacementRows.map((row) => row.date).filter(Boolean).sort();
  const mergedExpenses = replaceManualRowsForDateRange(existingExpenses, replacementRows, dates[0], dates[dates.length - 1], "date");
  await ensureSheetExists(getManualLedgerSheetName(), getManualFinanceSpreadsheetId());
  await ensureSheetExists(getManualExpensesSheetName(), getManualFinanceSpreadsheetId());
  await overwriteSheetValues(
    getManualLedgerSheetName(),
    buildManualLedgerSheetValues([...(existingLedgerParse.rows || []), ...ledgerSave.rows]),
    getManualFinanceSpreadsheetId()
  );
  await overwriteSheetValues(getManualExpensesSheetName(), buildIncomingExpenseSheetValues(mergedExpenses), getManualFinanceSpreadsheetId());
  return {
    rowCount: replacementRows.length,
    ledgerRowCount: ledgerSave.rows.length,
    warnings: [...existingLedgerParse.warnings, ...ledgerSave.warnings],
    savedAt: new Date().toLocaleString("ru-RU")
  };
}

function buildExpenseRowsFromAccountingEntries(entries) {
  const lookup = new Map();
  entries.forEach((entry) => {
    const category = normalizeManualExpenseCategory(entry.category);
    if (!MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES.includes(category)) return;
    const date = normalizeIncomingSheetDateValue(entry.date);
    const channel = canonicalManualFinanceChannel(entry.channel || "");
    if (!date || !channel) return;
    const key = `${date}|${category}`;
    if (!lookup.has(key)) lookup.set(key, createManualFinanceExpenseRow(date, category));
    const row = lookup.get(key);
    row.amounts[channel] = formatSheetNumber(parseLooseNumber(row.amounts[channel]) + parseLooseNumber(entry.localAmount));
  });
  return Array.from(lookup.values()).sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES.indexOf(left.category) - MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES.indexOf(right.category);
  });
}

function getCurrentAnalyticsManualRows() {
  if (state.aggregatedManualRange?.rows?.length) {
    return state.aggregatedManualRange.rows.map((row) => ({
      channel: row.channel || "",
      now: row.now || "",
      serviceIncome: row.serviceIncome || "",
      business: row.business || "",
      flat: row.flat || "",
      food: row.food || "",
      fun: row.fun || "",
      study: row.study || "",
      travel: row.travel || "",
      total: row.total || "",
      exchange: row.exchange || "",
      exchangeUsd: row.exchangeUsd || "",
      totalUsd: row.totalUsd || "",
      nowUsd: row.nowUsd || "",
    }));
  }
  if (state.manualFinance.data?.moneyRows?.length) {
    return buildAnalyticsManualRowsFromFactMoneyRows(state.manualFinance.data.moneyRows, state.manualFinance.data.transferRows || []);
  }
  const analyticsValues = getAnalyticsMergedValues();
  const sections = splitAnalyticsSections(extractAnalyticsTopTables(analyticsValues));
  const personalSection = (typeof getAnalyticsPersonalSection === "function")
    ? getAnalyticsPersonalSection(sections)
    : sections[0];
  const rows = personalSection?.rows || [];
  const header = rows[0] || [];
  const studyIndex = findHeaderIndexByAliases(header, ["spent for study", "study"]);
  const travelIndex = findHeaderIndexByAliases(header, ["spent for travel", "travel"]);
  const totalIndex = findHeaderIndexByAliases(header, ["затраты-мои", "total"]);
  const exchangeIndex = findHeaderIndexByAliases(header, ["обмен", "exchange"]);
  const exchangeUsdIndex = findHeaderIndexByAliases(header, ["обмен_usd", "exchange_usd"]);
  const totalUsdIndex = findHeaderIndexByAliases(header, ["затраты-мои usd", "total_usd", "total usd"]);
  const nowUsdIndex = findHeaderIndexByAliases(header, ["now_usd", "now usd"]);
  return rows.slice(1).filter((row) => hasAnyValue(row)).map((row) => ({
    channel: row[0] || "",
    now: row[1] || "",
    serviceIncome: row[2] || "",
    business: row[3] || "",
    flat: row[4] || "",
    food: row[5] || "",
    fun: row[6] || "",
    study: studyIndex === -1 ? "" : row[studyIndex] || "",
    travel: travelIndex === -1 ? "" : row[travelIndex] || "",
    total: totalIndex === -1 ? "" : row[totalIndex] || "",
    exchange: exchangeIndex === -1 ? "" : row[exchangeIndex] || "",
    exchangeUsd: exchangeUsdIndex === -1 ? "" : row[exchangeUsdIndex] || "",
    totalUsd: totalUsdIndex === -1 ? "" : row[totalUsdIndex] || "",
    nowUsd: nowUsdIndex === -1 ? "" : row[nowUsdIndex] || "",
  }));
}

function getAnalyticsSectionDisplayTitle(section) {
  if ((typeof isAnalyticsPersonalSection === "function") && isAnalyticsPersonalSection(section)) {
    return "Движение 1";
  }
  if (normalizeCell(section?.title) === normalizeCell("движение 1")) {
    return "Сверка Movement по каналам";
  }
  return String(section?.title || "").trim();
}

function getAnalyticsPersonalSectionRenderRows(section) {
  if (!state.aggregatedManualRange?.rows?.length) return section.rows;
  const rows = getCurrentAnalyticsManualRows();
  const header = typeof getManualFinanceDisplayHeaders === "function"
    ? getManualFinanceDisplayHeaders(MANUAL_FINANCE_HEADERS)
    : (section.rows?.[0] || []);
  return [
    header,
    ...rows.map((row) => [
      row.channel || "",
      row.now || "",
      row.serviceIncome || "",
      row.business || "",
      row.flat || "",
      row.food || "",
      row.fun || "",
      row.study || "",
      row.travel || "",
      row.total || "",
      row.exchange || "",
      row.exchangeUsd || "",
      row.totalUsd || "",
      row.nowUsd || "",
    ])
  ];
}

function getAggregatedManualAnalyticsSections(sourceValues) {
  if (!state.aggregatedManualRange?.rows?.length) return [];
  if (typeof buildFullRangeBasedAnalyticsValuesFromClosedFact !== "function") return [];
  const rebuiltValues = buildFullRangeBasedAnalyticsValuesFromClosedFact(
    Array.isArray(sourceValues) ? sourceValues : (state.data?.tabs?.analytics?.values || []),
    state.data?.tabs?.movement?.values || [],
    state.data?.tabs?.payouts?.values || [],
    state.data?.tabs?.savings?.values || [],
    state.aggregatedManualRange
  );
  return getAnalyticsSections(rebuiltValues);
}

function findAggregatedManualAnalyticsSection(section, aggregateSections = []) {
  const normalizedTitle = normalizeCell(section?.title);
  const isPersonalSection = (typeof isAnalyticsPersonalSection === "function") && isAnalyticsPersonalSection(section);
  return aggregateSections.find((candidate) => {
    if (isPersonalSection && (typeof isAnalyticsPersonalSection === "function") && isAnalyticsPersonalSection(candidate)) {
      return true;
    }
    return normalizeCell(candidate?.title) === normalizedTitle;
  }) || null;
}

function getAnalyticsSectionRenderRows(section, aggregateSections = []) {
  const isPersonalSection = (typeof isAnalyticsPersonalSection === "function") && isAnalyticsPersonalSection(section);
  const aggregateSection = findAggregatedManualAnalyticsSection(section, aggregateSections);
  if (aggregateSection?.rows?.length) return aggregateSection.rows;
  return isPersonalSection ? getAnalyticsPersonalSectionRenderRows(section) : section.rows;
}

function getExpenseOperationsRows() {
  const serverRows = Array.isArray(state.data?.manual?.operations) ? state.data.manual.operations : [];
  const directRows = Array.isArray(state.manualFinance.data?.ledgerRows) ? state.manualFinance.data.ledgerRows : [];
  const sourceRows = serverRows.length ? serverRows : directRows;
  return sourceRows.map((row, index) => ({
    id: String(row.id || row.rawSourceId || row.raw_source_id || `${row.sheetRowNumber || row.date || "row"}-${index}`),
    date: normalizeIncomingSheetDateValue(row.date || ""),
    operation: String(row.operation || "").trim(),
    source: String(row.source || "").trim(),
    displaySource: typeof getManualLedgerDisplaySource === "function"
      ? getManualLedgerDisplaySource(row.source || "")
      : (String(row.source || "").trim() || "unknown"),
    fromChannel: String(row.fromChannel || row.from_channel || "").trim(),
    toChannel: String(row.toChannel || row.to_channel || "").trim(),
    amount: String(row.amount || "").trim(),
    currency: String(row.currency || "").trim(),
    amountUsd: String(row.amountUsd || row.amount_usd || "").trim(),
    category: String(row.category || "").trim(),
    comment: String(row.comment || "").trim(),
    rawSourceId: String(row.rawSourceId || row.raw_source_id || "").trim(),
    transferGroupId: String(row.transferGroupId || row.transfer_group_id || "").trim(),
    sheetRowNumber: Number(row.sheetRowNumber || 0)
  }));
}

function filterExpenseOperationsRows(rows, filters) {
  const startDate = normalizeIncomingSheetDateValue(filters?.startDate || "");
  const endDate = normalizeIncomingSheetDateValue(filters?.endDate || "");
  const sourceFilter = String(filters?.source || "all").trim();
  const operationFilter = String(filters?.operation || "all").trim();
  const fromFilter = String(filters?.fromChannel || "all").trim();
  const toFilter = String(filters?.toChannel || "all").trim();
  return (rows || []).filter((row) => {
    if (startDate && row.date && row.date < startDate) return false;
    if (endDate && row.date && row.date > endDate) return false;
    if (sourceFilter !== "all" && (row.displaySource || "unknown") !== sourceFilter) return false;
    if (operationFilter !== "all" && row.operation !== operationFilter) return false;
    if (fromFilter !== "all" && row.fromChannel !== fromFilter) return false;
    if (toFilter !== "all" && row.toChannel !== toFilter) return false;
    return true;
  });
}

function renderExpenseOperationsBlock() {
  const block = document.createElement("div");
  block.className = "finance-shell";
  const rows = getExpenseOperationsRows();
  const filteredRows = filterExpenseOperationsRows(rows, {
    ...state.expenseAccounting.operationsFilters,
    startDate: elements.startDate.value,
    endDate: elements.endDate.value
  });

  const meta = document.createElement("div");
  meta.className = "finance-meta";
  const sourceName = rows.length
    ? (state.data?.manual?.operations?.length ? "server manual overlay" : (state.manualFinance.data?.ledgerTitle || getManualLedgerSheetName()))
    : (hasConfiguredManualFinanceEndpoint() ? getManualLedgerSheetName() : "read-only");
  meta.innerHTML =
    `<strong>Период:</strong> ${escapeHtml(buildManualFinancePeriodLabel(elements.startDate.value, elements.endDate.value))}` +
    `<div class="config-note">Ledger source: ${escapeHtml(sourceName)}</div>` +
    `<div class="config-note">Rows: ${escapeHtml(String(filteredRows.length))} / ${escapeHtml(String(rows.length))}</div>`;
  block.appendChild(meta);

  block.appendChild(renderExpenseOperationsFilters(rows));

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = hasConfiguredManualFinanceEndpoint()
      ? "Ledger за выбранный период пока не загружен. Обновите диапазон или проверьте Google workbook."
      : "Operations доступны через server overlay или Google OAuth workbook.";
    block.appendChild(empty);
    return block;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap expense-operations-wrap";
  const table = document.createElement("table");
  const body = document.createElement("tbody");
  const header = document.createElement("tr");
  ["date", "operation", "source", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "comment", "actions"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    header.appendChild(th);
  });
  body.appendChild(header);

  filteredRows.forEach((row) => {
    const tr = document.createElement("tr");
    [
      row.date || "—",
      row.operation || "—",
      row.displaySource || "unknown",
      row.fromChannel || "—",
      row.toChannel || "—",
      row.amount || "—",
      row.currency || "—",
      row.amountUsd || "—",
      row.category || "—",
      row.comment || "—"
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    const actionTd = document.createElement("td");
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "ghost";
    editButton.textContent = "Редактировать";
    editButton.disabled = !hasConfiguredManualFinanceEndpoint() || !row.sheetRowNumber;
    editButton.addEventListener("click", () => beginExpenseOperationEdit(row));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost";
    deleteButton.textContent = "Удалить";
    deleteButton.disabled = !hasConfiguredManualFinanceEndpoint() || !row.sheetRowNumber;
    deleteButton.addEventListener("click", async () => {
      await deleteExpenseOperationRow(row);
    });
    actionTd.append(editButton, deleteButton);
    tr.appendChild(actionTd);
    body.appendChild(tr);

    if (state.expenseAccounting.editingSheetRowNumber === row.sheetRowNumber && state.expenseAccounting.operationDraft) {
      body.appendChild(renderExpenseOperationEditorRow(row));
    }
  });
  table.appendChild(body);
  wrap.appendChild(table);
  block.appendChild(wrap);
  return block;
}

function renderExpenseOperationsFilters(rows) {
  const wrap = document.createElement("div");
  wrap.className = "expense-operations-filters";
  const sourceOptions = ["all", "manual", "mcp", "photo", "unknown"];
  const operationOptions = ["all", ...new Set(rows.map((row) => row.operation).filter(Boolean))];
  const fromOptions = ["all", ...new Set(rows.map((row) => row.fromChannel).filter(Boolean))];
  const toOptions = ["all", ...new Set(rows.map((row) => row.toChannel).filter(Boolean))];
  [
    ["source", "source", sourceOptions],
    ["operation", "operation", operationOptions],
    ["fromChannel", "from_channel", fromOptions],
    ["toChannel", "to_channel", toOptions],
  ].forEach(([key, label, options]) => {
    const field = document.createElement("label");
    field.className = "field expense-operations-filter";
    const title = document.createElement("div");
    title.className = "expense-mobile-label";
    title.textContent = label;
    const select = document.createElement("select");
    select.className = "expense-select";
    options.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "all" ? "all" : value;
      option.selected = state.expenseAccounting.operationsFilters[key] === value;
      select.appendChild(option);
    });
    select.addEventListener("change", (event) => {
      state.expenseAccounting.operationsFilters[key] = event.target.value;
      renderTabs();
    });
    field.append(title, select);
    wrap.appendChild(field);
  });
  return wrap;
}

function beginExpenseOperationEdit(row) {
  state.expenseAccounting.editingSheetRowNumber = Number(row.sheetRowNumber || 0);
  state.expenseAccounting.operationDraft = {
    sheetRowNumber: Number(row.sheetRowNumber || 0),
    date: row.date || "",
    operation: row.operation || "",
    fromChannel: row.fromChannel || "",
    toChannel: row.toChannel || "",
    amount: row.amount || "",
    currency: row.currency || "",
    amountUsd: row.amountUsd || "",
    category: row.category || "",
    comment: row.comment || "",
    source: row.source || ""
  };
  renderTabs();
}

function renderExpenseOperationEditorRow(row) {
  const tr = document.createElement("tr");
  tr.className = "expense-operation-editor-row";
  const td = document.createElement("td");
  td.colSpan = 11;
  const grid = document.createElement("div");
  grid.className = "expense-operation-editor-grid";
  [
    ["date", "date"],
    ["operation", "operation"],
    ["fromChannel", "from_channel"],
    ["toChannel", "to_channel"],
    ["amount", "amount"],
    ["currency", "currency"],
    ["amountUsd", "amount_usd"],
    ["category", "category"],
    ["comment", "comment"],
    ["source", "source"],
  ].forEach(([key, label]) => {
    const field = document.createElement("label");
    field.className = "field";
    const title = document.createElement("div");
    title.className = "expense-mobile-label";
    title.textContent = label;
    let input;
    if (key === "source") {
      input = document.createElement("select");
      input.className = "expense-select";
      ["manual", "mcp", "photo"].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = state.expenseAccounting.operationDraft?.[key] === value;
        input.appendChild(option);
      });
    } else if (key === "operation") {
      input = document.createElement("select");
      input.className = "expense-select";
      ["income", "expense", "exchange_in", "exchange_out", "partner_transfer", "business_expense", "personal_expense", "correction"].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = state.expenseAccounting.operationDraft?.[key] === value;
        input.appendChild(option);
      });
    } else if (key === "fromChannel" || key === "toChannel") {
      input = document.createElement("select");
      input.className = "expense-select";
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "—";
      input.appendChild(emptyOption);
      getManualFinanceChannels().forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = state.expenseAccounting.operationDraft?.[key] === value;
        input.appendChild(option);
      });
    } else {
      input = document.createElement("input");
      input.className = "finance-input";
      input.value = state.expenseAccounting.operationDraft?.[key] || "";
    }
    input.addEventListener("input", (event) => {
      state.expenseAccounting.operationDraft[key] = event.target.value;
    });
    input.addEventListener("change", (event) => {
      state.expenseAccounting.operationDraft[key] = event.target.value;
    });
    field.append(title, input);
    grid.appendChild(field);
  });
  const actions = document.createElement("div");
  actions.className = "finance-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary";
  saveButton.textContent = "Сохранить";
  saveButton.addEventListener("click", async () => {
    await saveExpenseOperationEdit(row);
  });
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ghost";
  cancelButton.textContent = "Отмена";
  cancelButton.addEventListener("click", () => {
    state.expenseAccounting.editingSheetRowNumber = 0;
    state.expenseAccounting.operationDraft = null;
    renderTabs();
  });
  actions.append(saveButton, cancelButton);
  td.append(grid, actions);
  tr.appendChild(td);
  return tr;
}

async function saveExpenseOperationEdit(row) {
  if (!state.expenseAccounting.operationDraft?.sheetRowNumber) return;
  state.expenseAccounting.loading = true;
  renderTabs();
  try {
    const response = await updateManualLedgerRowDirect(state.expenseAccounting.operationDraft);
    state.expenseAccounting.editingSheetRowNumber = 0;
    state.expenseAccounting.operationDraft = null;
    await loadDashboardData();
    setExpenseAccountingStatus(`Ledger row ${row.sheetRowNumber} updated. ${response.savedAt || ""}`.trim(), false);
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось обновить Ledger row.", true);
  } finally {
    state.expenseAccounting.loading = false;
    renderTabs();
  }
}

async function deleteExpenseOperationRow(row) {
  if (!row.sheetRowNumber) return;
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    const confirmed = window.confirm(`Удалить Ledger row ${row.sheetRowNumber}: ${row.date} ${row.operation} ${row.amount} ${row.currency}?`);
    if (!confirmed) return;
  }
  state.expenseAccounting.loading = true;
  renderTabs();
  try {
    const response = await deleteManualLedgerRowDirect(row.sheetRowNumber);
    if (state.expenseAccounting.editingSheetRowNumber === row.sheetRowNumber) {
      state.expenseAccounting.editingSheetRowNumber = 0;
      state.expenseAccounting.operationDraft = null;
    }
    await loadDashboardData();
    setExpenseAccountingStatus(`Ledger row ${row.sheetRowNumber} deleted. ${response.savedAt || ""}`.trim(), false);
  } catch (error) {
    setExpenseAccountingStatus(error.message || "Не удалось удалить Ledger row.", true);
  } finally {
    state.expenseAccounting.loading = false;
    renderTabs();
  }
}

function setExpenseAccountingStatus(message, isError = false) {
  state.expenseAccounting.status = message;
  state.expenseAccounting.error = Boolean(isError);
}

function renderManualFinanceBlock() {
  const shell = document.createElement("div");
  shell.className = "finance-shell";

  const header = document.createElement("div");
  header.className = "tab-header";
  header.innerHTML = `<div><h2>fact</h2><div class="tab-note">В HTML остаётся только legacy fact-таблица. При сохранении данные раскладываются в скрытый репозиторий \`Переводы\` + \`Расходы\`.</div></div>`;
  const headerActions = document.createElement("div");
  headerActions.className = "finance-actions";
  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "secondary";
  openButton.textContent = "Открыть диапазон";
  openButton.disabled = state.manualFinance.loading;
  openButton.addEventListener("click", async () => {
    await loadManualFinanceSheet(elements.startDate.value, elements.endDate.value, true);
  });
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary";
  saveButton.textContent = state.manualFinance.dirty ? "Сохранить диапазон*" : "Сохранить диапазон";
  saveButton.disabled = state.manualFinance.loading || !state.manualFinance.data;
  saveButton.addEventListener("click", async () => saveManualFinanceSheet());
  headerActions.append(openButton, saveButton);
  appendExportButtons(headerActions, "manualFinance");
  header.appendChild(headerActions);
  shell.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "finance-meta";
  const spreadsheetUrl = state.config?.manualFinance?.spreadsheetUrl || "";
  const isLive = hasConfiguredManualFinanceEndpoint() && state.manualFinance.data?.writeEnabled !== false;
  const statusText = state.manualFinance.status || (
    isLive
      ? (state.manualFinance.data
          ? "Диапазон открыт из накопительных вкладок manual workbook."
          : "Google подключен. Откройте диапазон для чтения и сохранения.")
      : (state.googleAuth.configured
          ? "Google OAuth обязателен. Подключите Google, чтобы загрузить и пересчитать данные."
          : "Google OAuth client is not configured")
  );
  const modeText = isLive
    ? "Google OAuth + Sheets API"
    : (state.googleAuth.accessToken
        ? "Google подключен, откройте период"
        : (state.googleAuth.configured
            ? "OAuth required, Google not connected"
            : "Google OAuth not configured"));
  const showError = state.manualFinance.error && !isLive;
  meta.innerHTML =
    `<strong>Период:</strong> ${escapeHtml(buildManualFinancePeriodLabel(elements.startDate.value, elements.endDate.value))}` +
    `<div class="finance-status${showError ? " error" : ""}">${escapeHtml(statusText)}</div>` +
    `<div class="config-note">Mode: ${escapeHtml(modeText)}</div>` +
    (state.manualFinance.data ? (
      `<div class="config-note">Source sheet: ${escapeHtml(state.manualFinance.data.sourceSheetName || "local-preview")}</div>` +
      `<div class="config-note">Status: ${escapeHtml(state.manualFinance.data.status || "draft")}</div>` +
      `<div class="config-note">Source type: ${escapeHtml(state.manualFinance.data.sourceType || "local")}</div>` +
      `<div class="config-note">Transfers: ${escapeHtml(state.manualFinance.data.transferRows.length.toString())}, fact rows: ${escapeHtml(state.manualFinance.data.moneyRows.length.toString())}</div>`
    ) : "") +
    (spreadsheetUrl ? `<div class="config-note">Manual workbook: <a href="${escapeHtml(spreadsheetUrl)}" target="_blank" rel="noreferrer">${escapeHtml(spreadsheetUrl)}</a></div>` : "");
  shell.appendChild(meta);

  const dates = document.createElement("div");
  dates.className = "date-tags";
  (state.manualFinance.periods || []).slice(0, 12).forEach((period) => {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "date-tag";
    tag.textContent = `${period.startDate} → ${period.endDate}`;
    tag.addEventListener("click", async () => {
      elements.startDate.value = period.startDate;
      elements.endDate.value = period.endDate;
      await loadDashboardData();
    });
    dates.appendChild(tag);
  });
  if (dates.childNodes.length) shell.appendChild(dates);

  if (!state.manualFinance.data) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.manualFinance.loading ? "Загрузка fact..." : "Откройте диапазон для работы с fact.";
    shell.appendChild(empty);
    return shell;
  }

  const factWrap = document.createElement("div");
  factWrap.className = "table-wrap";
  const factTable = document.createElement("table");
  const factBody = document.createElement("tbody");
  const factHeader = document.createElement("tr");
  const usdRateLookup = buildManualFinanceUsdRateLookup(
    state.manualFinance.data.transferRows,
    state.data?.tabs?.movement?.values || []
  );
  shell.appendChild(renderManualFinanceRateTable(usdRateLookup));
  getManualFinanceDisplayHeaders(state.manualFinance.data.moneyHeaders || MANUAL_FINANCE_HEADERS).forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell || "";
    factHeader.appendChild(th);
  });
  factBody.appendChild(factHeader);
  state.manualFinance.data.moneyRows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    const isTotal = row.channel === MANUAL_FINANCE_TOTAL_LABEL;

    const channelTd = document.createElement("td");
    channelTd.className = "readonly-cell";
    channelTd.textContent = row.channel || "";
    tr.appendChild(channelTd);

    ["now", "serviceIncome", "business", "house", "food", "study", "travelFun", "total", "exchange", "totalUsd", "nowUsd"].forEach((key) => {
      const td = document.createElement("td");
      if (key === "totalUsd") {
        td.className = "readonly-cell";
        td.textContent = getManualFinanceTotalUsdValue(row, usdRateLookup);
      } else if (key === "nowUsd") {
        td.className = "readonly-cell";
        td.textContent = getManualFinanceNowUsdValue(row, usdRateLookup);
      } else if (key === "total" || isTotal) {
        td.className = "readonly-cell";
        td.textContent = row[key] || "";
      } else {
        const input = document.createElement("input");
        input.className = "finance-input";
        input.value = row[key] || "";
        input.addEventListener("input", (event) => updateManualFinanceMoneyValue(rowIndex, key, event.target.value));
        td.appendChild(input);
      }
      tr.appendChild(td);
    });
    factBody.appendChild(tr);
  });
  factTable.appendChild(factBody);
  factWrap.appendChild(factTable);
  shell.appendChild(factWrap);

  return shell;
}

function renderManualTransfersBlock() {
  const shell = document.createElement("div");
  shell.className = "finance-shell";

  const header = document.createElement("div");
  header.className = "tab-header";
  header.innerHTML = `<div><h2>Переводы</h2><div class="tab-note">Редактирование переводов из manual workbook за выбранный диапазон.</div></div>`;
  const headerActions = document.createElement("div");
  headerActions.className = "finance-actions";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "secondary";
  openButton.textContent = "Открыть диапазон";
  openButton.disabled = state.manualTransfers.loading;
  openButton.addEventListener("click", async () => {
    await loadManualTransfersSheet(elements.startDate.value, elements.endDate.value, true);
  });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary";
  saveButton.textContent = state.manualTransfers.dirty ? "Сохранить диапазон*" : "Сохранить диапазон";
  saveButton.disabled = state.manualTransfers.loading || !state.manualTransfers.data;
  saveButton.addEventListener("click", async () => saveManualTransfersSheet());

  headerActions.append(openButton, saveButton);
  appendExportButtons(headerActions, "savings");
  header.appendChild(headerActions);
  shell.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "finance-meta";
  const spreadsheetUrl = state.config?.manualFinance?.spreadsheetUrl || "";
  const isLive = hasConfiguredManualFinanceEndpoint() && state.manualTransfers.data?.writeEnabled !== false;
  const statusText = state.manualTransfers.status || (
    isLive
      ? "Переводы открыты из manual workbook."
      : (state.googleAuth.configured
          ? "Google OAuth обязателен. Подключите Google, чтобы открыть и сохранить переводы."
          : "Google OAuth client is not configured")
  );
  meta.innerHTML =
    `<strong>Период:</strong> ${escapeHtml(buildManualFinancePeriodLabel(elements.startDate.value, elements.endDate.value))}` +
    `<div class="finance-status${state.manualTransfers.error && !isLive ? " error" : ""}">${escapeHtml(statusText)}</div>` +
    `<div class="config-note">Mode: ${escapeHtml(isLive ? "Google OAuth + Sheets API" : "OAuth required")}</div>` +
    (state.manualTransfers.data ? (
      `<div class="config-note">Source sheet: ${escapeHtml(state.manualTransfers.data.sourceSheetName || getManualTransfersSheetName())}</div>` +
      `<div class="config-note">Rows: ${escapeHtml(state.manualTransfers.data.transferRows.length.toString())}</div>`
    ) : "") +
    (spreadsheetUrl ? `<div class="config-note">Manual workbook: <a href="${escapeHtml(spreadsheetUrl)}" target="_blank" rel="noreferrer">${escapeHtml(spreadsheetUrl)}</a></div>` : "");
  shell.appendChild(meta);

  if (!state.manualTransfers.data) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.manualTransfers.loading ? "Загрузка переводов..." : "Откройте диапазон для работы с переводами.";
    shell.appendChild(empty);
    return shell;
  }

  const transferWrap = document.createElement("div");
  transferWrap.className = "table-wrap";
  const transferTable = document.createElement("table");
  const transferBody = document.createElement("tbody");
  const transferHeader = document.createElement("tr");
  [...(state.manualTransfers.data.transferHeaders || MANUAL_TRANSFER_HEADERS), ""].forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell || "";
    transferHeader.appendChild(th);
  });
  transferBody.appendChild(transferHeader);
  const renderTransferEditorRow = (row, rowIndex) => {
    const tr = document.createElement("tr");
    ["transferDate", "who", "amount", "currency", "channel", "rate", "usdAmount"].forEach((key) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.className = "finance-input";
      input.value = row[key] || "";
      input.addEventListener("input", (event) => updateManualTransfersValue(rowIndex, key, event.target.value));
      td.appendChild(input);
      tr.appendChild(td);
    });
    const actionTd = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "Удалить";
    remove.addEventListener("click", () => removeManualTransfersRow(rowIndex));
    actionTd.appendChild(remove);
    tr.appendChild(actionTd);
    return tr;
  };
  const transferRowsWithIndex = state.manualTransfers.data.transferRows.map((row, rowIndex) => ({ row, rowIndex }));
  const filledTransferRows = transferRowsWithIndex.filter(({ row }) => hasAnyValue(Object.values(row || {})));
  const emptyTransferRows = transferRowsWithIndex.filter(({ row }) => !hasAnyValue(Object.values(row || {})));
  filledTransferRows.forEach(({ row, rowIndex }) => {
    transferBody.appendChild(renderTransferEditorRow(row, rowIndex));
  });
  transferTable.appendChild(transferBody);
  transferWrap.appendChild(transferTable);
  shell.appendChild(transferWrap);

  if (emptyTransferRows.length) {
    const emptyRowsDetails = document.createElement("details");
    emptyRowsDetails.className = "analytics-section";
    emptyRowsDetails.style.marginTop = "12px";
    const summary = document.createElement("summary");
    summary.textContent = `Пустые строки (${emptyTransferRows.length})`;
    emptyRowsDetails.appendChild(summary);
    const emptyWrap = document.createElement("div");
    emptyWrap.className = "table-wrap";
    const emptyTable = document.createElement("table");
    const emptyBody = document.createElement("tbody");
    const emptyHeader = transferHeader.cloneNode(true);
    emptyBody.appendChild(emptyHeader);
    emptyTransferRows.forEach(({ row, rowIndex }) => {
      emptyBody.appendChild(renderTransferEditorRow(row, rowIndex));
    });
    emptyTable.appendChild(emptyBody);
    emptyWrap.appendChild(emptyTable);
    emptyRowsDetails.appendChild(emptyWrap);
    shell.appendChild(emptyRowsDetails);
  }

  const commissionTitle = document.createElement("div");
  commissionTitle.className = "tab-note";
  commissionTitle.style.margin = "18px 0 10px";
  commissionTitle.style.fontWeight = "700";
  commissionTitle.textContent = "Комиссии";
  shell.appendChild(commissionTitle);

  state.manualTransfers.data.commissionRows = normalizeManualCommissionRows(state.manualTransfers.data.commissionRows || []);
  const commissionWrap = document.createElement("div");
  commissionWrap.className = "table-wrap";
  const commissionTable = document.createElement("table");
  const commissionBody = document.createElement("tbody");
  const commissionHeader = document.createElement("tr");
  [...(state.manualTransfers.data.commissionHeaders || MANUAL_COMMISSION_HEADERS), ""].forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell || "";
    commissionHeader.appendChild(th);
  });
  commissionBody.appendChild(commissionHeader);
  const renderCommissionEditorRow = (row, rowIndex) => {
    const tr = document.createElement("tr");
    ["date", "channel", "usdAmount", "comment"].forEach((key) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.className = "finance-input";
      input.value = row[key] || "";
      input.addEventListener("input", (event) => updateManualCommissionValue(rowIndex, key, event.target.value));
      td.appendChild(input);
      tr.appendChild(td);
    });
    const actionTd = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "Удалить";
    remove.addEventListener("click", () => removeManualCommissionRow(rowIndex));
    actionTd.appendChild(remove);
    tr.appendChild(actionTd);
    return tr;
  };
  state.manualTransfers.data.commissionRows.forEach((row, rowIndex) => {
    commissionBody.appendChild(renderCommissionEditorRow(row, rowIndex));
  });
  commissionTable.appendChild(commissionBody);
  commissionWrap.appendChild(commissionTable);
  shell.appendChild(commissionWrap);

  const actions = document.createElement("div");
  actions.className = "finance-actions";
  const addTransferButton = document.createElement("button");
  addTransferButton.type = "button";
  addTransferButton.className = "secondary";
  addTransferButton.textContent = "Добавить перевод";
  addTransferButton.addEventListener("click", () => addManualTransfersRow());
  const addCommissionButton = document.createElement("button");
  addCommissionButton.type = "button";
  addCommissionButton.className = "secondary";
  addCommissionButton.textContent = "Добавить комиссию";
  addCommissionButton.addEventListener("click", () => addManualCommissionRow());
  actions.append(addTransferButton, addCommissionButton);
  shell.appendChild(actions);

  return shell;
}

function renderManualOrdersBlock() {
  const shell = document.createElement("div");
  shell.className = "finance-shell";

  const header = document.createElement("div");
  header.className = "tab-header";
  header.innerHTML = `<div><h2>Список моих заказов</h2><div class="tab-note">Ручной ввод заказов с сохранением в Google Sheets через browser OAuth.</div></div>`;
  const actions = document.createElement("div");
  actions.className = "finance-actions";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "secondary";
  openButton.textContent = "Открыть заказы";
  openButton.disabled = state.manualOrders.loading;
  openButton.addEventListener("click", async () => {
    await loadManualOrdersSheet(true);
  });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary";
  saveButton.textContent = state.manualOrders.dirty ? "Сохранить заказы*" : "Сохранить заказы";
  saveButton.disabled = state.manualOrders.loading || !state.manualOrders.data;
  saveButton.addEventListener("click", async () => saveManualOrdersSheet());

  actions.append(openButton, saveButton);
  appendExportButtons(actions, "orders");
  header.appendChild(actions);
  shell.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "finance-meta";
  const ordersConfig = getManualOrdersConfig();
  const isLive = hasConfiguredManualOrdersEndpoint() && state.manualOrders.data?.writeEnabled !== false;
  const statusText = state.manualOrders.status || (
    isLive
      ? "Orders открыты из manual workbook."
      : (state.googleAuth.configured
          ? "Google OAuth готов. Подключите Google и откройте orders."
          : "Orders доступны только локально, пока OAuth не настроен.")
  );
  const modeText = isLive
    ? "Google OAuth + Sheets API"
    : (state.googleAuth.accessToken
        ? "Google подключен, откройте orders"
        : (state.googleAuth.configured
            ? "OAuth ready, Google not connected"
            : "Browser draft / Google OAuth not connected"));
  meta.innerHTML =
    `<div class="finance-status${state.manualOrders.error && !isLive ? " error" : ""}">${escapeHtml(statusText)}</div>` +
    `<div class="config-note">Mode: ${escapeHtml(modeText)}</div>` +
    (state.manualOrders.data ? (
      `<div class="config-note">Source sheet: ${escapeHtml(state.manualOrders.data.sourceSheetName || "local-preview")}</div>` +
      `<div class="config-note">Source type: ${escapeHtml(state.manualOrders.data.sourceType || "local")}</div>`
    ) : "") +
    (ordersConfig.spreadsheetUrl ? `<div class="config-note">Manual workbook: <a href="${escapeHtml(ordersConfig.spreadsheetUrl)}" target="_blank" rel="noreferrer">${escapeHtml(ordersConfig.spreadsheetUrl)}</a></div>` : "");
  shell.appendChild(meta);

  const intakeField = document.createElement("div");
  intakeField.className = "field";
  intakeField.innerHTML = `<label>Добавить заказ текстом</label>`;
  const intakeArea = document.createElement("textarea");
  intakeArea.placeholder =
    "номер: 18094\nдата: 21.04.2026\nклиент: ...\nуслуга: ...\nprice base: 200\npayment method: сайт, рубли";
  intakeArea.value = state.manualOrders.textDraft || "";
  intakeArea.addEventListener("input", (event) => {
    state.manualOrders.textDraft = event.target.value;
  });
  intakeField.appendChild(intakeArea);

  const intakeActions = document.createElement("div");
  intakeActions.className = "finance-actions";

  const parseButton = document.createElement("button");
  parseButton.type = "button";
  parseButton.className = "secondary";
  parseButton.textContent = "Разложить по ячейкам";
  parseButton.disabled = state.manualOrders.loading;
  parseButton.addEventListener("click", () => appendManualOrdersFromText());

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "ghost";
  clearButton.textContent = "Очистить текст";
  clearButton.disabled = !state.manualOrders.textDraft;
  clearButton.addEventListener("click", () => {
    state.manualOrders.textDraft = "";
    renderTabs();
  });

  intakeActions.append(parseButton, clearButton);
  intakeField.appendChild(intakeActions);
  intakeField.insertAdjacentHTML("beforeend", `<div class="config-note">Поддерживаются строки вида ключ: значение. Несколько заказов можно вставлять блоками через пустую строку.</div>`);
  shell.appendChild(intakeField);

  if (!state.manualOrders.data) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.manualOrders.loading ? "Загрузка orders..." : "Откройте orders для ручного ввода.";
    shell.appendChild(empty);
    return shell;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  const headerRow = document.createElement("tr");
  state.manualOrders.data.headers.forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell || "";
    headerRow.appendChild(th);
  });
  const actionHeader = document.createElement("th");
  actionHeader.textContent = "";
  headerRow.appendChild(actionHeader);
  tbody.appendChild(headerRow);

  state.manualOrders.data.rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    row.forEach((cell, cellIndex) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.className = "finance-input";
      input.value = cell || "";
      input.addEventListener("input", (event) => updateManualOrderValue(rowIndex, cellIndex, event.target.value));
      td.appendChild(input);
      tr.appendChild(td);
    });
    const actionTd = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost";
    removeButton.textContent = "Удалить";
    removeButton.addEventListener("click", () => removeManualOrderRow(rowIndex));
    actionTd.appendChild(removeButton);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  shell.appendChild(tableWrap);

  const footerActions = document.createElement("div");
  footerActions.className = "finance-actions";
  const addRowButton = document.createElement("button");
  addRowButton.type = "button";
  addRowButton.className = "secondary";
  addRowButton.textContent = "Добавить заказ";
  addRowButton.addEventListener("click", addManualOrderRow);
  footerActions.appendChild(addRowButton);
  shell.appendChild(footerActions);

  return shell;
}

function renderManualFinanceRateTable(rateLookup) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap rate-table-wrap";
  const table = document.createElement("table");
  const body = document.createElement("tbody");
  [["валюта", "курс за 1 USD"], ...getManualFinanceDisplayRates(rateLookup).map((row) => [
    row.label,
    row.rate ? formatSheetNumber(row.rate, 6) : "—"
  ])].forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const el = document.createElement(rowIndex === 0 ? "th" : "td");
      el.textContent = cell;
      tr.appendChild(el);
    });
    body.appendChild(tr);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function renderMovementSummaryBlock(summaryRows) {
  const block = document.createElement("div");
  block.className = "movement-summary";
  const title = document.createElement("div");
  title.className = "movement-summary-title";
  title.textContent = "Итоги за выбранный период";
  block.appendChild(title);
  block.appendChild(renderResponsiveDataView([["Показатель", "Значение"], ...summaryRows], { mobileTableColumnCount: 2 }));
  return block;
}

function renderClosedFactTransfersBlock(headers, rows) {
  const block = document.createElement("div");
  block.className = "analytics-section";
  const title = document.createElement("div");
  title.className = "tab-note";
  title.style.marginBottom = "10px";
  title.style.fontWeight = "700";
  title.textContent = "Переводы из входящих данных за период";
  block.appendChild(title);
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.appendChild(renderResponsiveDataView([headers, ...rows], { mobileTableColumnCount: 1 }));
  block.appendChild(wrap);
  return block;
}

function renderAnalyticsSections(container, values) {
  const sections = getAnalyticsSections(values);
  const aggregateSections = getAggregatedManualAnalyticsSections(values);
  const manualWorkbookUrl = state.config?.manualFinance?.spreadsheetUrl || "";
  const manualOverlayWarning = getManualOverlayUnavailableMessage();
  const needsGoogleManualOverlay = Boolean(manualOverlayWarning);
  if (manualWorkbookUrl) {
    const linkNote = document.createElement("div");
    linkNote.className = "config-note";
    linkNote.style.marginBottom = "12px";
    linkNote.innerHTML = `Источник fact: <a href="${escapeHtml(manualWorkbookUrl)}" target="_blank" rel="noreferrer">EzoHata Manual Inputs</a>`;
    container.appendChild(linkNote);
  }
  if (needsGoogleManualOverlay && !state.googleAuth.accessToken) {
    const warning = document.createElement("div");
    warning.className = "config-note";
    warning.style.marginBottom = "12px";
    warning.textContent = manualOverlayWarning;
    container.appendChild(warning);
  }
  sections.forEach((section) => {
    const displayTitle = getAnalyticsSectionDisplayTitle(section);
    const isPersonalSection = (typeof isAnalyticsPersonalSection === "function") && isAnalyticsPersonalSection(section);
    const sectionRows = getAnalyticsSectionRenderRows(section, aggregateSections);
    const block = document.createElement("div");
    block.className = "analytics-section";
    const title = document.createElement("div");
    title.className = "tab-note";
    title.style.marginBottom = "10px";
    title.style.fontWeight = "700";
    title.textContent = displayTitle;
    block.appendChild(title);
    if (shouldShowManualOverlayWarningInsteadOfSection(section.title)) {
      const warning = document.createElement("div");
      warning.className = "config-note";
      warning.textContent = manualOverlayWarning;
      block.appendChild(warning);
    } else if (isPersonalSection) {
      appendCollapsibleZeroAnalyticsTable(block, sectionRows);
    } else if (
      normalizeCell(section.title) === normalizeCell("ИТОГО ЗА ПЕРИОД USD") ||
      normalizeCell(section.title) === normalizeCell("БАЛАНС")
    ) {
      block.appendChild(renderResponsiveDataView(sectionRows, { mobileTableColumnCount: 2 }));
    } else {
      block.appendChild(renderResponsiveDataView(sectionRows, { mobileTableColumnCount: 10 }));
    }
    container.appendChild(block);
  });
}

function getManualOverlayUnavailableMessage() {
  const manualWarnings = Array.isArray(state.data?.manual?.warnings) ? state.data.manual.warnings : [];
  const warning = manualWarnings.find((item) => /service account credentials are not configured/i.test(String(item || "")));
  if (!warning || state.googleAuth.accessToken) return "";
  return "Plan / Balance / Fact требуют авторизацию или server-side manual overlay. Данные manual workbook сейчас недоступны, поэтому нули не считаются валидной сверкой.";
}

function shouldShowManualOverlayWarningInsteadOfSection(title) {
  if (!getManualOverlayUnavailableMessage()) return false;
  const normalizedTitle = normalizeCell(title);
  return normalizedTitle === normalizeCell("Plan") || normalizedTitle === normalizeCell("БАЛАНС");
}

function isZeroOnlyAnalyticsRow(row) {
  if (!row || normalizeCell(row[0]) === normalizeCell(MANUAL_FINANCE_TOTAL_LABEL)) return false;
  const numericValues = row.slice(1).map((cell) => parseLooseNumber(cell));
  return numericValues.length > 0 && numericValues.every((value) => !value);
}

function appendCollapsibleZeroAnalyticsTable(block, rows) {
  const header = rows?.[0] || [];
  const dataRows = (rows || []).slice(1);
  const visibleRows = dataRows.filter((row) => !isZeroOnlyAnalyticsRow(row));
  const zeroRows = dataRows.filter(isZeroOnlyAnalyticsRow);
  block.appendChild(renderResponsiveDataView([header, ...visibleRows], { mobileTableColumnCount: 10 }));
  if (!zeroRows.length) return;
  const details = document.createElement("details");
  details.className = "analytics-section";
  details.style.marginTop = "12px";
  const summary = document.createElement("summary");
  summary.textContent = `Пустые каналы (${zeroRows.length})`;
  details.appendChild(summary);
  details.appendChild(renderResponsiveDataView([header, ...zeroRows], { mobileTableColumnCount: 10 }));
  block.appendChild(details);
}

function splitAnalyticsSections(values) {
  const sections = [];
  let index = 0;
  while (index < values.length) {
    const title = String(values[index]?.[0] || "").trim();
    if (!title) { index += 1; continue; }
    const header = values[index + 1] || [];
    const rows = [];
    let cursor = index + 2;
    while (cursor < values.length && hasAnyValue(values[cursor])) {
      rows.push(values[cursor]);
      cursor += 1;
    }
    if (header.length) sections.push({ title, rows: [header, ...rows] });
    index = cursor + 1;
  }
  return sections;
}

function renderTabExportActions(tabId) {
  const actions = document.createElement("div");
  actions.className = "tab-actions";
  appendExportButtons(actions, tabId);
  return actions;
}

function appendExportButtons(container, tabId) {
  const excelButton = document.createElement("button");
  excelButton.type = "button";
  excelButton.className = "ghost";
  excelButton.textContent = "Скачать Excel-овский файл";
  excelButton.disabled = !getExportRowsForTab(tabId).length;
  excelButton.addEventListener("click", () => downloadTabXlsx(tabId));
  container.appendChild(excelButton);

  if (tabId === "movement") return;

  const csvButton = document.createElement("button");
  csvButton.type = "button";
  csvButton.className = "ghost";
  csvButton.textContent = "Скачать CSV";
  csvButton.disabled = !getExportRowsForTab(tabId).length;
  csvButton.addEventListener("click", () => downloadTabCsv(tabId));
  container.appendChild(csvButton);

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "ghost";
  copyButton.textContent = "Копировать Excel";
  copyButton.disabled = !getExportRowsForTab(tabId).length;
  copyButton.addEventListener("click", () => copyTabTsv(tabId));
  container.appendChild(copyButton);
}

function renderPayoutTransfersBlock() {
  const values = getPayoutTransferTableValues();
  const block = document.createElement("div");
  block.className = "analytics-section";
  block.style.marginTop = "18px";
  const title = document.createElement("div");
  title.className = "tab-note";
  title.style.marginBottom = "10px";
  title.style.fontWeight = "700";
  title.textContent = "Переводы из вкладки Переводы за выбранный период";
  block.appendChild(title);
  if (values.length <= 1) {
    const empty = document.createElement("div");
    empty.className = "config-note";
    empty.style.marginBottom = "10px";
    empty.textContent = "Сохраненных переводов за выбранный период нет.";
    block.appendChild(empty);
  }
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.appendChild(renderResponsiveDataView(values, { mobileTableColumnCount: 1 }));
  block.appendChild(wrap);
  return block;
}

function renderMetrics() {
  const metrics = buildTopMetricsSummary();
  elements.metricPeriod.textContent = formatSheetNumber(metrics.totalOrders, 4);
  elements.metricOrders.textContent = formatSheetNumber(metrics.balance, 4);
  elements.metricBalances.textContent = formatSheetNumber(metrics.totalPaid, 4);
  elements.metricTransfers.textContent = formatSheetNumber(metrics.total, 4);
  if (elements.metricMyServices) {
    elements.metricMyServices.textContent = "Мои услуги: " + formatSheetNumber(metrics.myServices, 4);
  }
  if (elements.metricMyCosts) {
    elements.metricMyCosts.textContent = "Мои затраты: " + formatSheetNumber(metrics.myCosts, 4);
  }
  if (elements.metricProfit) {
    elements.metricProfit.textContent = "Прибыль: " + formatSheetNumber(metrics.profit, 4);
  }
}

function buildLoadedStatus() {
  const analyticsSource = state.data?.tabs?.analytics?.sourceType === "closed-range-aggregation"
    ? "browser incoming-data aggregation"
    : "server dashboard aggregation";
  const factSource = state.manualFinance.data?.writeEnabled
    ? "incoming repository linked to manual workbook"
    : "manual workbook optional";
  return `${analyticsSource} • ${factSource}`;
}
