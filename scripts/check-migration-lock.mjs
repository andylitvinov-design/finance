import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const expectedOrigin = "https://github.com/andylitvinov-design/finance.git";
const expectedVercelProject = {
  projectId: "prj_jnM1b4M941qFXzz0F31oDTeYNO84",
  projectName: "ezohata-incoming-ledger",
};
const legacyRepoNeedle = ["andylitvinov-design", "ezohata-incoming-ledger"].join("/");
const legacyRemoteNeedle = ["old", "origin"].join("-");
const extraProjectNeedle = "prj_xH0BeTQZo694kf9EZ3hFioStTUQg";
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
  } catch (error) {
    fail(`${relativePath} is missing or invalid JSON: ${error.message}`);
    return null;
  }
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail(`git ${args.join(" ")} failed: ${error.message}`);
    return "";
  }
}

const originUrl = git(["remote", "get-url", "origin"]);
if (originUrl !== expectedOrigin) {
  fail(`origin must be ${expectedOrigin}, got ${originUrl || "missing"}`);
}

const remotes = git(["remote"]).split(/\s+/).filter(Boolean);
const extraRemotes = remotes.filter((remote) => remote !== "origin");
if (extraRemotes.length) {
  fail(`only origin remote is allowed; remove: ${extraRemotes.join(", ")}`);
}

const vercelProject = readJson(".vercel/project.json");
if (vercelProject) {
  if (vercelProject.projectId !== expectedVercelProject.projectId) {
    fail(`.vercel/project.json projectId must be ${expectedVercelProject.projectId}, got ${vercelProject.projectId || "missing"}`);
  }
  if (vercelProject.projectName !== expectedVercelProject.projectName) {
    fail(`.vercel/project.json projectName must be ${expectedVercelProject.projectName}, got ${vercelProject.projectName || "missing"}`);
  }
}

const manifest = readJson("ops/deployment-manifest.json");
if (manifest?.repository?.canonical !== expectedOrigin) {
  fail(`ops/deployment-manifest.json canonical repo must be ${expectedOrigin}`);
}
if (manifest?.deploy?.projectName !== expectedVercelProject.projectName) {
  fail(`ops/deployment-manifest.json deploy.projectName must be ${expectedVercelProject.projectName}`);
}

const ignoredDirs = new Set([".git", ".vercel", "node_modules", ".worktrees", "data", "archive"]);
const ignoredFiles = new Set(["scripts/check-migration-lock.mjs"]);
const textExtensions = new Set([".js", ".mjs", ".json", ".md", ".sh", ".html", ".css", ".txt", ".example", ".gitignore", ".vercelignore"]);
const activeSourcePatterns = [
  { needle: legacyRepoNeedle, message: "legacy repository URL/path must not be referenced in tracked docs or config" },
  { needle: legacyRemoteNeedle, message: "legacy remote name must not be referenced in tracked docs or config" },
  { needle: extraProjectNeedle, message: "extra Vercel finance project id must not be referenced in tracked docs or config" },
];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignoredDirs.has(entry)) continue;
    const fullPath = path.join(directory, entry);
    const relativePath = path.relative(root, fullPath);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (ignoredFiles.has(relativePath)) continue;
    const extension = path.extname(entry);
    if (!textExtensions.has(extension) && !entry.startsWith(".")) continue;
    let text = "";
    try {
      text = readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    for (const pattern of activeSourcePatterns) {
      if (text.includes(pattern.needle)) {
        fail(`${relativePath}: ${pattern.message}`);
      }
    }
  }
}

walk(root);

if (errors.length) {
  console.error("migration-lock: failed");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("migration-lock: ok");
