const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("index.html local assets exist", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const localAssetPattern = /\b(?:src|href)=["']([^"']+)["']/g;
  const missingAssets = [];

  for (const match of html.matchAll(localAssetPattern)) {
    const target = match[1];
    if (!target || /^(https?:|data:|mailto:|#)/i.test(target)) continue;
    const normalized = target.replace(/^\.\//, "").replace(/^\//, "");
    if (!fs.existsSync(path.join(root, normalized))) {
      missingAssets.push(target);
    }
  }

  assert.deepEqual(missingAssets, []);
  assert.ok(fs.existsSync(path.join(root, "favicon.ico")));
});
