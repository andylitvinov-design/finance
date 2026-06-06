(function installMonthlyPlanExpenseBalance(root) {
  const MONTHLY_PLAN_TAB_ID = "monthlyPlan";
  const CONTAINER_ID = "monthly-plan-expense-balance";
  const COLORS = [
    "#1f7a5f",
    "#b86b2b",
    "#3d6f9f",
    "#9b4d70",
    "#7f6a2a",
    "#4f6f52",
    "#755b9a",
    "#8f5138",
    "#6b7c85"
  ];
  const CATEGORY_LABELS = {
    business: "Бизнес",
    digital_subscription: "Digital subscriptions",
    house: "Дом / квартира",
    flat: "Дом / квартира",
    food: "Еда",
    fun: "Развлечения",
    travel: "Путешествия",
    study: "Учёба",
    extra: "Прочее",
    other: "Прочее",
    uncategorized: "Без категории"
  };
  const CATEGORY_ALIASES = {
    house: "house",
    flat: "house",
    other: "extra"
  };

  function parseNumber(value) {
    const parser = typeof root.parseLooseNumber === "function" ? root.parseLooseNumber : null;
    if (parser) return parser(value);
    const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function round(value) {
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  function formatNumber(value, digits = 2) {
    const formatter = typeof root.formatSheetNumber === "function" ? root.formatSheetNumber : null;
    if (formatter) return formatter(round(value));
    return round(value).toLocaleString("ru-RU", { maximumFractionDigits: digits });
  }

  function normalizeIsoDate(value) {
    const raw = String(value || "").trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const date = raw ? new Date(raw) : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  }

  function addDays(isoDate, days) {
    const normalized = normalizeIsoDate(isoDate);
    if (!normalized) return "";
    const date = new Date(`${normalized}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function getInclusiveDayCount(startDate, endDate) {
    const start = normalizeIsoDate(startDate);
    const end = normalizeIsoDate(endDate || startDate);
    if (!start || !end) return 1;
    const startMs = new Date(`${start}T00:00:00Z`).getTime();
    const endMs = new Date(`${end}T00:00:00Z`).getTime();
    const diff = Math.floor((endMs - startMs) / 86400000) + 1;
    return Math.max(1, diff);
  }

  function getCurrentPeriod() {
    const elements = root.elements || {};
    const startDate = normalizeIsoDate(elements.startDate?.value || "");
    const endDate = normalizeIsoDate(elements.endDate?.value || startDate || "");
    return { startDate, endDate: endDate || startDate };
  }

  function getPreviousEqualPeriod(period = getCurrentPeriod()) {
    const dayCount = getInclusiveDayCount(period.startDate, period.endDate);
    const previousEnd = addDays(period.startDate, -1);
    const previousStart = addDays(previousEnd, -(dayCount - 1));
    return { startDate: previousStart, endDate: previousEnd, dayCount };
  }

  function buildRateLookup() {
    const builder = root.buildManualFinanceUsdRateLookup;
    if (typeof builder !== "function") return {};
    const appState = root.state || {};
    return builder(
      appState.aggregatedManualRange?.transferRows ||
        appState.manualTransfers?.data?.transferRows ||
        appState.manualFinance?.data?.transferRows ||
        [],
      appState.data?.tabs?.movement?.values || []
    );
  }

  function normalizeCategory(category) {
    const key = String(category || "uncategorized").trim() || "uncategorized";
    return CATEGORY_ALIASES[key] || key;
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category;
  }

  function getProviderBreakdown(period, rateLookup = buildRateLookup()) {
    const getter = root.getExpenseAnalysisProviderExpenseBreakdownByChannel;
    if (typeof getter !== "function") return {};
    try {
      return getter(rateLookup, period) || {};
    } catch {
      return {};
    }
  }

  function addCategoryAmount(byCategory, category, amount) {
    const normalizedAmount = Math.abs(parseNumber(amount));
    if (!normalizedAmount) return;
    const normalizedCategory = normalizeCategory(category);
    byCategory.set(normalizedCategory, (byCategory.get(normalizedCategory) || 0) + normalizedAmount);
  }

  function summarizeExpenseBreakdown(period, options = {}) {
    const breakdownByChannel = options.breakdownByChannel || getProviderBreakdown(period, options.rateLookup);
    const byCategory = new Map();
    const byChannel = new Map();
    Object.entries(breakdownByChannel || {}).forEach(([channel, breakdown]) => {
      const channelTotal = parseNumber(breakdown?.total ?? breakdown?.totalUsd ?? breakdown?.realTotalUsd ?? 0);
      if (channel && channelTotal > 0) byChannel.set(channel, (byChannel.get(channel) || 0) + channelTotal);
      const categories = breakdown?.byCategory || {};
      let categoryTotal = 0;
      Object.entries(categories).forEach(([rawCategory, rawAmount]) => {
        const amount = Math.abs(parseNumber(rawAmount));
        if (!amount) return;
        categoryTotal += amount;
        addCategoryAmount(byCategory, rawCategory, amount);
      });
      if (!categoryTotal && channelTotal > 0) {
        const personal = Math.abs(parseNumber(breakdown?.personal || 0));
        const business = Math.abs(parseNumber(breakdown?.business || 0));
        if (business) addCategoryAmount(byCategory, "business", business);
        if (personal && personal < channelTotal) addCategoryAmount(byCategory, "uncategorized", personal);
        if (!business && !personal) addCategoryAmount(byCategory, "business", channelTotal);
      }
    });
    const categoryRows = Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, label: categoryLabel(category), amount: round(amount) }))
      .sort((left, right) => right.amount - left.amount);
    const total = round(categoryRows.reduce((sum, row) => sum + row.amount, 0));
    categoryRows.forEach((row, index) => {
      row.percent = total > 0 ? round((row.amount / total) * 100) : 0;
      row.color = COLORS[index % COLORS.length];
    });
    const channelRows = Array.from(byChannel.entries())
      .map(([channel, amount]) => ({ channel, amount: round(amount), percent: total > 0 ? round((amount / total) * 100) : 0 }))
      .sort((left, right) => right.amount - left.amount);
    return { period, total, categoryRows, channelRows };
  }

  function buildComparisonRows(currentSummary, previousSummary) {
    const previousByCategory = new Map((previousSummary.categoryRows || []).map((row) => [row.category, row]));
    const categories = new Set([
      ...(currentSummary.categoryRows || []).map((row) => row.category),
      ...(previousSummary.categoryRows || []).map((row) => row.category)
    ]);
    return Array.from(categories).map((category) => {
      const current = (currentSummary.categoryRows || []).find((row) => row.category === category) || { category, label: categoryLabel(category), amount: 0, percent: 0 };
      const previous = previousByCategory.get(category) || { amount: 0, percent: 0 };
      const delta = round(current.amount - previous.amount);
      const deltaPercent = previous.amount ? round((delta / previous.amount) * 100) : (current.amount ? 100 : 0);
      return { ...current, previousAmount: previous.amount || 0, previousPercent: previous.percent || 0, delta, deltaPercent };
    }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  }

  function buildPieGradient(rows) {
    if (!rows.length) return "#e7ded2";
    let cursor = 0;
    return rows.map((row) => {
      const start = cursor;
      cursor += (row.percent || 0) * 3.6;
      return `${row.color} ${start}deg ${cursor}deg`;
    }).join(", ");
  }

  function appendText(parent, tag, className, text) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  function renderExpensePie(summary) {
    const body = root.document.createElement("div");
    body.className = "monthly-plan-expense-balance-body";
    const chart = root.document.createElement("div");
    chart.className = "expense-pie-chart monthly-plan-expense-balance-chart";
    chart.style.setProperty("--expense-pie-background", buildPieGradient(summary.categoryRows));
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `Расходы за период: ${formatNumber(summary.total)} USD`);
    const total = root.document.createElement("div");
    total.className = "expense-pie-total";
    appendText(total, "strong", "", formatNumber(summary.total));
    appendText(total, "span", "", "USD");
    chart.appendChild(total);
    body.appendChild(chart);

    const legend = root.document.createElement("div");
    legend.className = "expense-pie-legend";
    summary.categoryRows.forEach((row) => {
      const item = root.document.createElement("div");
      item.className = "expense-pie-legend-item";
      const swatch = root.document.createElement("span");
      swatch.className = "expense-pie-swatch";
      swatch.style.background = row.color;
      item.appendChild(swatch);
      appendText(item, "span", "expense-pie-label", row.label);
      appendText(item, "span", "expense-pie-value", `${formatNumber(row.amount)} USD`);
      appendText(item, "span", "expense-pie-percent", `${formatNumber(row.percent)}%`);
      legend.appendChild(item);
    });
    body.appendChild(legend);
    return body;
  }

  function renderCategoryTable(summary) {
    const wrap = root.document.createElement("div");
    wrap.className = "analysis-table-wrap monthly-plan-expense-balance-table";
    const table = root.document.createElement("table");
    table.innerHTML = "<thead><tr><th>Категория</th><th>Сумма</th><th>%</th></tr></thead>";
    const tbody = root.document.createElement("tbody");
    summary.categoryRows.forEach((row) => {
      const tr = root.document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(row.label)}</td><td class="numeric">${escapeHtml(formatNumber(row.amount))} USD</td><td class="numeric">${escapeHtml(formatNumber(row.percent))}%</td>`;
      tbody.appendChild(tr);
    });
    const totalRow = root.document.createElement("tr");
    totalRow.innerHTML = `<th>Итого</th><th class="numeric">${escapeHtml(formatNumber(summary.total))} USD</th><th class="numeric">100%</th>`;
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderComparisonTable(currentSummary, previousSummary) {
    const rows = buildComparisonRows(currentSummary, previousSummary);
    const wrap = root.document.createElement("div");
    wrap.className = "analysis-table-wrap monthly-plan-expense-balance-table";
    const table = root.document.createElement("table");
    table.innerHTML = "<thead><tr><th>Категория</th><th>Текущий период</th><th>Предыдущий период</th><th>Разница</th><th>% к прошлому</th></tr></thead>";
    const tbody = root.document.createElement("tbody");
    rows.forEach((row) => {
      const deltaPrefix = row.delta > 0 ? "+" : "";
      const tr = root.document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(row.label)}</td><td class="numeric">${escapeHtml(formatNumber(row.amount))} USD</td><td class="numeric">${escapeHtml(formatNumber(row.previousAmount))} USD</td><td class="numeric">${escapeHtml(deltaPrefix + formatNumber(row.delta))} USD</td><td class="numeric">${escapeHtml(deltaPrefix + formatNumber(row.deltaPercent))}%</td>`;
      tbody.appendChild(tr);
    });
    const totalDelta = round(currentSummary.total - previousSummary.total);
    const totalDeltaPercent = previousSummary.total ? round((totalDelta / previousSummary.total) * 100) : (currentSummary.total ? 100 : 0);
    const totalPrefix = totalDelta > 0 ? "+" : "";
    const totalRow = root.document.createElement("tr");
    totalRow.innerHTML = `<th>Итого</th><th class="numeric">${escapeHtml(formatNumber(currentSummary.total))} USD</th><th class="numeric">${escapeHtml(formatNumber(previousSummary.total))} USD</th><th class="numeric">${escapeHtml(totalPrefix + formatNumber(totalDelta))} USD</th><th class="numeric">${escapeHtml(totalPrefix + formatNumber(totalDeltaPercent))}%</th>`;
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function escapeHtml(value) {
    const escaper = root.escapeHtml;
    if (typeof escaper === "function") return escaper(value);
    return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function renderMonthlyPlanExpenseBalance() {
    const period = getCurrentPeriod();
    const previousPeriod = getPreviousEqualPeriod(period);
    const rateLookup = buildRateLookup();
    const currentSummary = summarizeExpenseBreakdown(period, { rateLookup });
    const previousSummary = summarizeExpenseBreakdown(previousPeriod, { rateLookup });
    const section = root.document.createElement("section");
    section.id = CONTAINER_ID;
    section.className = "analytics-section expense-pie-section monthly-plan-expense-balance-section";
    const title = root.document.createElement("div");
    title.className = "expense-pie-title monthly-plan-expense-balance-title";
    title.textContent = "Баланс расходов за выбранный период";
    section.appendChild(title);
    const note = root.document.createElement("div");
    note.className = "config-note monthly-plan-expense-balance-note";
    note.textContent = `Текущий период: ${period.startDate || "—"} — ${period.endDate || "—"}. Сравнение: ${previousPeriod.startDate || "—"} — ${previousPeriod.endDate || "—"}. Переводы и обмены не считаются расходами.`;
    section.appendChild(note);

    if (!currentSummary.total) {
      appendText(section, "div", "finance-status", "Нет реальных расходов для выбранного периода.");
      return section;
    }

    section.appendChild(renderExpensePie(currentSummary));
    appendText(section, "div", "tab-note monthly-plan-expense-subtitle", "Расходы по категориям");
    section.appendChild(renderCategoryTable(currentSummary));
    appendText(section, "div", "tab-note monthly-plan-expense-subtitle", "Сравнение с предыдущим равным периодом");
    section.appendChild(renderComparisonTable(currentSummary, previousSummary));
    return section;
  }

  function mountMonthlyPlanExpenseBalance() {
    if (!root.document || root.state?.activeTab !== MONTHLY_PLAN_TAB_ID) return false;
    const shell = root.document.querySelector(".tab-panel.active .finance-shell") || root.document.querySelector(".finance-shell");
    if (!shell) return false;
    const existing = shell.querySelector(`#${CONTAINER_ID}`);
    if (existing) existing.remove();
    const status = shell.querySelector(".finance-status");
    const section = renderMonthlyPlanExpenseBalance();
    if (status?.parentNode) status.parentNode.insertBefore(section, status.nextSibling);
    else shell.prepend(section);
    return true;
  }

  function install() {
    const currentRenderTabs = root.renderTabs;
    if (typeof currentRenderTabs === "function" && !currentRenderTabs.__monthlyPlanExpenseBalanceInstalled) {
      const original = currentRenderTabs;
      const patched = function renderTabsWithMonthlyPlanExpenseBalance() {
        const result = original.apply(this, arguments);
        mountMonthlyPlanExpenseBalance();
        return result;
      };
      patched.__monthlyPlanExpenseBalanceInstalled = true;
      root.renderTabs = patched;
      if (typeof renderTabs === "function") renderTabs = patched;
    }
    root.setTimeout?.(mountMonthlyPlanExpenseBalance, 0);
  }

  root.MonthlyPlanExpenseBalance = {
    buildComparisonRows,
    getInclusiveDayCount,
    getPreviousEqualPeriod,
    mountMonthlyPlanExpenseBalance,
    normalizeIsoDate,
    renderMonthlyPlanExpenseBalance,
    summarizeExpenseBreakdown
  };

  if (typeof module === "object" && module.exports) module.exports = root.MonthlyPlanExpenseBalance;
  install();
})(typeof globalThis !== "undefined" ? globalThis : this);
