export const MANUAL_LEDGER_HEADERS = [
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

export const MANUAL_LEDGER_OPERATIONS = [
  "income",
  "expense",
  "exchange_in",
  "exchange_out",
  "partner_transfer",
  "business_expense",
  "personal_expense",
  "correction"
];

export const MANUAL_LEDGER_DIRECTIONS = ["in", "out", "neutral"];
export const MANUAL_LEDGER_SOURCES = [
  "manual",
  "fact",
  "paypal",
  "wise",
  "binance",
  "monobank",
  "privatbank",
  "td_bank",
  "yoomoney",
  "migration",
  "google_sheets",
  "ocr",
  "browser_ocr",
  "screenshot",
  "image",
  "photo",
  "file_import",
  "csv_import",
  "xlsx_import",
  "pdf_import",
  "other"
];
export const CANONICAL_LEDGER_CATEGORIES = ["servicein", "ezoin", "exchange", "partner", "business", "house", "food", "fun", "travel", "extra"];

const DEFAULT_CATEGORY_MAP = {
  servicein: ["service income", "serviceincome", "service in", "services", "service", "приход"],
  ezoin: ["ezoin", "ezo in", "ezohata", "ezo", "ezofact"],
  exchange: ["обмен", "exchange", "exchange_usd", "exchange usd", "exchangeusd", "комиссии", "exchange_in", "exchange out", "exchange in"],
  partner: ["partner", "partnertransfer", "partner transfer", "партнер", "партнеры"],
  business: ["spent for business", "business", "business expense", "бизнес"],
  house: ["spent for flat", "spent for house", "flat", "house", "rent", "квартира", "кварт", "дом", "аренда"],
  food: ["spent for food", "food", "еда", "продукты"],
  fun: ["spent for fun", "fun", "events", "event", "beauty", "развлечения", "развлеч"],
  travel: ["spent for travel", "spent for study", "spent for travel/ fun", "travel", "travelfun", "travel fun", "travel study", "travel/study", "study", "учеба", "учеб", "обучение", "обуч", "курс", "школа", "путешествия", "путеш"],
  extra: ["extra", "unclear", "other", "misc", "unknown", "прочее", "неясное"]
};

const DEFAULT_CHANNEL_MAP = {
  "Яндекс руб": ["яндекс", "yandex", "yandex rub", "яндекс руб", "яндекс рубли", "yoomoney", "юmoney", "юмани"],
  "пейпал дол": ["paypal", "paypal usd", "paypal dol", "пейпал", "пейпал дол", "пейпал usd"],
  "пейпал евр": ["paypal eur", "paypal euro", "пейпал евр", "пейпал евро"],
  "пейпал сad": ["paypal cad", "пейпал cad", "пейпал сad", "paypal сad"],
  "приват 24-дол": ["privat usd", "privat 24 usd", "приват 24 дол", "приват 24-дол"],
  "приват 24-евро": ["privat eur", "privat 24 eur", "приват 24 евро", "приват 24-евро"],
  "приват-фоп": ["приват фоп", "фоп приват", "privat fop", "privat24 fop", "privat 24 fop", "privat fop uah", "приват24 фоп", "приват 24 фоп"],
  "приват 24-грн": ["приват", "privat", "privat 24", "приват 24", "приват грн", "privat 24 грн", "privat 24 uah", "privat uah"],
  "монобанк грн": ["монобанк", "monobank", "mono", "монобанк грн", "monobank uah", "mono uah"],
  "трансервайз дол": ["wise usd", "transferwise usd", "трансервайз дол", "wise дол"],
  "трансервайз евро": ["wise eur", "wise euro", "transferwise eur", "трансервайз евро", "трансервайз евр"],
  "REVOLUT дол": ["revolut", "revolut usd", "револют", "револют дол"],
  "Payoneer - eur": ["payoneer eur", "payoneer euro", "payoneer - eur"],
  "Payoneer - dol": ["payoneer usd", "payoneer dol", "payoneer - dol"],
  "Бинанс spot": ["binance spot", "бинанс spot", "бинанс", "binance"],
  "binance save": ["binance save", "бинанс save", "бинанс сейв", "binance savings"],
  "Налично -я-евр": ["налично я евр", "налично -я-евр", "cash eur"],
  "местная валюты": ["местная валюта", "местная валюты", "local currency"],
  "БАНК КАНАДА cad": ["bank canada cad", "банк канада cad", "canada bank cad"],
  "нал-мам-евро": ["нал мам евро", "нал-мам-евро"],
  "нал-мам-дол": ["нал мам дол", "нал-мам-дол"]
};

export const LEGACY_CATEGORY_BY_CANONICAL = {
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

export const CANONICAL_BY_LEGACY_CATEGORY = {
  serviceIncome: "servicein",
  flat: "house",
  study: "travel",
  travel: "travel",
  partnerTransfer: "partner",
  unclear: "extra"
};

export const CATEGORY_MAP = DEFAULT_CATEGORY_MAP;
export const CHANNEL_MAP = DEFAULT_CHANNEL_MAP;

export function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/_/g, " ")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeManualLedgerCategory(value, fallback = "extra") {
  const raw = String(value || "").trim();
  const legacy = CANONICAL_BY_LEGACY_CATEGORY[raw];
  if (legacy) return legacy;
  const token = normalizeToken(raw);
  if (!token) return fallback;
  let category = fallback;
  for (const [candidate, aliases] of Object.entries(CATEGORY_MAP)) {
    const known = [candidate, ...(aliases || [])].map(normalizeToken);
    if (known.includes(token)) {
      category = candidate;
      break;
    }
  }
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, category) ? category : fallback;
}

export function mapLedgerCategoryToLegacy(category) {
  return LEGACY_CATEGORY_BY_CANONICAL[normalizeManualLedgerCategory(category)] || "business";
}

export function normalizeManualLedgerChannel(value, channels = []) {
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

export function normalizeManualLedgerOperation(value, category = "") {
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

export function normalizeManualLedgerDirection(value, operation = "") {
  const token = normalizeToken(value);
  if (MANUAL_LEDGER_DIRECTIONS.includes(token)) return token;
  const op = normalizeManualLedgerOperation(operation);
  if (op === "income" || op === "exchange_in") return "in";
  if (op === "expense" || op === "exchange_out" || op === "business_expense" || op === "personal_expense" || op === "partner_transfer") return "out";
  return "neutral";
}

export function normalizeManualLedgerSource(value, fallback = "") {
  const token = normalizeToken(value);
  if (!token) return fallback;
  const normalizedToken = token.replace(/\s+/g, "_");
  if (MANUAL_LEDGER_SOURCES.includes(normalizedToken)) return normalizedToken;
  if (["manual_fact", "manual_finance"].includes(normalizedToken)) return "manual";
  if (["paypal", "paypal_mcp"].includes(normalizedToken)) return "paypal";
  if (["wise", "transferwise"].includes(normalizedToken)) return "wise";
  if (["binance", "binance_spot", "binance_save", "binance_savings", "crypto", "usdt", "usdt_trc20", "usdt_erc20", "usdc", "usdc_trc20", "usdc_erc20", "trc20", "erc20"].includes(normalizedToken)) return "binance";
  if (["monobank", "mono"].includes(normalizedToken)) return "monobank";
  if (["privatbank", "privat24", "privat_24"].includes(normalizedToken)) return "privatbank";
  if (["tdbank", "td_bank"].includes(normalizedToken)) return "td_bank";
  if (["yoomoney", "yoo_money", "yamoney", "yandex"].includes(normalizedToken)) return "yoomoney";
  if (["migration", "migrated"].includes(normalizedToken)) return "migration";
  if (["sheet", "sheets"].includes(normalizedToken)) return "google_sheets";
  if (["photo_parsing"].includes(normalizedToken)) return "photo";
  if (["provider", "import", "mcp", "mcp_import"].includes(normalizedToken)) return "other";
  return fallback;
}

function inferManualLedgerSourceFromRawSourceId(rawSourceId = "") {
  const raw = String(rawSourceId || "").trim().toLowerCase();
  if (!raw) return "";
  if (/^migration:/i.test(raw)) return "migration";
  if (/^(paypal|pp|txn[-_:]paypal)/i.test(raw)) return "paypal";
  if (/^(wise|transferwise)[:_-]/i.test(raw)) return "wise";
  if (/^(binance|crypto|usdt|usdc|trc20|erc20)[:_-]/i.test(raw)) return "binance";
  if (/^(mono|monobank)[:_-]/i.test(raw)) return "monobank";
  if (/^(privat|privat24|pb)[:_-]/i.test(raw)) return "privatbank";
  if (/^(tdbank|td_bank|td)[:_-]/i.test(raw)) return "td_bank";
  for (const source of ["file_import", "csv_import", "xlsx_import", "pdf_import"]) {
    if (raw.startsWith(`${source}:`) || raw.startsWith(`${source}-`) || raw.startsWith(`${source}_`)) return source;
  }
  return "";
}

function inferManualLedgerSourceFromChannels(...values) {
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized) continue;
    if (/(paypal|пейпал)/.test(normalized)) return "paypal";
    if (/(wise|transferwise|трансервайз)/.test(normalized)) return "wise";
    if (/(binance|бинанс|crypto|крипт|usdt|usdc|trc20|erc20)/.test(normalized)) return "binance";
    if (/(monobank|mono|монобанк)/.test(normalized)) return "monobank";
    if (/(privat|приват)/.test(normalized)) return "privatbank";
    if (/(td bank|tdbank)/.test(normalized)) return "td_bank";
    if (/(yoomoney|youmoney|yandex|яндекс|юмани|юmoney|юмоней)/.test(normalized)) return "yoomoney";
  }
  return "";
}

export function resolveManualLedgerSource(value, rawSourceId = "", fallback = "", context = {}) {
  const normalized = normalizeManualLedgerSource(value, "");
  if (normalized && normalized !== "other") return normalized;
  const inferred = inferManualLedgerSourceFromRawSourceId(rawSourceId) ||
    inferManualLedgerSourceFromChannels(
      context?.channel,
      context?.fromChannel,
      context?.from_channel,
      context?.toChannel,
      context?.to_channel
    );
  if (inferred) return inferred;
  return normalized || fallback;
}
