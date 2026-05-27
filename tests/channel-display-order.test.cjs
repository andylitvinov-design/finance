const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareChannelDisplayRows,
  normalizeChannelDisplayOrder,
} = require("../channel-display-order.js");

test("known Остатки channels sort in canonical business order", () => {
  const rows = [
    { channel: "карта май", currency: "THB" },
    { channel: "Binance funding", currency: "USDT" },
    { channel: "пейпал евр", currency: "EUR" },
    { channel: "Яндекс руб", currency: "RUB" },
    { channel: "деп24-дол", currency: "USD" },
    { channel: "REVOLUT франк", currency: "CHF" },
  ].sort(compareChannelDisplayRows);

  assert.deepEqual(rows.map((row) => row.channel), [
    "Яндекс руб",
    "пейпал евр",
    "деп24-дол",
    "REVOLUT франк",
    "Binance funding",
    "карта май",
  ]);
});

test("channel aliases map to the same sort group", () => {
  assert.equal(normalizeChannelDisplayOrder("смано ЯД").sortIndex, normalizeChannelDisplayOrder("Яндекс руб").sortIndex);
  assert.equal(normalizeChannelDisplayOrder("24-грн").sortIndex, normalizeChannelDisplayOrder("приват 24-грн").sortIndex);
  assert.equal(normalizeChannelDisplayOrder("монобанк").sortIndex, normalizeChannelDisplayOrder("монобанк грн").sortIndex);
  assert.equal(normalizeChannelDisplayOrder("Нал-я-евр").sortIndex, normalizeChannelDisplayOrder("Налично -я-евр").sortIndex);
  assert.equal(normalizeChannelDisplayOrder("ФОП - мамо").sortIndex, normalizeChannelDisplayOrder("приват-фоп").sortIndex);
  assert.equal(normalizeChannelDisplayOrder("пейпал cad").sortIndex, normalizeChannelDisplayOrder("пейпал сad").sortIndex);
});

test("same channel group keeps currencies adjacent and sorted inside the group", () => {
  const rows = [
    { channel: "unknown wallet", currency: "USD" },
    { channel: "трансервайз дол", currency: "USD" },
    { channel: "трансервйз евро", currency: "EUR" },
    { channel: "пейпал дол", currency: "USD" },
  ].sort(compareChannelDisplayRows);

  assert.deepEqual(rows.map((row) => `${row.channel}|${row.currency}`), [
    "пейпал дол|USD",
    "трансервйз евро|EUR",
    "трансервайз дол|USD",
    "unknown wallet|USD",
  ]);
});

test("unknown channels sort after known channels", () => {
  const rows = [
    { channel: "zzz new channel", currency: "USD" },
    { channel: "Яндекс руб", currency: "RUB" },
    { channel: "aaa new channel", currency: "EUR" },
  ].sort(compareChannelDisplayRows);

  assert.deepEqual(rows.map((row) => row.channel), [
    "Яндекс руб",
    "aaa new channel",
    "zzz new channel",
  ]);
});
