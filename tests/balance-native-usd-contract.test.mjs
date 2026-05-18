import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyBalanceValue,
  normalizeBalanceValueContract,
  parseBalanceNumber,
} from "../server/balance-native-usd-contract.js";

test("parseBalanceNumber keeps blanks null and parses sheet number formats", () => {
  assert.equal(parseBalanceNumber(""), null);
  assert.equal(parseBalanceNumber("   "), null);
  assert.equal(parseBalanceNumber(null), null);
  assert.equal(parseBalanceNumber("26 670,50"), 26670.5);
  assert.equal(parseBalanceNumber("1,234.56"), 1234.56);
  assert.equal(parseBalanceNumber("1 234,56"), 1234.56);
});

test("USD amount is both native and USD with rate 1", () => {
  const row = { amount: "100", currency: "USD", source: "manual-google-sheets" };

  assert.equal(classifyBalanceValue(row), "native_and_usd");
  assert.deepEqual(normalizeBalanceValueContract(row), {
    amount_native: 100,
    amount_usd: 100,
    fx_rate_to_usd: 1,
    value_type: "native_and_usd",
  });
});

test("non-USD row with native and USD equivalent keeps both values", () => {
  const row = { amount: "26670", amount_usd: "603", currency: "UAH" };

  assert.equal(classifyBalanceValue(row), "native_and_usd");
  assert.deepEqual(normalizeBalanceValueContract(row), {
    amount_native: 26670,
    amount_usd: 603,
    fx_rate_to_usd: 603 / 26670,
    value_type: "native_and_usd",
  });
});

test("EUR CAD RUB rows with only USD equivalent require native value", () => {
  for (const currency of ["EUR", "CAD", "RUB"]) {
    const row = { amount: "", amount_usd: "100", currency };
    assert.equal(classifyBalanceValue(row), "usd_only_needs_native");
    assert.deepEqual(normalizeBalanceValueContract(row), {
      amount_native: null,
      amount_usd: 100,
      fx_rate_to_usd: null,
      value_type: "usd_only_needs_native",
    });
  }
});

test("blank amount remains null and never becomes zero", () => {
  assert.deepEqual(normalizeBalanceValueContract({ amount: "", currency: "EUR" }), {
    amount_native: null,
    amount_usd: null,
    fx_rate_to_usd: null,
    value_type: "needs_verification",
  });
});

test("explicit zero is a valid user or provider native fact", () => {
  assert.equal(classifyBalanceValue({ amount: "0", currency: "EUR", source: "manual-google-sheets" }), "explicit_zero");
  assert.deepEqual(normalizeBalanceValueContract({ amount: 0, currency: "USD", source: "provider" }), {
    amount_native: 0,
    amount_usd: 0,
    fx_rate_to_usd: 1,
    value_type: "explicit_zero",
  });
});

test("calculated hint never becomes a manual or provider fact", () => {
  const rows = [
    { amount: "125", currency: "USD", calculated_closing_balance: 125 },
    { amount: "125", currency: "USD", expected_closing_hint: 125 },
    { amount: "125", currency: "USD", source: "computed_real_closing_balance" },
  ];

  for (const row of rows) {
    assert.equal(classifyBalanceValue(row), "calculated_hint");
    assert.deepEqual(normalizeBalanceValueContract(row), {
      amount_native: null,
      amount_usd: null,
      fx_rate_to_usd: null,
      value_type: "calculated_hint",
    });
  }
});

test("carried-forward rows are classified but not exposed as native facts", () => {
  const row = { amount: "50", currency: "USD", fact_source: "carried_forward" };

  assert.equal(classifyBalanceValue(row), "carried_forward");
  assert.deepEqual(normalizeBalanceValueContract(row), {
    amount_native: null,
    amount_usd: null,
    fx_rate_to_usd: null,
    value_type: "carried_forward",
  });
});
