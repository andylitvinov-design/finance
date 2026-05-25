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

test("reconcile balances endpoint is served through the consolidated api index function", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

  assert.ok(
    config.rewrites.some(
      (rewrite) =>
        rewrite.source === "/api/reconcile-balances-and-transfers" &&
        rewrite.destination === "/api/index?action=reconcileBalancesAndTransfers"
    )
  );
});
