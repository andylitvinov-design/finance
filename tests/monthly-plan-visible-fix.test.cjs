const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const guardJs = fs.readFileSync(path.join(root, "monthly-plan-visible-fix.js"), "utf8");

test("index loads monthly plan visibility guard after monthly-plan core", () => {
  const monthlyPlanIndex = indexHtml.indexOf("./monthly-plan.js");
  const guardIndex = indexHtml.indexOf("./monthly-plan-visible-fix.js");
  assert.ok(monthlyPlanIndex > 0, "monthly-plan.js must be loaded");
  assert.ok(guardIndex > monthlyPlanIndex, "visibility guard must load after monthly-plan.js");
});

test("monthly plan visibility guard exposes deterministic tab functions", () => {
  assert.match(guardJs, /function ensureMonthlyPlanTabButton\(\)/);
  assert.match(guardJs, /globalThis\.ensureMonthlyPlanTabButton = ensureMonthlyPlanTabButton/);
  assert.match(guardJs, /globalThis\.openMonthlyPlanTab = openMonthlyPlanTab/);
  assert.match(guardJs, /План/);
});
