const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const apiIndex = fs.readFileSync(path.join(root, "api", "index.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`${name} was not found`);
  const parenStart = source.indexOf("(", start);
  let parenDepth = 0;
  let braceStart = -1;

  for (let index = parenStart; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      braceStart = source.indexOf("{", index);
      break;
    }
  }

  if (braceStart === -1) throw new Error(`${name} body was not found`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`${name} body was not closed`);
}

function createContext() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(apiIndex, "parseLooseNumber")}\n` +
    `${extractFunction(apiIndex, "formatDisplayNumber")}\n` +
    `${extractFunction(apiIndex, "isCryptoPaymentMethod")}\n` +
    `${extractFunction(apiIndex, "getAccruedMarkupMultiplier")}\n` +
    `${extractFunction(apiIndex, "deriveAccruedPlusPercent")}\n` +
    "this.getAccruedMarkupMultiplier = getAccruedMarkupMultiplier;\n" +
    "this.deriveAccruedPlusPercent = deriveAccruedPlusPercent;",
    context
  );
  return context;
}

test("deriveAccruedPlusPercent applies 1% only to Binance and crypto-like payment methods", () => {
  const context = createContext();

  assert.equal(context.deriveAccruedPlusPercent("100", "Binance spot / USDT"), "101");
  assert.equal(context.deriveAccruedPlusPercent("100", "USDT TRC20"), "101");
  assert.equal(context.deriveAccruedPlusPercent("100", "USDC ERC20"), "101");
});

test("deriveAccruedPlusPercent keeps ordinary fiat payment methods at 3%", () => {
  const context = createContext();

  assert.equal(context.deriveAccruedPlusPercent("100", "PayPal USD"), "103");
  assert.equal(context.deriveAccruedPlusPercent("100", "PayPal EUR"), "103");
  assert.equal(context.deriveAccruedPlusPercent("100", "Privat"), "103");
  assert.equal(context.deriveAccruedPlusPercent("100", "Mono"), "103");
  assert.equal(context.deriveAccruedPlusPercent("100", "YooMoney"), "103");
  assert.equal(context.deriveAccruedPlusPercent("100", "Wise"), "103");
});

test("getAccruedMarkupMultiplier does not treat plain USD strings as crypto", () => {
  const context = createContext();

  assert.equal(context.getAccruedMarkupMultiplier("USD"), 1.03);
  assert.equal(context.getAccruedMarkupMultiplier("обычный USD"), 1.03);
});
