import { createSign } from "node:crypto";

const MANUAL_SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";

const EXPENSE_SHEET_NAME = "Расходы";
const BALANCE_SHEET_NAME = "Остатки";
const TRANSFER_SHEET_NAME = "Переводы";
const COMMISSION_SHEET_NAME = "Комиссии";
const NORMALIZED_OPERATION_HEADERS = [
  "date",
  "operation",
  "from_channel",
  "to_channel",
  "amount",
  "currency",
  "amount_usd",
  "category",
  "comment",
];

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
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

function canonicalManualFinanceChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const exact = MANUAL_FINANCE_CHANNELS.find((channel) => normalizeCell(channel) === normalizeCell(raw));
  if (exact) return exact;
  const normalized = normalizeLookupText(raw);
  const aliases = [
    { pattern: /^(яндекс|yandex)( руб| rub| рубли| rubles)?$/, channel: "Яндекс руб" },
    { pattern: /^(пейпал|paypal)( дол| usd)?$/, channel: "пейпал дол" },
    { pattern: /^(пейпал|paypal)( евр| евро| eur)$/, channel: "пейпал евр" },
    { pattern: /^(пейпал|paypal)( cad| сad)$/, channel: "пейпал сad" },
    { pattern: /^(монобанк|monobank|mono)( грн| uah)?$/, channel: "монобанк грн" },
    { pattern: /^(приват|privat)( 24)?( грн| uah)?$/, channel: "приват 24-грн" },
    { pattern: /^(binance save|бинанс save)$/, channel: "Бинанс spot" },
  ];
  const match = aliases.find((entry) => entry.pattern.test(normalized));
  return match?.channel || raw;
}

function canonicalManualExpenseChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (normalizeLookupText(raw) === normalizeLookupText("binance save")) return "Бинанс spot";
  return canonicalManualFinanceChannel(raw);
}

const MANUAL_FINANCE_CHANNELS = [
  "Яндекс руб","пейпал дол","пейпал евр","пейпал сad","приват 24-дол","приват 24-евро","приват 24-грн",
  "монобанк грн","трансервайз дол","трансервайз евро","REVOLUT дол","Payoneer - eur","Payoneer - dol",
  "Бинанс spot","binance save","Налично -я-евр","местная валюты","БАНК КАНАДА cad","нал-мам-евро","нал-мам-дол"
];

export async function loadManualRepositoryFromGoogleSheets({ fetchImpl = fetch } = {}) {
  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!clientEmail || !privateKey) {
    return {
      ok: false,
      warning: "Manual Google Sheets overlay skipped: service account credentials are not configured.",
    };
  }

  try {
    const accessToken = await requestServiceAccountAccessToken({ clientEmail, privateKey, fetchImpl });
    const valuesBySheet = await batchGetSheetValues({
      spreadsheetId: MANUAL_SPREADSHEET_ID,
      sheetNames: [EXPENSE_SHEET_NAME, BALANCE_SHEET_NAME, TRANSFER_SHEET_NAME, COMMISSION_SHEET_NAME],
      accessToken,
      fetchImpl,
    });
    return {
      ok: true,
      spreadsheetId: MANUAL_SPREADSHEET_ID,
      ...parseExpenseRepository(valuesBySheet[EXPENSE_SHEET_NAME] || []),
      balances: parseBalanceRows(valuesBySheet[BALANCE_SHEET_NAME] || []),
      transfers: parseTransferRows(valuesBySheet[TRANSFER_SHEET_NAME] || []),
      commissionRows: parseCommissionRows(valuesBySheet[COMMISSION_SHEET_NAME] || []),
    };
  } catch (error) {
    return {
      ok: false,
      warning: `Manual Google Sheets overlay failed: ${String(error?.message || error)}`,
    };
  }
}

function normalizePrivateKey(value) {
  return String(value || "").trim().replace(/\\n/g, "\n");
}

async function requestServiceAccountAccessToken({ clientEmail, privateKey, fetchImpl }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: clientEmail,
      scope: SHEETS_SCOPE,
      aud: OAUTH_TOKEN_URL,
      exp: issuedAt + 3600,
      iat: issuedAt,
    },
    privateKey
  );

  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload?.error_description || payload?.error || `OAuth token request failed with HTTP ${response.status}`);
  }
  return payload.access_token;
}

function signJwt(header, payload, privateKey) {
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function batchGetSheetValues({ spreadsheetId, sheetNames, accessToken, fetchImpl }) {
  const url = new URL(`${SHEETS_API_BASE}/spreadsheets/${spreadsheetId}/values:batchGet`);
  sheetNames.forEach((name) => url.searchParams.append("ranges", `'${name.replace(/'/g, "''")}'`));
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Sheets batchGet failed with HTTP ${response.status}`);
  }
  const output = {};
  (payload.valueRanges || []).forEach((range) => {
    const title = extractSheetTitle(range.range);
    output[title] = range.values || [];
  });
  return output;
}

function extractSheetTitle(range) {
  const raw = String(range || "");
  const match = raw.match(/^'((?:[^']|'')+)'!/);
  if (match) return match[1].replace(/''/g, "'");
  return raw.split("!")[0].replace(/^'|'$/g, "");
}

function parseExpenseRepository(values) {
  const normalizedOperations = parseNormalizedOperationRows(values);
  if (normalizedOperations) {
    return {
      schema: "operations-v1",
      operations: normalizedOperations,
      expenseRows: buildLegacyExpenseRowsFromOperations(normalizedOperations),
      views: {
        byDateChannel: buildOperationsPivotByDateChannel(normalizedOperations),
        byCategory: buildOperationsPivotByCategory(normalizedOperations),
      },
    };
  }
  return {
    schema: "legacy-expense-grid",
    operations: [],
    expenseRows: parseLegacyExpenseRows(values),
    views: null,
  };
}

function parseLegacyExpenseRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата", "date"]);
  const categoryIndex = findHeaderIndex(header, ["категория", "category"]);
  if (dateIndex === -1 || categoryIndex === -1) return [];
  const channelIndexes = header
    .map((cell, index) => ({ channel: canonicalManualExpenseChannel(cell), index }))
    .filter((item) => item.channel && item.index !== dateIndex && item.index !== categoryIndex);
  return rows
    .map((row) => ({
      date: normalizeDate(row[dateIndex]),
      category: String(row[categoryIndex] || "").trim(),
      amounts: channelIndexes.reduce((amounts, { channel, index }) => {
        const raw = String(row[index] || "").trim();
        if (!raw) {
          if (!Object.prototype.hasOwnProperty.call(amounts, channel)) amounts[channel] = "";
          return amounts;
        }
        const sum = Number(String(amounts[channel] || "0").replace(",", ".")) + Number(raw.replace(",", "."));
        amounts[channel] = Number.isFinite(sum) && sum ? String(sum).replace(".", ",") : raw;
        return amounts;
      }, {}),
    }))
    .filter((row) => row.date && row.category && Object.values(row.amounts).some((value) => String(value || "").trim()));
}

function parseNormalizedOperationRows(values) {
  const { header, rows } = splitHeaderRows(values);
  if (!looksLikeNormalizedOperationsHeader(header)) return null;
  const indexes = {
    date: findHeaderIndex(header, ["date", "дата"]),
    operation: findHeaderIndex(header, ["operation", "операция"]),
    fromChannel: findHeaderIndex(header, ["from_channel", "from channel", "канал списания", "канал from"]),
    toChannel: findHeaderIndex(header, ["to_channel", "to channel", "канал зачисления", "канал to"]),
    amount: findHeaderIndex(header, ["amount", "сумма"]),
    currency: findHeaderIndex(header, ["currency", "валюта"]),
    amountUsd: findHeaderIndex(header, ["amount_usd", "amount usd", "сумма_usd", "usd amount"]),
    category: findHeaderIndex(header, ["category", "категория"]),
    comment: findHeaderIndex(header, ["comment", "комментарий"]),
  };
  return rows
    .map((row) => ({
      date: normalizeDate(row[indexes.date]),
      operation: normalizeOperation(row[indexes.operation]),
      fromChannel: canonicalManualFinanceChannel(row[indexes.fromChannel]),
      toChannel: canonicalManualFinanceChannel(row[indexes.toChannel]),
      amount: String(row[indexes.amount] || "").trim(),
      currency: String(row[indexes.currency] || "").trim().toUpperCase(),
      amountUsd: String(row[indexes.amountUsd] || "").trim(),
      category: normalizeOperationCategory(row[indexes.category]),
      comment: String(row[indexes.comment] || "").trim(),
      source: "manual-google-sheets",
    }))
    .filter((row) => row.date && row.operation && (row.fromChannel || row.toChannel) && String(row.amount || "").trim());
}

function looksLikeNormalizedOperationsHeader(header) {
  const normalizedHeader = (header || []).map((cell) => normalizeCell(cell));
  return NORMALIZED_OPERATION_HEADERS.every((key) => normalizedHeader.includes(normalizeCell(key)));
}

function normalizeOperation(value) {
  const normalized = normalizeLookupText(value);
  if (!normalized) return "";
  if (/^(income|received|приход)$/.test(normalized)) return "income";
  if (/^(expense|spent|расход)$/.test(normalized)) return "expense";
  if (/^(exchange|обмен|exchange out|exchange in)$/.test(normalized)) return "exchange";
  if (/^(balance|balance snapshot|остаток|остатки)$/.test(normalized)) return "balance";
  if (/^(commission|комиссия)$/.test(normalized)) return "commission";
  return normalized;
}

function normalizeOperationCategory(value) {
  const normalized = normalizeLookupText(value);
  if (!normalized) return "";
  if (/^(serviceincome|service income|income|приход)$/.test(normalized)) return "serviceIncome";
  if (/^(business|бизнес)$/.test(normalized)) return "business";
  if (/^(flat|house|кварт|дом)$/.test(normalized)) return "flat";
  if (/^(food|еда)$/.test(normalized)) return "food";
  if (/^(fun|развлеч)/.test(normalized)) return "fun";
  if (/^(study|учеб|обуч|курс|школ)/.test(normalized)) return "study";
  if (/^(travel|путеш)/.test(normalized)) return "travel";
  if (/^(exchange|обмен)$/.test(normalized)) return "exchange";
  if (/^(now|остаток сейчас|стало)$/.test(normalized)) return "now";
  if (/^(commission|комиссия)$/.test(normalized)) return "commission";
  return normalized;
}

function buildLegacyExpenseRowsFromOperations(operations) {
  const grouped = new Map();
  for (const operation of operations || []) {
    const category = mapOperationToLegacyCategory(operation);
    const channel = mapOperationToLegacyChannel(operation);
    const amount = mapOperationToLegacyAmount(operation, category);
    if (!category || !channel || amount === null) continue;
    const key = `${operation.date}|${category}`;
    if (!grouped.has(key)) grouped.set(key, { date: operation.date, category, amounts: {} });
    const row = grouped.get(key);
    row.amounts[channel] = formatNumberString(parseNumberString(row.amounts[channel]) + amount);
  }
  return Array.from(grouped.values())
    .map((row) => ({
      date: row.date,
      category: row.category,
      amounts: Object.fromEntries(MANUAL_FINANCE_CHANNELS.map((channel) => [channel, row.amounts[channel] || ""])),
    }))
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return left.category.localeCompare(right.category);
    });
}

function mapOperationToLegacyCategory(operation) {
  const category = normalizeOperationCategory(operation?.category);
  const normalizedOperation = normalizeOperation(operation?.operation);
  if (category === "serviceIncome") return "serviceIncome";
  if (["business", "flat", "food", "fun", "study", "travel", "exchange", "now"].includes(category)) return category;
  if (normalizedOperation === "income") return "serviceIncome";
  if (normalizedOperation === "expense") return category || "business";
  if (normalizedOperation === "exchange") return "exchange";
  return "";
}

function mapOperationToLegacyChannel(operation) {
  const category = mapOperationToLegacyCategory(operation);
  if (!category) return "";
  const amount = parseNumberString(operation?.amount);
  if (category === "serviceIncome") return canonicalManualExpenseChannel(operation?.toChannel || operation?.fromChannel || "");
  if (category === "exchange") {
    if (amount < 0) return canonicalManualExpenseChannel(operation?.fromChannel || operation?.toChannel || "");
    if (amount > 0) return canonicalManualExpenseChannel(operation?.toChannel || operation?.fromChannel || "");
    return canonicalManualExpenseChannel(operation?.fromChannel || operation?.toChannel || "");
  }
  return canonicalManualExpenseChannel(operation?.fromChannel || operation?.toChannel || "");
}

function mapOperationToLegacyAmount(operation, category) {
  const amount = parseNumberString(operation?.amount);
  if (!Number.isFinite(amount) || !category) return null;
  if (category === "serviceIncome") return Math.abs(amount);
  if (category === "exchange") return amount;
  return Math.abs(amount);
}

function buildOperationsPivotByDateChannel(operations) {
  const grouped = new Map();
  for (const operation of operations || []) {
    const channel = mapOperationToLegacyChannel(operation);
    const amount = parseNumberString(operation?.amount);
    if (!channel || !Number.isFinite(amount)) continue;
    const key = `${operation.date}|${channel}`;
    const current = grouped.get(key) || { date: operation.date, channel, amount: 0, amountUsd: 0 };
    current.amount += amount;
    current.amountUsd += parseNumberString(operation?.amountUsd);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((left, right) =>
    left.date === right.date ? left.channel.localeCompare(right.channel) : left.date.localeCompare(right.date)
  );
}

function buildOperationsPivotByCategory(operations) {
  const grouped = new Map();
  for (const operation of operations || []) {
    const category = mapOperationToLegacyCategory(operation);
    const amount = mapOperationToLegacyAmount(operation, category);
    if (!category || amount === null) continue;
    const current = grouped.get(category) || { category, amount: 0, amountUsd: 0, count: 0 };
    current.amount += amount;
    current.amountUsd += parseNumberString(operation?.amountUsd);
    current.count += 1;
    grouped.set(category, current);
  }
  return Array.from(grouped.values()).sort((left, right) => left.category.localeCompare(right.category));
}

function parseBalanceRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата", "date"]);
  const channelIndex = findHeaderIndex(header, ["канал", "account", "channel"]);
  const amountIndex = findHeaderIndex(header, ["сумма", "amount"]);
  if (dateIndex === -1 || channelIndex === -1 || amountIndex === -1) return [];
  const currencyIndex = findHeaderIndex(header, ["валюта", "currency"]);
  const rateIndex = findHeaderIndex(header, ["курс", "rate"]);
  const usdIndex = findHeaderIndex(header, ["сумма_usd", "usd amount", "usdAmount"]);
  const commentIndex = findHeaderIndex(header, ["комментарий", "comment"]);
  return rows
    .map((row) => {
      const channel = String(row[channelIndex] || "").trim();
      const amount = String(row[amountIndex] || "").trim();
      return {
        date: normalizeDate(row[dateIndex]),
        channel,
        accountName: channel,
        amount,
        balanceAmount: amount,
        currency: currencyIndex === -1 ? "" : String(row[currencyIndex] || "").trim(),
        rate: rateIndex === -1 ? "" : String(row[rateIndex] || "").trim(),
        usdAmount: usdIndex === -1 ? "" : String(row[usdIndex] || "").trim(),
        comment: commentIndex === -1 ? "" : String(row[commentIndex] || "").trim(),
        source: "manual-google-sheets",
      };
    })
    .filter((row) => row.date && row.channel && row.amount);
}

function parseTransferRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата перевода", "date"]);
  const whoIndex = findHeaderIndex(header, ["кто", "who"]);
  const amountIndex = findHeaderIndex(header, ["сумма", "amount"]);
  const currencyIndex = findHeaderIndex(header, ["валюта", "currency"]);
  const channelIndex = findHeaderIndex(header, ["канал куда", "channel", "destination"]);
  const rateIndex = findHeaderIndex(header, ["курс", "rate"]);
  const usdIndex = findHeaderIndex(header, ["сумма в долларах", "usd amount", "usdAmount"]);
  if (dateIndex === -1 || amountIndex === -1 || channelIndex === -1) return [];
  return rows
    .map((row) => ({
      transferDate: normalizeDate(row[dateIndex]),
      who: whoIndex === -1 ? "" : String(row[whoIndex] || "").trim(),
      amount: String(row[amountIndex] || "").trim(),
      currency: currencyIndex === -1 ? "" : String(row[currencyIndex] || "").trim(),
      channel: String(row[channelIndex] || "").trim(),
      rate: rateIndex === -1 ? "" : String(row[rateIndex] || "").trim(),
      usdAmount: usdIndex === -1 ? "" : String(row[usdIndex] || "").trim(),
    }))
    .filter((row) => row.transferDate && row.channel && row.amount);
}

function parseCommissionRows(values) {
  const { header, rows } = splitHeaderRows(values);
  const dateIndex = findHeaderIndex(header, ["дата", "date"]);
  const channelIndex = findHeaderIndex(header, ["канал", "channel"]);
  const usdIndex = findHeaderIndex(header, ["сумма в долларах", "usd amount", "usdAmount"]);
  const commentIndex = findHeaderIndex(header, ["комментарий", "comment"]);
  if (dateIndex === -1 || channelIndex === -1 || usdIndex === -1) return [];
  return rows
    .map((row) => ({
      date: normalizeDate(row[dateIndex]),
      channel: String(row[channelIndex] || "").trim(),
      usdAmount: String(row[usdIndex] || "").trim(),
      comment: commentIndex === -1 ? "" : String(row[commentIndex] || "").trim(),
    }))
    .filter((row) => row.date && row.channel && row.usdAmount);
}

function splitHeaderRows(values) {
  const headerIndex = (values || []).findIndex((row) => {
    const normalized = (row || []).map((cell) => normalizeCell(cell));
    return normalized.includes("дата") || normalized.includes("date") || normalized.includes("дата перевода");
  });
  if (headerIndex === -1) return { header: [], rows: [] };
  return {
    header: values[headerIndex] || [],
    rows: values.slice(headerIndex + 1).filter((row) => (row || []).some((cell) => String(cell || "").trim())),
  };
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = new Set((aliases || []).map((alias) => normalizeCell(alias)));
  return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const isoDatePrefix = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  if (isoDatePrefix) return isoDatePrefix[1];
  const display = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (display) return `${display[3]}-${display[2]}-${display[1]}`;
  if (/^\d{5}$/.test(raw)) {
    const date = new Date((Number(raw) - 25569) * 86400 * 1000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  return "";
}

function parseNumberString(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatNumberString(value) {
  return value ? String(value).replace(".", ",") : "";
}
