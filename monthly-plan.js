// ============================================================
// MONTHLY PLAN TAB + EXPENSE ANALYSIS PLAN OVERLAY
// ============================================================

(function installMonthlyPlanTab() {
  const MONTHLY_PLAN_TAB_ID = "monthlyPlan";
  const MONTHLY_PLAN_SHEET_FALLBACK = "План";
  const MONTHLY_PLAN_HEADERS = [
    "month",
    "orders_income_plan_usd",
    "services_income_plan_usd",
    "business_expense_plan_usd",
    "flat_pct",
    "food_pct",
    "fun_pct",
    "travel_pct",
    "study_pct",
    "extra_pct",
    "comment"
  ];
  const MONTHLY_PLAN_NUMERIC_FIELDS = [
    "ordersIncomePlanUsd",
    "servicesIncomePlanUsd",
    "businessExpensePlanUsd",
    "flatPct",
    "foodPct",
    "funPct",
    "travelPct",
    "studyPct",
    "extraPct"
  ];
  const MONTHLY_PLAN_CATEGORY_FIELDS = [
    ["flat", "flatPct", "дом/квартира"],
    ["food", "foodPct", "еда"],
    ["fun", "funPct", "развлечения"],
    ["travel", "travelPct", "путешествия"],
    ["study", "studyPct", "учеба"],
    ["extra", "extraPct", "прочее"]
  ];

  function ensureMonthlyPlanState() {
    if (typeof state === "undefined") return null;
    if (!state.monthlyPlan) {
      state.monthlyPlan = {
        loading: false,
        data: { rows: [] },
        dirty: false,
        status: "",
        error: false
      };
    }
    return state.monthlyPlan;
  }

  function getManualMonthlyPlanSheetName() {
    if (typeof state === "undefined") return MONTHLY_PLAN_SHEET_FALLBACK;
    return String(state.config?.manualFinance?.planSheetName || MONTHLY_PLAN_SHEET_FALLBACK).trim() || MONTHLY_PLAN_SHEET_FALLBACK;
  }

  function parseMonthlyPlanNumber(value) {
    if (typeof parseLooseNumber === "function") return parseLooseNumber(value);
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatMonthlyPlanNumber(value) {
    if (typeof formatSheetNumber === "function") return formatSheetNumber(value);
    const rounded = Math.round((Number(value) || 0) * 100) / 100;
    return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function normalizeMonthlyPlanHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^0-9a-zа-я]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function findMonthlyPlanHeaderIndex(header, aliases) {
    const normalizedAliases = aliases.map(normalizeMonthlyPlanHeader);
    return (header || []).findIndex((cell) => normalizedAliases.includes(normalizeMonthlyPlanHeader(cell)));
  }

  function normalizeMonthlyPlanMonth(value) {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
    const matchRu = raw.match(/^(\d{1,2})[./](\d{4})$/);
    if (matchRu) return `${matchRu[2]}-${String(matchRu[1]).padStart(2, "0")}`;
    if (typeof parseDisplayDateToIso === "function") {
      const iso = parseDisplayDateToIso(raw);
      if (iso) return iso.slice(0, 7);
    }
    return "";
  }

  function createEmptyMonthlyPlanRow(month = "") {
    return {
      month,
      ordersIncomePlanUsd: "",
      servicesIncomePlanUsd: "",
      businessExpensePlanUsd: "",
      flatPct: "",
      foodPct: "",
      funPct: "",
      travelPct: "",
      studyPct: "",
      extraPct: "",
      comment: ""
    };
  }

  function isMonthlyPlanRowEmpty(row) {
    if (!row?.month) return true;
    return MONTHLY_PLAN_NUMERIC_FIELDS.every((field) => !parseMonthlyPlanNumber(row[field])) && !String(row.comment || "").trim();
  }

  function normalizeMonthlyPlanRow(row = {}) {
    return {
      month: normalizeMonthlyPlanMonth(row.month),
      ordersIncomePlanUsd: String(row.ordersIncomePlanUsd ?? row.orders_income_plan_usd ?? "").trim(),
      servicesIncomePlanUsd: String(row.servicesIncomePlanUsd ?? row.services_income_plan_usd ?? "").trim(),
      businessExpensePlanUsd: String(row.businessExpensePlanUsd ?? row.business_expense_plan_usd ?? "").trim(),
      flatPct: String(row.flatPct ?? row.flat_pct ?? "").trim(),
      foodPct: String(row.foodPct ?? row.food_pct ?? "").trim(),
      funPct: String(row.funPct ?? row.fun_pct ?? "").trim(),
      travelPct: String(row.travelPct ?? row.travel_pct ?? "").trim(),
      studyPct: String(row.studyPct ?? row.study_pct ?? "").trim(),
      extraPct: String(row.extraPct ?? row.extra_pct ?? "").trim(),
      comment: String(row.comment || "").trim()
    };
  }

  function parseMonthlyPlanSheetValues(values = []) {
    const rows = Array.isArray(values) ? values : [];
    if (!rows.length) return [];
    const header = rows[0] || [];
    const indexes = {
      month: findMonthlyPlanHeaderIndex(header, ["month", "месяц", "period_month", "period"]),
      ordersIncomePlanUsd: findMonthlyPlanHeaderIndex(header, ["orders_income_plan_usd", "доход от заказов", "заказы план", "orders plan"]),
      servicesIncomePlanUsd: findMonthlyPlanHeaderIndex(header, ["services_income_plan_usd", "доход от услуг", "услуги план", "service plan"]),
      businessExpensePlanUsd: findMonthlyPlanHeaderIndex(header, ["business_expense_plan_usd", "расходы на бизнес", "business expense plan", "business plan"]),
      flatPct: findMonthlyPlanHeaderIndex(header, ["flat_pct", "house_pct", "квартира %", "дом %", "flat %"]),
      foodPct: findMonthlyPlanHeaderIndex(header, ["food_pct", "еда %", "food %"]),
      funPct: findMonthlyPlanHeaderIndex(header, ["fun_pct", "развлечения %", "fun %"]),
      travelPct: findMonthlyPlanHeaderIndex(header, ["travel_pct", "путешествия %", "travel %"]),
      studyPct: findMonthlyPlanHeaderIndex(header, ["study_pct", "учеба %", "study %"]),
      extraPct: findMonthlyPlanHeaderIndex(header, ["extra_pct", "прочее %", "other %", "extra %"]),
      comment: findMonthlyPlanHeaderIndex(header, ["comment", "комментарий"])
    };
    return rows.slice(1).map((rawRow) => normalizeMonthlyPlanRow({
      month: rawRow[indexes.month] || "",
      ordersIncomePlanUsd: rawRow[indexes.ordersIncomePlanUsd] || "",
      servicesIncomePlanUsd: rawRow[indexes.servicesIncomePlanUsd] || "",
      businessExpensePlanUsd: rawRow[indexes.businessExpensePlanUsd] || "",
      flatPct: rawRow[indexes.flatPct] || "",
      foodPct: rawRow[indexes.foodPct] || "",
      funPct: rawRow[indexes.funPct] || "",
      travelPct: rawRow[indexes.travelPct] || "",
      studyPct: rawRow[indexes.studyPct] || "",
      extraPct: rawRow[indexes.extraPct] || "",
      comment: indexes.comment === -1 ? "" : (rawRow[indexes.comment] || "")
    })).filter((row) => row.month);
  }

  function buildMonthlyPlanSheetValues(rows = []) {
    const normalizedRows = (rows || [])
      .map(normalizeMonthlyPlanRow)
      .filter((row) => row.month)
      .sort((left, right) => left.month.localeCompare(right.month));
    return [
      MONTHLY_PLAN_HEADERS.slice(),
      ...normalizedRows.map((row) => [
        row.month,
        row.ordersIncomePlanUsd,
        row.servicesIncomePlanUsd,
        row.businessExpensePlanUsd,
        row.flatPct,
        row.foodPct,
        row.funPct,
        row.travelPct,
        row.studyPct,
        row.extraPct,
        row.comment
      ])
    ];
  }

  function buildPeriodMonthKeys(startDate, endDate) {
    const start = normalizeMonthlyPlanMonth(startDate);
    const end = normalizeMonthlyPlanMonth(endDate || startDate);
    if (!start && !end) return [];
    const [startYear, startMonth] = (start || end).split("-").map(Number);
    const [endYear, endMonth] = (end || start).split("-").map(Number);
    const cursor = new Date(startYear, startMonth - 1, 1);
    const limit = new Date(endYear, endMonth - 1, 1);
    const months = [];
    while (cursor <= limit) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  function getMonthlyPlanRowsForCurrentState() {
    const monthlyPlan = ensureMonthlyPlanState();
    const stateRows = monthlyPlan?.data?.rows || [];
    if (stateRows.length) return stateRows;
    if (typeof state !== "undefined") {
      return parseMonthlyPlanSheetValues(state.data?.tabs?.plan?.values || []);
    }
    return [];
  }

  function buildMonthlyPlanForPeriod(startDate, endDate, rows = getMonthlyPlanRowsForCurrentState()) {
    const months = buildPeriodMonthKeys(startDate, endDate);
    const byMonth = new Map((rows || []).map((row) => [normalizeMonthlyPlanMonth(row.month), normalizeMonthlyPlanRow(row)]));
    const selectedRows = months.map((month) => byMonth.get(month)).filter(Boolean);
    const missingMonths = months.filter((month) => !byMonth.has(month) || isMonthlyPlanRowEmpty(byMonth.get(month)));
    const sumField = (field) => selectedRows.reduce((sum, row) => sum + parseMonthlyPlanNumber(row[field]), 0);
    const averagePct = (field) => {
      const values = selectedRows.map((row) => parseMonthlyPlanNumber(row[field])).filter((value) => Number.isFinite(value) && value > 0);
      if (!values.length) return 0;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const plan = {
      months,
      selectedRows,
      missingMonths,
      ordersIncomePlanUsd: sumField("ordersIncomePlanUsd"),
      servicesIncomePlanUsd: sumField("servicesIncomePlanUsd"),
      businessExpensePlanUsd: sumField("businessExpensePlanUsd"),
      personalPct: Object.fromEntries(MONTHLY_PLAN_CATEGORY_FIELDS.map(([category, field]) => [category, averagePct(field)]))
    };
    plan.personalPctTotal = Object.values(plan.personalPct).reduce((sum, value) => sum + value, 0);
    plan.hasAnyPlan = Boolean(
      plan.ordersIncomePlanUsd ||
      plan.servicesIncomePlanUsd ||
      plan.businessExpensePlanUsd ||
      plan.personalPctTotal
    );
    return plan;
  }

  function calculateRealPersonalExpenseCategoryPct(period = {}) {
    if (typeof getExpenseAnalysisProviderExpenseBreakdownByChannel !== "function") return {};
    if (typeof buildManualFinanceUsdRateLookup !== "function") return {};
    const rateLookup = buildManualFinanceUsdRateLookup(
      state?.aggregatedManualRange?.transferRows || state?.manualTransfers?.data?.transferRows || state?.manualFinance?.data?.transferRows || [],
      state?.data?.tabs?.movement?.values || []
    );
    const breakdownByChannel = getExpenseAnalysisProviderExpenseBreakdownByChannel(rateLookup, period) || {};
    const totals = Object.fromEntries(MONTHLY_PLAN_CATEGORY_FIELDS.map(([category]) => [category, 0]));
    Object.values(breakdownByChannel).forEach((breakdown) => {
      const byCategory = breakdown?.byCategory || {};
      totals.flat += parseMonthlyPlanNumber(byCategory.flat || byCategory.house || 0);
      totals.food += parseMonthlyPlanNumber(byCategory.food || 0);
      totals.fun += parseMonthlyPlanNumber(byCategory.fun || 0);
      totals.travel += parseMonthlyPlanNumber(byCategory.travel || 0);
      totals.study += parseMonthlyPlanNumber(byCategory.study || 0);
      totals.extra += parseMonthlyPlanNumber(byCategory.extra || byCategory.other || 0);
    });
    const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
    if (!total) return Object.fromEntries(Object.keys(totals).map((key) => [key, 0]));
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, (value / total) * 100]));
  }

  function appendMonthlyPlanRowsToSummary(summary, plan) {
    if (!Array.isArray(summary.rows)) return;
    summary.rows.push(["План KPI", "доход от заказов", `${formatMonthlyPlanNumber(plan.ordersIncomePlanUsd)} USD`]);
    summary.rows.push(["План KPI", "доход от услуг", `${formatMonthlyPlanNumber(plan.servicesIncomePlanUsd)} USD`]);
    summary.rows.push(["План KPI", "расходы на бизнес", `${formatMonthlyPlanNumber(plan.businessExpensePlanUsd)} USD`]);
    const realPct = calculateRealPersonalExpenseCategoryPct(summary.period || {});
    MONTHLY_PLAN_CATEGORY_FIELDS.forEach(([category, field, label]) => {
      const planned = parseMonthlyPlanNumber(plan.personalPct?.[category]);
      if (!planned) return;
      const real = parseMonthlyPlanNumber(realPct[category]);
      summary.rows.push([
        "План личных расходов %",
        label,
        `план ${formatMonthlyPlanNumber(planned)}%`,
        real ? `реал ${formatMonthlyPlanNumber(real)}%` : "реал 0%",
        `разница ${formatMonthlyPlanNumber(real - planned)}%`
      ]);
    });
    (plan.missingMonths || []).forEach((month) => {
      summary.rows.push(["План", `План за ${month} не заполнен`, "warning"]);
    });
  }

  function applyMonthlyPlanToExpenseAnalysisSummary(summary) {
    if (!summary || typeof summary !== "object") return summary;
    const period = summary.period || {
      startDate: typeof elements !== "undefined" ? elements.startDate?.value : "",
      endDate: typeof elements !== "undefined" ? elements.endDate?.value : ""
    };
    const plan = buildMonthlyPlanForPeriod(period.startDate || "", period.endDate || period.startDate || "");
    summary.monthlyPlan = plan;
    summary.planWarnings = (plan.missingMonths || []).map((month) => `План за ${month} не заполнен`);
    if (plan.hasAnyPlan) {
      summary.incomeTotals = { ...(summary.incomeTotals || {}) };
      summary.expenseTotals = { ...(summary.expenseTotals || {}) };
      if (plan.ordersIncomePlanUsd) summary.incomeTotals.ordersPlanUsd = plan.ordersIncomePlanUsd;
      if (plan.servicesIncomePlanUsd) summary.incomeTotals.servicePlanUsd = plan.servicesIncomePlanUsd;
      if (plan.ordersIncomePlanUsd || plan.servicesIncomePlanUsd) {
        summary.incomeTotals.plannedUsd = (plan.ordersIncomePlanUsd || 0) + (plan.servicesIncomePlanUsd || 0);
      }
      if (plan.businessExpensePlanUsd) summary.expenseTotals.plannedUsd = plan.businessExpensePlanUsd;
      appendMonthlyPlanRowsToSummary(summary, plan);
    } else if (plan.missingMonths?.length && Array.isArray(summary.rows)) {
      appendMonthlyPlanRowsToSummary(summary, plan);
    }
    return summary;
  }

  async function loadMonthlyPlanSheetForCurrentRange() {
    const monthlyPlan = ensureMonthlyPlanState();
    if (!monthlyPlan) return null;
    monthlyPlan.loading = true;
    monthlyPlan.error = false;
    monthlyPlan.status = "Загружаю План...";
    renderTabs();
    try {
      if (typeof hasConfiguredManualFinanceEndpoint === "function" && !hasConfiguredManualFinanceEndpoint()) {
        throw new Error("Manual workbook server access is not configured.");
      }
      const sheetName = getManualMonthlyPlanSheetName();
      if (typeof ensureSheetExists === "function") await ensureSheetExists(sheetName);
      const values = typeof getSheetValuesByTitle === "function" ? await getSheetValuesByTitle(sheetName) : [];
      const rows = parseMonthlyPlanSheetValues(values);
      const months = buildPeriodMonthKeys(elements?.startDate?.value || "", elements?.endDate?.value || "");
      const byMonth = new Map(rows.map((row) => [row.month, row]));
      months.forEach((month) => {
        if (!byMonth.has(month)) rows.push(createEmptyMonthlyPlanRow(month));
      });
      monthlyPlan.data = { rows: rows.sort((left, right) => left.month.localeCompare(right.month)), sheetName };
      monthlyPlan.dirty = false;
      monthlyPlan.status = `План открыт: ${sheetName}`;
      monthlyPlan.error = false;
      return monthlyPlan.data;
    } catch (error) {
      monthlyPlan.status = error.message || "Не удалось открыть План.";
      monthlyPlan.error = true;
      return null;
    } finally {
      monthlyPlan.loading = false;
      renderTabs();
    }
  }

  async function saveMonthlyPlanSheet() {
    const monthlyPlan = ensureMonthlyPlanState();
    if (!monthlyPlan?.data) return;
    monthlyPlan.loading = true;
    monthlyPlan.status = "Сохраняю План...";
    monthlyPlan.error = false;
    renderTabs();
    try {
      const sheetName = monthlyPlan.data.sheetName || getManualMonthlyPlanSheetName();
      if (typeof ensureSheetExists === "function") await ensureSheetExists(sheetName);
      const values = buildMonthlyPlanSheetValues(monthlyPlan.data.rows || []);
      const range = encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!A1:K${Math.max(values.length, 1)}`);
      await googleSheetsFetch(`/spreadsheets/${getManualFinanceSpreadsheetId()}/values/${range}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        body: JSON.stringify({ values })
      });
      if (typeof clearManualServerCache === "function") clearManualServerCache();
      monthlyPlan.data.rows = parseMonthlyPlanSheetValues(values);
      monthlyPlan.dirty = false;
      monthlyPlan.status = "План сохранён.";
      monthlyPlan.error = false;
      if (state?.expenseAccounting?.activeSubtab === "analysis") renderTabs();
    } catch (error) {
      monthlyPlan.status = error.message || "Не удалось сохранить План.";
      monthlyPlan.error = true;
    } finally {
      monthlyPlan.loading = false;
      renderTabs();
    }
  }

  function renderMonthlyPlanBlock() {
    const monthlyPlan = ensureMonthlyPlanState();
    const block = document.createElement("div");
    block.className = "finance-shell";
    const header = document.createElement("div");
    header.className = "tab-header";
    const workbookUrl = String(state?.config?.manualFinance?.spreadsheetUrl || "").trim();
    header.innerHTML = `<div><h2>План</h2><div class="tab-note">Месячные KPI для сравнения плана и факта во вкладке «Учет расходов → анализ финансов».${workbookUrl ? ` <a href="${escapeHtml(workbookUrl)}" target="_blank" rel="noreferrer">Открыть workbook</a>.` : ""}</div></div>`;
    const actions = document.createElement("div");
    actions.className = "finance-actions";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "secondary";
    refreshButton.textContent = monthlyPlan.loading ? "Загружаю..." : "Обновить";
    refreshButton.disabled = monthlyPlan.loading;
    refreshButton.addEventListener("click", loadMonthlyPlanSheetForCurrentRange);
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary";
    saveButton.textContent = monthlyPlan.loading ? "Сохраняю..." : "Сохранить план";
    saveButton.disabled = monthlyPlan.loading;
    saveButton.addEventListener("click", saveMonthlyPlanSheet);
    actions.append(refreshButton, saveButton);
    header.appendChild(actions);
    block.appendChild(header);

    const status = document.createElement("div");
    status.className = `finance-status${monthlyPlan.error ? " error" : ""}`;
    status.textContent = monthlyPlan.status || "Откройте или заполните месячный план.";
    block.appendChild(status);

    const rows = monthlyPlan.data?.rows?.length
      ? monthlyPlan.data.rows
      : buildPeriodMonthKeys(elements?.startDate?.value || "", elements?.endDate?.value || "").map(createEmptyMonthlyPlanRow);
    monthlyPlan.data = monthlyPlan.data || { rows: [] };
    monthlyPlan.data.rows = rows;

    const wrap = document.createElement("div");
    wrap.className = "monthly-plan-grid";
    const fields = [
      ["month", "Месяц", "YYYY-MM"],
      ["ordersIncomePlanUsd", "Доход от заказов", ""],
      ["servicesIncomePlanUsd", "Доход от услуг", ""],
      ["businessExpensePlanUsd", "Расходы на бизнес", ""],
      ["flatPct", "Квартира %", ""],
      ["foodPct", "Еда %", ""],
      ["funPct", "Развлечения %", ""],
      ["travelPct", "Путешествия %", ""],
      ["studyPct", "Учеба %", ""],
      ["extraPct", "Прочее %", ""],
      ["comment", "Комментарий", ""]
    ];
    rows.forEach((row) => {
      const card = document.createElement("section");
      card.className = "monthly-plan-card";
      const title = document.createElement("h3");
      title.textContent = row.month || "Новый месяц";
      card.appendChild(title);
      fields.forEach(([field, label, placeholder]) => {
        const fieldWrap = document.createElement("label");
        fieldWrap.className = "monthly-plan-field";
        const fieldLabel = document.createElement("span");
        fieldLabel.textContent = label;
        const input = document.createElement("input");
        input.className = "finance-input";
        input.dataset.field = field;
        input.value = row[field] || "";
        input.placeholder = placeholder;
        input.addEventListener("input", (event) => {
          row[field] = String(event.target.value || "").trim();
          if (field === "month") title.textContent = row[field] || "Новый месяц";
          monthlyPlan.dirty = true;
        });
        fieldWrap.append(fieldLabel, input);
        card.appendChild(fieldWrap);
      });
      wrap.appendChild(card);
    });
    block.appendChild(wrap);

    const hint = document.createElement("div");
    hint.className = "config-note";
    hint.textContent = "Формат месяца: YYYY-MM. Проценты вводятся как 30, 20, 15 и т.п. Эти значения не меняют баланс и provider imports — только план/факт аналитику расходов.";
    block.appendChild(hint);
    return block;
  }

  function appendMonthlyPlanTabButton() {
    if (typeof elements === "undefined" || !elements.tabs) return;
    if (elements.tabs.querySelector?.(`[data-tab-id="${MONTHLY_PLAN_TAB_ID}"]`)) return;
    const button = document.createElement("button");
    button.className = "tab" + (state.activeTab === MONTHLY_PLAN_TAB_ID ? " active" : "");
    button.type = "button";
    button.dataset.tabId = MONTHLY_PLAN_TAB_ID;
    button.textContent = "План";
    button.addEventListener("click", async () => {
      state.activeTab = MONTHLY_PLAN_TAB_ID;
      renderTabs();
      await loadMonthlyPlanSheetForCurrentRange();
    });
    elements.tabs.appendChild(button);
  }

  function renderMonthlyPlanTabShell() {
    elements.tabs.innerHTML = "";
    elements.tabPanels.innerHTML = "";
    for (const tab of state.config.tabs || []) {
      const button = document.createElement("button");
      button.className = "tab";
      button.type = "button";
      button.textContent = tab.label;
      button.addEventListener("click", () => {
        state.activeTab = tab.id;
        renderTabs();
      });
      elements.tabs.appendChild(button);
    }
    appendMonthlyPlanTabButton();
    const panel = document.createElement("section");
    panel.className = "tab-panel active";
    panel.appendChild(renderMonthlyPlanBlock());
    elements.tabPanels.appendChild(panel);
    if (typeof refreshGoogleControlsVisibility === "function") refreshGoogleControlsVisibility();
  }

  function patchMonthlyPlanUi() {
    if (typeof renderTabs !== "function") return;
    const originalRenderTabs = renderTabs;
    renderTabs = function patchedRenderTabs() {
      if (state?.activeTab === MONTHLY_PLAN_TAB_ID) {
        renderMonthlyPlanTabShell();
        return;
      }
      originalRenderTabs();
      appendMonthlyPlanTabButton();
    };
  }

  function patchExpenseAnalysisSummary() {
    if (typeof getExpenseAnalysisChannelSummary !== "function") return;
    const originalGetExpenseAnalysisChannelSummary = getExpenseAnalysisChannelSummary;
    getExpenseAnalysisChannelSummary = function patchedGetExpenseAnalysisChannelSummary(...args) {
      return applyMonthlyPlanToExpenseAnalysisSummary(originalGetExpenseAnalysisChannelSummary.apply(this, args));
    };
  }

  globalThis.parseMonthlyPlanSheetValues = parseMonthlyPlanSheetValues;
  globalThis.buildMonthlyPlanSheetValues = buildMonthlyPlanSheetValues;
  globalThis.buildMonthlyPlanForPeriod = buildMonthlyPlanForPeriod;
  globalThis.applyMonthlyPlanToExpenseAnalysisSummary = applyMonthlyPlanToExpenseAnalysisSummary;
  globalThis.loadMonthlyPlanSheetForCurrentRange = loadMonthlyPlanSheetForCurrentRange;
  globalThis.saveMonthlyPlanSheet = saveMonthlyPlanSheet;
  globalThis.renderMonthlyPlanBlock = renderMonthlyPlanBlock;

  if (typeof state !== "undefined") ensureMonthlyPlanState();
  patchMonthlyPlanUi();
  patchExpenseAnalysisSummary();
})();
