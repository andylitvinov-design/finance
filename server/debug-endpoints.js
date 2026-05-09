import { readFile } from "node:fs/promises";
import path from "node:path";

export function isDebugAction(action) {
  return action === "debugFull" || action === "debugAnalytics";
}

export async function handleDebugAction(request, response, action) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }

  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: `Unsupported method: ${request.method}`
    });
  }

  if (action === "debugFull") {
    return response.status(200).json({
      ok: true,
      deploy: await getDeployMetadata(),
      period: getPeriod(request.query),
      endpoints: getEndpointInventory(),
      warnings: []
    });
  }

  return response.status(200).json({
    ok: true,
    period: getPeriod(request.query),
    periodGuard: {
      status: "needs_verification",
      rowsInsidePeriod: null,
      rowsOutsidePeriod: null,
      allTimeLeakDetected: "needs_verification",
      fieldsNeedingVerification: []
    },
    warnings: []
  });
}

function getPeriod(query = {}) {
  return {
    from: normalizeValue(query.from || query.startDate),
    to: normalizeValue(query.to || query.endDate)
  };
}

function getEndpointInventory() {
  return {
    status: {
      path: "/api/status",
      methods: ["GET", "OPTIONS"]
    },
    dashboardData: {
      path: "/api?action=getDashboardData",
      methods: ["GET"],
      query: { startDate: "from", endDate: "to" }
    },
    debugFull: {
      path: "/api/debug-full",
      methods: ["GET", "OPTIONS"]
    },
    debugAnalytics: {
      path: "/api/debug-analytics",
      methods: ["GET", "OPTIONS"]
    }
  };
}

async function getDeployMetadata() {
  const [buildMeta, packageJson, vercelProject] = await Promise.all([
    loadBuildMeta(),
    loadJson(path.join(process.cwd(), "package.json")),
    loadJson(path.join(process.cwd(), ".vercel", "project.json"))
  ]);

  return {
    commitSha: normalizeValue(
      process.env.VERCEL_GIT_COMMIT_SHA
      || buildMeta.gitCommitSha
      || buildMeta.commitSha
    ) || "unknown",
    commitRef: normalizeValue(
      process.env.VERCEL_GIT_COMMIT_REF
      || buildMeta.gitCommitRef
      || buildMeta.commitRef
    ) || "unknown",
    project: normalizeValue(
      process.env.VERCEL_PROJECT_NAME
      || vercelProject.projectName
      || packageJson.name
    ) || "ezohata-incoming-ledger",
    source: normalizeValue(
      process.env.VERCEL_GIT_REPO_SLUG
      || buildMeta.gitRepoSlug
    ) || "andylitvinov-design/finance"
  };
}

async function loadBuildMeta() {
  const generated = await loadJson(path.join(process.cwd(), ".generated", "build-meta.override.json"));
  if (Object.keys(generated).length) return generated;
  return await loadJson(path.join(process.cwd(), "ops", "build-meta.json"));
}

async function loadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function normalizeValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}
