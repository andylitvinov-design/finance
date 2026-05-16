(function initExpensePieAnalytics(root) {
  const EXPENSE_PIE_MODES = {
    direction: "по направлениям",
    channel: "по каналам"
  };

  const EXPENSE_PIE_CATEGORY_LABELS = {
    business: "business",
    flat: "flat",
    food: "food",
    fun: "fun",
    travel: "travel",
    study: "study",
    exchange: "exchange"
  };

  const EXPENSE_PIE_CATEGORY_ALIASES = {
    flat: ["flat", "house"],
    travel: ["travel", "travelFun"]
  };

  const EXPENSE_PIE_COLORS = [
    "#1f7a5f",
    "#b86b2b",
    "#3d6f9f",
    "#9b4d70",
    "#7f6a2a",
    "#4f6f52",
    "#755b9a",
    "#8f5138"
  ];

  const EXPENSE_PLAN_TARGETS_USD = {
    incomeMonth: 10000,
    expenseMonth: 2000,
    profitMonth: 2500
  };

  function getExpensePieState() {
    if (typeof state !== "undefined") return state;
    return root.state;
  }

  function getExpensePieTotalLabel() {
    if (typeof MANUAL_FINANCE_TOTAL_LABEL !== "undefined") return MANUAL_FINANCE_TOTAL_LABEL;
    return root.MANUAL_FINANCE_TOTAL_LABEL;
  }

  function getExpensePieCategories() {
    if (typeof MANUAL_EXPENSE_ACCOUNTING_CATEGORIES !== "undefined" && Array.isArray(MANUAL_EXPENSE_ACCOUNTING_CATEGORIES) && MANUAL_EXPENSE_ACCOUNTING_CATEGORIES.length) {
      return MANUAL_EXPENSE_ACCOUNTING_CATEGORIES.slice();
    }
    if (Array.isArray(root.MANUAL_EXPENSE_ACCOUNTING_CATEGORIES) && root.MANUAL_EXPENSE_ACCOUNTING_CATEGORIES.length) {
      return root.MANUAL_EXPENSE_ACCOUNTING_CATEGORIES.slice();
    }
    return Object.keys(EXPENSE_PIE_CATEGORY_LABELS);
  }

  function getExpensePieMode() {
    const mode = getExpensePieState()?.expenseAccounting?.expensePieMode;
    return mode === "channel" ? "channel" : "direction";
  }

  function setExpensePieMode(mode) {
    const appState = getExpensePieState();
    if (!appState?.expenseAccounting) return;
    appState.expenseAccounting.expensePieMode = mode === "channel" ? "channel" : "direction";
  }

  function getExpensePieRateLookup() {
    const appState = getExpensePieState();
    const buildRateLookup = typeof buildManualFinanceUsdRateLookup === "function"
      ? buildManualFinanceUsdRateLookup
      : root.buildManualFinanceUsdRateLookup;
    if (typeof buildRateLookup !== "function") return { byChannel: {}, byCurrency: {} };
    return buildRateLookup(
      appState?.aggregatedManualRange?.transferRows ||
        appState?.manualTransfers?.data?.transferRows ||
        appState?.manualFinance?.data?.transferRows ||
        [],
      appState?.data?.tabs?.movement?.values || []
    );
  }

  function getExpensePieManualRows() {
    const getManualRows = typeof getCurrentAnalyticsManualRows === "function"
      ? getCurrentAnalyticsManualRows
      : root.getCurrentAnalyticsManualRows;
    if (typeof getManualRows === "function") return getManualRows();
    return [];
  }

  function getExpensePieCategoryUsd(row, category, usdRateLookup) {
    const getFieldUsd = typeof getManualFinanceFieldUsdNumber === "function"
      ? getManualFinanceFieldUsdNumber
      : root.getManualFinanceFieldUsdNumber;
    if (!row || typeof getFieldUsd !== "function") return 0;
    const aliases = EXPENSE_PIE_CATEGORY_ALIASES[category] || [category];
    return aliases.reduce((sum, key) => {
      if (key !== category && row[key] == null) return sum;
      return sum + getFieldUsd(row, key, usdRateLookup);
    }, 0);
  }

  function isExpensePieTotalRow(row) {
    const totalLabel = getExpensePieTotalLabel();
    return !row?.channel || (totalLabel && row.channel === totalLabel);
  }

  function normalizeExpensePieSegment(label, value, total, index) {
    const amount = Number.isFinite(value) ? value : 0;
    return {
      label,
      value: amount,
      percent: total > 0 ? (amount / total) * 100 : 0,
      color: EXPENSE_PIE_COLORS[index % EXPENSE_PIE_COLORS.length]
    };
  }

  function getExpensePieContributionRows(manualRows, usdRateLookup) {
    const contributions = [];
    manualRows.forEach((row) => {
      if (isExpensePieTotalRow(row)) return;
      const channel = String(row.channel || "").trim();
      if (!channel) return;
      getExpensePieCategories().forEach((category) => {
        const amount = getExpensePieCategoryUsd(row, category, usdRateLookup);
        if (!Number.isFinite(amount) || amount <= 0) return;
        contributions.push({ channel, category, amount });
      });
    });
    return contributions;
  }

  function buildExpensePieSegments(options = {}) {
    const mode = options.mode === "channel" ? "channel" : "direction";
    const manualRows = Array.isArray(options.manualRows) ? options.manualRows : getExpensePieManualRows();
    const usdRateLookup = options.usdRateLookup || getExpensePieRateLookup();
    const totals = mode === "direction"
      ? Object.fromEntries(getExpensePieCategories().map((category) => [category, 0]))
      : {};
    getExpensePieContributionRows(manualRows, usdRateLookup).forEach((entry) => {
      const label = mode === "channel" ? entry.channel : entry.category;
      totals[label] = (totals[label] || 0) + entry.amount;
    });

    const rawSegments = Object.entries(totals)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = rawSegments.reduce((sum, [, value]) => sum + value, 0);
    const segments = rawSegments.map(([label, value], index) => normalizeExpensePieSegment(
      EXPENSE_PIE_CATEGORY_LABELS[label] || label,
      value,
      total,
      index
    ));
    return { mode, total, segments };
  }

  function formatExpensePieNumber(value) {
    const formatter = typeof formatSheetNumber === "function" ? formatSheetNumber : root.formatSheetNumber;
    if (typeof formatter === "function") return formatter(value);
    return String(Math.round((Number(value) || 0) * 100) / 100);
  }

  function parseExpensePlanNumber(value) {
    const parser = typeof parseLooseNumber === "function" ? parseLooseNumber : root.parseLooseNumber;
    if (typeof parser === "function") return parser(value);
    const normalized = String(value ?? "").replace(/\s+/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeExpensePlanDate(value) {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = raw ? new Date(raw) : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function getExpensePlanSelectedEndDate(options = {}) {
    const explicit = normalizeExpensePlanDate(options.endDate || "");
    if (explicit) return explicit;
    const appElements = typeof elements !== "undefined" ? elements : root.elements;
    return normalizeExpensePlanDate(appElements?.endDate?.value || "") || normalizeExpensePlanDate(new Date().toISOString().slice(0, 10));
  }

  function getExpensePlanDaysInMonth(dateString) {
    const date = normalizeExpensePlanDate(dateString);
    const match = date.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (!match) return 30;
    return new Date(Number(match[1]), Number(match[2]), 0).getDate();
  }

  function getExpensePlanWeeklyTarget(monthlyTarget, dateString) {
    const daysInMonth = getExpensePlanDaysInMonth(dateString);
    return daysInMonth > 0 ? (Number(monthlyTarget || 0) * 7) / daysInMonth : Number(monthlyTarget || 0) / 4;
  }

  function getExpensePlanActuals(options = {}) {
    let summary = options.channelSummary || null;
    if (!summary) {
      const getSummary = typeof getExpenseAnalysisChannelSummary === "function"
        ? getExpenseAnalysisChannelSummary
        : root.getExpenseAnalysisChannelSummary;
      if (typeof getSummary === "function") {
        try {
          summary = getSummary();
        } catch {
          summary = null;
        }
      }
    }
    const realIncomeWeekUsd = parseExpensePlanNumber(summary?.incomeTotals?.realUsd);
    const realExpenseWeekUsd = parseExpensePlanNumber(
      summary?.expenseTotals?.realTotalUsd ?? summary?.expenseTotals?.realUsd
    );
    return {
      realIncomeWeekUsd,
      realExpenseWeekUsd,
      realProfitWeekUsd: realIncomeWeekUsd - realExpenseWeekUsd
    };
  }

  function buildExpensePlanDashboardGroups(options = {}) {
    const endDate = getExpensePlanSelectedEndDate(options);
    const actuals = options.actuals || getExpensePlanActuals(options);
    const weeklyExpensePlan = getExpensePlanWeeklyTarget(EXPENSE_PLAN_TARGETS_USD.expenseMonth, endDate);
    const weeklyProfitPlan = getExpensePlanWeeklyTarget(EXPENSE_PLAN_TARGETS_USD.profitMonth, endDate);
    return [
      {
        id: "income",
        title: "Приход по заказам",
        rows: [
          { label: "План приход на месяц", value: EXPENSE_PLAN_TARGETS_USD.incomeMonth, kind: "plan-month" },
          { label: "Реальный приход за неделю", value: actuals.realIncomeWeekUsd, kind: "actual-week" }
        ]
      },
      {
        id: "expense",
        title: "Расход",
        rows: [
          { label: "План на месяц", value: EXPENSE_PLAN_TARGETS_USD.expenseMonth, kind: "plan-month" },
          { label: "План на неделю", value: weeklyExpensePlan, kind: "plan-week" },
          { label: "Реальный расход за неделю", value: actuals.realExpenseWeekUsd, kind: "actual-week" }
        ]
      },
      {
        id: "profit",
        title: "Прибыль 2500 уе",
        rows: [
          { label: "План на месяц", value: EXPENSE_PLAN_TARGETS_USD.profitMonth, kind: "plan-month" },
          { label: "План на неделю", value: weeklyProfitPlan, kind: "plan-week" },
          { label: "Реальная на неделю", value: actuals.realProfitWeekUsd, kind: "actual-week" }
        ]
      }
    ];
  }

  function formatExpensePlanUsd(value) {
    return `${formatExpensePieNumber(value)} USD`;
  }

  function buildExpensePieGradient(segments) {
    if (!segments.length) return "#e7ded2";
    let cursor = 0;
    return segments.map((segment) => {
      const start = cursor;
      cursor += segment.percent * 3.6;
      return `${segment.color} ${start}deg ${cursor}deg`;
    }).join(", ");
  }

  function renderExpensePieAnalytics() {
    const result = buildExpensePieSegments({ mode: getExpensePieMode() });
    const section = document.createElement("div");
    section.className = "analytics-section expense-pie-section";

    const header = document.createElement("div");
    header.className = "expense-pie-header";
    const title = document.createElement("div");
    title.className = "tab-note expense-pie-title";
    title.textContent = "Структура расходов";
    header.appendChild(title);

    const toggle = document.createElement("div");
    toggle.className = "expense-pie-toggle";
    Object.entries(EXPENSE_PIE_MODES).forEach(([mode, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `expense-pie-toggle-button${result.mode === mode ? " active" : ""}`;
      button.textContent = label;
      button.addEventListener("click", () => {
        setExpensePieMode(mode);
        const rerender = typeof renderTabs === "function" ? renderTabs : root.renderTabs;
        if (typeof rerender === "function") rerender();
      });
      toggle.appendChild(button);
    });
    header.appendChild(toggle);
    section.appendChild(header);

    if (!result.total) {
      const empty = document.createElement("div");
      empty.className = "finance-status";
      empty.textContent = "Нет расходов для выбранного периода.";
      section.appendChild(empty);
      return section;
    }

    const body = document.createElement("div");
    body.className = "expense-pie-body";

    const chart = document.createElement("div");
    chart.className = "expense-pie-chart";
    chart.style.setProperty("--expense-pie-background", buildExpensePieGradient(result.segments));
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `Структура расходов: ${formatExpensePieNumber(result.total)} USD`);
    const total = document.createElement("div");
    total.className = "expense-pie-total";
    const totalValue = document.createElement("strong");
    totalValue.textContent = formatExpensePieNumber(result.total);
    const totalCurrency = document.createElement("span");
    totalCurrency.textContent = "USD";
    total.appendChild(totalValue);
    total.appendChild(totalCurrency);
    chart.appendChild(total);
    body.appendChild(chart);

    const legend = document.createElement("div");
    legend.className = "expense-pie-legend";
    result.segments.forEach((segment) => {
      const item = document.createElement("div");
      item.className = "expense-pie-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "expense-pie-swatch";
      swatch.style.background = segment.color;
      const label = document.createElement("span");
      label.className = "expense-pie-label";
      label.textContent = segment.label;
      const value = document.createElement("span");
      value.className = "expense-pie-value";
      value.textContent = `${formatExpensePieNumber(segment.value)} USD`;
      const percent = document.createElement("span");
      percent.className = "expense-pie-percent";
      percent.textContent = `${formatExpensePieNumber(segment.percent)}%`;
      item.appendChild(swatch);
      item.appendChild(label);
      item.appendChild(value);
      item.appendChild(percent);
      legend.appendChild(item);
    });
    body.appendChild(legend);
    section.appendChild(body);
    return section;
  }

  function renderExpensePlanDashboard() {
    const groups = buildExpensePlanDashboardGroups();
    const section = document.createElement("div");
    section.className = "analytics-section expense-plan-section";

    const title = document.createElement("div");
    title.className = "tab-note expense-pie-title";
    title.style.marginBottom = "10px";
    title.style.fontWeight = "700";
    title.textContent = "План / факт: приход, расход, прибыль";
    section.appendChild(title);

    const note = document.createElement("div");
    note.className = "config-note";
    note.style.marginBottom = "12px";
    note.textContent = "Недельный план считается как месячный план × 7 / дней в месяце выбранного периода.";
    section.appendChild(note);

    const grid = document.createElement("div");
    grid.className = "expense-summary-grid expense-plan-grid";
    groups.forEach((group) => {
      const card = document.createElement("div");
      card.className = `expense-summary-card expense-plan-card expense-plan-card-${group.id}`;
      const heading = document.createElement("div");
      heading.className = "expense-summary-label expense-plan-title";
      heading.textContent = group.title;
      card.appendChild(heading);

      group.rows.forEach((row) => {
        const line = document.createElement("div");
        line.className = `expense-plan-line ${row.kind}`;
        const label = document.createElement("span");
        label.className = "expense-plan-label";
        label.textContent = row.label;
        const value = document.createElement("strong");
        value.className = "expense-plan-value";
        value.textContent = formatExpensePlanUsd(row.value);
        line.appendChild(label);
        line.appendChild(value);
        card.appendChild(line);
      });
      grid.appendChild(card);
    });
    section.appendChild(grid);
    return section;
  }

  function installExpensePlanDashboardIntoAnalysis() {
    const currentRenderExpenseFinancialAnalysis = typeof renderExpenseFinancialAnalysis === "function"
      ? renderExpenseFinancialAnalysis
      : root.renderExpenseFinancialAnalysis;
    if (typeof currentRenderExpenseFinancialAnalysis !== "function") return false;
    if (currentRenderExpenseFinancialAnalysis.__expensePlanDashboardInstalled) return true;
    const originalRenderExpenseFinancialAnalysis = currentRenderExpenseFinancialAnalysis;
    const patchedRenderExpenseFinancialAnalysis = function renderExpenseFinancialAnalysisWithPlanDashboard() {
      const block = originalRenderExpenseFinancialAnalysis.apply(this, arguments);
      const dashboard = renderExpensePlanDashboard();
      const summaryGrid = block.querySelector(".expense-summary-grid");
      if (summaryGrid?.parentNode) {
        summaryGrid.parentNode.insertBefore(dashboard, summaryGrid.nextSibling);
      } else if (typeof block.prepend === "function") {
        block.prepend(dashboard);
      } else {
        block.appendChild(dashboard);
      }
      return block;
    };
    patchedRenderExpenseFinancialAnalysis.__expensePlanDashboardInstalled = true;
    if (typeof renderExpenseFinancialAnalysis === "function") {
      renderExpenseFinancialAnalysis = patchedRenderExpenseFinancialAnalysis;
    }
    root.renderExpenseFinancialAnalysis = patchedRenderExpenseFinancialAnalysis;
    return true;
  }

  function installExpensePieIntoExpenseList() {
    const currentRenderExpenseAccountingBlock = typeof renderExpenseAccountingBlock === "function"
      ? renderExpenseAccountingBlock
      : root.renderExpenseAccountingBlock;
    if (typeof currentRenderExpenseAccountingBlock !== "function") return false;
    if (currentRenderExpenseAccountingBlock.__expensePieListInstalled) return true;
    const originalRenderExpenseAccountingBlock = currentRenderExpenseAccountingBlock;
    const patchedRenderExpenseAccountingBlock = function renderExpenseAccountingBlockWithPieInList() {
      const block = originalRenderExpenseAccountingBlock.apply(this, arguments);
      const appState = getExpensePieState();
      const expenseState = appState?.expenseAccounting || {};
      if (expenseState.activeSubtab !== "list" || expenseState.resultTab === "received") return block;
      const pie = renderExpensePieAnalytics();
      const resultTabs = block.querySelector(".expense-result-tabs");
      const feed = block.querySelector(".expense-feed");
      if (feed?.parentNode) {
        feed.parentNode.insertBefore(pie, feed);
      } else if (resultTabs?.parentNode) {
        resultTabs.parentNode.insertBefore(pie, resultTabs.nextSibling);
      } else {
        block.appendChild(pie);
      }
      return block;
    };
    patchedRenderExpenseAccountingBlock.__expensePieListInstalled = true;
    if (typeof renderExpenseAccountingBlock === "function") {
      renderExpenseAccountingBlock = patchedRenderExpenseAccountingBlock;
    }
    root.renderExpenseAccountingBlock = patchedRenderExpenseAccountingBlock;
    return true;
  }

  function installExpensePieAnalytics() {
    const analysisInstalled = installExpensePlanDashboardIntoAnalysis();
    const listInstalled = installExpensePieIntoExpenseList();
    return Boolean(analysisInstalled || listInstalled);
  }

  root.ExpensePieAnalytics = {
    buildExpensePieSegments,
    buildExpensePlanDashboardGroups,
    getExpensePieContributionRows,
    getExpensePieCategoryUsd,
    getExpensePlanActuals,
    getExpensePlanWeeklyTarget,
    installExpensePieAnalytics,
    installExpensePieIntoExpenseList,
    installExpensePlanDashboardIntoAnalysis,
    renderExpensePieAnalytics,
    renderExpensePlanDashboard
  };

  if (typeof module === "object" && module.exports) {
    module.exports = root.ExpensePieAnalytics;
  }

  installExpensePieAnalytics();
})(typeof globalThis !== "undefined" ? globalThis : this);
