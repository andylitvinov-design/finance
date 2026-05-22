// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function getAnalyticsMergedValues() {
  const baseValues = state.data?.tabs?.analytics?.values || [];
  const factMoneyRows = state.analyticsFact?.moneyRows || [];
  const factTransferRows = state.analyticsFact?.transferRows || [];
  const values = factMoneyRows.length
    ? buildFullRangeBasedAnalyticsValuesFromClosedFact(
        baseValues,
        state.data?.tabs?.movement?.values || [],
        state.data?.tabs?.payouts?.values || [],
        state.data?.tabs?.savings?.values || [],
        {
          rows: buildAnalyticsManualRowsFromFactMoneyRows(factMoneyRows, factTransferRows),
          transferRows: buildAnalyticsTransfersFromFactRows(factTransferRows),
          selectedSheets: []
        }
      )
    : baseValues;
  return normalizePlanGrowthFormula(values);
}

function getServiceIncomeLookup() {
  const stats = calculateMovementChannelStats(state.data?.tabs?.movement?.values || []);
  const byChannel = { ...(stats.usdByChannel || {}) };
  const total = Object.values(byChannel).reduce((sum, value) => sum + parseLooseNumber(value), 0);
  return { byChannel, total };
}

function getServiceIncomeValueByChannel(channel, lookup = getServiceIncomeLookup()) {
  const normalizedChannel = String(channel || "").trim();
  if (!normalizedChannel) return formatSheetNumber(0);
  if (normalizedChannel === MANUAL_FINANCE_TOTAL_LABEL) return formatSheetNumber(lookup.total || 0);
  return formatSheetNumber(lookup.byChannel?.[normalizedChannel] || 0);
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function getManualFinanceDisplayHeaders(headers = MANUAL_FINANCE_HEADERS) {
  const source = Array.isArray(headers) && headers.length ? headers.slice() : MANUAL_FINANCE_HEADERS.slice();
  const hasServiceIncomeColumn = /(service|приход)/i.test(String(source[2] || "").trim());
  const base = hasServiceIncomeColumn
    ? [
        source[0] || "канал",
        source[1] || "now",
        "приход от услуг",
        source[3] || "spent for business",
        source[4] || "spent for flat",
        source[5] || "spent for food",
        source[6] || "spent for fun",
        source[7] || "spent for study",
        source[8] || "spent for travel",
        source[9] || "затраты-мои",
        source[10] || "обмен"
      ]
    : [source[0] || "канал", source[1] || "now", "приход от услуг", ...source.slice(2)];
  return [...base, "обмен_usd", "затраты-мои usd", "now_usd"];
}


// ============================================================
// CURRENCY RATES
// ============================================================

function inferManualFinanceChannelCurrency(channel) {
  const normalized = String(channel || "").trim();
  if (!normalized) return "USD";
  if (ANALYTICS_PAYMENT_RULES[normalized]?.currency) return ANALYTICS_PAYMENT_RULES[normalized].currency;
  if (/руб/i.test(normalized)) return "RUB";
  if (/грн/i.test(normalized)) return "UAH";
  if (/(евр|eur|euro)/i.test(normalized)) return "EUR";
  if (/(фунт|gbp|pound)/i.test(normalized)) return "GBP";
  if (/(франк|chf|franc)/i.test(normalized)) return "CHF";
  if (/(cad|сad|канада)/i.test(normalized)) return "CAD";
  if (/(дол|usd|binance|payoneer - dol|revolut)/i.test(normalized)) return "USD";
  return "LOCAL";
}

function buildLatestMovementUsdRateLookup(movementValues = [], endDate = "") {
  if (!Array.isArray(movementValues) || !movementValues.length) return {};
  const header = movementValues[0] || [];
  const dateIndex = findHeaderIndexByAliases(header, ["DATE", "дата"]);
  const cutoff = endDate ? parseDisplayDate(endDate) : null;
  const rateIndexes = {
    RUB: findHeaderIndexByAliases(header, ["RUB RATE", "курс руб", "к-р"]),
    UAH: findHeaderIndexByAliases(header, ["UAH RATE", "курс грн", "к-гр"]),
    EUR: findHeaderIndexByAliases(header, ["EUR RATE", "курс евро", "к-евро"]),
    CAD: findHeaderIndexByAliases(header, ["CAD RATE", "курс cad", "курс канада"])
  };
  const latest = {};
  (movementValues || []).slice(1).forEach((row, rowIndex) => {
    if (!hasAnyValue(row)) return;
    const parsedDate = dateIndex === -1 ? null : parseDisplayDate(row[dateIndex]);
    if (cutoff && parsedDate && parsedDate > cutoff) return;
    const timestamp = parsedDate ? parsedDate.getTime() : rowIndex;
    Object.entries(rateIndexes).forEach(([currency, rateIndex]) => {
      if (rateIndex === -1 || rateIndex >= row.length) return;
      const localPerUsd = parseLooseNumber(row[rateIndex]);
      if (!localPerUsd) return;
      if (latest[currency] && latest[currency].timestamp > timestamp) return;
      latest[currency] = { timestamp, usdPerLocal: 1 / localPerUsd };
    });
  });
  return Object.fromEntries(Object.entries(latest).map(([currency, row]) => [currency, row.usdPerLocal]));
}

function buildManualFinanceUsdRateLookup(transferRows = [], movementValues = [], options = {}) {
  const channelRates = {};
  const currencyRates = {};
  const latestMovementRates = buildLatestMovementUsdRateLookup(movementValues, options.endDate || "");

  const addRate = (bucket, key, rate) => {
    if (!key || !Number.isFinite(rate) || rate <= 0) return;
    if (!bucket[key]) bucket[key] = [];
    bucket[key].push(rate);
  };

  normalizeManualFinanceTransferRows(transferRows, { padToMinimum: false }).forEach((row) => {
    const amount = parseLooseNumber(row.amount);
    const usdAmount = parseLooseNumber(row.usdAmount);
    const derivedRate = amount > 0 && usdAmount > 0 ? usdAmount / amount : 0;
    const channel = getCanonicalManualChannelKey(row.channel);
    const currency = String(row.currency || "").trim().toUpperCase() || inferManualFinanceChannelCurrency(channel);
    addRate(channelRates, channel, derivedRate);
    addRate(currencyRates, currency, derivedRate);
  });

  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    byChannel: Object.fromEntries(
      Object.entries(channelRates).map(([channel, values]) => [channel, average(values)])
    ),
    byCurrency: {
      ...MANUAL_FINANCE_FALLBACK_USD_RATES,
      ...Object.fromEntries(
        Object.entries(currencyRates).map(([currency, values]) => [currency, average(values)])
      ),
      ...latestMovementRates
    }
  };
}

function getLocalPerUsdRate(currency, rateLookup = { byCurrency: {} }) {
  const usdPerLocal = parseLooseNumber(rateLookup.byCurrency?.[currency]);
  if (!usdPerLocal) return 0;
  return currency === "USD" ? 1 : 1 / usdPerLocal;
}

function getManualFinanceDisplayRates(rateLookup = { byCurrency: {} }) {
  return [
    { label: "рубль", currency: "RUB" },
    { label: "грн", currency: "UAH" },
    { label: "евро", currency: "EUR" },
    { label: "канадский доллар", currency: "CAD" }
  ].map((row) => ({
    ...row,
    rate: getLocalPerUsdRate(row.currency, rateLookup)
  }));
}

function getManualFinanceUsdPerLocalRate(row, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const channel = getCanonicalManualChannelKey(row?.channel);
  const currency = inferManualFinanceChannelCurrency(channel);
  if (currency === "USD") return 1;
  return parseLooseNumber(rateLookup.byCurrency?.[currency]) ||
    parseLooseNumber(rateLookup.byChannel?.[channel]) ||
    MANUAL_FINANCE_FALLBACK_USD_RATES[currency] ||
    0;
}

function getManualFinanceTotalUsdValue(row, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const total = parseLooseNumber(row?.total);
  if (!total) return formatSheetNumber(0);
  const currency = inferManualFinanceChannelCurrency(row?.channel);
  const rate = getManualFinanceUsdPerLocalRate(row, rateLookup);
  if (currency === "USD") return formatSheetNumber(total);
  if (!rate) return "";
  return formatSheetNumber(total * rate);
}

function getManualFinanceNowUsdValue(row, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const now = parseLooseNumber(row?.now);
  if (!now) return formatSheetNumber(0);
  const currency = inferManualFinanceChannelCurrency(row?.channel);
  const rate = getManualFinanceUsdPerLocalRate(row, rateLookup);
  if (currency === "USD") return formatSheetNumber(now);
  if (!rate) return "";
  return formatSheetNumber(now * rate);
}

function getManualFinanceExchangeUsdValue(row, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const exchange = parseLooseNumber(row?.exchange);
  if (!exchange) return formatSheetNumber(0);
  const currency = inferManualFinanceChannelCurrency(row?.channel);
  const rate = getManualFinanceUsdPerLocalRate(row, rateLookup);
  if (currency === "USD") return formatSheetNumber(exchange);
  if (!rate) return "";
  return formatSheetNumber(exchange * rate);
}

function getManualFinanceFieldUsdNumber(row, key, rateLookup = { byChannel: {}, byCurrency: {} }, options = {}) {
  const amount = options.rows
    ? evaluateManualFinanceCellNumericValue(options.rows, options.rowIndex || 0, key)
    : getManualFinanceComputedAmount(row?.[key]);
  if (!amount) return 0;
  const currency = inferManualFinanceChannelCurrency(row?.channel);
  if (currency === "USD") return amount;
  const rate = getManualFinanceUsdPerLocalRate(row, rateLookup);
  return rate ? amount * rate : 0;
}

function sumManualFinanceFieldUsdNumber(rows, key, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const normalized = normalizeManualFinanceMoneyRows(rows);
  return normalized.reduce((sum, row, rowIndex) => {
    if (!row?.channel || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return sum;
    return sum + getManualFinanceFieldUsdNumber(row, key, rateLookup, { rows: normalized, rowIndex });
  }, 0);
}

function getManualFinanceSpendUsdNumber(row, rateLookup = { byChannel: {}, byCurrency: {} }, options = {}) {
  return ["business", "house", "food", "fun", "study", "travelFun"].reduce(
    (sum, key) => sum + getManualFinanceFieldUsdNumber(row, key, rateLookup, options),
    0
  );
}

function sumManualFinanceSpendUsdNumber(rows, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const normalized = normalizeManualFinanceMoneyRows(rows);
  return normalized.reduce((sum, row, rowIndex) => {
    if (!row?.channel || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return sum;
    return sum + getManualFinanceSpendUsdNumber(row, rateLookup, { rows: normalized, rowIndex });
  }, 0);
}

function normalizeLedgerClassifierText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isTransferOrExchangeRow(row) {
  const operation = normalizeLedgerClassifierText(row?.operation || row?.ledgerV2?.operation);
  const category = normalizeLedgerClassifierText(row?.category || row?.ledgerV2?.category);
  const direction = normalizeLedgerClassifierText(row?.direction || row?.ledgerV2?.direction);
  const text = normalizeLedgerClassifierText([
    row?.comment,
    row?.description,
    row?.ledgerV2?.comment,
    row?.ledgerV2?.description
  ].filter(Boolean).join(" "));
  if (/(^| )(transfer|transfer in|transfer out|partner transfer|internal movement|exchange|exchange in|exchange out)( |$)/.test(operation)) return true;
  if (/(^| )(перевод|обмен)( |$)/.test(operation)) return true;
  if (category === "exchange" || category === "partner") return true;
  if (/^(in|out)$/.test(direction) && /перевод|обмен|internal movement|sent money/.test(text)) return true;
  return /перевод|обмен|internal movement/.test(text);
}

function normalizeMetricPeriodDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (typeof normalizeIncomingSheetDateValue === "function") return normalizeIncomingSheetDateValue(raw);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const display = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
  return raw.slice(0, 10);
}

function isMetricRowInPeriod(row, period = {}) {
  const startDate = normalizeMetricPeriodDate(period.startDate || period.from || "");
  const endDate = normalizeMetricPeriodDate(period.endDate || period.to || "");
  if (!startDate && !endDate) return true;
  const date = normalizeMetricPeriodDate(row?.date || row?.operationDate || row?.transactionDate || row?.createdAt || row?.created_at || "");
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function getLedgerMetricAmountUsd(row) {
  const raw = String(row?.amountUsd ?? row?.amount_usd ?? row?.ledgerV2?.amount_usd ?? "").trim();
  if (raw) return parseLooseNumber(raw);
  return parseLooseNumber(row?.amount ?? row?.ledgerV2?.amount);
}

function calculateTransferBalance(rows = [], period = {}) {
  return (Array.isArray(rows) ? rows : []).reduce((totals, row) => {
    if (!isTransferOrExchangeRow(row) || !isMetricRowInPeriod(row, period)) return totals;
    const operation = normalizeLedgerClassifierText(row?.operation || row?.ledgerV2?.operation);
    const category = normalizeLedgerClassifierText(row?.category || row?.ledgerV2?.category);
    const text = normalizeLedgerClassifierText([
      row?.comment,
      row?.description,
      row?.ledgerV2?.comment,
      row?.ledgerV2?.description
    ].filter(Boolean).join(" "));
    const transferLike = /(^| )(transfer|transfer in|transfer out|partner transfer|internal movement)( |$)/.test(operation)
      || /перевод|internal movement|internal account|partner transfer|\btransfer\b/.test(text);
    const exchangeLike = operation.includes("exchange") || category === "exchange" || /(^| )обмен( |$)/.test(operation) || /(^| )обмен( |$)/.test(text);
    if (exchangeLike && !transferLike) return totals;
    if (!transferLike) return totals;
    const amountUsd = getLedgerMetricAmountUsd(row);
    const direction = normalizeLedgerClassifierText(row?.direction || row?.ledgerV2?.direction);
    const isIn = direction === "in" || operation === "transfer in" || amountUsd > 0;
    const absAmount = Math.abs(amountUsd);
    if (!absAmount) return totals;
    if (isIn) totals.transferIn += absAmount;
    else totals.transferOut += absAmount;
    totals.transferBalance = totals.transferIn - totals.transferOut;
    return totals;
  }, { transferIn: 0, transferOut: 0, transferBalance: 0 });
}


// ============================================================
// HELPERS
// ============================================================

function normalizePlanGrowthFormula(values) {
  const output = clone2dArray(values || []);
  const exchangeLookup = buildAnalyticsExchangeLookup(output);
  for (let index = 0; index < output.length; index += 1) {
    if (normalizeCell(output[index]?.[0]) !== normalizeCell("Plan")) continue;
    const header = output[index + 1] || [];
    let exchangeIndex = findHeaderIndexByAliases(header, ["обмен", "exchange", "комиссии"]);
    if (exchangeIndex !== -1) header[exchangeIndex] = "обмен";
    if (exchangeIndex === -1) {
      const planGrowthIndex = findHeaderIndexByAliases(header, ["план-рост"]);
      exchangeIndex = planGrowthIndex === -1 ? header.length : planGrowthIndex;
      insertAnalyticsColumn(output, index + 1, exchangeIndex, "обмен");
    }
    let exchangeUsdIndex = findHeaderIndexByAliases(header, ["обмен_usd", "exchange_usd"]);
    if (exchangeUsdIndex === -1) {
      exchangeUsdIndex = exchangeIndex + 1;
      insertAnalyticsColumn(output, index + 1, exchangeUsdIndex, "обмен_usd");
    }
    const usdIndex = findHeaderIndexByAliases(header, ["пришло в долларах"]);
    const paidOutIndex = findHeaderIndexByAliases(header, ["ушло"]);
    const planGrowthIndex = findHeaderIndexByAliases(header, ["план-рост"]);
    const ownCostUsdIndex = findHeaderIndexByAliases(header, ["затраты-мои-дол", "затраты-мои usd"]);
    const planProfitIndex = findHeaderIndexByAliases(header, ["plan-profit"]);
    if (usdIndex === -1 || paidOutIndex === -1 || planGrowthIndex === -1) continue;
    let totalExchange = 0;
    let totalExchangeUsd = 0;
    let totalPaidOut = 0;
    let totalPlanGrowth = 0;
    let cursor = index + 2;
    while (cursor < output.length && hasAnyValue(output[cursor])) {
      const row = output[cursor];
      const label = normalizeCell(row[0]);
      if (label !== normalizeCell("Итого движение")) {
        const channel = String(row[0] || "").trim();
        const lookup = exchangeLookup[channel] || {};
        if (!String(row[exchangeIndex] ?? "").trim() && lookup.exchange !== undefined) {
          row[exchangeIndex] = formatSheetNumber(lookup.exchange);
        }
        if (!String(row[exchangeUsdIndex] ?? "").trim() && lookup.exchangeUsd !== undefined) {
          row[exchangeUsdIndex] = formatSheetNumber(lookup.exchangeUsd);
        }
        const exchange = parseLooseNumber(row[exchangeIndex]);
        const exchangeUsd = parseLooseNumber(row[exchangeUsdIndex]);
        const paidOut = normalizePayoutAmount(row[paidOutIndex]);
        row[paidOutIndex] = formatSheetNumber(paidOut);
        const planGrowth = parseLooseNumber(row[usdIndex]) + paidOut + exchangeUsd;
        row[planGrowthIndex] = formatSheetNumber(planGrowth);
        if (planProfitIndex !== -1 && ownCostUsdIndex !== -1) {
          row[planProfitIndex] = formatSheetNumber(planGrowth - parseLooseNumber(row[ownCostUsdIndex]));
        }
        if (label !== normalizeCell(MANUAL_FINANCE_TOTAL_LABEL)) {
          totalExchange += exchange;
          totalExchangeUsd += exchangeUsd;
          totalPaidOut += paidOut;
          totalPlanGrowth += planGrowth;
        } else {
          row[paidOutIndex] = formatSheetNumber(totalPaidOut);
          row[exchangeIndex] = formatSheetNumber(totalExchange);
          row[exchangeUsdIndex] = formatSheetNumber(totalExchangeUsd);
          row[planGrowthIndex] = formatSheetNumber(totalPlanGrowth);
          if (planProfitIndex !== -1 && ownCostUsdIndex !== -1) {
            row[planProfitIndex] = formatSheetNumber(totalPlanGrowth - parseLooseNumber(row[ownCostUsdIndex]));
          }
        }
      }
      cursor += 1;
    }
  }
  return output;
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function insertAnalyticsColumn(values, headerRowIndex, columnIndex, headerLabel) {
  values[headerRowIndex].splice(columnIndex, 0, headerLabel);
  let cursor = headerRowIndex + 1;
  while (cursor < values.length && hasAnyValue(values[cursor])) {
    values[cursor].splice(columnIndex, 0, "");
    cursor += 1;
  }
}


// ============================================================
// CURRENCY RATES
// ============================================================

function buildAnalyticsExchangeLookup(values) {
  const lookup = {};
  const sections = splitAnalyticsSections(values || []);
  sections.forEach((section) => {
    const header = section.rows?.[0] || [];
    const channelIndex = findHeaderIndexByAliases(header, ["канал", "валюта"]);
    const exchangeIndex = findHeaderIndexByAliases(header, ["обмен", "exchange"]);
    if (channelIndex === -1 || exchangeIndex === -1) return;
    const exchangeUsdIndex = findHeaderIndexByAliases(header, ["обмен_usd", "exchange_usd"]);
    const totalIndex = findHeaderIndexByAliases(header, ["затраты-мои"]);
    const totalUsdIndex = findHeaderIndexByAliases(header, ["затраты-мои usd", "затраты-мои-дол"]);
    section.rows.slice(1).forEach((row) => {
      const channel = getCanonicalManualChannelKey(row[channelIndex]);
      if (!channel || normalizeCell(channel) === normalizeCell(MANUAL_FINANCE_TOTAL_LABEL)) return;
      const exchange = parseLooseNumber(row[exchangeIndex]);
      let exchangeUsd = exchangeUsdIndex !== -1 ? parseLooseNumber(row[exchangeUsdIndex]) : 0;
      const total = totalIndex !== -1 ? parseLooseNumber(row[totalIndex]) : 0;
      const totalUsd = totalUsdIndex !== -1 ? parseLooseNumber(row[totalUsdIndex]) : 0;
      if (!exchangeUsd && exchange && total && totalUsd) exchangeUsd = exchange * totalUsd / total;
      if (!exchangeUsd && exchange && inferManualFinanceChannelCurrency(channel) === "USD") exchangeUsd = exchange;
      lookup[channel] = {
        exchange: (lookup[channel]?.exchange || 0) + exchange,
        exchangeUsd: (lookup[channel]?.exchangeUsd || 0) + exchangeUsd
      };
    });
  });
  return lookup;
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function getAnalyticsSections(values) {
  const sections = splitAnalyticsSections(normalizePlanGrowthFormula(values));
  const movementSummaryRows = state.data?.tabs?.movement?.summaryRows || [];
  const output = movementSummaryRows.length
    ? [
        {
          title: "Итоги за выбранный период",
          rows: [["Показатель", "Значение"], ...clone2dArray(movementSummaryRows)]
        },
        ...sections
      ]
    : sections.slice();
  const savingsValues = clone2dArray(state.data?.tabs?.savings?.values || []);
  if (savingsValues.length) {
    output.push({
      title: "Сбережения",
      rows: savingsValues
    });
  }
  return output;
}

function isAnalyticsPersonalSection(section) {
  const title = normalizeCell(section?.title).replace(/ё/g, "е");
  if ([normalizeCell("Личные расходы"), normalizeCell("личное движение средств")].includes(title)) {
    return true;
  }
  const header = Array.isArray(section?.rows?.[0]) ? section.rows[0] : [];
  if (!header.length) return false;
  const hasNowColumn = findHeaderIndexByAliases(header, ["now"]) !== -1;
  const hasServiceColumn = findHeaderIndexByAliases(header, ["приход от услуг", "service income"]) !== -1;
  const hasExchangeColumn = findHeaderIndexByAliases(header, ["обмен", "exchange"]) !== -1;
  return hasNowColumn && hasServiceColumn && hasExchangeColumn;
}

function getAnalyticsPersonalSection(sections = []) {
  return (sections || []).find((section) => isAnalyticsPersonalSection(section)) || sections[0] || null;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function getManualFinanceChannels() {
  return Array.isArray(state.config?.manualFinance?.channels) && state.config.manualFinance.channels.length
    ? state.config.manualFinance.channels.slice()
    : MANUAL_FINANCE_MONEY_CHANNELS.slice();
}

function resolveManualFinanceChannelAlias(value, channels = getManualFinanceChannels()) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (((typeof window !== "undefined" ? window.EzohataManualLedgerContract : null))?.normalizeManualLedgerChannel) {
    const mapped = window.EzohataManualLedgerContract.normalizeManualLedgerChannel(raw, channels);
    if (mapped && mapped !== raw) return mapped;
  }
  const normalizeToken = (item) => normalizeLookupText(item).replace(/_/g, " ");
  const normalized = normalizeToken(raw);
  const defaultChannelMap = {
    "Яндекс руб": ["яндекс", "yandex", "yandex rub", "яндекс руб", "яндекс рубли", "yoomoney", "yoomoney rub", "юmoney", "юmoney руб", "юмани", "юмани руб", "юмоней", "юмоней руб"],
    "пейпал дол": ["paypal", "paypal usd", "пейпал", "пейпал дол"],
    "пейпал евр": ["paypal eur", "paypal euro", "пейпал евр", "пейпал евро"],
    "пейпал сad": ["paypal cad", "пейпал cad", "пейпал сad"],
    "монобанк грн": ["монобанк", "monobank", "mono", "монобанк грн", "monobank uah", "mono uah"],
    "приват-фоп": ["приват фоп", "фоп приват", "privat fop", "privat24 fop", "privat 24 fop", "privat fop uah", "приват24 фоп", "приват 24 фоп"],
    "приват 24-грн": ["приват", "privat", "privat 24", "приват 24", "приват грн", "privat 24 грн", "privat 24 uah"],
    "Payoneer - dol": ["payoneer", "payoneer usd", "payoneer dol", "payoneer dollar", "payoneer - dol"],
    "Payoneer - eur": ["payoneer eur", "payoneer euro", "payoneer - eur"],
    "Бинанс spot": ["binance spot", "бинанс spot", "бинанс"],
    "binance save": ["binance save", "бинанс save", "бинанс сейв", "binance savings"]
  };
  const channelMap = (typeof state !== "undefined" ? state.config?.manualFinance?.channelMap : null) || defaultChannelMap;
  for (const [channel, aliases] of Object.entries(channelMap || {})) {
    const knownTokens = [channel, ...(aliases || [])].map((item) => normalizeToken(item));
    if (!knownTokens.includes(normalized)) continue;
    return channels.find((item) => normalizeCell(item) === normalizeCell(channel)) || channel;
  }
  return "";
}

function normalizeManualLedgerCategoryForStorage(value, fallback = "extra") {
  if (((typeof window !== "undefined" ? window.EzohataManualLedgerContract : null))?.normalizeManualLedgerCategory) {
    return window.EzohataManualLedgerContract.normalizeManualLedgerCategory(value, fallback);
  }
  const normalized = normalizeCell(value).replace(/ё/g, "е");
  if (!normalized) return fallback;
  if (/service|приход/.test(normalized)) return "servicein";
  if (/ezo/.test(normalized)) return "ezoin";
  if (/exchange|обмен|комис/.test(normalized)) return "exchange";
  if (/partner|партнер/.test(normalized)) return "partner";
  if (/business|бизнес/.test(normalized)) return "business";
  if (/flat|house|rent|кварт|дом|аренд/.test(normalized)) return "house";
  if (/food|еда|продукт/.test(normalized)) return "food";
  if (/fun|event|beauty|развлеч/.test(normalized)) return "fun";
  if (/travel|study|учеб|обуч|курс|школ|путеш/.test(normalized)) return "travel";
  return fallback;
}

function mapManualLedgerCategoryToLegacy(category) {
  const canonical = normalizeManualLedgerCategoryForStorage(category);
  if (((typeof window !== "undefined" ? window.EzohataManualLedgerContract : null))?.mapLedgerCategoryToLegacy) {
    return window.EzohataManualLedgerContract.mapLedgerCategoryToLegacy(canonical);
  }
  return ({
    servicein: "serviceIncome",
    ezoin: "serviceIncome",
    exchange: "exchange",
    partner: "exchange",
    business: "business",
    house: "flat",
    food: "food",
    fun: "fun",
    travel: "travel",
    extra: "business"
  })[canonical] || "business";
}

function normalizeManualLedgerOperation(value, category = "") {
  if (((typeof window !== "undefined" ? window.EzohataManualLedgerContract : null))?.normalizeManualLedgerOperation) {
    return window.EzohataManualLedgerContract.normalizeManualLedgerOperation(value, category);
  }
  const normalized = normalizeLookupText(value).replace(/_/g, " ");
  if (["income", "expense", "exchange in", "exchange out", "partner transfer", "business expense", "personal expense", "correction"].includes(normalized)) {
    return normalized.replace(/\s/g, "_");
  }
  const canonical = normalizeManualLedgerCategoryForStorage(category);
  if (canonical === "exchange") return "exchange_out";
  if (canonical === "servicein" || canonical === "ezoin") return "income";
  if (canonical === "partner") return "partner_transfer";
  if (canonical === "business") return "business_expense";
  if (["house", "food", "fun", "travel", "extra"].includes(canonical)) return "personal_expense";
  return "correction";
}

function normalizeManualLedgerDirection(value, operation = "") {
  if (((typeof window !== "undefined" ? window.EzohataManualLedgerContract : null))?.normalizeManualLedgerDirection) {
    return window.EzohataManualLedgerContract.normalizeManualLedgerDirection(value, operation);
  }
  const normalized = normalizeCell(value);
  if (["in", "out", "neutral"].includes(normalized)) return normalized;
  const op = normalizeManualLedgerOperation(operation);
  if (op === "income" || op === "exchange_in") return "in";
  if (op === "correction") return "neutral";
  return "out";
}

function canonicalManualFinanceChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return getManualFinanceChannels().find((channel) => normalizeCell(channel) === normalizeCell(raw))
    || resolveManualFinanceChannelAlias(raw)
    || raw;
}

function getCanonicalManualChannelKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return canonicalManualFinanceChannel(raw) || raw;
}

function getManualExpenseTypes() {
  return Array.isArray(state.config?.manualFinance?.expenseTypes) && state.config.manualFinance.expenseTypes.length
    ? state.config.manualFinance.expenseTypes.slice()
    : MANUAL_INPUT_CATEGORIES.slice();
}


// ============================================================
// HELPERS
// ============================================================

function getManualStoredExpenseTypes() {
  return [...new Set([...MANUAL_STORED_INPUT_CATEGORIES, ...getManualExpenseTypes()])];
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildManualExpenseHeaders() {
  return ["дата", "категория", ...getManualFinanceChannels()];
}


// ============================================================
// HELPERS
// ============================================================

function buildEmptyExpenseAmounts() {
  return Object.fromEntries(getManualFinanceChannels().map((channel) => [channel, ""]));
}

function getCanonicalManualExpenseAmounts(amounts = {}) {
  const canonicalAmounts = buildEmptyExpenseAmounts();
  Object.entries(amounts || {}).forEach(([channel, value]) => {
    const canonicalChannel = getCanonicalManualChannelKey(channel);
    if (!canonicalChannel || !Object.prototype.hasOwnProperty.call(canonicalAmounts, canonicalChannel)) return;
    const sum = parseLooseNumber(canonicalAmounts[canonicalChannel]) + parseLooseNumber(value);
    canonicalAmounts[canonicalChannel] = sum ? formatSheetNumber(sum) : "";
  });
  return canonicalAmounts;
}

function getCanonicalManualExpenseRawAmounts(amounts = {}) {
  const canonicalAmounts = buildEmptyExpenseAmounts();
  const duplicates = new Set();
  Object.entries(amounts || {}).forEach(([channel, value]) => {
    const canonicalChannel = getCanonicalManualChannelKey(channel);
    const raw = String(value ?? "").trim();
    if (!canonicalChannel || !raw || !Object.prototype.hasOwnProperty.call(canonicalAmounts, canonicalChannel)) return;
    if (!String(canonicalAmounts[canonicalChannel] || "").trim()) {
      canonicalAmounts[canonicalChannel] = raw;
      return;
    }
    duplicates.add(canonicalChannel);
    const sum = parseLooseNumber(canonicalAmounts[canonicalChannel]) + parseLooseNumber(raw);
    canonicalAmounts[canonicalChannel] = sum ? formatSheetNumber(sum) : "";
  });
  return canonicalAmounts;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function createEmptyManualFinanceTransferRow() {
  return { transferDate: "", who: "", amount: "", currency: "", channel: "", rate: "", usdAmount: "" };
}

function createEmptyManualCommissionRow() {
  return { date: "", channel: "", usdAmount: "", comment: "" };
}

function createManualFinanceExpenseRow(date, category) {
  return { date, category, amounts: buildEmptyExpenseAmounts() };
}

function createLegacyFactMoneyRow(channel = "") {
  return { channel, now: "", serviceIncome: "", business: "", food: "", house: "", fun: "", study: "", travelFun: "", total: "", exchange: "", nowUsd: "" };
}

const MANUAL_FINANCE_FORMULA_KEY_BY_COLUMN = {
  A: "channel",
  B: "now",
  C: "serviceIncome",
  D: "business",
  E: "house",
  F: "food",
  G: "fun",
  H: "study",
  I: "travelFun",
  J: "total",
  K: "exchange"
};
const MANUAL_FINANCE_FORMULA_ROW_OFFSET = 3;

function getManualFinanceFormulaOptions() {
  return {
    formulaKeyByColumn: MANUAL_FINANCE_FORMULA_KEY_BY_COLUMN,
    formulaRowOffset: MANUAL_FINANCE_FORMULA_ROW_OFFSET,
    parseLooseNumber,
    roundTo2
  };
}

function isManualFinanceFormula(value) {
  return MANUAL_FINANCE_FORMULAS.isManualFinanceFormula
    ? MANUAL_FINANCE_FORMULAS.isManualFinanceFormula(value)
    : /^\s*=/.test(String(value ?? ""));
}

function evaluateManualFinanceFormula(rawValue, rows, visited = new Set()) {
  if (!MANUAL_FINANCE_FORMULAS.evaluateManualFinanceFormula) return null;
  return MANUAL_FINANCE_FORMULAS.evaluateManualFinanceFormula(
    rawValue,
    rows,
    getManualFinanceFormulaOptions(),
    visited
  );
}

function evaluateManualFinanceCellNumericValue(rows, rowIndex, key, visited = new Set()) {
  if (!MANUAL_FINANCE_FORMULAS.evaluateManualFinanceCellNumericValue) {
    const row = rows?.[rowIndex];
    return row ? parseLooseNumber(row[key]) : 0;
  }
  return MANUAL_FINANCE_FORMULAS.evaluateManualFinanceCellNumericValue(
    rows,
    rowIndex,
    key,
    getManualFinanceFormulaOptions(),
    visited
  );
}

function normalizeManualFinancePersistedNumberInput(value, options = {}) {
  if (!MANUAL_FINANCE_FORMULAS.normalizeManualFinancePersistedNumberInput) {
    return normalizeManualFinanceNumberInput(value);
  }
  return MANUAL_FINANCE_FORMULAS.normalizeManualFinancePersistedNumberInput(value, {
    ...getManualFinanceFormulaOptions(),
    ...options
  });
}

function getManualFinanceComputedAmount(value, options = {}) {
  return parseLooseNumber(normalizeManualFinancePersistedNumberInput(value, options));
}

function calculateLegacyFactRowTotal(row, rows, rowIndex) {
  return formatSheetNumber(
    evaluateManualFinanceCellNumericValue(rows, rowIndex, "business") +
    evaluateManualFinanceCellNumericValue(rows, rowIndex, "food") +
    evaluateManualFinanceCellNumericValue(rows, rowIndex, "house") +
    evaluateManualFinanceCellNumericValue(rows, rowIndex, "fun") +
    evaluateManualFinanceCellNumericValue(rows, rowIndex, "study") +
    evaluateManualFinanceCellNumericValue(rows, rowIndex, "travelFun")
  );
}

function normalizeManualFinanceMoneyRows(rows = []) {
  const lookup = new Map();
  (rows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row?.channel);
    if (!channel) return;
    const existing = lookup.get(channel);
    if (!existing) {
      lookup.set(channel, {
        channel,
        now: row?.now ?? "",
        nowUsd: row?.nowUsd ?? row?.now_usd ?? "",
        serviceIncome: row?.serviceIncome ?? "",
        business: row?.business ?? "",
        food: row?.food ?? "",
        house: row?.house ?? row?.flat ?? "",
        fun: row?.fun ?? "",
        study: row?.study ?? "",
        travelFun: row?.travelFun ?? row?.travel ?? "",
        exchange: row?.exchange ?? "",
        total: row?.total ?? ""
      });
      return;
    }
    [
      ["now", "now"],
      ["nowUsd", "nowUsd"],
      ["serviceIncome", "serviceIncome"],
      ["business", "business"],
      ["food", "food"],
      ["house", "flat"],
      ["fun", "fun"],
      ["study", "study"],
      ["travelFun", "travel"],
      ["exchange", "exchange"],
      ["total", "total"]
    ].forEach(([targetKey, fallbackKey]) => {
      const merged = parseLooseNumber(existing[targetKey]) + parseLooseNumber(row?.[targetKey] ?? row?.[fallbackKey] ?? "");
      existing[targetKey] = merged ? formatSheetNumber(merged) : "";
    });
  });
  const normalized = MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => {
    const row = lookup.get(channel) || createLegacyFactMoneyRow(channel);
    return {
      ...row,
      channel,
      nowUsd: row?.nowUsd ?? "",
      total: row?.total ?? ""
    };
  });
  normalized.forEach((row, rowIndex) => {
    row.total = calculateLegacyFactRowTotal(row, normalized, rowIndex);
  });
  normalized.push({
    channel: MANUAL_FINANCE_TOTAL_LABEL,
    now: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "now"), 0)),
    nowUsd: formatSheetNumber(normalized.reduce((sum, row) => sum + parseLooseNumber(row.nowUsd), 0)),
    serviceIncome: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "serviceIncome"), 0)),
    business: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "business"), 0)),
    food: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "food"), 0)),
    house: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "house"), 0)),
    fun: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "fun"), 0)),
    study: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "study"), 0)),
    travelFun: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "travelFun"), 0)),
    exchange: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "exchange"), 0)),
    total: formatSheetNumber(normalized.reduce((sum, row, rowIndex) => sum + evaluateManualFinanceCellNumericValue(normalized, rowIndex, "total"), 0))
  });
  return normalized;
}

function buildLegacyFactMoneyRowsFromExpenseRows(expenseRows) {
  const channelRows = getManualFinanceChannels().map((channel) => createLegacyFactMoneyRow(channel));
  expenseRows.forEach((row) => {
    const targetField = ({
      now: "now",
      serviceIncome: "serviceIncome",
      business: "business",
      flat: "house",
      food: "food",
      fun: "fun",
      study: "study",
      travel: "travelFun",
      exchange: "exchange"
    })[row.category];
    if (!targetField) return;
    const amounts = getCanonicalManualExpenseAmounts(row.amounts || {});
    channelRows.forEach((target) => {
      target[targetField] = formatSheetNumber(
        getManualFinanceComputedAmount(target[targetField]) +
        getManualFinanceComputedAmount(amounts[target.channel])
      );
    });
  });
  return normalizeManualFinanceMoneyRows(channelRows);
}

function convertLegacyFactMoneyRowsToExpenseRows(moneyRows, periodEnd) {
  const normalized = normalizeManualFinanceMoneyRows(moneyRows);
  const rowIndexByChannel = Object.fromEntries(
    normalized
      .map((row, rowIndex) => [String(row.channel || "").trim(), rowIndex])
      .filter(([channel]) => channel && channel !== MANUAL_FINANCE_TOTAL_LABEL)
  );
  const expenseLookup = Object.fromEntries(
    MANUAL_STORED_INPUT_CATEGORIES.map((category) => [category, createManualFinanceExpenseRow(periodEnd, category)])
  );
  normalized.forEach((row) => {
    const channel = String(row.channel || "").trim();
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    const rowIndex = rowIndexByChannel[channel];
    expenseLookup[MANUAL_NOW_CATEGORY].amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "now"));
    expenseLookup.serviceIncome.amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "serviceIncome"));
    expenseLookup.business.amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "business"));
    expenseLookup.flat.amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "house"));
    expenseLookup.food.amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "food"));
    expenseLookup.fun.amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "fun"));
    expenseLookup.study.amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "study"));
    expenseLookup.travel.amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "travelFun"));
    expenseLookup[MANUAL_EXCHANGE_CATEGORY].amounts[channel] = formatSheetNumber(evaluateManualFinanceCellNumericValue(normalized, rowIndex, "exchange"));
  });
  return MANUAL_STORED_INPUT_CATEGORIES.map((category) => expenseLookup[category]);
}

function buildAnalyticsManualRowsFromFactMoneyRows(moneyRows, transferRows = []) {
  const usdRateLookup = buildManualFinanceUsdRateLookup(transferRows, state.data?.tabs?.movement?.values || []);
  return normalizeManualFinanceMoneyRows(moneyRows).map((row) => ({
    channel: row.channel,
    now: row.now,
    serviceIncome: row.serviceIncome,
    business: row.business,
    flat: row.house,
    food: row.food,
    fun: row.fun,
    study: row.study,
    travel: row.travelFun,
    total: row.total,
    exchange: row.exchange,
    totalUsd: getManualFinanceTotalUsdValue(row, usdRateLookup),
    nowUsd: getManualFinanceNowUsdValue(row, usdRateLookup)
  }));
}

function getManualRowLocalSpendTotal(row) {
  return ["business", "flat", "food", "fun", "study", "travel"].reduce(
    (sum, key) => sum + parseLooseNumber(row?.[key]),
    0
  );
}

function roundExpenseAnalysisAmount(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function getManualFinancePlannedExpenseUsdNumber(row, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const storedTotalUsd = String(row?.totalUsd ?? "").trim();
  if (storedTotalUsd) return parseLooseNumber(storedTotalUsd);
  return (
    getManualFinanceFieldUsdNumber(row, "business", rateLookup) +
    getManualFinanceFieldUsdNumber({ ...row, flat: row?.flat ?? row?.house }, "flat", rateLookup) +
    getManualFinanceFieldUsdNumber(row, "food", rateLookup) +
    getManualFinanceFieldUsdNumber(row, "fun", rateLookup) +
    getManualFinanceFieldUsdNumber(row, "study", rateLookup) +
    getManualFinanceFieldUsdNumber({ ...row, travel: row?.travel ?? row?.travelFun }, "travel", rateLookup)
  );
}

function normalizeExpenseAnalysisProviderExpenseBreakdown(breakdown, fallbackTotal = 0) {
  if (breakdown && typeof breakdown === "object" && !Array.isArray(breakdown)) {
    const total = roundExpenseAnalysisAmount(breakdown.total);
    const business = roundExpenseAnalysisAmount(
      breakdown.business !== undefined ? breakdown.business : total
    );
    return {
      total,
      business,
      personal: roundExpenseAnalysisAmount(breakdown.personal),
      excludedTransferExchange: roundExpenseAnalysisAmount(breakdown.excludedTransferExchange),
      byCategory: breakdown.byCategory || {},
      bySubcategory: breakdown.bySubcategory || {}
    };
  }
  const total = roundExpenseAnalysisAmount(fallbackTotal);
  return {
    total,
    business: total,
    personal: 0,
    excludedTransferExchange: 0,
    byCategory: {},
    bySubcategory: {}
  };
}

function buildExpenseAnalysisProviderRows(providerSummary = {}, manualRows = [], movementValues = [], channelByCurrency = {}) {
  const output = [];
  const manualLookup = Object.fromEntries(
    (manualRows || [])
      .filter((row) => row?.channel && row.channel !== MANUAL_FINANCE_TOTAL_LABEL)
      .map((row) => [row.channel, row])
  );
  const movementSummaryRows = ANALYTICS_PAYOUTS_HELPER.buildMovementPaymentSummaryRows
    ? ANALYTICS_PAYOUTS_HELPER.buildMovementPaymentSummaryRows(
        movementValues || [],
        MANUAL_FINANCE_MONEY_CHANNELS,
        ANALYTICS_PAYMENT_RULES
      )
    : [];
  const ordersPlanLookup = {};
  movementSummaryRows.forEach((row) => {
    const channel = String(row?.[0] || "").trim();
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    ordersPlanLookup[channel] = parseLooseNumber(row[2] || "");
  });
  Object.entries(providerSummary?.totalsByCurrency || {}).forEach(([currency, totals]) => {
    const channel = channelByCurrency[String(currency || "").trim().toUpperCase()];
    if (!channel) return;
    const manualRow = manualLookup[channel] || {};
    const planOrders = ordersPlanLookup[channel] || 0;
    const planServices = parseLooseNumber(manualRow.serviceIncome);
    const planSpent = getManualRowLocalSpendTotal(manualRow);
    output.push([
      channel,
      formatSheetNumber(planOrders),
      formatSheetNumber(planServices),
      formatSheetNumber(planOrders + planServices),
      formatSheetNumber(totals?.income || 0),
      formatSheetNumber(planSpent),
      formatSheetNumber(totals?.expense || 0)
    ]);
  });
  return output;
}

function buildExpenseAnalysisChannelSummary({
  manualRows = [],
  movementValues = [],
  ledgerRows = [],
  realIncomeSummaryByChannel = {},
  providerExpenseByChannel = {},
  providerExpenseBreakdownByChannel = {},
  usdRateLookup = { byChannel: {}, byCurrency: {} },
  transferBalance = { transferIn: 0, transferOut: 0, transferBalance: 0 },
  ownerOrderBaseUsd = "",
  ownerOrderShare30Pct = "",
  period = {}
} = {}) {
  const rows = [[
    "канал",
    "план заказы",
    "план услуги",
    "план всего",
    "пришло реально",
    "разница",
    "потрачено план",
    "потрачено реал бизнес",
    "потрачено реал всего",
    "личные расходы",
    "transfer/exchange excluded",
    "разница",
    "план приходов, шт",
    "авто/MCP приходов, шт",
    "ручных приходов, шт",
    "скриншот приходов, шт"
  ]];
  const incomeTotals = { ordersPlanUsd: 0, servicePlanUsd: 0, plannedUsd: 0, realUsd: 0, differenceUsd: 0 };
  const expenseTotals = { plannedUsd: 0, realUsd: 0, differenceUsd: 0 };
  const incomeCountTotals = { plan: 0, auto: 0, manual: 0, screenshot: 0 };
  const movementStats = calculateMovementChannelStats(movementValues || []);
  const ledgerIncomeCounts = buildLedgerIncomeCountSummaryByChannel(ledgerRows || [], period);

  MANUAL_FINANCE_MONEY_CHANNELS.forEach((channel) => {
    const channelRows = (manualRows || []).filter((row) => row?.channel === channel);
    const manualRow = channelRows[0] || { channel };
    const ordersPlanUsd = roundExpenseAnalysisAmount(movementStats.accruedPlusByChannel?.[channel]);
    const servicePlanUsd = roundExpenseAnalysisAmount(
      sumManualFinanceFieldUsdNumber(channelRows, "serviceIncome", usdRateLookup)
    );
    const plannedIncomeUsd = roundExpenseAnalysisAmount(ordersPlanUsd + servicePlanUsd);
    const realIncomeUsd = roundExpenseAnalysisAmount(realIncomeSummaryByChannel?.[channel]?.realNetUsd);
    const incomeDifferenceUsd = roundExpenseAnalysisAmount(plannedIncomeUsd - realIncomeUsd);
    const plannedExpenseUsd = roundExpenseAnalysisAmount(getManualFinancePlannedExpenseUsdNumber(manualRow, usdRateLookup));
    const expenseBreakdown = normalizeExpenseAnalysisProviderExpenseBreakdown(
      providerExpenseBreakdownByChannel?.[channel],
      providerExpenseByChannel?.[channel]
    );
    const realExpenseUsd = expenseBreakdown.business;
    const expenseDifferenceUsd = roundExpenseAnalysisAmount(plannedExpenseUsd - realExpenseUsd);
    const planIncomeCount = getExpenseAnalysisPlannedIncomeCount(
      movementStats.accruedPlusCountByChannel?.[channel],
      ordersPlanUsd
    );
    const autoIncomeCount = ledgerIncomeCounts.autoByChannel?.[channel] || 0;
    const manualIncomeCount = ledgerIncomeCounts.manualByChannel?.[channel] || 0;
    const screenshotIncomeCount = ledgerIncomeCounts.screenshotByChannel?.[channel] || 0;

    rows.push([
      channel,
      formatSheetNumber(ordersPlanUsd),
      formatSheetNumber(servicePlanUsd),
      formatSheetNumber(plannedIncomeUsd),
      formatSheetNumber(realIncomeUsd),
      formatSheetNumber(incomeDifferenceUsd),
      formatSheetNumber(plannedExpenseUsd),
      formatSheetNumber(realExpenseUsd),
      formatSheetNumber(expenseBreakdown.total),
      formatSheetNumber(expenseBreakdown.personal),
      formatSheetNumber(expenseBreakdown.excludedTransferExchange),
      formatSheetNumber(expenseDifferenceUsd),
      String(planIncomeCount),
      String(autoIncomeCount),
      String(manualIncomeCount),
      String(screenshotIncomeCount)
    ]);

    incomeTotals.ordersPlanUsd += ordersPlanUsd;
    incomeTotals.servicePlanUsd += servicePlanUsd;
    incomeTotals.plannedUsd += plannedIncomeUsd;
    incomeTotals.realUsd += realIncomeUsd;
    incomeTotals.differenceUsd += incomeDifferenceUsd;
    expenseTotals.plannedUsd += plannedExpenseUsd;
    expenseTotals.realUsd += realExpenseUsd;
    expenseTotals.differenceUsd += expenseDifferenceUsd;
    incomeCountTotals.plan += planIncomeCount;
    incomeCountTotals.auto += autoIncomeCount;
    incomeCountTotals.manual += manualIncomeCount;
    incomeCountTotals.screenshot += screenshotIncomeCount;
  });

  const localOrdersPlanUsd = roundExpenseAnalysisAmount(incomeTotals.ordersPlanUsd);
  const parsedOwnerOrderBaseUsd = parseLooseNumber(ownerOrderBaseUsd);
  const hasOwnerOrderBase = String(ownerOrderBaseUsd ?? "").trim() !== "" && Number.isFinite(parsedOwnerOrderBaseUsd);
  const unifiedOrdersPlanUsd = hasOwnerOrderBase
    ? roundExpenseAnalysisAmount(parsedOwnerOrderBaseUsd)
    : localOrdersPlanUsd;
  const unassignedOrdersPlanUsd = roundExpenseAnalysisAmount(unifiedOrdersPlanUsd - localOrdersPlanUsd);
  if (unassignedOrdersPlanUsd > 0.0001) {
    rows.push([
      "заказы без канала",
      formatSheetNumber(unassignedOrdersPlanUsd),
      formatSheetNumber(0),
      formatSheetNumber(unassignedOrdersPlanUsd),
      formatSheetNumber(0),
      formatSheetNumber(unassignedOrdersPlanUsd),
      formatSheetNumber(0),
      formatSheetNumber(0),
      formatSheetNumber(0),
      formatSheetNumber(0),
      formatSheetNumber(0),
      formatSheetNumber(0),
      "0",
      "0",
      "0",
      "0"
    ]);
  }
  if (hasOwnerOrderBase) {
    incomeTotals.ordersPlanUsd = unifiedOrdersPlanUsd;
    incomeTotals.plannedUsd = roundExpenseAnalysisAmount(unifiedOrdersPlanUsd + incomeTotals.servicePlanUsd);
    incomeTotals.differenceUsd = roundExpenseAnalysisAmount(incomeTotals.plannedUsd - incomeTotals.realUsd);
  }
  const parsedOwnerOrderShare30Pct = parseLooseNumber(ownerOrderShare30Pct);
  const hasOwnerOrderShare = String(ownerOrderShare30Pct ?? "").trim() !== "" && Number.isFinite(parsedOwnerOrderShare30Pct);
  const nextOwnerOrderShare30Pct = hasOwnerOrderShare
    ? roundExpenseAnalysisAmount(parsedOwnerOrderShare30Pct)
    : roundExpenseAnalysisAmount(incomeTotals.ordersPlanUsd * 0.3);
  const providerExpenseBreakdownTotals = Object.values(providerExpenseBreakdownByChannel || {}).reduce((totals, breakdown) => {
    const normalized = normalizeExpenseAnalysisProviderExpenseBreakdown(breakdown);
    totals.total += normalized.total;
    totals.personal += normalized.personal;
    totals.excludedTransferExchange += normalized.excludedTransferExchange;
    return totals;
  }, { total: 0, personal: 0, excludedTransferExchange: 0 });
  const realExpenseTotalUsd = roundExpenseAnalysisAmount(providerExpenseBreakdownTotals.total || expenseTotals.realUsd);
  const personalExpenseUsd = roundExpenseAnalysisAmount(providerExpenseBreakdownTotals.personal);
  const excludedTransferExchangeUsd = roundExpenseAnalysisAmount(providerExpenseBreakdownTotals.excludedTransferExchange);

  rows.push([
    MANUAL_FINANCE_TOTAL_LABEL,
    formatSheetNumber(incomeTotals.ordersPlanUsd),
    formatSheetNumber(incomeTotals.servicePlanUsd),
    formatSheetNumber(incomeTotals.plannedUsd),
    formatSheetNumber(incomeTotals.realUsd),
    formatSheetNumber(incomeTotals.differenceUsd),
    formatSheetNumber(expenseTotals.plannedUsd),
    formatSheetNumber(expenseTotals.realUsd),
    formatSheetNumber(realExpenseTotalUsd),
    formatSheetNumber(personalExpenseUsd),
    formatSheetNumber(excludedTransferExchangeUsd),
    formatSheetNumber(expenseTotals.differenceUsd),
    String(incomeCountTotals.plan),
    String(incomeCountTotals.auto),
    String(incomeCountTotals.manual),
    String(incomeCountTotals.screenshot)
  ]);

  return {
    rows,
    incomeTotals: {
      ordersPlanUsd: roundExpenseAnalysisAmount(incomeTotals.ordersPlanUsd),
      servicePlanUsd: roundExpenseAnalysisAmount(incomeTotals.servicePlanUsd),
      plannedUsd: roundExpenseAnalysisAmount(incomeTotals.plannedUsd),
      realUsd: roundExpenseAnalysisAmount(incomeTotals.realUsd),
      differenceUsd: roundExpenseAnalysisAmount(incomeTotals.differenceUsd)
    },
    expenseTotals: {
      plannedUsd: roundExpenseAnalysisAmount(expenseTotals.plannedUsd),
      realUsd: roundExpenseAnalysisAmount(expenseTotals.realUsd),
      realTotalUsd: realExpenseTotalUsd,
      personalUsd: personalExpenseUsd,
      excludedTransferExchangeUsd,
      differenceUsd: roundExpenseAnalysisAmount(expenseTotals.differenceUsd)
    },
    incomeCountTotals: {
      plan: incomeCountTotals.plan,
      auto: incomeCountTotals.auto,
      manual: incomeCountTotals.manual,
      screenshot: incomeCountTotals.screenshot
    },
    incomeCountDiagnostics: {
      rawRowsByChannel: ledgerIncomeCounts.rawRowsByChannel || {},
      dedupedEventsByChannel: ledgerIncomeCounts.dedupedEventsByChannel || {},
      duplicateRowsByChannel: ledgerIncomeCounts.duplicateRowsByChannel || {}
    },
    transferBalance: {
      transferIn: roundExpenseAnalysisAmount(transferBalance.transferIn),
      transferOut: roundExpenseAnalysisAmount(transferBalance.transferOut),
      transferBalance: roundExpenseAnalysisAmount(transferBalance.transferBalance)
    },
    ownerOrderShare30Pct: nextOwnerOrderShare30Pct,
    localOrdersPlanUsd,
    unassignedOrdersPlanUsd
  };
}

function buildMissingPaymentsAudit({
  movementValues = [],
  realIncomeEntries = [],
  manualOperations = [],
  expenseEntries = [],
  startDate = "",
  endDate = ""
} = {}) {
  const plannedRows = collectMissingPaymentPlannedRows(movementValues);
  const providerActualRows = collectMissingPaymentActualRows({
    realIncomeEntries,
    manualOperations,
    expenseEntries,
    startDate,
    endDate
  });
  const movementFallbackRows = collectMissingPaymentMovementFallbackRows(plannedRows);
  const providerActualChannels = new Set(providerActualRows.map((row) => row.channel));
  const actualRows = [
    ...providerActualRows,
    ...movementFallbackRows.filter((row) => !providerActualChannels.has(row.channel))
  ];
  const matchedActualIndexes = new Set();
  const missingRows = [];

  plannedRows.forEach((planned) => {
    const match = actualRows
      .map((actual, index) => ({ actual, index, score: scoreMissingPaymentMatch(planned, actual) }))
      .filter((candidate) => candidate.score && !matchedActualIndexes.has(candidate.index))
      .sort((left, right) => compareMissingPaymentScore(left.score, right.score))[0];

    if (match) {
      matchedActualIndexes.add(match.index);
      return;
    }

    missingRows.push({
      channel: planned.channel,
      orderId: planned.orderId,
      date: planned.date,
      client: planned.client,
      service: planned.service,
      accrued: planned.accrued,
      accruedPlus: planned.accruedPlus,
      receivedUsd: planned.receivedUsd,
      providerNet: planned.providerNet,
      balance: planned.balance,
      reason: providerActualChannels.has(planned.channel)
        ? "no same-channel income within 1 USD"
        : "no provider/ledger income; movement fallback did not match"
    });
  });

  const summaryRows = MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => {
    const canonicalChannel = getCanonicalManualChannelKey(channel);
    const planned = plannedRows.filter((row) => row.channel === canonicalChannel);
    const actual = actualRows.filter((row) => row.channel === canonicalChannel);
    const missing = missingRows.filter((row) => row.channel === canonicalChannel);
    return {
      channel: canonicalChannel,
      plannedCount: planned.length,
      actualCount: actual.length,
      missingCount: missing.length,
      missingAmount: roundExpenseAnalysisAmount(missing.reduce((sum, row) => sum + Number(row.accruedPlus || 0), 0))
    };
  }).filter((row) => row.plannedCount || row.actualCount || row.missingCount);

  return {
    summaryRows,
    detailRows: missingRows,
    totals: {
      plannedCount: plannedRows.length,
      actualCount: actualRows.length,
      missingCount: missingRows.length,
      missingAmount: roundExpenseAnalysisAmount(missingRows.reduce((sum, row) => sum + Number(row.accruedPlus || 0), 0))
    }
  };
}

function collectMissingPaymentPlannedRows(values) {
  const headerInfo = getMissingPaymentMovementHeaderInfo(values);
  if (!headerInfo) return [];
  const { header, dataRows } = headerInfo;
  const indexes = {
    orderId: findHeaderIndexByAliases(header, ["NUMBER", "ORDER ID", "ORDER", "ЗАКАЗ"]),
    date: findHeaderIndexByAliases(header, ["DATE", "ДАТА"]),
    client: findHeaderIndexByAliases(header, ["CLIENT", "КЛИЕНТ", "ИМЯ"]),
    service: findHeaderIndexByAliases(header, ["SERVICE", "УСЛУГА"]),
    paymentMethod: findHeaderIndexByAliases(header, ["PAYMENT METHOD", "CHANNEL"]),
    accrued: findHeaderIndexByAliases(header, ["ACCRUED"]),
    accruedPlus: findHeaderIndexByAliases(header, ["ACCRUED +3%"]),
    receivedUsd: findHeaderIndexByAliases(header, ["ДОШЛО ДО НАС USD", "NET RECEIVED USD", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "RECEIVED TOTAL USD", "ОПЛАЧЕНО КЛИЕНТОМ USD"]),
    providerNet: findHeaderIndexByAliases(header, ["ДОШЛО ФАКТ / PROVIDER NET", "REAL INCOME", "PROVIDER NET"]),
    balance: findHeaderIndexByAliases(header, ["BALANCE", "БАЛАНС"])
  };
  const nextPaymentByClient = buildMissingPaymentClientPaymentLookup(dataRows, indexes);

  return dataRows
    .filter((row) => hasAnyValue(row) && !isTableTotalRow(row) && /^\d+$/.test(String(readMissingPaymentCell(row, indexes.orderId) || "").trim()))
    .map((row) => {
      const channel = resolveMissingPaymentMovementChannel(row, indexes, nextPaymentByClient);
      const accruedPlus = parseLooseNumber(readMissingPaymentCell(row, indexes.accruedPlus));
      if (!channel || !accruedPlus) return null;
      return {
        channel,
        orderId: String(readMissingPaymentCell(row, indexes.orderId) || "").trim(),
        date: normalizeMissingPaymentDate(readMissingPaymentCell(row, indexes.date)),
        client: String(readMissingPaymentCell(row, indexes.client) || "").trim(),
        service: String(readMissingPaymentCell(row, indexes.service) || "").trim(),
        accrued: roundExpenseAnalysisAmount(parseLooseNumber(readMissingPaymentCell(row, indexes.accrued))),
        accruedPlus: roundExpenseAnalysisAmount(accruedPlus),
        receivedUsd: roundExpenseAnalysisAmount(parseLooseNumber(readMissingPaymentCell(row, indexes.receivedUsd))),
        providerNet: roundExpenseAnalysisAmount(parseLooseNumber(readMissingPaymentCell(row, indexes.providerNet))),
        balance: roundExpenseAnalysisAmount(parseLooseNumber(readMissingPaymentCell(row, indexes.balance)))
      };
    })
    .filter(Boolean);
}

function getMissingPaymentMovementHeaderInfo(values) {
  if (!Array.isArray(values) || !values.length) return null;
  for (let index = 0; index < Math.min(values.length, 4); index += 1) {
    const header = values[index] || [];
    const orderIndex = findHeaderIndexByAliases(header, ["NUMBER", "ORDER ID", "ORDER", "ЗАКАЗ"]);
    const accruedPlusIndex = findHeaderIndexByAliases(header, ["ACCRUED +3%"]);
    const paymentMethodIndex = findHeaderIndexByAliases(header, ["PAYMENT METHOD", "CHANNEL"]);
    if (orderIndex !== -1 && accruedPlusIndex !== -1 && paymentMethodIndex !== -1) {
      return { header, dataRows: values.slice(index + 1) };
    }
  }
  return null;
}

function buildMissingPaymentClientPaymentLookup(rows, indexes) {
  const lookup = {};
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] || [];
    const client = String(readMissingPaymentCell(row, indexes.client) || "").trim();
    const paymentMethod = String(readMissingPaymentCell(row, indexes.paymentMethod) || "").trim();
    if (!client || !paymentMethod || !resolvePaymentChannel(paymentMethod)) continue;
    getClientPaymentLookupKeys(client).forEach((key) => {
      if (!lookup[key]) lookup[key] = paymentMethod;
    });
  }
  return lookup;
}

function resolveMissingPaymentMovementChannel(row, indexes, nextPaymentByClient = {}) {
  const client = String(readMissingPaymentCell(row, indexes.client) || "").trim();
  const paymentMethod = String(readMissingPaymentCell(row, indexes.paymentMethod) || "").trim();
  const inferredPaymentMethod = getClientPaymentLookupKeys(client).map((key) => nextPaymentByClient[key]).find(Boolean) || "";
  const fallbackChannel = !paymentMethod ? inferFallbackPaymentChannelFromClient(client) : "";
  const cardFallbackChannel = paymentMethod && isAmbiguousPersonalCardPayment(paymentMethod)
    ? inferFallbackPaymentChannelFromClient(client)
    : "";
  const canonicalPaymentChannel = getCanonicalManualChannelKey(paymentMethod);
  const exactChannel = MANUAL_FINANCE_MONEY_CHANNELS.includes(canonicalPaymentChannel) ? canonicalPaymentChannel : "";
  return cardFallbackChannel || resolvePaymentChannel(paymentMethod) || exactChannel || fallbackChannel || resolvePaymentChannel(inferredPaymentMethod);
}

function collectMissingPaymentActualRows({
  realIncomeEntries = [],
  manualOperations = [],
  expenseEntries = [],
  startDate = "",
  endDate = ""
} = {}) {
  return [
    ...(realIncomeEntries || []).map(mapRealIncomeEntryToMissingPaymentActual),
    ...(manualOperations || []).map(mapManualOperationToMissingPaymentActual),
    ...(expenseEntries || []).map(mapExpenseEntryToMissingPaymentActual)
  ]
    .filter(Boolean)
    .filter((row) => isMissingPaymentIncomeOperation(row.operation))
    .filter((row) => row.channel && row.amountUsd > 0)
    .filter((row) => isMissingPaymentDateInPeriod(row.date, startDate, endDate));
}

function mapRealIncomeEntryToMissingPaymentActual(entry) {
  const channel = getCanonicalManualChannelKey(entry?.channel || "");
  const amountUsd = firstMissingPaymentNumber([
    entry?.realNetUsd,
    entry?.realGrossUsd,
    entry?.usdAmount,
    entry?.amountUsd,
    entry?.amount_usd
  ]);
  return {
    source: String(entry?.source || "provider").trim(),
    operation: "income",
    channel,
    amountUsd,
    date: normalizeMissingPaymentDate(entry?.date),
    counterparty: String(entry?.counterparty || entry?.organization || entry?.description || entry?.sourceTransactionId || entry?.id || "").trim()
  };
}

function mapManualOperationToMissingPaymentActual(operation) {
  const normalizedOperation = normalizeCell(operation?.operation || operation?.category || "");
  const channel = getCanonicalManualChannelKey(operation?.toChannel || operation?.to_channel || operation?.channel || "");
  const currency = String(operation?.currency || "").trim().toUpperCase();
  const amountUsd = firstMissingPaymentNumber([
    operation?.amountUsd,
    operation?.amount_usd,
    currency === "USD" ? operation?.amountNet : "",
    currency === "USD" ? operation?.amount_net : ""
  ]);
  return {
    source: String(operation?.source || "manual").trim(),
    operation: normalizedOperation,
    channel,
    amountUsd,
    date: normalizeMissingPaymentDate(operation?.date),
    counterparty: String(operation?.counterparty || operation?.description || operation?.comment || operation?.external_id || "").trim()
  };
}

function mapExpenseEntryToMissingPaymentActual(entry) {
  const direction = normalizeCell(entry?.direction || "");
  const operation = normalizeCell(entry?.operation || entry?.operationType || entry?.category || direction);
  const channel = getCanonicalManualChannelKey(entry?.channel || entry?.toChannel || entry?.to_channel || "");
  const amountUsd = firstMissingPaymentNumber([
    entry?.realNetUsd,
    entry?.usdAmount,
    entry?.amountUsd,
    entry?.amount_usd,
    entry?.netAmount,
    entry?.localAmount
  ]);
  return {
    source: String(entry?.source || "provider").trim(),
    operation: direction === "income" ? "income" : operation,
    channel,
    amountUsd,
    date: normalizeMissingPaymentDate(entry?.date),
    counterparty: String(entry?.counterparty || entry?.counterpartyName || entry?.description || entry?.displayFromTo || entry?.externalId || "").trim()
  };
}

function collectMissingPaymentMovementFallbackRows(plannedRows) {
  return (plannedRows || [])
    .map((row) => ({
      source: "movement-fallback",
      operation: "income",
      channel: row.channel,
      amountUsd: firstMissingPaymentNumber([row.providerNet, row.receivedUsd]),
      date: row.date,
      counterparty: row.client,
      orderId: row.orderId
    }))
    .filter((row) => row.amountUsd > 0);
}

function scoreMissingPaymentMatch(planned, actual) {
  if (!planned || !actual || planned.channel !== actual.channel) return null;
  const amountDiffs = [
    Math.abs(Number(planned.accruedPlus || 0) - Number(actual.amountUsd || 0)),
    planned.receivedUsd ? Math.abs(Number(planned.receivedUsd || 0) - Number(actual.amountUsd || 0)) : null,
    planned.providerNet ? Math.abs(Number(planned.providerNet || 0) - Number(actual.amountUsd || 0)) : null
  ].filter((value) => Number.isFinite(value));
  const amountDiff = Math.min(...amountDiffs);
  if (!Number.isFinite(amountDiff) || amountDiff > 1) return null;
  const dateDistance = getMissingPaymentDateDistance(planned.date, actual.date);
  const fuzzyBoost = hasMissingPaymentCounterpartyOverlap(planned.client, actual.counterparty) ? -0.25 : 0;
  return {
    amountDiff: roundExpenseAnalysisAmount(amountDiff),
    dateDistance,
    fuzzyBoost
  };
}

function compareMissingPaymentScore(left, right) {
  const leftTotal = left.amountDiff + left.dateDistance + left.fuzzyBoost;
  const rightTotal = right.amountDiff + right.dateDistance + right.fuzzyBoost;
  if (leftTotal !== rightTotal) return leftTotal - rightTotal;
  if (left.amountDiff !== right.amountDiff) return left.amountDiff - right.amountDiff;
  return left.dateDistance - right.dateDistance;
}

function hasMissingPaymentCounterpartyOverlap(client, counterparty) {
  const left = normalizeLookupText(client).split(" ").filter((token) => token.length >= 4);
  const right = new Set(normalizeLookupText(counterparty).split(" ").filter((token) => token.length >= 4));
  return left.some((token) => right.has(token));
}

function getMissingPaymentDateDistance(leftDate, rightDate) {
  if (!leftDate || !rightDate) return 30;
  const left = new Date(`${leftDate}T00:00:00Z`);
  const right = new Date(`${rightDate}T00:00:00Z`);
  if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) return 30;
  return Math.abs(Math.round((left - right) / 86400000));
}

function isMissingPaymentIncomeOperation(value) {
  return ["income", "servicein", "ezoin"].includes(normalizeCell(value).replace(/_/g, ""));
}

function isMissingPaymentDateInPeriod(date, startDate, endDate) {
  const normalizedDate = normalizeMissingPaymentDate(date);
  const normalizedStart = normalizeMissingPaymentDate(startDate);
  const normalizedEnd = normalizeMissingPaymentDate(endDate);
  if (!normalizedDate) return false;
  if (normalizedStart && normalizedDate < normalizedStart) return false;
  if (normalizedEnd && normalizedDate > normalizedEnd) return false;
  return true;
}

function normalizeMissingPaymentDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoTimestamp = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoTimestamp) return isoTimestamp[1];
  const display = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (display) return `${display[3]}-${display[2]}-${display[1]}`;
  return raw;
}

function firstMissingPaymentNumber(values) {
  for (const value of values || []) {
    const numeric = parseLooseNumber(value);
    if (numeric) return roundExpenseAnalysisAmount(Math.abs(numeric));
  }
  return 0;
}

function readMissingPaymentCell(row, index) {
  return index >= 0 && index < (row || []).length ? row[index] : "";
}

function getExpenseAnalysisPlannedIncomeCount(rawCount, ordersPlanUsd) {
  const count = Math.trunc(parseLooseNumber(rawCount));
  if (count > 0) return count;
  return roundExpenseAnalysisAmount(ordersPlanUsd) > 0 ? 1 : 0;
}

function normalizeExpenseAnalysisIncomeCountDate(value) {
  if (typeof normalizeIncomingSheetDateValue === "function") return normalizeIncomingSheetDateValue(value);
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoTimestamp = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoTimestamp) return isoTimestamp[1];
  const display = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (display) return `${display[3]}-${display[2]}-${display[1]}`;
  return raw;
}

function getExpenseAnalysisIncomeRowDate(row = {}, rawRow = {}) {
  return normalizeExpenseAnalysisIncomeCountDate(
    row?.date ||
    row?.operationDate ||
    row?.operation_date ||
    row?.transactionDate ||
    row?.transaction_date ||
    row?.postedDate ||
    row?.posted_date ||
    row?.createdAt ||
    row?.created_at ||
    rawRow?.date ||
    rawRow?.operationDate ||
    rawRow?.operation_date ||
    rawRow?.transactionDate ||
    rawRow?.transaction_date ||
    rawRow?.postedDate ||
    rawRow?.posted_date ||
    rawRow?.createdAt ||
    rawRow?.created_at ||
    ""
  );
}

function isExpenseAnalysisIncomeRowInPeriod(row = {}, rawRow = {}, period = {}) {
  const startDate = normalizeExpenseAnalysisIncomeCountDate(period?.startDate || period?.from || "");
  const endDate = normalizeExpenseAnalysisIncomeCountDate(period?.endDate || period?.to || "");
  if (!startDate && !endDate) return true;
  const rowDate = getExpenseAnalysisIncomeRowDate(row, rawRow);
  if (!rowDate) return false;
  if (startDate && rowDate < startDate) return false;
  if (endDate && rowDate > endDate) return false;
  return true;
}

function normalizeExpenseAnalysisIncomeDirection(value) {
  return normalizeLookupText(value).replace(/\s+/g, "_");
}

function getExpenseAnalysisIncomeRowText(row = {}, rawRow = {}) {
  return normalizeLookupText([
    row?.comment,
    rawRow?.comment,
    row?.description,
    rawRow?.description,
    row?.organization,
    rawRow?.organization,
    row?.counterparty,
    rawRow?.counterparty,
    row?.transactionSubject,
    rawRow?.transactionSubject,
    row?.transferType,
    rawRow?.transferType,
    row?.operationType,
    rawRow?.operationType,
    row?.entryKind,
    rawRow?.entryKind
  ].filter(Boolean).join(" "));
}

function isExpenseAnalysisProviderNonIncomeRow(row = {}, rawRow = {}) {
  const direction = normalizeExpenseAnalysisIncomeDirection(row?.direction || rawRow?.direction || "");
  if (["out", "expense", "debit", "fee", "refund", "hold", "held", "reversal", "chargeback", "exchange"].includes(direction)) return true;
  const kind = normalizeExpenseAnalysisIncomeDirection(
    row?.entryKind ||
    rawRow?.entryKind ||
    row?.operationType ||
    rawRow?.operationType ||
    row?.operation_type ||
    rawRow?.operation_type ||
    row?.transactionType ||
    rawRow?.transactionType ||
    row?.transaction_type ||
    rawRow?.transaction_type ||
    row?.transferType ||
    rawRow?.transferType ||
    ""
  );
  if (["fee", "refund", "hold", "held", "reversal", "chargeback", "exchange"].includes(kind)) return true;

  const source = normalizeExpenseAnalysisIncomeSource(row?.source || rawRow?.source || rawRow?.displaySource || "");
  const rawSourceId = normalizeExpenseAnalysisIncomeEventKeyPart(
    row?.raw_source_id ||
    rawRow?.raw_source_id ||
    row?.rawSourceId ||
    rawRow?.rawSourceId ||
    row?.sourceTransactionId ||
    rawRow?.sourceTransactionId ||
    row?.externalId ||
    rawRow?.externalId ||
    row?.external_id ||
    rawRow?.external_id ||
    ""
  );
  const text = getExpenseAnalysisIncomeRowText(row, rawRow);
  if (["wise", "transferwise"].includes(source) || rawSourceId.startsWith("card-")) {
    if (rawSourceId.startsWith("card-") || kind === "card" || /\bcard (transaction|payment)\b/.test(text)) return true;
  }

  const amountUsd = parseLooseNumber(row?.amount_usd ?? rawRow?.amount_usd ?? row?.amountUsd ?? rawRow?.amountUsd ?? "");
  const amountNet = parseLooseNumber(row?.amount_net ?? rawRow?.amount_net ?? row?.amountNet ?? rawRow?.amountNet ?? row?.netAmount ?? rawRow?.netAmount ?? "");
  const amount = parseLooseNumber(row?.amount ?? rawRow?.amount ?? "");
  if (amountUsd < 0 || (!amountUsd && amountNet < 0) || (!amountUsd && !amountNet && amount < 0)) return true;
  return false;
}

function buildLedgerIncomeCountSummaryByChannel(rows = [], period = {}) {
  const empty = () => Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  const summary = {
    autoByChannel: empty(),
    manualByChannel: empty(),
    screenshotByChannel: empty(),
    rawRowsByChannel: empty(),
    dedupedEventsByChannel: empty(),
    duplicateRowsByChannel: empty()
  };
  const events = new Set();
  (rows || []).forEach((rawRow) => {
    const row = rawRow?.ledgerV2 || rawRow || {};
    if (!isExpenseAnalysisIncomeRowInPeriod(row, rawRow, period)) return;
    const operation = normalizeExpenseAnalysisIncomeOperation(row?.operation || row?.legacy_operation || rawRow?.operation || rawRow?.legacy_operation);
    const category = normalizeExpenseAnalysisIncomeOperation(row?.category || rawRow?.category || row?.legacy_category || rawRow?.legacy_category);
    if (!operation && !category) return;
    if (isExpenseAnalysisProviderNonIncomeRow(row, rawRow)) return;
    const channel = canonicalManualFinanceChannel(row?.to_channel || row?.toChannel || rawRow?.to_channel || rawRow?.toChannel || "");
    if (!channel || !Object.prototype.hasOwnProperty.call(summary.autoByChannel, channel)) return;
    const source = normalizeExpenseAnalysisIncomeSource(row?.source || rawRow?.source || rawRow?.displaySource || "");
    let bucket = "";
    if (isExpenseAnalysisAutoIncomeSource(source)) bucket = "auto";
    else if (isExpenseAnalysisManualIncomeSource(source)) bucket = "manual";
    else if (isExpenseAnalysisScreenshotIncomeSource(source)) bucket = "screenshot";
    if (!bucket) return;
    summary.rawRowsByChannel[channel] += 1;
    const eventKey = buildLedgerIncomeEventDedupeKey(row, rawRow, channel);
    if (events.has(eventKey)) {
      summary.duplicateRowsByChannel[channel] += 1;
      return;
    }
    events.add(eventKey);
    summary.dedupedEventsByChannel[channel] += 1;
    if (bucket === "auto") summary.autoByChannel[channel] += 1;
    else if (bucket === "manual") summary.manualByChannel[channel] += 1;
    else if (bucket === "screenshot") summary.screenshotByChannel[channel] += 1;
  });
  return summary;
}

function buildLedgerIncomeEventDedupeKey(row = {}, rawRow = {}, channel = "") {
  const sourceTransactionId = normalizeExpenseAnalysisIncomeEventKeyPart(
    row?.sourceTransactionId ||
    rawRow?.sourceTransactionId ||
    row?.externalId ||
    rawRow?.externalId ||
    row?.external_id ||
    rawRow?.external_id ||
    ""
  );
  if (sourceTransactionId) return `source:${sourceTransactionId}`;
  const rawSourceId = normalizeExpenseAnalysisIncomeEventKeyPart(
    row?.raw_source_id ||
    rawRow?.raw_source_id ||
    row?.rawSourceId ||
    rawRow?.rawSourceId ||
    ""
  );
  if (rawSourceId) return `raw:${rawSourceId}`;
  const date = getExpenseAnalysisIncomeRowDate(row, rawRow);
  const currency = normalizeExpenseAnalysisIncomeEventKeyPart(row?.currency || rawRow?.currency || "");
  const amount = normalizeExpenseAnalysisIncomeEventAmount(
    row?.amount_net ??
    rawRow?.amount_net ??
    row?.amountNet ??
    rawRow?.amountNet ??
    row?.netAmount ??
    rawRow?.netAmount ??
    row?.amount ??
    rawRow?.amount
  );
  const text = normalizeLookupText(
    row?.comment ||
    rawRow?.comment ||
    row?.counterparty ||
    rawRow?.counterparty ||
    row?.description ||
    rawRow?.description ||
    row?.organization ||
    rawRow?.organization ||
    ""
  );
  return [
    "fallback",
    normalizeExpenseAnalysisIncomeEventKeyPart(channel),
    date,
    currency,
    amount,
    text
  ].join("|");
}

function normalizeExpenseAnalysisIncomeEventKeyPart(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeExpenseAnalysisIncomeEventAmount(value) {
  const numeric = parseLooseNumber(value);
  return Number.isFinite(numeric) ? String(Math.round(Math.abs(numeric) * 10000) / 10000) : "";
}

function normalizeExpenseAnalysisIncomeOperation(value) {
  const token = normalizeLookupText(value);
  return ["income", "servicein", "serviceincome", "ezoin", "ezofact"].includes(token) ? token : "";
}

function normalizeExpenseAnalysisIncomeSource(value) {
  const token = normalizeLookupText(value).replace(/\s+/g, "_");
  if (token === "td_bank" || token === "tdbank") return "tdbank";
  if (token === "privat24" || token === "privat_24") return "privatbank";
  if (token === "paypal_mcp") return "paypal";
  if (token === "paypal_manual") return "paypal_manual";
  if (token === "mcp_import") return "mcp";
  if (token === "photo_parsing") return "photo";
  return token;
}

function isExpenseAnalysisAutoIncomeSource(source) {
  return ["wise", "paypal", "paypal_manual", "monobank", "privatbank", "yoomoney", "tdbank", "provider", "mcp", "import"].includes(source);
}

function isExpenseAnalysisManualIncomeSource(source) {
  return ["manual", "fact", "migration"].includes(source);
}

function isExpenseAnalysisScreenshotIncomeSource(source) {
  return ["ocr", "photo", "screenshot", "image", "browser_ocr"].includes(source);
}

function buildBalanceReconciliationByChannel({
  balances = [],
  operations = [],
  startDate = "",
  endDate = ""
} = {}) {
  const rows = [];
  const statusCounts = { OK: 0, MISMATCH: 0, NO_BALANCE: 0 };
  const channels = new Set((MANUAL_FINANCE_MONEY_CHANNELS || []).map((channel) => getCanonicalManualChannelKey(channel)));
  const openingLookup = buildLatestBalanceReconciliationSnapshotLookup(balances, startDate);
  const closingLookup = buildLatestBalanceReconciliationSnapshotLookup(balances, endDate);
  const ledgerLookup = {};

  (balances || []).forEach((row) => {
    const date = String(row?.date || "").trim();
    const channel = getCanonicalManualChannelKey(row?.channel || row?.accountName || "");
    if (!date || !channel) return;
    if (date >= startDate && date <= endDate) channels.add(channel);
  });

  (operations || []).forEach((operation) => {
    const date = String(operation?.date || "").trim();
    if (!date || date < startDate || date > endDate) return;
    const channel = getBalanceReconciliationOperationChannel(operation);
    const delta = getBalanceReconciliationOperationUsdDelta(operation);
    if (!channel || !delta) return;
    channels.add(channel);
    ledgerLookup[channel] = roundExpenseAnalysisAmount((ledgerLookup[channel] || 0) + delta);
  });

  Array.from(channels)
    .filter(Boolean)
    .sort((left, right) => String(left).localeCompare(String(right)))
    .forEach((channel) => {
      const hasOpening = Object.prototype.hasOwnProperty.call(openingLookup, channel);
      const hasClosing = Object.prototype.hasOwnProperty.call(closingLookup, channel);
      const openingBalanceUsd = hasOpening ? roundExpenseAnalysisAmount(openingLookup[channel]) : null;
      const closingBalanceUsd = hasClosing ? roundExpenseAnalysisAmount(closingLookup[channel]) : null;
      const ledgerDelta = roundExpenseAnalysisAmount(ledgerLookup[channel] || 0);
      const hasBalances = hasOpening && hasClosing;
      const realDelta = hasBalances
        ? roundExpenseAnalysisAmount(closingBalanceUsd - openingBalanceUsd)
        : null;
      const diff = hasBalances
        ? roundExpenseAnalysisAmount(realDelta - ledgerDelta)
        : null;
      const status = !hasBalances
        ? "NO_BALANCE"
        : Math.abs(diff) <= 1
          ? "OK"
          : "MISMATCH";
      statusCounts[status] += 1;
      rows.push({
        channel,
        openingBalanceUsd,
        closingBalanceUsd,
        realDelta,
        ledgerDelta,
        diff,
        status
      });
    });

  return {
    rows,
    counts: {
      total: rows.length,
      ...statusCounts
    }
  };
}

function buildLatestBalanceReconciliationSnapshotLookup(balances, cutoffDate) {
  const latest = {};
  (balances || [])
    .filter((row) => {
      const date = String(row?.date || "").trim();
      return date && date <= cutoffDate;
    })
    .sort((left, right) => String(left?.date || "").localeCompare(String(right?.date || "")))
    .forEach((row) => {
      const channel = getCanonicalManualChannelKey(row?.channel || row?.accountName || "");
      if (!channel) return;
      latest[channel] = getBalanceReconciliationBalanceUsdAmount(row);
    });
  return latest;
}

function getBalanceReconciliationBalanceUsdAmount(row) {
  const storedUsdAmount = parseLooseNumber(row?.usdAmount ?? row?.amountUsd ?? "");
  if (storedUsdAmount) return roundExpenseAnalysisAmount(storedUsdAmount);
  const amount = parseLooseNumber(row?.amount ?? row?.balanceAmount ?? "");
  if (!amount) return 0;
  const channel = getCanonicalManualChannelKey(row?.channel || row?.accountName || "");
  const currency = String(row?.currency || inferManualFinanceChannelCurrency(channel)).trim().toUpperCase();
  if (currency === "USD") return roundExpenseAnalysisAmount(amount);
  const localPerUsd = parseLooseNumber(row?.rate);
  if (localPerUsd) return roundExpenseAnalysisAmount(amount / localPerUsd);
  const usdPerLocal = MANUAL_FINANCE_FALLBACK_USD_RATES[currency] || MANUAL_FINANCE_FALLBACK_USD_RATES.LOCAL || 0;
  return roundExpenseAnalysisAmount(amount * usdPerLocal);
}

function getBalanceReconciliationOperationChannel(operation) {
  const normalizedOperation = normalizeCell(operation?.operation);
  if (["income", "servicein", "ezoin", "exchange_in"].includes(normalizedOperation)) {
    return getCanonicalManualChannelKey(operation?.toChannel || operation?.to_channel || operation?.fromChannel || operation?.from_channel || "");
  }
  return getCanonicalManualChannelKey(operation?.fromChannel || operation?.from_channel || operation?.toChannel || operation?.to_channel || "");
}

function getBalanceReconciliationOperationUsdDelta(operation) {
  const normalizedOperation = normalizeCell(operation?.operation);
  const sign = ({
    income: 1,
    servicein: 1,
    ezoin: 1,
    expense: -1,
    business_expense: -1,
    personal_expense: -1,
    exchange_in: 1,
    exchange_out: -1,
    partner_transfer: -1
  })[normalizedOperation];
  if (!sign) return 0;
  const amountUsd = parseLooseNumber(operation?.amountUsd ?? operation?.amount_usd ?? "");
  const currency = String(operation?.currency || "").trim().toUpperCase();
  const amountNet = currency === "USD"
    ? parseLooseNumber(operation?.amountNet ?? operation?.amount_net ?? "")
    : 0;
  const baseAmount = amountUsd || amountNet;
  if (!baseAmount) return 0;
  return roundExpenseAnalysisAmount(sign * Math.abs(baseAmount));
}

function getLatestFactNowLookup() {
  const lookup = {};
  if (state.data?.tabs?.savings?.values?.length) {
    Object.assign(lookup, buildSavingsLookupFromValues(state.data.tabs.savings.values));
  }
  if (state.manualFinance.data?.moneyRows?.length) {
    normalizeManualFinanceMoneyRows(state.manualFinance.data.moneyRows).forEach((row) => {
      if (!row || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return;
      const raw = String(row.now ?? "").trim();
      if (raw) lookup[row.channel] = parseLooseNumber(raw);
    });
  }
  return lookup;
}

function buildSavingsLookupFromValues(values) {
  if (!values.length) return {};
  const lookup = {};
  values.slice(1).forEach((row) => {
    if (!hasAnyValue(row)) return;
    const channel = getCanonicalManualChannelKey(row[0]);
    if (!channel || normalizeCell(channel) === normalizeCell("итого")) return;
    const amount = row.length > 3 && String(row[3] ?? "").trim()
      ? parseLooseNumber(row[3])
      : parseLooseNumber(row[1]);
    lookup[channel] = amount;
  });
  return lookup;
}

function applySavingsLookupToMoneyRows(moneyRows, lookup) {
  const normalized = normalizeManualFinanceMoneyRows(moneyRows);
  normalized.forEach((row) => {
    if (!row || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    if (Object.prototype.hasOwnProperty.call(lookup, row.channel)) {
      row.now = formatSheetNumber(lookup[row.channel]);
    }
  });
  return normalizeManualFinanceMoneyRows(normalized);
}

function getSavingsTabConfig() {
  return (state.config?.tabs || []).find((tab) => tab.id === "savings") || null;
}

async function hydrateManualFinanceNowFromSavings(manualData) {
  return manualData;
}

function buildMainAnalyticsFactImportValues(moneyRows, transferRows = []) {
  const normalized = normalizeManualFinanceMoneyRows(moneyRows);
  const usdRateLookup = buildManualFinanceUsdRateLookup(transferRows, state.data?.tabs?.movement?.values || []);
  return [
    ["валюта", "now", "service income", "spent for business", "spent for food", "spent for house", "spent for fun", "spent for study", "spent for travel/ fun", "затраты-мои", "обмен", "now_usd"],
    ...normalized
      .filter((row) => row.channel !== MANUAL_FINANCE_TOTAL_LABEL)
      .map((row, rowIndex) => [
        row.channel || "",
        normalizeManualFinancePersistedNumberInput(row.now, { rows: normalized, rowIndex, key: "now" }),
        normalizeManualFinancePersistedNumberInput(row.serviceIncome, { rows: normalized, rowIndex, key: "serviceIncome" }),
        normalizeManualFinancePersistedNumberInput(row.business, { rows: normalized, rowIndex, key: "business" }),
        normalizeManualFinancePersistedNumberInput(row.food, { rows: normalized, rowIndex, key: "food" }),
        normalizeManualFinancePersistedNumberInput(row.house, { rows: normalized, rowIndex, key: "house" }),
        normalizeManualFinancePersistedNumberInput(row.fun, { rows: normalized, rowIndex, key: "fun" }),
        normalizeManualFinancePersistedNumberInput(row.study, { rows: normalized, rowIndex, key: "study" }),
        normalizeManualFinancePersistedNumberInput(row.travelFun, { rows: normalized, rowIndex, key: "travelFun" }),
        row.total || "",
        normalizeManualFinancePersistedNumberInput(row.exchange, { rows: normalized, rowIndex, key: "exchange" }),
        getManualFinanceNowUsdValue(row, usdRateLookup)
      ])
  ];
}

async function syncMainAnalyticsFactImportFromMoneyRows(moneyRows, transferRows = []) {
  if (!state.config?.spreadsheetId) return null;
  const values = buildMainAnalyticsFactImportValues(moneyRows, transferRows);
  await overwriteSheetValues(ANALYTICS_FACT_IMPORT_SHEET, values, state.config.spreadsheetId);
  return values;
}

function buildFactImportLookupFromValues(values) {
  const header = values?.[0] || [];
  const channelIndex = findHeaderIndexByAliases(header, ["валюта", "канал"]);
  const nowIndex = findHeaderIndexByAliases(header, ["now"]);
  const serviceIncomeIndex = findHeaderIndexByAliases(header, ["service income", "приход от услуг"]);
  const businessIndex = findHeaderIndexByAliases(header, ["spent for business"]);
  const foodIndex = findHeaderIndexByAliases(header, ["spent for food"]);
  const houseIndex = findHeaderIndexByAliases(header, ["spent for house", "spent for flat"]);
  const funIndex = findHeaderIndexByAliases(header, ["spent for fun"]);
  const studyIndex = findHeaderIndexByAliases(header, ["spent for study"]);
  const travelFunIndex = findHeaderIndexByAliases(header, ["spent for travel/ fun", "spent for travel"]);
  const exchangeIndex = findHeaderIndexByAliases(header, ["обмен", "exchange"]);
  const lookup = {};
  (values || []).slice(1).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row?.[channelIndex]);
    if (!channel || normalizeCell(channel) === normalizeCell(MANUAL_FINANCE_TOTAL_LABEL)) return;
    const existing = lookup[channel] || { now: "", serviceIncome: "", business: "", food: "", house: "", fun: "", study: "", travelFun: "", exchange: "" };
    [
      ["now", nowIndex],
      ["serviceIncome", serviceIncomeIndex],
      ["business", businessIndex],
      ["food", foodIndex],
      ["house", houseIndex],
      ["fun", funIndex],
      ["study", studyIndex],
      ["travelFun", travelFunIndex],
      ["exchange", exchangeIndex]
    ].forEach(([key, index]) => {
      if (index === -1) return;
      const sum = parseLooseNumber(existing[key]) + parseLooseNumber(row[index] || "");
      existing[key] = sum ? formatSheetNumber(sum) : "";
    });
    lookup[channel] = existing;
  });
  return lookup;
}

function applyFactImportLookupToMoneyRows(moneyRows, lookup) {
  const normalized = normalizeManualFinanceMoneyRows(moneyRows);
  normalized.forEach((row) => {
    if (!row || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    const imported = lookup[row.channel];
    if (!imported) return;
    ["now", "serviceIncome", "business", "food", "house", "fun", "study", "travelFun", "exchange"].forEach((key) => {
      if (String(imported[key] ?? "").trim()) row[key] = imported[key];
    });
  });
  return normalizeManualFinanceMoneyRows(normalized);
}

async function hydrateManualFinanceFromMainFactImport(manualData) {
  if (!manualData || !state.config?.spreadsheetId) return manualData;
  if (manualData.sourceType === "incoming-repository" || manualData.emptyFact) return manualData;
  let values = [];
  try {
    values = await getSheetValuesByTitle(ANALYTICS_FACT_IMPORT_SHEET, state.config.spreadsheetId);
  } catch (error) {
    console.warn("Unable to hydrate fact values from main analytics import:", error);
  }
  const lookup = buildFactImportLookupFromValues(values);
  if (Object.keys(lookup).length) {
    manualData.moneyRows = applyFactImportLookupToMoneyRows(manualData.moneyRows, lookup);
  }
  return manualData;
}

function buildSavingsSheetValuesFromFactRows(existingValues, moneyRows, snapshotDate) {
  const rows = clone2dArray(existingValues || []);
  const header = rows[0]?.length ? rows[0].slice(0, 5) : ["валюта", 0, "", "now usd", "note / source"];
  while (header.length < 5) header.push("");
  header[0] = header[0] || "валюта";
  header[3] = header[3] || "now usd";
  header[4] = header[4] || "note / source";

  const channelIndex = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const channel = String(rows[index]?.[0] || "").trim();
    if (channel) channelIndex.set(channel, index);
  }

  const factRows = normalizeManualFinanceMoneyRows(moneyRows).filter((row) => row.channel !== MANUAL_FINANCE_TOTAL_LABEL);
  const result = [header];
  let totalNow = 0;
  factRows.forEach((row) => {
    const existingRow = channelIndex.has(row.channel) ? rows[channelIndex.get(row.channel)] : [];
    const nextRow = existingRow.slice(0, 5);
    while (nextRow.length < 5) nextRow.push("");
    const nowValue = parseLooseNumber(row.now);
    totalNow += nowValue;
    nextRow[0] = row.channel;
    nextRow[1] = nowValue;
    nextRow[2] = nextRow[2] || "";
    nextRow[3] = nowValue;
    nextRow[4] = `fact ${snapshotDate}`;
    result.push(nextRow);
  });
  result[0][1] = totalNow;
  result.push(["итого", totalNow]);
  return result;
}

async function syncSavingsSheetFromFact(moneyRows, snapshotDate) {
  const savingsTab = getSavingsTabConfig();
  if (!savingsTab?.sheetName || !state.config?.spreadsheetId) return null;
  const existingValues = await getSheetValuesByTitle(savingsTab.sheetName, state.config.spreadsheetId);
  const nextValues = buildSavingsSheetValuesFromFactRows(existingValues, moneyRows, snapshotDate);
  await overwriteSheetValues(savingsTab.sheetName, nextValues, state.config.spreadsheetId);
  if (!state.data) state.data = { tabs: {} };
  if (!state.data.tabs) state.data.tabs = {};
  state.data.tabs.savings = { ...(state.data.tabs.savings || {}), values: nextValues };
  return nextValues;
}

function buildAnalyticsTransfersFromFactRows(rows) {
  return normalizeManualFinanceTransferRows(rows, { padToMinimum: false })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()))
    .map((row) => ({
      date: row.transferDate || row.date || "",
      who: row.who || "",
      amount: row.amount || "",
      localCurrency: row.currency || row.localCurrency || "",
      rate: row.rate || "",
      usdAmount: row.usdAmount || "",
      destination: row.channel || row.destination || ""
    }));
}

function buildDefaultManualExpenseRows(startDate, endDate) {
  const rows = [];
  const current = parseIsoDate(startDate);
  const limit = parseIsoDate(endDate);
  while (current <= limit) {
    const isoDate = current.toISOString().slice(0, 10);
    getManualStoredExpenseTypes().forEach((category) => rows.push(createManualFinanceExpenseRow(isoDate, category)));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return rows;
}

function normalizeManualFinanceTransferRows(rows, options = {}) {
  const padToMinimum = options.padToMinimum !== false;
  const normalized = (rows || []).map((row) => ({
    transferDate: row?.transferDate ?? row?.date ?? "",
    who: row?.who ?? "",
    amount: row?.amount ?? "",
    currency: row?.currency ?? row?.localCurrency ?? "",
    channel: getCanonicalManualChannelKey(row?.channel ?? row?.destination ?? ""),
    rate: row?.rate ?? "",
    usdAmount: row?.usdAmount ?? ""
  }));
  if (padToMinimum) {
    while (normalized.length < MANUAL_TRANSFER_MIN_ROWS) normalized.push(createEmptyManualFinanceTransferRow());
  }
  return normalized;
}

function normalizeManualCommissionRows(rows, options = {}) {
  const padToMinimum = options.padToMinimum !== false;
  const normalized = (rows || []).map((row) => ({
    date: row?.date ?? "",
    channel: getCanonicalManualChannelKey(row?.channel ?? ""),
    usdAmount: row?.usdAmount ?? row?.amount ?? "",
    comment: row?.comment ?? ""
  }));
  if (padToMinimum) {
    while (normalized.length < MANUAL_TRANSFER_MIN_ROWS) normalized.push(createEmptyManualCommissionRow());
  }
  return normalized;
}

function normalizeManualFinanceExpenseRows(rows, startDate, endDate) {
  const index = new Map();
  (rows || []).forEach((row) => {
    if (!row?.date || !row?.category) return;
    const key = `${row.date}|${row.category}`;
    const amounts = getCanonicalManualExpenseAmounts(row?.amounts || {});
    if (index.has(key)) {
      const existing = index.get(key);
      getManualFinanceChannels().forEach((channel) => {
        const sum = parseLooseNumber(existing.amounts[channel]) + parseLooseNumber(amounts[channel]);
        existing.amounts[channel] = sum ? formatSheetNumber(sum) : "";
      });
      return;
    }
    index.set(key, { date: row.date, category: row.category, amounts });
  });
  return buildDefaultManualExpenseRows(startDate, endDate).map(
    (row) => index.get(`${row.date}|${row.category}`) || row
  );
}

function buildManualFinanceSummaryRows(expenseRows, latestNowByChannel = {}) {
  const channelRows = getManualFinanceChannels().map((channel) => ({
    channel,
    now: 0,
    serviceIncome: 0,
    business: 0,
    flat: 0,
    food: 0,
    fun: 0,
    study: 0,
    travel: 0,
    total: 0,
    exchange: 0
  }));
  expenseRows.forEach((row) => {
    if (!getManualStoredExpenseTypes().includes(row.category)) return;
    const amounts = getCanonicalManualExpenseAmounts(row.amounts || {});
    channelRows.forEach((target) => {
      const amount = getManualFinanceComputedAmount(amounts[target.channel]);
      if (row.category === MANUAL_NOW_CATEGORY) {
        return;
      }
      if (row.category === MANUAL_EXCHANGE_CATEGORY) {
        target.exchange += amount;
        return;
      }
      target[row.category] += amount;
      if (row.category !== "serviceIncome") target.total += amount;
    });
  });
  channelRows.forEach((target) => {
    const latest = latestNowByChannel[target.channel];
    const raw = typeof latest === "object" && latest !== null ? latest.value : latest;
    target.now = parseLooseNumber(raw);
  });
  const formatted = channelRows.map((row) => ({
    channel: row.channel,
    now: formatSheetNumber(row.now),
    serviceIncome: formatSheetNumber(row.serviceIncome),
    business: formatSheetNumber(row.business),
    flat: formatSheetNumber(row.flat),
    food: formatSheetNumber(row.food),
    fun: formatSheetNumber(row.fun),
    study: formatSheetNumber(row.study),
    travel: formatSheetNumber(row.travel),
    exchange: formatSheetNumber(row.exchange),
    total: formatSheetNumber(row.total)
  }));
  formatted.push({
    channel: MANUAL_FINANCE_TOTAL_LABEL,
    now: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.now), 0)),
    serviceIncome: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.serviceIncome), 0)),
    business: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.business), 0)),
    flat: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.flat), 0)),
    food: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.food), 0)),
    fun: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.fun), 0)),
    study: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.study), 0)),
    travel: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.travel), 0)),
    exchange: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.exchange), 0)),
    total: formatSheetNumber(formatted.reduce((sum, row) => sum + parseLooseNumber(row.total), 0))
  });
  return formatted;
}

function updateManualFinanceMoneyValue(rowIndex, key, rawValue) {
  const row = state.manualFinance.data?.moneyRows?.[rowIndex];
  if (!row) return;
  clearManualServerCache();
  row[key] = rawValue;
  state.manualFinance.data.moneyRows = normalizeManualFinanceMoneyRows(state.manualFinance.data.moneyRows);
  state.manualFinance.data.expenseRows = convertLegacyFactMoneyRowsToExpenseRows(
    state.manualFinance.data.moneyRows,
    state.manualFinance.data.periodEnd
  );
  state.manualFinance.dirty = true;
  syncAnalyticsFactFromManualData(state.manualFinance.data);
  applyCurrentManualFinancePreview();
  renderMetrics();
}

function normalizeManualFinanceBalanceRows(rows = [], options = {}) {
  const defaultDate = normalizeIncomingSheetDateValue(options.defaultDate || state.manualFinance.data?.periodEnd || elements.endDate.value);
  const normalized = (rows || []).map((row) => {
    const channel = canonicalManualFinanceChannel(row?.channel || row?.accountName || "");
    const currency = String(row?.currency || inferManualFinanceChannelCurrency(channel)).trim().toUpperCase();
    return {
      date: normalizeIncomingSheetDateValue(row?.date || "") || defaultDate,
      channel,
      amount: normalizeManualFinancePersistedNumberInput(row?.amount ?? row?.actual_balance ?? row?.balanceAmount),
      currency,
      rate: normalizeManualFinancePersistedNumberInput(row?.rate),
      usdAmount: normalizeManualFinancePersistedNumberInput(row?.usdAmount ?? row?.amountUsd),
      comment: String(row?.comment || "").trim()
    };
  });
  return normalized.filter((row, index, items) => {
    const hasValue = row.date || row.channel || row.amount || row.currency || row.rate || row.usdAmount || row.comment;
    if (!hasValue) return false;
    if (row.channel || row.amount || row.usdAmount || row.comment) return true;
    return index === items.length - 1;
  });
}

function ensureManualFinanceBalanceInputRows() {
  const data = state.manualFinance.data;
  if (!data) return [];
  const targetDate = normalizeIncomingSheetDateValue(data.periodEnd || elements.endDate.value);
  const existingRows = normalizeManualFinanceBalanceRows(data.balanceRows || [], { defaultDate: targetDate });
  const currentByChannelCurrency = new Map();
  const extraRows = [];
  existingRows.forEach((row) => {
    const key = `${row.channel}|${row.currency}`;
    if (row.date === targetDate && row.channel && row.currency && !currentByChannelCurrency.has(key)) {
      currentByChannelCurrency.set(key, row);
    } else {
      extraRows.push(row);
    }
  });
  const activePairs = buildManualFinanceActiveBalancePairs(data.ledgerRows || []);
  const inputRows = activePairs.map(({ channel, currency }) => (
    currentByChannelCurrency.get(`${channel}|${currency}`) || {
      date: targetDate,
      channel,
      amount: "",
      currency,
      rate: "",
      usdAmount: "",
      comment: ""
    }
  ));
  data.balanceRows = normalizeManualFinanceBalanceRows([...inputRows, ...extraRows], { defaultDate: targetDate });
  return data.balanceRows;
}

function buildManualFinanceActiveBalancePairs(ledgerRows = []) {
  const pairs = new Map();
  const addPair = (channel, currency) => {
    const normalizedChannel = canonicalManualFinanceChannel(channel);
    const normalizedCurrency = String(currency || inferManualFinanceChannelCurrency(normalizedChannel)).trim().toUpperCase();
    if (!normalizedChannel || !normalizedCurrency) return;
    const key = `${normalizedChannel}|${normalizedCurrency}`;
    if (!pairs.has(key)) pairs.set(key, { channel: normalizedChannel, currency: normalizedCurrency });
  };
  getManualFinanceChannels().forEach((channel) => addPair(channel, inferManualFinanceChannelCurrency(channel)));
  (ledgerRows || []).forEach((row) => {
    const operation = String(row?.operation || row?.ledgerV2?.operation || "").trim();
    const currency = String(row?.currency || row?.ledgerV2?.currency || "").trim().toUpperCase();
    const fromChannel = row?.fromChannel || row?.from_channel || row?.ledgerV2?.from_channel || "";
    const toChannel = row?.toChannel || row?.to_channel || row?.ledgerV2?.to_channel || "";
    if (operation === "income" || operation === "exchange_in") addPair(toChannel, currency);
    else if (operation === "expense" || operation === "business_expense" || operation === "personal_expense" || operation === "exchange_out") addPair(fromChannel, currency);
    else if (operation === "transfer" || operation === "partner_transfer") {
      addPair(fromChannel, currency);
      addPair(toChannel, currency);
    }
  });
  return Array.from(pairs.values());
}

function isManualFinanceCashChannel(channel) {
  return /cash|нал|налично/i.test(String(channel || ""));
}

function getManualFinanceCashChannels() {
  const channels = typeof getManualFinanceChannels === "function" ? getManualFinanceChannels() : [];
  return channels.filter(isManualFinanceCashChannel);
}

function normalizeManualFinanceCashRows(rows = [], options = {}) {
  const defaultDate = normalizeIncomingSheetDateValue(options.defaultDate || state.manualFinance.data?.periodEnd || elements.endDate.value);
  const cashChannels = getManualFinanceCashChannels();
  const defaultChannel = cashChannels[0] || "";
  const normalized = (rows || []).map((row) => {
    const channel = canonicalManualFinanceChannel(row?.channel || row?.fromChannel || row?.toChannel || defaultChannel);
    const direction = row?.direction === "income" ? "income" : "expense";
    const amount = normalizeManualFinancePersistedNumberInput(row?.amount ?? row?.localAmount);
    return {
      date: normalizeIncomingSheetDateValue(row?.date || "") || defaultDate,
      channel,
      direction,
      amount,
      currency: String(row?.currency || inferManualFinanceChannelCurrency(channel)).trim().toUpperCase(),
      category: String(row?.category || (direction === "income" ? "servicein" : "business")).trim(),
      subcategory: String(row?.subcategory || "").trim(),
      comment: String(row?.comment || row?.description || "").trim()
    };
  });
  return normalized.filter((row, index, items) => {
    const hasValue = row.date || row.channel || row.amount || row.currency || row.category || row.subcategory || row.comment;
    if (!hasValue) return false;
    if (row.amount || row.comment || row.subcategory) return true;
    return index === items.length - 1;
  });
}

function buildManualFinanceCashRowsFromLedgerRows(ledgerRows = [], startDate = "", endDate = "") {
  const periodStart = normalizeIncomingSheetDateValue(startDate);
  const periodEnd = normalizeIncomingSheetDateValue(endDate || startDate);
  return normalizeManualFinanceCashRows((ledgerRows || [])
    .filter((row) => {
      const date = normalizeIncomingSheetDateValue(row?.date || "");
      if (!date || (periodStart && date < periodStart) || (periodEnd && date > periodEnd)) return false;
      const source = String(row?.source || row?.displaySource || "").trim().toLowerCase();
      if (source && source !== "manual" && source !== "fact") return false;
      const channel = row?.toChannel || row?.to_channel || row?.fromChannel || row?.from_channel || "";
      if (!isManualFinanceCashChannel(channel)) return false;
      const operation = String(row?.operation || "").trim();
      return operation === "income" || operation === "expense" || operation === "business_expense" || operation === "personal_expense";
    })
    .map((row) => {
      const operation = String(row?.operation || "").trim();
      const direction = operation === "income" ? "income" : "expense";
      const channel = direction === "income"
        ? (row?.toChannel || row?.to_channel || row?.fromChannel || row?.from_channel || "")
        : (row?.fromChannel || row?.from_channel || row?.toChannel || row?.to_channel || "");
      return {
        date: row.date,
        channel,
        direction,
        amount: row.amountNet || row.amount_net || row.amount || row.localAmount || "",
        currency: row.currency || inferManualFinanceChannelCurrency(channel),
        category: row.category || (direction === "income" ? "servicein" : "business"),
        subcategory: row.subcategory || "",
        comment: row.comment || row.description || ""
      };
    }), { defaultDate: periodEnd || periodStart });
}

function buildManualFinanceCashEntries(cashRows = []) {
  return normalizeManualFinanceCashRows(cashRows)
    .map((row, index) => {
      const amount = Math.abs(parseLooseNumber(row.amount));
      if (!row.date || !row.channel || !amount) return null;
      return {
        id: `manual-cash:${row.date}:${row.direction}:${row.channel}:${index}`,
        date: row.date,
        channel: row.channel,
        direction: row.direction,
        localAmount: amount,
        currency: row.currency || inferManualFinanceChannelCurrency(row.channel),
        category: row.category || (row.direction === "income" ? "servicein" : "business"),
        subcategory: row.subcategory || "",
        description: row.comment || "",
        transactionSubject: row.comment || "",
        source: "manual",
        amountGross: amount,
        amount_gross: amount,
        amountNet: amount,
        amount_net: amount,
        netAmount: amount,
        sourceTransactionId: `manual-cash:${row.date}:${row.direction}:${formatManualFinanceStableIdPart(row.channel)}:${formatManualFinanceStableIdPart(row.amount)}:${index}`
      };
    })
    .filter(Boolean);
}

function formatManualFinanceStableIdPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "blank";
}

function updateManualFinanceBalanceValue(rowIndex, key, rawValue) {
  if (!state.manualFinance.data) return;
  const rows = state.manualFinance.data.balanceRows || [];
  if (!rows[rowIndex]) rows[rowIndex] = {};
  clearManualServerCache();
  rows[rowIndex][key] = rawValue;
  state.manualFinance.data.balanceRows = normalizeManualFinanceBalanceRows(rows);
  state.manualFinance.dirty = true;
  renderMetrics();
}

function updateManualFinanceCashValue(rowIndex, key, rawValue) {
  if (!state.manualFinance.data) return;
  const rows = state.manualFinance.data.cashRows || [];
  if (!rows[rowIndex]) rows[rowIndex] = {};
  clearManualServerCache();
  rows[rowIndex][key] = rawValue;
  state.manualFinance.data.cashRows = normalizeManualFinanceCashRows(rows);
  state.manualFinance.dirty = true;
  renderMetrics();
}

function addManualFinanceBalanceRow() {
  if (!state.manualFinance.data) return;
  clearManualServerCache();
  state.manualFinance.data.balanceRows = normalizeManualFinanceBalanceRows([
    ...(state.manualFinance.data.balanceRows || []),
    { date: state.manualFinance.data.periodEnd || elements.endDate.value, channel: "", amount: "", currency: "", comment: "" }
  ]);
  state.manualFinance.dirty = true;
  renderTabs();
}

function addManualFinanceCashRow() {
  if (!state.manualFinance.data) return;
  clearManualServerCache();
  state.manualFinance.data.cashRows = normalizeManualFinanceCashRows([
    ...(state.manualFinance.data.cashRows || []),
    { date: state.manualFinance.data.periodEnd || elements.endDate.value, channel: getManualFinanceCashChannels()[0] || "", direction: "expense", amount: "", currency: "", category: "business", comment: "" }
  ]);
  state.manualFinance.dirty = true;
  renderTabs();
}

function updateManualFinanceTransferValue(rowIndex, key, rawValue) {
  const row = state.manualFinance.data?.transferRows?.[rowIndex];
  if (!row) return;
  clearManualServerCache();
  row[key] = rawValue;
  state.manualFinance.dirty = true;
  applyCurrentManualFinancePreview();
  renderMetrics();
}

function addManualFinanceTransferRow() {
  if (!state.manualFinance.data) return;
  clearManualServerCache();
  state.manualFinance.data.transferRows.push(createEmptyManualFinanceTransferRow());
  state.manualFinance.dirty = true;
  applyCurrentManualFinancePreview();
  renderMetrics();
  renderTabs();
}

function removeManualFinanceTransferRow(rowIndex) {
  if (!state.manualFinance.data) return;
  clearManualServerCache();
  state.manualFinance.data.transferRows.splice(rowIndex, 1);
  while (state.manualFinance.data.transferRows.length < MANUAL_TRANSFER_MIN_ROWS) {
    state.manualFinance.data.transferRows.push(createEmptyManualFinanceTransferRow());
  }
  state.manualFinance.dirty = true;
  applyCurrentManualFinancePreview();
  renderMetrics();
  renderTabs();
}

function updateManualTransfersValue(rowIndex, key, rawValue) {
  const row = state.manualTransfers.data?.transferRows?.[rowIndex];
  if (!row) return;
  clearManualServerCache();
  row[key] = rawValue;
  state.manualTransfers.dirty = true;
}

function updateManualCommissionValue(rowIndex, key, rawValue) {
  const row = state.manualTransfers.data?.commissionRows?.[rowIndex];
  if (!row) return;
  clearManualServerCache();
  row[key] = rawValue;
  state.manualTransfers.dirty = true;
}

function addManualTransfersRow() {
  if (!state.manualTransfers.data) return;
  clearManualServerCache();
  state.manualTransfers.data.transferRows.push(createEmptyManualFinanceTransferRow());
  state.manualTransfers.dirty = true;
  renderTabs();
}

function addManualCommissionRow() {
  if (!state.manualTransfers.data) return;
  clearManualServerCache();
  state.manualTransfers.data.commissionRows = normalizeManualCommissionRows(state.manualTransfers.data.commissionRows || [], { padToMinimum: false });
  state.manualTransfers.data.commissionRows.push(createEmptyManualCommissionRow());
  state.manualTransfers.dirty = true;
  renderTabs();
}

function removeManualTransfersRow(rowIndex) {
  if (!state.manualTransfers.data) return;
  clearManualServerCache();
  state.manualTransfers.data.transferRows.splice(rowIndex, 1);
  while (state.manualTransfers.data.transferRows.length < MANUAL_TRANSFER_MIN_ROWS) {
    state.manualTransfers.data.transferRows.push(createEmptyManualFinanceTransferRow());
  }
  state.manualTransfers.dirty = true;
  renderTabs();
}

function removeManualCommissionRow(rowIndex) {
  if (!state.manualTransfers.data) return;
  clearManualServerCache();
  state.manualTransfers.data.commissionRows = normalizeManualCommissionRows(state.manualTransfers.data.commissionRows || [], { padToMinimum: false });
  state.manualTransfers.data.commissionRows.splice(rowIndex, 1);
  while (state.manualTransfers.data.commissionRows.length < MANUAL_TRANSFER_MIN_ROWS) {
    state.manualTransfers.data.commissionRows.push(createEmptyManualCommissionRow());
  }
  state.manualTransfers.dirty = true;
  renderTabs();
}

function setManualTransfersStatus(message, isError = false) {
  state.manualTransfers.status = message || "";
  state.manualTransfers.error = Boolean(isError);
}

async function loadManualTransfersSheet(startDate, endDate, interactive = false) {
  state.manualTransfers.loading = true;
  renderTabs();
  try {
    if (!hasConfiguredManualFinanceEndpoint()) {
      throw new Error(getManualFinanceUnavailableMessage());
    }
    const data = await getManualTransfersSheetDirect(startDate, endDate);
    state.manualTransfers.data = data;
    state.manualTransfers.dirty = false;
    setManualTransfersStatus("Переводы за диапазон открыты.", false);
  } catch (error) {
    setManualTransfersStatus(error.message || "Не удалось открыть переводы.", true);
  } finally {
    state.manualTransfers.loading = false;
    renderTabs();
  }
}

async function syncManualTransfersForCurrentRange(startDate, endDate) {
  if (!hasConfiguredManualFinanceEndpoint()) return;
  try {
    state.manualTransfers.data = await getManualTransfersSheetDirect(startDate, endDate);
    state.manualTransfers.dirty = false;
    setManualTransfersStatus("Переводы за диапазон загружены.", false);
  } catch (error) {
    state.manualTransfers.data = null;
    setManualTransfersStatus(error.message || "Не удалось загрузить переводы для списка выплат.", true);
  }
}

async function saveManualTransfersSheet() {
  if (!state.manualTransfers.data) return;
  const period = normalizePeriod(state.manualTransfers.data.periodStart, state.manualTransfers.data.periodEnd);
  const transferRows = normalizeManualFinanceTransferRows(state.manualTransfers.data.transferRows, { padToMinimum: false })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()))
    .map((row) => ({
      transferDate: normalizeIncomingSheetDateValue(row.transferDate) || period.endDate,
      who: String(row.who || "").trim(),
      amount: normalizeManualFinancePersistedNumberInput(row.amount),
      currency: String(row.currency || "").trim(),
      channel: String(row.channel || "").trim(),
      rate: normalizeManualFinancePersistedNumberInput(row.rate),
      usdAmount: normalizeManualFinancePersistedNumberInput(row.usdAmount)
    }));
  const commissionRows = normalizeManualCommissionRows(state.manualTransfers.data.commissionRows || [], { padToMinimum: false })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()))
    .map((row) => ({
      date: normalizeIncomingSheetDateValue(row.date) || period.endDate,
      channel: String(row.channel || "").trim(),
      usdAmount: normalizeManualFinancePersistedNumberInput(row.usdAmount),
      comment: String(row.comment || "").trim()
    }));
  state.manualTransfers.loading = true;
  renderTabs();
  try {
    if (!hasConfiguredManualFinanceEndpoint()) {
      throw new Error(getManualFinanceUnavailableMessage());
    }
    const response = await saveManualTransfersSheetDirect(period.startDate, period.endDate, transferRows, commissionRows);
    state.manualTransfers.data = await getManualTransfersSheetDirect(period.startDate, period.endDate);
    state.manualTransfers.dirty = false;
    setManualTransfersStatus(`Переводы сохранены. ${response?.savedAt || ""}`.trim(), false);
    await loadDashboardData();
  } catch (error) {
    setManualTransfersStatus(error.message || "Не удалось сохранить переводы.", true);
  } finally {
    state.manualTransfers.loading = false;
    renderTabs();
  }
}

function buildManualFinanceStateFromPayload(data, startDate, endDate) {
  const expenseRows = data.emptyFact
    ? []
    : normalizeManualFinanceExpenseRows(data.expenseRows, startDate, endDate);
  return {
    sheetName: data.displayName || data.sheetName || buildManualFinancePeriodLabel(startDate, endDate),
    created: Boolean(data.created),
    virtual: Boolean(data.virtual),
    writeEnabled: Boolean(data.writeEnabled),
    periodStart: data.periodStart || startDate,
    periodEnd: data.periodEnd || endDate,
    status: data.status || "saved",
    sourceType: data.sourceType || "incoming-repository",
    sourceSheetName: data.sourceSheetName || "",
    spreadsheetUrl: data.spreadsheetUrl || state.config?.manualFinance?.spreadsheetUrl || "",
    moneyTitle: data.moneyTitle || MANUAL_FINANCE_MONEY_TITLE,
    moneyHeaders: Array.isArray(data.moneyHeaders) && data.moneyHeaders.length ? data.moneyHeaders : MANUAL_FINANCE_HEADERS,
    moneyRows: Array.isArray(data.moneyRows) && data.moneyRows.length
      ? normalizeManualFinanceMoneyRows(data.moneyRows)
      : buildLegacyFactMoneyRowsFromExpenseRows(expenseRows),
    transferTitle: data.transferTitle || MANUAL_FINANCE_TRANSFER_TITLE,
    transferHeaders: Array.isArray(data.transferHeaders) && data.transferHeaders.length ? data.transferHeaders : MANUAL_TRANSFER_HEADERS,
    transferRows: normalizeManualFinanceTransferRows(data.transferRows),
    balanceTitle: data.balanceTitle || MANUAL_FINANCE_BALANCE_TITLE,
    balanceHeaders: Array.isArray(data.balanceHeaders) && data.balanceHeaders.length ? data.balanceHeaders : MANUAL_BALANCE_HEADERS,
    balanceRows: normalizeManualFinanceBalanceRows(data.balanceRows, { defaultDate: data.periodEnd || endDate }),
    ledgerTitle: data.ledgerTitle || MANUAL_FINANCE_LEDGER_TITLE,
    ledgerRows: Array.isArray(data.ledgerRows) ? data.ledgerRows.map((row) => ({ ...row })) : [],
    ledgerWarnings: Array.isArray(data.ledgerWarnings) ? data.ledgerWarnings.slice() : [],
    cashRows: normalizeManualFinanceCashRows(
      Array.isArray(data.cashRows) && data.cashRows.length
        ? data.cashRows
        : buildManualFinanceCashRowsFromLedgerRows(data.ledgerRows, data.periodStart || startDate, data.periodEnd || endDate),
      { defaultDate: data.periodEnd || endDate }
    ),
    expenseTitle: data.expenseTitle || MANUAL_FINANCE_EXPENSE_TITLE,
    expenseHeaders: Array.isArray(data.expenseHeaders) && data.expenseHeaders.length ? data.expenseHeaders : buildManualExpenseHeaders(),
    expenseRows
  };
}

function syncAnalyticsFactFromManualData(manualData) {
  if (!manualData) return;
  state.analyticsFact = {
    periodStart: manualData.periodStart || "",
    periodEnd: manualData.periodEnd || "",
    moneyTitle: manualData.moneyTitle || MANUAL_FINANCE_MONEY_TITLE,
    moneyHeaders: Array.isArray(manualData.moneyHeaders) ? manualData.moneyHeaders.slice() : MANUAL_FINANCE_HEADERS.slice(),
    moneyRows: Array.isArray(manualData.moneyRows) ? manualData.moneyRows.map((row) => ({ ...row })) : [],
    transferRows: Array.isArray(manualData.transferRows) ? manualData.transferRows.map((row) => ({ ...row })) : []
  };
}

function applyCurrentManualFinancePreview() {
  if (!state.data?.tabs || !state.manualFinance.data) return;
  const aggregatedManual = {
    rows: buildAnalyticsManualRowsFromFactMoneyRows(
      state.manualFinance.data.moneyRows || [],
      state.manualFinance.data.transferRows || []
    ),
    transferRows: buildAnalyticsTransfersFromFactRows(state.manualFinance.data.transferRows || []),
    selectedSheets: [state.manualFinance.data.sourceSheetName || MANUAL_INCOMING_TITLE]
  };
  const payoutsValues = state.data.tabs.payouts?.values || [];
  if (state.data.tabs.payouts) {
    state.data.tabs.payouts = {
      ...state.data.tabs.payouts,
      closedFactTransferHeaders: MANUAL_TRANSFER_HEADERS.slice(),
      closedFactTransfers: (aggregatedManual.transferRows || []).map((row) => [
        row.date || "",
        row.who || "",
        row.amount || "",
        row.localCurrency || "",
        row.destination || "",
        row.rate || "",
        row.usdAmount || ""
      ])
    };
  }
  if (state.data.tabs.analytics) {
    state.data.tabs.analytics = {
      ...state.data.tabs.analytics,
      values: normalizePlanGrowthFormula(
        buildFullRangeBasedAnalyticsValuesFromClosedFact(
          state.data.tabs.analytics.values || [],
          state.data.tabs.movement?.values || [],
          payoutsValues,
          state.data.tabs.savings?.values || [],
          aggregatedManual
        )
      ),
      headerRowIndex: -1,
      sourceType: "live-preview-plus-fact",
      selectedClosedSheets: aggregatedManual.selectedSheets || []
    };
  }
  if (state.data.tabs.movement) {
    state.data.tabs.movement.summaryRows = buildMovementSummaryRows(
      state.data.tabs.movement.values || [],
      state.data.tabs.orders?.values || [],
      payoutsValues,
      state.data.tabs.movement.summaryRows || []
    );
  }
}

async function syncManualFinanceForCurrentPeriod() {
  await refreshManualFinanceDates();
  await loadManualFinanceSheet(elements.startDate.value, elements.endDate.value, false);
}

async function refreshManualFinanceDates() {
  if (!hasConfiguredManualFinanceEndpoint()) {
    throw new Error(getManualFinanceUnavailableMessage());
  }
  const payload = await listManualSheetDatesDirect();
  const dates = Array.isArray(payload?.dates) ? payload.dates : [];
  state.manualFinance.periods = dates.map((date) => ({ startDate: date, endDate: date, status: "saved" }));
}

async function loadManualFinanceSheet(startDate, endDate, interactive = false) {
  state.manualFinance.loading = true;
  renderTabs();
  try {
    if (!hasConfiguredManualFinanceEndpoint()) {
      throw new Error(getManualFinanceUnavailableMessage());
    }
    const payload = await getManualSheetDirect(startDate, endDate);
    const manualData = await hydrateManualFinanceFromMainFactImport(
      await hydrateManualFinanceNowFromSavings(
        buildManualFinanceStateFromPayload(payload, startDate, endDate)
      )
    );
    state.manualFinance.data = manualData;
    state.manualFinance.dirty = false;
    syncAnalyticsFactFromManualData(manualData);
    setManualFinanceStatus(
      "Fact открыт. Записи сохраняются в скрытый репозиторий `Переводы` + `Расходы`, а аналитика собирается за выбранный период.",
      false
    );
  } catch (error) {
    throw error;
  } finally {
    state.manualFinance.loading = false;
    renderMetrics();
    renderTabs();
  }
}

function openLocalManualFinancePeriod(startDate, endDate, statusMessage, isError = true) {
  const saved = getLocalDraft(startDate, endDate);
  const expenseRows = normalizeManualFinanceExpenseRows(saved?.expenseRows, startDate, endDate);
  const data = {
    sheetName: buildManualFinancePeriodLabel(startDate, endDate),
    created: false,
    virtual: true,
    writeEnabled: false,
    periodStart: startDate,
    periodEnd: endDate,
    status: saved?.status || "draft",
    moneyTitle: MANUAL_FINANCE_MONEY_TITLE,
    moneyHeaders: MANUAL_FINANCE_HEADERS,
    moneyRows: buildLegacyFactMoneyRowsFromExpenseRows(expenseRows),
    transferTitle: MANUAL_FINANCE_TRANSFER_TITLE,
    transferHeaders: MANUAL_TRANSFER_HEADERS,
    transferRows: normalizeManualFinanceTransferRows(saved?.transferRows),
    balanceTitle: MANUAL_FINANCE_BALANCE_TITLE,
    balanceHeaders: MANUAL_BALANCE_HEADERS,
    balanceRows: normalizeManualFinanceBalanceRows(saved?.balanceRows, { defaultDate: endDate }),
    cashRows: normalizeManualFinanceCashRows(saved?.cashRows, { defaultDate: endDate }),
    expenseTitle: MANUAL_FINANCE_EXPENSE_TITLE,
    expenseHeaders: buildManualExpenseHeaders(),
    expenseRows,
    spreadsheetUrl: state.config?.manualFinance?.spreadsheetUrl || ""
  };
  state.manualFinance.data = data;
  state.manualFinance.dirty = false;
  syncAnalyticsFactFromManualData(data);
  setManualFinanceStatus(statusMessage, isError);
}

async function saveManualFinanceSheet() {
  if (!state.manualFinance.data) return;
  const activeInnerTab = state.manualFinance.activeInnerTab || "balances";
  if (activeInnerTab === "cash") {
    await saveManualFinanceCashRows();
    return;
  }
  if (activeInnerTab === "balances") {
    await saveManualFinanceBalanceRows();
    return;
  }
  const moneyRows = state.manualFinance.data.moneyRows || [];
  const balanceRows = normalizeManualFinanceBalanceRows(collectManualFinanceBalanceRowsFromEditor(), {
    defaultDate: state.manualFinance.data.periodEnd || elements.endDate.value
  }).filter((row) => row.date && row.channel && (String(row.amount || "").trim() || String(row.usdAmount || "").trim()));
  const payload = {
    startDate: state.manualFinance.data.periodStart,
    endDate: state.manualFinance.data.periodEnd,
    moneyRows: moneyRows.map((row, rowIndex) => ({
      channel: row.channel,
      now: row.now,
      serviceIncome: row.serviceIncome,
      business: row.business,
      food: row.food,
      house: row.house,
      study: row.study,
      travelFun: row.travelFun,
      exchange: row.exchange,
      total: row.total
    })),
    transferRows: state.manualFinance.data.transferRows.map((row) => ({
      transferDate: String(row.transferDate || "").trim(),
      who: String(row.who || "").trim(),
      amount: normalizeManualFinancePersistedNumberInput(row.amount),
      currency: String(row.currency || "").trim(),
      channel: String(row.channel || "").trim(),
      rate: normalizeManualFinancePersistedNumberInput(row.rate),
      usdAmount: normalizeManualFinancePersistedNumberInput(row.usdAmount)
    })).filter((row) => Object.values(row).some((value) => String(value || "").trim() !== "")),
    balanceRows
  };
  if (!hasConfiguredManualFinanceEndpoint()) {
    persistLocalDraft(payload.startDate, payload.endDate, payload);
    state.manualFinance.dirty = false;
    syncAnalyticsFactFromManualData(state.manualFinance.data);
    setManualFinanceStatus("Локальный draft fact сохранён в браузере.", false);
    renderTabs();
    return;
  }
  state.manualFinance.loading = true;
  renderTabs();
  try {
    const response = await saveManualSheetDirect(payload);
    if (balanceRows.length) {
      const balanceResponse = await saveBalanceSnapshotRowsDirect(balanceRows);
      const savedCount = resolveManualFinanceBalanceSavedCount(balanceResponse, balanceRows.length);
      if (savedCount < balanceRows.length) {
        throw new Error(`Остатки сохранены не полностью: сохранено ${savedCount} из ${balanceRows.length} строк.`);
      }
      state.manualFinance.data.balanceRows = balanceRows;
    }
    await syncMainAnalyticsFactImportFromMoneyRows(state.manualFinance.data.moneyRows, state.manualFinance.data.transferRows);
    await loadDashboardData();
    setManualFinanceStatus(`Fact за период сохранён в репозиторий. ${response?.savedAt || ""}`.trim(), false);
  } catch (error) {
    setManualFinanceStatus(error.message || "Не удалось сохранить входящие данные.", true);
  } finally {
    state.manualFinance.loading = false;
    renderTabs();
  }
}

async function saveManualFinanceBalanceRows() {
  if (!state.manualFinance.data) return;
  const expectedRows = ensureManualFinanceBalanceInputRows();
  const expectedRowCount = countSavableManualFinanceBalanceRows(expectedRows);
  const rows = normalizeManualFinanceBalanceRows(collectManualFinanceBalanceRowsFromEditor(), {
    defaultDate: state.manualFinance.data.periodEnd || elements.endDate.value
  }).filter(isSavableManualFinanceBalanceRow);
  if (expectedRowCount > 1 && rows.length <= 1) {
    setManualFinanceStatus(`Остатки сохранены не полностью: собрано ${rows.length} из ${expectedRowCount} строк. Проверьте таблицу Факт.`, true);
    renderTabs();
    return;
  }
  if (!hasConfiguredManualFinanceEndpoint()) {
    persistLocalDraft(state.manualFinance.data.periodStart, state.manualFinance.data.periodEnd, {
      ...(getLocalDraft(state.manualFinance.data.periodStart, state.manualFinance.data.periodEnd) || {}),
      balanceRows: rows
    });
    state.manualFinance.data.balanceRows = rows;
    state.manualFinance.dirty = false;
    setManualFinanceStatus("Локальный draft Остатки сохранён в браузере.", false);
    renderTabs();
    return;
  }
  state.manualFinance.loading = true;
  renderTabs();
  try {
    const response = await saveBalanceSnapshotRowsDirect(rows);
    const savedCount = resolveManualFinanceBalanceSavedCount(response, rows.length);
    state.manualFinance.data.balanceRows = rows;
    state.manualFinance.dirty = false;
    await loadDashboardData();
    if (expectedRowCount > 1 && savedCount < expectedRowCount) {
      setManualFinanceStatus(`Остатки сохранены не полностью: сохранено ${savedCount} из ${expectedRowCount} строк.`, true);
    } else {
      const displayExpectedCount = Math.max(expectedRowCount || 0, rows.length);
      setManualFinanceStatus(`Остатки сохранены: ${savedCount} из ${displayExpectedCount || rows.length} строк. ${response?.savedAt || ""}`.trim(), false);
    }
  } catch (error) {
    setManualFinanceStatus(error.message || "Не удалось сохранить Остатки.", true);
  } finally {
    state.manualFinance.loading = false;
    renderTabs();
  }
}

function isSavableManualFinanceBalanceRow(row) {
  return Boolean(
    row?.date &&
    row?.channel &&
    (hasManualFinanceBalanceValue(row?.amount) || hasManualFinanceBalanceValue(row?.usdAmount))
  );
}

function countSavableManualFinanceBalanceRows(rows = []) {
  return normalizeManualFinanceBalanceRows(rows, {
    defaultDate: state.manualFinance.data?.periodEnd || elements.endDate.value
  }).filter((row) => row.date && row.channel && row.currency).length;
}

function hasManualFinanceBalanceValue(value) {
  return String(value ?? "").trim() !== "";
}

function resolveManualFinanceBalanceSavedCount(response, fallbackCount = 0) {
  const candidates = [
    response?.rowCount,
    response?.fact_balance_rows_saved_to_ostatki,
    Number(response?.inserted || 0) + Number(response?.updated || 0),
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  const skipped = Number(response?.skipped);
  if (Number.isFinite(skipped) && skipped >= 0) return Math.max(0, Number(fallbackCount || 0) - skipped);
  return Number(fallbackCount || 0);
}

function collectManualFinanceBalanceRowsFromEditor() {
  const fallbackRows = state.manualFinance.data?.balanceRows || [];
  if (typeof document === "undefined") return fallbackRows;
  const table = document.querySelector("[data-manual-balance-editor]");
  if (!table) return fallbackRows;
  const rows = Array.from(table.querySelectorAll("tr[data-manual-balance-row]")).map((row) => {
    const read = (field) => row.querySelector(`[data-manual-balance-field="${field}"]`)?.value || "";
    return {
      date: read("date"),
      channel: read("channel"),
      currency: read("currency"),
      amount: read("amount"),
      rate: read("rate"),
      usdAmount: read("usdAmount"),
      comment: read("comment")
    };
  });
  return rows.length ? rows : fallbackRows;
}

async function saveManualFinanceCashRows() {
  if (!state.manualFinance.data) return;
  const rows = normalizeManualFinanceCashRows(state.manualFinance.data.cashRows, {
    defaultDate: state.manualFinance.data.periodEnd || elements.endDate.value
  });
  const entries = buildManualFinanceCashEntries(rows);
  if (!hasConfiguredManualFinanceEndpoint()) {
    persistLocalDraft(state.manualFinance.data.periodStart, state.manualFinance.data.periodEnd, {
      ...(getLocalDraft(state.manualFinance.data.periodStart, state.manualFinance.data.periodEnd) || {}),
      cashRows: rows
    });
    state.manualFinance.data.cashRows = rows;
    state.manualFinance.dirty = false;
    setManualFinanceStatus("Локальный draft Наличные сохранён в браузере.", false);
    renderTabs();
    return;
  }
  if (!entries.length) {
    setManualFinanceStatus("Нет строк Наличные для сохранения.", true);
    renderTabs();
    return;
  }
  state.manualFinance.loading = true;
  renderTabs();
  try {
    const response = await saveExpenseAccountingEntriesDirect(entries);
    state.manualFinance.data.cashRows = rows;
    state.manualFinance.dirty = false;
    await loadDashboardData();
    setManualFinanceStatus(`Наличные сохранены в Ledger: ${response?.ledgerRowCount || entries.length}. ${response?.savedAt || ""}`.trim(), false);
  } catch (error) {
    setManualFinanceStatus(error.message || "Не удалось сохранить Наличные.", true);
  } finally {
    state.manualFinance.loading = false;
    renderTabs();
  }
}


// ============================================================
// HELPERS
// ============================================================

function buildDefaultManualSheetValues() {
  return buildManualSheetValuesFromState(
    normalizeManualFinanceMoneyRows(),
    normalizeManualFinanceTransferRows([], { padToMinimum: false })
  );
}

function buildManualSheetValuesFromState(moneyRows, transferRows) {
  const body = [];
  body.push([MANUAL_FINANCE_MONEY_TITLE, "", "", "", "", "", "", "", "", ""]);
  body.push(MANUAL_FINANCE_HEADERS.slice());
  const baseRows = moneyRows.slice(0, MANUAL_FINANCE_MONEY_CHANNELS.length);
  baseRows.forEach((row) => {
    body.push([
      row.channel || "",
      row.now || "",
      row.serviceIncome || "",
      row.business || "",
      row.house || "",
      row.food || "",
      row.fun || "",
      row.study || "",
      row.travelFun || "",
      row.total || "",
      row.exchange || ""
    ]);
  });
  const summary = moneyRows[MANUAL_FINANCE_MONEY_CHANNELS.length] || {
    channel: MANUAL_FINANCE_TOTAL_LABEL,
    now: "",
    serviceIncome: "",
    business: "",
    food: "",
    house: "",
    fun: "",
    study: "",
    travelFun: "",
    total: "",
    exchange: ""
  };
  body.push([
    summary.channel || MANUAL_FINANCE_TOTAL_LABEL,
    summary.now || "",
    summary.serviceIncome || "",
    summary.business || "",
    summary.house || "",
    summary.food || "",
    summary.fun || "",
    summary.study || "",
    summary.travelFun || "",
    summary.total || "",
    summary.exchange || ""
  ]);
  body.push(["", "", "", "", "", "", "", "", "", ""]);
  body.push([MANUAL_FINANCE_TRANSFER_TITLE, "", "", "", "", "", "", "", "", ""]);
  body.push([...MANUAL_TRANSFER_HEADERS, "", "", ""]);
  transferRows.forEach((row) => {
    body.push([
      row.date || "",
      row.amount || "",
      row.localCurrency || "",
      row.rate || "",
      row.usdAmount || "",
      row.destination || "",
      "",
      "",
      ""
    ]);
  });
  return body;
}

function parseManualSheetValues(values) {
  const rows = values || [];
  const moneyTitle = rows[0]?.[0] || MANUAL_FINANCE_MONEY_TITLE;
  const moneyHeaders = rows[1]?.length ? rows[1].slice(0, MANUAL_FINANCE_HEADERS.length) : MANUAL_FINANCE_HEADERS.slice();
  const hasServiceIncomeColumn = /(service|приход)/i.test(String(moneyHeaders[2] || "").trim());
  const moneyRows = [];
  let index = 2;
  while (index < rows.length) {
    const row = rows[index] || [];
    const label = String(row[0] || "").trim();
    if (!label) {
      index += 1;
      continue;
    }
    if (label === MANUAL_FINANCE_TRANSFER_TITLE) break;
    if (label === MANUAL_FINANCE_TOTAL_LABEL) {
      moneyRows.push({
        channel: label,
        now: row[1] || "",
        serviceIncome: hasServiceIncomeColumn ? (row[2] || "") : "",
        business: hasServiceIncomeColumn ? (row[3] || "") : (row[2] || ""),
        house: hasServiceIncomeColumn ? (row[4] || "") : (row[4] || ""),
        food: hasServiceIncomeColumn ? (row[5] || "") : (row[3] || ""),
        fun: hasServiceIncomeColumn ? (row[6] || "") : "",
        study: hasServiceIncomeColumn ? (row[7] || "") : (row[5] || ""),
        travelFun: hasServiceIncomeColumn ? (row[8] || "") : (row[6] || ""),
        total: hasServiceIncomeColumn ? (row[9] || "") : (row[7] || ""),
        exchange: hasServiceIncomeColumn ? (row[10] || "") : (row[8] || "")
      });
      index += 1;
      break;
    }
    moneyRows.push({
      channel: label,
      now: row[1] || "",
      serviceIncome: hasServiceIncomeColumn ? (row[2] || "") : "",
      business: hasServiceIncomeColumn ? (row[3] || "") : (row[2] || ""),
      house: hasServiceIncomeColumn ? (row[4] || "") : (row[4] || ""),
      food: hasServiceIncomeColumn ? (row[5] || "") : (row[3] || ""),
      fun: hasServiceIncomeColumn ? (row[6] || "") : "",
      study: hasServiceIncomeColumn ? (row[7] || "") : (row[5] || ""),
      travelFun: hasServiceIncomeColumn ? (row[8] || "") : (row[6] || ""),
      total: hasServiceIncomeColumn ? (row[9] || "") : (row[7] || ""),
      exchange: hasServiceIncomeColumn ? (row[10] || "") : (row[8] || "")
    });
    index += 1;
  }
  while (moneyRows.length < MANUAL_FINANCE_MONEY_CHANNELS.length + 1) {
    if (moneyRows.length < MANUAL_FINANCE_MONEY_CHANNELS.length) {
      moneyRows.push({
        channel: MANUAL_FINANCE_MONEY_CHANNELS[moneyRows.length],
        now: "", serviceIncome: "", business: "", food: "", house: "", fun: "", study: "", travelFun: "", total: "", exchange: ""
      });
    } else {
      moneyRows.push({
        channel: MANUAL_FINANCE_TOTAL_LABEL,
        now: "", serviceIncome: "", business: "", food: "", house: "", fun: "", study: "", travelFun: "", total: "", exchange: ""
      });
    }
  }
  while (index < rows.length && String(rows[index]?.[0] || "").trim() !== MANUAL_FINANCE_TRANSFER_TITLE) index += 1;
  const transferHeaders = rows[index + 1]?.length ? rows[index + 1].slice(0, MANUAL_TRANSFER_HEADERS.length) : MANUAL_TRANSFER_HEADERS.slice();
  const transferRows = [];
  for (let cursor = index + 2; cursor < rows.length; cursor += 1) {
    const row = rows[cursor] || [];
    if (!row.some((cell) => String(cell || "").trim())) continue;
    transferRows.push({
      date: row[0] || "",
      amount: row[1] || "",
      localCurrency: row[2] || "",
      rate: row[3] || "",
      usdAmount: row[4] || "",
      destination: row[5] || ""
    });
  }
  return {
    moneyTitle,
    moneyHeaders,
    moneyRows: normalizeManualFinanceMoneyRows(moneyRows),
    transferTitle: MANUAL_FINANCE_TRANSFER_TITLE,
    transferHeaders,
    transferRows: normalizeManualFinanceTransferRows(transferRows)
  };
}

function columnLetter(number) {
  let temp = "";
  let n = number;
  while (n > 0) {
    const rem = (n - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    n = Math.floor((n - rem) / 26);
  }
  return temp || "A";
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function normalizeManualFinanceNumberInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (isManualFinanceFormula(raw)) return raw;
  const parsed = parseLooseNumber(raw);
  return Number.isFinite(parsed) ? String(roundTo2(parsed)) : "";
}


// ============================================================
// HELPERS
// ============================================================

function filterManualFlowExpenseRows(rows) {
  return (rows || []).filter((row) => normalizeManualExpenseCategory(row?.category) !== MANUAL_NOW_CATEGORY);
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildManualBalanceRowsFromAmounts(date, amounts = {}, transferRows = [], movementValues = []) {
  const rateLookup = buildManualFinanceUsdRateLookup(transferRows, movementValues, { endDate: date });
  return getManualFinanceChannels().map((channel) => {
    const rawAmount = normalizeManualFinancePersistedNumberInput(amounts?.[channel]);
    const amount = parseLooseNumber(rawAmount);
    if (!rawAmount || !amount) return null;
    const currency = inferManualFinanceChannelCurrency(channel);
    const usdAmount = currency === "USD"
      ? amount
      : parseLooseNumber(getManualFinanceNowUsdValue({ channel, now: rawAmount }, rateLookup));
    return {
      date,
      channel,
      amount: rawAmount,
      currency,
      rate: formatSheetNumber(getLocalPerUsdRate(currency, rateLookup), 6),
      usdAmount: formatSheetNumber(usdAmount),
      comment: ""
    };
  }).filter(Boolean);
}

function buildManualBalanceRowsFromMoneyRows(moneyRows, date, transferRows = [], movementValues = []) {
  const amounts = {};
  normalizeManualFinanceMoneyRows(moneyRows).forEach((row) => {
    const channel = String(row?.channel || "").trim();
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    amounts[channel] = row.now;
  });
  return buildManualBalanceRowsFromAmounts(date, amounts, transferRows, movementValues);
}

function buildManualBalanceRowsFromNowExpenseRows(expenseRows, date, transferRows = [], movementValues = []) {
  const amounts = {};
  (expenseRows || [])
    .filter((row) => normalizeManualExpenseCategory(row?.category) === MANUAL_NOW_CATEGORY)
    .forEach((row) => {
      getManualFinanceChannels().forEach((channel) => {
        const raw = normalizeManualFinancePersistedNumberInput(row.amounts?.[channel]);
        if (raw && parseLooseNumber(raw)) amounts[channel] = raw;
      });
    });
  return buildManualBalanceRowsFromAmounts(date, amounts, transferRows, movementValues);
}


// ============================================================
// HELPERS
// ============================================================

function persistLocalDraft(startDate, endDate, data) {
  localStorage.setItem(getDraftKey(startDate, endDate), JSON.stringify(data));
  const list = listLocalDrafts().filter((item) => item.startDate !== startDate || item.endDate !== endDate);
  list.unshift({ startDate, endDate, status: data.status || "draft" });
  localStorage.setItem("ezohata-v2-local-drafts", JSON.stringify(list.slice(0, 30)));
}

function getLocalDraft(startDate, endDate) {
  try { return JSON.parse(localStorage.getItem(getDraftKey(startDate, endDate)) || "null"); }
  catch { return null; }
}

function listLocalDrafts() {
  try { return JSON.parse(localStorage.getItem("ezohata-v2-local-drafts") || "[]"); }
  catch { return []; }
}

function getDraftKey(startDate, endDate) {
  return `ezohata:incoming-ledger:${startDate}:${endDate}`;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function setManualFinanceStatus(message, isError = false) {
  state.manualFinance.status = message;
  state.manualFinance.error = Boolean(isError);
}

function getManualFinanceUnavailableMessage() {
  if (hasManualWorkbookServerAccess()) {
    return "Manual workbook server access is unavailable. Browser OAuth fallback is debug-only.";
  }
  return "Manual workbook server access is not configured.";
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function buildMovementSummaryRows(movementValues, ordersValues, payoutsValues, fallbackSummaryRows = []) {
  if (!movementValues.length) return fallbackSummaryRows;
  const movementTotals = getMovementTotalsFromTable(movementValues);
  const priceTotal = movementTotals.priceTotal;
  const accruedTotal = movementTotals.accruedTotal;
  const seventyTotal = movementTotals.seventyTotal;
  const receivedUsdTotal = movementTotals.receivedUsdTotal;
  const ordersSummary = buildOrdersSummaryFromClient(ordersValues || []);
  const ordersAccruedTotal = parseLooseNumber(ordersSummary.totalAccruedPlus3Pct);
  const ordersReceivedUsd = ordersSummary.totalReceivedUsd || 0;
  const payoutUsdTotal =
    getCombinedPayoutUsdTotal(
      payoutsValues || [],
      state.data?.tabs?.payouts?.closedFactTransfers || []
    ) ||
    calculateClosedFactTransferUsdTotal(payoutsValues || []) ||
    getSummaryValueByLabel(fallbackSummaryRows, SUMMARY_LABELS.payout);
  const openingBalance = getSummaryValueByLabel(fallbackSummaryRows, SUMMARY_LABELS.openingBalance);
  const factTotals = getCurrentFactMetricTotals();
  const totalAccrued = seventyTotal + (ordersAccruedTotal * 0.7);
  const percent = accruedTotal - priceTotal;
  const balance = movementTotals.balanceTotal;
  const totalBalance = buildAnalyticsUpgradeTotals({
    totalOrdersSeventyPct: totalAccrued,
    totalPaid: payoutUsdTotal,
    myServicesTotal: factTotals.myServices,
    myCostsTotal: factTotals.myCosts
  }).total;
  return [
    [SUMMARY_LABELS.price, formatSummaryNumber(priceTotal)],
    [SUMMARY_LABELS.accrued, formatSummaryNumber(accruedTotal)],
    [SUMMARY_LABELS.percent, formatSummaryNumber(percent)],
    [SUMMARY_LABELS.receivedUsd, formatSummaryNumber(receivedUsdTotal)],
    [SUMMARY_LABELS.balance, formatSummaryNumber(balance)],
    [SUMMARY_LABELS.seventyPct, formatSummaryNumber(seventyTotal)],
    [SUMMARY_LABELS.orders, formatSummaryNumber(ordersReceivedUsd)],
    [SUMMARY_LABELS.totalAccrued, formatSummaryNumber(totalAccrued)],
    [SUMMARY_LABELS.payout, formatSummaryNumber(payoutUsdTotal)],
    [SUMMARY_LABELS.openingBalance, formatSummaryNumber(openingBalance)],
    [SUMMARY_LABELS.totalBalance, formatSummaryNumber(totalBalance)]
  ];
}

function getSummaryValueByLabel(rows, label) {
  const found = (rows || []).find((row) => String(row?.[0] || "").trim().toLowerCase() === String(label || "").trim().toLowerCase());
  return found ? parseLooseNumber(found[1]) : 0;
}

function formatSummaryNumber(value) {
  return formatSheetNumber(value, 4);
}

async function aggregateClosedManualPeriodDataDirect(startDate, endDate) {
  const metadata = await getManualSpreadsheetMetadata();
  const titles = new Set((metadata.sheets || []).map((sheet) => sheet?.properties?.title || ""));
  const [ledgerValues, transferValues, expenseValues, balanceValues, commissionValues] = await Promise.all([
    titles.has(getManualLedgerSheetName())
      ? getSheetValuesByTitle(getManualLedgerSheetName())
      : Promise.resolve(buildManualLedgerSheetValues([])),
    titles.has(getManualTransfersSheetName())
      ? getSheetValuesByTitle(getManualTransfersSheetName())
      : Promise.resolve(buildIncomingTransferSheetValues([])),
    titles.has(getManualExpensesSheetName())
      ? getSheetValuesByTitle(getManualExpensesSheetName())
      : Promise.resolve(buildIncomingExpenseSheetValues([])),
    titles.has(getManualBalancesSheetName())
      ? getSheetValuesByTitle(getManualBalancesSheetName())
      : Promise.resolve(buildIncomingBalanceSheetValues([])),
    titles.has(getManualCommissionsSheetName())
      ? getSheetValuesByTitle(getManualCommissionsSheetName())
      : Promise.resolve(buildIncomingCommissionSheetValues([]))
  ]);
  const transferRows = parseIncomingTransferSheetValues(transferValues)
    .filter((row) => row.transferDate && row.transferDate >= startDate && row.transferDate <= endDate)
    .map((row) => ({
      date: row.transferDate || "",
      who: row.who || "",
      amount: row.amount || "",
      localCurrency: row.currency || "",
      rate: row.rate || "",
      usdAmount: row.usdAmount || "",
      destination: row.channel || ""
    }));
  const ledgerParse = parseManualLedgerSheetValues(ledgerValues);
  const ledgerExpenseRows = buildExpenseRowsFromLedgerRows(ledgerParse.rows, startDate, endDate);
  const parsedExpenseRows = ledgerExpenseRows.length ? ledgerExpenseRows : parseIncomingExpenseSheetValues(expenseValues);
  const expenseRows = normalizeManualFinanceExpenseRows(
    filterManualFlowExpenseRows(parsedExpenseRows).filter((row) => row.date && row.date >= startDate && row.date <= endDate),
    startDate,
    endDate
  );
  const commissionRows = parseIncomingCommissionSheetValues(commissionValues)
    .filter((row) => row.date && row.date >= startDate && row.date <= endDate);
  const latestNowEntriesByChannel = mergeLatestNowEntries(
    buildLatestBalanceEntriesByChannel(parseIncomingBalanceSheetValues(balanceValues), endDate),
    buildLatestNowEntriesByChannel(parsedExpenseRows, endDate)
  );
  return {
    rows: buildManualFinanceSummaryRows(expenseRows, latestNowEntriesByChannel),
    transferRows,
    commissionRows,
    latestNowByChannel: Object.fromEntries(
      Object.entries(latestNowEntriesByChannel).map(([channel, row]) => [channel, row.value])
    ),
    latestNowEntriesByChannel,
    ledgerRows: ledgerParse.rows,
    ledgerWarnings: ledgerParse.warnings,
    selectedSheets: ledgerExpenseRows.length
      ? [getManualLedgerSheetName(), getManualBalancesSheetName(), getManualTransfersSheetName(), getManualCommissionsSheetName()]
      : [getManualExpensesSheetName(), getManualBalancesSheetName(), getManualTransfersSheetName(), getManualCommissionsSheetName()]
  };
}

function buildAggregatedManualDataFromServerPayload(manual, startDate, endDate) {
  const ledgerExpenseRows = buildServerExpenseRowsFromLedgerV2(manual?.ledgerV2Rows || manual?.operations || [], startDate, endDate);
  const expenseRows = normalizeManualFinanceExpenseRows(
    filterManualFlowExpenseRows(normalizeServerExpenseRows(ledgerExpenseRows.length ? ledgerExpenseRows : (manual?.expenseRows || [])))
      .filter((row) => row.date && row.date >= startDate && row.date <= endDate),
    startDate,
    endDate
  );
  const transferRows = normalizeServerTransferRows(manual?.transfers || [])
    .filter((row) => row.transferDate && row.transferDate >= startDate && row.transferDate <= endDate)
    .map((row) => ({
      date: row.transferDate || "",
      who: row.who || "",
      amount: row.amount || "",
      localCurrency: row.currency || "",
      rate: row.rate || "",
      usdAmount: row.usdAmount || "",
      destination: row.channel || ""
    }));
  const commissionRows = normalizeServerCommissionRows(manual?.commissionRows || [])
    .filter((row) => row.date && row.date >= startDate && row.date <= endDate);
  const latestNowEntriesByChannel = mergeLatestNowEntries(
    buildLatestBalanceEntriesByChannel(normalizeServerBalanceRows(manual?.balanceRows || manual?.balances || []), endDate),
    buildLatestNowEntriesByChannel(normalizeServerExpenseRows(manual?.expenseRows || []), endDate)
  );
  const hasRepositoryRows =
    expenseRows.length ||
    transferRows.length ||
    commissionRows.length ||
    Object.keys(latestNowEntriesByChannel).length;
  if (!hasRepositoryRows) return null;
  return {
    rows: buildManualFinanceSummaryRows(expenseRows, latestNowEntriesByChannel),
    transferRows,
    commissionRows,
    latestNowByChannel: Object.fromEntries(
      Object.entries(latestNowEntriesByChannel).map(([channel, row]) => [channel, row.value])
    ),
    latestNowEntriesByChannel,
    selectedSheets: [getManualExpensesSheetName(), getManualBalancesSheetName(), getManualTransfersSheetName(), getManualCommissionsSheetName()]
  };
}

function buildServerExpenseRowsFromLedgerV2(rows, startDate, endDate) {
  const grouped = new Map();
  (rows || []).forEach((rawRow) => {
    const row = rawRow?.ledgerV2 || rawRow;
    const date = normalizeIncomingSheetDateValue(row?.date);
    if (!date || date < startDate || date > endDate) return;
    const operationName = normalizeLedgerClassifierText(row?.operation || row?.legacy_operation || rawRow?.operation || "");
    const categoryName = normalizeLedgerClassifierText(row?.category || rawRow?.category || rawRow?.legacy_category || "");
    if (isTransferOrExchangeRow(row) && !operationName.includes("exchange") && categoryName !== "exchange") return;
    const category = isTransferOrExchangeRow(row)
      ? MANUAL_EXCHANGE_CATEGORY
      : mapLedgerV2CategoryToManualExpenseCategory(row?.category || rawRow?.category || rawRow?.legacy_category);
    if (!category || category === MANUAL_NOW_CATEGORY) return;
    if (category === "serviceIncome" && !shouldIncludeLedgerRowInManualServicePlan(row, rawRow)) return;
    const amount = getLedgerBalanceAmountForFinance(row);
    if (!amount) return;
    const channel = getLedgerV2ManualChannel(row, amount);
    if (!channel) return;
    const key = `${date}|${category}`;
    if (!grouped.has(key)) grouped.set(key, createManualFinanceExpenseRow(date, category));
    const target = grouped.get(key);
    const signedAmount = category === MANUAL_EXCHANGE_CATEGORY ? amount : Math.abs(amount);
    target.amounts[channel] = formatSheetNumber(parseLooseNumber(target.amounts[channel]) + signedAmount);
  });
  return Array.from(grouped.values()).sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return String(left.category).localeCompare(String(right.category));
  });
}

function shouldIncludeLedgerRowInManualServicePlan(row, rawRow = null) {
  const source = normalizeLedgerServicePlanSource(
    row?.source
      || rawRow?.source
      || row?.displaySource
      || rawRow?.displaySource
      || ""
  );
  return !source || ["manual", "fact", "migration"].includes(source);
}

function normalizeLedgerServicePlanSource(value) {
  const token = normalizeLookupText(value);
  if (!token) return "";
  if (["manual", "fact", "migration"].includes(token)) return token;
  if (["paypal", "paypal mcp", "yoomoney", "monobank", "privatbank", "tdbank", "provider", "import", "mcp import", "mcp"].includes(token)) return "mcp";
  if (["ocr", "photo parsing", "screenshot", "browser ocr", "image", "photo"].includes(token)) return "photo";
  if (token === "wise") return "wise";
  return token;
}

function getLedgerBalanceAmountForFinance(row) {
  const contract = typeof EzohataManualLedgerContract === "object" ? EzohataManualLedgerContract : null;
  if (contract?.getBalanceAmount) {
    const value = contract.getBalanceAmount(row, { suppressWarnings: true });
    if (Number.isFinite(value)) return value;
  }
  const net = parseLooseNumber(row?.amount_net ?? row?.amountNet ?? "");
  if (net) return net;
  const amount = parseLooseNumber(row?.amount);
  const operation = String(row?.legacy_operation || row?.operation || "").trim();
  const direction = String(row?.direction || "").trim();
  if (operation === "exchange_out" || direction === "out" || operation === "expense") return -Math.abs(amount);
  return amount;
}

function getLedgerV2ManualChannel(row, amount) {
  const operation = String(row?.operation || row?.legacy_operation || "").trim();
  const fromChannel = canonicalManualFinanceChannel(row?.from_channel || row?.fromChannel || "");
  const toChannel = canonicalManualFinanceChannel(row?.to_channel || row?.toChannel || "");
  if (operation === "income") return toChannel || fromChannel;
  if (operation === "exchange") return amount < 0 ? (fromChannel || toChannel) : (toChannel || fromChannel);
  return fromChannel || toChannel;
}

function mapLedgerV2CategoryToManualExpenseCategory(value) {
  const normalized = normalizeLookupText(value);
  if (!normalized) return "";
  if (/^(service|servicein|serviceincome|ezohata|ezoin|ezofact)$/.test(normalized)) return "serviceIncome";
  if (normalized === "exchange") return MANUAL_EXCHANGE_CATEGORY;
  if (normalized === "partner") return "exchange";
  if (normalized === "house" || normalized === "flat") return "flat";
  if (normalized === "study") return "study";
  if (normalized === "travel") return "travel";
  if (["business", "personal", "other", "extra", "adjustment"].includes(normalized)) return "business";
  if (["food", "fun"].includes(normalized)) return normalized;
  return normalizeManualExpenseCategory(value);
}

function normalizeServerExpenseRows(rows) {
  return (rows || []).map((row) => ({
    date: normalizeIncomingSheetDateValue(row?.date),
    category: normalizeManualExpenseCategory(row?.category),
    amounts: Object.fromEntries(getManualFinanceChannels().map((channel) => [
      channel,
      normalizeManualFinancePersistedNumberInput(row?.amounts?.[channel] ?? row?.[channel] ?? "")
    ]))
  })).filter((row) => row.date && row.category);
}

function normalizeServerBalanceRows(rows) {
  return (rows || []).map((row) => ({
    date: normalizeIncomingSheetDateValue(row?.date || row?.checkDate),
    channel: canonicalManualFinanceChannel(row?.channel || row?.accountName || ""),
    amount: normalizeManualFinancePersistedNumberInput(row?.amount || row?.balanceAmount || ""),
    currency: String(row?.currency || "").trim().toUpperCase(),
    rate: normalizeManualFinancePersistedNumberInput(row?.rate || ""),
    usdAmount: normalizeManualFinancePersistedNumberInput(row?.usdAmount || ""),
    comment: String(row?.comment || "").trim()
  })).filter((row) => row.date && row.channel && (String(row.amount || "").trim() || String(row.usdAmount || "").trim()));
}

function normalizeServerCommissionRows(rows) {
  return normalizeManualCommissionRows((rows || []).map((row) => ({
    date: normalizeIncomingSheetDateValue(row?.date),
    channel: canonicalManualFinanceChannel(row?.channel || ""),
    usdAmount: normalizeManualFinancePersistedNumberInput(row?.usdAmount || ""),
    comment: String(row?.comment || "").trim()
  })), { padToMinimum: false });
}

function normalizeServerTransferRows(rows) {
  return normalizeManualFinanceTransferRows((rows || []).map((row) => ({
    date: normalizeIncomingSheetDateValue(row?.date || row?.transferDate),
    who: row?.who || row?.fromAccount || "",
    amount: normalizeManualFinancePersistedNumberInput(row?.amount || ""),
    localCurrency: row?.localCurrency || row?.currency || "",
    rate: normalizeManualFinancePersistedNumberInput(row?.rate || ""),
    usdAmount: normalizeManualFinancePersistedNumberInput(row?.usdAmount || ""),
    destination: canonicalManualFinanceChannel(row?.destination || row?.toAccount || row?.channel || "")
  })), { padToMinimum: false });
}


// ============================================================
// HELPERS
// ============================================================

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function calculateManualMoneyTotals(rows) {
  const relevantRows = (rows || []).filter((row) => row.channel !== MANUAL_FINANCE_TOTAL_LABEL);
  const total = {
    channel: MANUAL_FINANCE_TOTAL_LABEL,
    serviceIncome: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.serviceIncome), 0)),
    business: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.business), 0)),
    flat: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.flat), 0)),
    food: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.food), 0)),
    fun: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.fun), 0)),
    study: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.study), 0)),
    travel: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.travel), 0)),
    total: formatSheetNumber(relevantRows.reduce((sum, row) => sum + parseLooseNumber(row.total), 0))
  };
  return total;
}

function buildFullRangeBasedAnalyticsValuesFromClosedFact(sourceValues, movementValues, payoutsValues, savingsValues, aggregatedManual) {
  const sections = splitAnalyticsSections(extractAnalyticsTopTables(sourceValues));
  const personalSection = getAnalyticsPersonalSection(sections);
  const firstTitle = personalSection?.title || "Личные расходы";
  const firstSectionRows = Array.isArray(personalSection?.rows) ? personalSection.rows : [];
  const manualRows = aggregatedManual?.rows || [];
  const movementStats = calculateMovementChannelStats(movementValues);
  const normalizedTransferRows = ANALYTICS_PAYOUTS_HELPER.buildTransferPayoutRowsWithUsd
    ? ANALYTICS_PAYOUTS_HELPER.buildTransferPayoutRowsWithUsd(MANUAL_TRANSFER_HEADERS, aggregatedManual?.transferRows || [], {
        movementValues
      })
    : (aggregatedManual?.transferRows || []);
  const payoutStats = calculatePayoutChannelStats(payoutsValues, normalizedTransferRows);
  const commissionLookup = buildCommissionUsdLookup(aggregatedManual?.commissionRows || []);
  const usdRateLookup = buildManualFinanceUsdRateLookup(aggregatedManual?.transferRows || [], movementValues);
  const latestNowUsdLookup = buildLatestNowUsdLookup(
    aggregatedManual?.latestNowEntriesByChannel || aggregatedManual?.latestNowByChannel || {},
    usdRateLookup,
    {
      transferRows: aggregatedManual?.transferRows || [],
      movementValues
    }
  );
  const manualRowsWithUsd = manualRows.map((row) => ({
    ...row,
    totalUsd: row.totalUsd || getManualFinanceTotalUsdValue(row, usdRateLookup),
    nowUsd: row.nowUsd || (
      Object.prototype.hasOwnProperty.call(latestNowUsdLookup, row.channel)
        ? formatSheetNumber(latestNowUsdLookup[row.channel])
        : getManualFinanceNowUsdValue(row, usdRateLookup)
    ),
    exchangeUsd: row.exchangeUsd || getManualFinanceExchangeUsdValue(row, usdRateLookup)
  }));
  const manualTotalLookup = buildManualTotalLookup(manualRowsWithUsd);
  const manualTotalUsdLookup = buildManualTotalUsdLookup(manualRowsWithUsd);
  const manualServiceIncomeLookup = buildManualServiceIncomeLookup(manualRowsWithUsd);
  const manualExchangeLookup = buildManualExchangeLookup(manualRowsWithUsd);
  const manualExchangeUsdLookup = buildManualExchangeUsdLookup(manualRowsWithUsd);
  const currentNowUsdLookup = buildManualNowLookup(manualRowsWithUsd, usdRateLookup);
  const fallbackNowUsdLookup = buildAnalyticsNowUsdLookup(firstSectionRows);
  const openingSavingsLookup = buildSavingsLookup(savingsValues);
  const payoutUsdTotal = sumChannelStat(payoutStats, "usd");
  const fallbackTopHeader = firstSectionRows[0]?.slice ? firstSectionRows[0].slice() : getManualFinanceDisplayHeaders(MANUAL_FINANCE_HEADERS);
  const fallbackTopRows = firstSectionRows.slice(1).map((row) => row.slice());
  const topHeader = manualRowsWithUsd.length
    ? getManualFinanceDisplayHeaders(MANUAL_FINANCE_HEADERS)
    : fallbackTopHeader;
  const topRows = manualRowsWithUsd.length
    ? (ANALYTICS_PAYOUTS_HELPER.mapAnalyticsTopRows
        ? ANALYTICS_PAYOUTS_HELPER.mapAnalyticsTopRows(manualRowsWithUsd)
        : manualRowsWithUsd.map((row) => [
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
            row.nowUsd || ""
          ]))
    : fallbackTopRows;
  const planRows = [];
  const balanceRows = [];
  let totalUsdReceived = 0;
  let totalPlanGrowth = 0;
  let totalManualCost = 0;
  let totalManualCostUsd = 0;
  let totalExchange = 0;
  let totalExchangeUsd = 0;
  let totalPlanProfit = 0;
  let totalOpeningBalance = 0;
  let totalClosingBalance = 0;
  let totalBalanceGrowth = 0;
  let totalBalanceDifference = 0;
  let totalCommission = 0;
  let totalAdditionalExpenses = 0;
  let totalBalance = 0;
  const planLocalByCurrency = { ...(movementStats.localByCurrency || {}) };
  MANUAL_FINANCE_MONEY_CHANNELS.forEach((channel) => {
    const serviceIncome = manualServiceIncomeLookup[channel] || 0;
    const currency = inferManualFinanceChannelCurrency(channel);
    const localIncoming = (movementStats.localByChannel[channel] || 0) + serviceIncome;
    const incomingRate = getManualFinanceUsdPerLocalRate({ channel }, usdRateLookup);
    const usdIncoming = currency === "USD"
      ? (movementStats.usdByChannel[channel] || 0) + serviceIncome
      : (incomingRate ? localIncoming * incomingRate : (movementStats.usdByChannel[channel] || 0));
    const paidOut = payoutStats[channel]?.usd || 0;
    const exchange = manualExchangeLookup[channel] || 0;
    const exchangeUsd = manualExchangeUsdLookup[channel] || 0;
    const planGrowth = usdIncoming + paidOut + exchangeUsd;
    const ownCost = manualTotalLookup[channel] || 0;
    const ownCostUsd = manualTotalUsdLookup[channel] || 0;
    const planProfit = planGrowth - ownCostUsd;
    const openingBalance = openingSavingsLookup[channel] || 0;
    const closingBalance = Object.prototype.hasOwnProperty.call(latestNowUsdLookup, channel)
      ? latestNowUsdLookup[channel]
      : Object.prototype.hasOwnProperty.call(currentNowUsdLookup, channel)
      ? currentNowUsdLookup[channel]
      : (Object.prototype.hasOwnProperty.call(fallbackNowUsdLookup, channel) ? fallbackNowUsdLookup[channel] : 0);
    const balanceGrowth = closingBalance - openingBalance;
    const balanceDifference = balanceGrowth - planProfit;
    const commission = commissionLookup[channel] || 0;
    const additionalExpenses = balanceDifference - commission;
    const balance = movementStats.balanceByChannel[channel] || 0;
    const extraValue = additionalExpenses - balance;
    if (serviceIncome) {
      planLocalByCurrency[currency] = (planLocalByCurrency[currency] || 0) + serviceIncome;
    }
    planRows.push([
      channel,
      formatSheetNumber(localIncoming),
      formatSheetNumber(usdIncoming),
      formatSheetNumber(paidOut, 4),
      formatSheetNumber(exchange),
      formatSheetNumber(exchangeUsd),
      formatSheetNumber(planGrowth),
      formatSheetNumber(ownCost),
      formatSheetNumber(ownCostUsd),
      formatSheetNumber(planProfit)
    ]);
    balanceRows.push([
      channel,
      formatSheetNumber(openingBalance),
      formatSheetNumber(closingBalance),
      formatSheetNumber(balanceGrowth),
      formatSheetNumber(planProfit),
      formatSheetNumber(balanceDifference),
      formatSheetNumber(commission, 4),
      formatSheetNumber(additionalExpenses),
      formatSheetNumber(balance),
      formatSheetNumber(extraValue)
    ]);
    totalUsdReceived += usdIncoming;
    totalPlanGrowth += planGrowth;
    totalManualCost += ownCost;
    totalManualCostUsd += ownCostUsd;
    totalExchange += exchange;
    totalExchangeUsd += exchangeUsd;
    totalPlanProfit += planProfit;
    totalOpeningBalance += openingBalance;
    totalClosingBalance += closingBalance;
    totalBalanceGrowth += balanceGrowth;
    totalBalanceDifference += balanceDifference;
    totalCommission += commission;
    totalAdditionalExpenses += additionalExpenses;
    totalBalance += balance;
  });
  const balanceSection = {
    title: "БАЛАНС",
    header: ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
    rows: [
      ...balanceRows,
      [
        MANUAL_FINANCE_TOTAL_LABEL,
        formatSheetNumber(totalOpeningBalance),
        formatSheetNumber(totalClosingBalance),
        formatSheetNumber(totalBalanceGrowth),
        formatSheetNumber(totalPlanProfit),
        formatSheetNumber(totalBalanceDifference),
        formatSheetNumber(totalCommission, 4),
        formatSheetNumber(totalAdditionalExpenses),
        formatSheetNumber(totalBalance),
        formatSheetNumber(totalAdditionalExpenses - totalBalance)
      ],
      [
        "ОСТАТОК",
        formatSheetNumber(totalOpeningBalance),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ],
      [
        "ВСЕГО",
        "",
        formatSheetNumber(totalClosingBalance + totalOpeningBalance),
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ]
    ]
  };
  const movementSummaryRows = ANALYTICS_PAYOUTS_HELPER.buildMovementPaymentSummaryRows
    ? ANALYTICS_PAYOUTS_HELPER.buildMovementPaymentSummaryRows(
        movementValues,
        MANUAL_FINANCE_MONEY_CHANNELS,
        ANALYTICS_PAYMENT_RULES
      )
    : [];
  const movementRealTotals = getMovementTotalsFromTable(movementValues);
  const movementRealTotalRow = [
    "Итого реал",
    formatSheetNumber(movementRealTotals.baseAccruedTotal),
    formatSheetNumber(movementRealTotals.accruedTotal),
    formatSheetNumber(movementRealTotals.seventyTotal),
    formatSheetNumber(movementRealTotals.receivedUsdTotal),
    formatSheetNumber(movementRealTotals.balanceTotal)
  ];
  const movementSummarySection = {
    title: "Сверка Movement по каналам",
    header: [
      "канал переводов",
      "план = ACCRUED",
      "план плюс процент начислено = ACCRUED +3%",
      "70% OF +3%",
      "ДОШЛО ДО НАС USD",
      "BALANCE"
    ],
    rows: [...movementSummaryRows, movementRealTotalRow]
  };
  const periodUsdSummarySection = {
    title: "ИТОГО ЗА ПЕРИОД USD",
    header: ["показатель", "USD"],
    rows: buildAnalyticsPeriodUsdSummaryRows(manualRowsWithUsd, usdRateLookup, {
      totalOrdersSeventyPct: movementRealTotals.seventyTotal,
      payoutsUsdTotal: payoutUsdTotal
    })
  };
  const rebuiltSections = [
    movementSummarySection,
    balanceSection,
    {
      title: "Plan",
      header: ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "обмен", "обмен_usd", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
      rows: [
        ...planRows,
        [
          MANUAL_FINANCE_TOTAL_LABEL,
          formatPlanLocalSummary(planLocalByCurrency),
          formatSheetNumber(totalUsdReceived),
          formatSheetNumber(payoutUsdTotal, 4),
          formatSheetNumber(totalExchange),
          formatSheetNumber(totalExchangeUsd),
          formatSheetNumber(totalPlanGrowth),
          formatSheetNumber(totalManualCost),
          formatSheetNumber(totalManualCostUsd),
          formatSheetNumber(totalPlanProfit)
        ],
        ["Итого движение", formatPlanLocalSummary(planLocalByCurrency), formatSheetNumber(totalUsdReceived)]
      ]
    },
    periodUsdSummarySection,
    { title: firstTitle, header: topHeader, rows: topRows }
  ];
  const values = [];
  rebuiltSections.forEach((section, index) => {
    if (index > 0) values.push([]);
    values.push([section.title]);
    values.push(section.header.slice());
    section.rows.forEach((row) => values.push(row.slice()));
  });
  return values;
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function calculatePayoutChannelStats(payoutValues, transferRows) {
  const stats = Object.fromEntries(
    MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [
      channel,
      {
        local: 0,
        usd: 0
      }
    ])
  );
  const header = (payoutValues || [])[0] || [];
  const paymentMethodIndex = findHeaderIndexByAliases(header, ["PAYMENT METHOD", "DESTINATION", "канал куда"]);
  const currentAmountIndex = findHeaderIndexByAliases(header, ["СУММА ТЕКУЩАЯ", "сумма"]);
  const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)", "сумма в долларах"]);
    if (paymentMethodIndex !== -1 && usdAmountIndex !== -1) {
    (payoutValues || []).slice(1).forEach((row) => {
      if (!hasAnyValue(row) || isTableTotalLabel(normalizeCell(row[0]))) return;
      const channel = resolvePaymentChannel(row[paymentMethodIndex]);
      if (!channel || !stats[channel]) return;
      if (currentAmountIndex !== -1) stats[channel].local += normalizePayoutAmount(row[currentAmountIndex]);
      stats[channel].usd += normalizePayoutAmount(row[usdAmountIndex]);
    });
  }
  (transferRows || []).forEach((row) => {
    const rawChannel = Array.isArray(row)
      ? String(row[4] || "").trim()
      : String(row?.destination || row?.channel || "").trim();
    const channel = resolvePaymentChannel(rawChannel) || rawChannel;
    if (!channel || !stats[channel]) return;
    stats[channel].local += normalizePayoutAmount(Array.isArray(row) ? row[2] : row.amount);
    stats[channel].usd += normalizePayoutAmount(Array.isArray(row) ? row[6] : row.usdAmount);
  });
  return stats;
}

function normalizePayoutAmount(value) {
  const amount = parseLooseNumber(value);
  return amount ? -Math.abs(amount) : 0;
}

function resolvePaymentChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const exact = MANUAL_FINANCE_MONEY_CHANNELS.find((channel) => normalizeCell(channel) === normalizeCell(raw));
  if (exact) return exact;
  const alias = resolveManualFinanceChannelAlias(raw, MANUAL_FINANCE_MONEY_CHANNELS);
  if (alias) return alias;
  const normalized = normalizeLookupText(raw);
  const entry = Object.entries(ANALYTICS_PAYMENT_RULES).find(([, rule]) => {
    return [...(rule.localPatterns || []), ...(rule.usdPatterns || [])].some((pattern) => pattern.test(raw) || pattern.test(normalized));
  });
  return entry ? entry[0] : "";
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// HELPERS
// ============================================================

function normalizeClientFamilyToken(value) {
  const token = normalizeLookupText(value);
  if (!token || token.length < 4) return "";
  return token
    .replace(/(ого|его|ой|ая|яя|ый|ий|ые|ие|ых|их|а|я|ы|и)$/i, "")
    .replace(/(ов|ев|ин|ын)$/i, (ending) => (/^(ин|ын)$/i.test(ending) ? ending : ""));
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function getClientPaymentLookupKeys(client) {
  const normalized = normalizeLookupText(client);
  if (!normalized) return [];
  const relationWords = new Set(["сын", "дочь", "мать", "отец", "мама", "папа", "жена", "муж"]);
  const tokens = normalized.split(" ").filter((token) => token && !relationWords.has(token));
  const keys = [normalized];
  const familyToken = normalizeClientFamilyToken(tokens.at(-1) || "");
  if (familyToken) keys.push(`family:${familyToken}`);
  return [...new Set(keys)];
}

function inferFallbackPaymentChannelFromClient(client) {
  if (ANALYTICS_PAYOUTS_HELPER.inferFallbackPaymentChannelFromClient) {
    return ANALYTICS_PAYOUTS_HELPER.inferFallbackPaymentChannelFromClient(client);
  }
  const normalized = normalizeLookupText(client);
  const familyKeys = getClientPaymentLookupKeys(client).join(" ");
  const text = `${normalized} ${familyKeys}`;
  if (/(william|вильям|вилл)/i.test(text)) return "трансервайз дол";
  if (/лозин/i.test(text)) return "монобанк грн";
  if (/игнат/i.test(text)) return "пейпал дол";
  return "";
}

function isAmbiguousPersonalCardPayment(value) {
  const normalized = normalizeLookupText(value);
  return /андрей.*карта|карта.*андрей/.test(normalized);
}

function sumChannelStat(stats, key) {
  return Object.values(stats || {}).reduce((sum, row) => sum + parseLooseNumber(row?.[key]), 0);
}


// ============================================================
// HELPERS
// ============================================================

function findHeaderIndexByAliases(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function buildManualTotalLookup(rows) {
  const totals = {};
  (rows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    totals[channel] = (totals[channel] || 0) + parseLooseNumber(row.total);
  });
  return totals;
}


// ============================================================
// CURRENCY RATES
// ============================================================

function buildManualTotalUsdLookup(rows) {
  const totals = {};
  (rows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    totals[channel] = (totals[channel] || 0) + parseLooseNumber(row.totalUsd);
  });
  return totals;
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function buildManualServiceIncomeLookup(rows) {
  const totals = {};
  (rows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    totals[channel] = (totals[channel] || 0) + parseLooseNumber(row.serviceIncome);
  });
  return totals;
}


// ============================================================
// CURRENCY RATES
// ============================================================

function buildManualExchangeLookup(rows) {
  const totals = {};
  (rows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    totals[channel] = (totals[channel] || 0) + parseLooseNumber(row.exchange);
  });
  return totals;
}

function buildManualExchangeUsdLookup(rows) {
  const totals = {};
  (rows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    totals[channel] = (totals[channel] || 0) + parseLooseNumber(row.exchangeUsd);
  });
  return totals;
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function buildManualNowLookup(rows, rateLookup) {
  const lookup = {};
  (rows || []).forEach((row) => {
    const channel = getCanonicalManualChannelKey(row.channel);
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    const raw = String(row.now ?? "").trim();
    if (!raw || !parseLooseNumber(raw)) return;
    const nowUsd = getManualFinanceNowUsdValue({ channel, now: raw }, rateLookup);
    if (String(nowUsd || "").trim()) lookup[channel] = parseLooseNumber(nowUsd);
  });
  return lookup;
}

function buildLatestNowByChannel(expenseRows, endDate) {
  return Object.fromEntries(
    Object.entries(buildLatestNowEntriesByChannel(expenseRows, endDate))
      .map(([channel, row]) => [channel, row.value])
  );
}

function buildLatestNowEntriesByChannel(expenseRows, endDate) {
  const latest = {};
  (expenseRows || [])
    .filter((row) => row?.date && row.date <= endDate && normalizeManualExpenseCategory(row.category) === MANUAL_NOW_CATEGORY)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .forEach((row) => {
      const amounts = getCanonicalManualExpenseRawAmounts(row.amounts || {});
      MANUAL_FINANCE_MONEY_CHANNELS.forEach((channel) => {
        const raw = String(amounts[channel] ?? "").trim();
        if (!raw || !parseLooseNumber(raw)) return;
        latest[channel] = { value: raw, date: row.date };
      });
  });
  return latest;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildLatestBalanceEntriesByChannel(balanceRows, endDate) {
  const latest = {};
  (balanceRows || [])
    .filter((row) => row?.date && row.date <= endDate)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .forEach((row) => {
      const channel = getCanonicalManualChannelKey(row.channel);
      const raw = String(row.amount ?? "").trim();
      if (!channel || !raw || !parseLooseNumber(raw)) return;
      latest[channel] = {
        value: raw,
        date: row.date,
        currency: String(row.currency || "").trim().toUpperCase() || inferManualFinanceChannelCurrency(channel),
        rate: row.rate || "",
        usdAmount: row.usdAmount || ""
      };
    });
  return latest;
}

function normalizeManualExpenseCategory(value) {
  const normalized = normalizeCell(value).replace(/ё/g, "е");
  if (!normalized) return "";
  if (normalized === "now" || normalized === "стало" || normalized === "остаток сейчас") return MANUAL_NOW_CATEGORY;
  if (typeof mapManualLedgerCategoryToLegacy === "function") return mapManualLedgerCategoryToLegacy(value);
  if (/service|приход/.test(normalized)) return "serviceIncome";
  if (/business|бизнес/.test(normalized)) return "business";
  if (/flat|house|rent|кварт|дом|аренд/.test(normalized)) return "flat";
  if (/food|еда/.test(normalized)) return "food";
  if (/travel|study|учеб|обуч|курс|школ|путеш/.test(normalized)) return "travel";
  if (/fun|event|beauty|развлеч/.test(normalized)) return "fun";
  if (/exchange|обмен/.test(normalized)) return "exchange";
  return "business";
}

function normalizeManualExpenseCategoryLegacy(value) {
  const normalized = normalizeCell(value).replace(/ё/g, "е");
  if (!normalized) return "";
  if (normalized === "now" || normalized === "стало" || normalized === "остаток сейчас") return MANUAL_NOW_CATEGORY;
  const normalizeToken = (item) => normalizeLookupText(item).replace(/_/g, " ");
  const normalizedToken = normalizeToken(normalized);
  const defaultCategoryMap = {
    serviceIncome: ["service income", "serviceincome", "service in", "servicein", "приход"],
    business: ["spent for business", "business", "бизнес"],
    flat: ["spent for flat", "spent for house", "flat", "house", "квартира", "кварт", "дом", "аренда", "rent"],
    food: ["spent for food", "food", "еда", "продукты"],
    fun: ["spent for fun", "fun", "развлечения", "развлеч", "events", "event", "beauty"],
    study: ["spent for study", "study", "учеба", "учеб", "обучение", "обуч", "курс", "школа"],
    travel: ["spent for travel", "spent for travel/ fun", "travel", "travelfun", "travel fun", "путешествия", "путеш"],
    exchange: ["обмен", "exchange", "exchange_usd", "exchange usd", "комиссии", "exchange_in"],
    ezoin: ["ezoin", "ezo in"],
    partnerTransfer: ["partnertransfer", "partner transfer"],
    extra: ["extra"],
    unclear: ["unclear"]
  };
  const categoryMap = (typeof state !== "undefined" ? state.config?.manualFinance?.categoryMap : null) || defaultCategoryMap;
  for (const [category, aliases] of Object.entries(categoryMap || {})) {
    const knownTokens = [category, ...(aliases || [])].map((item) => normalizeToken(item));
    if (!knownTokens.includes(normalizedToken)) continue;
    return category === "exchange" ? MANUAL_EXCHANGE_CATEGORY : category;
  }
  return String(value || "").trim();
}


// ============================================================
// CURRENCY RATES
// ============================================================

function buildLatestNowUsdLookup(latestNowByChannel, rateLookup, options = {}) {
  const lookup = {};
  const datedRateLookupByDate = new Map();
  Object.entries(latestNowByChannel || {}).forEach(([channel, entry]) => {
    const now = typeof entry === "object" && entry !== null ? entry.value : entry;
    const storedUsdAmount = typeof entry === "object" && entry !== null ? parseLooseNumber(entry.usdAmount) : 0;
    if (storedUsdAmount) {
      lookup[channel] = storedUsdAmount;
      return;
    }
    let datedRateLookup = rateLookup;
    if (typeof entry === "object" && entry?.date) {
      if (!datedRateLookupByDate.has(entry.date)) {
        datedRateLookupByDate.set(
          entry.date,
          buildManualFinanceUsdRateLookup(options.transferRows || [], options.movementValues || [], { endDate: entry.date })
        );
      }
      datedRateLookup = datedRateLookupByDate.get(entry.date);
    }
    if (typeof entry === "object" && entry !== null) {
      const currency = String(entry.currency || "").trim().toUpperCase() || inferManualFinanceChannelCurrency(channel);
      const localPerUsd = parseLooseNumber(entry.rate);
      if (currency === "USD") {
        lookup[channel] = parseLooseNumber(now);
        return;
      }
      if (localPerUsd) {
        lookup[channel] = parseLooseNumber(now) / localPerUsd;
        return;
      }
    }
    const nowUsd = getManualFinanceNowUsdValue({ channel, now }, datedRateLookup);
    if (String(nowUsd || "").trim()) lookup[channel] = parseLooseNumber(nowUsd);
  });
  return lookup;
}

function buildCommissionUsdLookup(rows) {
  if (ANALYTICS_PAYOUTS_HELPER.calculateCommissionTotalsByChannel) {
    return ANALYTICS_PAYOUTS_HELPER.calculateCommissionTotalsByChannel(rows, MANUAL_FINANCE_MONEY_CHANNELS);
  }
  const lookup = Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  (rows || []).forEach((row) => {
    const channel = resolvePaymentChannel(row?.channel || "");
    if (!channel || !Object.prototype.hasOwnProperty.call(lookup, channel)) return;
    lookup[channel] += parseLooseNumber(row.usdAmount);
  });
  return lookup;
}

function buildAnalyticsNowUsdLookup(sectionRows) {
  const rows = sectionRows || [];
  const header = rows[0] || [];
  const nowUsdIndex = findHeaderIndexByAliases(header, ["now_usd", "now usd"]);
  if (nowUsdIndex === -1) return {};
  const lookup = {};
  rows.slice(1).forEach((row) => {
    const channel = String(row?.[0] || "").trim();
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    lookup[channel] = parseLooseNumber(row[nowUsdIndex]);
  });
  return lookup;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildSavingsLookup(values) {
  if (!values.length) return {};
  const lookup = {};
  values.slice(1).forEach((row) => {
    if (!hasAnyValue(row)) return;
    const channel = String(row[0] || "").trim();
    if (!channel || normalizeCell(channel) === normalizeCell("итого")) return;
    const numericCells = row.slice(1).filter((cell) => String(cell || "").trim()).map((cell) => parseLooseNumber(cell));
    lookup[channel] = numericCells[0] || 0;
  });
  return lookup;
}

function extractLegacyBalanceExtraLookup(sections) {
  if ((sections || []).length < 3) return {};
  const lookup = {};
  (sections[2]?.rows || []).forEach((row) => {
    if (!hasAnyValue(row)) return;
    const channel = String(row[0] || "").trim();
    if (!channel || channel === MANUAL_FINANCE_TOTAL_LABEL) return;
    lookup[channel] = String(row[6] || "").trim();
  });
  return lookup;
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function calculateMovementChannelStats(values) {
  if (!values.length) {
    return { localByChannel: {}, usdByChannel: {}, accruedPlusByChannel: {}, accruedPlusCountByChannel: {}, balanceByChannel: {}, localByCurrency: {} };
  }
  const headerRowIndex = findMovementHeaderRowIndex(values);
  const header = values[headerRowIndex] || [];
  const paymentMethodIndex = findHeaderIndexByAliases(header, ["PAYMENT METHOD"]);
  const clientIndex = findHeaderIndexByAliases(header, ["CLIENT", "КЛИЕНТ"]);
  const accruedPlusIndex = findHeaderIndexByAliases(header, ["ACCRUED +3%"]);
  const receivedRubIndex = findHeaderIndexByAliases(header, ["ПОЛУЧЕНО В РУБЛЯХ"]);
  const receivedUahIndex = findHeaderIndexByAliases(header, ["ПОЛУЧЕНО В ГРИВНАХ"]);
  const receivedUsdIndex = findHeaderIndexByAliases(header, ["ДОШЛО ДО НАС USD", "NET RECEIVED USD", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "RECEIVED TOTAL USD"]);
  const balanceIndex = findHeaderIndexByAliases(header, ["BALANCE", "БАЛАНС"]);
  const localByChannel = Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  const usdByChannel = Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  const accruedPlusByChannel = Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  const accruedPlusCountByChannel = Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  const balanceByChannel = Object.fromEntries(MANUAL_FINANCE_MONEY_CHANNELS.map((channel) => [channel, 0]));
  const localByCurrency = {};
  const dataRows = values.slice(headerRowIndex + 1);
  const nextPaymentByClient = {};
  for (let index = dataRows.length - 1; index >= 0; index -= 1) {
    const row = dataRows[index] || [];
    const client = String(clientIndex !== -1 && clientIndex < row.length ? row[clientIndex] || "" : "").trim();
    const paymentMethod = String(paymentMethodIndex !== -1 && paymentMethodIndex < row.length ? row[paymentMethodIndex] || "" : "").trim();
    if (client && paymentMethod && resolvePaymentChannel(paymentMethod)) {
      getClientPaymentLookupKeys(client).forEach((key) => {
        if (!nextPaymentByClient[key]) nextPaymentByClient[key] = paymentMethod;
      });
    }
  }
  dataRows.forEach((row) => {
    if (!hasAnyValue(row)) return;
    if (isTableTotalRow(row)) return;
    if (!/^\d+$/.test(String(row[0] || "").trim())) return;
    const client = String(clientIndex !== -1 && clientIndex < row.length ? row[clientIndex] || "" : "").trim();
    const enteredPaymentMethod = String(paymentMethodIndex !== -1 && paymentMethodIndex < row.length ? row[paymentMethodIndex] || "" : "").trim();
    const inferredPaymentMethod = getClientPaymentLookupKeys(client).map((key) => nextPaymentByClient[key]).find(Boolean) || "";
    const fallbackChannel = !enteredPaymentMethod ? inferFallbackPaymentChannelFromClient(client) : "";
    const cardFallbackChannel = enteredPaymentMethod && isAmbiguousPersonalCardPayment(enteredPaymentMethod)
      ? inferFallbackPaymentChannelFromClient(client)
      : "";
    const channel = cardFallbackChannel || resolvePaymentChannel(enteredPaymentMethod) || fallbackChannel || resolvePaymentChannel(inferredPaymentMethod);
    if (!channel || !Object.prototype.hasOwnProperty.call(localByChannel, channel)) return;
    const currency = inferManualFinanceChannelCurrency(channel);
    let localValue = 0;
    if (currency === "RUB" && receivedRubIndex !== -1 && receivedRubIndex < row.length) {
      localValue = parseLooseNumber(row[receivedRubIndex]);
    } else if (currency === "UAH" && receivedUahIndex !== -1 && receivedUahIndex < row.length) {
      localValue = parseLooseNumber(row[receivedUahIndex]);
    } else if (currency === "USD" && receivedUsdIndex !== -1 && receivedUsdIndex < row.length) {
      localValue = parseLooseNumber(row[receivedUsdIndex]);
    }
    if (localValue) {
      localByChannel[channel] += localValue;
      localByCurrency[currency] = (localByCurrency[currency] || 0) + localValue;
    }
    if (receivedUsdIndex !== -1 && receivedUsdIndex < row.length) {
      usdByChannel[channel] += parseLooseNumber(row[receivedUsdIndex]);
    }
    if (accruedPlusIndex !== -1 && accruedPlusIndex < row.length) {
      const accruedPlus = parseLooseNumber(row[accruedPlusIndex]);
      accruedPlusByChannel[channel] += accruedPlus;
      if (accruedPlus > 0) accruedPlusCountByChannel[channel] += 1;
    }
    if (balanceIndex !== -1 && balanceIndex < row.length) {
      balanceByChannel[channel] += parseLooseNumber(row[balanceIndex]);
    }
  });
  return { localByChannel, usdByChannel, accruedPlusByChannel, accruedPlusCountByChannel, balanceByChannel, localByCurrency };
}

function findMovementHeaderRowIndex(values = []) {
  const index = (values || []).findIndex((row) => {
    const normalized = (row || []).map((cell) => normalizeCell(cell));
    return normalized.includes("number") && normalized.includes("payment method");
  });
  return index === -1 ? 0 : index;
}


// ============================================================
// CURRENCY RATES
// ============================================================

function calculatePayoutUsdTotal(values) {
  if (!values.length) return 0;
  const header = values[0] || [];
  const amountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)"]);
  const paymentMethodIndex = findHeaderIndexByAliases(header, ["PAYMENT METHOD"]);
  if (amountIndex === -1) return 0;
  let total = 0;
  values.slice(1).forEach((row) => {
    if (!hasAnyValue(row)) return;
    if (paymentMethodIndex !== -1 && paymentMethodIndex < row.length && !String(row[paymentMethodIndex] || "").trim()) return;
    total += normalizePayoutAmount(row[amountIndex] || "");
  });
  return total;
}

function calculateAnalyticsTransferRowsUsdTotal(rows) {
  return (rows || []).reduce((sum, row) => sum + parseLooseNumber(row?.usdAmount), 0);
}

function calculateClosedFactTransferRowsUsdTotal(rows) {
  return (rows || []).reduce((sum, row) => {
    if (Array.isArray(row)) return sum + parseLooseNumber(row[6]);
    return sum + parseLooseNumber(row?.usdAmount);
  }, 0);
}

function getCombinedPayoutUsdTotal(payoutValues = [], transferRows = []) {
  return calculatePayoutUsdTotal(payoutValues) + calculateClosedFactTransferRowsUsdTotal(transferRows);
}

function calculateClosedFactTransferUsdTotal(values) {
  if (!values.length) return 0;
  const header = values[0] || [];
  const amountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)"]);
  const commentIndex = findHeaderIndexByAliases(header, ["COMMENT"]);
  if (amountIndex === -1) return 0;
  let total = 0;
  values.slice(1).forEach((row) => {
    if (!hasAnyValue(row)) return;
    const comment = commentIndex !== -1 && commentIndex < row.length ? String(row[commentIndex] || "") : "";
    if (!normalizeCell(comment).includes("closed fact")) return;
    total += parseLooseNumber(row[amountIndex] || "");
  });
  return total;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildClosedTransferPayoutRows(header, transfers) {
  const normalizedHeader = (header || []).map((cell) => normalizeCell(cell));
  const setCell = (row, headerName, value) => {
    const index = normalizedHeader.indexOf(normalizeCell(headerName));
    if (index !== -1) row[index] = value;
  };
  return (transfers || []).map((transfer) => {
    const normalizedTransfer = Array.isArray(transfer)
      ? {
          date: transfer[0] || "",
          who: transfer[1] || "",
          amount: transfer[2] || "",
          localCurrency: transfer[3] || "",
          destination: transfer[4] || "",
          rate: transfer[5] || "",
          usdAmount: transfer[6] || ""
        }
      : (transfer || {});
    const row = new Array(header.length).fill("");
    setCell(row, "DATE", normalizedTransfer.date || "");
    setCell(row, "CLIENT", normalizedTransfer.who || "");
    setCell(row, "SERVICE", "Closed fact transfer");
    setCell(row, "PAYMENT METHOD", normalizedTransfer.destination || "");
    setCell(row, "ВАЛЮТА", normalizedTransfer.localCurrency || "");
    setCell(row, "СУММА ТЕКУЩАЯ", formatSheetNumber(normalizePayoutAmount(normalizedTransfer.amount)));
    setCell(row, "AMOUNT (USD)", formatSheetNumber(normalizePayoutAmount(normalizedTransfer.usdAmount)));
    setCell(row, "КУРС ПЕРЕВОДА", normalizedTransfer.rate || "");
    setCell(row, "COMMENT", "closed fact");
    return row;
  });
}

function mergePayoutsWithClosedTransfers(values, transfers) {
  if (!values.length) return values;
  const hasTitleRow = normalizeCell(values?.[0]?.[0]) === normalizeCell("Выплаты") && (values?.[0] || []).length < (values?.[1] || []).length;
  const headerIndex = hasTitleRow ? 1 : 0;
  const header = (values[headerIndex] || []).slice();
  const commentIndex = findHeaderIndexByAliases(header, ["COMMENT"]);
  const dataRows = [];
  const summaryRows = [];
  values.slice(headerIndex + 1).forEach((row) => {
    if (!hasAnyValue(row)) return;
    const firstCell = normalizeCell(row[0]);
    const comment = commentIndex !== -1 && commentIndex < row.length ? String(row[commentIndex] || "") : "";
    if (isTableTotalLabel(firstCell)) {
      summaryRows.push(padRowToWidth(row.slice(), header.length));
      return;
    }
    if (normalizeCell(comment).includes("closed fact")) return;
    dataRows.push(padRowToWidth(row.slice(), header.length));
  });
  const mergedRows = dataRows.concat(buildClosedTransferPayoutRows(header, transfers));
  const dateIndex = (header || []).findIndex((cell) => normalizeCell(cell) === "date");
  if (dateIndex !== -1) {
    mergedRows.sort((left, right) => {
      const leftDate = parseDisplayDate(left[dateIndex]) || new Date(8640000000000000);
      const rightDate = parseDisplayDate(right[dateIndex]) || new Date(8640000000000000);
      if (leftDate.getTime() !== rightDate.getTime()) return leftDate - rightDate;
      const leftClosed = normalizeCell(left[left.length - 1]).includes("closed fact");
      const rightClosed = normalizeCell(right[right.length - 1]).includes("closed fact");
      return Number(rightClosed) - Number(leftClosed);
    });
  }
  const currentAmountIndex = findHeaderIndexByAliases(header, ["СУММА ТЕКУЩАЯ"]);
  const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)"]);
  mergedRows.forEach((row) => {
    if (currentAmountIndex !== -1) row[currentAmountIndex] = formatSheetNumber(normalizePayoutAmount(row[currentAmountIndex]));
    if (usdAmountIndex !== -1) row[usdAmountIndex] = formatSheetNumber(normalizePayoutAmount(row[usdAmountIndex]));
  });
  const totalSummary = summaryRows.find((row) => normalizeCell(row[0]) === normalizeCell(MANUAL_FINANCE_TOTAL_LABEL));
  const helperTotalRow = ANALYTICS_PAYOUTS_HELPER.buildPayoutTotalRow
    ? ANALYTICS_PAYOUTS_HELPER.buildPayoutTotalRow(header, mergedRows)
    : null;
  if (totalSummary) {
    if (currentAmountIndex !== -1) {
      totalSummary[currentAmountIndex] = helperTotalRow?.[currentAmountIndex] || formatPayoutNumber(mergedRows.reduce((sum, row) => sum + parseLooseNumber(row[currentAmountIndex]), 0));
    }
    if (usdAmountIndex !== -1) {
      totalSummary[usdAmountIndex] = helperTotalRow?.[usdAmountIndex] || formatPayoutNumber(mergedRows.reduce((sum, row) => sum + parseLooseNumber(row[usdAmountIndex]), 0));
    }
  } else if (helperTotalRow) {
    summaryRows.push(helperTotalRow);
  }
  return [header, ...mergedRows, ...summaryRows];
}


// ============================================================
// HELPERS
// ============================================================

function formatSheetNumber(value, digits = 4) {
  return Number(value || 0).toFixed(digits).replace(".", ",");
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function getMovementTotalsFromTable(values) {
  if (!Array.isArray(values) || !values.length) {
    return { priceTotal: 0, baseAccruedTotal: 0, accruedTotal: 0, seventyTotal: 0, receivedUsdTotal: 0, balanceTotal: 0 };
  }
  const header = values[0] || [];
  const priceIndex = findHeaderIndexByAliases(header, ["PRICE BASE"]);
  const baseAccruedIndex = findHeaderIndexByAliases(header, ["ACCRUED"]);
  const accruedIndex = findHeaderIndexByAliases(header, ["ACCRUED +3%"]);
  const seventyIndex = findHeaderIndexByAliases(header, ["70% OF +3%"]);
  const receivedUsdIndex = findHeaderIndexByAliases(
    header,
    ["ДОШЛО ДО НАС USD", "NET RECEIVED USD", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "RECEIVED TOTAL USD"]
  );
  const balanceIndex = findHeaderIndexByAliases(header, ["BALANCE", "БАЛАНС"]);
  const totalRow = values.slice(1).find((row) => isTableTotalRow(row));
  if (totalRow) {
    return {
      priceTotal: priceIndex === -1 ? 0 : parseLooseNumber(totalRow[priceIndex]),
      baseAccruedTotal: baseAccruedIndex === -1 ? 0 : parseLooseNumber(totalRow[baseAccruedIndex]),
      accruedTotal: accruedIndex === -1 ? 0 : parseLooseNumber(totalRow[accruedIndex]),
      seventyTotal: seventyIndex === -1 ? 0 : parseLooseNumber(totalRow[seventyIndex]),
      receivedUsdTotal: receivedUsdIndex === -1 ? 0 : parseLooseNumber(totalRow[receivedUsdIndex]),
      balanceTotal: balanceIndex === -1 ? 0 : parseLooseNumber(totalRow[balanceIndex]),
    };
  }

  return values.slice(1).reduce((totals, row) => {
    if (!hasAnyValue(row) || isTableTotalRow(row)) return totals;
    if (priceIndex !== -1 && priceIndex < row.length) totals.priceTotal += parseLooseNumber(row[priceIndex]);
    if (baseAccruedIndex !== -1 && baseAccruedIndex < row.length) totals.baseAccruedTotal += parseLooseNumber(row[baseAccruedIndex]);
    if (accruedIndex !== -1 && accruedIndex < row.length) totals.accruedTotal += parseLooseNumber(row[accruedIndex]);
    if (seventyIndex !== -1 && seventyIndex < row.length) totals.seventyTotal += parseLooseNumber(row[seventyIndex]);
    if (receivedUsdIndex !== -1 && receivedUsdIndex < row.length) totals.receivedUsdTotal += parseLooseNumber(row[receivedUsdIndex]);
    if (balanceIndex !== -1 && balanceIndex < row.length) totals.balanceTotal += parseLooseNumber(row[balanceIndex]);
    return totals;
  }, { priceTotal: 0, baseAccruedTotal: 0, accruedTotal: 0, seventyTotal: 0, receivedUsdTotal: 0, balanceTotal: 0 });
}

function getMovementTotalHeaders() {
  return new Set([
    "qty",
    "price base",
    "accrued",
    "accrued +3%",
    "70% of accrued",
    "70% of +3%",
    "получено в долларах",
    "получено в рублях",
    "получено в гривнах",
    "оплачено клиентом usd",
    "комиссия провайдера usd",
    "дошло до нас usd",
    "дошло факт provider net",
    "получено в долларах итого (сводный)",
    "balance",
    "amount (usd)",
  ]);
}

function buildMovementTotalRow(header, rows) {
  const width = Math.max(header.length, ...rows.map((row) => row.length), 1);
  const totalRow = Array.from({ length: width }, () => "");
  totalRow[0] = MANUAL_FINANCE_TOTAL_LABEL;
  const totalHeaders = getMovementTotalHeaders();

  header.forEach((cell, index) => {
    if (!totalHeaders.has(normalizeCell(cell))) return;
    totalRow[index] = formatSheetNumber(
      rows.reduce((sum, row) => sum + parseLooseNumber(row[index]), 0)
    );
  });

  return totalRow;
}

function buildMovementPercentRow(header, totalRow) {
  const width = Math.max(header.length, totalRow.length, 1);
  const percentRow = Array.from({ length: width }, () => "");
  const totalHeaders = getMovementTotalHeaders();
  percentRow[0] = "%";

  header.forEach((cell, index) => {
    if (!totalHeaders.has(normalizeCell(cell))) return;
    if (index <= 0) return;
    const previousTotal = parseLooseNumber(totalRow[index - 1]);
    if (!previousTotal) return;
    const currentTotal = parseLooseNumber(totalRow[index]);
    percentRow[index] = formatSheetNumber((currentTotal / previousTotal) * 100);
  });

  return percentRow;
}

function buildTopMetricsSummary() {
  const movementTotals = getMovementTotalsFromTable(state.data?.tabs?.movement?.values || []);
  const movementSummaryRows = state.data?.tabs?.movement?.summaryRows || [];
  const summaryAccruedTotal = getMovementSummaryMetric(movementSummaryRows, ["начислено прайс"]);
  const summarySeventyTotal = getMovementSummaryMetric(movementSummaryRows, ["70% от прайс"]);
  const summaryReceivedUsdTotal = getMovementSummaryMetric(movementSummaryRows, ["получено в долларах"]);
  const movementAccruedTotal = movementTotals.accruedTotal || summaryAccruedTotal;
  const movementSeventyTotal = movementTotals.seventyTotal || summarySeventyTotal;
  const movementReceivedUsdTotal = summaryReceivedUsdTotal || movementTotals.receivedUsdTotal;

  const ordersSummary = state.data?.ordersSummary || buildOrdersSummaryFromClient(state.data?.tabs?.orders?.values || []);
  const manualOrdersTotal = parseLooseNumber(ordersSummary.totalAccruedPlus3Pct);
  const personalOrdersAfterDiscount = parseLooseNumber(ordersSummary.personalOrdersAfterDiscount ?? manualOrdersTotal);
  const ordersReceivedUsdTotal = parseLooseNumber(ordersSummary.totalReceivedUsd);
  const ordersBalanceTotal = parseLooseNumber(ordersSummary.totalBalanceUsd);
  const totalPaid = calculateCurrentOverallPayoutUsdTotal();
  const factTotals = getCurrentFactMetricTotals();

  const totalOrders = movementAccruedTotal + manualOrdersTotal;
  const totalReceivedUsd = movementReceivedUsdTotal + ordersReceivedUsdTotal;
  const balance = movementTotals.balanceTotal + ordersBalanceTotal;
  const totalOrdersSeventyPct = movementSeventyTotal + (manualOrdersTotal * 0.7);
  const ownerOrderShare30Pct = totalOrders - totalOrdersSeventyPct;
  const upgradeTotals = buildAnalyticsUpgradeTotals({
    totalOrdersSeventyPct,
    ownerOrderShare30Pct,
    totalPaid,
    realIncomeTotal: getRealIncomeUsdForProfit(totalReceivedUsd),
    myServicesTotal: factTotals.myServices,
    myCostsTotal: factTotals.myCosts
  });

  return {
    totalOrders,
    ordersAccruedWithPercent: movementAccruedTotal,
    totalAccrued: totalOrders,
    balance,
    totalPaid,
    total: upgradeTotals.total,
    personalOrdersGross: parseLooseNumber(ordersSummary.personalOrdersGross),
    personalOrdersAfterDiscount,
    ownerOrderShare30Pct: upgradeTotals.ownerOrderShare30Pct,
    realIncomeTotal: upgradeTotals.realIncomeTotal,
    myServices: factTotals.myServices,
    myCosts: factTotals.myCosts,
    profit: upgradeTotals.profit
  };
}

function getProviderRealIncomeUsdForProfit() {
  const summaryByChannel = state?.data?.realIncome?.summaryByChannel || {};
  return Object.values(summaryByChannel).reduce(
    (sum, row) => sum + parseLooseNumber(row?.realNetUsd ?? row?.netUsd ?? row?.usd),
    0
  );
}

function getRealIncomeUsdForProfit(fallbackReceivedUsd = 0) {
  const providerRealIncome = getProviderRealIncomeUsdForProfit();
  if (providerRealIncome) return providerRealIncome;
  return parseLooseNumber(fallbackReceivedUsd);
}

function buildAnalyticsUpgradeTotals({ totalOrdersSeventyPct = 0, ownerOrderShare30Pct = 0, totalPaid = 0, realIncomeTotal = 0, myServicesTotal = 0, myCostsTotal = 0 } = {}) {
  const accrued = parseLooseNumber(totalOrdersSeventyPct);
  const ownerShare = parseLooseNumber(ownerOrderShare30Pct);
  const paid = parseLooseNumber(totalPaid);
  const realIncome = parseLooseNumber(realIncomeTotal);
  const services = parseLooseNumber(myServicesTotal);
  const costs = parseLooseNumber(myCostsTotal);
  const rawTotal = accrued + paid + services;
  return {
    totalOrdersSeventyPct: accrued,
    ownerOrderShare30Pct: ownerShare,
    rawTotal,
    total: -rawTotal,
    realIncomeTotal: realIncome,
    incomeForProfit: ownerShare + services,
    profit: ownerShare + services - costs
  };
}

function getCurrentFactMetricRows() {
  if (state.aggregatedManualRange?.rows?.length) return state.aggregatedManualRange.rows;
  if (state.manualFinance.data?.moneyRows?.length) return state.manualFinance.data.moneyRows;
  if (state.analyticsFact?.moneyRows?.length) return state.analyticsFact.moneyRows;
  return [];
}

function getCurrentFactMetricTransfers() {
  if (state.aggregatedManualRange?.transferRows?.length) return state.aggregatedManualRange.transferRows;
  if (state.manualFinance.data?.transferRows?.length) return state.manualFinance.data.transferRows;
  if (state.analyticsFact?.transferRows?.length) return state.analyticsFact.transferRows;
  return [];
}

function getCurrentFactMetricTotals() {
  const manualRows = getCurrentAnalyticsManualRows();
  if (!manualRows.length) return { myServices: 0, myCosts: 0 };
  const rateLookup = buildManualFinanceUsdRateLookup(
    getCurrentFactMetricTransfers(),
    state.data?.tabs?.movement?.values || [],
    { endDate: elements.endDate?.value || state.analyticsFact?.periodEnd || "" }
  );
  return {
    myServices: manualRows.reduce((sum, row) => {
      if (!row?.channel || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return sum;
      return sum + getManualFinanceFieldUsdNumber(row, "serviceIncome", rateLookup);
    }, 0),
    myCosts: manualRows.reduce((sum, row) => {
      if (!row?.channel || row.channel === MANUAL_FINANCE_TOTAL_LABEL) return sum;
      return sum + ["business", "flat", "food", "fun", "study", "travel"].reduce(
        (rowSum, key) => rowSum + getManualFinanceFieldUsdNumber(row, key, rateLookup),
        0
      );
    }, 0)
  };
}

function buildAnalyticsPeriodUsdSummaryRows(manualRows, rateLookup, totals = {}) {
  const myServicesTotal = sumManualFinanceFieldUsdNumber(manualRows, "serviceIncome", rateLookup);
  const myCostsTotal = sumManualFinanceSpendUsdNumber(manualRows, rateLookup);
  const totalOrdersSeventyPct = parseLooseNumber(totals.totalOrdersSeventyPct);
  const payoutsUsdTotal = parseLooseNumber(totals.payoutsUsdTotal);
  const upgradeTotals = buildAnalyticsUpgradeTotals({
    totalOrdersSeventyPct,
    totalPaid: payoutsUsdTotal,
    myServicesTotal,
    myCostsTotal
  });
  return [
    ["Мои услуги", formatSheetNumber(myServicesTotal)],
    ["Начислено (70% от +3%)", formatSheetNumber(totalOrdersSeventyPct)],
    ["Выплаты", formatSheetNumber(payoutsUsdTotal)],
    ["Итого", formatSheetNumber(upgradeTotals.total)],
    ["Всего расходов", formatSheetNumber(myCostsTotal)]
  ];
}

function getMovementSummaryMetric(summaryRows, labelParts) {
  const row = (summaryRows || []).find((item) => {
    const label = normalizeCell(item?.[0]).replace(/ё/g, "е");
    return (labelParts || []).every((part) => label.includes(normalizeCell(part).replace(/ё/g, "е")));
  });
  return row ? parseLooseNumber(row[1]) : 0;
}

function formatPayoutNumber(value) {
  return Number(value || 0).toFixed(4).replace(".", ",");
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildClosedFactTransferTotalRow(header, rows, label = MANUAL_FINANCE_TOTAL_LABEL, usdTotal = null) {
  const width = Math.max(header.length, ...rows.map((row) => row.length), MANUAL_TRANSFER_HEADERS.length);
  const totalRow = Array.from({ length: width }, () => "");
  totalRow[0] = label;
  if (width > 6) {
    totalRow[6] = formatPayoutNumber(
      usdTotal == null ? calculateClosedFactTransferRowsUsdTotal(rows) : usdTotal
    );
  }
  return totalRow;
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function calculateCombinedPayoutDisplayTotal(upperPayoutUsdTotal, transferRows) {
  const upperAbsTotal = Math.abs(parseLooseNumber(upperPayoutUsdTotal));
  const transferAbsTotal = Math.abs(calculateClosedFactTransferRowsUsdTotal(transferRows));
  const total = upperAbsTotal + transferAbsTotal;
  return total ? -total : 0;
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function getNormalizedPayoutTransferRows() {
  const header = MANUAL_TRANSFER_HEADERS.slice();
  const savedRows = state.manualTransfers.data?.transferRows
    ? state.manualTransfers.data.transferRows.map((row) => [
        row.transferDate || "",
        row.who || "",
        row.amount || "",
        row.currency || "",
        row.channel || "",
        row.rate || "",
        row.usdAmount || ""
      ])
    : [];
  const rawRows = savedRows.length
    ? savedRows
    : clone2dArray(state.data?.tabs?.payouts?.closedFactTransfers || []);
  const nonEmptyRows = rawRows.filter((row) => hasAnyValue(row));
  const rows = ANALYTICS_PAYOUTS_HELPER.buildTransferPayoutRowsWithUsd
    ? ANALYTICS_PAYOUTS_HELPER.buildTransferPayoutRowsWithUsd(header, nonEmptyRows, {
        movementValues: state.data?.tabs?.movement?.values || []
      })
    : nonEmptyRows;
  return { header, rows };
}


// ============================================================
// CURRENCY RATES
// ============================================================

function calculateCurrentPayoutTransferRowsUsdTotal() {
  return calculateClosedFactTransferRowsUsdTotal(getNormalizedPayoutTransferRows().rows);
}

function calculateCurrentOverallPayoutUsdTotal() {
  const { rows } = getNormalizedPayoutTransferRows();
  const upperPayoutUsdTotal = calculatePayoutUsdTotal(state.data?.tabs?.payouts?.values || []);
  return calculateCombinedPayoutDisplayTotal(upperPayoutUsdTotal, rows);
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildPayoutTransferChannelTotalRows(header, rows) {
  const stats = calculatePayoutChannelStats([header], rows);
  const amountIndex = findHeaderIndexByAliases(header, ["сумма", "СУММА ТЕКУЩАЯ"]);
  const usdIndex = findHeaderIndexByAliases(header, ["сумма в долларах", "AMOUNT (USD)"]);
  return MANUAL_FINANCE_MONEY_CHANNELS
    .map((channel) => ({ channel, stat: stats[channel] || { local: 0, usd: 0 } }))
    .filter(({ stat }) => parseLooseNumber(stat.local) || parseLooseNumber(stat.usd))
    .map(({ channel, stat }) => {
      const row = Array.from({ length: Math.max(header.length, MANUAL_TRANSFER_HEADERS.length) }, () => "");
      row[0] = `${MANUAL_FINANCE_TOTAL_LABEL}: ${channel}`;
      row[4] = channel;
      if (amountIndex !== -1) row[amountIndex] = formatPayoutNumber(Math.abs(stat.local));
      if (usdIndex !== -1) row[usdIndex] = formatPayoutNumber(Math.abs(stat.usd));
      return row;
    });
}

function getPayoutTransferTableValues() {
  const { header, rows } = getNormalizedPayoutTransferRows();
  if (!rows.length) return [header];
  const channelTotalRows = buildPayoutTransferChannelTotalRows(header, rows);
  const totalRow = buildClosedFactTransferTotalRow(header, rows);
  const upperPayoutUsdTotal = calculatePayoutUsdTotal(state.data?.tabs?.payouts?.values || []);
  const overallRow = buildClosedFactTransferTotalRow(
    header,
    rows,
    "Всего выплат",
    calculateCombinedPayoutDisplayTotal(upperPayoutUsdTotal, rows)
  );
  return [header, ...rows, ...channelTotalRows, totalRow, overallRow];
}


// ============================================================
// ANALYTICS AND TOTALS
// ============================================================

function formatPlanLocalSummary(currencyTotals) {
  const ordered = ["USD", "RUB", "UAH", "EUR", "CAD", "LOCAL"];
  const parts = [];
  ordered.forEach((currency) => {
    const amount = roundTo2(currencyTotals?.[currency] || 0);
    if (!amount) return;
    parts.push(`${currency === "LOCAL" ? "LOCAL" : currency} ${formatSheetNumber(amount)}`);
  });
  return parts.length ? parts.join(" / ") : formatSheetNumber(0);
}


// ============================================================
// MANUAL FINANCE
// ============================================================

function buildManualFinancePeriodLabel(startDate, endDate) {
  if (!startDate || !endDate) return "Дата не выбрана";
  if (startDate === endDate) return formatDisplayDate(endDate);
  return `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
}
