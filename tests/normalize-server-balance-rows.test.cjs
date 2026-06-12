const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const financeJs = fs.readFileSync(path.join(root, "finance.js"), "utf8");
const googleSheetsJs = fs.readFileSync(path.join(root, "google-sheets.js"), "utf8");
const remaindersPopupJs = fs.readFileSync(path.join(root, "remainders-summary-popup.js"), "utf8");

function extractFunctionText(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`${name} not found`);
  let depth = 0;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") { if (braceStart === -1) braceStart = i; depth += 1; }
    if (source[i] === "}") { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} not closed`);
}

test("normalizeServerBalanceRows reads amount_usd alias (source)", () => {
  const fn = extractFunctionText(financeJs, "normalizeServerBalanceRows");
  assert.match(fn, /row\?\.amount_usd/, "must have amount_usd alias");
});

test("normalizeServerBalanceRows reads amountUsd alias (source)", () => {
  const fn = extractFunctionText(financeJs, "normalizeServerBalanceRows");
  assert.match(fn, /row\?\.amountUsd/, "must have amountUsd alias");
});

test("normalizeServerBalanceRows filter does not use || for zero-dropping amount check (source)", () => {
  const fn = extractFunctionText(financeJs, "normalizeServerBalanceRows");
  assert.match(fn, /String\(row\.amount \?\? ""\)\.trim\(\) !== ""/, "filter must use null-safe check to preserve 0");
});

test("buildManualBalanceRowsFromAmounts does not drop zero amounts (source)", () => {
  const fn = extractFunctionText(financeJs, "buildManualBalanceRowsFromAmounts");
  assert.doesNotMatch(fn, /if \(!rawAmount \|\| !amount\)/, "must not have old zero-dropping guard");
});

test("parseIncomingBalanceSheetValues does not use || for zero-dropping amount check (source)", () => {
  const fn = extractFunctionText(googleSheetsJs, "parseIncomingBalanceSheetValues");
  assert.doesNotMatch(fn, /String\(amount \|\| ""\)\.trim\(\) && !String\(usdAmount \|\| ""\)/, "must not use || zero-dropping pattern");
});

test("buildPeriodBalanceChangeRows uses latest-before-period for opening (source)", () => {
  const fn = extractFunctionText(remaindersPopupJs, "buildPeriodBalanceChangeRows");
  assert.match(fn, /snapshotsByKey/, "must collect snapshots by key for latest-before-period logic");
  assert.match(fn, /e\.date <= periodFrom/, "must use <= comparison for opening");
  assert.doesNotMatch(fn, /date === periodFrom && !opening\.has/, "must not use exact date match for opening");
});

test("buildPeriodBalanceChangeRows uses latest-before-period for closing (source)", () => {
  const fn = extractFunctionText(remaindersPopupJs, "buildPeriodBalanceChangeRows");
  assert.match(fn, /e\.date <= periodTo/, "must use <= comparison for closing");
});
