#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

export const PAYPAL_MCP_AUTHORIZATION_URL = "https://mcp.paypal.com/authorize";
export const PAYPAL_MCP_TOKEN_URL = "https://mcp.paypal.com/token";
export const PAYPAL_MCP_REGISTRATION_URL = "https://mcp.paypal.com/register";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

export function buildPayPalMcpAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(PAYPAL_MCP_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: required(clientId, "PayPal MCP client id"),
    redirect_uri: required(redirectUri, "PayPal MCP redirect URI"),
    state: required(state, "PayPal MCP state"),
    code_challenge: required(codeChallenge, "PayPal MCP PKCE code challenge"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export function validatePayPalMcpReconnectCallback(params, expectedState) {
  const state = String(params?.get?.("state") || "");
  const code = String(params?.get?.("code") || "");
  const providerError = String(params?.get?.("error") || "");
  const expected = required(expectedState, "Expected PayPal MCP state");
  if (providerError) throw new Error(`PayPal authorization failed: ${providerError}`);
  if (!state || !code) throw new Error("PayPal callback is missing state or code.");
  const actualBuffer = Buffer.from(state);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("PayPal callback state did not match.");
  }
  return { code };
}

export function createPayPalMcpPkceSession(random = randomBytes) {
  const state = random(32).toString("base64url");
  const codeVerifier = random(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { state, codeVerifier, codeChallenge };
}

async function parseJsonResponse(response, context) {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} returned an unreadable response (${response.status || "unknown"}).`);
  }
}

export async function registerPayPalMcpPublicClient({ redirectUri, fetchImpl = fetch }) {
  const response = await fetchImpl(PAYPAL_MCP_REGISTRATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "EzoHata personal PayPal reconnect",
      redirect_uris: [required(redirectUri, "PayPal MCP redirect URI")],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const payload = await parseJsonResponse(response, "PayPal MCP registration");
  if (!response.ok || !payload?.client_id) throw new Error("PayPal MCP registration did not return a public client id.");
  return { clientId: String(payload.client_id) };
}

export async function exchangePayPalMcpCode({ clientId, redirectUri, code, codeVerifier, fetchImpl = fetch }) {
  const response = await fetchImpl(PAYPAL_MCP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: required(clientId, "PayPal MCP client id"),
      redirect_uri: required(redirectUri, "PayPal MCP redirect URI"),
      code: required(code, "PayPal authorization code"),
      code_verifier: required(codeVerifier, "PayPal PKCE code verifier"),
    }).toString(),
  });
  const payload = await parseJsonResponse(response, "PayPal MCP token exchange");
  if (!response.ok || !payload?.refresh_token) throw new Error("PayPal MCP token exchange did not return a refresh token.");
  return { refreshToken: String(payload.refresh_token) };
}

function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Vercel command failed (${code}): ${stderr.replace(/\s+/g, " ").trim().slice(0, 240)}`));
    });
    child.stdin.end(input);
  });
}

export async function storePayPalMcpRefreshToken(refreshToken, runCommand = run) {
  const value = required(refreshToken, "PayPal MCP refresh token");
  await runCommand("npx", ["--yes", "vercel", "env", "rm", "PAYPAL_MCP_REFRESH_TOKEN", "production", "--yes"]);
  await runCommand("npx", ["--yes", "vercel", "env", "add", "PAYPAL_MCP_REFRESH_TOKEN", "production"], `${value}\n`);
}

function getPort() {
  const index = process.argv.indexOf("--port");
  const value = index >= 0 ? Number(process.argv[index + 1]) : 43110;
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("Use a valid --port between 1024 and 65535.");
  return value;
}

async function main() {
  if (!process.argv.includes("--apply-vercel")) {
    throw new Error("Run with --apply-vercel so the new refresh token is passed only by stdin to Vercel Production.");
  }
  const port = getPort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const session = createPayPalMcpPkceSession();
  const { clientId } = await registerPayPalMcpPublicClient({ redirectUri });
  const authorizationUrl = buildPayPalMcpAuthorizationUrl({ clientId, redirectUri, ...session });
  const server = createServer(async (request, response) => {
    try {
      if (request.url?.split("?")[0] !== "/callback") throw new Error("Unexpected callback path.");
      const params = new URL(request.url, redirectUri).searchParams;
      const { code } = validatePayPalMcpReconnectCallback(params, session.state);
      const { refreshToken } = await exchangePayPalMcpCode({ clientId, redirectUri, code, codeVerifier: session.codeVerifier });
      await storePayPalMcpRefreshToken(refreshToken);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("PayPal reconnected. You may close this tab.");
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("PayPal reconnect failed. Return to the terminal for the safe error message.");
      process.stderr.write(`${error?.message || error}\n`);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  process.stdout.write(`Open:\n${authorizationUrl}\n\nAction:\nSign in to the same personal PayPal account and approve access.\n`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
