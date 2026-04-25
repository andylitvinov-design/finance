(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.EzohataAnalyticsPayoutsHelper = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TOTAL_LABEL = "Итого";

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeLookupText(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    return raw.replace(/[^0-9a-zа-я]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseLooseNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatPayoutNumber(value) {
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function findHeaderIndexByAliases(header, aliases) {
    const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
    return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
  }

  function normalizeClientFamilyToken(value) {
    const token = normalizeLookupText(value);
    if (!token || token.length < 4) return "";
    return token
      .replace(/(ого|его|ой|ая|яя|ый|ий|ые|ие|ых|их|а|я|ы|и)$/i, "")
      .replace(/(ов|ев|ин|ын)$/i, (ending) => {
        if (/^(ин|ын)$/i.test(ending)) return ending;
        return "";
      });
  }

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
    const normalized = normalizeLookupText(client);
    const familyKeys = getClientPaymentLookupKeys(client).join(" ");
    const text = `${normalized} ${familyKeys}`;
    if (/(william|вильям|вилл)/i.test(text)) return "трансервайз дол";
    if (/лозин/i.test(text)) return "монобанк грн";
    if (/игнат/i.test(text)) return "пейпал дол";
    return "";
  }

  function resolvePaymentChannel(value, channels = [], paymentRules = {}) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const exact = channels.find((channel) => normalizeCell(channel) === normalizeCell(raw));
    if (exact) return exact;
    const normalized = normalizeLookupText(raw);
    const entry = Object.entries(paymentRules || {}).find(([, rule]) => {
      return [...(rule.localPatterns || []), ...(rule.usdPatterns || [])].some((pattern) => pattern.test(raw) || pattern.test(normalized));
    });
    return entry ? entry[0] : "";
  }

  function buildMovementPaymentSummaryRows(movementValues, channels = [], paymentRules = {}) {
    const header = movementValues?.[0] || [];
    const paymentIndex = findHeaderIndexByAliases(header, ["PAYMENT METHOD"]);
    const clientIndex = findHeaderIndexByAliases(header, ["CLIENT", "КЛИЕНТ"]);
    const accruedIndex = findHeaderIndexByAliases(header, ["ACCRUED"]);
    const accruedPlusIndex = findHeaderIndexByAliases(header, ["ACCRUED +3%"]);
    const seventyPlusIndex = findHeaderIndexByAliases(header, ["70% OF +3%"]);
    const receivedUsdIndex = findHeaderIndexByAliases(header, [
      "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)",
      "RECEIVED TOTAL USD"
    ]);
    const balanceIndex = findHeaderIndexByAliases(header, ["BALANCE", "БАЛАНС"]);
    const totals = Object.fromEntries(
      (channels || []).map((channel) => [
        channel,
        {
          accrued: 0,
          accruedPlus: 0,
          seventyPlus: 0,
          receivedUsd: 0,
          balance: 0
        }
      ])
    );

    const dataRows = (movementValues || []).slice(1);
    const nextPaymentByClient = {};
    for (let index = dataRows.length - 1; index >= 0; index -= 1) {
      const row = dataRows[index] || [];
      const client = String(clientIndex !== -1 ? row[clientIndex] || "" : "").trim();
      const paymentMethod = String(paymentIndex !== -1 ? row[paymentIndex] || "" : "").trim();
      if (client && paymentMethod && resolvePaymentChannel(paymentMethod, channels, paymentRules)) {
        getClientPaymentLookupKeys(client).forEach((key) => {
          if (!nextPaymentByClient[key]) nextPaymentByClient[key] = paymentMethod;
        });
      }
    }

    dataRows.forEach((row) => {
      if (!row || !row.some((cell) => String(cell || "").trim())) return;
      const client = String(clientIndex !== -1 ? row[clientIndex] || "" : "").trim();
      const enteredPaymentMethod = String(paymentIndex !== -1 ? row[paymentIndex] || "" : "").trim();
      const inferredPaymentMethod = getClientPaymentLookupKeys(client).map((key) => nextPaymentByClient[key]).find(Boolean) || "";
      const fallbackChannel = !enteredPaymentMethod ? inferFallbackPaymentChannelFromClient(client) : "";
      const paymentMethod = enteredPaymentMethod || inferredPaymentMethod;
      const channel = resolvePaymentChannel(enteredPaymentMethod, channels, paymentRules) ||
        fallbackChannel ||
        resolvePaymentChannel(inferredPaymentMethod, channels, paymentRules);
      if (!channel || !totals[channel]) return;
      if (accruedIndex !== -1) totals[channel].accrued += parseLooseNumber(row[accruedIndex]);
      if (accruedPlusIndex !== -1) totals[channel].accruedPlus += parseLooseNumber(row[accruedPlusIndex]);
      if (seventyPlusIndex !== -1) totals[channel].seventyPlus += parseLooseNumber(row[seventyPlusIndex]);
      if (receivedUsdIndex !== -1) totals[channel].receivedUsd += parseLooseNumber(row[receivedUsdIndex]);
      if (balanceIndex !== -1) totals[channel].balance += parseLooseNumber(row[balanceIndex]);
    });

    const rows = (channels || []).map((channel) => [
      channel,
      formatPayoutNumber(totals[channel]?.accrued || 0),
      formatPayoutNumber(totals[channel]?.accruedPlus || 0),
      formatPayoutNumber(totals[channel]?.seventyPlus || 0),
      formatPayoutNumber(totals[channel]?.receivedUsd || 0),
      formatPayoutNumber(totals[channel]?.balance || 0)
    ]);
    const summary = rows.reduce(
      (sum, row) => {
        sum[1] += parseLooseNumber(row[1]);
        sum[2] += parseLooseNumber(row[2]);
        sum[3] += parseLooseNumber(row[3]);
        sum[4] += parseLooseNumber(row[4]);
        sum[5] += parseLooseNumber(row[5]);
        return sum;
      },
      ["Итого", 0, 0, 0, 0, 0]
    );
    return rows.concat([
      [
        summary[0],
        formatPayoutNumber(summary[1]),
        formatPayoutNumber(summary[2]),
        formatPayoutNumber(summary[3]),
        formatPayoutNumber(summary[4]),
        formatPayoutNumber(summary[5])
      ]
    ]);
  }

  function formatRateNumber(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return "";
    return numeric.toFixed(6).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  }

  function parseTransferDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`);
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
      const [day, month, year] = raw.split(".");
      return new Date(`${year}-${month}-${day}T00:00:00Z`);
    }
    return null;
  }

  function normalizeCurrency(value, channel = "") {
    const raw = String(value || "").trim().toUpperCase();
    if (raw) {
      if (/РУБ|RUB/.test(raw)) return "RUB";
      if (/ГРН|UAH/.test(raw)) return "UAH";
      if (/ЕВР|EUR|EURO/.test(raw)) return "EUR";
      if (/CAD|КАНАД/.test(raw)) return "CAD";
      if (/ДОЛ|USD/.test(raw)) return "USD";
      return raw;
    }
    const normalizedChannel = String(channel || "").trim();
    if (/руб/i.test(normalizedChannel)) return "RUB";
    if (/грн/i.test(normalizedChannel)) return "UAH";
    if (/(евр|eur|euro)/i.test(normalizedChannel)) return "EUR";
    if (/(cad|канада)/i.test(normalizedChannel)) return "CAD";
    return "USD";
  }

  function buildMovementRateRows(movementValues) {
    if (!Array.isArray(movementValues) || !movementValues.length) return [];
    const header = movementValues[0] || [];
    const dateIndex = findHeaderIndexByAliases(header, ["DATE", "дата"]);
    const rateIndexes = {
      RUB: findHeaderIndexByAliases(header, ["RUB RATE", "курс руб", "к-р"]),
      UAH: findHeaderIndexByAliases(header, ["UAH RATE", "курс грн", "к-гр"]),
      EUR: findHeaderIndexByAliases(header, ["EUR RATE", "курс евро", "к-евро"]),
      CAD: findHeaderIndexByAliases(header, ["CAD RATE", "курс cad", "курс канада"])
    };
    if (dateIndex === -1) return [];
    return movementValues.slice(1).map((row) => ({
      date: parseTransferDate(row?.[dateIndex]),
      rates: Object.fromEntries(
        Object.entries(rateIndexes)
          .filter(([, index]) => index !== -1)
          .map(([currency, index]) => [currency, parseLooseNumber(row?.[index])])
          .filter(([, rate]) => rate > 0)
      )
    })).filter((row) => row.date && Object.keys(row.rates).length);
  }

  function findRateForTransfer(currency, transferDate, movementRateRows, fallbackRates) {
    if (currency === "USD") return 1;
    const datedRows = (movementRateRows || [])
      .filter((row) => row.rates?.[currency] > 0)
      .sort((a, b) => a.date - b.date);
    const parsedDate = parseTransferDate(transferDate);
    if (parsedDate && datedRows.length) {
      const sameOrEarlier = datedRows.filter((row) => row.date <= parsedDate).at(-1);
      if (sameOrEarlier) return sameOrEarlier.rates[currency];
      return datedRows[0].rates[currency];
    }
    return datedRows.at(-1)?.rates?.[currency] || fallbackRates?.[currency] || 0;
  }

  function buildTransferPayoutRowsWithUsd(header, transferRows, options = {}) {
    const movementRateRows = buildMovementRateRows(options.movementValues || []);
    const fallbackRates = {
      USD: 1,
      RUB: 84.5563,
      UAH: 43.86,
      EUR: 1 / 1.16,
      CAD: 1 / 0.74,
      ...(options.fallbackRates || {})
    };
    const amountIndex = findHeaderIndexByAliases(header, ["сумма", "СУММА ТЕКУЩАЯ"]);
    const currencyIndex = findHeaderIndexByAliases(header, ["валюта", "валюта локальная", "ВАЛЮТА"]);
    const channelIndex = findHeaderIndexByAliases(header, ["канал куда", "PAYMENT METHOD", "DESTINATION"]);
    const dateIndex = findHeaderIndexByAliases(header, ["дата перевода", "DATE", "дата"]);
    const rateIndex = findHeaderIndexByAliases(header, ["курс", "КУРС ПЕРЕВОДА"]);
    const usdIndex = findHeaderIndexByAliases(header, ["сумма в долларах", "AMOUNT (USD)"]);

    return (transferRows || []).map((sourceRow) => {
      const row = Array.isArray(sourceRow)
        ? sourceRow.slice()
        : [
            sourceRow.transferDate || sourceRow.date || "",
            sourceRow.who || "",
            sourceRow.amount || "",
            sourceRow.currency || sourceRow.localCurrency || "",
            sourceRow.channel || sourceRow.destination || "",
            sourceRow.rate || "",
            sourceRow.usdAmount || ""
          ];
      while (row.length < header.length) row.push("");
      const amount = parseLooseNumber(row[amountIndex]);
      const currency = normalizeCurrency(row[currencyIndex], row[channelIndex]);
      const transferDate = row[dateIndex];
      const rate = parseLooseNumber(row[rateIndex]) || findRateForTransfer(currency, transferDate, movementRateRows, fallbackRates);
      if (rateIndex !== -1 && !parseLooseNumber(row[rateIndex]) && rate) row[rateIndex] = formatRateNumber(rate);
      if (usdIndex !== -1) row[usdIndex] = formatPayoutNumber(rate ? amount / rate : 0);
      return row;
    });
  }

  function buildPayoutTotalRow(header, rows) {
    const width = Math.max(header.length, ...rows.map((row) => row.length), 1);
    const totalRow = Array.from({ length: width }, () => "");
    totalRow[0] = TOTAL_LABEL;
    const currentAmountIndex = findHeaderIndexByAliases(header, ["СУММА ТЕКУЩАЯ"]);
    const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)", "сумма в долларах"]);
    if (currentAmountIndex !== -1) {
      totalRow[currentAmountIndex] = formatPayoutNumber(
        rows.reduce((sum, row) => sum + parseLooseNumber(row[currentAmountIndex]), 0)
      );
    }
    if (usdAmountIndex !== -1) {
      totalRow[usdAmountIndex] = formatPayoutNumber(
        rows.reduce((sum, row) => sum + parseLooseNumber(row[usdAmountIndex]), 0)
      );
    }
    return totalRow;
  }

  function calculatePayoutUsdTotalFromTable(values) {
    if (!Array.isArray(values) || !values.length) return 0;
    const header = values[0] || [];
    const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)"]);
    if (usdAmountIndex === -1) return 0;

    const summaryRow = values.slice(1).find((row) => {
      const firstCell = normalizeCell(row?.[0]);
      return firstCell === normalizeCell(TOTAL_LABEL) || firstCell === normalizeCell("итого за период");
    });
    if (summaryRow) {
      return parseLooseNumber(summaryRow[usdAmountIndex] || "");
    }

    return values.slice(1).reduce((sum, row) => sum + parseLooseNumber(row?.[usdAmountIndex] || ""), 0);
  }

  function calculatePayoutTotalsByChannel(values, channels) {
    const output = {};
    (channels || []).forEach((channel) => {
      output[channel] = { local: 0, usd: 0 };
    });
    if (!Array.isArray(values) || !values.length) return output;

    const header = values[0] || [];
    const paymentMethodIndex = findHeaderIndexByAliases(header, ["PAYMENT METHOD", "DESTINATION", "канал куда"]);
    const currentAmountIndex = findHeaderIndexByAliases(header, ["СУММА ТЕКУЩАЯ", "сумма"]);
    const usdAmountIndex = findHeaderIndexByAliases(header, ["AMOUNT (USD)", "сумма в долларах"]);
    if (paymentMethodIndex === -1 || usdAmountIndex === -1) return output;

    values.slice(1).forEach((row) => {
      if (!row || normalizeCell(row[0]) === normalizeCell(TOTAL_LABEL)) return;
      const paymentMethod = String(row[paymentMethodIndex] || "").trim();
      if (!paymentMethod) return;
      const channel = (channels || []).find((candidate) => normalizeCell(candidate) === normalizeCell(paymentMethod));
      if (!channel) return;
      output[channel] = output[channel] || { local: 0, usd: 0 };
      if (currentAmountIndex !== -1) output[channel].local += parseLooseNumber(row[currentAmountIndex]);
      output[channel].usd += parseLooseNumber(row[usdAmountIndex]);
    });

    return output;
  }

  function mapAnalyticsTopRows(manualRows) {
    return (manualRows || []).map((row) => [
      row.channel || "",
      row.now || "",
      row.serviceIncome || "",
      row.business || "",
      row.flat || "",
      row.food || "",
      row.fun || "",
      row.travel || "",
      row.total || "",
      row.exchange || "",
      row.totalUsd || "",
      row.nowUsd || ""
    ]);
  }

  function calculateCommissionTotalsByChannel(rows, channels = []) {
    const totals = Object.fromEntries((channels || []).map((channel) => [channel, 0]));
    (rows || []).forEach((row) => {
      const rawChannel = Array.isArray(row) ? row[1] : row?.channel;
      const channel = (channels || []).find((item) => normalizeCell(item) === normalizeCell(rawChannel));
      if (!channel) return;
      totals[channel] += parseLooseNumber(Array.isArray(row) ? row[2] : row?.usdAmount);
    });
    return totals;
  }

  return {
    TOTAL_LABEL,
    buildPayoutTotalRow,
    buildMovementPaymentSummaryRows,
    buildTransferPayoutRowsWithUsd,
    calculateCommissionTotalsByChannel,
    calculatePayoutTotalsByChannel,
    calculatePayoutUsdTotalFromTable,
    inferFallbackPaymentChannelFromClient,
    mapAnalyticsTopRows,
  };
});
