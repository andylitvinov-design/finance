// config.js — все настройки проекта в одном месте

const APP_BUILD_VERSION = "2026.04.30.1";
const FILE_PROTOCOL_DASHBOARD_ORIGIN = "https://ezohata-incoming-ledger.vercel.app";
const URL_PARAMS = new URLSearchParams(location.search);
const MANUAL_INCOMING_TITLE = "fact";
const MANUAL_FINANCE_MONEY_TITLE = "расходы по каналам";
const MANUAL_FINANCE_TRANSFER_TITLE = "Переводы";
const MANUAL_FINANCE_EXPENSE_TITLE = "Расходы";
const MANUAL_FINANCE_BALANCE_TITLE = "Остатки";
const MANUAL_FINANCE_COMMISSION_TITLE = "Комиссии";
const MANUAL_FINANCE_LEDGER_TITLE = "Ledger";
const MANUAL_FINANCE_TOTAL_LABEL = "Итого";
const ANALYTICS_FACT_IMPORT_SHEET = "MANUAL_INPUTS_IMPORT";
const MANUAL_LEDGER_CONTRACT = window.EzohataManualLedgerContract || {};
const MANUAL_LEDGER_HEADERS = MANUAL_LEDGER_CONTRACT.MANUAL_LEDGER_HEADERS || [
  "date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category",
  "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"
];
const MANUAL_LEDGER_OPERATIONS = MANUAL_LEDGER_CONTRACT.MANUAL_LEDGER_OPERATIONS || [
  "income", "expense", "exchange_in", "exchange_out", "partner_transfer", "business_expense", "personal_expense", "correction"
];
const MANUAL_LEDGER_DIRECTIONS = MANUAL_LEDGER_CONTRACT.MANUAL_LEDGER_DIRECTIONS || ["in", "out", "neutral"];
const MANUAL_LEDGER_CATEGORIES = MANUAL_LEDGER_CONTRACT.CANONICAL_LEDGER_CATEGORIES || [
  "servicein", "ezoin", "exchange", "partner", "business", "house", "food", "fun", "travel", "extra"
];
const MANUAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MANUAL_FINANCE_FALLBACK_USD_RATES = {
  RUB: 1 / 84.5563,
  UAH: 1 / 43.86,
  EUR: 1.16,
  CAD: 0.74,
  LOCAL: 1 / 18
};
const MANUAL_FINANCE_HEADERS = [
  "канал", "now", "service income", "spent for business", "spent for flat", "spent for food", "spent for fun",
  "spent for study", "spent for travel", "затраты-мои", "обмен"
];
const MANUAL_TRANSFER_HEADERS = ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"];
const MANUAL_BALANCE_HEADERS = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"];
const MANUAL_COMMISSION_HEADERS = ["дата", "канал", "сумма в долларах", "комментарий"];
const MANUAL_EXPENSE_TYPES = ["serviceIncome", "business", "flat", "food", "fun", "study", "travel"];
const MANUAL_EXPENSE_ACCOUNTING_CATEGORIES = ["business", "flat", "food", "fun", "travel", "study", "exchange"];
const MANUAL_RECEIVED_ENTRY_TYPES = ["ezofact", "serviceincome", "exchange_in"];
const DEFAULT_MANUAL_RECEIVED_ENTRY_TYPE = "serviceincome";
const MANUAL_NOW_CATEGORY = "now";
const MANUAL_EXCHANGE_CATEGORY = "exchange";
const MANUAL_INPUT_CATEGORIES = [...MANUAL_EXPENSE_TYPES, MANUAL_EXCHANGE_CATEGORY];
const MANUAL_EXPENSE_ACCOUNTING_SAVE_CATEGORIES = MANUAL_INPUT_CATEGORIES.slice();
const MANUAL_STORED_INPUT_CATEGORIES = [MANUAL_NOW_CATEGORY, ...MANUAL_INPUT_CATEGORIES];
const DEFAULT_MANUAL_CATEGORY_MAP = MANUAL_LEDGER_CONTRACT.CATEGORY_MAP || {
  servicein: ["service income", "serviceincome", "service in", "services", "service", "приход"],
  ezoin: ["ezoin", "ezo in", "ezohata", "ezo", "ezofact"],
  exchange: ["обмен", "exchange", "exchange_usd", "exchange usd", "exchangeusd", "комиссии", "exchange_in"],
  partner: ["partner", "partnertransfer", "partner transfer", "партнер", "партнеры"],
  business: ["spent for business", "business", "business expense", "бизнес"],
  house: ["spent for flat", "spent for house", "flat", "house", "rent", "квартира", "кварт", "дом", "аренда"],
  food: ["spent for food", "food", "еда", "продукты"],
  fun: ["spent for fun", "fun", "events", "event", "beauty", "развлечения", "развлеч"],
  travel: ["spent for travel", "spent for study", "travel", "travel/study", "study", "учеб", "обуч", "путеш"],
  extra: ["extra", "unclear", "other", "misc", "unknown"]
};
const DEFAULT_MANUAL_CHANNEL_MAP = MANUAL_LEDGER_CONTRACT.CHANNEL_MAP || {
  "Яндекс руб": ["яндекс", "yandex", "yandex rub", "яндекс руб", "яндекс рубли"],
  "пейпал дол": ["paypal", "paypal usd", "пейпал", "пейпал дол"],
  "пейпал евр": ["paypal eur", "paypal euro", "пейпал евр", "пейпал евро"],
  "пейпал сad": ["paypal cad", "пейпал cad", "пейпал сad"],
  "приват 24-дол": ["privat usd", "privat 24 usd", "приват 24 дол"],
  "приват 24-евро": ["privat eur", "privat 24 eur", "приват 24 евро"],
  "приват 24-грн": ["приват", "privat", "privat 24", "приват 24", "приват грн", "privat 24 грн", "privat 24 uah"],
  "монобанк грн": ["монобанк", "monobank", "mono", "монобанк грн", "monobank uah", "mono uah"],
  "трансервайз дол": ["wise usd", "transferwise usd"],
  "трансервайз евро": ["wise eur", "transferwise eur"],
  "Бинанс spot": ["binance spot", "бинанс spot", "бинанс"],
  "binance save": ["binance save", "бинанс save", "бинанс сейв", "binance savings"]
};
const MANUAL_TRANSFER_MIN_ROWS = 3;
const ANALYTICS_PAYOUTS_HELPER = window.EzohataAnalyticsPayoutsHelper || {};
const MANUAL_FINANCE_FORMULAS = window.EzohataManualFinanceFormulas || {};
const ORDERS_HELPER = window.EzohataOrdersHelper || {};
const MANUAL_ORDERS_SHEET_NAME = "Мои заказы";
const MANUAL_ORDERS_LEGACY_SHEET_NAME = "MANUAL_ORDERS";
const MANUAL_ORDERS_HEADERS = ORDERS_HELPER.SIMPLE_HEADERS || ["ДАТА", "ИМЯ", "ЗАКАЗ", "СТОИМОСТЬ"];
const MANUAL_ORDERS_DEFAULT_ROWS = 1;
const MOVEMENT_SOURCE_SPREADSHEET_FALLBACK_URL = "https://docs.google.com/spreadsheets/d/1v2ZvGdutjyMkW0FZqxJ3P0GRVuKPlNxG1lvZiUZlWvo/edit#gid=0";
const SUMMARY_LABELS = {
  price: "1) прайс",
  accrued: "2) начислено прайс +%",
  percent: "3) %",
  receivedUsd: "4) получено в долларах",
  balance: "5) баланс",
  seventyPct: "6) 70% от прайс+%",
  orders: "7) мои заказы за этот период (4я вкладка)",
  totalAccrued: "8) ИТОГО НАЧИСЛЕНО",
  payout: "9) ОТПРАВЛЕНО",
  openingBalance: "остаток был",
  totalBalance: "10) ИТОГО БАЛАНС"
};
const ANALYTICS_PAYMENT_RULES = {
  "Яндекс руб": {
    currency: "RUB",
    localPatterns: [/сайт, рубли|сайт рубли|yoomoney|юmoney|юмани|юмоней/i],
    usdPatterns: [/сайт, рубли|сайт рубли|yoomoney|юmoney|юмани|юмоней/i]
  },
  "пейпал дол": {
    currency: "USD",
    usdPatterns: [/сайт, дол, пэйпэл|сайт, пэйпэл, дол/i]
  },
  "приват 24-грн": {
    currency: "UAH",
    localPatterns: [/приват фоп|фоп приват/i],
    usdPatterns: [/приват фоп|фоп приват/i]
  },
  "монобанк грн": {
    currency: "UAH",
    localPatterns: [/^(карта андрей|андрей карта)$/i, /монобанк|monobank|mono|лозин|lozin/i],
    usdPatterns: [/^(карта андрей|андрей карта)$/i, /монобанк|monobank|mono|лозин|lozin/i]
  },
  "Бинанс spot": {
    currency: "USD",
    localPatterns: [/крипта, дол|binance save/i],
    usdPatterns: [/крипта, дол|binance save/i]
  }
};
const MANUAL_FINANCE_MONEY_CHANNELS = [
  "Яндекс руб","пейпал дол","пейпал евр","пейпал сad","приват 24-дол","приват 24-евро","приват 24-грн",
  "монобанк грн","трансервайз дол","трансервайз евро","REVOLUT дол","Payoneer - eur","Payoneer - dol",
  "Бинанс spot","binance save","Налично -я-евр","местная валюты","БАНК КАНАДА cad","нал-мам-евро","нал-мам-дол"
];
