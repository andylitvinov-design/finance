const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveClientDefaultPaymentChannel,
} = require("../payment-channel-reference.js");

test("resolveClientDefaultPaymentChannel maps Inna Ustymenko variants to PayPal USD", () => {
  assert.equal(resolveClientDefaultPaymentChannel("Inna Ustymenko"), "пейпал дол");
  assert.equal(resolveClientDefaultPaymentChannel("Инна Устименко"), "пейпал дол");
  assert.equal(resolveClientDefaultPaymentChannel("Инна Устыменко"), "пейпал дол");
});

test("resolveClientDefaultPaymentChannel leaves unrelated clients without defaults", () => {
  assert.equal(resolveClientDefaultPaymentChannel("Сергей Ковалев"), "");
  assert.equal(resolveClientDefaultPaymentChannel("William Bray"), "");
});
