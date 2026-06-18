import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(new URL("../scripts/production-debug-preflight.mjs", import.meta.url), "utf8");
const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const releaseGuard = readFileSync(new URL("../scripts/release-guard.sh", import.meta.url), "utf8");

test("production preflight script checks live status and source metadata", () => {
  assert.match(script, /\/api\/status/);
  assert.match(script, /commitSha/);
  assert.match(script, /commitRef/);
  assert.match(script, /gitRepoSlug/);
  assert.match(script, /canonicalProductionRepo/);
  assert.match(script, /deprecatedRepo/);
  assert.match(script, /statusSource/);
  assert.match(script, /vercelProjectName/);
  assert.match(script, /deploy\/source-of-truth mismatch/);
});

test("production preflight strict mode blocks non-main deployment refs", () => {
  assert.match(script, /--strict/);
  assert.match(script, /expected commitRef=main/);
  assert.match(script, /process\.exitCode = 1/);
});

test("AGENTS requires production debug preflight before production patches", () => {
  assert.match(agents, /Production Debug Preflight/);
  assert.match(agents, /andylitvinov-design\/finance/);
  assert.match(agents, /andylitvinov-design\/ezohata-incoming-ledger/);
  assert.match(agents, /before rollback or patch/i);
  assert.match(agents, /production-debug-preflight\.mjs/);
  assert.match(agents, /deploy\/source-of-truth mismatch/);
  assert.match(agents, /Movement Table Invariant/);
});

test("package exposes production preflight command", () => {
  assert.equal(packageJson.scripts["preflight:production"], "node scripts/production-debug-preflight.mjs");
});

test("release guard runs production debug preflight", () => {
  assert.match(releaseGuard, /node scripts\/production-debug-preflight\.mjs/);
  assert.match(releaseGuard, /RELEASE_GUARD_STRICT_PRODUCTION_REF/);
  assert.match(releaseGuard, /--strict/);
});
