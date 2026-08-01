(function initBalanceChannelRegistry(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EzohataBalanceChannelRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBalanceChannelRegistry() {
  "use strict";

  const OWNER_CHANNELS = Object.freeze([
    owner("yandex_rub", "Яндекс", 1, "RUB", ["яндекс", "яндекс руб", "стало яд", "смано яд", "yandex", "yandex rub"]),
    owner("paypal_usd", "PayPal USD", 2, "USD", ["пейпал дол", "paypal usd", "paypal dollar", "paypal dollars"]),
    owner("paypal_eur", "PayPal EUR", 3, "EUR", ["пейпал евр", "пейпал евро", "paypal eur", "paypal euro"]),
    owner("dep24_usd", "Dep24 USD", 4, "USD", ["деп24 дол", "деп24 доллар", "dep24 usd"]),
    owner("dep24_eur", "Dep24 EUR", 5, "EUR", ["деп24 евро", "dep24 eur"]),
    owner("paypal_cad", "PayPal CAD", 6, "CAD", ["пейпал cad", "пейпал сad", "paypal cad"]),
    owner("privat24_uah", "Privat24 UAH", 7, "UAH", ["24 грн", "приват 24 грн", "privat24 uah", "privat 24 uah"]),
    owner("monobank_uah", "Monobank UAH", 8, "UAH", ["монобанк", "монобанк грн", "monobank", "mono uah"]),
    owner("wise_eur", "Wise EUR", 9, "EUR", ["трансервйз евро", "трансервайз евро", "transferwise eur", "wise eur"]),
    owner("wise_usd", "Wise USD", 10, "USD", ["трансервйз дол", "трансервайз дол", "transferwise usd", "wise usd"]),
    owner("revolut", "Revolut", 11, "USD-equivalent", ["revolut aggregate"], ["revolut usd", "revolut дол", "revolut eur", "revolut евро", "revolut chf", "revolut франк", "revolut gbp", "revolut фунт"], "aggregate", "provider_components"),
    owner("payoneer_eur", "Payoneer EUR", 12, "EUR", ["payoneer eur", "payoneer евро", "payoneer - eur"]),
    owner("payoneer_usd", "Payoneer USD", 13, "USD", ["payoneer usd", "payoneer дол", "payoneer - dol"]),
    owner("binance_save_usdc", "Binance Save USDC", 14, "USDC", ["binance save usdc", "binance save ц usdc"]),
    owner("binance_spot", "Binance Spot", 15, "USD-equivalent", ["binance spot aggregate", "бинанс spot aggregate"], ["бинанс spot", "бинанс spot usd", "бинанс spot usdt", "бинанс spot usdc", "бинанс spot us usdt", "binance spot usd", "binance spot usdt", "binance spot usdc", "binance funding", "legacy combined spot funding usdt"], "aggregate", "provider_components"),
    owner("binance_save_usdt", "Binance Save USDT", 16, "USDT", ["binance save usdt", "binance save u", "binance save usd"]),
    owner("cash_eur", "Cash EUR", 17, "EUR", ["cash eur"], ["налично я евр", "нал я евр", "нал мам евро", "нал мам дол"], "aggregate", "legacy_cash"),
    owner("local_currencies", "Local currencies", 18, "LOCAL", ["local currencies", "местная валюта", "местная валюты"], ["travel card", "unknown local helper"], "aggregate", "legacy_local"),
    owner("zen", "ZEN", 19, "USD-equivalent", ["zen"], [], "standalone", "owner", "2026-07-29"),
    owner("bank_canada_cad", "Bank Canada CAD", 20, "CAD", ["банк канада cad", "bank canada cad", "bank canada"]),
  ]);

  function owner(key, display_name, display_order, native_currency, input_aliases, provider_component_aliases = [], representation = "standalone", diagnostic_group = "owner", active_from = "") {
    return Object.freeze({
      key,
      display_name,
      display_order,
      native_currency,
      input_aliases: Object.freeze(input_aliases),
      provider_component_aliases: Object.freeze(provider_component_aliases),
      include_in_owner_total: true,
      supports_explicit_zero: true,
      active_from,
      active_to: "",
      representation,
      diagnostic_group,
    });
  }

  const CHANNEL_BY_KEY = new Map(OWNER_CHANNELS.map((row) => [row.key, row]));

  function listOwnerChannels({ date = "" } = {}) {
    return OWNER_CHANNELS.filter((row) => isActiveOn(row, date));
  }

  function getOwnerChannel(key) {
    return CHANNEL_BY_KEY.get(String(key || "").trim()) || null;
  }

  function resolveOwnerChannel(label, currency = "") {
    const normalized = normalize(label);
    const normalizedCurrency = String(currency || "").trim().toUpperCase();
    if (!normalized) return { key: "", status: "unresolved" };
    const matches = OWNER_CHANNELS.filter((row) => row.input_aliases.some((alias) => normalize(alias) === normalized));
    if (matches.length === 1) return { key: matches[0].key, status: "mapped" };
    const currencyMatches = matches.filter((row) => currencyMatchesOwner(row, normalizedCurrency));
    if (currencyMatches.length === 1) return { key: currencyMatches[0].key, status: "mapped" };
    if (normalized === "wise" || normalized === "transferwise" || normalized === "трансервайз") return resolveCurrencyFamily("wise", normalizedCurrency);
    if (normalized === "paypal" || normalized === "пейпал") return resolveCurrencyFamily("paypal", normalizedCurrency);
    if (normalized === "dep24" || normalized === "деп24") return resolveCurrencyFamily("dep24", normalizedCurrency);
    return { key: "", status: "unresolved" };
  }

  function resolveCurrencyFamily(family, currency) {
    const key = currency ? `${family}_${currency.toLowerCase()}` : "";
    return CHANNEL_BY_KEY.has(key) ? { key, status: "mapped" } : { key: "", status: "unresolved" };
  }

  function classifyRawBalanceRow({ channel = "", currency = "" } = {}) {
    const normalized = normalize(channel);
    const component = OWNER_CHANNELS.find((row) => row.provider_component_aliases.some((alias) => normalize(alias) === normalized));
    if (component) {
      const legacy = component.diagnostic_group.startsWith("legacy");
      return { key: component.key, role: legacy ? "legacy" : "provider_component", status: "mapped" };
    }
    const ownerMatch = resolveOwnerChannel(channel, currency);
    return ownerMatch.status === "mapped"
      ? { key: ownerMatch.key, role: "owner", status: "mapped" }
      : { key: "", role: "unresolved", status: "unresolved" };
  }

  function isActiveOn(row, date) {
    const value = String(date || "").slice(0, 10);
    return (!row.active_from || !value || value >= row.active_from) && (!row.active_to || !value || value <= row.active_to);
  }

  function currencyMatchesOwner(row, currency) {
    return row.native_currency === currency || (row.native_currency === "USD-equivalent" && currency === "USD");
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[‐‑–—-]/g, " ")
      .replace(/[^0-9a-zа-я]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return Object.freeze({
    OWNER_CHANNELS,
    classifyRawBalanceRow,
    getOwnerChannel,
    isActiveOn,
    listOwnerChannels,
    normalize,
    resolveOwnerChannel,
  });
});
