const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");
const mobileScrollCss = fs.readFileSync(path.join(root, "mobile-finance-table-scroll.css"), "utf8");

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

test("new analytics balance tables are included in the mobile horizontal scroll contract", () => {
  assert.match(mobileScrollCss, /\.period-balance-reconciliation-section/);
  assert.match(mobileScrollCss, /\.period-balance-subsection/);
  assert.match(mobileScrollCss, /\.balance-snapshots-section/);
  assert.match(mobileScrollCss, /\.balance-snapshots-coverage-block/);
  assert.match(mobileScrollCss, /\.period-balance-table-wrap/);
  assert.match(mobileScrollCss, /\.balance-snapshots-table-wrap/);

  const periodWrapIndex = mobileScrollCss.indexOf(".period-balance-table-wrap");
  const balanceWrapIndex = mobileScrollCss.indexOf(".balance-snapshots-table-wrap");
  assert.notEqual(periodWrapIndex, -1);
  assert.notEqual(balanceWrapIndex, -1);
  assert.match(mobileScrollCss.slice(periodWrapIndex, periodWrapIndex + 260), /overflow-x: auto;/);
  assert.match(mobileScrollCss.slice(balanceWrapIndex, balanceWrapIndex + 260), /overflow-x: auto;/);
});

test("new analytics balance tables do not inherit sticky first-column mobile behavior", () => {
  const overrideIndex = mobileScrollCss.indexOf(".period-balance-table-wrap table tr > :first-child");
  assert.notEqual(overrideIndex, -1);
  const overrideBlock = mobileScrollCss.slice(overrideIndex, overrideIndex + 280);
  assert.match(overrideBlock, /\.balance-snapshots-table-wrap table tr > :first-child/);
  assert.match(overrideBlock, /position: static;/);
  assert.match(overrideBlock, /left: auto;/);
  assert.match(overrideBlock, /z-index: auto;/);
});