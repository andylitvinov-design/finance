import test from "node:test";
import assert from "node:assert/strict";
import {
  currentMonthWindow,
  evaluateReconciliationSnapshot,
  parseArgs,
} from "../scripts/verify-finance-live.mjs";

function makeSnapshot({ statusCounts = {}, summaryStatus = "ok", excludedFx = 0, ok = true } = {}) {
  return {
    ok,
    period_balance_reconciliation: {
      summary: { status: summaryStatus, positions_checked: 39, status_counts: statusCounts },
      total_usd_row: {
        opening_usd: 100,
        planned_end_usd: 110,
        confirmed_end_usd: 110,
        diff_usd: 0,
        excluded_fx_missing_rows: excludedFx,
      },
      canonical_total: { status: "ok" },
    },
  };
}

test("clean snapshot passes", () => {
  const result = evaluateReconciliationSnapshot(makeSnapshot());
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("fx-excluded rows fail the gate", () => {
  const result = evaluateReconciliationSnapshot(makeSnapshot({ excludedFx: 11 }));
  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /fx_missing: 11/);
});

test("mismatch above allowance fails, within allowance warns", () => {
  const snapshot = makeSnapshot({ statusCounts: { mismatch: 3 } });
  assert.equal(evaluateReconciliationSnapshot(snapshot).ok, false);
  const allowed = evaluateReconciliationSnapshot(snapshot, { maxMismatch: 5 });
  assert.equal(allowed.ok, true);
  assert.match(allowed.warnings.join("\n"), /mismatch positions within allowance: 3\/5/);
});

test("blocked summary fails unless --allow-blocked", () => {
  const snapshot = makeSnapshot({ summaryStatus: "blocked" });
  assert.equal(evaluateReconciliationSnapshot(snapshot).ok, false);
  const relaxed = evaluateReconciliationSnapshot(snapshot, { allowBlocked: true });
  assert.equal(relaxed.ok, true);
  assert.match(relaxed.warnings.join("\n"), /blocked/);
});

test("failed summary and missing opening balances always fail", () => {
  assert.equal(evaluateReconciliationSnapshot(makeSnapshot({ summaryStatus: "failed" })).ok, false);
  assert.equal(
    evaluateReconciliationSnapshot(makeSnapshot({ statusCounts: { missing_opening_balance: 1 } })).ok,
    false,
  );
});

test("missing provider balance is a warning, not a failure", () => {
  const result = evaluateReconciliationSnapshot(makeSnapshot({ statusCounts: { missing_provider_balance: 1 } }));
  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /missing_provider_balance: 1/);
});

test("endpoint ok=false fails", () => {
  const result = evaluateReconciliationSnapshot(makeSnapshot({ ok: false }));
  assert.equal(result.ok, false);
});

test("parseArgs reads base, window, and flags", () => {
  const args = parseArgs(["--base=https://x.vercel.app/", "--from=2026-06-01", "--to=2026-06-30", "--max-mismatch=4", "--allow-blocked"]);
  assert.equal(args.base, "https://x.vercel.app");
  assert.equal(args.from, "2026-06-01");
  assert.equal(args.to, "2026-06-30");
  assert.equal(args.maxMismatch, 4);
  assert.equal(args.allowBlocked, true);
});

test("currentMonthWindow anchors at the first of the month", () => {
  assert.deepEqual(currentMonthWindow("2026-07-03"), { from: "2026-07-01", to: "2026-07-03" });
});
