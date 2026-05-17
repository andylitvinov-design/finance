import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

import handler from "../api/index.js";
import {
  collectProviderBalanceRows,
  mergeBalanceRowsByDateChannelCurrency,
  runAutoBalanceSnapshots,
} from "../server/auto-balance-snapshots.js";

const root = path.join(import.meta.dirname, "..");

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test("vercel cron points daily UTC schedule to auto balance snapshots endpoint", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(config.crons, [
    {
      path: "/api/auto-balance-snapshots",
      schedule: "0 0 * * *",
    },
  ]);
  assert.ok(config.rewrites.some((rewrite) =>
    rewrite.source === "/api/auto-balance-snapshots" &&
    rewrite.destination === "/api/index?action=autoBalanceSnapshots"
  ));
  assert.deepEqual(config.regions, ["fra1"]);
});

test("provider unavailable does not write zero rows", async () => {
  const result = await runAutoBalanceSnapshots({
    query: { date: "2026-05-17" },
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called without provider credentials");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved_rows, 0);
  assert.equal(result.rows_preview.length, 0);
  assert.equal(result.provider_current_balance_status.wise, "needs_permission");
  assert.equal(result.provider_current_balance_status.monobank, "needs_permission");
  assert.match(result.warnings.join("\n"), /No provider returned/);
});

test("same date channel currency replaces existing row without deleting another currency", () => {
  const merged = mergeBalanceRowsByDateChannelCurrency(
    [
      { date: "2026-05-17", channel: "трансервайз дол", amount: "1", currency: "USD", rate: "1", usdAmount: "1", comment: "manual" },
      { date: "2026-05-17", channel: "трансервайз дол", amount: "2", currency: "EUR", rate: "1,16", usdAmount: "2,32", comment: "manual" },
    ],
    [
      { date: "2026-05-17", channel: "трансервайз дол", amount: "9", currency: "USD", rate: "1", usdAmount: "9", comment: "auto daily provider snapshot" },
    ]
  );

  assert.deepEqual(merged, [
    { date: "2026-05-17", channel: "трансервайз дол", amount: "2", currency: "EUR", rate: "1,16", usdAmount: "2,32", comment: "manual" },
    { date: "2026-05-17", channel: "трансервайз дол", amount: "9", currency: "USD", rate: "1", usdAmount: "9", comment: "auto daily provider snapshot" },
  ]);
});

test("Wise and Monobank real provider balances map to Остатки rows", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.endsWith("/v2/profiles")) {
      return jsonResponse([{ id: 111 }]);
    }
    if (value.includes("/v4/profiles/111/balances")) {
      return jsonResponse([
        { id: "wise-usd", currency: "USD", availableAmount: { value: 120.45, currency: "USD" } },
        { id: "wise-eur", currency: "EUR", availableAmount: { value: 85.5, currency: "EUR" } },
        { id: "wise-gbp", currency: "GBP", availableAmount: { value: 0, currency: "GBP" } },
      ]);
    }
    if (value.endsWith("/personal/client-info")) {
      return jsonResponse({
        accounts: [
          { id: "mono-uah", currencyCode: 980, balance: 123456 },
          { id: "mono-usd", currencyCode: 840, balance: 1000 },
        ],
      });
    }
    throw new Error(`Unexpected URL ${value}`);
  };

  const results = await collectProviderBalanceRows({
    date: "2026-05-17",
    env: {
      WISE_API_TOKEN: "wise-token",
      WISE_PROFILE_ID: "111",
      MONOBANK_API_TOKEN: "mono-token",
    },
    fetchImpl,
  });
  const rows = results.flatMap((result) => result.rows);

  assert.ok(calls.some((url) => url.includes("/v4/profiles/111/balances")));
  assert.deepEqual(rows.map((row) => `${row.channel}|${row.currency}|${row.amount}`), [
    "трансервайз дол|USD|120,45",
    "трансервайз евро|EUR|85,5",
    "монобанк грн|UAH|1234,56",
  ]);
  assert.equal(results.find((result) => result.provider === "monobank")?.skipped_rows.length, 1);
  assert.equal(results.find((result) => result.provider === "wise")?.skipped_rows.length, 1);
  assert.equal(rows.every((row) => row.comment === "auto daily provider snapshot"), true);
});

test("non-JSON provider response becomes structured JSON error", async () => {
  const request = {
    method: "GET",
    query: {
      action: "autoBalanceSnapshots",
      date: "2026-05-17",
      dryRun: "1",
    },
  };
  const response = createResponseRecorder();
  const previousFetch = global.fetch;
  const previousWiseToken = process.env.WISE_API_TOKEN;
  const previousWiseProfile = process.env.WISE_PROFILE_ID;

  process.env.WISE_API_TOKEN = "wise-token";
  process.env.WISE_PROFILE_ID = "111";
  delete process.env.MONOBANK_API_TOKEN;
  global.fetch = async () => ({
    ok: false,
    status: 502,
    async json() {
      throw new Error("not json");
    },
  });

  try {
    await handler(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.body.ok, true);
    assert.equal(response.body.provider_current_balance_status.wise, "error");
    assert.deepEqual(response.body.providers_failed, ["wise", "monobank"]);
    assert.match(response.body.warnings.join("\n"), /Wise request failed \(502\)/);
  } finally {
    global.fetch = previousFetch;
    restoreEnv("WISE_API_TOKEN", previousWiseToken);
    restoreEnv("WISE_PROFILE_ID", previousWiseProfile);
  }
});

test("auto snapshot save writes merged Остатки values through Google Sheets", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "finance@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });

  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    if (value === "https://oauth2.googleapis.com/token") {
      return jsonResponse({ access_token: "sheet-token" });
    }
    if (value.endsWith("/spreadsheets/1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY")) {
      return jsonResponse({ sheets: [{ properties: { title: "Остатки" } }] });
    }
    if (value.includes("/values/'%D0%9E%D1%81%D1%82%D0%B0%D1%82%D0%BA%D0%B8'!A%3AG") && (!options.method || options.method === "GET")) {
      return jsonResponse({
        values: [
          ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
          ["2026-05-17", "трансервайз дол", "1", "USD", "1", "1", "manual"],
        ],
      });
    }
    if (value.includes("/values/'%D0%9E%D1%81%D1%82%D0%B0%D1%82%D0%BA%D0%B8'!A%3AG?valueInputOption=USER_ENTERED")) {
      writes.push(JSON.parse(options.body).values);
      return jsonResponse({ updatedRows: 2 });
    }
    throw new Error(`Unexpected URL ${value}`);
  };

  try {
    const result = await runAutoBalanceSnapshots({
      query: { date: "2026-05-17" },
      env: { WISE_API_TOKEN: "wise-token", WISE_PROFILE_ID: "111" },
      fetchImpl: async (url, options) => {
        const value = String(url);
        if (value.endsWith("/v2/profiles")) return jsonResponse([{ id: 111 }]);
        if (value.includes("/v4/profiles/111/balances")) {
          return jsonResponse([{ id: "wise-usd", currency: "USD", availableAmount: { value: 120.45, currency: "USD" } }]);
        }
        return fetchImpl(url, options);
      },
    });

    assert.equal(result.saved_rows, 1);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], [
      ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
      ["2026-05-17", "трансервайз дол", "120,45", "USD", "1", "120,45", "auto daily provider snapshot"],
    ]);
  } finally {
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", previousEmail);
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", previousKey);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
