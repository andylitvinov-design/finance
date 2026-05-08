const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../balance-close-ui.js");

test("balance close UI derives blocked state from balance fixes", () => {
  const result = ui.buildBalanceCloseFromSnapshot({
    period: { from: "2026-04-30", to: "2026-04-30" },
    balance_coverage: { summary: { mismatch: 0, needs_verification: 0 } },
    balance_fixes: {
      missing_amount_net_rows: [{}],
      missing_ostatki_rows: [{}, {}, {}, {}],
    },
  });

  assert.equal(result.can_close, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.blocking_counts.missing_amount_net_rows, 1);
  assert.equal(result.blocking_counts.missing_ostatki_rows, 4);
  assert.match(result.message, /Cannot close/);
});

test("balance close UI derives closable state when no blockers exist", () => {
  const result = ui.buildBalanceCloseFromSnapshot({
    balance_coverage: { summary: { mismatch: 0, needs_verification: 0 } },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_ostatki_rows: [],
    },
  });

  assert.equal(result.can_close, true);
  assert.equal(result.status, "closable");
  assert.equal(ui.getCloseStatusLabel(result.status), "Status: can close");
});

test("balance close UI builds step table", () => {
  const close = ui.buildBalanceCloseFromSnapshot({
    balance_coverage: { summary: { mismatch: 2, needs_verification: 0 } },
    balance_fixes: { missing_amount_net_rows: [], missing_ostatki_rows: [] },
  });
  const rows = ui.buildCloseTableValues(close);

  assert.deepEqual(rows[0], ["Step", "Status", "Count", "Action"]);
  assert.equal(rows[3][0], "Mismatches");
  assert.equal(rows[3][1], "Blocks close");
  assert.equal(rows[3][2], "2");
});
