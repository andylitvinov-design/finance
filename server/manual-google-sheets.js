import { createSign } from "node:crypto";
import LEDGER_CONTRACT from "../manual-ledger-contract.js";
import {
  MANUAL_LEDGER_HEADERS,
  mapLedgerCategoryToLegacy,
  normalizeManualLedgerCategory,
  normalizeManualLedgerChannel,
  normalizeManualLedgerDirection,
  normalizeManualLedgerOperation,
  resolveManualLedgerSource,
} from "./manual-ledger-maps.js";
import {
  countExchangeMissingAmountUsdRows,
  countMissingAmountNetRows,
  isExchangeMissingAmountUsdRow,
} from "./ledger-audit-helpers.js";

export const MANUAL_SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";

const EXPENSE_SHEET_NAME = "Расходы";
const LEDGER_SHEET_NAME = "Ledger";
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
  "category"
];
const FALLBACK_USD_RATES = {
  RUB: 1 / 84.5563,
  UAH: 1 / 43.86,
  EUR: 1.16,
  CAD: 0.74,
  LOCAL: 1 / 18,
};

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
  const mapped = normalizeManualLedgerChannel(raw, MANUAL_FINANCE_CHANNELS);
  if (mapped) return mapped;
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
    { pattern: /^(binance save|бинанс save|binance savings|бинанс сейв)$/, channel: "binance save" },
  ];
  const match = aliases.find((entry) => entry.pattern.test(normalized));
  return match?.channel || raw;
}

function canonicalManualExpenseChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
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
      sheetNames: [LEDGER_SHEET_NAME, EXPENSE_SHEET_NAME, BALANCE_SHEET_NAME, TRANSFER_SHEET_NAME, COMMISSION_SHEET_NAME],
      accessToken,
      fetchImpl,
    });
    const transfers = parseTransferRows(valuesBySheet[TRANSFER_SHEET_NAME] || []);
    const rateLookup = buildOperationUsdRateLookup(transfers);
    const ledgerValues = valuesBySheet[LEDGER_SHEET_NAME] || [];
    const ledgerRepository = ledgerValues.length ? parseExpenseRepository(ledgerValues, rateLookup) : buildEmptyLedgerRepository();
    const legacyRepository = parseExpenseRepository(valuesBySheet[EXPENSE_SHEET_NAME] || [], rateLookup);
    const legacyHasRows = legacyRepository.schema === "legacy-expense-grid" && legacyRepository.expenseRows.length > 0;
    const warnings = [];
    if (!ledgerRepository.operations.length && legacyHasRows) {
      warnings.push("legacy Расходы ignored: Ledger is the only operations source.");
    }
    return {
      ok: true,
      spreadsheetId: MANUAL_SPREADSHEET_ID,
      ...ledgerRepository,
      balances: parseBalanceRows(valuesBySheet[BALANCE_SHEET_NAME] || []),
      transfers,
      commissionRows: parseCommissionRows(valuesBySheet[COMMISSION_SHEET_NAME] || []),
      warnings: [...(ledgerRepository.warnings || []), ...warnings],
      fallbackSchema: null,
    };
  } catch (error) {
    return {
      ok: false,
      warning: `Manual Google Sheets overlay failed: ${String(error?.message || error)}`,
    };
  }
}

export async function probeGoogleSheetAccess({ fetchImpl = fetch } = {}) {
  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const hasEmail = Boolean(clientEmail);
  const hasPrivateKey = Boolean(privateKey);
  const keyLooksPem = hasPemEnvelope(privateKey);
  const configured = hasEmail && hasPrivateKey && keyLooksPem;
  const result = {
    configured,
    hasEmail,
    hasPrivateKey,
    keyLooksPem,
    authClientCreated: false,
    readOk: false,
    rowCount: 0,
    error: null,
  };

  if (!hasEmail || !hasPrivateKey) {
    result.error = "service_account_credentials_missing";
    return result;
  }
  if (!keyLooksPem) {
    result.error = "service_account_private_key_invalid_pem";
    return result;
  }

  try {
    const accessToken = await requestServiceAccountAccessToken({ clientEmail, privateKey, fetchImpl });
    result.authClientCreated = true;
    const values = await readSheetProbeRow({
      spreadsheetId: MANUAL_SPREADSHEET_ID,
      accessToken,
      fetchImpl,
    });
    result.readOk = true;
    result.rowCount = values.length;
    return result;
  } catch (error) {
    result.error = toSafeGoogleError(error);
    return result;
  }
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function hasPemEnvelope(privateKey) {
  return privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
    && privateKey.endsWith("-----END PRIVATE KEY-----");
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
  sheetNames.forEach((name) => {
    const escaped = name.replace(/'/g, "''");
    const range = name === LEDGER_SHEET_NAME ? `'${escaped}'!A:V` : `'${escaped}'`;
    url.searchParams.append("ranges", range);
  });
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

async function readSheetProbeRow({ spreadsheetId, accessToken, fetchImpl }) {
  const escaped = LEDGER_SHEET_NAME.replace(/'/g, "''");
  const range = encodeURIComponent(`'${escaped}'!A1:V2`);
  const response = await fetchImpl(`${SHEETS_API_BASE}/spreadsheets/${spreadsheetId}/values/${range}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Sheets probe failed with HTTP ${response.status}`);
  }
  return payload.values || [];
}

function toSafeGoogleError(error) {
  const message = String(error?.message || error || "google_sheet_probe_failed").trim();
  if (!message) return "google_sheet_probe_failed";
  const clientEmail = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const emailPattern = clientEmail ? new RegExp(escapeRegExp(clientEmail), "g") : null;
  return message
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, "[redacted-private-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(emailPattern || /\b\B/g, "[redacted-service-account-email]")
    .slice(0, 500);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSheetTitle(range) {
  const raw = String(range || "");
  const match = raw.match(/^'((?:[^']|'')+)'!/);
  if (match) return match[1].replace(/''/g, "'");
  return raw.split("!")[0].replace(/^'|'$/g, "");
}

function parseExpenseRepository(values, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const headerState = getNormalizedLedgerHeaderState(values);
  if (headerState === "empty") {
    return buildEmptyLedgerRepository();
  }
  const normalizedOperations = parseNormalizedOperationRows(values, rateLookup);
  if (normalizedOperations) {
    const ledgerV2Rows = normalizedOperations.map((row) => row.ledgerV2).filter(Boolean);
    const warnings = buildLedgerV2RepositoryWarnings(normalizedOperations, values);
    const fallbackAmountRows = countMissingAmountNetRows(normalizedOperations);
    return {
      schema: hasLedgerV2Header(values) ? "ledger-v2-compatible" : "ledger-v1",
      operations: normalizedOperations,
      ledgerV2Rows,
      warnings,
      expenseRows: buildLegacyExpenseRowsFromOperations(normalizedOperations),
      views: {
        fallback_amount_rows: 0,
        missing_amount_net_rows: fallbackAmountRows,
        excluded_missing_amount_net_rows: fallbackAmountRows,
        exchange_missing_amount_usd_rows: countExchangeMissingAmountUsdRows(normalizedOperations),
        byDateChannel: buildOperationsPivotByDateChannel(normalizedOperations),
        byCategory: buildOperationsPivotByCategory(normalizedOperations),
      },
    };
  }
  return {
    schema: "legacy-expense-grid",
    operations: [],
    ledgerV2Rows: [],
    warnings: ["Ledger v2 physical columns need verification: legacy expense grid fallback is active."],
    expenseRows: parseLegacyExpenseRows(values),
    views: null,
  };
}

function buildEmptyLedgerRepository() {
  return {
    schema: "ledger-v1-empty",
    operations: [],
    expenseRows: [],
    views: {
      fallback_amount_rows: 0,
      missing_amount_net_rows: 0,
      excluded_missing_amount_net_rows: 0,
      exchange_missing_amount_usd_rows: 0,
      byDateChannel: [],
      byCategory: [],
    },
  };
}

function getNormalizedLedgerHeaderState(values) {
  const { header, rows } = splitHeaderRows(values);
  if (!looksLikeNormalizedOperationsHeader(header)) return "";
  const hasDataRows = rows.some((row) => row.some((cell) => String(cell || "").trim()));
  return hasDataRows ? "data" : "empty";
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

function parseNormalizedOperationRows(values, rateLookup = { byChannel: {}, byCurrency: {} }) {
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
    amountGross: findHeaderIndex(header, ["amount_gross", "amount gross", "client_paid", "client paid", "gross"]),
    amountFee: findHeaderIndex(header, ["amount_fee", "amount fee", "provider_fee", "provider fee", "fee"]),
    amountNet: findHeaderIndex(header, ["amount_net", "amount net", "net_received", "net received", "net"]),
    rate: findHeaderIndex(header, ["rate", "курс"]),
    category: findHeaderIndex(header, ["category", "категория"]),
    subcategory: findHeaderIndex(header, ["subcategory", "подкатегория"]),
    direction: findHeaderIndex(header, ["direction", "направление"]),
    comment: findHeaderIndex(header, ["comment", "комментарий"]),
    counterparty: findHeaderIndex(header, ["counterparty", "контрагент", "от кого / кому"]),
    description: findHeaderIndex(header, ["description", "описание", "details"]),
    source: findHeaderIndex(header, ["source", "источник"]),
    rawSourceId: findHeaderIndex(header, ["raw_source_id", "raw source id", "source transaction id", "external_id", "external id"]),
    externalId: findHeaderIndex(header, ["external_id", "external id"]),
    transferGroupId: findHeaderIndex(header, ["transfer_group_id", "exchange_group_id", "transfer group id"]),
    createdAt: findHeaderIndex(header, ["created_at", "created at"]),
    updatedAt: findHeaderIndex(header, ["updated_at", "updated at"]),
  };
  return rows
    .map((row) => {
      const category = normalizeOperationCategory(row[indexes.category]);
      let operation = normalizeOperation(row[indexes.operation], category);
      const rawOperation = normalizeLookupText(row[indexes.operation]);
      if ((rawOperation === "exchange" || rawOperation === "обмен") && category === "exchange") {
        operation = parseNumberString(row[indexes.amount]) > 0 ? "exchange_in" : "exchange_out";
      }
      const operationRow = {
        date: normalizeDate(row[indexes.date]),
        operation,
        fromChannel: canonicalManualFinanceChannel(row[indexes.fromChannel]),
        toChannel: canonicalManualFinanceChannel(row[indexes.toChannel]),
        amount: String(row[indexes.amount] || "").trim(),
        currency: String(row[indexes.currency] || "").trim().toUpperCase(),
        amountUsd: String(row[indexes.amountUsd] || "").trim(),
        amountGross: indexes.amountGross === -1 ? "" : String(row[indexes.amountGross] || "").trim(),
        amountFee: indexes.amountFee === -1 ? "" : String(row[indexes.amountFee] || "").trim(),
        amountNet: indexes.amountNet === -1 ? "" : String(row[indexes.amountNet] || "").trim(),
        rate: indexes.rate === -1 ? "" : String(row[indexes.rate] || "").trim(),
        category,
        subcategory: String(row[indexes.subcategory] || "").trim(),
        direction: normalizeManualLedgerDirection(row[indexes.direction], operation),
        comment: String(row[indexes.comment] || "").trim(),
        counterparty: String(row[indexes.counterparty] || "").trim(),
        description: String(row[indexes.description] || "").trim(),
        source: resolveManualLedgerSource(
          indexes.source === -1 ? "" : row[indexes.source],
          row[indexes.rawSourceId],
          "",
          {
            fromChannel: row[indexes.fromChannel],
            toChannel: row[indexes.toChannel],
          }
        ),
        rawSourceId: String(row[indexes.rawSourceId] || "").trim(),
        externalId: indexes.externalId === -1 ? "" : String(row[indexes.externalId] || "").trim(),
        transferGroupId: String(row[indexes.transferGroupId] || "").trim(),
        createdAt: String(row[indexes.createdAt] || "").trim(),
        updatedAt: String(row[indexes.updatedAt] || "").trim(),
      };
      operationRow.amountUsd = formatNumberString(deriveOperationUsdAmount(operationRow, rateLookup));
      const ledgerV2 = LEDGER_CONTRACT.normalizeLedgerRow({
        ...operationRow,
        operation,
        amount_usd: operationRow.amountUsd,
        amount_gross: operationRow.amountGross,
        amount_fee: operationRow.amountFee,
        amount_net: operationRow.amountNet,
        external_id: operationRow.externalId || operationRow.rawSourceId,
        raw_source_id: operationRow.rawSourceId,
      }, { rateLookup });
      operationRow.ledgerV2 = ledgerV2;
      operationRow.amountGross = ledgerV2.amount_gross;
      operationRow.amountFee = ledgerV2.amount_fee;
      operationRow.amountNet = ledgerV2.amount_net;
      operationRow.amount_gross = ledgerV2.amount_gross;
      operationRow.amount_fee = ledgerV2.amount_fee;
      operationRow.amount_net = ledgerV2.amount_net;
      operationRow.external_id = ledgerV2.external_id;
      operationRow.balanceAmount = ledgerV2.balance_amount;
      return operationRow;
    })
    .filter((row) => row.date && row.operation && (row.fromChannel || row.toChannel) && String(row.amount || "").trim());
}

function hasLedgerV2Header(values) {
  const { header } = splitHeaderRows(values);
  const normalizedHeader = new Set((header || []).map((cell) => normalizeCell(cell)));
  return ["amount_gross", "amount_fee", "amount_net", "external_id"].some((name) => normalizedHeader.has(name));
}

function buildLedgerV2RepositoryWarnings(operations, values) {
  const warnings = [];
  const ledgerV2Header = hasLedgerV2Header(values);
  if (!ledgerV2Header) {
    warnings.push("Ledger v2 physical columns need verification: current Sheet is Ledger v1; v2 rows are not used for balance until amount_net exists.");
  }
  const fallbackCount = countMissingAmountNetRows(operations);
  if (fallbackCount) {
    warnings.push(`Ledger v2 error: ${fallbackCount} row(s) have empty amount_net; balance was not calculated.`);
  }
  const exchangeMissingUsd = (operations || []).filter(isExchangeMissingAmountUsdRow).length;
  if (exchangeMissingUsd) {
    warnings.push(`Ledger v2 warning: ${exchangeMissingUsd} exchange row(s) have empty amount_usd; USD exchange totals skipped for those rows.`);
  }
  return warnings;
}

function looksLikeNormalizedOperationsHeader(header) {
  const normalizedHeader = (header || []).map((cell) => normalizeCell(cell));
  return NORMALIZED_OPERATION_HEADERS.every((key) => normalizedHeader.includes(normalizeCell(key)));
}

function normalizeOperation(value, category = "") {
  return normalizeManualLedgerOperation(value, category);
}

function normalizeOperationCategory(value) {
  const normalized = normalizeLookupText(value);
  if (/^(now|остаток сейчас|стало)$/.test(normalized)) return "now";
  if (/^(commission|комиссия)$/.test(normalized)) return "commission";
  return normalizeManualLedgerCategory(value, "extra");
}

function buildLegacyExpenseRowsFromOperations(operations) {
  const grouped = new Map();
  for (const operation of operations || []) {
    const category = mapOperationToLegacyCategory(operation);
    if (category === "serviceIncome" && !shouldIncludeServiceIncomeInExpenseRows(operation)) continue;
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

function shouldIncludeServiceIncomeInExpenseRows(operation) {
  const source = String(operation?.source || "").trim().toLowerCase();
  if (!source) return true;
  return ["manual", "fact", "migration"].includes(source);
}

function mapOperationToLegacyCategory(operation) {
  const category = normalizeOperationCategory(operation?.category);
  const normalizedOperation = normalizeOperation(operation?.operation, category);
  if (category === "now") return "now";
  if (category === "commission") return "commission";
  if (category === "exchange" || normalizedOperation === "exchange_in" || normalizedOperation === "exchange_out") return "exchange";
  if (normalizedOperation === "income") return mapLedgerCategoryToLegacy(category || "servicein");
  if (normalizedOperation === "expense" || normalizedOperation === "business_expense" || normalizedOperation === "personal_expense") return mapLedgerCategoryToLegacy(category || "business");
  if (normalizedOperation === "partner_transfer") return mapLedgerCategoryToLegacy("partner");
  if (category) return mapLedgerCategoryToLegacy(category);
  return "";
}

function mapOperationToLegacyChannel(operation) {
  const category = mapOperationToLegacyCategory(operation);
  if (!category) return "";
  const amount = parseNumberString(operation?.amount);
  const operationName = normalizeOperation(operation?.operation, operation?.category);
  if (category === "serviceIncome") return canonicalManualExpenseChannel(operation?.toChannel || operation?.fromChannel || "");
  if (category === "exchange") {
    if (operationName === "exchange_out") return canonicalManualExpenseChannel(operation?.fromChannel || operation?.toChannel || "");
    if (operationName === "exchange_in") return canonicalManualExpenseChannel(operation?.toChannel || operation?.fromChannel || "");
    if (amount < 0) return canonicalManualExpenseChannel(operation?.fromChannel || operation?.toChannel || "");
    if (amount > 0) return canonicalManualExpenseChannel(operation?.toChannel || operation?.fromChannel || "");
    return canonicalManualExpenseChannel(operation?.fromChannel || operation?.toChannel || "");
  }
  return canonicalManualExpenseChannel(operation?.fromChannel || operation?.toChannel || "");
}

function mapOperationToLegacyAmount(operation, category) {
  const amount = getOperationBalanceAmount(operation);
  if (!Number.isFinite(amount) || !category) return null;
  if (category === "serviceIncome") return Math.abs(amount);
  if (category === "exchange") {
    const operationName = normalizeOperation(operation?.operation, operation?.category);
    if (operationName === "exchange_out") return -Math.abs(amount);
    if (operationName === "exchange_in") return Math.abs(amount);
    return amount;
  }
  return Math.abs(amount);
}

function buildOperationsPivotByDateChannel(operations) {
  const grouped = new Map();
  for (const operation of operations || []) {
    const channel = mapOperationToLegacyChannel(operation);
    const amount = getOperationBalanceAmount(operation);
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

function getOperationBalanceAmount(operation) {
  const value = operation?.ledgerV2?.balance_amount ?? operation?.balanceAmount;
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
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

function buildOperationUsdRateLookup(transfers) {
  const byChannel = {};
  const byCurrency = {};
  for (const row of transfers || []) {
    const amount = Math.abs(parseNumberString(row?.amount));
    const usdAmount = Math.abs(parseNumberString(row?.usdAmount));
    if (!amount || !usdAmount) continue;
    const channel = canonicalManualFinanceChannel(row?.channel || row?.destination || "");
    const currency = String(row?.currency || inferChannelCurrency(channel)).trim().toUpperCase();
    const usdPerLocal = usdAmount / amount;
    if (channel) addUsdRate(byChannel, channel, usdPerLocal);
    if (currency) addUsdRate(byCurrency, currency, usdPerLocal);
  }
  return {
    byChannel: averageUsdRates(byChannel),
    byCurrency: { ...FALLBACK_USD_RATES, ...averageUsdRates(byCurrency) },
  };
}

function addUsdRate(bucket, key, rate) {
  if (!key || !Number.isFinite(rate) || rate <= 0) return;
  if (!bucket[key]) bucket[key] = [];
  bucket[key].push(rate);
}

function averageUsdRates(bucket) {
  return Object.fromEntries(
    Object.entries(bucket).map(([key, values]) => [key, values.reduce((sum, value) => sum + value, 0) / values.length])
  );
}

function deriveOperationUsdAmount(operation, rateLookup = { byChannel: {}, byCurrency: {} }) {
  const rawExplicitUsd = String(operation?.amountUsd || "").trim();
  if (rawExplicitUsd) return normalizeExchangeUsdSign(parseNumberString(rawExplicitUsd), operation);
  const amount = parseNumberString(operation?.amount);
  if (!Number.isFinite(amount)) return 0;
  const operationName = normalizeOperation(operation?.operation, operation?.category);
  const channel = mapOperationToLegacyChannel(operation) || canonicalManualFinanceChannel(operation?.fromChannel || operation?.toChannel || "");
  const currency = String(operation?.currency || inferChannelCurrency(channel)).trim().toUpperCase();
  if (currency === "USD") {
    const net = parseNumberString(operation?.amountNet ?? operation?.amount_net ?? "");
    return normalizeExchangeUsdSign(Number.isFinite(net) && net ? net : amount, operation);
  }
  const explicitOrTransferRate = parseNumberString(operation?.rate) ||
    parseNumberString(rateLookup.byChannel?.[channel]) ||
    parseNumberString(rateLookup.byCurrency?.[currency]);
  if (operationName === "exchange_in" || operationName === "exchange_out") {
    return explicitOrTransferRate ? normalizeExchangeUsdSign(amount * explicitOrTransferRate, operation) : 0;
  }
  const rate = explicitOrTransferRate || FALLBACK_USD_RATES[currency] || FALLBACK_USD_RATES.LOCAL;
  return rate ? normalizeExchangeUsdSign(amount * rate, operation) : 0;
}

function normalizeExchangeUsdSign(amountUsd, operation) {
  const numeric = parseNumberString(amountUsd);
  const operationName = normalizeOperation(operation?.operation, operation?.category);
  if (operationName === "exchange_out") return -Math.abs(numeric);
  if (operationName === "exchange_in") return Math.abs(numeric);
  return numeric;
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
