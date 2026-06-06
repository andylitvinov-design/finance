#!/usr/bin/env node

const DEFAULT_LIVE_URL = "https://ezohata-incoming-ledger.vercel.app";
const EXPECTED_REPO_SLUGS = new Set(["finance", "andylitvinov-design/finance"]);

const args = process.argv.slice(2);
const options = parseArgs(args);

async function main() {
  const liveUrl = normalizeBaseUrl(options.url || process.env.EZOHATA_LIVE_URL || DEFAULT_LIVE_URL);
  const statusUrl = `${liveUrl}/api/status`;
  const response = await fetch(statusUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();
  const bodyExcerpt = bodyText.replace(/\s+/g, " ").trim().slice(0, 300);
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }

  const result = buildResult({ liveUrl, statusUrl, response, contentType, bodyExcerpt, payload, options });
  printResult(result);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

function parseArgs(input) {
  const parsed = { strict: false, expectedCommit: "", url: "" };
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (arg === "--strict") {
      parsed.strict = true;
    } else if (arg === "--expected-commit") {
      parsed.expectedCommit = input[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--expected-commit=")) {
      parsed.expectedCommit = arg.slice("--expected-commit=".length);
    } else if (arg === "--url") {
      parsed.url = input[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--url=")) {
      parsed.url = arg.slice("--url=".length);
    }
  }
  return parsed;
}

function buildResult({ liveUrl, statusUrl, response, contentType, bodyExcerpt, payload, options }) {
  const commitSha = text(payload?.commitSha);
  const commitRef = text(payload?.commitRef);
  const repoSlug = text(payload?.gitRepoSlug);
  const projectName = text(payload?.vercelProjectName || payload?.service);
  const productionUrl = text(payload?.productionUrl || payload?.vercel?.productionUrl);
  const problems = [];
  const warnings = [];

  if (!response.ok) {
    problems.push(`status endpoint returned HTTP ${response.status}`);
  }
  if (!/application\/json/i.test(contentType)) {
    problems.push(`status endpoint content-type is not JSON: ${contentType || "missing"}`);
  }
  if (!payload?.ok) {
    problems.push("status payload is missing ok=true");
  }
  if (projectName !== "ezohata-incoming-ledger") {
    problems.push(`unexpected project/service: ${projectName || "missing"}`);
  }
  if (repoSlug && repoSlug !== "unknown" && !EXPECTED_REPO_SLUGS.has(repoSlug)) {
    problems.push(`unexpected git repo slug: ${repoSlug}`);
  }
  if (!commitSha || commitSha === "unknown") {
    problems.push("commitSha is missing/unknown");
  }
  if (!commitRef || commitRef === "unknown") {
    warnings.push("commitRef is missing/unknown");
  }
  if (options.strict && commitRef !== "main") {
    problems.push(`strict mode expected commitRef=main, got ${commitRef || "missing"}`);
  }
  if (options.expectedCommit && commitSha !== options.expectedCommit) {
    problems.push(`expected commit ${options.expectedCommit}, got ${commitSha || "missing"}`);
  }
  if (productionUrl && productionUrl !== "ezohata-incoming-ledger.vercel.app") {
    problems.push(`unexpected productionUrl: ${productionUrl}`);
  }

  return {
    ok: problems.length === 0,
    status: response.status,
    contentType,
    liveUrl,
    statusUrl,
    sourceOfTruth: {
      projectName,
      repoSlug: repoSlug || "unknown",
      commitRef: commitRef || "unknown",
      commitSha: commitSha || "unknown",
      productionUrl: productionUrl || "unknown",
      deploymentUrl: text(payload?.deploymentUrl || payload?.vercel?.deploymentUrl) || "unknown",
      appVersion: text(payload?.appVersion) || "unknown",
      appBuildVersion: text(payload?.appBuildVersion) || "unknown",
      buildTime: text(payload?.buildTime) || "unknown",
      deployTime: text(payload?.deployTime) || "unknown",
    },
    google: {
      configured: Boolean(payload?.googleSheetConfigured),
      readOk: Boolean(payload?.googleSheetReadOk),
      readError: text(payload?.googleSheetReadError) || null,
    },
    problems,
    warnings,
    bodyExcerpt,
    next: problems.length
      ? "Resolve deploy/source-of-truth mismatch before patching formulas/UI logic."
      : "Production source preflight passed. Continue to prove failing layer before patching.",
  };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_LIVE_URL).trim().replace(/\/+$/, "");
}

function text(value) {
  return String(value || "").trim();
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error?.message || error),
    next: "Production source preflight failed; do not patch formulas/UI logic until this is resolved.",
  }, null, 2));
  process.exitCode = 1;
});
