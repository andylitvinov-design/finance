// config.js — все настройки проекта в одном месте

const APP_BUILD_VERSION = "2026.04.28.5";
const FILE_PROTOCOL_DASHBOARD_ORIGIN = "https://ezohata-incoming-ledger.vercel.app";
const URL_PARAMS = new URLSearchParams(location.search);
const MANUAL_INCOMING_TITLE = "fact";
const MANUAL_FINANCE_MONEY_TITLE = "расходы по каналам";
const MANUAL_FINANCE_TRANSFER_TITLE = "Переводы";
const MANUAL_FINANCE_EXPENSE_TITLE = "Расходы";
const MANUAL_FINANCE_BALANCE_TITLE = "Остатки";
const MANUAL_FINANCE_COMMISSION_TITLE = "Комиссии";
const MANUAL_FINANCE_TOTAL_LABEL = "Итого";
const ANALYTICS_FACT_IMPORT_SHEET = "MANUAL_INPUTS_IMPORT";
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
const MANUAL_EXPENSE_ACCOUNTING_CATEGORIES = ["business", "flat", "food", "fun", "travel", "study"];
const MANUAL_NOW_CATEGORY = "now";
const MANUAL_EXCHANGE_CATEGORY = "exchange";
const MANUAL_INPUT_CATEGORIES = [...MANUAL_EXPENSE_TYPES, MANUAL_EXCHANGE_CATEGORY];
const MANUAL_STORED_INPUT_CATEGORIES = [MANUAL_NOW_CATEGORY, ...MANUAL_INPUT_CATEGORIES];
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
    localPatterns: [/сайт, рубли|сайт рубли/i],
    usdPatterns: [/сайт, рубли|сайт рубли/i]
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
