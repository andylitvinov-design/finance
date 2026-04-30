import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import handler from "../api/status.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test("GET /api/status returns build metadata when generated file exists", async () => {
  const buildMetaPath = path.join(process.cwd(), "ops", "build-meta.json");
  const overridePath = path.join(process.cwd(), ".generated", "build-meta.override.json");
  const originalText = await readFile(buildMetaPath, "utf8").catch(() => null);
  const originalOverrideText = await readFile(overridePath, "utf8").catch(() => null);
  const envBackup = snapshotEnv([
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_PROVIDER",
    "VERCEL_GIT_REPO_SLUG"
  ]);

  await mkdir(path.dirname(buildMetaPath), { recursive: true });
  await writeFile(buildMetaPath, `${JSON.stringify({
    appVersion: "9.9.9",
    appBuildVersion: "2026.04.30.99",
    buildTime: "2026-04-30T19:20:00.000Z",
    deploymentEnvironment: "production",
    commitSha: "localsha123",
    commitRef: "main",
    gitProvider: "github",
    gitRepoSlug: "andylitvinov-design/finance",
    gitCommitSha: "gitsha456",
    gitCommitRef: "main"
  }, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(overridePath), { recursive: true });
  await writeFile(overridePath, `${JSON.stringify({
    appVersion: "9.9.9",
    appBuildVersion: "2026.04.30.99",
    buildTime: "2026-04-30T19:20:00.000Z",
    deploymentEnvironment: "production",
    commitSha: "localsha123",
    commitRef: "main",
    gitProvider: "github",
    gitRepoSlug: "andylitvinov-design/finance",
    gitCommitSha: "gitsha456",
    gitCommitRef: "main"
  }, null, 2)}\n`, "utf8");

  Object.assign(process.env, {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_URL: "ezohata-incoming-ledger.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "ezohata-incoming-ledger.vercel.app",
    VERCEL_GIT_COMMIT_SHA: "vercelsha789",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_SLUG: "andylitvinov-design/finance"
  });

  try {
    const response = createResponseRecorder();
    await handler({ method: "GET", query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.status, "ok");
    assert.equal(response.body?.commitSha, "vercelsha789");
    assert.equal(response.body?.appVersion, "9.9.9");
    assert.equal(response.body?.appBuildVersion, "2026.04.30.99");
    assert.equal(response.body?.deploymentEnvironment, "production");
    assert.equal(response.body?.vercel?.deploymentUrl, "ezohata-incoming-ledger.vercel.app");
    assert.equal(response.body?.observability?.hasGitMetadata, true);
    assert.equal(response.body?.observability?.metadataSource, "generated");
    assert.equal(response.body?.error, null);
  } finally {
    await restoreFile(buildMetaPath, originalText);
    await restoreFile(overridePath, originalOverrideText);
    restoreEnv(envBackup);
  }
});

test("GET /api/status falls back safely when build metadata file is missing", async () => {
  const buildMetaPath = path.join(process.cwd(), "ops", "build-meta.json");
  const overridePath = path.join(process.cwd(), ".generated", "build-meta.override.json");
  const originalText = await readFile(buildMetaPath, "utf8").catch(() => null);
  const originalOverrideText = await readFile(overridePath, "utf8").catch(() => null);
  const envBackup = snapshotEnv([
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_PROVIDER",
    "VERCEL_GIT_REPO_SLUG"
  ]);

  await rm(buildMetaPath, { force: true });
  await rm(overridePath, { force: true });
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_REF;
  delete process.env.VERCEL_GIT_PROVIDER;
  delete process.env.VERCEL_GIT_REPO_SLUG;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_URL = "preview.example.vercel.app";
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    const response = createResponseRecorder();
    await handler({ method: "GET", query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.status, "degraded");
    assert.equal(response.body?.deploymentEnvironment, "preview");
    assert.equal(response.body?.commitSha, "unknown");
    assert.equal(response.body?.observability?.hasGitMetadata, false);
    assert.equal(response.body?.observability?.metadataSource, "missing");
    assert.equal(response.body?.error, "metadata_unavailable");
  } finally {
    await restoreFile(buildMetaPath, originalText);
    await restoreFile(overridePath, originalOverrideText);
    restoreEnv(envBackup);
  }
});

test("GET /api/status returns degraded JSON when build metadata is malformed", async () => {
  const buildMetaPath = path.join(process.cwd(), "ops", "build-meta.json");
  const overridePath = path.join(process.cwd(), ".generated", "build-meta.override.json");
  const originalText = await readFile(buildMetaPath, "utf8").catch(() => null);
  const originalOverrideText = await readFile(overridePath, "utf8").catch(() => null);
  const envBackup = snapshotEnv([
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_PROVIDER",
    "VERCEL_GIT_REPO_SLUG"
  ]);

  await mkdir(path.dirname(overridePath), { recursive: true });
  await writeFile(overridePath, "{not-json}\n", "utf8");
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_REF;
  delete process.env.VERCEL_GIT_PROVIDER;
  delete process.env.VERCEL_GIT_REPO_SLUG;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_URL = "ezohata-incoming-ledger.vercel.app";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "ezohata-incoming-ledger.vercel.app";

  try {
    const response = createResponseRecorder();
    await handler({ method: "GET", query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.status, "degraded");
    assert.equal(response.body?.commitSha, "unknown");
    assert.equal(response.body?.error, "metadata_generated_invalid");
    assert.equal(response.body?.observability?.metadataSource, "generated");
  } finally {
    await restoreFile(buildMetaPath, originalText);
    await restoreFile(overridePath, originalOverrideText);
    restoreEnv(envBackup);
  }
});

test("GET /api/status degrades when metadata exists but commit fields are unavailable", async () => {
  const buildMetaPath = path.join(process.cwd(), "ops", "build-meta.json");
  const overridePath = path.join(process.cwd(), ".generated", "build-meta.override.json");
  const originalText = await readFile(buildMetaPath, "utf8").catch(() => null);
  const originalOverrideText = await readFile(overridePath, "utf8").catch(() => null);
  const envBackup = snapshotEnv([
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_PROVIDER",
    "VERCEL_GIT_REPO_SLUG"
  ]);

  await mkdir(path.dirname(overridePath), { recursive: true });
  await writeFile(overridePath, `${JSON.stringify({
    appVersion: "9.9.9",
    appBuildVersion: "2026.04.30.99",
    buildTime: "2026-04-30T19:20:00.000Z",
    deploymentEnvironment: "production",
    commitSha: "",
    commitRef: "",
    gitProvider: "",
    gitRepoSlug: "",
    gitCommitSha: "",
    gitCommitRef: ""
  }, null, 2)}\n`, "utf8");
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_REF;
  delete process.env.VERCEL_GIT_PROVIDER;
  delete process.env.VERCEL_GIT_REPO_SLUG;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_URL = "ezohata-incoming-ledger.vercel.app";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "ezohata-incoming-ledger.vercel.app";

  try {
    const response = createResponseRecorder();
    await handler({ method: "GET", query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.status, "degraded");
    assert.equal(response.body?.commitSha, "unknown");
    assert.equal(response.body?.error, "commit_metadata_unavailable");
    assert.equal(response.body?.observability?.hasGitMetadata, false);
  } finally {
    await restoreFile(buildMetaPath, originalText);
    await restoreFile(overridePath, originalOverrideText);
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

async function restoreFile(filePath, originalText) {
  if (originalText === null) {
    await rm(filePath, { force: true });
    return;
  }
  await writeFile(filePath, originalText, "utf8");
}
