import assert from "node:assert/strict";
import test from "node:test";

import { mergeManualAndAutoBalances } from "../server/balance-snapshot-merge.js";

test("owner-confirmed YooMoney Остатки rows override same-date auto snapshots", () => {
  const result = mergeManualAndAutoBalances(
    [
      {
        date: "2026-05-01",
        channel: "Яндекс руб",
        currency: "RUB",
        amount: "145614",
        source: "manual_owner_confirmed_yoomoney_eod",
        comment: "owner-confirmed YooMoney/Yandex EOD balance provided by user",
        sourceSheet: "Остатки",
      },
    ],
    [
      {
        date: "2026-05-01",
        provider: "yoomoney",
        channel: "Яндекс руб",
        currency: "RUB",
        amount: "142858.88",
        source: "provider_auto",
        sourceSheet: "Авто Остатки",
      },
    ]
  );

  assert.equal(result.autoIgnored, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amount, "145614");
  assert.equal(result.rows[0].source, "manual_fact");
  assert.equal(result.rows[0].fact_source, "manual_fact");
});

test("legacy auto hints in Остатки still remain provider auto", () => {
  const result = mergeManualAndAutoBalances([
    {
      date: "2026-05-17",
      channel: "трансервайз дол",
      currency: "USD",
      amount: "1070.48",
      source: "manual-google-sheets",
      comment: "wise auto snapshot",
      sourceSheet: "Остатки",
    },
  ]);

  assert.equal(result.rows[0].source, "provider_auto");
  assert.equal(result.rows[0].fact_source, "provider_auto");
});

test("blank Revolut auto snapshot does not overwrite manual confirmed balance", () => {
  const result = mergeManualAndAutoBalances(
    [
      {
        date: "2026-05-21",
        channel: "REVOLUT евро",
        currency: "EUR",
        amount: "110.74",
        source: "manual_confirmed_balance",
        sourceSheet: "Остатки",
      },
    ],
    [
      {
        date: "2026-05-21",
        provider: "revolut",
        channel: "REVOLUT евро",
        currency: "EUR",
        amount: "",
        source: "revolut_auto",
        sourceSheet: "Авто Остатки",
        status: "needs_provider_permission",
      },
    ]
  );

  assert.equal(result.autoIgnored, 1);
  assert.equal(result.autoUsed, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amount, "110.74");
  assert.equal(result.rows[0].source, "manual_fact");
  assert.equal(result.rows[0].sourceSheet, "Остатки");
});
