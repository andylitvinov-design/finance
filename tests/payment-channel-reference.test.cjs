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
  assert.equal(resolveClientDefaultPaymentChannel("William Bray"), "");
});

test("resolveClientDefaultPaymentChannel maps Kovalev variants to Privat FOP", () => {
  assert.equal(resolveClientDefaultPaymentChannel("Сергей Ковалев"), "приват-фоп");
  assert.equal(resolveClientDefaultPaymentChannel("Сергей Ковалёв"), "приват-фоп");
  assert.equal(resolveClientDefaultPaymentChannel("Ковалев"), "приват-фоп");
  assert.equal(resolveClientDefaultPaymentChannel("Ковалёв"), "приват-фоп");
  assert.equal(resolveClientDefaultPaymentChannel("Sergey Kovalev"), "приват-фоп");
  assert.equal(resolveClientDefaultPaymentChannel("Kovalev"), "приват-фоп");
});
