(function initBalanceSummaryPopup(root) {
  "use strict";

  const BALANCE_BUTTON_ID = "balanceLauncherButton";
  const BALANCE_BLOCK_ID = "balanceSummaryBlock";
  const FALLBACK_PERCENT_RATE = 0.03;
  const FALLBACK_PERCENT_RATE_DISPLAY = 3;
  const INCOME_DISTRIBUTION_TITLE = "Распределение оплат заказов/услуг по каналам";
  const INCOME_DISTRIBUTION_NOTE = "Возвраты, обмены и внутренние переводы исключены из процентов.";
  const SERVICE_PAYMENT_GAP_TITLE = "Диагностика оплат по каналам";

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  }

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function normalizeHeaderKey(value) {
    return normalizeCell(value)
      .replace(/\s+/g, "")
      .replace(/[^0-9a-zа-яіїєґ%+]/g, "");
  }

  function findHeaderIndexByAliases(header, aliases) {
    if (typeof root.findHeaderIndexByAliases === "function") {
      const index = root.findHeaderIndexByAliases(header, aliases);
      if (index !== -1) return index;
    }
    const normalized = new Set((aliases || []).map((alias) => normalizeCell(alias)));
    const exactIndex = (header || []).findIndex((cell) => normalized.has(normalizeCell(cell)));
    if (exactIndex !== -1) return exactIndex;
    const looseAliases = new Set((aliases || []).map((alias) => normalizeHeaderKey(alias)));
    return (header || []).findIndex((cell) => looseAliases.has(normalizeHeaderKey(cell)));
  }

  function findPreferredHeaderIndex(header, aliasGroups) {
    for (const aliases of aliasGroups) {
      const index = findHeaderIndexByAliases(header, aliases);
      if (index !== -1) return index;
    }
    return -1;
  }

  function getRootState() {
    if (typeof state !== "undefined") return state;
    return root.state || {};
  }

  function getRootElements() {
    if (typeof elements !== "undefined") return elements;
    return root.elements || {};
  }

  function normalizeDateKey(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const display = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
    return raw.slice(0, 10);
  }

  function getSelectedPeriod(options = {}) {
    const doc = options.document || root.document;
    const appState = getRootState();
    const appElements = getRootElements();
    return {
      startDate: normalizeDateKey(options.startDate || appElements?.startDate?.value || doc?.getElementById?.("startDate")?.value || appState?.analyticsFact?.periodStart || ""),
      endDate: normalizeDateKey(options.endDate || appElements?.endDate?.value || doc?.getElementById?.("endDate")?.value || appState?.analyticsFact?.periodEnd || ""),
    };
  }

  function isDateInPeriod(date, period) {
    if (!date) return true;
    if (period.startDate && date < period.startDate) return false;
    if (period.endDate && date > period.endDate) return false;
    return true;
  }

  function isTotalRow(row) {
    const first = normalizeCell(row?.[0]);
    return first === "итого" || first === "total" || first === "итого за период";
  }

  function hasAnyValue(row) {
    return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
  }

  function findHeaderRowIndex(values) {
    return (values || []).findIndex((row) => {
      const normalized = (row || []).map((cell) => normalizeHeaderKey(cell));
      return normalized.includes("occurred") ||
        normalized.includes("occured") ||
        normalized.includes("occurred+3%") ||
        normalized.includes("occured+3%") ||
        normalized.includes("accrued") ||
        normalized.includes("accrued+3%") ||
        normalized.includes("accrued+3") ||
        normalized.includes("стоимость") ||
        normalized.includes("итого");
    });
  }

  function sumTableTotals(values, period) {
    const rows = Array.isArray(values) ? values : [];
    if (!rows.length) return { orders: null, totalOrdersPlusPercent: null, percentToOrders: null, sourceFound: false };
    const headerRowIndex = findHeaderRowIndex(rows);
    if (headerRowIndex === -1) return { orders: null, totalOrdersPlusPercent: null, percentToOrders: null, sourceFound: false };

    const header = rows[headerRowIndex] || [];
    const dateIndex = findHeaderIndexByAliases(header, ["DATE", "ДАТА"]);
    const baseIndex = findPreferredHeaderIndex(header, [
      ["OCCURRED", "OCCURED"],
      ["ACCRUED", "ACCRUED BASE"],
      ["PRICE BASE", "СТОИМОСТЬ", "COST", "СУММА ЗАКАЗА", "ЗАКАЗЫ"],
    ]);
    const plusIndex = findHeaderIndexByAliases(header, ["OCCURRED +3%", "OCCURED +3%", "OCCURRED+3%", "OCCURED+3%", "ACCRUED +3%", "ACCRUED+3%", "ACCRUED + 3%", "ACCRUED PLUS 3%", "ИТОГО", "TOTAL AFTER DISCOUNT", "TOTAL"]);
    const totalRows = rows.slice(headerRowIndex + 1).filter(isTotalRow);
    const dataRows = rows.slice(headerRowIndex + 1).filter((row) => {
      if (!hasAnyValue(row) || isTotalRow(row)) return false;
      if (dateIndex !== -1) return isDateInPeriod(normalizeDateKey(row[dateIndex]), period);
      return true;
    });

    const orders = baseIndex === -1 ? null : (
      totalRows.length ? parseNumber(totalRows[totalRows.length - 1]?.[baseIndex]) : dataRows.reduce((sum, row) => sum + parseNumber(row[baseIndex]), 0)
    );
    const totalOrdersPlusPercent = plusIndex === -1 ? null : (
      totalRows.length ? parseNumber(totalRows[totalRows.length - 1]?.[plusIndex]) : dataRows.reduce((sum, row) => sum + parseNumber(row[plusIndex]), 0)
    );
    const percentToOrders = orders === null || totalOrdersPlusPercent === null ? null : totalOrdersPlusPercent - orders;
    return { orders, totalOrdersPlusPercent, percentToOrders, sourceFound: orders !== null || totalOrdersPlusPercent !== null };
  }

  function getMetrics(input, options) {
    if (options?.metrics) return options.metrics;
    if (input && (hasOwn(input, "totalOrders") || hasOwn(input, "totalPaid") || hasOwn(input, "personalOrdersAfterDiscount"))) return input;
    if (typeof root.buildTopMetricsSummary === "function") return root.buildTopMetricsSummary() || {};
    return {};
  }

  function getState(input, options) {
    return options?.state || input?.state || (input?.data ? input : null) || getRootState();
  }

  function firstFinite(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      if (Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = parseNumber(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeChannelLabel(value) {
    const raw = String(value || "").trim();
    return raw || "Не указан";
  }

  function addIncomeChannelAmount(channels, channel, amount, source, diagnostics = []) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const label = normalizeChannelLabel(channel);
    const existing = channels.get(label) || { channel: label, amount: 0, source };
    existing.amount += value;
    channels.set(label, existing);
  }

  function isFullyUnmatchedProviderInflow(row, unmatchedRow) {
    const realNetUsd = finiteOrNull(row?.realNetUsd);
    const unmatchedNetUsd = finiteOrNull(unmatchedRow?.realNetUsd);
    const plannedReceivedUsd = finiteOrNull(row?.plannedReceivedUsd) || 0;
    const unmatchedPlannedUsd = finiteOrNull(unmatchedRow?.plannedReceivedUsd) || 0;
    if (!realNetUsd || realNetUsd <= 0 || !unmatchedNetUsd || unmatchedNetUsd <= 0) return false;
    if (plannedReceivedUsd > 0 || unmatchedPlannedUsd > 0) return false;
    return Math.abs(realNetUsd - unmatchedNetUsd) < 0.0001;
  }

  function buildIncomeChannelDistributionFromRealIncome(realIncome = {}) {
    const source = realIncome?.servicePaymentSummaryByChannel
      ? "realIncome.servicePaymentSummaryByChannel"
      : "realIncome.serviceOrderSummaryByChannel";
    const summaryByChannel = realIncome?.servicePaymentSummaryByChannel || realIncome?.serviceOrderSummaryByChannel || {};
    const diagnostics = [];
    const channels = new Map();
    Object.entries(summaryByChannel || {}).forEach(([channel, row]) => {
      const realNetUsd = finiteOrNull(row?.realNetUsd);
      if (realNetUsd && realNetUsd > 0) {
        addIncomeChannelAmount(channels, row?.channel || channel, realNetUsd, "realNetUsd", diagnostics);
      }
    });
    return finalizeIncomeChannelDistribution(Array.from(channels.values()), diagnostics, source);
  }

  function findMovementHeaderRowIndex(values) {
    return (values || []).findIndex((row) => {
      const normalized = (row || []).map((cell) => normalizeHeaderKey(cell));
      const joined = normalized.join(" ");
      return /channel|канал|payment|метод|amountusd|amount_usd|netreceived|получено|realincome|реальныеприходы/.test(joined);
    });
  }

  function rowLooksLikeIncome(row, indexes) {
    const operationText = [
      indexes.operation === -1 ? "" : row[indexes.operation],
      indexes.direction === -1 ? "" : row[indexes.direction],
      indexes.comment === -1 ? "" : row[indexes.comment],
    ].map(normalizeCell).join(" ");
    if (/transfer|exchange|expense|out|перевод|обмен|расход|списание/.test(operationText)) return false;
    if (/income|inflow|in|приход|зачисление|оплачено|servicein|ezoin/.test(operationText)) return true;
    return true;
  }

  function buildIncomeChannelDistributionFromMovement(values, period) {
    const rows = Array.isArray(values) ? values : [];
    const headerRowIndex = findMovementHeaderRowIndex(rows);
    if (headerRowIndex === -1) return finalizeIncomeChannelDistribution([], [], "movement table");
    const header = rows[headerRowIndex] || [];
    const indexes = {
      date: findHeaderIndexByAliases(header, ["DATE", "ДАТА"]),
      channel: findPreferredHeaderIndex(header, [
        ["PAYMENT CHANNEL", "PAYMENT METHOD", "CHANNEL", "КАНАЛ", "КАНАЛ ОПЛАТЫ", "МЕТОД ОПЛАТЫ"],
        ["TO CHANNEL", "TO_CHANNEL", "КУДА"],
        ["FROM CHANNEL", "FROM_CHANNEL", "ОТКУДА"],
      ]),
      amount: findPreferredHeaderIndex(header, [
        ["NET RECEIVED USD", "RECEIVED NET USD", "ПОЛУЧЕНО NET USD", "NET", "AMOUNT NET"],
        ["REAL INCOME", "РЕАЛЬНЫЕ ПРИХОДЫ"],
        ["AMOUNT USD", "AMOUNT_USD", "USD AMOUNT", "СУММА USD"],
        ["RECEIVED TOTAL USD", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)"],
      ]),
      operation: findHeaderIndexByAliases(header, ["OPERATION", "TYPE", "ОПЕРАЦИЯ", "ТИП"]),
      direction: findHeaderIndexByAliases(header, ["DIRECTION", "НАПРАВЛЕНИЕ"]),
      comment: findHeaderIndexByAliases(header, ["COMMENT", "КОММЕНТАРИЙ", "NOTE", "REVIEW NOTE"]),
    };
    if (indexes.channel === -1 || indexes.amount === -1) return finalizeIncomeChannelDistribution([], [], "movement table");
    const channels = new Map();
    rows.slice(headerRowIndex + 1).forEach((row) => {
      if (!hasAnyValue(row) || isTotalRow(row)) return;
      const date = indexes.date === -1 ? "" : normalizeDateKey(row[indexes.date]);
      if (!isDateInPeriod(date, period)) return;
      if (!rowLooksLikeIncome(row, indexes)) return;
      addIncomeChannelAmount(channels, row[indexes.channel], parseNumber(row[indexes.amount]), "movement", []);
    });
    return finalizeIncomeChannelDistribution(Array.from(channels.values()), [], "movement table");
  }

  function finalizeIncomeChannelDistribution(rows, diagnostics = [], source = "") {
    const channels = (rows || [])
      .filter((row) => Number(row?.amount || 0) > 0)
      .sort((left, right) => right.amount - left.amount);
    const total = channels.reduce((sum, row) => sum + row.amount, 0);
    const withPercent = total > 0
      ? channels.map((row) => ({ ...row, percent: (row.amount / total) * 100 }))
      : [];
    return {
      title: INCOME_DISTRIBUTION_TITLE,
      note: INCOME_DISTRIBUTION_NOTE,
      source,
      total,
      channels: withPercent,
      diagnostics: [...new Set(diagnostics.filter(Boolean))],
    };
  }

  function buildIncomeChannelDistribution(input = {}, options = {}) {
    const appState = getState(input, options);
    const realIncome = appState?.data?.realIncome || appState?.realIncome || null;
    const servicePaymentSummary = realIncome?.servicePaymentSummaryByChannel || realIncome?.serviceOrderSummaryByChannel || null;
    if (servicePaymentSummary && Object.keys(servicePaymentSummary).length) {
      return buildIncomeChannelDistributionFromRealIncome(realIncome);
    }
    const period = options.period || getSelectedPeriod(options);
    const movementDistribution = buildIncomeChannelDistributionFromMovement(appState?.data?.tabs?.movement?.values || [], period);
    if (movementDistribution.channels.length) return movementDistribution;
    return {
      title: INCOME_DISTRIBUTION_TITLE,
      note: INCOME_DISTRIBUTION_NOTE,
      source: "none",
      total: 0,
      channels: [],
      diagnostics: ["needs verification: source not found for income channel distribution"],
    };
  }

  function getSharedOrdersPaymentSummary(input) {
    const shared = root.EzohataTopMetricPayableShareFix;
    if (typeof shared?.buildOrdersPaymentSummary === "function") {
      return shared.buildOrdersPaymentSummary(input);
    }
    const ordersAccruedWithPercent = parseNumber(input.ordersAccruedWithPercent ?? input.totalOrdersPlusPercent ?? input.totalOrders);
    const totalPaid = Math.abs(parseNumber(input.totalPaid));
    const myOrdersDiscounted = parseNumber(input.personalOrdersAfterDiscount);
    const totalAccrued = hasOwn(input, "totalAccrued") ? parseNumber(input.totalAccrued) : ordersAccruedWithPercent + myOrdersDiscounted;
    return {
      ordersAccruedWithPercent,
      percentRate: parseNumber(input.percentRate || FALLBACK_PERCENT_RATE_DISPLAY),
      myOrdersDiscounted,
      myOrdersGross: parseNumber(input.personalOrdersGross ?? myOrdersDiscounted),
      totalAccrued,
      totalPaid,
      remainingToPay: totalAccrued - totalPaid,
      payableFormula: "totalAccrued - abs(totalPaid)",
    };
  }

  function sumNullableTotals(left, right) {
    if (left === null && right === null) return null;
    return firstFinite(left) + firstFinite(right);
  }

  function buildBalanceTextSummary(metricsOrState = {}, options = {}) {
    const diagnostics = [];
    const metrics = getMetrics(metricsOrState, options);
    const appState = getState(metricsOrState, options);
    const period = getSelectedPeriod(options);
    const movementTotals = sumTableTotals(appState?.data?.tabs?.movement?.values || [], period);
    const ordersTotals = sumTableTotals(appState?.data?.tabs?.orders?.values || [], period);
    const explicitOrders = hasOwn(metricsOrState, "orders") ? parseNumber(metricsOrState.orders) : null;
    const explicitPercentRate = hasOwn(metricsOrState, "percentRate") ? parseNumber(metricsOrState.percentRate) : null;

    let orders = explicitOrders;
    let percentToOrders = null;
    let totalOrdersPlusPercent = hasOwn(metricsOrState, "totalOrdersPlusPercent") ? parseNumber(metricsOrState.totalOrdersPlusPercent) : null;
    const metricOrdersAccruedWithPercent = hasOwn(metrics, "ordersAccruedWithPercent")
      ? parseNumber(metrics.ordersAccruedWithPercent)
      : null;
    const metricPercentRate = hasOwn(metrics, "percentRate") ? parseNumber(metrics.percentRate) : null;
    const metricOrdersPaymentSummary = metrics?.ordersPaymentSummary || null;

    if (totalOrdersPlusPercent === null && metricOrdersPaymentSummary) {
      totalOrdersPlusPercent = parseNumber(metricOrdersPaymentSummary.ordersAccruedWithPercent);
    }
    if (totalOrdersPlusPercent === null && metricOrdersAccruedWithPercent !== null) {
      totalOrdersPlusPercent = metricOrdersAccruedWithPercent;
    }

    const tableOrders = movementTotals.sourceFound ? movementTotals.orders : ordersTotals.orders;
    const tableTotalOrdersPlusPercent = movementTotals.sourceFound ? movementTotals.totalOrdersPlusPercent : ordersTotals.totalOrdersPlusPercent;
    const tablePercentToOrders = movementTotals.sourceFound ? movementTotals.percentToOrders : ordersTotals.percentToOrders;

    if (orders === null && tableOrders !== null) orders = tableOrders;
    if (totalOrdersPlusPercent === null && tableTotalOrdersPlusPercent !== null) totalOrdersPlusPercent = tableTotalOrdersPlusPercent;
    if (percentToOrders === null && tablePercentToOrders !== null) percentToOrders = tablePercentToOrders;

    if ((orders === null || totalOrdersPlusPercent === null || percentToOrders === null) && hasOwn(metrics, "totalOrders")) {
      const fallbackOrders = parseNumber(metrics.totalOrders);
      if (orders === null) orders = fallbackOrders;
      if (percentToOrders === null) percentToOrders = orders * FALLBACK_PERCENT_RATE;
      if (totalOrdersPlusPercent === null) totalOrdersPlusPercent = fallbackOrders;
      diagnostics.push("needs verification: exact OCCURRED/ACCRUED +3% columns not found; using top metrics totalOrders as Accrued + 3%.");
    }

    if (orders === null) {
      orders = 0;
      diagnostics.push("needs verification: source not found for orders.");
    }
    if (percentToOrders === null) percentToOrders = 0;
    if (totalOrdersPlusPercent === null) totalOrdersPlusPercent = orders + percentToOrders;
    const percentRate = explicitPercentRate ?? metricPercentRate ?? FALLBACK_PERCENT_RATE_DISPLAY;

    const personalSourceFound = hasOwn(metricsOrState, "myOrders") || hasOwn(metricsOrState, "personalOrdersAfterDiscount") || hasOwn(metrics, "personalOrdersAfterDiscount") || hasOwn(metrics?.ordersSummary || {}, "personalOrdersAfterDiscount");
    const myOrdersPayableSource = metricsOrState.personalOrdersAfterDiscount ?? metrics.personalOrdersAfterDiscount ?? metrics.ordersSummary?.personalOrdersAfterDiscount ?? metricsOrState.myOrders ?? 0;
    const myOrdersPayableInput = parseNumber(myOrdersPayableSource);
    const myOrdersGrossInput = parseNumber(
      metricsOrState.personalOrdersGross ??
      metrics.personalOrdersGross ??
      metrics.ordersSummary?.personalOrdersGross ??
      metricOrdersPaymentSummary?.myOrdersGross ??
      (ordersTotals.sourceFound ? ordersTotals.orders : myOrdersPayableInput)
    );
    if (!personalSourceFound) diagnostics.push("needs verification: source not found for myOrders.");

    const paidSourceFound = hasOwn(metricsOrState, "paid") || hasOwn(metricsOrState, "totalPaid") || hasOwn(metrics, "totalPaid");
    const totalPaid = Math.abs(parseNumber(metricsOrState.paid ?? metricsOrState.totalPaid ?? metrics.totalPaid ?? 0));
    if (!paidSourceFound) diagnostics.push("needs verification: source not found for totalPaid.");

    const totalAccruedInput = hasOwn(metrics, "totalAccrued")
      ? metrics.totalAccrued
      : (hasOwn(metricsOrState, "totalOrders") ? totalOrdersPlusPercent : totalOrdersPlusPercent + myOrdersPayableInput);
    const canonical = getSharedOrdersPaymentSummary({
      ordersAccruedWithPercent: totalOrdersPlusPercent,
      totalOrders: totalOrdersPlusPercent,
      percentRate,
      personalOrdersAfterDiscount: myOrdersPayableInput,
      personalOrdersGross: myOrdersGrossInput,
      totalAccrued: totalAccruedInput,
      totalPaid,
    });
    const myOrdersPayable = canonical.myOrdersDiscounted;
    const myOrdersGross = canonical.myOrdersGross ?? myOrdersGrossInput;
    const totalAccrued = canonical.totalAccrued;
    const remainingToPay = canonical.remainingToPay;

    return {
      period,
      orders: canonical.ordersAccruedWithPercent,
      ordersBase: orders,
      percentToOrders,
      percentRate: canonical.percentRate,
      totalOrdersPlusPercent,
      myOrders: myOrdersGross,
      myOrdersGross,
      myOrdersHalf: myOrdersPayable,
      myOrdersPayable,
      totalAccrued,
      totalPaid,
      remainingToPay,
      payableFormula: canonical.payableFormula,
      incomeChannelDistribution: buildIncomeChannelDistribution(metricsOrState, { ...options, state: appState, period }),
      servicePaymentGapByChannel: appState?.data?.realIncome?.servicePaymentGapByChannel || appState?.realIncome?.servicePaymentGapByChannel || metricsOrState.servicePaymentGapByChannel || [],
      servicePaymentGapTotals: appState?.data?.realIncome?.servicePaymentGapTotals || appState?.realIncome?.servicePaymentGapTotals || metricsOrState.servicePaymentGapTotals || null,
      diagnostics,
      sources: {
        orders: explicitOrders !== null ? "input.orders" : "movement/orders table OCCURRED/ACCRUED or top metrics fallback",
        percentRate: explicitPercentRate !== null ? "input.percentRate" : "default 3 percent display rate",
        totalPaid: "buildTopMetricsSummary.totalPaid",
        myOrders: "orders table gross personal order sum; payable uses personalOrdersAfterDiscount",
      },
    };
  }

  function formatMoney(value) {
    if (!Number.isFinite(Number(value))) return "needs verification";
    if (typeof root.formatSheetNumber === "function") return root.formatSheetNumber(value, 4);
    return Number(value).toFixed(4).replace(".", ",");
  }

  function formatPercentRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return "needs verification";
    const rounded = Math.round(rate * 10000) / 10000;
    return `${String(rounded).replace(".", ",")}%`;
  }

  function formatSharePercent(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return "needs verification";
    return `${rate.toFixed(1)}%`;
  }

  function renderIncomeChannelDistribution(distribution, doc = root.document) {
    const section = doc.createElement("div");
    section.className = "balance-income-channel-distribution";
    const title = doc.createElement("h3");
    title.textContent = distribution?.title || INCOME_DISTRIBUTION_TITLE;
    section.appendChild(title);
    const note = doc.createElement("div");
    note.className = "balance-summary-diagnostics";
    note.textContent = distribution?.note || INCOME_DISTRIBUTION_NOTE;
    section.appendChild(note);

    if (!distribution?.channels?.length) {
      const diagnostic = doc.createElement("div");
      diagnostic.className = "balance-summary-diagnostics";
      diagnostic.textContent = distribution?.source === "realIncome.servicePaymentSummaryByChannel" ||
        distribution?.source === "realIncome.serviceOrderSummaryByChannel"
        ? "Нет подтвержденных оплат заказов/услуг по каналам за период."
        : "needs verification: source not found for income channel distribution";
      section.appendChild(diagnostic);
      return section;
    }

    const table = doc.createElement("table");
    const tbody = doc.createElement("tbody");
    distribution.channels.forEach((row) => {
      const tr = doc.createElement("tr");
      [row.channel, formatMoney(row.amount), formatSharePercent(row.percent)].forEach((value) => {
        const td = doc.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    const total = doc.createElement("tr");
    total.className = "balance-income-channel-total";
    ["Итого", formatMoney(distribution.total), "100.0%"].forEach((value) => {
      const td = doc.createElement("td");
      td.textContent = value;
      total.appendChild(td);
    });
    tbody.appendChild(total);
    table.appendChild(tbody);
    section.appendChild(table);

    if (distribution.diagnostics?.length) {
      const diagnostics = doc.createElement("div");
      diagnostics.className = "balance-summary-diagnostics";
      diagnostics.textContent = distribution.diagnostics.join(" ");
      section.appendChild(diagnostics);
    }
    return section;
  }

  function summarizeGapReasons(rows = []) {
    return [...new Set((rows || []).map((row) => String(row?.reason || "").trim()).filter(Boolean))].slice(0, 3).join(", ");
  }

  function hasExcludedGapReason(row) {
    const text = (row?.rows || []).map((item) => String(item?.reason || "")).join(" ").toLowerCase();
    return /excluded|исключ|deposit|non-service|refund|возврат|exchange|обмен|transfer|перевод/.test(text);
  }

  function buildServicePaymentGapSections(gapRows = []) {
    return [
      {
        title: "Не распределено / требует проверки",
        rows: gapRows.filter((row) => Number(row?.netGapUsd || 0) > 0 && !hasExcludedGapReason(row)),
      },
      {
        title: "Переплаты / offset",
        rows: gapRows.filter((row) => Number(row?.netGapUsd || 0) < 0),
      },
      {
        title: "Исключено из оплат",
        rows: gapRows.filter((row) => Number(row?.netGapUsd || 0) > 0 && hasExcludedGapReason(row)),
      },
    ].filter((section) => section.rows.length);
  }

  function renderServicePaymentGapSection(sectionData, doc = root.document) {
    const section = doc.createElement("div");
    section.className = "balance-service-payment-gap-section";
    const title = doc.createElement("h4");
    title.textContent = sectionData.title;
    section.appendChild(title);

    const table = doc.createElement("table");
    const tbody = doc.createElement("tbody");
    sectionData.rows.forEach((row) => {
      const tr = doc.createElement("tr");
      [
        row.channel || "Без канала",
        formatMoney(Number(row.netGapUsd || 0)),
        summarizeGapReasons(row.rows),
      ].forEach((value) => {
        const td = doc.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  function renderServicePaymentGapDiagnostics(summary = {}, doc = root.document) {
    const gapRows = (summary.servicePaymentGapByChannel || [])
      .filter((row) => Math.abs(Number(row?.netGapUsd || 0)) > 0.0001)
      .sort((left, right) => Math.abs(Number(right?.netGapUsd || 0)) - Math.abs(Number(left?.netGapUsd || 0)));
    if (!gapRows.length) return null;

    const section = doc.createElement("div");
    section.className = "balance-service-payment-gap";
    const title = doc.createElement("h3");
    title.textContent = SERVICE_PAYMENT_GAP_TITLE;
    section.appendChild(title);

    buildServicePaymentGapSections(gapRows).forEach((gapSection) => {
      section.appendChild(renderServicePaymentGapSection(gapSection, doc));
    });
    return section;
  }

  function renderBalanceSummaryBlock(summary, doc = root.document) {
    const block = doc.createElement("div");
    block.id = BALANCE_BLOCK_ID;
    block.className = "balance-summary-block";
    block.setAttribute("aria-live", "polite");
    const lines = [
      ["Сумма заказов за период (ACCRUED)", summary.ordersBase],
      ["Процент к заказам", summary.percentRate, "percent"],
      ["Итого: Заказы + % (ACCRUED +3%)", summary.totalOrdersPlusPercent],
      ["Мои заказы", summary.myOrders],
      ["Мои заказы к начислению (уже с учетом скидки)", summary.myOrdersPayable ?? summary.myOrdersHalf],
      ["ВСЕГО НАЧИСЛЕНО", summary.totalAccrued],
      ["ВСЕГО оплачено", summary.totalPaid],
      ["ОСТАТОК оплатить", summary.remainingToPay],
    ];
    const list = doc.createElement("ol");
    lines.forEach(([label, value, type]) => {
      const item = doc.createElement("li");
      item.textContent = `${label}: ${type === "percent" ? formatPercentRate(value) : formatMoney(value)}`;
      list.appendChild(item);
    });
    block.appendChild(list);
    block.appendChild(renderIncomeChannelDistribution(
      summary.incomeChannelDistribution || buildIncomeChannelDistribution(summary),
      doc
    ));
    const servicePaymentGap = renderServicePaymentGapDiagnostics(summary, doc);
    if (servicePaymentGap) block.appendChild(servicePaymentGap);
    if (summary.diagnostics?.length) {
      const diagnostics = doc.createElement("div");
      diagnostics.className = "balance-summary-diagnostics";
      diagnostics.textContent = summary.diagnostics.join(" ");
      block.appendChild(diagnostics);
    }
    return block;
  }

  function getSummaryMount(doc = root.document) {
    return doc?.querySelector?.(".hero .controls") || doc?.getElementById?.(BALANCE_BUTTON_ID)?.parentNode || doc?.body || null;
  }

  function updateBalanceSummaryBlock() {
    const doc = root.document;
    const existing = doc?.getElementById?.(BALANCE_BLOCK_ID);
    if (!existing) return false;
    const next = renderBalanceSummaryBlock(buildBalanceTextSummary(), doc);
    existing.parentNode?.replaceChild?.(next, existing);
    return true;
  }

  function bindBalanceLauncherButton() {
    const doc = root.document;
    const launcher = doc?.getElementById?.(BALANCE_BUTTON_ID);
    if (!launcher || launcher.__ezohataBalanceLauncherBound) return Boolean(launcher);
    launcher.__ezohataBalanceLauncherBound = true;
    launcher.addEventListener("click", () => {
      const existing = doc.getElementById(BALANCE_BLOCK_ID);
      if (existing) {
        existing.remove?.();
        return;
      }
      const block = renderBalanceSummaryBlock(buildBalanceTextSummary(), doc);
      const mount = getSummaryMount(doc);
      if (mount?.insertAdjacentElement) mount.insertAdjacentElement("afterend", block);
      else mount?.appendChild?.(block);
    });
    return true;
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__ezohataBalanceSummaryPatched) return false;
    const original = root.renderMetrics;
    root.renderMetrics = function renderMetricsWithBalanceSummary(...args) {
      const result = original.apply(this, args);
      updateBalanceSummaryBlock();
      return result;
    };
    root.renderMetrics.__ezohataBalanceSummaryPatched = true;
    return true;
  }

  function startBalanceSummary() {
    bindBalanceLauncherButton();
    patchRenderMetrics();
  }

  const api = {
    BALANCE_BUTTON_ID,
    BALANCE_BLOCK_ID,
    bindBalanceLauncherButton,
    buildIncomeChannelDistribution,
    buildBalanceTextSummary,
    renderIncomeChannelDistribution,
    renderServicePaymentGapDiagnostics,
    renderBalanceSummaryBlock,
    startBalanceSummary,
    updateBalanceSummaryBlock,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataBalanceSummaryPopup = api;
  startBalanceSummary();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startBalanceSummary);
})(typeof globalThis !== "undefined" ? globalThis : window);
