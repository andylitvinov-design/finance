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

export function normalizeServerAnalyticsPayload(data) {
  if (!data?.tabs?.analytics?.values?.length) return data;

  const values = data.tabs.analytics.values;
  const manualRows = extractManualRows(values);
  const existingBalances = Array.isArray(data.manual?.balances) ? data.manual.balances : [];
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

    const channel = String(row[0] || "").trim();
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
  const manualLookup = new Map((manualRows || []).map((row) => [normalizeCell(row.channel), row]));
  const lookup = {};

  (balances || []).forEach((entry) => {
    const channel = String(entry.channel || entry.accountName || "").trim();
    if (!channel || normalizeCell(channel) === normalizeCell(TOTAL_LABEL)) return;

    const manualRow = manualLookup.get(normalizeCell(channel));
    const amount = entry.amount ?? entry.balanceAmount ?? manualRow?.now ?? "";
    const currency = String(entry.currency || manualRow?.currency || inferChannelCurrency(channel)).trim().toUpperCase();
    const isAnalyticsFallback = entry.source === "analytics-now-fallback";
    const usdAmount = isAnalyticsFallback ? 0 : parseLooseNumber(entry.usdAmount || manualRow?.nowUsd || "");
    const localPerUsd = parseLooseNumber(entry.rate);
    const value = deriveUsdAmount(amount, currency, { usdAmount, localPerUsd });
    if (value) lookup[channel] = value;
  });

  (manualRows || []).forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(lookup, row.channel)) return;
    const value = deriveUsdAmount(row.now, row.currency || inferChannelCurrency(row.channel), {
      usdAmount: 0,
      localPerUsd: 0,
    });
    if (value) lookup[row.channel] = value;
  });

  return lookup;
}

export function rebuildAnalyticsValues(values, manualRows, closingUsdLookup) {
  let output = values.map((row) => row.slice());
  output = replaceSection(output, "Plan", (section) => rebuildPlanSection(section, manualRows));
  output = replaceSection(output, "БАЛАНС", (section) => rebuildBalanceSection(section, closingUsdLookup));
  return output;
}

function rebuildPlanSection(section, manualRows) {
  const rows = section.rows.map((row) => row.slice());
  const exchangeLookup = Object.fromEntries((manualRows || []).map((row) => [row.channel, row]));
  const rebuiltRows = rows.map((row) => {
    const channel = String(row[0] || "").trim();
    const manual = exchangeLookup[channel] || {};
    return [
      row[0] || "",
      row[1] || "",
      row[2] || "",
      row[6] || "",
      row[7] || "",
      row[3] || "",
      manual.exchange || "",
      manual.exchangeUsd || "",
      row[5] || "",
      row[8] || "",
    ];
  });
  return {
    title: section.title,
    header: PLAN_HEADER,
    rows: rebuiltRows,
  };
}

function rebuildBalanceSection(section, closingUsdLookup) {
  const sourceRows = section.rows.filter((row) => {
    const channel = String(row[0] || "").trim();
    return channel && normalizeCell(channel) !== normalizeCell(TOTAL_LABEL);
  });
  const rows = sourceRows.map((row) => {
    const channel = String(row[0] || "").trim();
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
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim()) ? String(value).trim() : "";
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
