import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  OPENING_BALANCE_TARGETS,
  buildOpeningBalanceRepairPlan,
  applyOpeningBalanceRepairPlan,
} from "../scripts/repair-opening-balances-2026-05-01.mjs";
import { saveAutoBalanceSnapshotRows } from "../server/auto-balance-snapshots.js";

const MANUAL_SPREADSHEET_ID = "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY";
const ENCODED_AUTO_RANGE = "'%D0%90%D0%B2%D1%82%D0%BE%20%D0%9E%D1%81%D1%82%D0%B0%D1%82%D0%BA%D0%B8'!A%3AL";

test("Binance opening is derived from later factual balance minus signed Ledger delta", () => {
  const plan = buildOpeningBalanceRepairPlan({
    repository: {
      balances: [],
      autoBalances: [
        { date: "2026-05-25", provider: "binance", channel: "Бинанс spot", currency: "USDT", amount: "1159.0372", source: "binance_auto", status: "ok" },
      ],
      operations: [
        { date: "2026-05-08", fromChannel: "Бинанс spot", currency: "USDT", amountNet: "100", balanceAmount: -100, sheetRowNumber: 10 },
        { date: "2026-05-10", toChannel: "Бинанс spot", currency: "USDT", amountNet: "33.9628", balanceAmount: 33.9628, sheetRowNumber: 11 },
      ],
    },
    now: "2026-05-25T13:00:00.000Z",
  });

  const row = plan.changes.find((change) => change.channel === "Бинанс spot" && change.currency === "USDT");
  assert.equal(row.amount, "1225,0744");
  assert.equal(row.source, "binance_derived_opening_balance");
  assert.equal(row.status, "derived_opening_from_later_factual_balance");
  assert.equal(row.later_factual_date, "2026-05-25");
  assert.equal(row.ledger_delta, -66.0372);
  assert.equal(row.movement_row_count, 2);
  assert.match(row.comment, /later factual 2026-05-25/);
  assert.match(row.comment, /movement rows 2/);
});

test("Revolut EUR opening is derived from later factual manual balance minus signed Ledger delta", () => {
  const plan = buildOpeningBalanceRepairPlan({
    repository: {
      balances: [
        { date: "2026-05-20", provider: "revolut", channel: "REVOLUT евро", currency: "EUR", amount: "400", source: "manual-google-sheets", status: "" },
      ],
      autoBalances: [],
      operations: [
        { date: "2026-05-05", fromChannel: "REVOLUT евро", currency: "EUR", amountNet: "50", balanceAmount: -50, sheetRowNumber: 20 },
        { date: "2026-05-15", toChannel: "REVOLUT евро", currency: "EUR", amountNet: "10", balanceAmount: 10, sheetRowNumber: 21 },
      ],
    },
    now: "2026-05-25T13:00:00.000Z",
  });

  const row = plan.changes.find((change) => change.channel === "REVOLUT евро" && change.currency === "EUR");
  assert.equal(row.amount, "440");
  assert.equal(row.source, "revolut_derived_opening_balance");
  assert.equal(row.status, "derived_opening_from_later_factual_balance");
  assert.equal(row.later_factual_date, "2026-05-20");
  assert.equal(row.ledger_delta, -40);
  assert.equal(row.movement_row_count, 2);
});

test("missing amount_net blocks repair and writes no fake amount", () => {
  const plan = buildOpeningBalanceRepairPlan({
    repository: {
      balances: [],
      autoBalances: [
        { date: "2026-05-25", provider: "binance", channel: "Binance funding", currency: "USDT", amount: "500", source: "binance_auto", status: "ok" },
      ],
      operations: [
        { date: "2026-05-08", toChannel: "Binance funding", currency: "USDT", amountNet: "", balanceAmount: 100, sheetRowNumber: 30 },
      ],
    },
  });

  assert.equal(plan.changes.some((change) => change.channel === "Binance funding" && change.currency === "USDT"), false);
  const blocked = plan.blocked.find((row) => row.channel === "Binance funding" && row.currency === "USDT");
  assert.equal(blocked.reason, "missing_or_invalid_ledger_amount");
  assert.deepEqual(blocked.blocked_rows, [
    { row: 30, date: "2026-05-08", reason: "missing_amount_net", raw_source_id: "" },
  ]);
});

test("idempotency: re-running apply does not duplicate rows", async () => {
  const existingRows = [];
  const plan = buildOpeningBalanceRepairPlan({
    repository: {
      balances: [],
      autoBalances: [
        { date: "2026-05-25", provider: "binance", channel: "Бинанс spot", currency: "USDC", amount: "3", source: "binance_auto", status: "ok" },
      ],
      operations: [
        { date: "2026-05-10", toChannel: "Бинанс spot", currency: "USDC", amountNet: "1", balanceAmount: 1, sheetRowNumber: 40 },
      ],
    },
    now: "2026-05-25T13:00:00.000Z",
  });
  const saveRows = async (rows) => {
    for (const row of rows) {
      const index = existingRows.findIndex((existing) =>
        existing.date === row.date &&
        existing.provider === row.provider &&
        existing.channel === row.channel &&
        existing.currency === row.currency
      );
      if (index === -1) existingRows.push(row);
      else existingRows[index] = row;
    }
    return { rowCount: rows.length };
  };

  await applyOpeningBalanceRepairPlan(plan, { saveRows });
  await applyOpeningBalanceRepairPlan(plan, { saveRows });

  assert.equal(existingRows.length, 1);
  assert.equal(existingRows[0].rawSourceId, "binance_derived_opening_balance:2026-05-01:Бинанс spot:USDC");
  assert.equal(OPENING_BALANCE_TARGETS.some((target) => target.channel === "REVOLUT евро" && target.currency === "EUR"), true);
});

test("safe writer preserves derived opening balance source values", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "finance@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  let writtenValues = null;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/token")) return jsonResponse({ access_token: "google-token" });
    if (target === `https://sheets.googleapis.com/v4/spreadsheets/${MANUAL_SPREADSHEET_ID}`) {
      return jsonResponse({ sheets: [{ properties: { title: "Авто Остатки" } }] });
    }
    if (target.includes(`/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${ENCODED_AUTO_RANGE}`) && (options.method || "GET") === "GET") {
      return jsonResponse({ values: [["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"]] });
    }
    if (target.includes(`/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${ENCODED_AUTO_RANGE}`) && options.method === "PUT") {
      writtenValues = JSON.parse(options.body).values;
      return jsonResponse({ updatedRows: writtenValues.length });
    }
    throw new Error(`Unexpected URL ${target}`);
  };

  try {
    await saveAutoBalanceSnapshotRows([
      {
        date: "2026-05-01",
        provider: "revolut",
        channel: "REVOLUT евро",
        amount: "110,74",
        currency: "EUR",
        rate: "1,16",
        amountUsd: "128,4584",
        source: "revolut_derived_opening_balance",
        fetchedAt: "2026-05-25T13:00:00.000Z",
        rawSourceId: "revolut_derived_opening_balance:2026-05-01:REVOLUT евро:EUR",
        status: "derived_opening_from_later_factual_balance",
        comment: "Derived opening balance from later factual 2026-05-21; movement rows 0; ledger delta 0.",
      },
    ], { fetchImpl });

    assert.equal(writtenValues[1][7], "revolut_derived_opening_balance");
    assert.equal(writtenValues[1][10], "derived_opening_from_later_factual_balance");
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

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
