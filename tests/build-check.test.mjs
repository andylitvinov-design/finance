import test from "node:test";
import assert from "node:assert/strict";

import { composeBuildMeta } from "../scripts/build-check.mjs";

test("composeBuildMeta preserves existing git metadata when remote build has no git context", () => {
  const envBackup = snapshotEnv([
    "VERCEL_ENV",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_PROVIDER",
    "VERCEL_GIT_REPO_SLUG"
  ]);

  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_REF;
  delete process.env.VERCEL_GIT_PROVIDER;
  delete process.env.VERCEL_GIT_REPO_SLUG;
  process.env.VERCEL_ENV = "production";

  try {
    const buildMeta = composeBuildMeta({
      packageJson: { version: "3.0.31" },
      appBuildVersion: "2026.04.30.1",
      detectGitValueFn: () => "",
      existingBuildMeta: {
        deploymentEnvironment: "local",
        commitSha: "896c688962ebb22b2f4fe2f304c42d3a6b13bf72",
        commitRef: "main",
        gitProvider: "github",
        gitRepoSlug: "andylitvinov-design/finance",
        gitCommitSha: "896c688962ebb22b2f4fe2f304c42d3a6b13bf72",
        gitCommitRef: "main"
      }
    });

    assert.equal(buildMeta.deploymentEnvironment, "production");
    assert.equal(buildMeta.commitSha, "896c688962ebb22b2f4fe2f304c42d3a6b13bf72");
    assert.equal(buildMeta.commitRef, "main");
    assert.equal(buildMeta.gitCommitSha, "896c688962ebb22b2f4fe2f304c42d3a6b13bf72");
    assert.equal(buildMeta.gitCommitRef, "main");
    assert.equal(buildMeta.gitProvider, "github");
    assert.equal(buildMeta.gitRepoSlug, "andylitvinov-design/finance");
  } finally {
    restoreEnv(envBackup);
  }
});

test("composeBuildMeta prefers explicit Vercel git env vars over existing metadata", () => {
  const envBackup = snapshotEnv([
    "VERCEL_ENV",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_PROVIDER",
    "VERCEL_GIT_REPO_SLUG"
  ]);

  Object.assign(process.env, {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_SHA: "abcd1234",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_SLUG: "andylitvinov-design/finance"
  });

  try {
    const buildMeta = composeBuildMeta({
      packageJson: { version: "3.0.31" },
      appBuildVersion: "2026.04.30.1",
      detectGitValueFn: () => "",
      existingBuildMeta: {
        commitSha: "stale-sha",
        commitRef: "stale-branch",
        gitCommitSha: "stale-sha",
        gitCommitRef: "stale-branch"
      }
    });

    assert.equal(buildMeta.commitSha, "abcd1234");
    assert.equal(buildMeta.commitRef, "main");
    assert.equal(buildMeta.gitCommitSha, "abcd1234");
    assert.equal(buildMeta.gitCommitRef, "main");
    assert.equal(buildMeta.gitProvider, "github");
    assert.equal(buildMeta.gitRepoSlug, "andylitvinov-design/finance");
  } finally {
    restoreEnv(envBackup);
  }
});

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
