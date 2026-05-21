const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}`);
  if (start === -1) start = source.indexOf(`function ${name}`);
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

function createContext(fetchImpl, overrides = {}) {
  const context = {
    fetch: fetchImpl,
    state: {
      expenseAccounting: {
        paypalDerivedBalanceLoading: false,
        paypalManualBalanceRequired: false,
      },
    },
    elements: {
      startDate: { value: "2026-05-01" },
      endDate: { value: "2026-05-21" },
    },
    renderCount: 0,
    renderSnapshots: [],
    normalizeIncomingSheetDateValue(value) {
      return String(value || "").trim();
    },
    setExpenseAccountingStatus(message, isError) {
      context.state.expenseAccounting.status = message;
      context.state.expenseAccounting.error = Boolean(isError);
    },
    renderTabs() {
      context.renderCount += 1;
      context.renderSnapshots.push(context.state.expenseAccounting.paypalDerivedBalanceLoading);
    },
    ...overrides,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(uiJs, "runPayPalDerivedBalanceSnapshot")}\nthis.runPayPalDerivedBalanceSnapshot = runPayPalDerivedBalanceSnapshot;`,
    context
  );
  return context;
}

test("PayPal derived balance success clears loading and re-renders final state", async () => {
  const context = createContext(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      provider_results: [{ provider: "paypal", provider_current_balance_status: "derived_from_ledger", writable_rows: 3 }],
    }),
  }));

  await context.runPayPalDerivedBalanceSnapshot();

  assert.equal(context.state.expenseAccounting.paypalDerivedBalanceLoading, false);
  assert.equal(context.state.expenseAccounting.error, false);
  assert.match(context.state.expenseAccounting.status, /PayPal авто-остатки: 3 строк/);
  assert.deepEqual(context.renderSnapshots.slice(-2), [true, false]);
});

test("PayPal derived balance JSON error clears loading, reports error, and re-renders", async () => {
  const context = createContext(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ ok: false, error: "save failed" }),
  }));

  await context.runPayPalDerivedBalanceSnapshot();

  assert.equal(context.state.expenseAccounting.paypalDerivedBalanceLoading, false);
  assert.equal(context.state.expenseAccounting.error, true);
  assert.match(context.state.expenseAccounting.status, /save failed/);
  assert.deepEqual(context.renderSnapshots.slice(-2), [true, false]);
});

test("PayPal derived balance timeout clears loading, reports timeout, and re-renders", async () => {
  class TestAbortController {
    constructor() {
      this.signal = { aborted: false };
    }
    abort() {
      this.signal.aborted = true;
    }
  }
  const context = createContext(async (_url, options = {}) => {
    if (options.signal?.aborted) {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    }
    return new Promise(() => {});
  }, {
    AbortController: TestAbortController,
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
  });

  await context.runPayPalDerivedBalanceSnapshot();

  assert.equal(context.state.expenseAccounting.paypalDerivedBalanceLoading, false);
  assert.equal(context.state.expenseAccounting.error, true);
  assert.match(context.state.expenseAccounting.status, /30 секунд/);
  assert.deepEqual(context.renderSnapshots.slice(-2), [true, false]);
});
