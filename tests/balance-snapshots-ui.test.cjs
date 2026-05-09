const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "balance-snapshots-ui.js"), "utf8");

test("balance snapshots inventory UI loads after balance coverage and before main", () => {
  assert.ok(indexHtml.includes("./balance-snapshots-ui.js"));
  assert.ok(indexHtml.indexOf("./balance-coverage-ui.js") < indexHtml.indexOf("./balance-snapshots-ui.js"));
  assert.ok(indexHtml.indexOf("./balance-snapshots-ui.js") < indexHtml.indexOf("./main.js"));
});

test("balance snapshots inventory UI calls period-scoped endpoint", () => {
  assert.match(script, /\/api\/balance-snapshots/);
  assert.match(script, /q\.set\("from", start\)/);
  assert.match(script, /q\.set\("to", end\)/);
  assert.match(script, /cache: "no-store"/);
});

test("balance snapshots inventory UI renders safe coverage fields only", () => {
  assert.match(script, /Инвентарь остатков/);
  assert.match(script, /by_channel_currency/);
  assert.match(script, /valid_rows/);
  assert.match(script, /incomplete_rows/);
  assert.doesNotMatch(script, /balanceAmount/);
  assert.doesNotMatch(script, /provider_reported_balance/);
});
