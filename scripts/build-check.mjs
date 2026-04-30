import { readFile, writeFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  "api/status.js",
  "api/paypal-transactions.js",
  "api/wise-transactions.js",
  "api/monobank-transactions.js",
  "api/privatbank-transactions.js",
  "api/yoomoney-transactions.js",
];

for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath));
}

const parseJsonFile = async (relativePath) => {
  const text = await readFile(path.join(root, relativePath), "utf8");
  return JSON.parse(text);
};

await parseJsonFile("sheet-config.json");
await parseJsonFile("vercel.json");
await parseJsonFile("ops/deployment-manifest.json");
const packageJson = await parseJsonFile("package.json");

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

const appBuildVersionMatch = (await readFile(path.join(root, "config.js"), "utf8"))
  .match(/const APP_BUILD_VERSION = "([^"]+)";/);
const buildMeta = {
  appVersion: String(packageJson.version || ""),
  appBuildVersion: appBuildVersionMatch?.[1] || "",
  buildTime: new Date().toISOString(),
  deploymentEnvironment: String(process.env.VERCEL_ENV || process.env.NODE_ENV || "local"),
  commitSha: detectGitValue("rev-parse", "HEAD"),
  commitRef: detectGitValue("rev-parse", "--abbrev-ref", "HEAD"),
  gitProvider: String(process.env.VERCEL_GIT_PROVIDER || ""),
  gitRepoSlug: String(process.env.VERCEL_GIT_REPO_SLUG || ""),
  gitCommitSha: String(process.env.VERCEL_GIT_COMMIT_SHA || ""),
  gitCommitRef: String(process.env.VERCEL_GIT_COMMIT_REF || "")
};

await writeFile(
  path.join(root, "ops", "build-meta.json"),
  `${JSON.stringify(buildMeta, null, 2)}\n`,
  "utf8"
);

console.log("build-check: ok");

function detectGitValue(...args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}
