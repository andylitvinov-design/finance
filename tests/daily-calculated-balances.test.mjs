import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  CALCULATED_BALANCE_HEADERS,
  CALCULATED_BALANCE_SHEET_NAME,
  buildDailyCalculatedBalances,
  materializeDailyCalculatedBalances,
} from "../server/daily-calculated-balances.js";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-21",
    fromChannel: "монобанк грн",
    toChannel: "",
    currency: "UAH",
    amountNet: "1330",
    balanceAmount: -1330,
    ledgerV2: {
      date: "2026-05-21",
      operation: "expense",
      from_channel: "монобанк грн",
      to_channel: "",
      currency: "UAH",
      amount_net: "1330",
      balance_amount: -1330,
    },
  };
  return {
    ...row,
    ...overrides,
    ledgerV2: {
      ...row.ledgerV2,
      ...(overrides.ledgerV2 || {}),
    },
  };
}

test("daily calculated balances use latest factual anchor plus Ledger amount_net movement", () => {
  const result = buildDailyCalculatedBalances({
    period: { from: "2026-05-20", to: "2026-05-21" },
    operations: [operation()],
    balanceRows: [
      { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "13033.14", balanceSource: "manual_fact" },
    ],
  });

  assert.equal(result.summary.excluded_missing_amount_net_rows, 0);
  assert.deepEqual(result.rows, [
    {
      date: "2026-05-21",
      channel: "монобанк грн",
      currency: "UAH",
      opening_balance: 13033.14,
      movement: -1330,
      calculated_eod: 11703.14,
      source: "calculated",
      balanceSource: "calculated_balance",
      balance_source: "calculated_balance",
      sourceSheet: CALCULATED_BALANCE_SHEET_NAME,
      anchor_date: "2026-05-20",
      anchor_source: "manual_fact",
      status: "calculated_from_previous",
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
    },
  ]);
});

test("daily calculated balances skip same-date manual/provider facts and resume from them", () => {
  const result = buildDailyCalculatedBalances({
    period: { from: "2026-05-20", to: "2026-05-22" },
    operations: [
      operation({ date: "2026-05-21", ledgerV2: { date: "2026-05-21", amount_net: "100", balance_amount: -100 } }),
      operation({ date: "2026-05-22", ledgerV2: { date: "2026-05-22", amount_net: "50", balance_amount: -50 } }),
    ],
    balanceRows: [
      { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "1000", balanceSource: "manual_fact" },
      { date: "2026-05-21", channel: "монобанк грн", currency: "UAH", amount: "950", balanceSource: "manual_fact" },
    ],
  });

  assert.deepEqual(
    result.rows.map((row) => ({ date: row.date, opening: row.opening_balance, movement: row.movement, eod: row.calculated_eod, anchor: row.anchor_date })),
    [{ date: "2026-05-22", opening: 950, movement: -50, eod: 900, anchor: "2026-05-21" }]
  );
});

test("daily calculated balances do not invent rows without an anchor", () => {
  const result = buildDailyCalculatedBalances({
    period: { from: "2026-05-20", to: "2026-05-21" },
    operations: [operation()],
    balanceRows: [],
  });

  assert.equal(result.rows.length, 0);
});

test("daily calculated balances preserve missing amount_net warning and stop the chain", () => {
  const result = buildDailyCalculatedBalances({
    period: { from: "2026-05-20", to: "2026-05-21" },
    operations: [operation({ ledgerV2: { amount_net: "", balance_amount: -1330 } })],
    balanceRows: [
      { date: "2026-05-20", channel: "монобанк грн", currency: "UAH", amount: "13033.14", balanceSource: "manual_fact" },
    ],
  });

  assert.equal(result.summary.excluded_missing_amount_net_rows, 1);
  assert.equal(result.rows[0].status, "missing_amount_net");
  assert.equal(result.rows[0].calculated_eod, null);
});

test("materializeDailyCalculatedBalances dry-run does not call Sheets", async () => {
  let calls = 0;
  const result = await materializeDailyCalculatedBalances({
    apply: false,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("fetch should not be called in dry-run");
    },
    rows: [
      {
        date: "2026-05-21",
        channel: "монобанк грн",
        currency: "UAH",
        opening_balance: 13033.14,
        movement: -1330,
        calculated_eod: 11703.14,
        anchor_date: "2026-05-20",
        anchor_source: "manual_fact",
        status: "calculated_from_previous",
      },
    ],
  });

  assert.equal(calls, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.sheetName, CALCULATED_BALANCE_SHEET_NAME);
  assert.equal(result.rowCount, 1);
});

test("materializeDailyCalculatedBalances apply only upserts the hidden calculated sheet", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  const requests = [];

  try {
    const result = await materializeDailyCalculatedBalances({
      apply: true,
      fetchImpl: async (url, options = {}) => {
        requests.push({ url: String(url), method: options.method || "GET", body: options.body || "" });
        if (String(url).includes("oauth2.googleapis.com")) return jsonResponse({ access_token: "token" });
        if (String(url).includes("fields=sheets")) return jsonResponse({ sheets: [] });
        if (String(url).endsWith(":batchUpdate")) {
          const body = JSON.parse(options.body || "{}");
          assert.deepEqual(body.requests, [{ addSheet: { properties: { title: CALCULATED_BALANCE_SHEET_NAME, hidden: true } } }]);
          return jsonResponse({ replies: [{ addSheet: { properties: { sheetId: 123 } } }] });
        }
        if (String(url).includes("/values/") && (options.method || "GET") === "GET") {
          return jsonResponse({ values: [CALCULATED_BALANCE_HEADERS] });
        }
        if (String(url).includes("/values/") && options.method === "PUT") {
          const body = JSON.parse(options.body || "{}");
          assert.equal(body.values[0][0], "date");
          assert.equal(body.values[1][0], "2026-05-21");
          assert.equal(body.values[1][6], "calculated");
          return jsonResponse({ updatedRange: "'Расчетные Остатки'!A:L" });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      rows: [
        {
          date: "2026-05-21",
          channel: "монобанк грн",
          currency: "UAH",
          opening_balance: 13033.14,
          movement: -1330,
          calculated_eod: 11703.14,
          anchor_date: "2026-05-20",
          anchor_source: "manual_fact",
          status: "calculated_from_previous",
        },
      ],
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.inserted, 1);
    assert.equal(result.updated, 0);
    const decodedUrls = requests.map((request) => decodeURIComponent(request.url));
    assert.ok(decodedUrls.some((url) => url.includes(CALCULATED_BALANCE_SHEET_NAME)));
    assert.ok(decodedUrls.every((url) => !url.includes("'Ledger'") && !url.includes("'Остатки'") && !url.includes("'Авто Остатки'")));
  } finally {
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", previousEmail);
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", previousKey);
  }
});

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
