import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const requiredFiles = [
  "index.html",
  "audit.html",
  "audit-bridge.js",
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
  "api/ledger-operation.js",
  "api/paypal-transactions.js",
  "api/wise-transactions.js",
  "api/monobank-transactions.js",
  "api/privatbank-transactions.js",
  "api/yoomoney-transactions.js",
  "server/binance-transactions.js",
  "server/period-balance-reconciliation-route.js",
];
const buildMetaCandidates = [
  {
    source: "generated",
    filePath: path.join(root, ".generated", "build-meta.override.json")
  },
  {
    source: "ops",
    filePath: path.join(root, "ops", "build-meta.json")
  }
];

if (isExecutedDirectly()) {
  await main();
}

export async function main() {
  for (const relativePath of requiredFiles) {
    await access(path.join(root, relativePath));
  }

  await parseJsonFile("sheet-config.json");
  await parseJsonFile("vercel.json");
  await parseJsonFile("ops/deployment-manifest.json");
  const packageJson = await parseJsonFile("package.json");

  const localAssetPattern = /\b(?:src|href)=["']([^"']+)["']/g;
  const missingAssets = [];
  for (const htmlFile of ["index.html", "audit.html"]) {
    const html = await readFile(path.join(root, htmlFile), "utf8");
    for (const match of html.matchAll(localAssetPattern)) {
      const target = match[1];
      if (!target || /^(https?:|data:|mailto:|#)/i.test(target)) continue;
      const normalized = target.replace(/[?#].*$/, "").replace(/^\.\//, "").replace(/^\//, "");
      try {
        await access(path.join(root, normalized));
      } catch {
        missingAssets.push(`${htmlFile}: ${target}`);
      }
    }
  }

  if (missingAssets.length) {
    throw new Error(`Missing assets referenced by HTML files: ${missingAssets.join(", ")}`);
  }

  const appBuildVersionMatch = (await readFile(path.join(root, "config.js"), "utf8"))
    .match(/const APP_BUILD_VERSION = "([^"]+)";/);
  const existingBuildMeta = await loadExistingBuildMeta();
  const buildMeta = composeBuildMeta({
    packageJson,
    appBuildVersion: appBuildVersionMatch?.[1] || "",
    existingBuildMeta
  });

  await writeFile(
    path.join(root, "ops", "build-meta.json"),
    `${JSON.stringify(buildMeta, null, 2)}\n`,
    "utf8"
  );

  await mkdir(path.join(root, ".generated"), { recursive: true });
  await writeFile(
    path.join(root, ".generated", "build-meta.override.json"),
    `${JSON.stringify(buildMeta, null, 2)}\n`,
    "utf8"
  );

  console.log("build-check: ok");
}

export function composeBuildMeta({
  packageJson,
  appBuildVersion,
  existingBuildMeta = {},
  detectGitValueFn = detectGitValue
}) {
  const deploymentEnvironment = normalizeValue(
    process.env.VERCEL_ENV
    || existingBuildMeta.deploymentEnvironment
    || process.env.NODE_ENV
    || "local"
  ) || "local";
  const gitCommitSha = normalizeValue(
    process.env.VERCEL_GIT_COMMIT_SHA
    || detectGitValueFn("rev-parse", "HEAD")
    || existingBuildMeta.gitCommitSha
    || existingBuildMeta.commitSha
  );
  const rawGitCommitRef = normalizeValue(
    process.env.VERCEL_GIT_COMMIT_REF
    || detectGitValueFn("rev-parse", "--abbrev-ref", "HEAD")
    || existingBuildMeta.gitCommitRef
    || existingBuildMeta.commitRef
  );
  const deployRef = resolveDeployRef({ existingBuildMeta });
  const sourceRef = resolveSourceRef({ rawGitCommitRef, deployRef, existingBuildMeta });
  const gitCommitRef = resolveGeneratedCommitRef({
    rawGitCommitRef,
    sourceRef,
    deploymentEnvironment
  });

  return {
    appVersion: String(packageJson.version || ""),
    appBuildVersion,
    buildTime: new Date().toISOString(),
    deploymentEnvironment,
    commitSha: gitCommitSha || "",
    commitRef: gitCommitRef || "",
    deployRef: deployRef || "",
    sourceRef: sourceRef || "",
    gitProvider: normalizeValue(
      process.env.VERCEL_GIT_PROVIDER
      || existingBuildMeta.gitProvider
    ) || "",
    gitRepoSlug: normalizeValue(
      process.env.VERCEL_GIT_REPO_SLUG
      || existingBuildMeta.gitRepoSlug
    ) || "",
    gitCommitSha: gitCommitSha || "",
    gitCommitRef: gitCommitRef || ""
  };
}

function resolveGeneratedCommitRef({
  rawGitCommitRef,
  sourceRef,
  deploymentEnvironment
}) {
  if (rawGitCommitRef === "HEAD" && isMainRef(sourceRef) && deploymentEnvironment === "production") {
    return "main";
  }

  return rawGitCommitRef || sourceRef || "";
}

function resolveDeployRef({ existingBuildMeta = {} } = {}) {
  return normalizeValue(
    process.env.DEPLOY_REF
    || process.env.EXPECTED_REF
    || nonDetachedRef(process.env.VERCEL_GIT_COMMIT_REF)
    || process.env.GITHUB_HEAD_REF
    || process.env.GITHUB_REF_NAME
    || normalizeGithubRef(process.env.GITHUB_REF)
    || existingBuildMeta.deployRef
    || existingBuildMeta.expectedRef
  );
}

function resolveSourceRef({ rawGitCommitRef, deployRef, existingBuildMeta = {} } = {}) {
  if (rawGitCommitRef && rawGitCommitRef !== "HEAD") {
    return rawGitCommitRef;
  }

  return normalizeValue(
    deployRef
    || process.env.SOURCE_REF
    || existingBuildMeta.sourceRef
  );
}

function normalizeGithubRef(value) {
  const normalized = normalizeValue(value);
  if (!normalized) return "";
  return normalized
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/tags\//, "")
    .replace(/^refs\/pull\/([^/]+)\/merge$/, "pull/$1");
}

function isMainRef(value) {
  return normalizeValue(value) === "main";
}

function nonDetachedRef(value) {
  const normalized = normalizeValue(value);
  return normalized && normalized !== "HEAD" ? normalized : "";
}

async function parseJsonFile(relativePath) {
  const text = await readFile(path.join(root, relativePath), "utf8");
  return JSON.parse(text);
}

async function loadExistingBuildMeta() {
  for (const candidate of buildMetaCandidates) {
    try {
      const text = await readFile(candidate.filePath, "utf8");
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return {};
}

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

function normalizeValue(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function isExecutedDirectly() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}
