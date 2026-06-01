import test from "node:test";
import assert from "node:assert/strict";

import { buildProviderBalanceMatrix } from "../server/provider-balance-matrix.js";

test("provider balance matrix exposes canonical fields and red severity for manual or stale channels", () => {
  const matrix = buildProviderBalanceMatrix({
    selectedDate: "2026-06-01",
    expectedProviderBalances: [
      { provider: "wise", channel: "трансервайз дол", currency: "USD" },
      { provider: "monobank", channel: "монобанк грн", currency: "UAH" },
      { provider: "revolut", channel: "REVOLUT евро", currency: "EUR" },
      { provider: "cash", channel: "наличные", currency: "USD" },
    ],
    selectedRows: [
      { date: "2026-06-01", provider: "wise", channel: "трансервайз дол", currency: "USD", source: "wise_auto", sourceSheet: "Авто Остатки", status: "ok" },
      { date: "2026-05-20", provider: "monobank", channel: "монобанк грн", currency: "UAH", source: "manual_confirmed_balance", sourceSheet: "Остатки", status: "confirmed" },
      { date: "2026-05-21", provider: "revolut", channel: "REVOLUT евро", currency: "EUR", source: "manual_confirmed_balance", sourceSheet: "Остатки", status: "confirmed" },
      { date: "2026-06-01", provider: "cash", channel: "наличные", currency: "USD", source: "manual_owner", sourceSheet: "Остатки", status: "confirmed" },
    ],
    allRows: [],
    operations: [
      { date: "2026-06-01", ledgerV2: { currency: "USD", operation: "income", to_channel: "трансервайз дол", amount_net: "1", balance_amount: "1" } },
    ],
    providerStatuses: [
      { provider: "wise", provider_current_balance_status: "available" },
      { provider: "monobank", provider_current_balance_status: "needs_permission" },
      { provider: "revolut", provider_current_balance_status: "not_implemented" },
      { provider: "cash", provider_current_balance_status: "manual_only" },
    ],
  });

  const byProvider = Object.fromEntries(matrix.map((row) => [row.provider, row]));
  assert.equal(byProvider.wise.current_balance_auto, true);
  assert.equal(byProvider.wise.transaction_import, true);
  assert.equal(byProvider.wise.last_balance_date, "2026-06-01");
  assert.equal(byProvider.wise.last_fact_date, "2026-06-01");
  assert.equal(byProvider.wise.last_fact_source, "provider");
  assert.equal(byProvider.wise.severity, "ok");

  assert.equal(byProvider.monobank.access_status, "needs_permission");
  assert.equal(byProvider.monobank.severity, "red");
  assert.match(byProvider.monobank.stale_reason, /provider token not available|last balance/i);
  assert.match(byProvider.monobank.action_required, /token|manual|screenshot/i);

  assert.equal(byProvider.revolut.current_balance_auto, false);
  assert.equal(byProvider.revolut.access_status, "not_implemented");
  assert.equal(byProvider.revolut.severity, "red");

  assert.equal(byProvider.cash.access_status, "manual_only");
  assert.equal(byProvider.cash.severity, "red");
  assert.equal(byProvider.cash.last_fact_source, "manual_owner");
});

test("provider balance matrix keeps owner-confirmed facts above same-date provider facts", () => {
  const [row] = buildProviderBalanceMatrix({
    selectedDate: "2026-06-01",
    expectedProviderBalances: [
      { provider: "wise", channel: "трансервайз дол", currency: "USD" },
    ],
    selectedRows: [],
    allRows: [
      { date: "2026-06-01", provider: "wise", channel: "трансервайз дол", currency: "USD", source: "wise_auto", sourceSheet: "Авто Остатки", status: "ok" },
      { date: "2026-06-01", provider: "wise", channel: "трансервайз дол", currency: "USD", source: "manual_owner", sourceSheet: "Остатки", status: "confirmed" },
    ],
    providerStatuses: [
      { provider: "wise", provider_current_balance_status: "available" },
    ],
  });

  assert.equal(row.last_fact_source, "manual_owner");
  assert.equal(row.last_balance_date, "2026-06-01");
});
