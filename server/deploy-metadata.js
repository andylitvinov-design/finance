export function resolveCommitRef({
  envCommitRef = process.env.VERCEL_GIT_COMMIT_REF,
  envCommitSha = process.env.VERCEL_GIT_COMMIT_SHA,
  buildMeta = {}
} = {}) {
  const envRef = normalizeValue(envCommitRef);
  const buildRef = normalizeValue(buildMeta.gitCommitRef || buildMeta.commitRef);

  if (envRef === "HEAD") {
    const envSha = normalizeValue(envCommitSha);
    const buildSha = normalizeValue(buildMeta.commitSha || buildMeta.gitCommitSha);
    if (buildRef === "main" && envSha && buildSha && envSha === buildSha) {
      return "main";
    }
    const buildSourceRef = normalizeValue(
      buildMeta.deployRef
      || buildMeta.sourceRef
      || buildMeta.expectedRef
    );
    if (buildSourceRef === "main" && envSha && buildSha && envSha === buildSha) {
      return "main";
    }
    return envRef;
  }

  return envRef || buildRef;
}

function normalizeValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}
