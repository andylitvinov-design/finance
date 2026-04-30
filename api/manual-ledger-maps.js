import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MANUAL_LEDGER_HEADERS = [
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
  "приват 24-грн": ["приват", "privat", "privat 24", "приват 24", "приват грн", "privat 24 грн", "privat 24 uah", "privat uah"],
  "монобанк грн": ["монобанк", "monobank", "mono", "монобанк грн", "monobank uah", "mono uah"],
  "трансервайз дол": ["wise usd", "transferwise usd", "трансервайз дол", "wise дол"],
  "трансервайз евро": ["wise eur", "wise euro", "transferwise eur", "трансервайз евро", "трансервайз евр"],
  "REVOLUT дол": ["revolut", "revolut usd", "револют", "револют дол"],
  "Payoneer - eur": ["payoneer eur", "payoneer euro", "payoneer - eur"],
  "Payoneer - dol": ["payoneer usd", "payoneer dol", "payoneer - dol"],
  "Бинанс spot": ["binance save", "бинанс save", "binance spot", "бинанс spot", "бинанс", "binance"],
  "binance save": ["бинанс сейв", "binance savings"],
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

function loadSheetConfigMaps() {
  try {
    const configPath = path.join(__dirname, "..", "sheet-config.json");
    const payload = JSON.parse(readFileSync(configPath, "utf8"));
    return {
      categoryMap: payload?.manualFinance?.categoryMap || DEFAULT_CATEGORY_MAP,
      channelMap: payload?.manualFinance?.channelMap || DEFAULT_CHANNEL_MAP,
    };
  } catch {
    return {
      categoryMap: DEFAULT_CATEGORY_MAP,
      channelMap: DEFAULT_CHANNEL_MAP,
    };
  }
}

const loaded = loadSheetConfigMaps();

export const CATEGORY_MAP = loaded.categoryMap;
export const CHANNEL_MAP = loaded.channelMap;

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
