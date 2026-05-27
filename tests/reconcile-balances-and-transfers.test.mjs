import test from "node:test";
import assert from "node:assert/strict";

import { runReconcileBalancesAndTransfers } from "../server/reconcile-balances-and-transfers.js";

test("reconcile balances ensures FX Rates before balances and audit snapshot", async () => {
  const calls = [];
  const result = await runReconcileBalancesAndTransfers({
    from: "2026-05-28",
    to: "2026-05-28",
    currentDate: "2026-05-28",
    fetchImpl: async () => {
      throw new Error("provider fetch should be injected in this test");
    },
    ensureFxRatesRunner: async (options) => {
      calls.push(["ensure_fx_rates", options.from, options.to, options.currentDate, options.currencies]);
      return {
        ok: true,
        checked: 7,
        fetched_rows: 7,
        fallback_rows: 0,
        missing_after_ensure: 0,
        errors: [],
      };
    },
    autoBalanceRunner: async () => {
      calls.push(["auto_balance_snapshots"]);
      return { ok: true, saved_rows: 1, providers_checked: ["wise"], providers_succeeded: ["wise"], provider_results: [] };
    },
    auditSnapshotRunner: async () => {
      calls.push(["audit_snapshot"]);
      return { ok: true, balances: { remainders_rows: [] } };
    },
    providerTransferCollector: async () => {
      calls.push(["provider_transfers"]);
      return [];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fx_rates_ensure.fetched_rows, 7);
  assert.deepEqual(calls.map((call) => call[0]), [
    "ensure_fx_rates",
    "auto_balance_snapshots",
    "provider_transfers",
    "audit_snapshot",
  ]);
  assert.deepEqual(calls[0][4], ["EUR", "CAD", "UAH", "RUB", "CHF", "GBP", "THB"]);
});
