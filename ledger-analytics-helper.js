(function initLedgerAnalyticsHelper(global) {
  "use strict";

  const PROVIDER_LABELS = [
    ["paypal", "PayPal"],
    ["пейпал", "PayPal"],
    ["wise", "Wise"],
    ["transferwise", "Wise"],
    ["трансервайз", "Wise"],
    ["tdbank", "TD"],
    ["td_bank", "TD"],
    ["monobank", "Monobank"],
    ["монобанк", "Monobank"],
    ["privatbank", "PrivatBank"],
    ["privat24", "PrivatBank"],
    ["приват", "PrivatBank"],
    ["manual", "Manual"],
    ["fact", "Manual"],
    ["migration", "Manual"],
    ["photo", "Manual"],
    ["mcp", "Manual"],
    ["provider", "Manual"],
    ["unknown", "Manual"]
  ];

  function parseAmount(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function roundAmount(value) {
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  function normalizeToken(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "_");
  }

  function read(row, ...keys) {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
    }
    return "";
  }

  function getContract() {
    return global.EzohataManualLedgerContract || {};
  }

  function mergeLedgerInput(row) {
    const ledger = row?.ledgerV2 || {};
    return {
      ...(row || {}),
      ...ledger,
      source: ledger.source || row?.source || row?.displaySource || "",
      external_id: ledger.external_id || row?.external_id || row?.externalId || row?.raw_source_id || row?.rawSourceId || "",
      raw_source_id: row?.raw_source_id || row?.rawSourceId || ledger.raw_source_id || ledger.external_id || "",
      from_channel: ledger.from_channel || row?.from_channel || row?.fromChannel || "",
      to_channel: ledger.to_channel || row?.to_channel || row?.toChannel || "",
      amount_usd: ledger.amount_usd ?? row?.amount_usd ?? row?.amountUsd ?? "",
      amount_gross: ledger.amount_gross ?? row?.amount_gross ?? row?.amountGross ?? "",
      amount_fee: ledger.amount_fee ?? row?.amount_fee ?? row?.amountFee ?? "",
      amount_net: ledger.amount_net ?? row?.amount_net ?? row?.amountNet ?? row?.netAmount ?? ""
    };
  }

  function normalizeLedgerRowSafe(row) {
    const input = mergeLedgerInput(row);
    const contract = getContract();
    const normalized = contract.normalizeLedgerRow
      ? contract.normalizeLedgerRow(input)
      : {
          ...input,
          operation: normalizeLegacyOperation(input.operation),
          amount_usd: input.amount_usd ?? input.amountUsd ?? "",
          amount_gross: input.amount_gross ?? input.amountGross ?? input.amount ?? "",
          amount_fee: input.amount_fee ?? input.amountFee ?? "",
          amount_net: input.amount_net ?? input.amountNet ?? "",
          from_channel: input.from_channel ?? input.fromChannel ?? "",
          to_channel: input.to_channel ?? input.toChannel ?? "",
          source: input.source || "unknown",
          external_id: input.external_id || input.externalId || input.raw_source_id || input.rawSourceId || ""
        };
    normalized.raw = row;
    normalized.displaySource = normalizeLedgerSource(normalized.source || row?.displaySource || row?.source);
    normalized.displayOperation = normalizeLegacyOperation(normalized.operation || row?.operation);
    normalized.displayCategory = String(normalized.category || row?.category || "").trim() || "other";
    normalized.displayExternalId = String(normalized.external_id || row?.externalId || row?.rawSourceId || "").trim();
    normalized.displayFromChannel = String(normalized.from_channel || row?.fromChannel || "").trim();
    normalized.displayToChannel = String(normalized.to_channel || row?.toChannel || "").trim();
    normalized.displayComment = String(normalized.comment || row?.comment || "").trim();
    return normalized;
  }

  function normalizeLedgerRows(rows = []) {
    return (rows || [])
      .map(normalizeLedgerRowSafe)
      .filter((row) => row.date || row.operation || row.amount || row.amount_usd || row.amount_net);
  }

  function normalizeLegacyOperation(value) {
    const token = normalizeToken(value);
    if (token === "exchange_in" || token === "exchange_out") return "exchange";
    if (token === "business_expense" || token === "personal_expense") return "expense";
    if (token === "partner_transfer") return "transfer";
    if (token === "servicein" || token === "ezoin" || token === "serviceincome") return "income";
    return token || "";
  }

  function normalizeLedgerSource(value) {
    const token = normalizeToken(value);
    if (token === "td_bank" || token === "tdbank") return "tdbank";
    if (token === "privat_24" || token === "privat24" || token === "privat_bank") return "privatbank";
    if (token === "paypal_mcp") return "paypal";
    if (token === "google_sheets" || token === "other" || !token) return "unknown";
    return token;
  }

  function isKnownProviderSource(source) {
    return ["paypal", "wise", "monobank", "privatbank", "tdbank", "yoomoney", "provider", "mcp"].includes(normalizeLedgerSource(source));
  }

  function isManualLikeSource(source) {
    return ["manual", "fact", "migration", "photo", "unknown"].includes(normalizeLedgerSource(source));
  }

  function getChannel(row, type) {
    return String(type === "out" ? row.displayFromChannel : row.displayToChannel).trim();
  }

  function getSignedAmountUsd(row) {
    const explicit = parseAmount(read(row, "amount_usd", "amountUsd"));
    if (explicit) return roundAmount(explicit);
    const net = parseAmount(read(row, "amount_net", "amountNet", "balance_amount", "balanceAmount"));
    const currency = String(row.currency || "").trim().toUpperCase();
    if (!net || currency !== "USD") return 0;
    const operation = normalizeLegacyOperation(row.operation || row.legacy_operation);
    if (operation === "expense") return -Math.abs(net);
    if (operation === "income") return Math.abs(net);
    return roundAmount(net);
  }

  function getAbsUsd(row) {
    return Math.abs(getSignedAmountUsd(row));
  }

  function getGrossUsd(row) {
    const gross = parseAmount(read(row, "amount_gross", "amountGross"));
    if (gross) return Math.abs(gross);
    return getAbsUsd(row);
  }

  function getFeeUsd(row) {
    return Math.abs(parseAmount(read(row, "amount_fee", "amountFee")));
  }

  function isProfitIncome(row) {
    return normalizeLegacyOperation(row.operation || row.legacy_operation) === "income";
  }

  function isProfitExpense(row) {
    return normalizeLegacyOperation(row.operation || row.legacy_operation) === "expense";
  }

  function isExchange(row) {
    return normalizeLegacyOperation(row.operation || row.legacy_operation) === "exchange" ||
      normalizeToken(row.category || row.legacy_category) === "exchange";
  }

  function isTransfer(row) {
    return normalizeLegacyOperation(row.operation || row.legacy_operation) === "transfer";
  }

  function hasValue(row, ...keys) {
    return keys.some((key) => String(row?.[key] ?? "").trim() !== "");
  }

  function buildFinancialModel(rawRows = [], options = {}) {
    const rows = normalizeLedgerRows(rawRows);
    const totals = {
      netBalance: 0,
      grossRevenue: 0,
      providerFees: 0,
      netRevenue: 0,
      expenses: 0,
      profit: 0,
      planVsFactDelta: 0,
      dataWarnings: 0
    };
    const warnings = buildDataWarnings(rows, options);
    const byChannel = new Map();
    const byProvider = new Map();
    const byCategory = new Map();
    const exchange = { out: 0, in: 0, missingPairs: 0, rows: 0 };

    rows.forEach((row) => {
      const signedUsd = getSignedAmountUsd(row);
      const absUsd = Math.abs(signedUsd);
      if (signedUsd) totals.netBalance += signedUsd;

      if (isProfitIncome(row)) {
        totals.grossRevenue += getGrossUsd(row);
        totals.providerFees += getFeeUsd(row);
        totals.netRevenue += absUsd;
        addChannelFlow(byChannel, getChannel(row, "in"), { inflow: absUsd, rows: 1 });
      } else if (isProfitExpense(row)) {
        totals.expenses += absUsd;
        addChannelFlow(byChannel, getChannel(row, "out"), { outflow: absUsd, rows: 1 });
        addCategoryFlow(byCategory, row.displayCategory, absUsd);
      } else if (isExchange(row)) {
        exchange.rows += 1;
        if (signedUsd < 0) exchange.out += Math.abs(signedUsd);
        if (signedUsd > 0) exchange.in += signedUsd;
        addChannelFlow(byChannel, signedUsd < 0 ? getChannel(row, "out") : getChannel(row, "in"), {
          exchange: signedUsd,
          rows: 1
        });
      } else if (isTransfer(row)) {
        addChannelFlow(byChannel, signedUsd < 0 ? getChannel(row, "out") : getChannel(row, "in"), {
          transfer: signedUsd,
          rows: 1
        });
      }

      addProviderFlow(byProvider, row);
    });

    totals.grossRevenue = roundAmount(totals.grossRevenue);
    totals.providerFees = roundAmount(totals.providerFees);
    totals.netRevenue = roundAmount(totals.netRevenue);
    totals.expenses = roundAmount(totals.expenses);
    totals.netBalance = roundAmount(totals.netBalance);
    totals.profit = roundAmount(totals.netRevenue - totals.expenses);
    totals.planVsFactDelta = roundAmount(extractPlanVsFactDelta(options.planFactSummary));
    totals.dataWarnings = warnings.reduce((sum, row) => sum + row.count, 0);

    const exchangeDifference = roundAmount(exchange.in - exchange.out);
    exchange.missingPairs = exchange.rows && Math.abs(exchangeDifference) > 1 ? 1 : 0;

    return {
      rows,
      totals,
      cards: [
        ["Net Balance", totals.netBalance],
        ["Net Revenue", totals.netRevenue],
        ["Expenses", totals.expenses],
        ["Profit", totals.profit],
        ["Plan vs Fact Delta", totals.planVsFactDelta],
        ["Data Warnings", totals.dataWarnings]
      ],
      pnlRows: [
        ["Gross Revenue", totals.grossRevenue],
        ["Provider Fees", totals.providerFees],
        ["Net Revenue", totals.netRevenue],
        ["Expenses", totals.expenses],
        ["Profit", totals.profit]
      ],
      balancesByChannel: Array.from(byChannel.values()).sort((left, right) => left.channel.localeCompare(right.channel)),
      providerHealthRows: buildProviderHealthRows(byProvider),
      expenseCategoryRows: buildExpenseCategoryRows(byCategory, totals.expenses),
      planVsFactRows: buildPlanVsFactRows(options.planFactSummary, totals),
      exchangeControlRows: [[
        "Exchange Control",
        roundAmount(exchange.out),
        roundAmount(exchange.in),
        exchangeDifference,
        exchange.missingPairs,
        exchange.out ? roundAmount(exchangeDifference / exchange.out) : 0
      ]],
      warningRows: warnings,
      drilldownRows: rows.map(toSafeDisplayRow)
    };
  }

  function addChannelFlow(map, channel, patch) {
    const key = String(channel || "").trim();
    if (!key) return;
    const row = map.get(key) || { channel: key, startBalance: 0, inflow: 0, outflow: 0, transfer: 0, exchange: 0, endBalance: 0, rows: 0 };
    row.inflow += patch.inflow || 0;
    row.outflow += patch.outflow || 0;
    row.transfer += patch.transfer || 0;
    row.exchange += patch.exchange || 0;
    row.rows += patch.rows || 0;
    row.endBalance = roundAmount(row.startBalance + row.inflow - row.outflow + row.transfer + row.exchange);
    row.inflow = roundAmount(row.inflow);
    row.outflow = roundAmount(row.outflow);
    row.transfer = roundAmount(row.transfer);
    row.exchange = roundAmount(row.exchange);
    map.set(key, row);
  }

  function addProviderFlow(map, row) {
    const provider = getProviderLabel(row);
    const item = map.get(provider) || { provider, rows: 0, income: 0, expenses: 0, fees: 0, net: 0, lastImport: "", warnings: [] };
    const signedUsd = getSignedAmountUsd(row);
    item.rows += 1;
    if (isProfitIncome(row)) item.income += Math.abs(signedUsd);
    if (isProfitExpense(row)) item.expenses += Math.abs(signedUsd);
    item.fees += getFeeUsd(row);
    item.net += signedUsd;
    if (row.date && (!item.lastImport || row.date > item.lastImport)) item.lastImport = row.date;
    if (normalizeLedgerSource(row.source) === "unknown") item.warnings.push("unknown source");
    if (!hasValue(row, "amount_net", "amountNet")) item.warnings.push("missing amount_net");
    if (!hasValue(row, "amount_usd", "amountUsd")) item.warnings.push("missing amount_usd");
    if (provider === "PayPal" && isProfitIncome(row) && !hasValue(row, "amount_fee", "amountFee")) item.warnings.push("PayPal fee missing");
    map.set(provider, item);
  }

  function addCategoryFlow(map, category, amount) {
    const key = String(category || "other").trim() || "other";
    map.set(key, roundAmount((map.get(key) || 0) + amount));
  }

  function getProviderLabel(row) {
    const text = [
      normalizeLedgerSource(row.source),
      row.displayFromChannel,
      row.displayToChannel,
      row.displayExternalId
    ].join(" ").toLowerCase();
    const match = PROVIDER_LABELS.find(([key]) => text.includes(key));
    return match ? match[1] : "Manual";
  }

  function buildProviderHealthRows(map) {
    const labels = ["PayPal", "Wise", "TD", "Monobank", "PrivatBank", "Manual"];
    labels.forEach((label) => {
      if (!map.has(label)) map.set(label, { provider: label, rows: 0, income: 0, expenses: 0, fees: 0, net: 0, lastImport: "", warnings: [] });
    });
    return labels.map((label) => {
      const row = map.get(label);
      return {
        provider: label,
        rows: row.rows,
        income: roundAmount(row.income),
        expenses: roundAmount(row.expenses),
        fees: roundAmount(row.fees),
        net: roundAmount(row.net),
        lastImport: row.lastImport || "",
        warnings: [...new Set(row.warnings || [])].join(", ")
      };
    });
  }

  function buildExpenseCategoryRows(map, totalExpenses) {
    return Array.from(map.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, amount]) => ({
        category,
        amount: roundAmount(amount),
        percent: totalExpenses ? roundAmount((amount / totalExpenses) * 100) : 0
      }));
  }

  function buildDataWarnings(rows, options = {}) {
    const counts = {
      "unknown source": 0,
      "missing amount_net": 0,
      "missing amount_usd": 0,
      "fallback rows": Number(options.fallbackAmountRows || 0),
      "PayPal fee missing": 0,
      "exchange imbalance": 0
    };
    let exchangeIn = 0;
    let exchangeOut = 0;
    rows.forEach((row) => {
      const source = normalizeLedgerSource(row.source);
      const signedUsd = getSignedAmountUsd(row);
      if (source === "unknown") counts["unknown source"] += 1;
      if (!hasValue(row, "amount_net", "amountNet")) counts["missing amount_net"] += 1;
      if (!hasValue(row, "amount_usd", "amountUsd")) counts["missing amount_usd"] += 1;
      if (getProviderLabel(row) === "PayPal" && isProfitIncome(row) && !hasValue(row, "amount_fee", "amountFee")) {
        counts["PayPal fee missing"] += 1;
      }
      if (isExchange(row)) {
        if (signedUsd < 0) exchangeOut += Math.abs(signedUsd);
        if (signedUsd > 0) exchangeIn += signedUsd;
      }
    });
    if (exchangeIn || exchangeOut) counts["exchange imbalance"] = Math.abs(roundAmount(exchangeIn - exchangeOut)) > 1 ? 1 : 0;
    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
      status: count ? "warning" : "ok"
    }));
  }

  function extractPlanVsFactDelta(summary) {
    if (summary?.incomeTotals) return parseAmount(summary.incomeTotals.differenceUsd);
    return 0;
  }

  function buildPlanVsFactRows(summary, totals) {
    if (summary?.incomeTotals || summary?.expenseTotals) {
      return [
        buildPlanFactRow("Income", summary.incomeTotals?.plannedUsd, summary.incomeTotals?.realUsd),
        buildPlanFactRow("Expenses", summary.expenseTotals?.plannedUsd, summary.expenseTotals?.realUsd),
        buildPlanFactRow("Profit", (summary.incomeTotals?.plannedUsd || 0) - (summary.expenseTotals?.plannedUsd || 0), totals.profit)
      ];
    }
    return [
      buildPlanFactRow("Income", 0, totals.netRevenue),
      buildPlanFactRow("Expenses", 0, totals.expenses),
      buildPlanFactRow("Profit", 0, totals.profit)
    ];
  }

  function buildPlanFactRow(metric, plan, fact) {
    const planNumber = roundAmount(parseAmount(plan));
    const factNumber = roundAmount(parseAmount(fact));
    const delta = roundAmount(planNumber - factNumber);
    return {
      metric,
      plan: planNumber,
      fact: factNumber,
      delta,
      deltaPercent: planNumber ? roundAmount((delta / planNumber) * 100) : 0,
      status: Math.abs(delta) <= 1 ? "OK" : "CHECK"
    };
  }

  function toSafeDisplayRow(row) {
    return {
      date: row.date || "",
      operation: normalizeLegacyOperation(row.operation || row.legacy_operation),
      source: normalizeLedgerSource(row.source),
      from_channel: row.displayFromChannel || "",
      to_channel: row.displayToChannel || "",
      amount_usd: row.amount_usd || "",
      amount_gross: row.amount_gross || "",
      amount_fee: row.amount_fee || "",
      amount_net: row.amount_net || "",
      category: row.displayCategory || "",
      external_id: row.displayExternalId || "",
      comment: row.displayComment || ""
    };
  }

  global.EzohataLedgerAnalyticsHelper = {
    normalizeLedgerRows,
    normalizeLedgerRow: normalizeLedgerRowSafe,
    buildFinancialModel,
    getSignedAmountUsd,
    normalizeLedgerSource,
    normalizeLegacyOperation,
    isKnownProviderSource,
    isManualLikeSource,
    parseAmount,
    roundAmount
  };
})(typeof window !== "undefined" ? window : globalThis);
