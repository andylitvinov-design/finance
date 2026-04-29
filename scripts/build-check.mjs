import { readFile, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "index.html",
  "style.css",
  "config.js",
  "main.js",
  "state.js",
  "finance.js",
  "ui.js",
  "sheet-config.json",
  "vercel.json",
  "api/index.js",
  "api/paypal-transactions.js",
  "api/wise-transactions.js",
];

for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath));
}

const parseJsonFile = async (relativePath) => {
  const text = await readFile(path.join(root, relativePath), "utf8");
  JSON.parse(text);
};

await parseJsonFile("sheet-config.json");
await parseJsonFile("vercel.json");
await parseJsonFile("ops/deployment-manifest.json");
await parseJsonFile("package.json");

const indexHtml = await readFile(path.join(root, "index.html"), "utf8");
const localAssetPattern = /\b(?:src|href)=["']([^"']+)["']/g;
const missingAssets = [];
for (const match of indexHtml.matchAll(localAssetPattern)) {
  const target = match[1];
  if (!target || /^(https?:|data:|mailto:|#)/i.test(target)) continue;
  const normalized = target.replace(/^\.\//, "").replace(/^\//, "");
  try {
    await access(path.join(root, normalized));
  } catch {
    missingAssets.push(target);
  }
}

if (missingAssets.length) {
  throw new Error(`Missing assets referenced by index.html: ${missingAssets.join(", ")}`);
}

console.log("build-check: ok");
