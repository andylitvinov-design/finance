import test from "node:test";
import assert from "node:assert/strict";

import handler from "../api/monobank-transactions.js";

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

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function createMonobankFetchMock(expectedToken) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url: String(url), token: options?.headers?.["X-Token"] });
      assert.equal(options?.headers?.["X-Token"], expectedToken);
      if (String(url).endsWith("/personal/client-info")) {
        return {
          ok: true,
          async json() {
            return {
              name: "Mono User",
              accounts: [
                { id: "acc-uah", currencyCode: 980, type: "black", maskedPan: ["444111******2222"] }
              ]
            };
          }
        };
      }
      assert.match(String(url), /\/personal\/statement\/acc-uah\//);
      return {
        ok: true,
        async json() {
          return [
            {
              id: "MONO-ONE-CLICK-1",
              time: 1775041200,
              description: "Client transfer",
              amount: 10000,
              currencyCode: 980
            }
          ];
        }
      };
    }
  };
}

test("handler one-click import uses MONOBANK_API_TOKEN when request has no manual token", async () => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MONOBANK_API_TOKEN;
  const mock = createMonobankFetchMock("env-token");
  global.fetch = mock.fetch;
  process.env.MONOBANK_API_TOKEN = "env-token";

  try {
    const request = {
      method: "POST",
      body: {
        startDate: "2026-04-01",
        endDate: "2026-04-02"
      }
    };
    const response = createResponseRecorder();
    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.mode, "env");
    assert.equal(response.body?.entries?.length, 1);
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[0].token, "env-token");
  } finally {
    global.fetch = previousFetch;
    restoreEnv("MONOBANK_API_TOKEN", previousToken);
  }
});

test("handler returns structured MONOBANK_TOKEN_MISSING when one-click import has no env token", async () => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MONOBANK_API_TOKEN;
  global.fetch = async () => {
    throw new Error("fetch must not be called without a token");
  };
  delete process.env.MONOBANK_API_TOKEN;

  try {
    const request = {
      method: "POST",
      body: {
        startDate: "2026-04-01",
        endDate: "2026-04-02"
      }
    };
    const response = createResponseRecorder();
    await handler(request, response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      ok: false,
      code: "MONOBANK_TOKEN_MISSING",
      error: "Monobank token is not configured.",
      action: "configure_env_or_manual_token",
      warning: "Monobank token/permission stale; upload screenshot or refresh token.",
      ui_action: "upload screenshot or refresh token"
    });
  } finally {
    global.fetch = previousFetch;
    restoreEnv("MONOBANK_API_TOKEN", previousToken);
  }
});

test("handler manual token still works for fallback flow", async () => {
  const previousFetch = global.fetch;
  const previousToken = process.env.MONOBANK_API_TOKEN;
  const mock = createMonobankFetchMock("manual-token");
  global.fetch = mock.fetch;
  process.env.MONOBANK_API_TOKEN = "env-token";

  try {
    const request = {
      method: "POST",
      body: {
        startDate: "2026-04-01",
        endDate: "2026-04-02",
        apiToken: "manual-token"
      }
    };
    const response = createResponseRecorder();
    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.mode, "manual");
    assert.equal(response.body?.entries?.length, 1);
    assert.equal(mock.calls[0].token, "manual-token");
  } finally {
    global.fetch = previousFetch;
    restoreEnv("MONOBANK_API_TOKEN", previousToken);
  }
});
