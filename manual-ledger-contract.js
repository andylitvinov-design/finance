(function initManualLedgerContract(root, factory) {
  const contract = factory();
  if (typeof module === "object" && module.exports) module.exports = contract;
  if (root) root.EzohataManualLedgerContract = contract;
})(typeof globalThis !== "undefined" ? globalThis : this, function createManualLedgerContract() {
  const MANUAL_LEDGER_HEADERS = [
    "date",
    "operation",
    "from_channel",
    "to_channel",
    "amount",
    "currency",
    "amount_usd",
    "category",
    "subcategory",
    "direction",
    "comment",
    "counterparty",
    "description",
    "source",
    "external_id",
    "raw_source_id",
    "transfer_group_id",
    "created_at",
    "updated_at"
  ];

  const LEDGER_V2_COLUMNS = [
    "date",
    "operation",
    "from_channel",
    "to_channel",
    "amount",
    "currency",
    "amount_usd",
    "amount_gross",
    "amount_fee",
    "amount_net",
    "rate",
    "category",
    "source",
    "external_id",
    "comment"
  ];

  const MANUAL_LEDGER_OPERATIONS = [
    "income",
    "expense",
    "exchange_in",
    "exchange_out",
    "partner_transfer",
    "business_expense",
    "personal_expense",
    "correction"
  ];

  const MANUAL_LEDGER_DIRECTIONS = ["in", "out", "neutral"];
  const CANONICAL_LEDGER_CATEGORIES = [
    "servicein",
    "ezoin",
    "exchange",
    "partner",
    "business",
    "house",
    "food",
    "fun",
    "travel",
    "extra"
  ];

  const LEDGER_V2_OPERATIONS = [
    "income",
    "expense",
    "transfer",
    "exchange",
    "adjustment"
  ];
  const LEDGER_V2_CATEGORIES = [
    "service",
    "ezohata",
    "exchange",
    "partner",
    "business",
    "personal",
    "house",
    "food",
    "fun",
    "travel",
    "study",
    "adjustment",
    "other"
  ];
  const LEDGER_V2_SOURCES = [
    "manual",
    "fact",
    "paypal",
    "monobank",
    "td_bank",
    "wise",
    "google_sheets",
    "migration",
    "other"
  ];

  const CATEGORY_MAP = {
    servicein: [
      "service income",
      "serviceincome",
      "service in",
      "services",
      "service",
      "приход"
    ],
    ezoin: ["ezoin", "ezo in", "ezohata", "ezo", "ezofact"],
    exchange: [
      "обмен",
      "exchange",
      "exchange_usd",
      "exchange usd",
      "exchangeusd",
      "комиссии",
      "exchange_in",
      "exchange out",
      "exchange in"
    ],
    partner: ["partner", "partnertransfer", "partner transfer", "партнер", "партнеры"],
    business: ["spent for business", "business", "business expense", "бизнес"],
    house: [
      "spent for flat",
      "spent for house",
      "flat",
      "house",
      "rent",
      "квартира",
      "кварт",
      "дом",
      "аренда"
    ],
    food: ["spent for food", "food", "еда", "продукты"],
    fun: ["spent for fun", "fun", "events", "event", "beauty", "развлечения", "развлеч"],
    travel: [
      "spent for travel",
      "spent for study",
      "spent for travel/ fun",
      "travel",
      "travelfun",
      "travel fun",
      "travel study",
      "travel/study",
      "study",
      "учеба",
      "учеб",
      "обучение",
      "обуч",
      "курс",
      "школа",
      "путешествия",
      "путеш"
    ],
    extra: ["extra", "unclear", "other", "misc", "unknown", "прочее", "неясное"]
  };

  const LEGACY_CATEGORY_BY_CANONICAL = {
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
  };

  const CANONICAL_BY_LEGACY_CATEGORY = {
    serviceIncome: "servicein",
    flat: "house",
    study: "travel",
    travel: "travel",
    partnerTransfer: "partner",
    unclear: "extra"
  };

  const LEDGER_V2_CATEGORY_BY_LEGACY = {
    servicein: "service",
    serviceIncome: "service",
    ezoin: "ezohata",
    extra: "other",
    correction: "adjustment",
    flat: "house",
    study: "study",
    unclear: "other"
  };

  const LEDGER_V2_SOURCE_BY_LEGACY = {
    mcp: "other",
    photo: "other",
    paypal_mcp: "paypal",
    paypal: "paypal",
    wise: "wise",
    monobank: "monobank",
    tdbank: "td_bank",
    td_bank: "td_bank",
    fact: "fact",
    manual: "manual",
    google_sheets: "google_sheets",
    migration: "migration"
  };

  const CHANNEL_MAP = {
    "Яндекс руб": [
      "яндекс",
      "yandex",
      "yandex rub",
      "яндекс руб",
      "яндекс рубли",
      "yoomoney",
      "юmoney",
      "юмани"
    ],
    "пейпал дол": [
      "paypal",
      "paypal usd",
      "paypal dol",
      "пейпал",
      "пейпал дол",
      "пейпал usd"
    ],
    "пейпал евр": ["paypal eur", "paypal euro", "пейпал евр", "пейпал евро"],
    "пейпал сad": ["paypal cad", "пейпал cad", "пейпал сad", "paypal сad"],
    "приват 24-дол": ["privat usd", "privat 24 usd", "приват 24 дол", "приват 24-дол"],
    "приват 24-евро": ["privat eur", "privat 24 eur", "приват 24 евро", "приват 24-евро"],
    "приват 24-грн": [
      "приват",
      "privat",
      "privat 24",
      "приват 24",
      "приват грн",
      "privat 24 грн",
      "privat 24 uah",
      "privat uah"
    ],
    "монобанк грн": [
      "монобанк",
      "monobank",
      "mono",
      "монобанк грн",
      "monobank uah",
      "mono uah"
    ],
    "трансервайз дол": ["wise usd", "transferwise usd", "трансервайз дол", "wise дол"],
    "трансервайз евро": [
      "wise eur",
      "wise euro",
      "transferwise eur",
      "трансервайз евро",
      "трансервайз евр"
    ],
    "REVOLUT дол": ["revolut", "revolut usd", "револют", "револют дол"],
    "Payoneer - eur": ["payoneer eur", "payoneer euro", "payoneer - eur"],
    "Payoneer - dol": ["payoneer usd", "payoneer dol", "payoneer - dol"],
    "Бинанс spot": [
      "binance save",
      "бинанс save",
      "binance spot",
      "бинанс spot",
      "бинанс",
      "binance"
    ],
    "binance save": ["бинанс сейв", "binance savings"],
    "Налично -я-евр": ["налично я евр", "налично -я-евр", "cash eur"],
    "местная валюты": ["местная валюта", "местная валюты", "local currency"],
    "БАНК КАНАДА cad": ["bank canada cad", "банк канада cad", "canada bank cad"],
    "нал-мам-евро": ["нал мам евро", "нал-мам-евро"],
    "нал-мам-дол": ["нал мам дол", "нал-мам-дол"]
  };

  function normalizeToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/_/g, " ")
      .replace(/[^0-9a-zа-я]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeManualLedgerCategory(value, fallback = "extra") {
    const raw = String(value || "").trim();
    const legacy = CANONICAL_BY_LEGACY_CATEGORY[raw];
    if (legacy) return legacy;
    const token = normalizeToken(raw);
    if (!token) return fallback;
    for (const [category, aliases] of Object.entries(CATEGORY_MAP)) {
      const known = [category, ...(aliases || [])].map(normalizeToken);
      if (known.includes(token)) return category;
    }
    return fallback;
  }

  function mapLedgerCategoryToLegacy(category) {
    return LEGACY_CATEGORY_BY_CANONICAL[normalizeManualLedgerCategory(category)] || "business";
  }

  function normalizeManualLedgerChannel(value, channels = []) {
    const raw = String(value || "").trim();
    const token = normalizeToken(raw);
    if (!token) return "";
    const exact = (channels || []).find((channel) => normalizeToken(channel) === token);
    if (exact) return exact;
    for (const [channel, aliases] of Object.entries(CHANNEL_MAP)) {
      const known = [channel, ...(aliases || [])].map(normalizeToken);
      if (known.includes(token)) {
        return (channels || []).find((item) => normalizeToken(item) === normalizeToken(channel)) || channel;
      }
    }
    return raw;
  }

  function normalizeManualLedgerOperation(value, category = "") {
    const token = normalizeToken(value);
    const canonicalCategory = normalizeManualLedgerCategory(category, "");
    if (MANUAL_LEDGER_OPERATIONS.includes(token)) return token;
    if (["received", "приход"].includes(token)) return "income";
    if (["spent", "расход"].includes(token)) return "expense";
    if (["exchange in", "обмен приход"].includes(token)) return "exchange_in";
    if (["exchange out", "обмен расход", "exchange"].includes(token)) return "exchange_out";
    if (canonicalCategory === "business") return "business_expense";
    if (["house", "food", "fun", "travel", "extra"].includes(canonicalCategory)) return "personal_expense";
    if (canonicalCategory === "partner") return "partner_transfer";
    if (canonicalCategory === "exchange") return "exchange_out";
    if (["servicein", "ezoin"].includes(canonicalCategory)) return "income";
    return token || "correction";
  }

  function normalizeManualLedgerDirection(value, operation = "") {
    const token = normalizeToken(value);
    if (MANUAL_LEDGER_DIRECTIONS.includes(token)) return token;
    const op = normalizeManualLedgerOperation(operation);
    if (op === "income" || op === "exchange_in") return "in";
    if (
      op === "expense" ||
      op === "exchange_out" ||
      op === "business_expense" ||
      op === "personal_expense" ||
      op === "partner_transfer"
    ) {
      return "out";
    }
    return "neutral";
  }

  function getValue(row, snakeKey, camelKey = "") {
    if (!row || typeof row !== "object") return "";
    if (row[snakeKey] !== undefined && row[snakeKey] !== null) return row[snakeKey];
    if (camelKey && row[camelKey] !== undefined && row[camelKey] !== null) return row[camelKey];
    return "";
  }

  function parseLedgerNumber(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    if (!normalized || normalized === "-" || normalized === ".") return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function normalizeLedgerNumber(value) {
    const numeric = parseLedgerNumber(value);
    return numeric === null ? "" : String(Math.round(numeric * 1000000) / 1000000);
  }

  function normalizeLedgerOperation(value, category = "") {
    const token = normalizeToken(value);
    if (LEDGER_V2_OPERATIONS.includes(token)) return token;
    if (
      token === "exchange in" ||
      token === "exchange out" ||
      token === "exchange_in" ||
      token === "exchange_out"
    ) {
      return "exchange";
    }
    if (token === "partner transfer" || token === "partner_transfer") return "transfer";
    if (
      token === "business expense" ||
      token === "business_expense" ||
      token === "personal expense" ||
      token === "personal_expense"
    ) {
      return "expense";
    }
    if (token === "correction") return "adjustment";
    const legacy = normalizeManualLedgerOperation(value, category);
    if (legacy === "income") return "income";
    if (legacy === "exchange_in" || legacy === "exchange_out") return "exchange";
    if (legacy === "partner_transfer") return "transfer";
    if (legacy === "business_expense" || legacy === "personal_expense" || legacy === "expense") return "expense";
    return legacy === "correction" ? "adjustment" : (token || "adjustment");
  }

  function normalizeLedgerV2Category(value, fallback = "other") {
    const raw = String(value || "").trim();
    if (LEDGER_V2_CATEGORY_BY_LEGACY[raw]) return LEDGER_V2_CATEGORY_BY_LEGACY[raw];
    const token = normalizeToken(raw);
    if (!token) return fallback;
    if (token === "serviceincome" || token === "service income" || token === "servicein") return "service";
    if (token === "ezoin" || token === "ezofact" || token === "ezo" || token === "ezohata") return "ezohata";
    if (token === "flat" || token === "rent") return "house";
    if (token === "extra" || token === "unclear" || token === "misc") return "other";
    if (LEDGER_V2_CATEGORIES.includes(token)) return token;
    const legacy = normalizeManualLedgerCategory(value, "");
    return LEDGER_V2_CATEGORY_BY_LEGACY[legacy] || (LEDGER_V2_CATEGORIES.includes(legacy) ? legacy : fallback);
  }

  function normalizeLedgerV2Source(value, fallback = "other") {
    const token = normalizeToken(value).replace(/\s+/g, "_");
    if (!token) return fallback;
    return LEDGER_V2_SOURCE_BY_LEGACY[token] || (LEDGER_V2_SOURCES.includes(token) ? token : fallback);
  }

  function getLegacyOperation(row) {
    return String(getValue(row, "legacy_operation", "legacyOperation") || getValue(row, "operation")).trim();
  }

  function getLedgerDirection(row) {
    const explicit = String(getValue(row, "direction")).trim().toLowerCase();
    if (explicit) return explicit;
    const legacyOperation = getLegacyOperation(row);
    if (legacyOperation === "exchange_out") return "out";
    if (legacyOperation === "exchange_in") return "in";
    const operation = normalizeLedgerOperation(getValue(row, "operation"), getValue(row, "category"));
    if (operation === "income") return "in";
    if (operation === "expense") return "out";
    return "";
  }

  function signLedgerAmount(value, row) {
    const numeric = parseLedgerNumber(value);
    if (numeric === null) return null;
    const legacyOperation = getLegacyOperation(row);
    const direction = getLedgerDirection(row);
    if (legacyOperation === "exchange_out" || direction === "out") return -Math.abs(numeric);
    if (legacyOperation === "exchange_in" || direction === "in") return Math.abs(numeric);
    return numeric;
  }

  function normalizeAmountUsd(row, options = {}) {
    const explicit = parseLedgerNumber(getValue(row, "amount_usd", "amountUsd"));
    if (explicit !== null) return signLedgerAmount(explicit, row);
    const currency = String(getValue(row, "currency") || "").trim().toUpperCase();
    const balanceBase = getBalanceAmount(row, { suppressWarnings: true });
    if (balanceBase === null) return null;
    if (currency === "USD") return balanceBase;
    const rate = parseLedgerNumber(getValue(row, "rate")) ||
      parseLedgerNumber(options?.rate) ||
      parseLedgerNumber(options?.rateLookup?.byCurrency?.[currency]) ||
      parseLedgerNumber(options?.rateLookup?.[currency]);
    return rate ? balanceBase * rate : null;
  }

  function getBalanceAmount(row, options = {}) {
    const explicitNet = parseLedgerNumber(getValue(row, "amount_net", "amountNet"));
    if (explicitNet !== null) return signLedgerAmount(explicitNet, row);
    const amount = parseLedgerNumber(getValue(row, "amount"));
    if (amount === null) return null;
    if (!options.suppressWarnings && Array.isArray(options.warnings)) {
      const externalId = String(
        getValue(row, "external_id", "externalId") ||
          getValue(row, "raw_source_id", "rawSourceId") ||
          ""
      ).trim();
      options.warnings.push(
        `Ledger v2 fallback: amount_net missing${externalId ? ` for ${externalId}` : ""}; balance used amount.`
      );
    }
    return signLedgerAmount(amount, row);
  }

  function isLedgerV2Row(row) {
    if (!row || typeof row !== "object") return false;
    return ["amount_gross", "amount_fee", "amount_net", "external_id"].some((key) => {
      const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      return row[key] !== undefined || row[camel] !== undefined;
    });
  }

  function normalizeLedgerRow(input = {}, options = {}) {
    const warnings = [];
    const category = normalizeLedgerV2Category(getValue(input, "category"), "other");
    const legacyOperation = String(getValue(input, "operation")).trim();
    const operation = normalizeLedgerOperation(legacyOperation, category);
    const explicitAmountUsd = getValue(input, "amount_usd", "amountUsd");
    const row = {
      date: String(getValue(input, "date") || "").trim().slice(0, 10),
      operation,
      from_channel: String(getValue(input, "from_channel", "fromChannel") || "").trim(),
      to_channel: String(getValue(input, "to_channel", "toChannel") || "").trim(),
      amount: normalizeLedgerNumber(getValue(input, "amount")),
      currency: String(getValue(input, "currency") || "").trim().toUpperCase(),
      amount_usd: "",
      amount_gross: normalizeLedgerNumber(getValue(input, "amount_gross", "amountGross")),
      amount_fee: normalizeLedgerNumber(getValue(input, "amount_fee", "amountFee")),
      amount_net: normalizeLedgerNumber(getValue(input, "amount_net", "amountNet")),
      rate: normalizeLedgerNumber(getValue(input, "rate")),
      category,
      source: normalizeLedgerV2Source(getValue(input, "source"), options.defaultSource || "other"),
      external_id: String(
        getValue(input, "external_id", "externalId") ||
          getValue(input, "raw_source_id", "rawSourceId") ||
          ""
      ).trim(),
      comment: String(getValue(input, "comment") || "").trim()
    };
    row.legacy_operation = legacyOperation && legacyOperation !== operation ? legacyOperation : "";
    row.legacy_category = String(getValue(input, "category") || "").trim();
    if (!row.amount_gross) row.amount_gross = row.amount;
    if (!row.amount_fee) row.amount_fee = normalizeLedgerNumber(getValue(input, "feeAmount"));
    if (!row.amount_net) row.amount_net = normalizeLedgerNumber(getValue(input, "netAmount"));
    const amountUsd = normalizeAmountUsd({ ...input, ...row, amount_usd: explicitAmountUsd }, options);
    row.amount_usd = amountUsd === null ? "" : normalizeLedgerNumber(amountUsd);
    row.balance_amount = getBalanceAmount({ ...input, ...row }, { warnings });
    row.warnings = warnings;
    row.amountUsd = row.amount_usd;
    row.amountGross = row.amount_gross;
    row.amountFee = row.amount_fee;
    row.amountNet = row.amount_net;
    row.fromChannel = row.from_channel;
    row.toChannel = row.to_channel;
    row.externalId = row.external_id;
    return row;
  }

  function validateLedgerRow(row) {
    const errors = [];
    const normalized = normalizeLedgerRow(row);
    if (!normalized.date) errors.push("date is required");
    if (!LEDGER_V2_OPERATIONS.includes(normalized.operation)) {
      errors.push(`unsupported operation: ${normalized.operation}`);
    }
    if (!normalized.amount) errors.push("amount is required");
    if (!normalized.currency) errors.push("currency is required");
    if (normalized.operation === "income" && !normalized.to_channel) {
      errors.push("to_channel is required for income");
    }
    if (["expense", "transfer", "exchange"].includes(normalized.operation) && !normalized.from_channel) {
      errors.push("from_channel is required for expense, transfer, and exchange");
    }
    if (normalized.operation === "exchange" && !normalized.amount_usd) {
      errors.push("amount_usd is required for exchange");
    }
    return { ok: errors.length === 0, errors, row: normalized };
  }

  return {
    MANUAL_LEDGER_HEADERS,
    LEDGER_V2_COLUMNS,
    MANUAL_LEDGER_OPERATIONS,
    MANUAL_LEDGER_DIRECTIONS,
    CANONICAL_LEDGER_CATEGORIES,
    LEDGER_V2_OPERATIONS,
    LEDGER_V2_CATEGORIES,
    LEDGER_V2_SOURCES,
    CATEGORY_MAP,
    CHANNEL_MAP,
    LEGACY_CATEGORY_BY_CANONICAL,
    CANONICAL_BY_LEGACY_CATEGORY,
    normalizeToken,
    normalizeManualLedgerCategory,
    mapLedgerCategoryToLegacy,
    normalizeManualLedgerChannel,
    normalizeManualLedgerOperation,
    normalizeManualLedgerDirection,
    normalizeLedgerRow,
    normalizeAmountUsd,
    getBalanceAmount,
    validateLedgerRow,
    isLedgerV2Row
  };
});
