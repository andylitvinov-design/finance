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

  function buildExpensePieSegments(options = {}) {
    const mode = options.mode === "channel" ? "channel" : "direction";
    const manualRows = Array.isArray(options.manualRows) ? options.manualRows : getExpensePieManualRows();
    const usdRateLookup = options.usdRateLookup || getExpensePieRateLookup();
    const categoryTotals = Object.fromEntries(getExpensePieCategories().map((category) => [category, 0]));
    const channelTotals = {};

    manualRows.forEach((row) => {
      if (isExpensePieTotalRow(row)) return;
      let rowTotal = 0;
      getExpensePieCategories().forEach((category) => {
        const value = getExpensePieCategoryUsd(row, category, usdRateLookup);
        categoryTotals[category] = (categoryTotals[category] || 0) + value;
        rowTotal += value;
      });
      const channel = String(row.channel || "").trim();
      if (channel && rowTotal > 0) channelTotals[channel] = (channelTotals[channel] || 0) + rowTotal;
    });

    const rawSegments = Object.entries(mode === "channel" ? channelTotals : categoryTotals)
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

  function installExpensePieAnalytics() {
    const currentRenderExpenseFinancialAnalysis = typeof renderExpenseFinancialAnalysis === "function"
      ? renderExpenseFinancialAnalysis
      : root.renderExpenseFinancialAnalysis;
    if (typeof currentRenderExpenseFinancialAnalysis !== "function") return false;
    if (currentRenderExpenseFinancialAnalysis.__expensePieAnalyticsInstalled) return true;
    const originalRenderExpenseFinancialAnalysis = currentRenderExpenseFinancialAnalysis;
    const patchedRenderExpenseFinancialAnalysis = function renderExpenseFinancialAnalysisWithPie() {
      const block = originalRenderExpenseFinancialAnalysis.apply(this, arguments);
      const pie = renderExpensePieAnalytics();
      const summaryGrid = block.querySelector(".expense-summary-grid");
      if (summaryGrid?.parentNode) {
        summaryGrid.parentNode.insertBefore(pie, summaryGrid.nextSibling);
      } else {
        block.appendChild(pie);
      }
      return block;
    };
    patchedRenderExpenseFinancialAnalysis.__expensePieAnalyticsInstalled = true;
    if (typeof renderExpenseFinancialAnalysis === "function") {
      renderExpenseFinancialAnalysis = patchedRenderExpenseFinancialAnalysis;
    }
    root.renderExpenseFinancialAnalysis = patchedRenderExpenseFinancialAnalysis;
    return true;
  }

  root.ExpensePieAnalytics = {
    buildExpensePieSegments,
    getExpensePieCategoryUsd,
    installExpensePieAnalytics,
    renderExpensePieAnalytics
  };

  if (typeof module === "object" && module.exports) {
    module.exports = root.ExpensePieAnalytics;
  }

  installExpensePieAnalytics();
})(typeof globalThis !== "undefined" ? globalThis : this);
