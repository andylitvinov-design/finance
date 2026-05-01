const UAH_USD_FALLBACK_RATE = 1 / 43.86;

const PRIVAT_CHANNEL_BY_CURRENCY = {
  USD: "приват 24-дол",
  EUR: "приват 24-евро",
  UAH: "приват 24-грн"
};

export function parsePrivatStatement(input) {
  const rows = extractInputRows(input);
  return rows.flatMap((row, index) => normalizePrivatLedgerRows(row, index)).filter((row) => row.date && row.amount);
}

function extractInputRows(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    for (const key of ["statements", "transactions", "items", "data", "rows"]) {
      if (Array.isArray(input[key])) return input[key];
    }
    if (Array.isArray(input?.response?.data)) return input.response.data;
    return [input];
  }
  const text = String(input || "").trim();
  if (!text) return [];
  const parsedJson = parseJson(text);
  if (parsedJson) return extractInputRows(parsedJson);
  const csvRows = parseCsvText(text);
  if (csvRows.length) return csvRows;
  return parseFallbackText(text);
}

function normalizePrivatLedgerRows(row, index = 0) {
  const date = normalizeDate(firstNonEmpty(row.date, row.operationDate, row.trandate, row.dat_od, row.time));
  const description = firstNonEmpty(row.description, row.purpose, row.nazn, row.paymentPurpose, row.details, row.info);
  const counterparty = firstNonEmpty(row.counterparty, row.counterpartyName, row.name, row.contragentName, row.AUT_MY_NAM, row.merchant, row.merchantName);
  const externalId = firstNonEmpty(row.external_id, row.externalId, row.id, row.transactionId, row.ref, row.reference, row.trn_id, row.docNumber, `privat-${date || "unknown"}-${index}`);
  if (looksLikeExchange(row, description)) return buildExchangeRows(row, { date, description, counterparty, externalId });

  const amount = parseBankNumber(firstNonEmpty(row.amount, row.sum, row.value, row.amt, row.trantype === "D" ? row.debit : row.credit));
  const currency = normalizeCurrency(firstNonEmpty(row.currency, row.ccy, row.currencyCode, row.cardCurrency, row.accountCurrency));
  const direction = inferDirection(row, amount);
  const channel = getPrivatChannel(currency);
  const category = direction === "income" ? "servicein" : inferCategory(row);
  return [{
    date,
    operation: direction === "income" ? "income" : (category === "business" ? "business_expense" : "personal_expense"),
    from_channel: direction === "income" ? "" : channel,
    to_channel: direction === "income" ? channel : "",
    amount: formatNumber(Math.abs(amount)),
    currency,
    amount_usd: formatNumber(convertToUsd(Math.abs(amount), currency, row)),
    category,
    subcategory: "",
    direction: direction === "income" ? "in" : "out",
    comment: description,
    counterparty,
    description,
    source: "mcp",
    external_id: externalId,
    raw_source_id: externalId,
    transfer_group_id: ""
  }];
}

function buildExchangeRows(row, context) {
  const outCurrency = normalizeCurrency(firstNonEmpty(row.fromCurrency, row.sellCurrency, row.outCurrency, row.currency, "UAH"));
  const inCurrency = normalizeCurrency(firstNonEmpty(row.toCurrency, row.buyCurrency, row.inCurrency, row.targetCurrency, "USD"));
  const outAmount = Math.abs(parseBankNumber(firstNonEmpty(row.fromAmount, row.sellAmount, row.outAmount, row.amount, row.debit)));
  const inAmount = Math.abs(parseBankNumber(firstNonEmpty(row.toAmount, row.buyAmount, row.inAmount, row.receivedAmount, row.credit, row.usdAmount, row.amountUsd)));
  const exchangeGroupId = String(firstNonEmpty(row.exchange_group_id, row.exchangeGroupId, context.externalId)).trim();
  const outUsd = convertToUsd(outAmount, outCurrency, row);
  const inUsd = inCurrency === "USD" ? inAmount : convertToUsd(inAmount, inCurrency, row);
  return [
    {
      date: context.date,
      operation: "exchange_out",
      from_channel: getPrivatChannel(outCurrency),
      to_channel: getPrivatChannel(inCurrency),
      amount: formatNumber(outAmount),
      currency: outCurrency,
      amount_usd: formatNumber(-Math.abs(outUsd || inUsd)),
      category: "exchange",
      subcategory: "",
      direction: "out",
      comment: context.description || "PrivatBank exchange",
      counterparty: context.counterparty,
      description: context.description,
      source: "mcp",
      external_id: `${context.externalId}:out`,
      raw_source_id: `${context.externalId}:out`,
      transfer_group_id: exchangeGroupId
    },
    {
      date: context.date,
      operation: "exchange_in",
      from_channel: getPrivatChannel(outCurrency),
      to_channel: getPrivatChannel(inCurrency),
      amount: formatNumber(inAmount || Math.abs(outUsd || 0)),
      currency: inCurrency,
      amount_usd: formatNumber(Math.abs(inUsd || outUsd)),
      category: "exchange",
      subcategory: "",
      direction: "in",
      comment: context.description || "PrivatBank exchange",
      counterparty: context.counterparty,
      description: context.description,
      source: "mcp",
      external_id: `${context.externalId}:in`,
      raw_source_id: `${context.externalId}:in`,
      transfer_group_id: exchangeGroupId
    }
  ];
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delimiter).map(normalizeHeader);
  if (!header.includes("date") && !header.includes("amount") && !header.includes("description")) return [];
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    return Object.fromEntries(header.map((name, index) => [name, cells[index] || ""]));
  });
}

function parseFallbackText(text) {
  return text.split(/\r?\n/).map((line, index) => {
    const match = line.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}).*?([+-]?\d[\d\s.,]*)\s*(UAH|грн|USD|дол|EUR|евр)?/i);
    if (!match) return null;
    return {
      date: match[1],
      amount: match[2],
      currency: match[3] || "UAH",
      description: line.trim(),
      id: `privat-text-${index + 1}`
    };
  }).filter(Boolean);
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(headerLine) {
  return (headerLine.match(/;/g) || []).length >= (headerLine.match(/,/g) || []).length ? ";" : ",";
}

function normalizeHeader(value) {
  const token = String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-яіїєґ]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases = {
    operation_date: "date",
    trandate: "date",
    dat_od: "date",
    сумма: "amount",
    suma: "amount",
    sum: "amount",
    ccy: "currency",
    валюта: "currency",
    назначение_платежа: "description",
    purpose: "description",
    nazn: "description",
    контрагент: "counterparty",
    contragent_name: "counterparty",
    ref: "external_id"
  };
  return aliases[token] || token;
}

function looksLikeExchange(row, description = "") {
  const text = normalizeText([description, row.type, row.operationType, row.trantype, row.category].join(" "));
  if (/обмiн|обмін|обмен|exchange|конвертац|купiвля валюти|купівля валюти|продаж валюти/.test(text)) return true;
  return Boolean(firstNonEmpty(row.toAmount, row.buyAmount, row.inAmount, row.receivedAmount) && firstNonEmpty(row.fromAmount, row.sellAmount, row.outAmount, row.amount));
}

function inferDirection(row, amount) {
  const raw = normalizeText(firstNonEmpty(row.direction, row.type, row.trantype, row.operationType));
  if (/credit|income|in|c|приход|кредит/.test(raw)) return "income";
  if (/debit|expense|out|d|расход|дебет/.test(raw)) return "expense";
  return Number(amount) < 0 ? "expense" : "income";
}

function inferCategory(row) {
  const text = normalizeText([row.description, row.purpose, row.mcc].filter(Boolean).join(" "));
  if (/курс|обуч|навч|учеб|school|study/.test(text)) return "travel";
  if (/еда|food|продукт|кафе|coffee|restaurant|маркет/.test(text)) return "food";
  if (/кварт|аренд|rent|flat|house|дом/.test(text)) return "house";
  if (/такси|hotel|flight|travel|поезд|билет/.test(text)) return "travel";
  if (/кино|бар|game|fun|развлеч/.test(text)) return "fun";
  return "business";
}

function convertToUsd(amount, currency, row = {}) {
  const numeric = Math.abs(Number(amount || 0));
  if (!numeric) return 0;
  const normalizedCurrency = normalizeCurrency(currency);
  if (normalizedCurrency === "USD") return numeric;
  const rate = parseRate(firstNonEmpty(row.rate, row.uah_rate, row.uahRate, row.exchangeRate, row.kurs));
  const usdPerLocal = rate || (normalizedCurrency === "UAH" ? UAH_USD_FALLBACK_RATE : 0);
  return usdPerLocal ? numeric * usdPerLocal : 0;
}

function parseRate(value) {
  const numeric = parseBankNumber(value);
  if (!numeric) return 0;
  return numeric > 2 ? 1 / numeric : numeric;
}

function parseBankNumber(value) {
  const raw = String(value || "0").trim().replace(/\s+/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/,/g, "")
    : raw.replace(",", ".");
  return Number.parseFloat(normalized.replace(/[^\d.+-]/g, "")) || 0;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return "";
}

function normalizeCurrency(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "980") return "UAH";
  if (raw === "840") return "USD";
  if (raw === "978") return "EUR";
  if (/USD|ДОЛ/.test(raw)) return "USD";
  if (/EUR|ЕВР/.test(raw)) return "EUR";
  return "UAH";
}

function getPrivatChannel(currency) {
  return PRIVAT_CHANNEL_BY_CURRENCY[normalizeCurrency(currency)] || "приват 24-грн";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-яіїєґ]+/g, " ").replace(/\s+/g, " ");
}

function formatNumber(value) {
  return String(Math.round((Number(value) || 0) * 10000) / 10000);
}
