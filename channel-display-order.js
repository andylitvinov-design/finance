(function initChannelDisplayOrder(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.EzohataChannelDisplayOrder = api;
    root.normalizeChannelDisplayOrder = api.normalizeChannelDisplayOrder;
    root.compareChannelDisplayRows = api.compareChannelDisplayRows;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createChannelDisplayOrder() {
  "use strict";

  const UNKNOWN_SORT_INDEX = 10000;
  const CHANNEL_GROUPS = [
    ["Яндекс руб", "смано ЯД"],
    ["пейпал дол", "paypal usd"],
    ["пейпал евр", "paypal eur"],
    ["деп24-дол"],
    ["деп24-евро"],
    ["пейпал cad", "пейпал сad", "paypal cad"],
    ["приват 24-грн", "24-грн"],
    ["монобанк грн", "монобанк", "mono uah"],
    ["трансервйз евро", "трансервайз евро", "wise eur"],
    ["трансервйз дол", "трансервайз дол", "wise usd"],
    ["REVOLUT дол", "revolut usd"],
    ["REVOLUT евро", "revolut eur"],
    ["REVOLUT франк", "revolut chf"],
    ["REVOLUT фунт", "revolut gbp"],
    ["Payoneer - eur"],
    ["Payoneer - dol"],
    ["Бинанс spot"],
    ["binance save"],
    ["Binance funding"],
    ["legacy_combined_binance_spot_funding"],
    ["Налично -я-евр", "Нал-я-евр"],
    ["местная валюты"],
    ["БАНК КАНАДА cad"],
    ["приват-фоп", "ФОП - мамо"],
    ["приват 24-евро", "24-евро"],
    ["карта тай"],
    ["нал-мам-евро", "нал-мам-е"],
    ["нал-мам-дол", "нал-мам-д"],
    ["приват 24-дол", "24-дол"],
    ["переплата Богдану"],
    ["карта май"],
  ];

  const ORDER_BY_KEY = new Map();
  CHANNEL_GROUPS.forEach((aliases, index) => {
    aliases.forEach((alias) => ORDER_BY_KEY.set(normalizeKey(alias), index + 1));
  });

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\b[сc]ad\b/g, "cad")
      .replace(/\s+/g, " ");
  }

  function extractChannel(value) {
    if (value && typeof value === "object") {
      return value.sort_channel || value.sortChannel || value.source_channel || value.sourceChannel || value.channel || value.account || value.wallet || value.name || value.payment_channel || value.paymentChannel || "";
    }
    return value;
  }

  function extractCurrency(value) {
    if (!value || typeof value !== "object") return "";
    return String(value.currency || value.account_currency || value.accountCurrency || value.balance_currency || value.balanceCurrency || "").trim().toUpperCase();
  }

  function normalizeChannelDisplayOrder(channel) {
    const label = String(extractChannel(channel) || "").trim();
    const normalized = normalizeKey(label);
    const sortIndex = ORDER_BY_KEY.get(normalized) || UNKNOWN_SORT_INDEX;
    return {
      label,
      normalized,
      sortIndex,
      known: sortIndex !== UNKNOWN_SORT_INDEX,
    };
  }

  function compareChannelDisplayRows(left, right) {
    const leftOrder = normalizeChannelDisplayOrder(left);
    const rightOrder = normalizeChannelDisplayOrder(right);
    if (leftOrder.sortIndex !== rightOrder.sortIndex) return leftOrder.sortIndex - rightOrder.sortIndex;

    const currencyDiff = extractCurrency(left).localeCompare(extractCurrency(right));
    if (currencyDiff) return currencyDiff;

    return leftOrder.normalized.localeCompare(rightOrder.normalized);
  }

  function sortChannelDisplayRows(rows) {
    return [...(rows || [])].sort(compareChannelDisplayRows);
  }

  return {
    compareChannelDisplayRows,
    normalizeChannelDisplayOrder,
    sortChannelDisplayRows,
  };
});

(function loadCurrentBalanceSnapshotFix() {
  if (typeof document === "undefined") return;
  if (typeof document.querySelector !== "function" || typeof document.write !== "function") return;
  if (document.querySelector('script[src$="current-balance-snapshot-fix.js"]')) return;
  document.write('<script src="./current-balance-snapshot-fix.js"><\/script>');
})();
