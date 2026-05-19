import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

import handler from "../api/index.js";
import {
  AUTO_BALANCE_SHEET_NAME,
  collectProviderBalanceRows,
  mergeBalanceRowsByDateChannelCurrency,
  runAutoBalanceSnapshots,
} from "../server/auto-balance-snapshots.js";

const root = path.join(import.meta.dirname, "..");
const MANUAL_SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const ENCODED_AUTO_RANGE = "'%D0%90%D0%B2%D1%82%D0%BE%20%D0%9E%D1%81%D1%82%D0%B0%D1%82%D0%BA%D0%B8'!A%3AL";

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
    async text() {
      return JSON.stringify(payload);
    },
    headers: { get: () => "" },
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

test("provider unavailable creates dated status rows instead of fake zero rows", async () => {
  const result = await runAutoBalanceSnapshots({
    query: { date: "2026-05-17", dryRun: "1" },
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called without provider credentials in dry-run collection");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved_rows, 0);
  assert.equal(result.target_sheet, AUTO_BALANCE_SHEET_NAME);
  assert.ok(result.rows_preview.length > 0);
  assert.equal(result.provider_current_balance_status.wise, "needs_permission");
  assert.equal(result.provider_current_balance_status.monobank, "needs_permission");
  assert.deepEqual(Object.keys(result.provider_current_balance_status).sort(), [
    "binance",
    "monobank",
    "payoneer",
    "paypal",
    "privatbank",
    "revolut",
    "tdbank",
    "wise",
    "yoomoney",
  ]);

  const paypalRows = result.rows_preview.filter((row) => row.provider === "paypal");
  assert.deepEqual(paypalRows.map((row) => `${row.channel}|${row.currency}|${row.status}|${row.amount}`), [
    "пейпал дол|USD|needs_provider_permission|",
    "пейпал евр|EUR|needs_provider_permission|",
    "пейпал сad|CAD|needs_provider_permission|",
  ]);
  assert.equal(paypalRows.every((row) => row.date === "2026-05-17"), true);
});

test("same date provider channel currency replaces existing auto row without deleting another currency", () => {
  const merged = mergeBalanceRowsByDateChannelCurrency(
    [
      { date: "2026-05-17", provider: "wise", channel: "трансервайз дол", amount: "1", currency: "USD", rate: "1", amountUsd: "1", source: "wise_auto", rawSourceId: "old-usd", status: "ok", comment: "old" },
      { date: "2026-05-17", provider: "wise", channel: "трансервайз евро", amount: "2", currency: "EUR", rate: "1,16", amountUsd: "2,32", source: "wise_auto", rawSourceId: "old-eur", status: "ok", comment: "old" },
    ],
    [
      { date: "2026-05-17", provider: "wise", channel: "трансервайз дол", amount: "9", currency: "USD", rate: "1", amountUsd: "9", source: "wise_auto", rawSourceId: "new-usd", status: "ok", comment: "auto daily provider snapshot" },
    ]
  );

  assert.deepEqual(merged.map((row) => `${row.provider}|${row.channel}|${row.currency}|${row.amount}|${row.rawSourceId}`), [
    "wise|трансервайз евро|EUR|2|old-eur",
    "wise|трансервайз дол|USD|9|new-usd",
  ]);
});

test("Wise and Monobank balances produce complete expected provider rows, including zero/missing rows", async () => {
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
        { id: "wise-gbp", currency: "GBP", availableAmount: { value: 0, currency: "GBP" } },
      ]);
    }
    if (value.endsWith("/personal/client-info")) {
      return jsonResponse({
        accounts: [
          { id: "mono-uah", currencyCode: 980, balance: 0 },
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
  assert.deepEqual(rows.filter((row) => row.provider === "wise").map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.status}`), [
    "трансервайз дол|USD|120,45|ok",
    "трансервайз евро|EUR||missing_provider_balance",
  ]);
  assert.deepEqual(rows.filter((row) => row.provider === "monobank").map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.status}`), [
    "монобанк грн|UAH|0|zero_balance",
  ]);
  assert.equal(results.find((result) => result.provider === "monobank")?.skipped_rows.length, 1);
  assert.equal(results.find((result) => result.provider === "wise")?.skipped_rows.length, 1);
});

test("Binance, YooMoney, and PayPal current balance APIs produce provider snapshot rows", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, method: options.method || "GET" });
    if (value.includes("/api/v3/account")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            balances: [
              { asset: "USDT", free: "100.25", locked: "2.75" },
              { asset: "BTC", free: "1", locked: "0" },
            ],
          });
        },
      };
    }
    if (value.endsWith("/api/account-info")) {
      return jsonResponse({ account: "4100", balance: "1234.56", currency: "643" });
    }
    if (value.endsWith("/v1/oauth2/token")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ access_token: "paypal-token" });
        },
      };
    }
    if (value.includes("/v1/reporting/balances")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            balances: [
              { available_balance: { value: "10.50", currency_code: "USD" } },
              { available_balance: { value: "0", currency_code: "EUR" } },
            ],
          });
        },
      };
    }
    throw new Error(`Unexpected URL ${value}`);
  };

  const results = await collectProviderBalanceRows({
    date: "2026-05-19",
    env: {
      BINANCE_API_KEY: "binance-key",
      BINANCE_API_SECRET: "binance-secret",
      YOOMONEY_ACCESS_TOKEN: "yoomoney-token",
      PAYPAL_CLIENT_ID: "paypal-client",
      PAYPAL_CLIENT_SECRET: "paypal-secret",
    },
    fetchImpl,
  });
  const rows = results.flatMap((result) => result.rows);

  assert.ok(calls.some((call) => call.url.includes("/api/v3/account")));
  assert.ok(calls.some((call) => call.url.endsWith("/api/account-info")));
  assert.ok(calls.some((call) => call.url.includes("/v1/reporting/balances")));
  assert.deepEqual(rows.filter((row) => row.provider === "binance").map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.status}`), [
    "Бинанс spot|USDT|103|ok",
    "binance save|USDT||provider_not_implemented",
  ]);
  assert.deepEqual(rows.filter((row) => row.provider === "yoomoney").map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.status}`), [
    "Яндекс руб|RUB|1234,56|ok",
  ]);
  assert.deepEqual(rows.filter((row) => row.provider === "paypal").map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.status}`), [
    "пейпал дол|USD|10,5|ok",
    "пейпал евр|EUR|0|zero_balance",
    "пейпал сad|CAD||missing_provider_balance",
  ]);
});

test("PayPal balances permission errors become structured status rows", async () => {
  const results = await collectProviderBalanceRows({
    date: "2026-05-19",
    env: {
      PAYPAL_CLIENT_ID: "paypal-client",
      PAYPAL_CLIENT_SECRET: "paypal-secret",
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/v1/oauth2/token")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ access_token: "paypal-token" });
          },
        };
      }
      if (value.includes("/v1/reporting/balances")) {
        return {
          ok: false,
          status: 403,
          async text() {
            return "<html>Forbidden</html>";
          },
        };
      }
      throw new Error(`Unexpected URL ${value}`);
    },
  });
  const paypal = results.find((result) => result.provider === "paypal");

  assert.equal(paypal.provider_current_balance_status, "needs_permission");
  assert.deepEqual(paypal.rows.map((row) => row.status), [
    "needs_permission",
    "needs_permission",
    "needs_permission",
  ]);
  assert.match(paypal.error, /PayPal balances request failed \(403\)/);
});

test("non-JSON provider response becomes structured JSON error rows", async () => {
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
    async text() {
      return "not json";
    },
    headers: { get: () => "" },
  });

  try {
    await handler(request, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.body.ok, true);
    assert.equal(response.body.target_sheet, AUTO_BALANCE_SHEET_NAME);
    assert.equal(response.body.provider_current_balance_status.wise, "error");
    assert.ok(response.body.rows_preview.some((row) => row.provider === "wise" && row.status === "provider_error"));
    assert.match(response.body.warnings.join("\n"), /Wise request failed \(502\)/);
  } finally {
    global.fetch = previousFetch;
    restoreEnv("WISE_API_TOKEN", previousWiseToken);
    restoreEnv("WISE_PROFILE_ID", previousWiseProfile);
  }
});

test("auto snapshot save writes merged Авто Остатки values through Google Sheets", async () => {
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
    if (value.endsWith(`/spreadsheets/${MANUAL_SPREADSHEET_ID}`)) {
      return jsonResponse({ sheets: [{ properties: { title: AUTO_BALANCE_SHEET_NAME } }] });
    }
    if (value.includes(`/values/${ENCODED_AUTO_RANGE}`) && (!options.method || options.method === "GET")) {
      return jsonResponse({
        values: [
          ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"],
          ["2026-05-17", "wise", "трансервайз дол", "1", "USD", "1", "1", "wise_auto", "old", "wise:old", "ok", "old"],
        ],
      });
    }
    if (value.includes(`/values/${ENCODED_AUTO_RANGE}?valueInputOption=USER_ENTERED`)) {
      writes.push(JSON.parse(options.body).values);
      return jsonResponse({ updatedRows: 3 });
    }
    if (value.includes("%D0%9E%D1%81%D1%82%D0%B0%D1%82%D0%BA%D0%B8")) {
      throw new Error("Auto snapshot must not write to manual Остатки sheet");
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

    assert.ok(result.saved_rows > 1);
    assert.equal(result.save.sheetName, AUTO_BALANCE_SHEET_NAME);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0][0], "date");
    assert.ok(writes[0].some((row) => row[1] === "wise" && row[2] === "трансервайз дол" && row[3] === "120,45" && row[10] === "ok"));
    assert.ok(writes[0].some((row) => row[1] === "wise" && row[2] === "трансервайз евро" && row[10] === "missing_provider_balance"));
    assert.ok(writes[0].some((row) => row[1] === "paypal" && row[2] === "пейпал дол" && row[10] === "needs_provider_permission"));
  } finally {
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", previousEmail);
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", previousKey);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
