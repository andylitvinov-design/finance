import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CATEGORY_MAP = {
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

const DEFAULT_CHANNEL_MAP = {
  "Яндекс руб": ["яндекс", "yandex", "yandex rub", "яндекс руб", "яндекс рубли"],
  "пейпал дол": ["paypal", "paypal usd", "пейпал", "пейпал дол"],
  "пейпал евр": ["paypal eur", "paypal euro", "пейпал евр", "пейпал евро"],
  "пейпал сad": ["paypal cad", "пейпал cad", "пейпал сad"],
  "монобанк грн": ["монобанк", "monobank", "mono", "монобанк грн"],
  "приват 24-грн": ["приват", "privat", "privat 24", "приват 24", "приват грн"],
  "Бинанс spot": ["binance save", "бинанс save", "binance spot", "бинанс spot", "бинанс"]
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

export function normalizeManualLedgerCategory(value, fallback = "") {
  const token = normalizeToken(value);
  if (!token) return fallback;
  for (const [category, aliases] of Object.entries(CATEGORY_MAP)) {
    const known = [category, ...(aliases || [])].map(normalizeToken);
    if (known.includes(token)) return category;
  }
  return fallback;
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
