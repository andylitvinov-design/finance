const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TIMEOUT_MS,
  createPayPalDerivedBalanceRunner,
} = require("../paypal-derived-balance-loading-fix.js");

function createHarness(overrides = {}) {
  const expenseState = {
    paypalDerivedBalanceLoading: false,
    paypalManualBalanceRequired: false,
  };
  const statuses = [];
  const renderStates = [];
  const clearedTimeouts = [];
  let dashboardLoads = 0;

  const deps = {
    normalizeDate: (value) => value,
    getStartDate: () => "2026-05-20",
    getEndDate: () => "2026-05-21",
    expenseState,
    setStatus: (message, error) => statuses.push({ message, error }),
    render: () => renderStates.push(expenseState.paypalDerivedBalanceLoading),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        provider_results: [{ provider: "paypal", writable_rows: 2 }],
      }),
    }),
    loadDashboard: async () => {
      dashboardLoads += 1;
    },
    AbortControllerImpl: class FakeAbortController {
      constructor() {
        this.signal = { aborted: false };
      }
      abort() {
        this.signal.aborted = true;
      }
    },
    setTimeoutImpl: () => 99,
    clearTimeoutImpl: (id) => clearedTimeouts.push(id),
    ...overrides,
  };

  return {
    runner: createPayPalDerivedBalanceRunner(deps),
    expenseState,
    statuses,
    renderStates,
    clearedTimeouts,
    get dashboardLoads() {
      return dashboardLoads;
    },
  };
}

test("success clears loading and renders the final non-loading state", async () => {
  const harness = createHarness();

  await harness.runner();

  assert.equal(harness.expenseState.paypalDerivedBalanceLoading, false);
  assert.equal(harness.dashboardLoads, 1);
  assert.deepEqual(harness.renderStates, [true, false]);
  assert.match(harness.statuses.at(-1).message, /2 строк/);
  assert.deepEqual(harness.clearedTimeouts, [99]);
});

test("structured API errors clear loading and preserve the server message", async () => {
  const harness = createHarness({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, error: "provider unavailable" }),
    }),
  });

  await harness.runner();

  assert.equal(harness.expenseState.paypalDerivedBalanceLoading, false);
  assert.equal(harness.statuses.at(-1).message, "provider unavailable");
  assert.equal(harness.statuses.at(-1).error, true);
  assert.deepEqual(harness.renderStates, [true, true, false]);
});

test("timeout aborts the request and clears loading with a bounded message", async () => {
  class ImmediateAbortController {
    constructor() {
      this.signal = { aborted: false };
    }
    abort() {
      this.signal.aborted = true;
    }
  }

  let timeoutDelay = null;
  let controller = null;
  const harness = createHarness({
    AbortControllerImpl: class extends ImmediateAbortController {
      constructor() {
        super();
        controller = this;
      }
    },
    setTimeoutImpl: (callback, delay) => {
      timeoutDelay = delay;
      callback();
      return 7;
    },
    clearTimeoutImpl: () => {},
    fetchImpl: async (_url, options) => {
      assert.equal(options.signal, controller.signal);
      assert.equal(options.signal.aborted, true);
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });

  await harness.runner();

  assert.equal(timeoutDelay, TIMEOUT_MS);
  assert.equal(harness.expenseState.paypalDerivedBalanceLoading, false);
  assert.match(harness.statuses.at(-1).message, /30 секунд/);
  assert.deepEqual(harness.renderStates, [true, true, false]);
});

test("missing date never starts loading and renders the validation state", async () => {
  const harness = createHarness({
    getStartDate: () => "",
    getEndDate: () => "",
    normalizeDate: () => "",
  });

  await harness.runner();

  assert.equal(harness.expenseState.paypalDerivedBalanceLoading, false);
  assert.deepEqual(harness.renderStates, [false]);
  assert.match(harness.statuses.at(-1).message, /Выберите дату/);
  assert.equal(harness.statuses.at(-1).error, true);
});
