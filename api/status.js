import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveCommitRef } from "../server/deploy-metadata.js";
import { probeGoogleSheetAccess } from "../server/manual-google-sheets.js";

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

  try {
    const [buildMetaResult, packageJson, vercelProject, googleProbe] = await Promise.all([
      loadBuildMeta(),
      loadPackageJson(),
      loadVercelProject(),
      probeGoogleSheetAccess()
    ]);
    const buildMeta = buildMetaResult.data;
    const buildTime = normalizeValue(buildMeta.buildTime);
    const deployTime = normalizeValue(
      buildMeta.deployTime
      || buildMeta.buildTime
      || process.env.VERCEL_DEPLOYMENT_CREATED_AT
    );
    const rawCommitSha = normalizeValue(
      process.env.VERCEL_GIT_COMMIT_SHA
      || buildMeta.gitCommitSha
      || buildMeta.commitSha
    );
    const hasGitMetadata = Boolean(rawCommitSha);
    const commitSha = rawCommitSha || "unknown";
    const deploymentEnvironment = normalizeValue(process.env.VERCEL_ENV || buildMeta.deploymentEnvironment) || "unknown";
    const effectiveError = (
      buildMetaResult.error === "metadata_unavailable" && hasGitMetadata
        ? null
        : buildMetaResult.error
    ) || (hasGitMetadata ? null : "commit_metadata_unavailable");
    const status = effectiveError ? "degraded" : "ok";

    return response.status(200).json({
      ok: true,
      status,
      service: "ezohata-incoming-ledger",
      vercelProjectName: normalizeValue(process.env.VERCEL_PROJECT_NAME || vercelProject.projectName) || "ezohata-incoming-ledger",
      deploymentUrl: normalizeValue(process.env.VERCEL_URL) || "unknown",
      appVersion: normalizeValue(buildMeta.appVersion || packageJson.version) || "unknown",
      appBuildVersion: normalizeValue(buildMeta.appBuildVersion) || "unknown",
      buildTime: buildTime || "unknown",
      deployTime: deployTime || "unknown",
      deploymentEnvironment,
      commitSha,
      commitRef: resolveCommitRef({ buildMeta }) || "unknown",
      gitProvider: normalizeValue(process.env.VERCEL_GIT_PROVIDER || buildMeta.gitProvider) || "unknown",
      gitRepoSlug: normalizeValue(process.env.VERCEL_GIT_REPO_SLUG || buildMeta.gitRepoSlug) || "unknown",
      hasGoogleServiceAccountEmail: googleProbe.hasEmail,
      hasGoogleServiceAccountPrivateKey: googleProbe.hasPrivateKey,
      googleSheetConfigured: googleProbe.configured,
      googleSheetReadOk: googleProbe.readOk,
      googleSheetReadError: googleProbe.error,
      error: effectiveError,
      vercel: {
        isVercel: process.env.VERCEL === "1",
        deploymentUrl: normalizeValue(process.env.VERCEL_URL) || "unknown",
        productionUrl: normalizeValue(process.env.VERCEL_PROJECT_PRODUCTION_URL) || "unknown",
      },
      observability: {
        liveCommitMatchesBuildCommit: Boolean(
          rawCommitSha
          && normalizeValue(buildMeta.commitSha)
          && rawCommitSha === normalizeValue(buildMeta.commitSha)
        ),
        hasGitMetadata,
        metadataSource: buildMetaResult.source
      }
    });
  } catch {
    const googleEnv = getGoogleEnvStatus();
    return response.status(503).json({
      ok: false,
      status: "degraded",
      service: "ezohata-incoming-ledger",
      vercelProjectName: normalizeValue(process.env.VERCEL_PROJECT_NAME) || "ezohata-incoming-ledger",
      deploymentUrl: normalizeValue(process.env.VERCEL_URL) || "unknown",
      appVersion: "unknown",
      appBuildVersion: "unknown",
      buildTime: "unknown",
      deployTime: normalizeValue(process.env.VERCEL_DEPLOYMENT_CREATED_AT) || "unknown",
      deploymentEnvironment: normalizeValue(process.env.VERCEL_ENV) || "unknown",
      commitSha: "unknown",
      commitRef: "unknown",
      gitProvider: "unknown",
      gitRepoSlug: "unknown",
      hasGoogleServiceAccountEmail: googleEnv.hasEmail,
      hasGoogleServiceAccountPrivateKey: googleEnv.hasPrivateKey,
      googleSheetConfigured: googleEnv.configured,
      googleSheetReadOk: false,
      googleSheetReadError: "status_runtime_unavailable",
      error: "status_runtime_unavailable",
      vercel: {
        isVercel: process.env.VERCEL === "1",
        deploymentUrl: normalizeValue(process.env.VERCEL_URL) || "unknown",
        productionUrl: normalizeValue(process.env.VERCEL_PROJECT_PRODUCTION_URL) || "unknown",
      },
      observability: {
        liveCommitMatchesBuildCommit: false,
        hasGitMetadata: false,
        metadataSource: "unavailable"
      }
    });
  }
}

async function loadBuildMeta() {
  const candidates = [
    {
      source: "generated",
      filePath: path.join(process.cwd(), ".generated", "build-meta.override.json")
    },
    {
      source: "ops",
      filePath: path.join(process.cwd(), "ops", "build-meta.json")
    }
  ];

  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate.filePath, "utf8");
      return {
        data: JSON.parse(text),
        source: candidate.source,
        error: null
      };
    } catch (error) {
      if (!isMissingFileError(error)) {
        return {
          data: {},
          source: candidate.source,
          error: `metadata_${candidate.source}_invalid`
        };
      }
    }
  }

  return {
    data: {},
    source: "missing",
    error: "metadata_unavailable"
  };
}

async function loadPackageJson() {
  try {
    const text = await readFile(path.join(process.cwd(), "package.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function loadVercelProject() {
  try {
    const text = await readFile(path.join(process.cwd(), ".vercel", "project.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getGoogleEnvStatus() {
  const hasEmail = Boolean(normalizeValue(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL));
  const hasPrivateKey = Boolean(normalizeValue(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY));
  return {
    hasEmail,
    hasPrivateKey,
    configured: hasEmail && hasPrivateKey
  };
}

function normalizeValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function isMissingFileError(error) {
  return Boolean(error && (error.code === "ENOENT" || error.code === "ENOTDIR"));
}
