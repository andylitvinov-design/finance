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

  assert.ok(
    popupSource.includes('./api/index?action=reconcileBalancesAndTransfers')
  );
});
