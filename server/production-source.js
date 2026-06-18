export const CANONICAL_PRODUCTION_REPO = "andylitvinov-design/finance";
export const DEPRECATED_PRODUCTION_REPO = "andylitvinov-design/ezohata-incoming-ledger";
export const STATUS_SOURCE_PATH = "/api/status";
export const ROLLBACK_PREFLIGHT_RULE = "Before rollback or patch, verify /api/status and confirm repo, branch, and deployed SHA.";

export function buildProductionSourceOfTruth({
  repoSlug = "",
  branch = "",
  deployedSha = "",
  statusSource = STATUS_SOURCE_PATH
} = {}) {
  return {
    repo: normalizeProductionRepo(repoSlug),
    branch: normalizeValue(branch) || "unknown",
    deployedSha: normalizeValue(deployedSha) || "unknown",
    statusSource,
    canonicalProductionRepo: CANONICAL_PRODUCTION_REPO,
    deprecatedRepo: DEPRECATED_PRODUCTION_REPO,
    rollbackPreflight: ROLLBACK_PREFLIGHT_RULE
  };
}

export function normalizeProductionRepo(value) {
  const repo = normalizeValue(value);
  if (repo === "finance") return CANONICAL_PRODUCTION_REPO;
  return repo || "unknown";
}

function normalizeValue(value) {
  return String(value || "").trim();
}
