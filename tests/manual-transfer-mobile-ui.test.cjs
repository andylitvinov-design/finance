const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");

test("manual transfers editable tables use dedicated mobile scroll wrappers", () => {
  assert.match(uiJs, /className = "table-wrap manual-transfer-table-wrap"/);
  assert.match(uiJs, /className = "table-wrap manual-transfer-table-wrap manual-transfer-empty-wrap"/);
  assert.match(uiJs, /className = "table-wrap manual-commission-table-wrap"/);
  assert.match(styleCss, /\.manual-transfer-table-wrap table \{ min-width: 900px; \}/);
  assert.match(styleCss, /\.manual-commission-table-wrap table \{ min-width: 620px; \}/);
  assert.match(styleCss, /\.manual-transfer-table-wrap \.finance-input/);
  assert.match(styleCss, /\.manual-commission-table-wrap \.ghost/);
});

test("manual transfers tables opt out of generic mobile sticky first column", () => {
  const stickyRuleIndex = styleCss.indexOf(".table-wrap table tr > :first-child");
  const manualOverrideIndex = styleCss.indexOf(".manual-transfer-table-wrap table tr > :first-child");

  assert.notEqual(stickyRuleIndex, -1);
  assert.notEqual(manualOverrideIndex, -1);
  assert.ok(manualOverrideIndex > stickyRuleIndex);
  assert.match(styleCss.slice(manualOverrideIndex), /position: static;/);
});
