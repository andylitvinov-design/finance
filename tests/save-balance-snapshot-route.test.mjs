import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOstatkiUpsertPlan,
  extractSnapshotRows,
  parseJsonBody,
  parseOstatkiValues,
} from "../api/save-balance-snapshot.js";

test("save-balance-snapshot parses owner rows with rate and usd amount", () => {
  const rows = extractSnapshotRows({
    rows: [
      {
        date: "2026-05-28",
        channel: "БАНК КАНАДА cad",
        amount: 10538,
        currency: "CAD",
        rate: 0.74,
        usdAmount: 7798.12,
        comment: "owner_confirmed",
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      date: "2026-05-28",
      channel: "БАНК КАНАДА cad",
      currency: "CAD",
      amount: "10538",
      rate: "0,74",
      usdAmount: "7798,12",
      comment: "owner_confirmed",
      metadataReliability: "legacy_unreliable",
    },
  ]);
});

test("save-balance-snapshot accepts legacy single-row payload shape", () => {
  const rows = extractSnapshotRows({
    snapshotDate: "28.05.2026",
    accountName: "монобанк грн",
    balanceAmount: "1333,14",
    balanceCurrency: "UAH",
    amount_usd: "31,36",
    source: "manual_fact",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-05-28");
  assert.equal(rows[0].channel, "монобанк грн");
  assert.equal(rows[0].currency, "UAH");
  assert.equal(rows[0].amount, "1333,14");
  assert.equal(rows[0].usdAmount, "31,36");
  assert.equal(rows[0].comment, "manual_fact");
});

test("parseOstatkiValues preserves amount rate usd and comment columns", () => {
  const rows = parseOstatkiValues([
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
    ["2026-05-28", "binance save", "2020", "USDC", "1", "2020", "owner_confirmed"],
  ]);

  assert.deepEqual(rows, [
    {
      date: "2026-05-28",
      channel: "binance save",
      currency: "USDC",
      amount: "2020",
      rate: "1",
      usdAmount: "2020",
      comment: "owner_confirmed",
      metadataReliability: "legacy_unreliable",
    },
  ]);
});

test("parseOstatkiValues preserves A:J snapshot metadata and marks absent legacy metadata unreliable", () => {
  const rows = parseOstatkiValues([
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий", "source", "status", "raw_source_id"],
    ["2026-07-01", "Wise USD", "1275", "USD", "", "1275", "owner_confirmed_full_snapshot", "owner_confirmed", "snapshot_contract_v1:%7B%22completeness%22%3A%22full%22%7D", "owner-confirmed-july-2026-07-01"],
    ["2026-06-26", "legacy", "1", "USD", "1", "1", "legacy"],
  ]);

  assert.equal(rows[0].metadataSource, "owner_confirmed");
  assert.match(rows[0].metadataStatus, /^snapshot_contract_v1:/);
  assert.equal(rows[0].rawSourceId, "owner-confirmed-july-2026-07-01");
  assert.equal(rows[1].metadataReliability, "legacy_unreliable");
});

test("parseJsonBody supports already parsed and string payloads", () => {
  assert.deepEqual(parseJsonBody({ action: "saveBalanceSnapshot" }), { action: "saveBalanceSnapshot" });
  assert.deepEqual(parseJsonBody('{"action":"saveBalanceSnapshot"}'), { action: "saveBalanceSnapshot" });
});


test("owner-confirmed May 28 write removes stale duplicate balance rows and allows usd-only correction", async () => {
  const existingValues = [
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
    ["2026-05-28", "binance save", "7425", "USD", "1", "7425", "manual-google-sheets"],
    ["2026-05-28", "Бинанс spot", "1689", "USD", "1", "1689", "manual-google-sheets"],
    ["2026-05-28", "legacy_combined_binance_spot_funding", "345", "USDT", "1", "345", "manual-google-sheets"],
    ["2026-05-28", "Payoneer - eur", "1173", "EUR", "1.08", "1266.84", "manual-google-sheets"],
    ["2026-05-28", "БАНК КАНАДА cad CAD", "7351", "CAD", "1,38", "5325,2702", "manual-google-sheets"],
    ["2026-05-27", "Яндекс руб", "100000", "RUB", "", "1200", "manual-google-sheets"]
  ];

  const plan = await buildOstatkiUpsertPlan({
    rows: extractSnapshotRows({
      rows: [
        { date: "2026-05-28", channel: "binance save", amount: "7432", currency: "USD", rate: "1", usdAmount: "7432", comment: "owner_confirmed_2026_05_28_components_usdt_5412_usdc_2020" },
        { date: "2026-05-28", channel: "Бинанс spot", amount: "1162", currency: "USD", rate: "1", usdAmount: "1162", comment: "owner_confirmed_2026_05_28_usdt_1162" },
        { date: "2026-05-28", channel: "БАНК КАНАДА cad", amount: "10538", currency: "CAD", rate: "1.3516", usdAmount: "7798", comment: "owner_confirmed_2026_05_28_cad_10538_usd_7798" },
        { date: "2026-05-28", channel: "монобанк грн", amount: "1333", currency: "UAH", rate: "42.5064", usdAmount: "31.36", comment: "owner_confirmed_2026_05_28_uah_1333_usd_31_36" },
        { date: "2026-05-28", channel: "Яндекс руб", amount: "", currency: "RUB", usdAmount: "1376", comment: "owner_confirmed_2026_05_28_usd_1376_preserve_local_amount" }
      ]
    }),
    existingValues
  });

  const serialized = JSON.stringify(plan.outputRows);
  assert.match(serialized, /7432/);
  assert.match(serialized, /1162/);
  assert.match(serialized, /10538/);
  assert.match(serialized, /1333/);
  assert.match(serialized, /1376/);
  assert.doesNotMatch(serialized, /7425/);
  assert.doesNotMatch(serialized, /1689/);
  assert.doesNotMatch(serialized, /legacy_combined_binance_spot_funding/);
  assert.doesNotMatch(serialized, /1173/);
  assert.doesNotMatch(serialized, /7351/);
});
