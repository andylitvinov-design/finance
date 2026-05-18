import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoBalanceValues,
  detectLegacyAutoRows,
  replaceSheetValues,
  summarizeMigration,
} from "../scripts/migrate-auto-balances-to-auto-ostatki.mjs";

test("migration detects legacy auto rows in manual Остатки", () => {
  const rows = detectLegacyAutoRows([
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
    ["2026-05-17", "трансервайз дол", "1070,48", "USD", "1", "1070,48", "wise auto snapshot"],
    ["2026-05-17", "монобанк грн", "14033", "UAH", "", "", "manual_fact"],
  ]);

  assert.deepEqual(rows, [
    {
      date: "2026-05-17",
      provider: "wise",
      channel: "трансервайз дол",
      amount: "1070,48",
      currency: "USD",
      rate: "1",
      usdAmount: "1070,48",
      source: "wise_auto",
      fetchedAt: "",
      rawSourceId: "",
      status: "legacy",
      comment: "wise auto snapshot",
      sourceRow: 2,
    },
  ]);
});

test("migration summarizes copy and duplicate counts without removing manual rows", () => {
  const summary = summarizeMigration({
    manualValues: [
      ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
      ["2026-05-17", "трансервайз дол", "1070,48", "USD", "1", "1070,48", "wise auto snapshot"],
      ["2026-05-17", "трансервайз евро", "10", "EUR", "1,16", "11,6", "auto daily provider snapshot"],
    ],
    autoValues: [
      ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"],
      ["2026-05-17", "wise", "трансервайз дол", "1070,48", "USD", "1", "1070,48", "wise_auto", "", "", "legacy", "wise auto snapshot"],
    ],
  });

  assert.equal(summary.detected, 2);
  assert.equal(summary.wouldCopy, 1);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.skipped, 0);
  assert.deepEqual(buildAutoBalanceValues(summary.rowsToCopy)[1].slice(0, 8), [
    "2026-05-17",
    "wise",
    "трансервайз евро",
    "10",
    "EUR",
    "1,16",
    "11,6",
    "wise_auto",
  ]);
});

test("replaceSheetValues clears the target range before rewriting fewer rows", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: options.body });
    return {
      ok: true,
      async json() {
        return {};
      },
    };
  };

  await replaceSheetValues("token", "Остатки", "A:H", [
    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
    ["2026-05-17", "монобанк грн", "14033", "UAH", "", "", "manual_fact"],
  ], { fetchImpl });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.match(decodeURIComponent(calls[0].url), /values\/'Остатки'!A:H:clear$/);
  assert.equal(calls[1].method, "PUT");
  assert.match(decodeURIComponent(calls[1].url), /values\/'Остатки'!A:H\?valueInputOption=USER_ENTERED$/);
  assert.match(calls[1].body, /2026-05-17/);
});
