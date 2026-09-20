import assert from "node:assert/strict";
import test from "node:test";

import middleware, {
  constantTimeEqual,
  parseBasicAuthorization,
} from "../middleware.mjs";

function requestWithCredentials(username, password) {
  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return new Request("https://example.test/api/index?health=1", {
    headers: { authorization: `Basic ${encoded}` },
  });
}

async function withToken(value, callback) {
  const previous = process.env.FINANCE_DASHBOARD_ACCESS_TOKEN;
  if (value == null) delete process.env.FINANCE_DASHBOARD_ACCESS_TOKEN;
  else process.env.FINANCE_DASHBOARD_ACCESS_TOKEN = value;
  try {
    await callback();
  } finally {
    if (previous == null) delete process.env.FINANCE_DASHBOARD_ACCESS_TOKEN;
    else process.env.FINANCE_DASHBOARD_ACCESS_TOKEN = previous;
  }
}

test("basic authorization parser rejects malformed input", () => {
  assert.equal(parseBasicAuthorization(""), null);
  assert.equal(parseBasicAuthorization("Bearer token"), null);
  assert.equal(parseBasicAuthorization("Basic not-base64!"), null);
});

test("constant-time comparison accepts only the configured token", async () => {
  assert.equal(await constantTimeEqual("correct", "correct"), true);
  assert.equal(await constantTimeEqual("incorrect", "correct"), false);
});

test("access gate fails closed when the server token is missing", async () => {
  await withToken(null, async () => {
    const response = await middleware(new Request("https://example.test/"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), /token|secret/i);
  });
});

test("access gate challenges anonymous and invalid requests", async () => {
  await withToken("configured-secret", async () => {
    const anonymous = await middleware(new Request("https://example.test/"));
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("www-authenticate"), /^Basic /);

    const invalid = await middleware(requestWithCredentials("owner", "wrong"));
    assert.equal(invalid.status, 401);

    const wrongUser = await middleware(requestWithCredentials("visitor", "configured-secret"));
    assert.equal(wrongUser.status, 401);
  });
});

test("access gate allows the owner credential without emitting a response", async () => {
  await withToken("configured-secret", async () => {
    const response = await middleware(
      requestWithCredentials("owner", "configured-secret"),
    );
    assert.equal(response, undefined);
  });
});
