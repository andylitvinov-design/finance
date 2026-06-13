const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const engineJs = fs.readFileSync(
  path.join(root, "server/period-balance-reconciliation-engine.js"),
  "utf8"
);

function indexAfterFn(source, fnName) {
  const idx = source.indexOf(`function ${fnName}`);
  if (idx === -1) throw new Error(`${fnName} not found`);
  return idx;
}

test("resolveCanonicalUsdAmount has zero-native guard (source)", () => {
  const fnIdx = indexAfterFn(engineJs, "resolveCanonicalUsdAmount");
  const nextFnIdx = engineJs.indexOf("\nfunction ", fnIdx + 1);
  const fnBody = engineJs.slice(fnIdx, nextFnIdx === -1 ? undefined : nextFnIdx);
  assert.match(
    fnBody,
    /Math\.abs\(nativeAmount\)\s*<\s*0\.0001/,
    "resolveCanonicalUsdAmount must guard zero native before stable-currency check"
  );
});

test("resolveCanonicalUsdAmount zero guard appears before isStableUsdCurrency (source)", () => {
  const fnIdx = indexAfterFn(engineJs, "resolveCanonicalUsdAmount");
  const nextFnIdx = engineJs.indexOf("\nfunction ", fnIdx + 1);
  const fnBody = engineJs.slice(fnIdx, nextFnIdx === -1 ? undefined : nextFnIdx);
  const zeroGuardIdx = fnBody.search(/Math\.abs\(nativeAmount\)/);
  const stableIdx = fnBody.search(/isStableUsdCurrency/);
  assert.ok(zeroGuardIdx !== -1, "zero guard must exist");
  assert.ok(stableIdx !== -1, "isStableUsdCurrency must exist");
  assert.ok(
    zeroGuardIdx < stableIdx,
    `zero guard (at ${zeroGuardIdx}) must come before isStableUsdCurrency (at ${stableIdx})`
  );
});

test("resolveMovementUsd returns 0 when no real rows or missing_amount_net_rows (source)", () => {
  const fnIdx = indexAfterFn(engineJs, "resolveMovementUsd");
  const nextFnIdx = engineJs.indexOf("\nfunction ", fnIdx + 1);
  const fnBody = engineJs.slice(fnIdx, nextFnIdx === -1 ? undefined : nextFnIdx);
  assert.match(
    fnBody,
    /!real\?\.rows && !real\?\.missing_amount_net_rows/,
    "must short-circuit with return 0 when no real entries"
  );
  assert.match(fnBody, /return 0/, "must have explicit return 0");
});

test("buildCanonicalReconciliationValues pushes opening_usd_fx_missing when resolvedOpeningUsd is null (source)", () => {
  const fnIdx = indexAfterFn(engineJs, "buildCanonicalReconciliationValues");
  const nextFnIdx = engineJs.indexOf("\nfunction ", fnIdx + 1);
  const fnBody = engineJs.slice(fnIdx, nextFnIdx === -1 ? undefined : nextFnIdx);
  assert.match(
    fnBody,
    /resolvedOpeningUsd === null/,
    "must check resolvedOpeningUsd for null before pushing fx_warning"
  );
  assert.match(fnBody, /opening_usd_fx_missing/, "must name the correct warning key");
});
