import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerConfirmedJulySnapshotRows } from "../server/authoritative-balance-snapshot-contract.js";
import { buildOwnerBalanceView } from "../server/owner-balance-view.js";

test("owner view isolates a full batch from same-date components and returns metrics", () => {
  const rows = [
    ...buildOwnerConfirmedJulySnapshotRows(),
    { date: "2026-07-29", channel: "REVOLUT евро", currency: "EUR", amount: 99, amount_usd: 120, source: "provider" },
    { date: "2026-07-29", channel: "нал-мам-евро", currency: "EUR", amount: 495, amount_usd: 574, source: "legacy" },
  ];
  const view = buildOwnerBalanceView(rows, { date: "2026-07-29" });
  assert.equal(view.owner_rows.length, 20);
  assert.equal(view.owner_total, 22454.5);
  assert.equal(view.diagnostic_rows.length, 2);
  assert.equal(view.excluded_component_count, 2);
  assert.equal(view.snapshot_batch_id, "owner-confirmed-2026-07-29");
  assert.equal(view.completeness, "full");
});
