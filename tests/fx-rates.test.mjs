import test from "node:test";
import assert from "node:assert/strict";

import {
  FX_RATES_HEADERS,
  buildFxRateLookup,
  ensureFxRates,
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

test("previous_available FX Rates rows are frozen usable diagnostics", () => {
  const parsed = parseFxRateRows([
    FX_RATES_HEADERS,
    ["2026-05-28", "EUR", "USD", "1.164", "frankfurter", "", "2026-05-28T07:00:00Z", "previous_available", "previous_available_rate from 2026-05-27; exact unavailable at fetch time"],
  ]);
  const lookup = buildFxRateLookup(parsed.rates);

  assert.equal(parsed.rates.length, 1);
  assert.deepEqual(parsed.diagnostics.status_counts, { previous_available: 1 });
  assert.deepEqual(resolveFrozenFxRate(lookup, { date: "2026-05-28", currency: "EUR" }), {
    ok: true,
    date: "2026-05-28",
    currency: "EUR",
    base_currency: "USD",
    rate_to_usd: 1.164,
    source: "frankfurter",
    source_url: "",
    fetched_at: "2026-05-28T07:00:00Z",
    status: "previous_available",
    comment: "previous_available_rate from 2026-05-27; exact unavailable at fetch time",
  });
});

test("ensureFxRates fetches and saves only missing provider currency dates", async () => {
  const calls = [];
  const applied = [];
  const result = await ensureFxRates({
    from: "2026-05-27",
    to: "2026-05-28",
    currencies: ["EUR", "CAD", "USD", "LOCAL", "UNKNOWN"],
    currentDate: "2026-05-28",
    fetchedAt: "2026-05-28T08:00:00Z",
    readFxRateSheetValues: async () => ([
      FX_RATES_HEADERS,
      ["2026-05-27", "EUR", "USD", "1.16", "frankfurter", "", "2026-05-27T08:00:00Z", "ok", ""],
      ["2026-05-27", "CAD", "USD", "0.72", "frankfurter", "", "2026-05-27T08:00:00Z", "ok", ""],
    ]),
    fetchFxRowsForDate: async ({ date, currencies }) => {
      calls.push({ date, currencies });
      return currencies.map((currency) => ({
        date,
        currency,
        base_currency: "USD",
        rate_to_usd: currency === "EUR" ? 1.17 : 0.73,
        source: "frankfurter",
        source_url: "https://api.example/fx",
        fetched_at: "2026-05-28T08:00:00Z",
        status: "ok",
        comment: "rate_to_usd derived from Frankfurter USD quote.",
      }));
    },
    applyFxRateRows: async (rows) => {
      applied.push(...rows);
      return { applied: true, rows_written: rows.length, target_sheet: "FX Rates" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.checked, 4);
  assert.equal(result.fetched_rows, 2);
  assert.equal(result.fallback_rows, 0);
  assert.equal(result.missing_after_ensure, 0);
  assert.deepEqual(calls, [{ date: "2026-05-28", currencies: ["EUR", "CAD"] }]);
  assert.deepEqual(applied.map((row) => `${row.date}|${row.currency}`), ["2026-05-28|EUR", "2026-05-28|CAD"]);
});

test("ensureFxRates uses previous available rate only for current date provider misses", async () => {
  const applied = [];
  const result = await ensureFxRates({
    from: "2026-05-28",
    to: "2026-05-28",
    currencies: ["EUR"],
    currentDate: "2026-05-28",
    fetchedAt: "2026-05-28T08:00:00Z",
    readFxRateSheetValues: async () => ([
      FX_RATES_HEADERS,
      ["2026-05-27", "EUR", "USD", "1.16", "frankfurter", "https://api.example/prev", "2026-05-27T08:00:00Z", "ok", ""],
    ]),
    fetchFxRowsForDate: async () => {
      throw new Error("Missing Frankfurter rate for EUR");
    },
    applyFxRateRows: async (rows) => {
      applied.push(...rows);
      return { applied: true, rows_written: rows.length, target_sheet: "FX Rates" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fetched_rows, 0);
  assert.equal(result.fallback_rows, 1);
  assert.equal(result.missing_after_ensure, 0);
  assert.equal(applied[0].status, "previous_available");
  assert.equal(applied[0].rate_to_usd, 1.16);
  assert.equal(applied[0].comment, "previous_available_rate from 2026-05-27; exact unavailable at fetch time");
});

test("ensureFxRates does not use previous available rate for historical provider misses", async () => {
  let applyCalled = false;
  const result = await ensureFxRates({
    from: "2026-05-28",
    to: "2026-05-28",
    currencies: ["EUR"],
    currentDate: "2026-05-29",
    fetchedAt: "2026-05-29T08:00:00Z",
    readFxRateSheetValues: async () => ([
      FX_RATES_HEADERS,
      ["2026-05-27", "EUR", "USD", "1.16", "frankfurter", "", "2026-05-27T08:00:00Z", "ok", ""],
    ]),
    fetchFxRowsForDate: async () => {
      throw new Error("Missing Frankfurter rate for EUR");
    },
    applyFxRateRows: async () => {
      applyCalled = true;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallback_rows, 0);
  assert.equal(result.missing_after_ensure, 1);
  assert.equal(result.errors[0].date, "2026-05-28");
  assert.equal(applyCalled, false);
});
