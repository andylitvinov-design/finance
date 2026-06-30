import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROUTE_PATH = new URL("../api/period-balance-reconciliation.js", import.meta.url);

test("direct period-balance-reconciliation route uses canonical snapshot builder", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");
  assert.match(source, /buildPeriodBalanceReconciliationSnapshot/);
  assert.match(source, /loadManualRepositoryFromGoogleSheets/);
  assert.match(source, /loadAutoBalanceRowsFromGoogleSheets/);
});

test("direct route clarifies missing opening repair templates as period-start facts", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");
  assert.match(source, /missing_opening_balance/);
  assert.match(source, /date_requirement:\s*["']on_or_before_period_start["']/);
  assert.match(source, /latest_allowed_date:\s*periodFrom/);
  assert.match(source, /do not use derived reverse-calculation or period-end closing as opening fact/);
});
