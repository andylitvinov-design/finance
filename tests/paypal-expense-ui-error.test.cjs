const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

function extractFunction(source, name) {
  let start = source.indexOf(`function ${name}`);
  if (start > 0 && source.slice(Math.max(0, start - 6), start) === "async ") {
    start -= 6;
  }
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
    `${extractFunction(uiJs, "getShortPayPalResponseExcerpt")}\n` +
    `${extractFunction(uiJs, "readPayPalExpenseStatementPayload")}\n` +
    `${extractFunction(uiJs, "normalizeExpenseAccountingWarning")}\n` +
    `${extractFunction(uiJs, "getPayPalManualImportMessage")}\n` +
    "this.readPayPalExpenseStatementPayload = readPayPalExpenseStatementPayload;\n" +
    "this.normalizeExpenseAccountingWarning = normalizeExpenseAccountingWarning;\n" +
    "this.getPayPalManualImportMessage = getPayPalManualImportMessage;",
    context
  );
  return context;
}

test("readPayPalExpenseStatementPayload preserves structured PayPal API errors", async () => {
  const context = createContext();
  const payload = await context.readPayPalExpenseStatementPayload({
    status: 400,
    async text() {
      return JSON.stringify({ ok: false, error: "PayPal OAuth failed (401): Failed to authenticate" });
    }
  });

  assert.equal(payload.ok, false);
  assert.equal(payload.error, "PayPal OAuth failed (401): Failed to authenticate");
});

test("PayPal auth diagnostics show credentials and environment hint", () => {
  const context = createContext();

  assert.equal(
    context.getPayPalManualImportMessage({
      ok: false,
      provider: "paypal",
      phase: "oauth",
      providerStatus: "auth_failed",
      shortExcerpt: "PayPal OAuth failed (401): Client Authentication failed"
    }),
    "PayPal REST credentials rejected by PayPal. Check live/sandbox credentials in Vercel env. phase: oauth · details: PayPal OAuth failed (401): Client Authentication failed"
  );

  assert.equal(
    context.normalizeExpenseAccountingWarning("PayPal fee unavailable due to API permissions/auth (environment: live; verify live vs sandbox app credentials)."),
    "PayPal REST credentials rejected by PayPal. Check live/sandbox credentials in Vercel env."
  );
});

test("readPayPalExpenseStatementPayload converts non-JSON provider text into contextual UI error", async () => {
  const context = createContext();

  await assert.rejects(
    context.readPayPalExpenseStatementPayload({
      status: 502,
      async text() {
        return "Failed to call list_transactions";
      }
    }),
    (error) => {
      assert.match(error.message, /PayPal вернул не-JSON ответ \(502\): Failed to call list_transactions/);
      assert.doesNotMatch(error.message, /Unexpected token|SyntaxError/);
      return true;
    }
  );
});

test("getPayPalManualImportMessage shows manual guidance instead of generic bad request", () => {
  const context = createContext();
  const message = context.getPayPalManualImportMessage({
    ok: false,
    provider: "paypal",
    error: "paypal_manual_import_required",
    phase: "mcp_fallback",
    canUseManualImport: true,
    shortExcerpt: "PayPal MCP tool list_transactions returned non-JSON: No transactions found"
  });

  assert.match(message, /PayPal API не доступен/);
  assert.match(message, /Activity\/CSV/);
  assert.match(message, /personal PayPal/);
  assert.doesNotMatch(message, /плохой запрос|Bad Request|вернул ошибку \(400\)/i);
});

test("PayPal manual import UI exposes manual balance action and fields", () => {
  assert.match(uiJs, /Ввести остатки PayPal вручную/);
  assert.match(uiJs, /Введите PayPal остаток один раз/);
  assert.match(uiJs, /Рассчитать PayPal остатки автоматически/);
  assert.match(uiJs, /runPayPalDerivedBalanceSnapshot/);
  assert.match(uiJs, /data-paypal-manual-balance-field="USD"/);
  assert.match(uiJs, /data-paypal-manual-balance-field="EUR"/);
  assert.match(uiJs, /data-paypal-manual-balance-field="CAD"/);
  assert.match(uiJs, /savePayPalManualBalance/);
  assert.doesNotMatch(uiJs, /gross.*as net|amount_gross.*amount_net/i);
});
