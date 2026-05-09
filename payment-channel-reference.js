(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.EzohataPaymentChannelReference = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CLIENT_DEFAULTS = [
    {
      channel: "пейпал дол",
      patterns: [
        /\binna\s+ustymenko\b/i,
        /инна\s+устименко/i,
        /инна\s+устыменко/i,
        /устименк/i,
        /ustymenk/i
      ]
    },
    {
      channel: "приват-фоп",
      patterns: [
        /\bserg(?:e|ey|ii|iy)\s+kovalev\b/i,
        /\bkovalev\b/i,
        /сергей\s+ковалев/i,
        /сергей\s+ковалёв/i,
        /ковалев/i,
        /ковалёв/i
      ]
    }
  ];

  function normalizeLookupText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^0-9a-zа-я]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function resolveClientDefaultPaymentChannel(client) {
    const normalized = normalizeLookupText(client);
    if (!normalized) return "";
    const match = CLIENT_DEFAULTS.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
    return match?.channel || "";
  }

  return {
    resolveClientDefaultPaymentChannel,
  };
});
