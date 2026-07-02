(function installBalanceOcrRateFallbackFix(root) {
  "use strict";

  if (!root || root.__BalanceOcrRateFallbackFixInstalled) return;
  root.__BalanceOcrRateFallbackFixInstalled = true;

  const NUMBER_PATTERN = /[+-]?\d+(?:[.,]\d+)?/g;

  function normalizeAmount(value) {
    const amount = String(value || "")
      .replace(/\s+/g, "")
      .replace(/,/g, ".")
      .replace(/\.(?=.*\.)/g, "");
    return amount && Number.isFinite(Number(amount)) ? amount : "";
  }

  function normalizeLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function inferCurrency(label) {
    const normalized = ` ${String(label || "").toLowerCase()} `;
    if (/youmoney|yoomoney|юмани|яндекс/.test(normalized)) return "RUB";
    if (/\busdc\b|\bизас\b|\bшзас\b/.test(normalized)) return "USDC";
    if (/\busdt\b/.test(normalized)) return "USDT";
    if (/\busd\b|\bdol\b|\bдол\b/.test(normalized)) return "USD";
    if (/\beur\b|\beuro\b|\bевр\b|nalichno/.test(normalized)) return "EUR";
    if (/\bcad\b|банк канада|td bank/.test(normalized)) return "CAD";
    if (/\buah\b|грн|24-uah|24-грн|monobank|privat24|privat 24/.test(normalized)) return "UAH";
    if (/\brub\b|руб/.test(normalized)) return "RUB";
    return "";
  }

  function isUsdLikeCurrency(currency) {
    return ["USD", "USDT", "USDC"].includes(String(currency || "").toUpperCase());
  }

  function isRateLike(currency, value) {
    const rate = Number(normalizeAmount(value));
    if (!Number.isFinite(rate) || rate <= 0) return false;
    const code = String(currency || "").toUpperCase();
    if (isUsdLikeCurrency(code)) return rate >= 0.95 && rate <= 1.05;
    if (code === "EUR") return rate >= 0.4 && rate <= 1.5;
    if (code === "CAD") return rate >= 0.8 && rate <= 2.2;
    if (code === "UAH") return rate >= 10 && rate <= 80;
    if (code === "RUB") return rate >= 20 && rate <= 150;
    return false;
  }

  function expectedUsdValue(amount, rate) {
    const nativeAmount = Number(normalizeAmount(amount));
    const numericRate = Number(normalizeAmount(rate));
    if (!Number.isFinite(nativeAmount) || !Number.isFinite(numericRate) || numericRate === 0) return NaN;
    return nativeAmount / numericRate;
  }

  function formatUsdAmount(amount, rate) {
    const usd = expectedUsdValue(amount, rate);
    if (!Number.isFinite(usd)) return "";
    const rounded = Math.round(usd);
    if (Math.abs(usd - rounded) < 0.35) return String(rounded);
    return String(Number(usd.toFixed(4)));
  }

  function isUsdConsistent(amount, rate, usdAmount) {
    const expected = expectedUsdValue(amount, rate);
    const parsedUsd = Number(normalizeAmount(usdAmount));
    if (!Number.isFinite(expected) || !Number.isFinite(parsedUsd)) return false;
    const tolerance = Math.max(0.6, Math.abs(expected) * 0.015);
    return Math.abs(expected - parsedUsd) <= tolerance;
  }

  function parseRateLine(line) {
    const cleaned = normalizeLabel(line);
    if (!cleaned) return null;

    const numbers = Array.from(cleaned.matchAll(NUMBER_PATTERN)).map((match) => ({
      value: normalizeAmount(match[0]),
      index: match.index || 0,
      end: (match.index || 0) + match[0].length,
    }));
    if (numbers.length < 2 || numbers.length > 3) return null;

    const first = numbers[0];
    const second = numbers[1];
    let label = normalizeLabel(cleaned.slice(0, first.index));
    let amount = first.value;
    let rate = second.value;
    let usdAmount = numbers[2]?.value || "";

    if (!label) {
      label = normalizeLabel(cleaned.slice(first.end, second.index));
      amount = first.value;
      rate = second.value;
      usdAmount = numbers[2]?.value || "";
    }

    const currency = inferCurrency(label);
    if (!currency || !isRateLike(currency, rate)) return null;
    return { label, currency, amount, rate, usdAmount };
  }

  function recoverLossyRateLine(line) {
    const parsed = parseRateLine(line);
    if (!parsed) return line;

    if (parsed.usdAmount && isUsdConsistent(parsed.amount, parsed.rate, parsed.usdAmount)) {
      return `${parsed.label} ${parsed.amount} ${parsed.rate} ${parsed.usdAmount}`;
    }

    const usdAmount = isUsdLikeCurrency(parsed.currency)
      ? parsed.amount
      : formatUsdAmount(parsed.amount, parsed.rate);
    if (!usdAmount) return line;

    return `${parsed.label} ${parsed.amount} ${parsed.rate} ${usdAmount}`;
  }

  function recoverLossyRateText(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => recoverLossyRateLine(line))
      .join("\n");
  }

  function shouldPreferRecoveredText(text) {
    return String(text || "")
      .split(/\r?\n/)
      .some((line) => {
        const parsed = parseRateLine(line);
        return parsed && (!parsed.usdAmount || !isUsdConsistent(parsed.amount, parsed.rate, parsed.usdAmount));
      });
  }

  function wrapRecognize() {
    const tesseract = root.Tesseract;
    if (!tesseract || typeof tesseract.recognize !== "function" || tesseract.__BalanceOcrRateFallbackWrapped) return false;
    const originalRecognize = tesseract.recognize.bind(tesseract);
    tesseract.recognize = async function recognizeWithRateRecovery(...args) {
      const result = await originalRecognize(...args);
      if (result?.data?.text) {
        const originalText = result.data.text;
        result.data.text = recoverLossyRateText(originalText);
        if (shouldPreferRecoveredText(originalText)) {
          result.data.words = [];
        }
      }
      return result;
    };
    tesseract.__BalanceOcrRateFallbackWrapped = true;
    return true;
  }

  if (!wrapRecognize() && root.setTimeout) {
    root.setTimeout(wrapRecognize, 0);
  }

  root.EzohataBalanceOcrRateFallbackFix = {
    recoverLossyRateText,
    recoverLossyRateLine,
    isRateLike,
    isUsdConsistent,
    shouldPreferRecoveredText,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = root.EzohataBalanceOcrRateFallbackFix;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
