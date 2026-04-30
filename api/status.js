import { readFile } from "node:fs/promises";
import path from "node:path";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }

  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  const [buildMeta, packageJson] = await Promise.all([
    loadBuildMeta(),
    loadPackageJson()
  ]);
  const commitSha = normalizeValue(
    process.env.VERCEL_GIT_COMMIT_SHA
    || buildMeta.gitCommitSha
    || buildMeta.commitSha
  );

  return response.status(200).json({
    ok: true,
    service: "ezohata-incoming-ledger",
    appVersion: normalizeValue(buildMeta.appVersion || packageJson.version),
    appBuildVersion: normalizeValue(buildMeta.appBuildVersion),
    buildTime: normalizeValue(buildMeta.buildTime),
    deploymentEnvironment: normalizeValue(process.env.VERCEL_ENV || buildMeta.deploymentEnvironment),
    commitSha,
    commitRef: normalizeValue(
      process.env.VERCEL_GIT_COMMIT_REF
      || buildMeta.gitCommitRef
      || buildMeta.commitRef
    ),
    gitProvider: normalizeValue(process.env.VERCEL_GIT_PROVIDER || buildMeta.gitProvider),
    gitRepoSlug: normalizeValue(process.env.VERCEL_GIT_REPO_SLUG || buildMeta.gitRepoSlug),
    vercel: {
      isVercel: process.env.VERCEL === "1",
      deploymentUrl: normalizeValue(process.env.VERCEL_URL),
      productionUrl: normalizeValue(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    },
    observability: {
      liveCommitMatchesBuildCommit: Boolean(
        commitSha
        && normalizeValue(buildMeta.commitSha)
        && commitSha === normalizeValue(buildMeta.commitSha)
      ),
      hasGitMetadata: Boolean(commitSha)
    }
  });
}

async function loadBuildMeta() {
  try {
    const text = await readFile(path.join(process.cwd(), "ops", "build-meta.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function loadPackageJson() {
  try {
    const text = await readFile(path.join(process.cwd(), "package.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}
