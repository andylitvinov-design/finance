import test from "node:test";
import assert from "node:assert/strict";

import { parseAutoBalanceRows } from "../server/auto-balance-repository.js";

test("auto balance parser keeps explicit zero, ok, and status-only rows", () => {
  const rows = parseAutoBalanceRows([
    ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"],
    ["2026-05-17", "wise", "трансервайз дол", "1070,48", "USD", "1", "1070,48", "wise_auto", "2026-05-18T00:00:00Z", "wise-usd", "ok", "wise auto snapshot"],
    ["2026-05-17", "wise", "трансервайз евро", "0", "EUR", "1,16", "0", "wise_auto", "2026-05-18T00:00:00Z", "wise-eur", "zero_balance", "wise auto snapshot"],
    ["2026-05-17", "paypal", "пейпал дол", "", "USD", "1", "", "paypal_auto", "", "paypal-usd", "provider_not_implemented", "PayPal current-balance endpoint is not wired yet"],
    ["2026-05-17", "paypal", "пейпал евр", "", "EUR", "1,16", "", "paypal_auto", "", "paypal-eur", "missing_provider_balance", "missing"],
    ["2026-05-18", "planned", "пейпал дол", "80", "USD", "1", "80", "planned_daily_balance", "2026-05-18T00:00:00Z", "planned_daily_balance:2026-05-18:paypal_usd:USD", "planned", "Planned daily balance"],
  ]);

  assert.deepEqual(rows.map((row) => `${row.provider}|${row.channel}|${row.currency}|${row.amount}|${row.status}|${row.source}`), [
    "wise|трансервайз дол|USD|1070,48|ok|provider_auto",
    "wise|трансервайз евро|EUR|0|zero_balance|provider_auto",
    "paypal|пейпал дол|USD||provider_not_implemented|provider_auto",
    "paypal|пейпал евр|EUR||missing_provider_balance|provider_auto",
    "planned|пейпал дол|USD|80|planned|planned_daily_balance",
  ]);
  assert.equal(rows[1].usdAmount, "0");
  assert.equal(rows[1].sourceSheet, "Авто Остатки");
  assert.equal(rows[2].isStatusOnly, true);
  assert.equal(rows[2].balanceAmount, "");
  assert.equal(rows[4].fact_source, "planned_daily_balance");
});
