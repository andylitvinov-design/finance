import test from "node:test";
import assert from "node:assert/strict";

import {
  FX_RATES_HEADERS,
  buildFxRateLookup,
  isStableUsdCurrency,
  parseFxRateRows,
  resolveFrozenFxRate,
} from "../server/fx-rates.js";

test("parseFxRateRows accepts only ok USD-base positive exact-date rates", () => {
  const rows = parseFxRateRows([
    FX_RATES_HEADERS,
    ["2026-05-27", "EUR", "USD", "1.164", "frankfurter", "https://api.example/rate", "2026-05-27T10:00:00Z", "ok", "daily close"],
    ["2026-05-27", "CAD", "EUR", "0.72", "frankfurter", "", "2026-05-27T10:00:00Z", "ok", "wrong base"],
    ["2026-05-27", "UAH", "USD", "0", "frankfurter", "", "2026-05-27T10:00:00Z", "ok", "zero rate"],
    ["2026-05-27", "RUB", "USD", "0.014", "frankfurter", "", "2026-05-27T10:00:00Z", "provider_error", "not usable"],
    ["2026-05-28", "EUR", "USD", "1.17", "frankfurter", "", "2026-05-28T10:00:00Z", "ok", "next day"],
  ]);

  assert.equal(rows.rates.length, 2);
  assert.deepEqual(rows.rates.map((row) => `${row.date}|${row.currency}`), ["2026-05-27|EUR", "2026-05-28|EUR"]);
  assert.equal(rows.diagnostics.invalid_rows.length, 3);
  assert.deepEqual(rows.diagnostics.status_counts, { ok: 2, invalid_base_currency: 1, invalid_rate: 1, provider_error: 1 });
});

test("resolveFrozenFxRate requires exact date and currency match", () => {
  const parsed = parseFxRateRows([
    FX_RATES_HEADERS,
    ["2026-05-26", "EUR", "USD", "1.15", "frankfurter", "", "2026-05-26T10:00:00Z", "ok", ""],
    ["2026-05-27", "EUR", "USD", "1.164", "frankfurter", "", "2026-05-27T10:00:00Z", "ok", ""],
  ]);
  const lookup = buildFxRateLookup(parsed.rates);

  assert.deepEqual(resolveFrozenFxRate(lookup, { date: "2026-05-27", currency: "EUR" }), {
    ok: true,
    date: "2026-05-27",
    currency: "EUR",
    base_currency: "USD",
    rate_to_usd: 1.164,
    source: "frankfurter",
    source_url: "",
    fetched_at: "2026-05-27T10:00:00Z",
    status: "ok",
    comment: "",
  });
  assert.deepEqual(resolveFrozenFxRate(lookup, { date: "2026-05-28", currency: "EUR" }), {
    ok: false,
    status: "needs_fx_rate",
    date: "2026-05-28",
    currency: "EUR",
  });
});

test("stable USD-like currencies are exact matches only", () => {
  assert.equal(isStableUsdCurrency("USD"), true);
  assert.equal(isStableUsdCurrency("USDT"), true);
  assert.equal(isStableUsdCurrency("USDC"), true);
  assert.equal(isStableUsdCurrency("CAD"), false);
  assert.equal(isStableUsdCurrency("usd cash"), false);
});
