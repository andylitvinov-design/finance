import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

import handler from "../api/index.js";
import {
  AUTO_BALANCE_SHEET_NAME,
  EXPECTED_PROVIDER_BALANCES,
  collectProviderBalanceRows,
  buildPayPalManualBalanceRows,
  derivePayPalBalanceRow,
  mergeBalanceRowsByDateChannelCurrency,
  savePayPalManualBalanceRows,
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

test("manual PayPal balance input creates factual auto balance rows including zero CAD", () => {
  const rows = buildPayPalManualBalanceRows({
    date: "2026-05-20",
    USD: "123.45",
    EUR: "67,89",
    CAD: "0",
    comment: "confirmed in PayPal UI",
    fetchedAt: "2026-05-20T10:00:00.000Z",
  });

  assert.deepEqual(rows.map((row) => `${row.provider}|${row.channel}|${row.currency}|${row.amount}|${row.status}|${row.source}|${row.rawSourceId}`), [
    "paypal|пейпал дол|USD|123,45|ok|paypal_manual_balance|paypal_manual_balance:2026-05-20:USD",
    "paypal|пейпал евр|EUR|67,89|ok|paypal_manual_balance|paypal_manual_balance:2026-05-20:EUR",
    "paypal|пейпал сad|CAD|0|zero_balance|paypal_manual_balance|paypal_manual_balance:2026-05-20:CAD",
  ]);
  assert.equal(rows.every((row) => /REST balance API unavailable for personal account/.test(row.comment)), true);
  assert.equal(rows.some((row) => Object.hasOwn(row, "amountNet") || Object.hasOwn(row, "amount_net")), false);
});

test("manual PayPal balance input rejects empty and malformed values", () => {
  assert.throws(
    () => buildPayPalManualBalanceRows({ date: "2026-05-20", USD: "", EUR: "67.89", CAD: "0" }),
    /USD balance is required/
  );
  assert.throws(
    () => buildPayPalManualBalanceRows({ date: "2026-05-20", USD: "123.45", EUR: "not-a-number", CAD: "0" }),
    /EUR balance must be numeric/
  );
  assert.throws(
    () => buildPayPalManualBalanceRows({ date: "20.05.2026", USD: "123.45", EUR: "67.89", CAD: "0" }),
    /date must be YYYY-MM-DD/
  );
});

test("derived PayPal balance uses confirmed opening plus signed Ledger amount_net movements", () => {
  const result = derivePayPalBalanceRow({
    date: "2026-05-20",
    channel: "пейпал дол",
    currency: "USD",
    balances: [
      { date: "2026-05-01", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "100", source: "paypal_manual_balance", status: "ok" },
    ],
    operations: [
      { date: "2026-05-05", fromChannel: "пейпал дол", currency: "USD", amountNet: "20", balanceAmount: -20, sheetRowNumber: 7, ledgerV2: { date: "2026-05-05", operation: "expense", from_channel: "пейпал дол", currency: "USD", amount_net: "20", balance_amount: -20 } },
      { date: "2026-05-06", toChannel: "пейпал дол", currency: "USD", amountNet: "50", balanceAmount: 50, sheetRowNumber: 8, ledgerV2: { date: "2026-05-06", operation: "income", to_channel: "пейпал дол", currency: "USD", amount_net: "50", balance_amount: 50 } },
    ],
  });

  assert.equal(result.row.source, "paypal_derived_balance");
  assert.equal(result.row.status, "derived_from_confirmed_opening");
  assert.equal(result.row.amount, "130");
  assert.equal(result.row.rawSourceId, "paypal_derived_balance:2026-05-20:USD");
  assert.equal(result.opening_date, "2026-05-01");
  assert.equal(result.opening_amount, 100);
  assert.equal(result.ledger_delta, 30);
  assert.equal(result.movement_row_count, 2);
});

test("derived PayPal balance refuses to invent opening balances", () => {
  const result = derivePayPalBalanceRow({
    date: "2026-05-20",
    channel: "пейпал дол",
    currency: "USD",
    balances: [],
    operations: [],
  });

  assert.equal(result.row, undefined);
  assert.equal(result.blocked_reason, "needs_initial_paypal_balance");
  assert.match(result.comment, /Enter one confirmed PayPal opening balance/);
});

test("missing amount_net blocks derived PayPal balance and does not use gross", () => {
  const result = derivePayPalBalanceRow({
    date: "2026-05-20",
    channel: "пейпал евр",
    currency: "EUR",
    balances: [
      { date: "2026-05-01", provider: "paypal", channel: "пейпал евр", currency: "EUR", amount: "100", source: "paypal_manual_balance", status: "ok" },
    ],
    operations: [
      { date: "2026-05-10", fromChannel: "пейпал евр", currency: "EUR", amountGross: "40", amountNet: "", sheetRowNumber: 11, rawSourceId: "paypal-missing-net", ledgerV2: { date: "2026-05-10", operation: "expense", from_channel: "пейпал евр", currency: "EUR", amount_gross: "40", amount_net: "", raw_source_id: "paypal-missing-net" } },
    ],
  });

  assert.equal(result.row, undefined);
  assert.equal(result.blocked_reason, "missing_amount_net");
  assert.deepEqual(result.blocked_rows, [
    { row: 11, date: "2026-05-10", raw_source_id: "paypal-missing-net", reason: "missing_amount_net" },
  ]);
  assert.equal(result.ledger_delta, undefined);
});

test("derived PayPal balance rows are idempotent and preserve OAuth warning rows", () => {
  const warning = { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", amount: "", currency: "USD", source: "paypal_auto", rawSourceId: "paypal:пейпал дол:USD", status: "needs_provider_permission" };
  const derived = { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", amount: "130", currency: "USD", source: "paypal_derived_balance", rawSourceId: "paypal_derived_balance:2026-05-20:USD", status: "derived_from_confirmed_opening" };
  const first = mergeBalanceRowsByDateChannelCurrency([warning], [derived]);
  const second = mergeBalanceRowsByDateChannelCurrency(first, [{ ...derived, amount: "135" }]);

  assert.equal(second.filter((row) => row.rawSourceId === "paypal_derived_balance:2026-05-20:USD").length, 1);
  assert.equal(second.find((row) => row.rawSourceId === "paypal_derived_balance:2026-05-20:USD")?.amount, "135");
  assert.equal(second.some((row) => row.rawSourceId === "paypal:пейпал дол:USD" && row.status === "needs_provider_permission"), true);
});

test("same-date manual PayPal balance blocks lower-priority derived row", () => {
  const result = derivePayPalBalanceRow({
    date: "2026-05-20",
    channel: "пейпал дол",
    currency: "USD",
    balances: [
      { date: "2026-05-01", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "100", source: "paypal_manual_balance", status: "ok" },
      { date: "2026-05-20", provider: "paypal", channel: "пейпал дол", currency: "USD", amount: "130", source: "paypal_manual_balance", status: "ok" },
    ],
    operations: [],
  });

  assert.equal(result.row, undefined);
  assert.equal(result.blocked_reason, "manual_or_provider_balance_exists");
});

test("manual PayPal balance save is idempotent and preserves provider status rows", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "finance@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  let values = [
    ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"],
    ["2026-05-20", "paypal", "пейпал дол", "", "USD", "", "", "paypal_auto", "2026-05-20T00:00:00.000Z", "paypal:пейпал дол:USD", "needs_provider_permission", "PayPal OAuth failed (401): Client Authentication failed"],
    ["2026-05-20", "paypal", "пейпал дол", "999", "USD", "1", "999", "paypal_auto", "2026-05-20T00:00:00.000Z", "paypal-api-usd", "ok", "provider factual API row"],
  ];
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/token")) return jsonResponse({ access_token: "google-token" });
    if (target === `https://sheets.googleapis.com/v4/spreadsheets/${MANUAL_SPREADSHEET_ID}`) {
      return jsonResponse({ sheets: [{ properties: { title: AUTO_BALANCE_SHEET_NAME } }] });
    }
    if (target.includes(`/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${ENCODED_AUTO_RANGE}`) && (options.method || "GET") === "GET") {
      return jsonResponse({ values });
    }
    if (target.includes(`/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${ENCODED_AUTO_RANGE}`) && options.method === "PUT") {
      const payload = JSON.parse(options.body);
      values = payload.values;
      writes.push(payload.values);
      return jsonResponse({ updatedRows: payload.values.length });
    }
    throw new Error(`Unexpected URL ${target}`);
  };

  const input = {
    date: "2026-05-20",
    USD: "123.45",
    EUR: "67.89",
    CAD: "0",
    fetchedAt: "2026-05-20T10:00:00.000Z",
  };

  try {
    const first = await savePayPalManualBalanceRows(input, { fetchImpl });
    const second = await savePayPalManualBalanceRows(input, { fetchImpl });
    const dataRows = values.slice(1);

    assert.equal(first.rowCount, 3);
    assert.equal(first.inserted, 3);
    assert.equal(second.rowCount, 3);
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 3);
    assert.equal(writes.length, 2);
    assert.equal(dataRows.filter((row) => row[9] === "paypal_manual_balance:2026-05-20:USD").length, 1);
    assert.equal(dataRows.some((row) => row[9] === "paypal:пейпал дол:USD" && row[10] === "needs_provider_permission"), true);
    assert.equal(dataRows.some((row) => row[9] === "paypal-api-usd" && row[7] === "paypal_auto" && row[3] === "999"), true);
  } finally {
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", previousEmail);
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", previousKey);
  }
});

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

test("vercel cron closes the Europe/Madrid business day before UTC rollover", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(config.crons, [
    {
      path: "/api/auto-balance-snapshots",
      // 23:01 UTC is after midnight in Europe/Madrid but before UTC date rollover,
      // so todayUtcDate() still equals the business day being closed.
      schedule: "1 23 * * *",
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
    query: { date: "2026-05-17", currentDate: "2026-05-17", dryRun: "1" },
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called without provider credentials in dry-run collection");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved_rows, 0);
  assert.equal(result.target_sheet, AUTO_BALANCE_SHEET_NAME);
  assert.ok(result.rows_preview.length > 0);
  assert.equal(result.rows_preview.length, EXPECTED_PROVIDER_BALANCES.length);
  assert.deepEqual(
    result.rows_preview.map((row) => `${row.provider}|${row.channel}|${row.currency}`).sort(),
    EXPECTED_PROVIDER_BALANCES.map((row) => `${row.provider}|${row.channel}|${row.currency}`).sort()
  );
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

  const revolutRows = result.rows_preview.filter((row) => row.provider === "revolut");
  assert.deepEqual(revolutRows.map((row) => `${row.channel}|${row.currency}|${row.status}|${row.amount}`).sort(), [
    "REVOLUT дол|USD|provider_not_implemented|",
    "REVOLUT евро|EUR|provider_not_implemented|",
    "REVOLUT франк|CHF|provider_not_implemented|",
    "REVOLUT фунт|GBP|provider_not_implemented|",
  ]);
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

test("USDT and USDC auto balance rows use native amount as USD amount", async () => {
  const result = await runAutoBalanceSnapshots({
    query: { date: "2026-05-24", currentDate: "2026-05-24", dryRun: "1" },
    env: {
      BINANCE_API_KEY: "key",
      BINANCE_API_SECRET: "secret",
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/api/v3/account")) {
        return jsonResponse({
          balances: [
            { asset: "USDT", free: "100", locked: "0" },
            { asset: "USDC", free: "7.5", locked: "0" },
          ],
        });
      }
      if (value.includes("/sapi/v1/simple-earn/flexible/position") || value.includes("/sapi/v1/simple-earn/locked/position")) {
        return jsonResponse({ rows: [] });
      }
      return jsonResponse({}, 404);
    },
  });

  const spotUsdt = result.rows_preview.find((row) => row.provider === "binance" && row.channel === "Бинанс spot" && row.currency === "USDT");
  assert.equal(spotUsdt.amount, "100");
  assert.equal(spotUsdt.rate, "1");
  assert.equal(spotUsdt.usdAmount, "100");

  const spotUsdc = result.rows_preview.find((row) => row.provider === "binance" && row.channel === "Бинанс spot" && row.currency === "USDC");
  assert.equal(spotUsdc.amount, "7,5");
  assert.equal(spotUsdc.rate, "1");
  assert.equal(spotUsdc.usdAmount, "7,5");
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
    currentDate: "2026-05-17",
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
    if (value.includes("/sapi/v1/simple-earn/flexible/position")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ rows: [{ asset: "USDT", totalAmount: "7.25", productId: "USDT001" }] });
        },
      };
    }
    if (value.includes("/sapi/v1/simple-earn/locked/position")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ rows: [{ asset: "USDT", amount: "2.75", positionId: 123 }] });
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
    currentDate: "2026-05-19",
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
  assert.ok(calls.some((call) => call.url.includes("/sapi/v1/simple-earn/flexible/position")));
  assert.ok(calls.some((call) => call.url.includes("/sapi/v1/simple-earn/locked/position")));
  assert.ok(calls.some((call) => call.url.endsWith("/api/account-info")));
  assert.ok(calls.some((call) => call.url.includes("/v1/reporting/balances")));
  assert.deepEqual(rows.filter((row) => row.provider === "binance").map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.status}`), [
    "Бинанс spot|USDT|103|ok",
    "Бинанс spot|USDC||missing_provider_balance",
    "Binance funding|USDT||missing_provider_balance",
    "binance save|USDT|10|ok",
    "binance save|USDC||missing_provider_balance",
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

  assert.equal(paypal.provider_current_balance_status, "needs_initial_paypal_balance");
  assert.deepEqual(paypal.rows.slice(0, 3).map((row) => row.status), [
    "needs_provider_permission",
    "needs_provider_permission",
    "needs_provider_permission",
  ]);
  assert.deepEqual(paypal.rows.slice(3).map((row) => `${row.source}|${row.status}`), [
    "paypal_derived_balance|needs_initial_paypal_balance",
    "paypal_derived_balance|needs_initial_paypal_balance",
    "paypal_derived_balance|needs_initial_paypal_balance",
  ]);
  assert.match(paypal.error, /PayPal balances request failed \(403\)/);
});

test("Binance Earn permission failure preserves spot balance and writes save permission status", async () => {
  const results = await collectProviderBalanceRows({
    date: "2026-05-20",
    currentDate: "2026-05-20",
    env: {
      BINANCE_API_KEY: "binance-key",
      BINANCE_API_SECRET: "binance-secret",
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/api/v3/account")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ balances: [{ asset: "USDT", free: "10", locked: "0" }] });
          },
        };
      }
      if (value.includes("/sapi/v1/simple-earn/")) {
        return {
          ok: false,
          status: 403,
          async text() {
            return JSON.stringify({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." });
          },
        };
      }
      throw new Error(`Unexpected URL ${value}`);
    },
  });
  const binance = results.find((result) => result.provider === "binance");

  assert.equal(binance.provider_current_balance_status, "available");
  assert.deepEqual(binance.rows.map((row) => `${row.channel}|${row.currency}|${row.amount}|${row.status}`), [
    "Бинанс spot|USDT|10|ok",
    "Бинанс spot|USDC||missing_provider_balance",
    "Binance funding|USDT||missing_provider_balance",
    "binance save|USDT||needs_provider_permission",
    "binance save|USDC||needs_provider_permission",
  ]);
});

test("Binance Earn flexible and locked positions normalize into one save row", async () => {
  const results = await collectProviderBalanceRows({
    date: "2026-05-20",
    currentDate: "2026-05-20",
    env: {
      BINANCE_API_KEY: "binance-key",
      BINANCE_API_SECRET: "binance-secret",
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/api/v3/account")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ balances: [{ asset: "USDT", free: "0", locked: "0" }] });
          },
        };
      }
      if (value.includes("/sapi/v1/simple-earn/flexible/position")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ rows: [
              { asset: "USDT", totalAmount: "11.5" },
              { asset: "USDC", totalAmount: "4.25" },
            ] });
          },
        };
      }
      if (value.includes("/sapi/v1/simple-earn/locked/position")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ rows: [
              { asset: "USDT", amount: "3.25" },
              { asset: "USDC", amount: "2" },
            ] });
          },
        };
      }
      throw new Error(`Unexpected URL ${value}`);
    },
  });
  const saveRows = results.find((result) => result.provider === "binance").rows.filter((row) => row.channel === "binance save");

  assert.deepEqual(saveRows.map((row) => `${row.currency}|${row.amount}|${row.usdAmount}|${row.status}`), [
    "USDT|14,75|14,75|ok",
    "USDC|6,25|6,25|ok",
  ]);
});

test("non-JSON provider response becomes structured JSON error rows", async () => {
  const request = {
    method: "GET",
    query: {
      action: "autoBalanceSnapshots",
      date: "2026-05-17",
      currentDate: "2026-05-17",
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
          ["2026-05-16", "payoneer", "Payoneer - dol", "", "USD", "1", "", "payoneer_auto", "old", "payoneer:Payoneer - dol:USD", "provider_not_implemented", "existing status"],
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
      query: { date: "2026-05-17", currentDate: "2026-05-17" },
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
    assert.ok(writes[0].some((row) => row[0] === "2026-05-16" && row[1] === "payoneer" && row[2] === "Payoneer - dol" && row[3] === "" && row[10] === "provider_not_implemented"));
  } finally {
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", previousEmail);
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", previousKey);
  }
});

test("current-only providers do not write amount rows for historical dates", async () => {
  const results = await collectProviderBalanceRows({
    date: "2026-05-20",
    currentDate: "2026-05-21",
    env: {
      WISE_API_TOKEN: "wise-token",
      WISE_PROFILE_ID: "111",
      MONOBANK_API_TOKEN: "mono-token",
      YOOMONEY_ACCESS_TOKEN: "yoomoney-token",
      BINANCE_API_KEY: "binance-key",
      BINANCE_API_SECRET: "binance-secret",
    },
    fetchImpl: async (url) => {
      throw new Error(`Current-only historical guard should not call provider API: ${url}`);
    },
  });

  for (const provider of ["wise", "monobank", "yoomoney", "binance"]) {
    const result = results.find((row) => row.provider === provider);
    assert.equal(result.provider_current_balance_status, "current_only_not_historical");
    assert.ok(result.rows.length > 0);
    assert.equal(result.rows.every((row) =>
      row.status === "current_only_not_historical" &&
      row.amount === "" &&
      row.usdAmount === "" &&
      row.date === "2026-05-20"
    ), true);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
