import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROUTE_PATH = new URL("../api/period-balance-reconciliation.js", import.meta.url);

test("direct period-balance-reconciliation route delegates to the canonical server handler", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");
  assert.match(source, /export\s+\{\s*default\s*\}\s+from\s+["']\.\.\/server\/period-balance-reconciliation-route\.js["']/);
});
