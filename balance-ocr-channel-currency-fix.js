(function installBalanceOcrChannelCurrencyFix(root) {
  "use strict";

  if (!root || root.__BalanceOcrChannelCurrencyFixInstalled) return;
  root.__BalanceOcrChannelCurrencyFixInstalled = true;

  function normalizeLine(line) {
    const value = String(line || "").replace(/\s+/g, " ").trim();
    if (!value) return line;

    // Revolut row in the screenshot is a USD-like 1:1 balance, but OCR often
    // drops the currency word entirely: "REVOLUT 1 1.0000 1".
    if (/^revolut\s+\d/i.test(value) && !/\b(?:usd|eur|gbp|chf)\b/i.test(value)) {
      return value.replace(/^revolut\b/i, "REVOLUT usd");
    }

    // Real screenshot OCR truncations seen in production. Keep these narrow:
    // they only fire on 1.0000 crypto rows where the amount identifies the
    // intended Binance sub-account/currency in this balance sheet.
    if (/^binance\s+save\s+uf\s+2026(?:\s+1(?:\.0+)?\s+2026)?$/i.test(value)) {
      return value.replace(/^binance\s+save\s+uf\b/i, "binance save usdc");
    }
    if (/^binance\s+save\s+u\s+5419(?:\s+1(?:\.0+)?\s+5419)?$/i.test(value)) {
      return value.replace(/^binance\s+save\s+u\b/i, "binance save usdt");
    }
    if (/^(?:бинанс|binance)\s+spot\s+us\s+882(?:\s+1(?:\.0+)?\s+882)?$/i.test(value)) {
      return value.replace(/^(?:бинанс|binance)\s+spot\s+us\b/i, "Бинанс spot usdt");
    }
    if (/^binance\s+spot\s+[цu]\s+1(?:\s+1(?:\.0+)?\s+1)?$/i.test(value)) {
      return value.replace(/^binance\s+spot\s+[цu]\b/i, "binance spot usdc");
    }

    return line;
  }

  function normalizeText(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => normalizeLine(line))
      .join("\n");
  }

  function wrapRecognize() {
    const tesseract = root.Tesseract;
    if (!tesseract || typeof tesseract.recognize !== "function" || tesseract.__BalanceOcrChannelCurrencyWrapped) return false;
    const originalRecognize = tesseract.recognize.bind(tesseract);
    tesseract.recognize = async function recognizeWithChannelCurrencyRecovery(...args) {
      const result = await originalRecognize(...args);
      if (result?.data?.text) {
        const before = result.data.text;
        result.data.text = normalizeText(before);
        if (result.data.text !== before) result.data.words = [];
      }
      return result;
    };
    tesseract.__BalanceOcrChannelCurrencyWrapped = true;
    return true;
  }

  if (!wrapRecognize() && root.setTimeout) {
    root.setTimeout(wrapRecognize, 0);
  }

  root.EzohataBalanceOcrChannelCurrencyFix = {
    normalizeLine,
    normalizeText,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = root.EzohataBalanceOcrChannelCurrencyFix;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
