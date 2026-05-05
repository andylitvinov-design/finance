(function initLedgerDashboardHelper(global) {
  const PROVIDER_SOURCES = new Set([
    "paypal",
    "wise",
    "monobank",
    "privatbank",
    "privat24",
    "tdbank",
    "td_bank",
    "yoomoney",
    "mcp",
    "provider",
    "file_import",
    "csv_import",
    "xlsx_import",
    "pdf_import",
  ]);
  const MANUAL_SOURCES = new Set(["", "manual", "fact", "migration", "photo"]);
  const INCOME_OPERATIONS = new Set(["income", "servicein", "ezoin"]);
  const EXPENSE_OPERATIONS = new Set(["expense", "business_expense", "personal_expense", "partner_transfer"]);
  const TRANSFER_OPERATIONS = new Set(["transfer", "partner_transfer"]);
  const EXCHANGE_IN_OPERATIONS = new Set(["exchange_in"]);
  const EXCHANGE_OUT_OPERATIONS = new Set(["exchange_out"]);

  function parseDashboardNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function roundDashboardAmount(value) {
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  function hasLedgerValue(row, ...keys) {
    return keys.some((key) => String(row?.[key] ?? "").trim() !== "");
  }

  function normalizeLedgerDashboardSource(value) {
    const source = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
    if (source === "privat24") return "privatbank";
    if (source === "tdbank") return "td_bank";
    if (source === "paypal_mcp") return "paypal";
    return source;
  }

  function normalizeLedgerDashboardOperation(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function getLedgerDashboardSource(row) {
    return normalizeLedgerDashboardSource(row?.source || row?.displaySource || "");
  }

  function getLedgerDashboardChannel(row, direction) {
    const candidates = direction === "to"
      ? [row?.toChannel, row?.to_channel, row?.channel]
      : [row?.fromChannel, row?.from_channel, row?.channel];
    return String(candidates.find((value) => String(value || "").trim()) || "").trim();
  }

  function getLedgerDashboardAmountUsd(row) {
    if (hasLedgerValue(row, "amountUsd", "amount_usd")) {
      return roundDashboardAmount(parseDashboardNumber(row?.amountUsd ?? row?.amount_usd));
    }
    const currency = String(row?.currency || "").trim().toUpperCase();
    if (currency !== "USD") return 0;
    if (hasLedgerValue(row, "amountNet", "amount_net", "netAmount")) {
      return roundDashboardAmount(parseDashboardNumber(row?.amountNet ?? row?.amount_net ?? row?.netAmount));
    }
    return 0;
  }

  function getLedgerDashboardMagnitudeUsd(row) {
    return Math.abs(getLedgerDashboardAmountUsd(row));
  }

  function getLedgerDashboardSignedUsd(row) {
    const operation = normalizeLedgerDashboardOperation(row?.operation);
    const amount = getLedgerDashboardMagnitudeUsd(row);
    if (INCOME_OPERATIONS.has(operation) || EXCHANGE_IN_OPERATIONS.has(operation)) return amount;
    if (EXPENSE_OPERATIONS.has(operation) || EXCHANGE_OUT_OPERATIONS.has(operation)) return -amount;
    return getLedgerDashboardAmountUsd(row);
  }

  function isLedgerDashboardProviderSource(row) {
    const source = getLedgerDashboardSource(row);
    if (PROVIDER_SOURCES.has(source)) return true;
    if (MANUAL_SOURCES.has(source) || source === "unknown") return false;
    const rawSourceId = String(row?.rawSourceId || row?.raw_source_id || row?.externalId || row?.external_id || "").trim().toLowerCase();
    return /^(paypal|wise|monobank|privatbank|privat24|yoomoney|tdbank|td_bank|provider|mcp|file_import|csv_import|xlsx_import|pdf_import):/.test(rawSourceId);
  }

  function getLedgerDashboardProviderLabel(row) {
    const source = getLedgerDashboardSource(row);
    if (source) return source;
    const rawSourceId = String(row?.rawSourceId || row?.raw_source_id || row?.externalId || row?.external_id || "").trim().toLowerCase();
    const match = rawSourceId.match(/^([^:]+):/);
    return normalizeLedgerDashboardSource(match?.[1] || "unknown");
  }

  function buildProviderHealthRows(rows) {
    const byProvider = new Map();
    (rows || []).forEach((row) => {
      if (!isLedgerDashboardProviderSource(row)) return;
      const provider = getLedgerDashboardProviderLabel(row);
      const operation = normalizeLedgerDashboardOperation(row?.operation);
      const item = byProvider.get(provider) || {
        provider,
        rows: 0,
        income: 0,
        expenses: 0,
        fees: 0,
        net: 0,
        lastImport: "",
        warnings: new Set(),
      };
      const amountUsd = getLedgerDashboardMagnitudeUsd(row);
      item.rows += 1;
      if (INCOME_OPERATIONS.has(operation)) item.income += amountUsd;
      if (EXPENSE_OPERATIONS.has(operation) || EXCHANGE_OUT_OPERATIONS.has(operation)) item.expenses += amountUsd;
      if (hasLedgerValue(row, "amountFee", "amount_fee")) item.fees += Math.abs(parseDashboardNumber(row?.amountFee ?? row?.amount_fee));
      item.net += getLedgerDashboardSignedUsd(row);
      const date = String(row?.date || "").trim();
      if (date && (!item.lastImport || date > item.lastImport)) item.lastImport = date;
      addLedgerDashboardWarningsForRow(row, item.warnings);
      byProvider.set(provider, item);
    });
    return Array.from(byProvider.values())
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map((item) => ({
        provider: item.provider,
        rows: item.rows,
        income: roundDashboardAmount(item.income),
        expenses: roundDashboardAmount(item.expenses),
        fees: roundDashboardAmount(item.fees),
        net: roundDashboardAmount(item.net),
        lastImport: item.lastImport,
        warnings: Array.from(item.warnings).join("; "),
      }));
  }

  function buildExpenseCategoryRows(rows) {
    const totals = new Map();
    (rows || []).forEach((row) => {
      if (!isLedgerDashboardProviderSource(row)) return;
      const operation = normalizeLedgerDashboardOperation(row?.operation);
      if (!EXPENSE_OPERATIONS.has(operation) && !EXCHANGE_OUT_OPERATIONS.has(operation)) return;
      const category = String(row?.category || row?.type || "uncategorized").trim() || "uncategorized";
      totals.set(category, roundDashboardAmount((totals.get(category) || 0) + getLedgerDashboardMagnitudeUsd(row)));
    });
    const totalExpense = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, amountUsd]) => ({
        category,
        amountUsd: roundDashboardAmount(amountUsd),
        percentOfExpenses: totalExpense ? roundDashboardAmount((amountUsd / totalExpense) * 100) : 0,
      }));
  }

  function buildProfitAndLossRows(rows) {
    const totals = (rows || []).reduce((acc, row) => {
      if (!isLedgerDashboardProviderSource(row)) return acc;
      const operation = normalizeLedgerDashboardOperation(row?.operation);
      if (INCOME_OPERATIONS.has(operation)) {
        const gross = hasLedgerValue(row, "amountGross", "amount_gross")
          ? Math.abs(parseDashboardNumber(row?.amountGross ?? row?.amount_gross))
          : getLedgerDashboardMagnitudeUsd(row);
        acc.grossRevenue += gross;
        acc.providerFees += hasLedgerValue(row, "amountFee", "amount_fee")
          ? Math.abs(parseDashboardNumber(row?.amountFee ?? row?.amount_fee))
          : 0;
        acc.netRevenue += getLedgerDashboardMagnitudeUsd(row);
      }
      if (EXPENSE_OPERATIONS.has(operation) || EXCHANGE_OUT_OPERATIONS.has(operation)) {
        acc.expenses += getLedgerDashboardMagnitudeUsd(row);
      }
      return acc;
    }, { grossRevenue: 0, providerFees: 0, netRevenue: 0, expenses: 0 });
    totals.profit = totals.netRevenue - totals.expenses;
    return [
      { metric: "gross revenue", amountUsd: roundDashboardAmount(totals.grossRevenue) },
      { metric: "provider fees", amountUsd: roundDashboardAmount(totals.providerFees) },
      { metric: "net revenue", amountUsd: roundDashboardAmount(totals.netRevenue) },
      { metric: "expenses", amountUsd: roundDashboardAmount(totals.expenses) },
      { metric: "profit", amountUsd: roundDashboardAmount(totals.profit) },
    ];
  }

  function buildBalancesByChannelRows(rows) {
    const byChannel = new Map();
    function ensure(channel) {
      const key = channel || "unknown";
      if (!byChannel.has(key)) byChannel.set(key, { channel: key, inflow: 0, outflow: 0, transfer: 0, exchange: 0, endBalance: 0 });
      return byChannel.get(key);
    }
    (rows || []).forEach((row) => {
      const operation = normalizeLedgerDashboardOperation(row?.operation);
      const amount = getLedgerDashboardMagnitudeUsd(row);
      if (INCOME_OPERATIONS.has(operation)) {
        const channel = ensure(getLedgerDashboardChannel(row, "to"));
        channel.inflow += amount;
        channel.endBalance += amount;
      } else if (EXPENSE_OPERATIONS.has(operation)) {
        const channel = ensure(getLedgerDashboardChannel(row, "from"));
        channel.outflow += amount;
        channel.endBalance -= amount;
      } else if (TRANSFER_OPERATIONS.has(operation)) {
        const from = ensure(getLedgerDashboardChannel(row, "from"));
        const to = ensure(getLedgerDashboardChannel(row, "to"));
        from.transfer -= amount;
        from.endBalance -= amount;
        to.transfer += amount;
        to.endBalance += amount;
      } else if (EXCHANGE_OUT_OPERATIONS.has(operation)) {
        const channel = ensure(getLedgerDashboardChannel(row, "from"));
        channel.exchange -= amount;
        channel.endBalance -= amount;
      } else if (EXCHANGE_IN_OPERATIONS.has(operation)) {
        const channel = ensure(getLedgerDashboardChannel(row, "to"));
        channel.exchange += amount;
        channel.endBalance += amount;
      }
    });
    return Array.from(byChannel.values())
      .sort((a, b) => a.channel.localeCompare(b.channel))
      .map((row) => ({
        channel: row.channel,
        inflow: roundDashboardAmount(row.inflow),
        outflow: roundDashboardAmount(row.outflow),
        transfer: roundDashboardAmount(row.transfer),
        exchange: roundDashboardAmount(row.exchange),
        endBalance: roundDashboardAmount(row.endBalance),
      }));
  }

  function buildPlanVsFactRows(channelSummary = {}) {
    const income = channelSummary.incomeTotals || {};
    const expense = channelSummary.expenseTotals || {};
    return [
      buildPlanFactRow("income", income.plannedUsd, income.realUsd),
      buildPlanFactRow("orders income", income.ordersPlanUsd, income.realUsd),
      buildPlanFactRow("service income", income.servicePlanUsd, income.realUsd),
      buildPlanFactRow("expenses", expense.plannedUsd, expense.realUsd),
    ];
  }

  function buildPlanFactRow(metric, plan, fact) {
    const normalizedPlan = roundDashboardAmount(plan);
    const normalizedFact = roundDashboardAmount(fact);
    const delta = roundDashboardAmount(normalizedFact - normalizedPlan);
    const deltaPercent = normalizedPlan ? roundDashboardAmount((delta / normalizedPlan) * 100) : 0;
    return {
      metric,
      plan: normalizedPlan,
      fact: normalizedFact,
      delta,
      deltaPercent,
      status: Math.abs(delta) <= 1 ? "OK" : "CHECK",
    };
  }

  function buildExchangeControlRows(rows) {
    let exchangeOut = 0;
    let exchangeIn = 0;
    let missingPairs = 0;
    (rows || []).forEach((row) => {
      const operation = normalizeLedgerDashboardOperation(row?.operation);
      if (EXCHANGE_OUT_OPERATIONS.has(operation)) exchangeOut += getLedgerDashboardMagnitudeUsd(row);
      if (EXCHANGE_IN_OPERATIONS.has(operation)) exchangeIn += getLedgerDashboardMagnitudeUsd(row);
    });
    const difference = roundDashboardAmount(exchangeIn - exchangeOut);
    if ((exchangeIn || exchangeOut) && Math.abs(difference) > 1) missingPairs = 1;
    return [{
      exchangeOut: roundDashboardAmount(exchangeOut),
      exchangeIn: roundDashboardAmount(exchangeIn),
      difference,
      warning: missingPairs ? "exchange imbalance" : "",
      missingPairs,
    }];
  }

  function buildWarningsRows(rows, options = {}) {
    const counts = {
      "unknown source rows": 0,
      "missing amount_usd": 0,
      "missing amount_net": 0,
      "PayPal missing fee": 0,
      "fallback amount rows": Number(options.fallbackAmountRows || 0),
      "exchange imbalance": 0,
    };
    (rows || []).forEach((row) => {
      const source = getLedgerDashboardSource(row);
      const operation = normalizeLedgerDashboardOperation(row?.operation);
      if (source === "unknown") counts["unknown source rows"] += 1;
      if (!hasLedgerValue(row, "amountUsd", "amount_usd")) counts["missing amount_usd"] += 1;
      if (!hasLedgerValue(row, "amountNet", "amount_net", "netAmount")) counts["missing amount_net"] += 1;
      if (source === "paypal" && INCOME_OPERATIONS.has(operation) && !hasLedgerValue(row, "amountFee", "amount_fee")) {
        counts["PayPal missing fee"] += 1;
      }
    });
    const exchange = buildExchangeControlRows(rows)[0];
    counts["exchange imbalance"] = exchange.missingPairs;
    return Object.entries(counts).map(([warning, count]) => ({
      warning,
      count,
      status: count ? "CHECK" : "OK",
    }));
  }

  function addLedgerDashboardWarningsForRow(row, warnings) {
    const source = getLedgerDashboardSource(row);
    const operation = normalizeLedgerDashboardOperation(row?.operation);
    if (source === "unknown") warnings.add("unknown source");
    if (!hasLedgerValue(row, "amountUsd", "amount_usd")) warnings.add("missing amount_usd");
    if (!hasLedgerValue(row, "amountNet", "amount_net", "netAmount")) warnings.add("missing amount_net");
    if (source === "paypal" && INCOME_OPERATIONS.has(operation) && !hasLedgerValue(row, "amountFee", "amount_fee")) {
      warnings.add("PayPal missing fee");
    }
  }

  function buildLedgerDrilldownRows(rows) {
    return (rows || []).map((row, index) => ({
      date: String(row?.date || ""),
      operation: normalizeLedgerDashboardOperation(row?.operation),
      source: getLedgerDashboardSource(row) || "unknown",
      fromChannel: getLedgerDashboardChannel(row, "from"),
      toChannel: getLedgerDashboardChannel(row, "to"),
      amountUsd: hasLedgerValue(row, "amountUsd", "amount_usd") ? getLedgerDashboardAmountUsd(row) : "",
      amountNet: row?.amountNet ?? row?.amount_net ?? row?.netAmount ?? "",
      amountFee: row?.amountFee ?? row?.amount_fee ?? "",
      category: row?.category || "",
      externalId: row?.externalId || row?.external_id || row?.rawSourceId || row?.raw_source_id || `row-${index + 1}`,
    }));
  }

  function buildLedgerDashboardModel(rows, options = {}) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const channelSummary = options.channelSummary || {};
    return {
      providerHealthRows: buildProviderHealthRows(sourceRows),
      expenseCategoryRows: buildExpenseCategoryRows(sourceRows),
      profitAndLossRows: buildProfitAndLossRows(sourceRows),
      balancesByChannelRows: buildBalancesByChannelRows(sourceRows),
      planVsFactRows: buildPlanVsFactRows(channelSummary),
      exchangeControlRows: buildExchangeControlRows(sourceRows),
      warningsRows: buildWarningsRows(sourceRows, options),
      drilldownRows: buildLedgerDrilldownRows(sourceRows),
    };
  }

  const api = {
    buildLedgerDashboardModel,
    buildProviderHealthRows,
    buildExpenseCategoryRows,
    buildExchangeControlRows,
    buildWarningsRows,
    getLedgerDashboardAmountUsd,
    hasLedgerValue,
    isLedgerDashboardProviderSource,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.EzohataLedgerDashboardHelper = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
