import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoBalanceValues,
  detectLegacyAutoRows,
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
