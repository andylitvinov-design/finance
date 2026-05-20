#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";
const BODY_EXCERPT_LIMIT = 300;

export function parseCliArgs(argv = []) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    period: "",
    from: "",
    to: "",
    expectedSha: "",
    json: false,
    includeRows: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [rawKey, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s).slice(0, 2) : [arg, null];
    const nextValue = inlineValue ?? argv[index + 1];
    const consumeNext = inlineValue === null && nextValue && !String(nextValue).startsWith("--");

    if (rawKey === "--period") options.period = String(nextValue || "").trim();
    else if (rawKey === "--from") options.from = String(nextValue || "").trim();
    else if (rawKey === "--to") options.to = String(nextValue || "").trim();
    else if (rawKey === "--base-url") options.baseUrl = String(nextValue || "").trim() || DEFAULT_BASE_URL;
    else if (rawKey === "--expected-sha") options.expectedSha = String(nextValue || "").trim();
    else if (rawKey === "--json") options.json = true;
    else if (rawKey === "--include-rows") options.includeRows = true;
    else if (rawKey === "--help" || rawKey === "-h") options.help = true;

    if (["--period", "--from", "--to", "--base-url", "--expected-sha"].includes(rawKey) && consumeNext) index += 1;
  }

  return options;
}

export function validateOptions(options = {}) {
  const errors = [];
  if (!options.period && !(options.from && options.to)) {
    errors.push("Provide --period=YYYY-MM or both --from=YYYY-MM-DD --to=YYYY-MM-DD.");
  }
  if (options.period && !/^\d{4}-\d{2}$/.test(options.period)) {
    errors.push("--period must use YYYY-MM format.");
  }
  for (const key of ["from", "to"]) {
    if (options[key] && !/^\d{4}-\d{2}-\d{2}$/.test(options[key])) {
      errors.push(`--${key} must use YYYY-MM-DD format.`);
    }
  }
  return errors;
}

export function buildEndpointSpecs(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  const periodParams = buildPeriodSearchParams(options);
  const includeRows = Boolean(options.includeRows);

  return [
    { key: "status", method: "GET", url: `${baseUrl}/api/status` },
    { key: "auditSnapshot", method: "GET", url: `${baseUrl}/api/audit-snapshot?${periodParams}${includeRows ? "&includeRows=1" : ""}` },
    { key: "debugFull", method: "GET", url: `${baseUrl}/api/debug-full?${periodParams}` },
    { key: "debugUiState", method: "GET", url: `${baseUrl}/api/debug-ui-state?${periodParams}${includeRows ? "&includeRows=1" : ""}` },
  ];
}

export function buildPeriodSearchParams(options = {}) {
  const params = new URLSearchParams();
  if (options.period) {
    params.set("period", options.period);
  } else {
    params.set("from", options.from);
    params.set("to", options.to);
  }
  return params.toString();
}

export async function fetchEndpoint(spec, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(spec.url, {
      method: spec.method || "GET",
      headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
    });
    const contentType = response.headers?.get?.("content-type") || "";
    const text = await response.text();
    const redactedText = redactSecrets(text);
    const endpoint = {
      key: spec.key,
      method: spec.method || "GET",
      url: stripSensitiveUrl(spec.url),
      status: response.status,
      contentType,
      ok: response.ok,
      bodyExcerpt: redactedText.slice(0, BODY_EXCERPT_LIMIT),
      json: null,
      parseError: null,
    };

    if (looksJson(contentType, text)) {
      try {
        endpoint.json = text ? JSON.parse(text) : null;
        endpoint.bodyExcerpt = "";
      } catch (error) {
        endpoint.parseError = `JSON parse failed: ${String(error?.message || error)}`;
      }
    }

    return endpoint;
  } catch (error) {
    return {
      key: spec.key,
      method: spec.method || "GET",
      url: stripSensitiveUrl(spec.url),
      status: null,
      contentType: "",
      ok: false,
      bodyExcerpt: redactSecrets(String(error?.message || error)).slice(0, BODY_EXCERPT_LIMIT),
      json: null,
      parseError: "request failed",
    };
  }
}

export async function collectAgentDebugBundle(options = {}, fetchImpl = fetch) {
  const validationErrors = validateOptions(options);
  if (validationErrors.length) {
    return {
      ok: false,
      generated_at: new Date().toISOString(),
      errors: validationErrors,
      endpoints: {},
      report: null,
      exitCode: 2,
    };
  }

  const specs = buildEndpointSpecs(options);
  const endpointResults = {};
  for (const spec of specs) {
    endpointResults[spec.key] = await fetchEndpoint(spec, fetchImpl);
  }

  const report = buildCompactReport(endpointResults, options);
  const exitCode = determineExitCode(report, options);
  return {
    ok: exitCode === 0,
    generated_at: new Date().toISOString(),
    options: sanitizeOptions(options),
    endpoints: endpointResults,
    report,
    exitCode,
  };
}

export function buildCompactReport(endpoints = {}, options = {}) {
  const statusJson = endpoints.status?.json || {};
  const auditJson = endpoints.auditSnapshot?.json || {};
  const debugFullJson = endpoints.debugFull?.json || {};
  const debugUiJson = endpoints.debugUiState?.json || {};
  const production = {
    commitSha: statusJson.commitSha || debugFullJson.deploy?.commitSha || "unknown",
    commitRef: statusJson.commitRef || debugFullJson.deploy?.commitRef || "unknown",
    gitRepoSlug: statusJson.gitRepoSlug || debugFullJson.deploy?.source || "unknown",
    deploymentUrl: statusJson.deploymentUrl || statusJson.vercel?.deploymentUrl || debugFullJson.deploy?.deploymentUrl || "unknown",
    productionUrl: statusJson.vercel?.productionUrl || debugFullJson.deploy?.productionUrl || "unknown",
    expectedSha: options.expectedSha || "",
    productionVerified: options.expectedSha ? matchesExpectedSha(statusJson.commitSha, options.expectedSha) : null,
  };

  return {
    production,
    audit: {
      period: auditJson.period || null,
      summary: auditJson.summary || null,
      balances: auditJson.balances ? {
        uses_amount_net: auditJson.balances.uses_amount_net,
        missing_amount_net_rows: auditJson.balances.missing_amount_net_rows,
        fallback_amount_rows: auditJson.balances.fallback_amount_rows,
        excluded_missing_amount_net_rows: auditJson.balances.excluded_missing_amount_net_rows,
      } : null,
      daily_balance_summary: auditJson.daily_balances?.summary || null,
      balance_coverage_summary: auditJson.balance_coverage?.summary || null,
      warnings: sanitizeList(auditJson.warnings),
    },
    debug_ui_state: {
      top_metrics: debugUiJson.top_metrics || null,
      finance_analysis: summarizeDebugSection(debugUiJson.finance_analysis),
      expense_analysis: summarizeDebugSection(debugUiJson.expense_analysis),
      transfer_analysis: summarizeDebugSection(debugUiJson.transfer_analysis),
      source_counts: debugUiJson.source_counts || null,
      warnings: sanitizeList(debugUiJson.warnings),
    },
    endpoint_statuses: Object.fromEntries(
      Object.entries(endpoints).map(([key, value]) => [key, {
        method: value.method,
        url: value.url,
        status: value.status,
        contentType: value.contentType,
        ok: value.ok,
        parseError: value.parseError,
        bodyExcerpt: value.json ? "" : value.bodyExcerpt,
      }])
    ),
    classification: classifyBundle(endpoints, production, options),
  };
}

export function classifyBundle(endpoints = {}, production = {}, options = {}) {
  if (!endpoints.status?.ok) return "API unavailable: /api/status failed";
  if (!endpoints.status?.json) return "needs verification: /api/status did not return JSON";
  if (options.expectedSha && !matchesExpectedSha(production.commitSha, options.expectedSha)) {
    return "deploy/source mismatch";
  }
  if (!endpoints.auditSnapshot?.ok) return "audit unavailable";
  if (!endpoints.auditSnapshot?.json) return "needs verification: /api/audit-snapshot did not return JSON";
  if (!endpoints.debugUiState?.ok) return "debug-ui unavailable";
  if (!endpoints.debugUiState?.json) return "needs verification: /api/debug-ui-state did not return JSON";
  return "source ok";
}

export function determineExitCode(report, options = {}) {
  if (!report) return 2;
  if (options.expectedSha && report.production?.productionVerified === false) return 1;
  if (String(report.classification || "").startsWith("API unavailable")) return 1;
  return 0;
}

export function redactSecrets(value) {
  let text = String(value ?? "");
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]");
  text = text.replace(/Basic\s+[A-Za-z0-9+/=._~-]+/gi, "Basic [redacted]");
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]");
  text = text.replace(/\b\d{12,19}\b/g, "[number redacted]");
  text = text.replace(/(access_token|refresh_token|client_secret|private_key|debugToken|token|secret)(["'`:=\s]+)([^\s,;&}]+)/gi, "$1$2[redacted]");
  text = text.replace(/([?&](?:debugToken|token|access_token|refresh_token|client_secret|secret)=)[^&\s]+/gi, "$1[redacted]");
  return text;
}

export function formatTextReport(bundle) {
  if (bundle.errors?.length) {
    return ["Agent Debug Bundle failed:", ...bundle.errors.map((error) => `- ${error}`)].join("\n");
  }
  const report = bundle.report || {};
  const lines = [];
  lines.push("Agent Debug Bundle");
  lines.push(`Generated: ${bundle.generated_at}`);
  lines.push(`Classification: ${report.classification || "needs verification"}`);
  lines.push("");
  lines.push("Production source:");
  lines.push(`- commitSha: ${report.production?.commitSha || "unknown"}`);
  lines.push(`- commitRef: ${report.production?.commitRef || "unknown"}`);
  lines.push(`- gitRepoSlug: ${report.production?.gitRepoSlug || "unknown"}`);
  if (report.production?.expectedSha) {
    lines.push(`- expectedSha: ${report.production.expectedSha}`);
    lines.push(`- productionVerified: ${report.production.productionVerified ? "true" : "false"}`);
  }
  lines.push("");
  lines.push("Endpoint checks:");
  for (const [key, status] of Object.entries(report.endpoint_statuses || {})) {
    lines.push(`- ${key}: ${status.method} ${status.url} -> ${status.status || "request failed"} ${status.contentType || ""}`.trim());
    if (status.parseError) lines.push(`  parseError: ${status.parseError}`);
    if (status.bodyExcerpt) lines.push(`  bodyExcerpt: ${status.bodyExcerpt}`);
  }
  lines.push("");
  lines.push("Audit summary:");
  lines.push(JSON.stringify(report.audit, null, 2));
  lines.push("");
  lines.push("Debug UI state summary:");
  lines.push(JSON.stringify(report.debug_ui_state, null, 2));
  return redactSecrets(lines.join("\n"));
}

function summarizeDebugSection(section) {
  if (!section) return null;
  if (Array.isArray(section)) return { rows: section.length, sample: section.slice(0, 5) };
  const result = {};
  for (const [key, value] of Object.entries(section)) {
    if (key.endsWith("_rows")) continue;
    if (Array.isArray(value)) result[key] = { rows: value.length, sample: value.slice(0, 5) };
    else result[key] = value;
  }
  return result;
}

function sanitizeList(values) {
  return (Array.isArray(values) ? values : []).map(redactSecrets).filter(Boolean);
}

function sanitizeOptions(options = {}) {
  return {
    baseUrl: normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL),
    period: options.period || "",
    from: options.from || "",
    to: options.to || "",
    expectedSha: options.expectedSha || "",
    json: Boolean(options.json),
    includeRows: Boolean(options.includeRows),
  };
}

function stripSensitiveUrl(url) {
  return redactSecrets(String(url || ""));
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

function looksJson(contentType, text) {
  const type = String(contentType || "").toLowerCase();
  const body = String(text || "").trim();
  return type.includes("application/json") || body.startsWith("{") || body.startsWith("[");
}

function matchesExpectedSha(liveSha, expectedSha) {
  const live = String(liveSha || "").trim();
  const expected = String(expectedSha || "").trim();
  return Boolean(live && expected && (live === expected || live.startsWith(expected) || expected.startsWith(live)));
}

function printHelp() {
  console.log(`Usage:\n  node scripts/agent-debug-bundle.mjs --period=YYYY-MM [--expected-sha=<sha>] [--json]\n  node scripts/agent-debug-bundle.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD [--base-url=<url>]\n\nExamples:\n  npm run debug:bundle -- --period=2026-05\n  npm run debug:bundle -- --from=2026-05-01 --to=2026-05-20\n  npm run debug:bundle -- --period=2026-05 --expected-sha=<sha>`);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const bundle = await collectAgentDebugBundle(options);
  const output = options.json ? JSON.stringify(bundle, null, 2) : formatTextReport(bundle);
  console.log(output);
  process.exitCode = bundle.exitCode;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  main().catch((error) => {
    console.error(redactSecrets(String(error?.stack || error?.message || error)));
    process.exitCode = 1;
  });
}
