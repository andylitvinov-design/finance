const test = require("node:test");
const assert = require("node:assert/strict");

function loadModule() {
  delete require.cache[require.resolve("../balance-ocr-channel-currency-fix.js")];
  delete globalThis.__BalanceOcrChannelCurrencyFixInstalled;
  delete globalThis.EzohataBalanceOcrChannelCurrencyFix;
  return require("../balance-ocr-channel-currency-fix.js");
}

test("normalizeLine restores currencies for production OCR-truncated balance rows", () => {
  const api = loadModule();
  assert.equal(api.normalizeLine("REVOLUT 1 1.0000 1"), "REVOLUT usd 1 1.0000 1");
  assert.equal(api.normalizeLine("binance save uf 2026 1.0000 2026"), "binance save usdc 2026 1.0000 2026");
  assert.equal(api.normalizeLine("Бинанс spot us 882 1.0000 882"), "Бинанс spot usdt 882 1.0000 882");
  assert.equal(api.normalizeLine("binance save u 5419 1.0000 5419"), "binance save usdt 5419 1.0000 5419");
  assert.equal(api.normalizeLine("binance spot ц 1 1.0000 1"), "binance spot usdc 1 1.0000 1");
});

test("normalizeLine leaves already clear rows untouched", () => {
  const api = loadModule();
  assert.equal(api.normalizeLine("wise usd 429 1.0000 429"), "wise usd 429 1.0000 429");
  assert.equal(api.normalizeLine("binance save usdt 5419 1.0000 5419"), "binance save usdt 5419 1.0000 5419");
  assert.equal(api.normalizeLine("TD BANK 14943 1.3514 11058"), "TD BANK 14943 1.3514 11058");
});

test("recognize wrapper normalizes text and clears stale words", async () => {
  delete require.cache[require.resolve("../balance-ocr-channel-currency-fix.js")];
  delete globalThis.__BalanceOcrChannelCurrencyFixInstalled;
  delete globalThis.EzohataBalanceOcrChannelCurrencyFix;
  globalThis.Tesseract = {
    async recognize() {
      return {
        data: {
          text: "binance save uf 2026 1.0000 2026\nREVOLUT 1 1.0000 1",
          words: [{ text: "stale" }],
        },
      };
    },
  };

  require("../balance-ocr-channel-currency-fix.js");
  const result = await globalThis.Tesseract.recognize("image", "eng");
  assert.equal(result.data.text, "binance save usdc 2026 1.0000 2026\nREVOLUT usd 1 1.0000 1");
  assert.deepEqual(result.data.words, []);
  delete globalThis.Tesseract;
});
