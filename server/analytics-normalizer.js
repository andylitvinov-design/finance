const TOTAL_LABEL = "Итого";

const PLAN_HEADER = [
  "валюта",
  "пришло в местной валюте",
  "пришло в долларах",
  "затраты-мои",
  "затраты-мои-дол",
  "ушло",
  "обмен",
  "обмен_usd",
  "план-рост",
  "plan-profit",
];

const BALANCE_HEADER = [
  "валюта",
  "БЫЛО",
  "СТАЛО",
  "РОСТ",
  "Plan Profit",
  "разница1",
  "КОМИССИЯ",
  "доп расходы",
  "БАЛАНС",
  "Extra",
];

const MANUAL_MOVEMENT_HEADER = [
  "валюта",
  "now",
  "приход от услуг",
  "spent for business",
  "spent for flat",
  "spent for food",
  "spent for fun",
  "spent for study",
  "spent for travel",
  "затраты-мои",
  "обмен",
  "обмен_usd",
  "затраты-мои usd",
  "now_usd",
];

const FALLBACK_USD_RATES = {
  RUB: 1 / 84.5563,
  UAH: 1 / 43.86,
  EUR: 1.16,
  CAD: 0.74,
  LOCAL: 1 / 18,
};

const PAYMENT_RULE_CURRENCIES = {
  "Яндекс руб": "RUB",
  "пейпал дол": "USD",
  "пейпал евр": "EUR",
  "пейпал сad": "CAD",
  "приват 24-дол": "USD",
  "приват 24-евро": "EUR",
  "приват 24-грн": "UAH",
  "монобанк грн": "UAH",
  "Бинанс spot": "USD",
  "binance save": "USD",
  "БАНК КАНАДА cad": "CAD",
};

function resolveManualChannelAlias(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeCell(raw).replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  const aliases = [
    { pattern: /^(яндекс|yandex|yoomoney|юmoney|юмани|юмоней)( руб| rub| рубли| rubles)?$/, channel: "Яндекс руб" },
    { pattern: /^(пейпал|paypal)( дол| usd)?$/, channel: "пейпал дол" },
    { pattern: /^(пейпал|paypal)( евр| евро| eur)$/, channel: "пейпал евр" },
    { pattern: /^(пейпал|paypal)( cad| сad)$/, channel: "пейпал сad" },
    { pattern: /^(монобанк|monobank|mono)( грн| uah)?$/, channel: "монобанк грн" },
    { pattern: /^(приват|privat)( 24)?( грн| uah)?$/, channel: "приват 24-грн" },
    { pattern: /^(binance save|бинанс save|binance savings|бинанс сейв)$/, channel: "binance save" }
  ];
  return aliases.find((entry) => entry.pattern.test(normalized))?.channel || "";
}

function canonicalManualFinanceChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return Object.keys(PAYMENT_RULE_CURRENCIES).find((channel) => normalizeCell(channel) === normalizeCell(raw))
    || resolveManualChannelAlias(raw)
    || raw;
}

function getCanonicalManualChannelKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return canonicalManualFinanceChannel(raw) || raw;
}

function getCanonicalManualExpenseChannelKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return getCanonicalManualChannelKey(raw);
}

function getCanonicalManualAmounts(amounts = {}) {
  const canonical = {};
  Object.entries(amounts || {}).forEach(([channel, value]) => {
    const canonicalChannel = getCanonicalManualExpenseChannelKey(channel);
    if (!canonicalChannel) return;
    canonical[canonicalChannel] = (canonical[canonicalChannel] || 0) + parseLooseNumber(value);
  });
  return canonical;
}

export function normalizeServerAnalyticsPayload(data) {
  if (!data?.tabs?.analytics?.values?.length) return data;

  const values = data.tabs.analytics.values;
  const manualRows = buildManualRowsForPeriod(extractManualRows(values), data.manual || {}, data.period || {});
  const existingBalances = getPeriodBalanceRows(
    Array.isArray(data.manual?.balances) ? data.manual.balances : [],
    data.period || {}
  );
  const fallbackBalances = existingBalances.length ? existingBalances : buildBalancesFromManualRows(manualRows, data.period);
  const closingUsdLookup = buildClosingUsdLookup(fallbackBalances, manualRows);
  const normalizedAnalyticsValues = rebuildAnalyticsValues(values, manualRows, closingUsdLookup);

  return {
    ...data,
    manual: {
      ...(data.manual || {}),
      balances: fallbackBalances,
    },
    tabs: {
      ...data.tabs,
      analytics: {
        ...data.tabs.analytics,
        values: normalizedAnalyticsValues,
        rowCount: normalizedAnalyticsValues.length,
        columnCount: Math.max(
          data.tabs.analytics.columnCount || 0,
          ...normalizedAnalyticsValues.map((row) => row.length)
        ),
      },
    },
  };
}

export function extractManualRows(values) {
  const personalIndex = findTitleIndex(values, "Личные расходы");
  if (personalIndex === -1) return [];

  const header = values[personalIndex + 1] || [];
  const rows = [];
  for (let index = personalIndex + 2; index < values.length; index += 1) {
    const row = values[index] || [];
    if (!hasAnyValue(row)) break;

    const channel = getCanonicalManualChannelKey(row[0]);
    if (!channel || normalizeCell(channel) === normalizeCell(TOTAL_LABEL)) continue;

    rows.push({
      channel,
      now: row[findHeaderIndex(header, ["now"])] || "",
      business: row[findHeaderIndex(header, ["spent for business", "business"])] || "",
      food: row[findHeaderIndex(header, ["spent for food", "food"])] || "",
      flat: row[findHeaderIndex(header, ["spent for flat", "spent for house", "flat", "house"])] || "",
      fun: row[findHeaderIndex(header, ["spent for fun", "fun"])] || "",
      study: row[findHeaderIndex(header, ["spent for study", "study"])] || "",
      travel: row[findHeaderIndex(header, ["spent for travel/ fun", "spent for travel", "travel"])] || "",
      total: row[findHeaderIndex(header, ["затраты-мои", "total"])] || "",
      nowUsd: row[findHeaderIndex(header, ["now_usd", "now usd"])] || "",
      exchange: row[findHeaderIndex(header, ["обмен", "exchange"])] || "",
      exchangeUsd: row[findHeaderIndex(header, ["обмен_usd", "exchange_usd", "exchange usd"])] || "",
      currency: inferChannelCurrency(channel),
    });
  }
  return rows;
}

export function buildBalancesFromManualRows(manualRows, period = {}) {
  const date = normalizeDate(period?.endDate) || normalizeDate(period?.startDate) || "";
  return (manualRows || [])
    .filter((row) => parseLooseNumber(row.now))
    .map((row) => ({
      date,
      channel: row.channel,
      amount: row.now,
      currency: row.currency || inferChannelCurrency(row.channel),
      rate: "",
      usdAmount: row.nowUsd || "",
      accountName: row.channel,
      balanceAmount: row.now,
      source: "analytics-now-fallback",
    }));
}

export function buildClosingUsdLookup(balances, manualRows = []) {
  const manualLookup = new Map((manualRows || []).map((row) => [getCanonicalManualChannelKey(row.channel), row]));
  const lookup = {};

  (balances || []).forEach((entry) => {
    const channel = getCanonicalManualChannelKey(entry.channel || entry.accountName || "");
    if (!channel || normalizeCell(channel) === normalizeCell(TOTAL_LABEL)) return;

    const manualRow = manualLookup.get(channel);
    const amount = entry.amount ?? entry.balanceAmount ?? manualRow?.now ?? "";
    const currency = String(entry.currency || manualRow?.currency || inferChannelCurrency(channel)).trim().toUpperCase();
    const isAnalyticsFallback = entry.source === "analytics-now-fallback";
    const usdAmount = isAnalyticsFallback ? 0 : parseLooseNumber(entry.usdAmount || manualRow?.nowUsd || "");
    const localPerUsd = parseLooseNumber(entry.rate);
    const value = deriveUsdAmount(amount, currency, { usdAmount, localPerUsd });
    if (value) lookup[channel] = value;
  });

  (manualRows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    if (Object.prototype.hasOwnProperty.call(lookup, channel)) return;
    const value = deriveUsdAmount(row.now, row.currency || inferChannelCurrency(channel), {
      usdAmount: 0,
      localPerUsd: 0,
    });
    if (value) lookup[channel] = value;
  });

  return lookup;
}

export function rebuildAnalyticsValues(values, manualRows, closingUsdLookup) {
  let output = values.map((row) => row.slice());
  output = replaceSection(output, "Личные расходы", (section) => rebuildManualMovementSection(section, manualRows));
  output = replaceSection(output, "Plan", (section) => rebuildPlanSection(section, manualRows));
  output = replaceSection(output, "БАЛАНС", (section) => rebuildBalanceSection(section, closingUsdLookup));
  return output;
}

function rebuildManualMovementSection(section, manualRows) {
  const sourceChannels = section.rows
    .map((row) => getCanonicalManualChannelKey(row[0]))
    .filter((channel) => channel && normalizeCell(channel) !== normalizeCell(TOTAL_LABEL));
  const manualByChannel = new Map((manualRows || []).map((row) => [getCanonicalManualChannelKey(row.channel), row]));
  const channels = [...new Set([
    ...sourceChannels,
    ...(manualRows || [])
      .map((row) => getCanonicalManualChannelKey(row.channel))
      .filter((channel) => channel && normalizeCell(channel) !== normalizeCell(TOTAL_LABEL))
  ])];
  const rows = channels.map((channel) => {
    const row = manualByChannel.get(channel) || {};
    return [
      channel,
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
    ];
  });
  const totalRow = rows.reduce(
    (total, row) => {
      for (let index = 1; index < MANUAL_MOVEMENT_HEADER.length; index += 1) {
        total[index] += parseLooseNumber(row[index]);
      }
      return total;
    },
    [TOTAL_LABEL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  );
  rows.push(totalRow.map((value, index) => (index === 0 ? value : formatNumber(value))));
  return {
    title: section.title,
    header: MANUAL_MOVEMENT_HEADER,
    rows,
  };
}

function rebuildPlanSection(section, manualRows) {
  const rows = section.rows.map((row) => row.slice());
  const header = section.header || [];
  const localIndex = findHeaderIndex(header, ["пришло в местной валюте"]);
  const usdIndex = findHeaderIndex(header, ["пришло в долларах"]);
  const paidOutIndex = findHeaderIndex(header, ["ушло"]);
  const ownCostIndex = findHeaderIndex(header, ["затраты-мои"]);
  const ownCostUsdIndex = findHeaderIndex(header, ["затраты-мои-дол"]);
  const planGrowthIndex = findHeaderIndex(header, ["план-рост"]);
  const planProfitIndex = findHeaderIndex(header, ["plan-profit"]);
  const exchangeLookup = Object.fromEntries((manualRows || []).map((row) => [getCanonicalManualChannelKey(row.channel), row]));
  const ownCostTotal = (manualRows || []).reduce((sum, row) => sum + parseLooseNumber(row.total), 0);
  const ownCostUsdTotal = (manualRows || []).reduce((sum, row) => sum + parseLooseNumber(row.totalUsd), 0);
  const exchangeTotal = (manualRows || []).reduce((sum, row) => sum + parseLooseNumber(row.exchange), 0);
  const exchangeUsdTotal = (manualRows || []).reduce((sum, row) => sum + parseLooseNumber(row.exchangeUsd), 0);
  const rebuiltRows = rows.map((row) => {
    const channel = getCanonicalManualChannelKey(row[0]);
    const manual = normalizeCell(channel) === normalizeCell(TOTAL_LABEL)
      ? { total: ownCostTotal, totalUsd: ownCostUsdTotal, exchange: exchangeTotal, exchangeUsd: exchangeUsdTotal }
      : (exchangeLookup[channel] || {});
    const ownCost = parseLooseNumber(manual.total);
    const ownCostUsd = parseLooseNumber(manual.totalUsd);
    const exchange = parseLooseNumber(manual.exchange);
    const exchangeUsd = parseLooseNumber(manual.exchangeUsd);
    const existingPlanGrowth = readPlanNumber(row, planGrowthIndex, 5);
    const basePlanGrowth = existingPlanGrowth + exchangeUsd;
    const existingPlanProfit = readPlanNumber(row, planProfitIndex, 8);
    const baseOwnCostUsd = ownCostUsd || readPlanNumber(row, ownCostUsdIndex, 7);
    const planProfit = ownCostUsd || ownCost
      ? basePlanGrowth - baseOwnCostUsd
      : existingPlanProfit + exchangeUsd;
    return [
      row[0] || "",
      readPlanCell(row, localIndex, 1),
      readPlanCell(row, usdIndex, 2),
      ownCost ? formatNumber(ownCost) : readPlanCell(row, ownCostIndex, 6),
      ownCostUsd ? formatNumber(ownCostUsd) : readPlanCell(row, ownCostUsdIndex, 7),
      readPlanCell(row, paidOutIndex, 3),
      exchange ? formatNumber(exchange) : "",
      exchangeUsd ? formatNumber(exchangeUsd) : "",
      formatNumber(basePlanGrowth),
      formatNumber(planProfit),
    ];
  });
  return {
    title: section.title,
    header: PLAN_HEADER,
    rows: rebuiltRows,
  };
}

function buildManualRowsForPeriod(legacyRows, manual, period = {}) {
  const startDate = normalizeDate(period.startDate);
  const endDate = normalizeDate(period.endDate);
  const manualPeriodChannels = collectManualPeriodChannels(manual, { startDate, endDate });
  const lookup = new Map((legacyRows || []).map((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    return [channel, manualPeriodChannels.has(channel) ? resetManualPeriodFields(row, channel) : { ...row, channel }];
  }));
  const rateLookup = buildManualRateLookup(manual?.transfers || [], endDate);

  if (Array.isArray(manual?.operations) && manual.operations.length) {
    for (const operation of manual.operations) {
      const date = normalizeDate(operation?.date);
      if (!isDateInRange(date, startDate, endDate)) continue;
      const category = mapOperationToManualCategory(operation);
      if (category === "serviceIncome" && !shouldIncludeOperationInManualServiceIncome(operation)) continue;
      const channel = mapOperationToManualChannel(operation, category);
      const amount = mapOperationToManualAmount(operation, category);
      if (!category || !channel || amount === null) continue;
      const target = ensureManualRow(lookup, channel);
      if (category === "now") {
        target.now = formatNumber(Math.abs(amount));
        continue;
      }
      if (category === "exchange") {
        target.exchange = formatNumber(parseLooseNumber(target.exchange) + amount);
        target.exchangeUsd = formatNumber(parseLooseNumber(target.exchangeUsd) + deriveOperationUsdAmount(operation, amount, channel, rateLookup));
        continue;
      }
      if (!MANUAL_EXPENSE_CATEGORIES.has(category) && category !== "serviceIncome") continue;
      target[category] = formatNumber(parseLooseNumber(target[category]) + Math.abs(amount));
      if (category !== "serviceIncome") {
        target.total = formatNumber(parseLooseNumber(target.total) + Math.abs(amount));
        target.totalUsd = formatNumber(parseLooseNumber(target.totalUsd) + deriveOperationUsdAmount(operation, Math.abs(amount), channel, rateLookup));
      }
    }
    return Array.from(lookup.values());
  }

  for (const row of manual?.expenseRows || []) {
    const date = normalizeDate(row?.date);
    if (!isDateInRange(date, startDate, endDate)) continue;
    const category = normalizeManualCategory(row?.category);
    if (!category) continue;

    for (const [channel, amount] of Object.entries(getCanonicalManualAmounts(row.amounts || {}))) {
      if (!amount) continue;
      const target = ensureManualRow(lookup, channel);
      if (category === "now") {
        target.now = formatNumber(amount);
      } else if (category === "exchange") {
        const exchange = parseLooseNumber(target.exchange) + amount;
        target.exchange = formatNumber(exchange);
        const exchangeUsd = parseLooseNumber(target.exchangeUsd) + deriveManualUsdAmount(amount, channel, rateLookup);
        target.exchangeUsd = formatNumber(exchangeUsd);
      } else if (MANUAL_EXPENSE_CATEGORIES.has(category)) {
        const current = parseLooseNumber(target[category]);
        target[category] = formatNumber(current + amount);
        const total = parseLooseNumber(target.total) + amount;
        target.total = formatNumber(total);
        const totalUsd = parseLooseNumber(target.totalUsd) + deriveManualUsdAmount(amount, channel, rateLookup);
        target.totalUsd = formatNumber(totalUsd);
      }
    }
  }

  return Array.from(lookup.values());
}

function collectManualPeriodChannels(manual, period = {}) {
  const startDate = normalizeDate(period.startDate);
  const endDate = normalizeDate(period.endDate);
  const channels = new Set();
  if (Array.isArray(manual?.operations) && manual.operations.length) {
    for (const operation of manual.operations) {
      const date = normalizeDate(operation?.date);
      if (!isDateInRange(date, startDate, endDate)) continue;
      const category = mapOperationToManualCategory(operation);
      if (category === "serviceIncome" && !shouldIncludeOperationInManualServiceIncome(operation)) continue;
      if (!category || category === "now") continue;
      const channel = mapOperationToManualChannel(operation, category);
      const amount = mapOperationToManualAmount(operation, category);
      if (!channel || amount === null) continue;
      channels.add(channel);
    }
    return channels;
  }
  for (const row of manual?.expenseRows || []) {
    const date = normalizeDate(row?.date);
    if (!isDateInRange(date, startDate, endDate)) continue;
    const category = normalizeManualCategory(row?.category);
    if (!category || category === "now") continue;
    for (const [channel, amount] of Object.entries(getCanonicalManualAmounts(row.amounts || {}))) {
      if (amount) channels.add(channel);
    }
  }
  return channels;
}

function resetManualPeriodFields(row, channel) {
  return {
    channel,
    now: row?.now || "",
    nowUsd: row?.nowUsd || "",
    currency: row?.currency || inferChannelCurrency(channel),
    serviceIncome: "",
    business: "",
    food: "",
    flat: "",
    fun: "",
    study: "",
    travel: "",
    total: "",
    totalUsd: "",
    exchange: "",
    exchangeUsd: "",
  };
}

const MANUAL_EXPENSE_CATEGORIES = new Set(["business", "flat", "food", "fun", "study", "travel"]);

function ensureManualRow(lookup, channel) {
  const normalizedChannel = getCanonicalManualChannelKey(channel);
  if (!lookup.has(normalizedChannel)) {
    lookup.set(normalizedChannel, {
      channel: normalizedChannel,
      now: "",
      business: "",
      food: "",
      flat: "",
      fun: "",
      study: "",
      travel: "",
      total: "",
      totalUsd: "",
      nowUsd: "",
      exchange: "",
      exchangeUsd: "",
      currency: inferChannelCurrency(normalizedChannel),
    });
  }
  return lookup.get(normalizedChannel);
}

function buildManualRateLookup(transfers, endDate) {
  const byChannel = {};
  const byCurrency = {};
  for (const row of transfers || []) {
    const date = normalizeDate(row?.transferDate || row?.date);
    if (endDate && date && date > endDate) continue;
    const amount = parseLooseNumber(row?.amount);
    const usdAmount = parseLooseNumber(row?.usdAmount);
    if (!amount || !usdAmount) continue;
    const channel = getCanonicalManualChannelKey(row?.channel || row?.destination || "");
    const currency = String(row?.currency || row?.localCurrency || inferChannelCurrency(channel)).trim().toUpperCase();
    const usdPerLocal = usdAmount / amount;
    if (channel) addRate(byChannel, channel, usdPerLocal);
    if (currency) addRate(byCurrency, currency, usdPerLocal);
  }
  return {
    byChannel: averageRates(byChannel),
    byCurrency: { ...FALLBACK_USD_RATES, ...averageRates(byCurrency) },
  };
}

function addRate(lookup, key, rate) {
  if (!key || !Number.isFinite(rate) || rate <= 0) return;
  if (!lookup[key]) lookup[key] = [];
  lookup[key].push(rate);
}

function averageRates(lookup) {
  return Object.fromEntries(
    Object.entries(lookup).map(([key, values]) => [key, values.reduce((sum, value) => sum + value, 0) / values.length])
  );
}

function deriveManualUsdAmount(amount, channel, rateLookup) {
  const currency = inferChannelCurrency(channel);
  if (currency === "USD") return amount;
  const rate = parseLooseNumber(rateLookup.byChannel?.[channel]) ||
    parseLooseNumber(rateLookup.byCurrency?.[currency]) ||
    FALLBACK_USD_RATES[currency] ||
    FALLBACK_USD_RATES.LOCAL;
  return amount * rate;
}

function deriveOperationUsdAmount(operation, amount, channel, rateLookup) {
  const rawExplicitUsd = String(operation?.amountUsd || "").trim();
  if (rawExplicitUsd) return normalizeExchangeUsdSign(parseLooseNumber(rawExplicitUsd), operation);
  const currency = String(operation?.currency || inferChannelCurrency(channel)).trim().toUpperCase();
  if (currency === "USD") return normalizeExchangeUsdSign(amount, operation);
  const rate = parseLooseNumber(operation?.rate) ||
    parseLooseNumber(rateLookup.byCurrency?.[currency]) ||
    parseLooseNumber(rateLookup.byChannel?.[channel]) ||
    FALLBACK_USD_RATES[currency] ||
    FALLBACK_USD_RATES.LOCAL;
  return rate ? normalizeExchangeUsdSign(amount * rate, operation) : 0;
}

function normalizeExchangeUsdSign(amountUsd, operation) {
  const numeric = parseLooseNumber(amountUsd);
  const operationName = normalizeCell(operation?.operation);
  if (operationName === "exchange_out") return -Math.abs(numeric);
  if (operationName === "exchange_in") return Math.abs(numeric);
  return numeric;
}

function getPeriodBalanceRows(balances, period = {}) {
  const endDate = normalizeDate(period.endDate);
  const latestByChannel = new Map();
  for (const row of balances || []) {
    const date = normalizeDate(row?.date);
    if (endDate && date && date > endDate) continue;
    const channel = getCanonicalManualChannelKey(row?.channel || row?.accountName || "");
    if (!channel) continue;
    const previous = latestByChannel.get(channel);
    if (!previous || String(date).localeCompare(String(normalizeDate(previous.date))) >= 0) {
      latestByChannel.set(channel, {
        ...row,
        channel,
        accountName: channel
      });
    }
  }
  return Array.from(latestByChannel.values());
}

function normalizeManualCategory(value) {
  const normalized = normalizeCell(value);
  if (normalized === "now" || normalized === "стало" || normalized === "остаток сейчас") return "now";
  if (/service|servicein|приход/.test(normalized)) return "serviceIncome";
  if (/ezoin|ezohata|ezofact/.test(normalized)) return "serviceIncome";
  if (/business|бизнес/.test(normalized)) return "business";
  if (/flat|house|rent|кварт|дом|аренд/.test(normalized)) return "flat";
  if (/food|еда/.test(normalized)) return "food";
  if (/travel|study|учеб|обуч|курс|школ|путеш/.test(normalized)) return "travel";
  if (/fun|event|beauty|развлеч/.test(normalized)) return "fun";
  if (/exchange|обмен/.test(normalized)) return "exchange";
  if (/extra|unclear|other/.test(normalized)) return "business";
  return normalized;
}

function mapOperationToManualCategory(operation) {
  const category = normalizeManualCategory(operation?.category);
  const op = normalizeCell(operation?.operation);
  if (category === "serviceIncome") return "serviceIncome";
  if (["business", "flat", "food", "fun", "study", "travel", "exchange", "now"].includes(category)) return category;
  if (op === "income") return "serviceIncome";
  if (op === "exchange" || op === "обмен" || op === "exchange_in" || op === "exchange_out") return "exchange";
  if (op === "expense" || op === "расход" || op === "business_expense" || op === "personal_expense") return category || "business";
  if (op === "partner_transfer") return "exchange";
  if (op === "balance") return "now";
  return "";
}

function mapOperationToManualChannel(operation, category) {
  const amount = parseLooseNumber(operation?.amount);
  if (category === "serviceIncome") return getCanonicalManualExpenseChannelKey(operation?.toChannel || operation?.fromChannel || "");
  if (category === "exchange") {
    const op = normalizeCell(operation?.operation);
    if (op === "exchange_out") return getCanonicalManualExpenseChannelKey(operation?.fromChannel || operation?.toChannel || "");
    if (op === "exchange_in") return getCanonicalManualExpenseChannelKey(operation?.toChannel || operation?.fromChannel || "");
    if (amount < 0) return getCanonicalManualExpenseChannelKey(operation?.fromChannel || operation?.toChannel || "");
    if (amount > 0) return getCanonicalManualExpenseChannelKey(operation?.toChannel || operation?.fromChannel || "");
    return getCanonicalManualExpenseChannelKey(operation?.fromChannel || operation?.toChannel || "");
  }
  return getCanonicalManualExpenseChannelKey(operation?.fromChannel || operation?.toChannel || "");
}

function mapOperationToManualAmount(operation, category) {
  const amount = parseLooseNumber(operation?.amount);
  if (amount === 0 && String(operation?.amount || "").trim() === "") return null;
  if (category === "exchange") {
    const op = normalizeCell(operation?.operation);
    if (op === "exchange_out") return -Math.abs(amount);
    if (op === "exchange_in") return Math.abs(amount);
    return amount;
  }
  return Math.abs(amount);
}

function shouldIncludeOperationInManualServiceIncome(operation) {
  const source = normalizeCell(operation?.source);
  return !source || ["manual", "fact", "migration"].includes(source);
}

function isDateInRange(date, startDate, endDate) {
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function readPlanCell(row, index, fallbackIndex) {
  const value = index === -1 ? row[fallbackIndex] : row[index];
  return value || "";
}

function readPlanNumber(row, index, fallbackIndex) {
  return parseLooseNumber(readPlanCell(row, index, fallbackIndex));
}

function rebuildBalanceSection(section, closingUsdLookup) {
  const sourceRows = section.rows.filter((row) => {
    const channel = getCanonicalManualChannelKey(row[0]);
    return channel && normalizeCell(channel) !== normalizeCell(TOTAL_LABEL);
  });
  const rows = sourceRows.map((row) => {
    const channel = getCanonicalManualChannelKey(row[0]);
    const opening = parseLooseNumber(row[1]);
    const closing = Object.prototype.hasOwnProperty.call(closingUsdLookup, channel)
      ? closingUsdLookup[channel]
      : parseLooseNumber(row[2]);
    const planProfit = parseLooseNumber(row[4]);
    const commission = parseLooseNumber(row[6]);
    const balance = parseLooseNumber(row[8]);
    const growth = closing - opening;
    const difference = growth - planProfit;
    const additionalExpenses = difference - commission;
    const extra = additionalExpenses - balance;
    return [
      channel,
      formatNumber(opening),
      formatNumber(closing),
      formatNumber(growth),
      formatNumber(planProfit),
      formatNumber(difference),
      formatNumber(commission),
      formatNumber(additionalExpenses),
      formatNumber(balance),
      formatNumber(extra),
    ];
  });
  const totalRow = rows.reduce(
    (total, row) => {
      for (let index = 1; index < BALANCE_HEADER.length; index += 1) {
        total[index] += parseLooseNumber(row[index]);
      }
      return total;
    },
    [TOTAL_LABEL, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  );

  const formattedTotalRow = totalRow.map((value, index) => (index === 0 ? value : formatNumber(value)));
  const openingTotal = totalRow[1];
  const closingTotal = totalRow[2];

  return {
    title: section.title,
    header: BALANCE_HEADER,
    rows: [
      ...rows,
      formattedTotalRow,
      [
        "ОСТАТОК",
        formatNumber(openingTotal),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
      [
        "ВСЕГО",
        "",
        formatNumber(openingTotal + closingTotal),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ],
  };
}

function replaceSection(values, title, builder) {
  const start = findTitleIndex(values, title);
  if (start === -1) return values;

  let end = start + 1;
  while (end < values.length) {
    if (end > start && isBlankRow(values[end])) break;
    end += 1;
  }

  const header = values[start + 1] || [];
  const rows = values.slice(start + 2, end).filter((row) => hasAnyValue(row));
  const section = builder({ title: values[start][0], header, rows });
  const replacement = [
    [section.title],
    section.header.slice(),
    ...section.rows.map((row) => row.slice()),
  ];
  return [
    ...values.slice(0, start),
    ...replacement,
    ...values.slice(end),
  ];
}

function deriveUsdAmount(amount, currency, options = {}) {
  const numeric = parseLooseNumber(amount);
  if (!numeric) return 0;
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (normalizedCurrency === "USD") return numeric;
  if (options.localPerUsd) return numeric / options.localPerUsd;
  if (options.usdAmount && Math.abs(options.usdAmount - numeric) > 0.0001) return options.usdAmount;
  const rate = FALLBACK_USD_RATES[normalizedCurrency] || FALLBACK_USD_RATES.LOCAL;
  return numeric * rate;
}

function inferChannelCurrency(channel) {
  const normalized = String(channel || "").trim();
  if (!normalized) return "USD";
  if (PAYMENT_RULE_CURRENCIES[normalized]) return PAYMENT_RULE_CURRENCIES[normalized];
  if (/руб/i.test(normalized)) return "RUB";
  if (/грн/i.test(normalized)) return "UAH";
  if (/(евр|eur|euro)/i.test(normalized)) return "EUR";
  if (/(cad|канада)/i.test(normalized)) return "CAD";
  if (/(дол|usd|binance|payoneer - dol|revolut)/i.test(normalized)) return "USD";
  return "LOCAL";
}

function findTitleIndex(values, title) {
  const expected = normalizeCell(title);
  return (values || []).findIndex((row) => normalizeCell(row?.[0]) === expected);
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(4).replace(".", ",");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const isoDatePrefix = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  return isoDatePrefix ? isoDatePrefix[1] : "";
}

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function hasAnyValue(row) {
  return (row || []).some((cell) => String(cell || "").trim());
}

function isBlankRow(row) {
  return !hasAnyValue(row);
}
