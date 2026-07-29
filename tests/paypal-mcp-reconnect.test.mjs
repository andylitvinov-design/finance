import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPayPalMcpAuthorizationUrl,
  startPayPalMcpCallbackListener,
  validatePayPalMcpReconnectCallback,
} from "../scripts/reconnect-paypal-mcp.mjs";

test("PayPal MCP reconnect URL uses PKCE, a state value, and the local callback", () => {
  const url = new URL(buildPayPalMcpAuthorizationUrl({
    clientId: "public-client-id",
    redirectUri: "http://127.0.0.1:43110/callback",
    state: "state-value",
    codeChallenge: "challenge-value",
  }));

  assert.equal(url.origin, "https://mcp.paypal.com");
  assert.equal(url.pathname, "/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "public-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:43110/callback");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("PayPal MCP reconnect callback rejects missing, mismatched, and provider-error state", () => {
  assert.throws(() => validatePayPalMcpReconnectCallback(new URLSearchParams(), "expected-state"), /missing state or code/i);
  assert.throws(() => validatePayPalMcpReconnectCallback(new URLSearchParams({ code: "code", state: "wrong-state" }), "expected-state"), /state did not match/i);
  assert.throws(() => validatePayPalMcpReconnectCallback(new URLSearchParams({ error: "access_denied", state: "expected-state" }), "expected-state"), /access_denied/i);
  assert.deepEqual(
    validatePayPalMcpReconnectCallback(new URLSearchParams({ code: "one-time-code", state: "expected-state" }), "expected-state"),
    { code: "one-time-code" }
  );
});

test("PayPal MCP listener is healthy before an authorization URL can be issued", async () => {
  const listener = await startPayPalMcpCallbackListener({ port: 0 });
  try {
    const response = await fetch(`${listener.origin}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, status: "listening" });
  } finally {
    await listener.close();
  }
});
