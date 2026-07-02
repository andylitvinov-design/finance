const test = require("node:test");
const assert = require("node:assert/strict");

function loadModule() {
  delete require.cache[require.resolve("../balance-ocr-rate-fallback-fix.js")];
  delete globalThis.__BalanceOcrRateFallbackFixInstalled;
  delete globalThis.EzohataBalanceOcrRateFallbackFix;
  return require("../balance-ocr-rate-fallback-fix.js");
}

test("recoverLossyRateLine moves a detected rate out of USD and appends computed USD", () => {
  const api = loadModule();
  assert.equal(api.recoverLossyRateLine("monobank 19649 43.0000"), "monobank 19649 43.0000 457");
  assert.equal(api.recoverLossyRateLine("wise eur 252 0.8621"), "wise eur 252 0.8621 292");
  assert.equal(api.recoverLossyRateLine("Payoneer -usd 3 1.0000"), "Payoneer -usd 3 1.0000 3");
  // 14943 / 1.3514 = 11057.4 -> nearest whole USD is 11057 (the screenshot's
  // 11058 only exists in the OCR USD column, not recoverable from a rate line).
  assert.equal(api.recoverLossyRateLine("TD BANK 14943 1.3514"), "TD BANK 14943 1.3514 11057");
});

test("recoverLossyRateLine replaces OCR USD when it fails amount divided by rate", () => {
  const api = loadModule();
  assert.equal(api.recoverLossyRateLine("monobank 19649 43.0000 427.5"), "monobank 19649 43.0000 457");
  assert.equal(api.recoverLossyRateLine("Payoneer -usd 3 1.0000 0.0"), "Payoneer -usd 3 1.0000 3");
});

test("recoverLossyRateLine preserves native plus USD rows when second number is not rate-like", () => {
  const api = loadModule();
  assert.equal(api.recoverLossyRateLine("monobank 19649 457"), "monobank 19649 457");
  assert.equal(api.recoverLossyRateLine("wise eur 252 292"), "wise eur 252 292");
  assert.equal(api.recoverLossyRateLine("youmoney 21539 283"), "youmoney 21539 283");
});

test("recognize wrapper normalizes Tesseract text before balance parser receives it", async () => {
  delete require.cache[require.resolve("../balance-ocr-rate-fallback-fix.js")];
  delete globalThis.__BalanceOcrRateFallbackFixInstalled;
  delete globalThis.EzohataBalanceOcrRateFallbackFix;
  globalThis.Tesseract = {
    async recognize() {
      return {
        data: {
          text: "monobank 19649 43.0000 427.5\nwise eur 252 0.8621",
          words: [{ text: "stale-word-row" }],
        },
      };
    },
  };

  require("../balance-ocr-rate-fallback-fix.js");
  const result = await globalThis.Tesseract.recognize("image", "eng");
  assert.equal(result.data.text, "monobank 19649 43.0000 457\nwise eur 252 0.8621 292");
  assert.deepEqual(result.data.words, []);
  delete globalThis.Tesseract;
});

test("shouldPreferRecoveredText is false for already consistent rate rows", () => {
  const api = loadModule();
  assert.equal(api.shouldPreferRecoveredText("TD BANK 14943 1.3514 11058"), false);
  assert.equal(api.shouldPreferRecoveredText("wise usd 429 1.0000 429"), false);
});
