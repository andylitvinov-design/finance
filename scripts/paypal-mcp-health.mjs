#!/usr/bin/env node
import process from "node:process";

const MCP_TOKEN_URL = "https://mcp.paypal.com/token";
const SECRET_NAMES = Object.freeze([
  "PAYPAL_MCP_CLIENT_ID",
  "PAYPAL_MCP_REFRESH_TOKEN",
  "PAYPAL_MCP_TOOL_NAME",
  "PAYPAL_IMPORT_MODE",
]);

function maskValue(value = "") {
  const text = String(value || "").trim();
  if (!text) return "missing";
  if (text.length <= 8) return "********";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function redactPayload(value) {
  return JSON.parse(JSON.stringify(value || {}).replace(
    /("(?:access_token|refresh_token|client_secret|client_id)"\s*:\s*")[^"]+(")/gi,
    "$1[redacted]$2"
  ));
}

function buildPresence(env = process.env) {
  return Object.fromEntries(SECRET_NAMES.map((name) => [
    name,
    {
      present: Boolean(String(env[name] || "").trim()),
      masked: maskValue(env[name]),
    },
  ]));
}

export async function buildPayPalMcpHealthReport(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const presence = buildPresence(env);
  const clientId = String(env.PAYPAL_MCP_CLIENT_ID || "").trim();
  const refreshToken = String(env.PAYPAL_MCP_REFRESH_TOKEN || "").trim();
  const report = {
    ok: false,
    provider: "paypal",
    check: "paypal_mcp_token_refresh",
    presence,
  };

  if (!clientId || !refreshToken) {
    return {
      ...report,
      providerStatus: "credentials_missing",
      actionRequired: "configure_paypal_mcp_env",
    };
  }

  const response = await fetchImpl(MCP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { text: text.slice(0, 300) };
  }
  const providerStatus = response.ok && payload?.access_token
    ? "ok"
    : (/grant not found|invalid_grant/i.test(`${payload?.error || ""} ${payload?.error_description || ""}`)
      ? "mcp_grant_not_found"
      : "mcp_token_failed");
  return {
    ...report,
    ok: providerStatus === "ok",
    providerStatus,
    ...(providerStatus === "mcp_grant_not_found" ? { actionRequired: "reconnect_paypal_mcp" } : {}),
    mcpTokenRefresh: {
      status: response.status,
      ok: response.ok,
      contentType: response.headers?.get?.("content-type") || "",
      body: redactPayload(payload),
    },
  };
}

async function main() {
  const report = await buildPayPalMcpHealthReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
