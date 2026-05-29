const fs = require('fs');

function read(p){ return fs.readFileSync(p, 'utf8'); }
function write(p,s){ fs.writeFileSync(p, s); }
function replaceOnce(p, from, to){
  let s = read(p);
  if (s.includes(to)) return false;
  if (!s.includes(from)) throw new Error(`pattern not found in ${p}`);
  write(p, s.replace(from, to));
  return true;
}
function appendOnce(p, marker, text){
  let s = read(p);
  if (s.includes(marker)) return false;
  write(p, `${s.trimEnd()}\n\n${text.trim()}\n`);
  return true;
}

let changed = false;

changed = replaceOnce(
  'server/auto-balance-snapshots.js',
`  {
    provider: "binance",
    channel: "binance save",
    currency: "USDC",
    source: "binance_auto",
    active: false,
    inactive_reason: "Binance Earn USDC current-balance row is status-only missing_provider_balance; no trusted numeric anchor exists",
  },`,
`  {
    provider: "binance",
    channel: "binance save",
    currency: "USDC",
    source: "binance_auto",
    active_from: "2026-05-28",
    inactive_reason: "Binance Earn USDC numeric current-balance anchor starts on 2026-05-28 from owner/provider-confirmed snapshot.",
  },`
) || changed;

let p = 'server/period-balance-reconciliation-engine.js';
let s = read(p);
if (!s.includes('function isBinanceInternalTransfer')) {
  s = s.replace(
`  if (!toChannel || !fromChannel) return null;
  if (hasOppositeTransferLeg(row, { date, currency, amount: Math.abs(balanceAmount), operations })) return null;`,
`  if (!toChannel || !fromChannel) return null;
  if (isBinanceInternalTransfer(row)) return null;
  if (hasOppositeTransferLeg(row, { date, currency, amount: Math.abs(balanceAmount), operations })) return null;`
  );
  s = s.replace(
`function hasOppositeTransferLeg(row, { date, currency, amount, operations }) {`,
`function isBinanceInternalTransfer(row = {}) {
  const ledger = row?.ledgerV2 || {};
  const fromChannel = normalizeBinanceTransferText(ledger.from_channel || row?.fromChannel || "");
  const toChannel = normalizeBinanceTransferText(ledger.to_channel || row?.toChannel || "");
  const comment = normalizeBinanceTransferText(String(ledger.comment || row?.comment || "") + " " + String(ledger.raw_source_id || row?.rawSourceId || row?.raw_source_id || ""));
  const looksInternal = /funding transfer|simple earn|earn redemption|redeem|redemption|subscription|spot funding|funding spot|save|earn/.test(comment);
  return isBinanceLikeChannel(fromChannel) && isBinanceLikeChannel(toChannel) && looksInternal;
}

function isBinanceLikeChannel(channel = "") {
  return /binance|бинанс|spot|funding|save|earn/.test(normalizeBinanceTransferText(channel));
}

function normalizeBinanceTransferText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function hasOppositeTransferLeg(row, { date, currency, amount, operations }) {`
  );
  changed = true;
}

s = read(p);
if (!s.includes('function excludeLegacyBinanceRowsWhenSplitRowsExist')) {
  const start = s.indexOf('function buildTotalUsdRow(rows = []) {');
  const end = s.indexOf('function getRowChangeUsd(row)', start);
  if (start < 0 || end < 0) throw new Error('buildTotalUsdRow block not found');
  let block = s.slice(start, end);
  block = block.replace('for (const row of rows || []) {', 'for (const row of excludeLegacyBinanceRowsWhenSplitRowsExist(rows) || []) {');
  const helper = `
function excludeLegacyBinanceRowsWhenSplitRowsExist(rows = []) {
  const hasSplitBinanceRows = rows.some((row) => {
    const channel = normalizeBinanceTransferText(row?.channel);
    const currency = String(row?.currency || "").trim().toUpperCase();
    return ["USD", "USDT", "USDC"].includes(currency) && (
      channel.includes("binance save") ||
      channel.includes("бинанс spot") ||
      channel.includes("binance spot")
    );
  });
  if (!hasSplitBinanceRows) return rows;
  return rows.filter((row) => {
    const text = normalizeBinanceTransferText(String(row?.channel || "") + " " + String(row?.source || "") + " " + String(row?.sourceComment || "") + " " + String(row?.source_comment || "") + " " + String(row?.fact_source || "") + " " + String(row?.comment || ""));
    return !(text.includes("legacy combined binance spot funding") || text.includes("legacy_combined_binance_spot_funding"));
  });
}

`;
  s = s.slice(0, start) + block + helper + s.slice(end);
  write(p, s);
  changed = true;
}

changed = appendOnce('tests/auto-balance-snapshots.test.mjs', 'binance save USDC expected balance is active from 2026-05-28', `
test("binance save USDC expected balance is active from 2026-05-28", () => {
  const usdc = EXPECTED_PROVIDER_BALANCES.find((row) => row.provider === "binance" && row.channel === "binance save" && row.currency === "USDC");
  assert.ok(usdc);
  assert.equal(usdc.active, undefined);
  assert.equal(usdc.active_from, "2026-05-28");
});
`) || changed;

changed = appendOnce('tests/period-balance-reconciliation-engine.test.mjs', 'does not synthesize Binance internal wallet transfers', `
test("does not synthesize Binance internal wallet transfers", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [{
      date: "2026-06-10",
      fromChannel: "Binance funding",
      toChannel: "binance save",
      currency: "USDT",
      amountNet: "500",
      balanceAmount: -500,
      comment: "funding transfer simple earn redemption",
      ledgerV2: { date: "2026-06-10", operation: "transfer", from_channel: "Binance funding", to_channel: "binance save", currency: "USDT", amount_net: "500", balance_amount: -500, comment: "funding transfer simple earn redemption" },
    }],
    balanceRows: [
      { date: "2026-06-01", channel: "Binance funding", currency: "USDT", amount: 500, amount_usd: 500 },
      { date: "2026-06-30", channel: "Binance funding", currency: "USDT", amount: 0, amount_usd: 0 },
      { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: 1000, amount_usd: 1000 },
      { date: "2026-06-30", channel: "binance save", currency: "USDT", amount: 1000, amount_usd: 1000 },
    ],
  });
  const save = result.by_channel_currency.find((row) => row.channel === "binance save" && row.currency === "USDT");
  assert.equal(save.transfer_in, 0);
});

test("total USD excludes legacy combined Binance row when split rows exist", () => {
  const result = buildPeriodBalanceReconciliation({
    period: { from: "2026-06-01", to: "2026-06-30" },
    operations: [],
    balanceRows: [
      { date: "2026-06-01", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: 345, amount_usd: 345, source: "legacy_combined_binance_spot_funding" },
      { date: "2026-06-30", channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: 345, amount_usd: 345, source: "legacy_combined_binance_spot_funding" },
      { date: "2026-06-01", channel: "binance save", currency: "USDT", amount: 7432, amount_usd: 7432 },
      { date: "2026-06-30", channel: "binance save", currency: "USDT", amount: 5412, amount_usd: 5412 },
      { date: "2026-06-30", channel: "binance save", currency: "USDC", amount: 2020, amount_usd: 2020 },
      { date: "2026-06-01", channel: "Бинанс spot", currency: "USDT", amount: 1093, amount_usd: 1093 },
      { date: "2026-06-30", channel: "Бинанс spot", currency: "USDT", amount: 1162, amount_usd: 1162 },
    ],
  });
  assert.equal(result.total_usd_row.confirmed_end_usd, 8594);
});
`) || changed;

if (!changed) console.log('No changes needed.');
else console.log('Binance May gap patch applied.');
