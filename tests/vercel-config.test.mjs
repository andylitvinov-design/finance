import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("Vercel serverless function count stays within Hobby deployment limit", () => {
  const apiFiles = fs
    .readdirSync(path.join(ROOT, "api"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort();

  assert.ok(
    apiFiles.length <= 12,
    `expected no more than 12 api functions, found ${apiFiles.length}: ${apiFiles.join(", ")}`
  );
});

test("reconcile balances workflow uses the consolidated api index function", () => {
  const popupSource = fs.readFileSync(path.join(ROOT, "remainders-summary-popup.js"), "utf8");
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

  assert.ok(
    popupSource.includes('./api/refresh-all-balances')
  );
  assert.ok(config.rewrites.some((rewrite) =>
    rewrite.source === "/api/refresh-all-balances" &&
    rewrite.destination === "/api/index?action=reconcileBalancesAndTransfers"
  ));
});

test("daily balance backfill uses the consolidated api index function", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

  assert.ok(config.rewrites.some((rewrite) =>
    rewrite.source === "/api/backfill-daily-balance-snapshots" &&
    rewrite.destination === "/api/index?action=dailyBalanceBackfill"
  ));
});

test("debug Google route uses the consolidated api index function", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

  assert.ok(config.rewrites.some((rewrite) =>
    rewrite.source === "/api/debug-google" &&
    rewrite.destination === "/api/index?action=debugGoogle"
  ));
});

test("FX Rates ensure uses the consolidated api index function and scheduled cron", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

  assert.ok(config.rewrites.some((rewrite) =>
    rewrite.source === "/api/ensure-fx-rates" &&
    rewrite.destination === "/api/index?action=ensureFxRates"
  ));
  assert.ok(config.crons.some((cron) =>
    cron.path === "/api/ensure-fx-rates" &&
    cron.schedule === "15 23 * * *"
  ));
});

test("server JS routes do not statically import FX .mjs scripts for Vercel CJS bundling", () => {
  const routeSources = [
    fs.readFileSync(path.join(ROOT, "server", "ensure-fx-rates-route.js"), "utf8"),
    fs.readFileSync(path.join(ROOT, "server", "reconcile-balances-and-transfers.js"), "utf8"),
  ].join("\n");

  assert.doesNotMatch(routeSources, /from\s+["']\.\.\/scripts\/fetch-fx-rates\.mjs["']/);
  assert.match(routeSources, /import\(["']\.\.\/scripts\/fetch-fx-rates\.mjs["']\)/);
});
