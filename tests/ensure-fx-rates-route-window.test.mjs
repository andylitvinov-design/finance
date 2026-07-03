import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FX_LOOKBACK_DAYS,
  normalizeLookbackDays,
  resolveEnsureFxWindow,
  shiftIsoDate,
} from "../server/ensure-fx-rates-route.js";

test("cron-style call without params covers a lookback window ending today", () => {
  const window = resolveEnsureFxWindow({ todayIso: "2026-07-03" });
  assert.equal(window.currentDate, "2026-07-03");
  assert.equal(window.from, "2026-06-26");
  assert.equal(window.to, "2026-07-03");
  assert.equal(window.lookbackDays, DEFAULT_FX_LOOKBACK_DAYS);
});

test("explicit from/to are respected unchanged", () => {
  const window = resolveEnsureFxWindow({
    query: { from: "2026-07-01", to: "2026-07-02" },
    todayIso: "2026-07-03",
  });
  assert.equal(window.from, "2026-07-01");
  assert.equal(window.to, "2026-07-02");
});

test("explicit from without to keeps single-day behavior", () => {
  const window = resolveEnsureFxWindow({
    query: { from: "2026-07-01" },
    todayIso: "2026-07-03",
  });
  assert.equal(window.from, "2026-07-01");
  assert.equal(window.to, "2026-07-01");
});

test("lookbackDays=0 restores today-only behavior", () => {
  const window = resolveEnsureFxWindow({
    query: { lookbackDays: "0" },
    todayIso: "2026-07-03",
  });
  assert.equal(window.from, "2026-07-03");
  assert.equal(window.to, "2026-07-03");
});

test("lookbackDays is clamped and invalid values fall back to default", () => {
  assert.equal(normalizeLookbackDays("500"), 31);
  assert.equal(normalizeLookbackDays("abc"), DEFAULT_FX_LOOKBACK_DAYS);
  assert.equal(normalizeLookbackDays(-3), DEFAULT_FX_LOOKBACK_DAYS);
  assert.equal(normalizeLookbackDays(undefined), DEFAULT_FX_LOOKBACK_DAYS);
});

test("shiftIsoDate handles month boundaries in UTC", () => {
  assert.equal(shiftIsoDate("2026-07-03", -7), "2026-06-26");
  assert.equal(shiftIsoDate("2026-01-01", -1), "2025-12-31");
});

test("explicit currentDate from query anchors the window", () => {
  const window = resolveEnsureFxWindow({
    query: { currentDate: "2026-06-15", lookbackDays: "2" },
    todayIso: "2026-07-03",
  });
  assert.equal(window.from, "2026-06-13");
  assert.equal(window.to, "2026-06-15");
});
