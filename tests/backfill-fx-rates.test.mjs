import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBackfillFxRatesReport,
  parseArgs,
} from "../scripts/backfill-fx-rates.mjs";

function jsonResponse(payload, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return payload;
    },
  };
}

test("backfill-fx-rates defaults to dry-run and fetches each date", async () => {
  const options = parseArgs(["--from=2026-05-26", "--to=2026-05-27", "--currencies=EUR,CAD"]);
  assert.equal(options.dryRun, true);
  assert.equal(options.apply, false);
  const fetchedUrls = [];

  const report = await buildBackfillFxRatesReport({
    ...options,
    fetchImpl: async (url) => {
      fetchedUrls.push(String(url));
      const date = new URL(String(url)).searchParams.get("date");
      return jsonResponse([
        { date, base: "USD", quote: "EUR", rate: 0.86 },
        { date, base: "USD", quote: "CAD", rate: 1.38 },
      ]);
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.dry_run, true);
  assert.deepEqual(report.period, { from: "2026-05-26", to: "2026-05-27" });
  assert.equal(fetchedUrls.length, 2);
  assert.equal(report.rows.length, 4);
  assert.equal(report.apply_result.applied, false);
});

test("backfill-fx-rates returns structured provider error and does not apply partial rows", async () => {
  const report = await buildBackfillFxRatesReport({
    from: "2026-05-26",
    to: "2026-05-27",
    currencies: ["EUR"],
    dryRun: false,
    apply: true,
    fetchImpl: async (url) => {
      const date = new URL(String(url)).searchParams.get("date");
      if (date === "2026-05-26") {
        return jsonResponse([{ date, base: "USD", quote: "EUR", rate: 0.86 }]);
      }
      return jsonResponse({ message: "bad gateway api_key=abc" }, { ok: false, status: 502 });
    },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.error, {
    code: "provider_error",
    message: "bad gateway api_key=[redacted]",
    source: "frankfurter",
    date: "2026-05-27",
    currency: "EUR",
  });
  assert.equal(report.apply_result.applied, false);
});

test("backfill-fx-rates returns structured apply error", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  try {
    const report = await buildBackfillFxRatesReport({
      from: "2026-05-27",
      to: "2026-05-27",
      currencies: ["EUR"],
      dryRun: false,
      apply: true,
      fetchImpl: async (url) => {
        const date = new URL(String(url)).searchParams.get("date");
        return jsonResponse([{ date, base: "USD", quote: "EUR", rate: 0.86 }]);
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.error.code, "api_error");
    assert.equal(report.error.source, "google_sheets");
    assert.match(report.error.message, /credentials are not configured/);
    assert.equal(report.apply_result.applied, false);
    assert.equal(report.apply_result.target_sheet, "FX Rates");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});
