import {
  buildProviderImportCoverage,
  detectPossibleFeeDoubleCount,
  detectProviderDuplicateRows,
  validateBalanceAfterChain
} from "./server/provider-import-diagnostics.js";

const UAH_USD_FALLBACK_RATE = 1 / 43.86;

const PRIVAT_CHANNEL_BY_CURRENCY = {
  USD: "приват 24-дол",
  EUR: "приват 24-евро",
  UAH: "приват 24-грн"
};

export function parsePrivatStatement(input) {
  return parsePrivatStatementWithDiagnostics(input).ledgerRows;
}

export function parsePrivatStatementWithDiagnostics(input, options = {}) {
  const rows = extractInputRows(input);
  const normalizedByInput = rows.map((row, index) => normalizePrivatLedgerRows(row, index));
  const parsedRows = normalizedByInput.flat();
  const ledgerRows = parsedRows.filter((row) => row.date && row.amount);
  const skippedRows = normalizedByInput
    .map((items, index) => ({ input: rows[index], items }))
    .filter(({ items }) => !items.some((row) => row.date && row.amount))
    .map(({ input }) => input);
  const needsReviewRows = ledgerRows.filter((row) => row.review_status === "needs_review");
  const duplicateRows = detectProviderDuplicateRows(ledgerRows);
  const balanceChain = validateBalanceAfterChain(sortPrivatRowsForBalanceChain(ledgerRows), {
    amountKey: "amount",
    balanceAfterKey: "balance_after",
    previousBalance: firstNonEmpty(options.previousBalance, options.openingBalance, options.opening_balance)
  });
  const feeDoubleCount = detectPossibleFeeDoubleCount(ledgerRows);
  const parserWarnings = buildPrivatParserWarnings({
    needsReviewRows,
    duplicateRows,
    balanceChain,
    feeDoubleCount
  });
  const coverage = buildProviderImportCoverage({
    provider: "privatbank",
    source: "privat24",
    inputRows: rows,
    parsedRows,
    ledgerRows,
    skippedRows,
    duplicateRows,
    needsReviewRows,
    parserWarnings,
    channel: inferPrivatCoverageChannel(ledgerRows),
    currency: inferPrivatCoverageCurrency(ledgerRows),
    periodFrom: options.periodFrom,
    periodTo: options.periodTo
  });
  const diagnostics = {
    coverage,
    balance_chain: balanceChain,
    duplicate_rows: duplicateRows,
    fee_double_count: feeDoubleCount
  };
  return {
    inputRows: rows,
    parsedRows,
    ledgerRows,
    skippedRows,
    diagnostics,
    warnings: coverage.parser_warnings
  };
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
  const date = normalizeDate(firstNonEmpty(row.date, row.operationDate, row.operation_date, row.trandate, row.dat_od, row.time, row.дата, row["Дата операції"], row["Дата операции"], row["Дата"]));
  const description = firstNonEmpty(row.description, row.purpose, row.nazn, row.paymentPurpose, row.details, row.info, row["Опис операції"], row["Описание операции"], row["Описание"], row["Назначение платежа"], row["Детали операции"]);
  const counterparty = firstNonEmpty(row.counterparty, row.counterpartyName, row.name, row.contragentName, row.AUT_MY_NAM, row.merchant, row.merchantName, row["Контрагент"], row["Получатель"], row["Отправитель"]);
  const amount = parseSignedAmount(row);
  const externalId = firstNonEmpty(
    row.external_id,
    row.externalId,
    row.id,
    row.transactionId,
    row.ref,
    row.reference,
    row.trn_id,
    row.docNumber,
    row.operation_number,
    row.card && date && amount ? `privat-${date}-${String(row.card).replace(/\s+/g, "")}-${formatNumber(amount)}-${index}` : "",
    `privat-${date || "unknown"}-${index}`
  );
  if (looksLikeExchange(row, description)) return buildExchangeRows(row, { date, description, counterparty, externalId });

  const currency = normalizeCurrency(firstNonEmpty(row.currency, row.ccy, row.currencyCode, row.cardCurrency, row.card_currency, row.accountCurrency, row["Валюта"], row["Валюта картки"], row["Валюта карты"]));
  const direction = inferDirection(row, amount);
  const channel = getPrivatChannel(currency);
  const transfer = looksLikeOwnTransfer(row, description);
  const needsReview = !transfer && looksAmbiguous(row, description);
  const category = direction === "income" ? "servicein" : (transfer ? "partner" : (needsReview ? "extra" : inferCategory(row)));
  const operation = transfer ? "partner_transfer" : (needsReview ? "correction" : (direction === "income" ? "income" : (category === "business" ? "business_expense" : "personal_expense")));
  const reviewPrefix = needsReview ? "needs_review: " : "";
  const feeAmount = Math.abs(parseBankNumber(firstNonEmpty(row.fee, row.commission, row["Комиссия"], row["Комісія"])));
  const statementBalanceAfter = parseOptionalBankNumber(firstNonEmpty(row.balance_after, row.balanceAfter, row.closing_balance, row["Залишок на кінець періоду"]));
  const comment = [
    `${reviewPrefix}${description}`.trim(),
    statementBalanceAfter !== null ? `statement balance after: ${formatNumber(statementBalanceAfter)} ${currency}` : ""
  ].filter(Boolean).join(" | ");
  return [{
    date,
    operation,
    from_channel: direction === "income" ? "" : channel,
    to_channel: direction === "income" ? channel : "",
    amount: formatNumber(Math.abs(amount)),
    currency,
    amount_usd: formatNumber(convertToUsd(Math.abs(amount), currency, row)),
    category,
    subcategory: "",
    direction: direction === "income" ? "in" : (needsReview ? "neutral" : "out"),
    comment,
    counterparty,
    description,
    source: "privat24",
    external_id: externalId,
    raw_source_id: externalId,
    transfer_group_id: transfer ? externalId : "",
    review_status: needsReview ? "needs_review" : "",
    fee_amount: feeAmount ? formatNumber(feeAmount) : "",
    fee_currency: feeAmount ? currency : "",
    balance_after: statementBalanceAfter !== null ? formatNumber(statementBalanceAfter) : "",
    provider_balance_after: statementBalanceAfter !== null ? formatNumber(statementBalanceAfter) : ""
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
      source: "privat24",
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
      source: "privat24",
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
  const headerIndex = lines.findIndex((line) => looksLikeHeaderLine(line));
  if (headerIndex < 0 || headerIndex >= lines.length - 1) return [];
  const delimiter = detectDelimiter(lines[headerIndex]);
  const header = splitCsvLine(lines[headerIndex], delimiter).map(normalizeHeader);
  return lines.slice(headerIndex + 1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    return Object.fromEntries(header.map((name, index) => [name, cells[index] || ""]));
  });
}

function looksLikeHeaderLine(line) {
  const delimiter = detectDelimiter(line);
  const header = splitCsvLine(line, delimiter).map(normalizeHeader);
  return header.includes("date") && (header.includes("amount") || header.includes("description") || header.includes("balance_after"));
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
    дата_операции: "date",
    дата_операції: "date",
    дата: "date",
    trandate: "date",
    dat_od: "date",
    сумма: "amount",
    сума: "amount",
    сумма_операции: "amount",
    сума_операції: "amount",
    сумма_в_валюте_карты: "amount",
    сума_в_валюті_картки: "amount",
    сума_у_валюті_картки: "amount",
    сумма_в_валюте_картки: "amount",
    сума_в_валюте_карты: "amount",
    amount_in_card_currency: "amount",
    сумма_в_валюте_транзакции: "transaction_amount",
    сума_в_валюті_транзакції: "transaction_amount",
    amount_in_transaction_currency: "transaction_amount",
    suma: "amount",
    sum: "amount",
    расход: "debit",
    витрати: "debit",
    дебет: "debit",
    приход: "credit",
    надходження: "credit",
    кредит: "credit",
    ccy: "currency",
    валюта: "currency",
    валюта_карты: "currency",
    валюта_картки: "currency",
    валюта_транзакції: "transaction_currency",
    валюта_транзакции: "transaction_currency",
    назначение_платежа: "description",
    описание: "description",
    опис: "description",
    опис_операції: "description",
    описание_операции: "description",
    детали_операции: "description",
    purpose: "description",
    nazn: "description",
    категорія: "statement_category",
    категория: "statement_category",
    картка: "card",
    карта: "card",
    контрагент: "counterparty",
    получатель: "counterparty",
    отправитель: "counterparty",
    contragent_name: "counterparty",
    залишок_на_кінець_періоду: "balance_after",
    остаток_на_конец_периода: "balance_after",
    balance_after_operation: "balance_after",
    валюта_залишку: "balance_currency",
    валюта_остатка: "balance_currency",
    ref: "external_id",
    номер_операции: "external_id",
    id_операции: "external_id",
    номер_операції: "external_id",
    id_операції: "external_id",
    комиссия: "fee",
    комісія: "fee"
  };
  return aliases[token] || token;
}

function looksLikeExchange(row, description = "") {
  const text = normalizeText([description, row.type, row.operationType, row.trantype, row.category, row.statement_category].join(" "));
  if (/обмiн|обмін|обмен|exchange|конвертац|купiвля валюти|купівля валюти|продаж валюти/.test(text)) return true;
  return Boolean(firstNonEmpty(row.toAmount, row.buyAmount, row.inAmount, row.receivedAmount) && firstNonEmpty(row.fromAmount, row.sellAmount, row.outAmount, row.amount));
}

function looksLikeOwnTransfer(row, description = "") {
  const text = normalizeText([description, row.type, row.operationType, row.category, row.statement_category].join(" "));
  return /между своими|між своїми|власн|own account|between own|transfer between/.test(text);
}

function looksAmbiguous(row, description = "") {
  const text = normalizeText([description, row.type, row.operationType, row.category, row.statement_category].join(" "));
  if (/невідом|неизвест|unknown|manual review|needs review/.test(text)) return true;
  return !text && !firstNonEmpty(row.counterparty, row.counterpartyName, row.name, row.merchantName);
}

function inferDirection(row, amount) {
  const raw = normalizeText(firstNonEmpty(row.direction, row.type, row.trantype, row.operationType));
  if (/credit|income|in|c|приход|кредит/.test(raw)) return "income";
  if (/debit|expense|out|d|расход|дебет/.test(raw)) return "expense";
  return Number(amount) < 0 ? "expense" : "income";
}

function parseSignedAmount(row) {
  const explicit = firstNonEmpty(row.amount, row.card_amount, row.sum, row.value, row.amt, row["Сумма операции"], row["Сума операції"]);
  if (explicit) return parseBankNumber(explicit);
  const debit = parseBankNumber(firstNonEmpty(row.debit, row["Дебет"], row["Расход"]));
  if (debit) return -Math.abs(debit);
  const credit = parseBankNumber(firstNonEmpty(row.credit, row["Кредит"], row["Приход"]));
  if (credit) return Math.abs(credit);
  return 0;
}

function inferCategory(row) {
  const text = normalizeText([row.description, row.purpose, row.mcc, row.statement_category].filter(Boolean).join(" "));
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

function parseOptionalBankNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = parseBankNumber(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
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

function buildPrivatParserWarnings({ needsReviewRows = [], duplicateRows = [], balanceChain = {}, feeDoubleCount = {} } = {}) {
  const warnings = [];
  for (const row of needsReviewRows) {
    warnings.push(`${row.external_id || row.raw_source_id}: needs_review`);
  }
  for (const duplicate of duplicateRows) {
    warnings.push(`duplicate row: ${duplicate.key}`);
  }
  if (balanceChain.balance_chain_gap && balanceChain.first_gap_row) {
    warnings.push(`balance chain gap at ${balanceChain.first_gap_row.row_id || balanceChain.first_gap_row.date}: expected ${balanceChain.first_gap_row.expected_balance_after}, provider ${balanceChain.first_gap_row.provider_balance_after}`);
  }
  if (feeDoubleCount.likely_fee_double_count) {
    warnings.push("possible fee double-count: statement contains total debit and matching principal+fee split rows");
  }
  return [...new Set(warnings)];
}

function sortPrivatRowsForBalanceChain(rows = []) {
  return [...rows].sort((left, right) => {
    const leftDate = String(left.date || "");
    const rightDate = String(right.date || "");
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left.external_id || left.raw_source_id || "").localeCompare(String(right.external_id || right.raw_source_id || ""));
  });
}

function inferPrivatCoverageChannel(rows = []) {
  const channels = [...new Set(rows.map((row) => firstNonEmpty(row.from_channel, row.to_channel)).filter(Boolean))];
  return channels.length === 1 ? channels[0] : "";
}

function inferPrivatCoverageCurrency(rows = []) {
  const currencies = [...new Set(rows.map((row) => String(row.currency || "").trim().toUpperCase()).filter(Boolean))];
  return currencies.length === 1 ? currencies[0] : "";
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
