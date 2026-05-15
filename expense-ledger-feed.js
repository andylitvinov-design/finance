// Adds a saved-Ledger expense review feed inside `Учет расходов`.
// UI-only override: provider imports, balance math, and amount_net semantics stay unchanged.
(function installExpenseLedgerFeed() {
  const SUBTAB_ID = "expenses";

  function ensureDraftState() {
    if (!state.expenseAccounting.expenseCategoryDrafts || typeof state.expenseAccounting.expenseCategoryDrafts !== "object") {
      state.expenseAccounting.expenseCategoryDrafts = {};
    }
    return state.expenseAccounting.expenseCategoryDrafts;
  }

  function installSubtabButton(shell) {
    const subtabs = shell.querySelector(".expense-subtabs");
    if (!subtabs || subtabs.querySelector('[data-expense-ledger-feed="expenses"]')) return shell;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.expenseLedgerFeed = SUBTAB_ID;
    button.className = "expense-subtab" + (state.expenseAccounting.activeSubtab === SUBTAB_ID ? " active" : "");
    button.textContent = "Расходы";
    button.addEventListener("click", () => {
      state.expenseAccounting.activeSubtab = SUBTAB_ID;
      renderTabs();
    });
    subtabs.appendChild(button);
    return shell;
  }

  function renderExpenseLedgerFeedShell() {
    ensureDraftState();
    const shell = document.createElement("div");
    shell.className = "finance-shell expense-ledger-feed-shell";

    const header = document.createElement("div");
    header.className = "tab-header";
    header.innerHTML = `<div><h2>Учет расходов</h2><div class="tab-note">Лента сохранённых Ledger-расходов по дням: все каналы и валюты вместе для быстрой проверки категорий.</div></div>`;
    shell.appendChild(header);

    const subtabs = document.createElement("div");
    subtabs.className = "expense-subtabs";
    [["list", "список затрат"], [SUBTAB_ID, "Расходы"], ["operations", "операции"], ["analysis", "анализ финансов"]].forEach(([id, label]) => {
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
    status.textContent = state.expenseAccounting.status || "Лента расходов построена из сохранённых Ledger операций за выбранный период.";
    shell.appendChild(status);

    const warnings = typeof renderExpenseAccountingWarnings === "function" ? renderExpenseAccountingWarnings() : null;
    if (warnings) shell.appendChild(warnings);

    shell.appendChild(renderExpenseLedgerFeedBlock());
    return shell;
  }

  function getExpenseLedgerRowsForPeriod() {
    const rows = typeof getExpenseOperationsRows === "function" ? getExpenseOperationsRows() : [];
    const filtered = typeof filterExpenseOperationsRows === "function"
      ? filterExpenseOperationsRows(rows, {
          ...state.expenseAccounting.operationsFilters,
          startDate: elements.startDate.value,
          endDate: elements.endDate.value,
          operation: "all",
          source: "all",
          fromChannel: "all",
          toChannel: "all"
        })
      : rows;
    return filtered.filter(isExpenseLedgerRow).sort(compareExpenseLedgerRows);
  }

  function isExpenseLedgerRow(row) {
    const operation = String(row?.operation || "").trim().toLowerCase();
    if (["expense", "business_expense", "personal_expense"].includes(operation)) return true;
    if (["income", "exchange", "exchange_in", "exchange_out", "partner_transfer", "correction"].includes(operation)) return false;
    const category = String(row?.category || "").trim().toLowerCase();
    if (["business", "flat", "food", "fun", "study", "travel"].includes(category)) return true;
    const amount = parseLooseNumber(row?.amountNet || row?.amount || row?.amountGross || 0);
    return amount < 0 && Boolean(row?.fromChannel || row?.toChannel);
  }

  function compareExpenseLedgerRows(left, right) {
    const dateCompare = String(right.date || "").localeCompare(String(left.date || ""));
    if (dateCompare) return dateCompare;
    const rightTime = extractExpenseLedgerTime(right);
    const leftTime = extractExpenseLedgerTime(left);
    if (rightTime.value !== leftTime.value) return rightTime.value - leftTime.value;
    return Number(right.sheetRowNumber || 0) - Number(left.sheetRowNumber || 0);
  }

  function extractExpenseLedgerTime(row) {
    const haystack = [row?.comment, row?.rawSourceId, row?.externalId, row?.id].map((value) => String(value || "")).join(" ");
    const iso = haystack.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
    const clock = iso || haystack.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:\D|$)/);
    if (!clock) return { label: "—", value: -1 };
    const hours = Number(clock[1] || 0);
    const minutes = Number(clock[2] || 0);
    const seconds = Number(clock[3] || 0);
    return { label: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`, value: hours * 3600 + minutes * 60 + seconds };
  }

  function getExpenseLedgerCategoryOptions(currentCategory = "") {
    const base = (typeof MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES !== "undefined" && Array.isArray(MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES))
      ? MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES
      : ["business", "flat", "food", "fun", "study", "travel"];
    const current = String(currentCategory || "").trim();
    return Array.from(new Set([...base, current].filter(Boolean)));
  }

  function getDraftCategory(row) {
    const drafts = ensureDraftState();
    const key = getExpenseLedgerDraftKey(row);
    return Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : String(row.category || "").trim();
  }

  function getExpenseLedgerDraftKey(row) {
    return String(row?.sheetRowNumber || row?.id || row?.rawSourceId || row?.externalId || "");
  }

  function isExpenseLedgerChanged(row) {
    return getDraftCategory(row) !== String(row.category || "").trim();
  }

  function getChangedExpenseLedgerRows(rows) {
    return rows.filter((row) => row.sheetRowNumber && isExpenseLedgerChanged(row));
  }

  function renderExpenseLedgerFeedBlock() {
    const block = document.createElement("div");
    block.className = "expense-ledger-feed";

    const rows = getExpenseLedgerRowsForPeriod();
    const changedRows = getChangedExpenseLedgerRows(rows);

    const meta = document.createElement("div");
    meta.className = "finance-meta";
    meta.innerHTML =
      `<strong>Период:</strong> ${escapeHtml(buildManualFinancePeriodLabel(elements.startDate.value, elements.endDate.value))}` +
      `<div class="config-note">Ledger expense rows: ${escapeHtml(String(rows.length))}; changed categories: ${escapeHtml(String(changedRows.length))}</div>`;
    block.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "finance-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary";
    saveButton.textContent = changedRows.length ? `Сохранить категории (${changedRows.length})` : "Сохранить категории";
    saveButton.disabled = state.expenseAccounting.loading || !changedRows.length;
    saveButton.addEventListener("click", async () => saveExpenseLedgerCategoryChanges(rows));
    actions.appendChild(saveButton);
    block.appendChild(actions);

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "За выбранный период сохранённых Ledger-расходов не найдено.";
      block.appendChild(empty);
      return block;
    }

    const grouped = new Map();
    rows.forEach((row) => {
      const date = row.date || "без даты";
      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date).push(row);
    });

    grouped.forEach((dayRows, date) => {
      const day = document.createElement("section");
      day.className = "expense-day expense-ledger-day";
      const title = document.createElement("div");
      title.className = "expense-day-title";
      title.textContent = buildExpenseLedgerDayTitle(date, dayRows);
      day.appendChild(title);
      day.appendChild(renderExpenseLedgerDayTable(dayRows));
      block.appendChild(day);
    });

    return block;
  }

  function buildExpenseLedgerDayTitle(date, rows) {
    const totals = new Map();
    rows.forEach((row) => {
      const currency = String(row.currency || "").trim().toUpperCase() || "?";
      const amount = Math.abs(parseLooseNumber(row.amountNet || row.amount || row.amountGross || 0));
      totals.set(currency, (totals.get(currency) || 0) + amount);
    });
    const suffix = Array.from(totals.entries())
      .map(([currency, amount]) => `${formatSheetNumber(amount)} ${currency}`)
      .join(" · ");
    return suffix ? `${date} · ${suffix}` : date;
  }

  function renderExpenseLedgerDayTable(rows) {
    const shell = document.createElement("div");
    shell.className = "expense-table-shell expense-ledger-table-shell";

    const wrap = document.createElement("div");
    wrap.className = "table-wrap expense-table-desktop";
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    const header = document.createElement("tr");
    ["Время", "Канал оплаты", "Сумма", "Категория", "Назначение"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      header.appendChild(th);
    });
    body.appendChild(header);
    rows.forEach((row) => body.appendChild(renderExpenseLedgerRow(row)));
    table.appendChild(body);
    wrap.appendChild(table);
    shell.appendChild(wrap);

    const mobile = document.createElement("div");
    mobile.className = "expense-table-mobile";
    rows.forEach((row) => mobile.appendChild(renderExpenseLedgerMobileCard(row)));
    shell.appendChild(mobile);
    return shell;
  }

  function renderExpenseLedgerRow(row) {
    const tr = document.createElement("tr");
    if (isExpenseLedgerChanged(row)) tr.className = "expense-ledger-row-dirty";
    const time = document.createElement("td");
    time.textContent = extractExpenseLedgerTime(row).label;
    const channel = document.createElement("td");
    channel.textContent = getExpenseLedgerPaymentChannel(row) || "—";
    const amount = document.createElement("td");
    amount.className = "expense-amount";
    amount.innerHTML = buildExpenseLedgerAmountHtml(row);
    const category = document.createElement("td");
    category.appendChild(buildExpenseLedgerCategorySelect(row));
    const purpose = document.createElement("td");
    purpose.textContent = buildExpenseLedgerPurpose(row);
    tr.append(time, channel, amount, category, purpose);
    return tr;
  }

  function renderExpenseLedgerMobileCard(row) {
    const card = document.createElement("article");
    card.className = "expense-table-mobile-card" + (isExpenseLedgerChanged(row) ? " expense-ledger-row-dirty" : "");
    const title = document.createElement("div");
    title.className = "expense-primary";
    title.textContent = `${extractExpenseLedgerTime(row).label} · ${getExpenseLedgerPaymentChannel(row) || "—"}`;
    const amount = document.createElement("div");
    amount.className = "expense-amount";
    amount.innerHTML = buildExpenseLedgerAmountHtml(row);
    const purposeLabel = document.createElement("div");
    purposeLabel.className = "expense-mobile-label";
    purposeLabel.textContent = "Назначение";
    const purpose = document.createElement("div");
    purpose.textContent = buildExpenseLedgerPurpose(row);
    card.append(title, amount, buildExpenseLedgerCategorySelect(row), purposeLabel, purpose);
    return card;
  }

  function getExpenseLedgerPaymentChannel(row) {
    return String(row.fromChannel || row.toChannel || "").trim();
  }

  function buildExpenseLedgerAmountHtml(row) {
    const amount = Math.abs(parseLooseNumber(row.amountNet || row.amount || row.amountGross || 0));
    const currency = String(row.currency || "").trim().toUpperCase();
    const usd = parseLooseNumber(row.amountUsd || 0);
    const parts = [`${escapeHtml(formatSheetNumber(amount))} ${escapeHtml(currency)}`.trim()];
    if (usd) parts.push(`<div class="expense-usd">${escapeHtml(formatSheetNumber(Math.abs(usd)))} USD</div>`);
    return parts.join("");
  }

  function buildExpenseLedgerPurpose(row) {
    return [row.comment, row.displaySource || row.source, row.rawSourceId || row.externalId]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" · ")
      .slice(0, 240) || "—";
  }

  function buildExpenseLedgerCategorySelect(row) {
    const select = document.createElement("select");
    select.className = "expense-select";
    const editable = Boolean(row.sheetRowNumber && (typeof canEditExpenseOperationRow !== "function" || canEditExpenseOperationRow(row)));
    select.disabled = state.expenseAccounting.loading || !editable;
    getExpenseLedgerCategoryOptions(row.category).forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      option.selected = getDraftCategory(row) === category;
      select.appendChild(option);
    });
    select.addEventListener("change", (event) => {
      ensureDraftState()[getExpenseLedgerDraftKey(row)] = event.target.value;
      renderTabs();
    });
    return select;
  }

  function buildExpenseLedgerUpdatePayload(row) {
    return {
      sheetRowNumber: Number(row.sheetRowNumber || 0),
      date: row.date || "",
      operation: row.operation || "",
      fromChannel: row.fromChannel || "",
      toChannel: row.toChannel || "",
      amount: row.amount || "",
      currency: row.currency || "",
      amountUsd: row.amountUsd || "",
      amountGross: row.amountGross || "",
      amountFee: row.amountFee || "",
      amountNet: row.amountNet || "",
      category: getDraftCategory(row),
      comment: row.comment || "",
      source: row.source || ""
    };
  }

  async function saveExpenseLedgerCategoryChanges(rows) {
    const changedRows = getChangedExpenseLedgerRows(rows);
    if (!changedRows.length) return;
    state.expenseAccounting.loading = true;
    renderTabs();
    try {
      let savedCount = 0;
      for (const row of changedRows) {
        const payload = buildExpenseLedgerUpdatePayload(row);
        if (typeof isServerManualOverlayOperationRow === "function" && isServerManualOverlayOperationRow(row)) {
          await postLedgerOperation("update", payload);
        } else if (typeof updateManualLedgerRowDirect === "function") {
          await updateManualLedgerRowDirect(payload);
        } else {
          await postLedgerOperation("update", payload);
        }
        savedCount += 1;
      }
      state.expenseAccounting.expenseCategoryDrafts = {};
      await loadDashboardData();
      setExpenseAccountingStatus(`Категории расходов сохранены: ${savedCount}.`, false);
    } catch (error) {
      setExpenseAccountingStatus(error.message || "Не удалось сохранить категории расходов.", true);
    } finally {
      state.expenseAccounting.loading = false;
      renderTabs();
    }
  }

  const originalRenderExpenseAccountingBlock = renderExpenseAccountingBlock;
  renderExpenseAccountingBlock = function renderExpenseAccountingBlockWithExpensesFeed() {
    if (state.expenseAccounting.activeSubtab === SUBTAB_ID) return renderExpenseLedgerFeedShell();
    return installSubtabButton(originalRenderExpenseAccountingBlock());
  };

  window.__expenseLedgerFeed = {
    isExpenseLedgerRow,
    extractExpenseLedgerTime,
    getExpenseLedgerCategoryOptions,
    buildExpenseLedgerUpdatePayload,
  };
})();
