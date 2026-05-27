import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  buildFetchFxRatesReport,
  parseArgs,
} from "../scripts/fetch-fx-rates.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jsonResponse(payload, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return payload;
    },
  };
}

test("fetch-fx-rates defaults to dry-run and converts Frankfurter USD quotes to rate_to_usd", async () => {
  const options = parseArgs(["--date=2026-05-27", "--currencies=EUR,CAD"]);
  assert.equal(options.dryRun, true);
  assert.equal(options.apply, false);

  const report = await buildFetchFxRatesReport({
    ...options,
    fetchImpl: async (url) => {
      assert.match(String(url), /api\.frankfurter\.dev\/v2\/rates/);
      return jsonResponse([
        { date: "2026-05-27", base: "USD", quote: "EUR", rate: 0.85912 },
        { date: "2026-05-27", base: "USD", quote: "CAD", rate: 1.3807 },
      ]);
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.dry_run, true);
  assert.deepEqual(report.rows.map((row) => row.currency), ["EUR", "CAD"]);
  assert.equal(report.rows[0].base_currency, "USD");
  assert.equal(report.rows[0].rate_to_usd, 1.163982);
  assert.equal(report.rows[0].source, "frankfurter");
  assert.match(report.rows[0].source_url, /^https:\/\/api\.frankfurter\.dev/);
  assert.equal(report.apply_result.applied, false);
});

test("fetch-fx-rates provider errors are structured JSON-safe objects", async () => {
  const report = await buildFetchFxRatesReport({
    date: "2026-05-27",
    currencies: ["EUR"],
    dryRun: true,
    apply: false,
    fetchImpl: async () => jsonResponse({ message: "provider down token=secret" }, { ok: false, status: 503 }),
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.error, {
    code: "provider_error",
    message: "provider down token=[redacted]",
    source: "frankfurter",
    date: "2026-05-27",
    currency: "EUR",
  });
});

test("fetch-fx-rates apply errors are structured JSON-safe objects", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  try {
    const report = await buildFetchFxRatesReport({
      date: "2026-05-27",
      currencies: ["EUR"],
      dryRun: false,
      apply: true,
      fetchImpl: async () => jsonResponse([{ date: "2026-05-27", base: "USD", quote: "EUR", rate: 0.85912 }]),
    });

    assert.equal(report.ok, false);
    assert.equal(report.error.code, "api_error");
    assert.equal(report.error.source, "google_sheets");
    assert.match(report.error.message, /credentials are not configured/);
    assert.equal(report.apply_result.applied, false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE KEY|Bearer/i);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("fetch-fx-rates apply writes only FX Rates sheet", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "fx-rates-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const writes = [];

  try {
    const report = await buildFetchFxRatesReport({
      date: "2026-05-27",
      currencies: ["EUR"],
      dryRun: false,
      apply: true,
      fetchImpl: async (url, options = {}) => {
        const textUrl = String(url);
        if (textUrl.includes("api.frankfurter.dev")) {
          return jsonResponse([{ date: "2026-05-27", base: "USD", quote: "EUR", rate: 0.85912 }]);
        }
        if (textUrl.includes("oauth2.googleapis.com")) {
          return jsonResponse({ access_token: "token" });
        }
        if (textUrl.endsWith("/spreadsheets/1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY")) {
          return jsonResponse({ sheets: [] });
        }
        if (textUrl.endsWith(":batchUpdate")) {
          writes.push({ url: textUrl, body: JSON.parse(options.body) });
          return jsonResponse({ replies: [{ addSheet: { properties: { sheetId: 123, title: "FX Rates" } } }] });
        }
        if (textUrl.includes("/values/")) {
          writes.push({ url: textUrl, body: options.body ? JSON.parse(options.body) : null, method: options.method });
          if (options.method === "GET") return jsonResponse({ values: [] });
          return jsonResponse({ updatedRange: "'FX Rates'!A1:I2", updates: { updatedRows: 2 } });
        }
        throw new Error(`Unexpected URL: ${textUrl}`);
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.apply_result.applied, true);
    assert.ok(writes.length >= 2);
    assert.ok(writes.every((write) => decodeURIComponent(JSON.stringify(write)).includes("FX Rates")));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE KEY|secret|Bearer/i);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});
