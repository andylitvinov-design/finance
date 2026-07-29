const assert = require('node:assert/strict');
const test = require('node:test');

const registry = require('../balance-channel-registry.js');

test('registry defines the exact ordered owner list and date-dependent ZEN visibility', () => {
  const all = registry.OWNER_CHANNELS;
  assert.equal(all.length, 20);
  assert.deepEqual(all.map((row) => row.display_name), [
    'Яндекс', 'PayPal USD', 'PayPal EUR', 'Dep24 USD', 'Dep24 EUR', 'PayPal CAD',
    'Privat24 UAH', 'Monobank UAH', 'Wise EUR', 'Wise USD', 'Revolut', 'Payoneer EUR',
    'Payoneer USD', 'Binance Save USDC', 'Binance Spot', 'Binance Save USDT', 'Cash EUR',
    'Local currencies', 'ZEN', 'Bank Canada CAD',
  ]);
  assert.deepEqual(registry.listOwnerChannels({ date: '2026-07-01' }).map((row) => row.key), all.filter((row) => row.key !== 'zen').map((row) => row.key));
  assert.equal(registry.listOwnerChannels({ date: '2026-07-29' }).length, 20);
});

test('registry resolves explicit aliases but keeps ambiguous labels unresolved', () => {
  assert.deepEqual(registry.resolveOwnerChannel('трансервайз евро', 'EUR'), { key: 'wise_eur', status: 'mapped' });
  assert.deepEqual(registry.resolveOwnerChannel('24-грн', 'UAH'), { key: 'privat24_uah', status: 'mapped' });
  assert.equal(registry.resolveOwnerChannel('Wise', '').status, 'unresolved');
  assert.equal(registry.resolveOwnerChannel('Binance Save', '').status, 'unresolved');
});

test('registry classifies provider components separately from owner aggregates', () => {
  const revolut = registry.classifyRawBalanceRow({ channel: 'REVOLUT евро', currency: 'EUR' });
  const spot = registry.classifyRawBalanceRow({ channel: 'Бинанс spot USDT', currency: 'USDT' });
  const cash = registry.classifyRawBalanceRow({ channel: 'нал-мам-евро', currency: 'EUR' });
  assert.deepEqual(revolut, { key: 'revolut', role: 'provider_component', status: 'mapped' });
  assert.deepEqual(spot, { key: 'binance_spot', role: 'provider_component', status: 'mapped' });
  assert.deepEqual(cash, { key: 'cash_eur', role: 'legacy', status: 'mapped' });
});
