const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");

test("expense analysis grid constrains wide tables to the mobile viewport", () => {
  assert.match(styleCss, /\.finance-shell \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 16px; \}/);
  assert.match(styleCss, /\.analytics-section \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 12px; min-width: 0; \}/);
  assert.match(styleCss, /\.analysis-table-wrap \{\s*width: 100%;\s*max-width: 100%;\s*min-width: 0;\s*justify-self: stretch;\s*overflow-x: auto;\s*-webkit-overflow-scrolling: touch;\s*overscroll-behavior-x: contain;\s*\}/);
});

test("expense analysis mobile tables opt out of sticky first column", () => {
  const stickyRuleIndex = styleCss.indexOf(".table-wrap table tr > :first-child");
  const analysisOverrideIndex = styleCss.indexOf(".analysis-table-wrap table tr > :first-child");

  assert.notEqual(stickyRuleIndex, -1);
  assert.notEqual(analysisOverrideIndex, -1);
  assert.ok(analysisOverrideIndex > stickyRuleIndex);
  assert.match(styleCss.slice(analysisOverrideIndex), /position: static;/);
  assert.match(styleCss.slice(analysisOverrideIndex), /left: auto;/);
  assert.match(styleCss.slice(analysisOverrideIndex), /z-index: auto;/);
});
