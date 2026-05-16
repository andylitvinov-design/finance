import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import indexHandler from "../api/index.js";

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

test("manual workbook routes normalize Google quota errors", async () => {
  const previousFetch = global.fetch;
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "service@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  global.fetch = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { access_token: "server-token" };
        }
      };
    }
    return {
      ok: false,
      status: 429,
      headers: { get: () => "60" },
      async text() {
        return JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Read requests'" } });
      }
    };
  };

  try {
    const response = createResponseRecorder();
    await indexHandler({
      method: "POST",
      query: { action: "manualWorkbook", route: "manual-finance" },
      body: {
        action: "sheetsFetch",
        method: "GET",
        path: "/spreadsheets/1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY/values/'Ledger'"
      }
    }, response);

    assert.equal(response.statusCode, 429);
    assert.deepEqual(response.body, {
      ok: false,
      error: "Google Sheets quota exceeded. Retry shortly.",
      retryAfter: 60
    });
  } finally {
    global.fetch = previousFetch;
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", previousEmail);
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", previousKey);
  }
});

test("manual workbook route allows monthly plan sheet reads", async () => {
  const previousFetch = global.fetch;
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const requestedUrls = [];
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "service@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { access_token: "server-token" };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({ values: [["month"], ["2026-05"]] });
      }
    };
  };

  try {
    const response = createResponseRecorder();
    await indexHandler({
      method: "POST",
      query: { action: "manualWorkbook", route: "manual-transfers" },
      body: {
        action: "sheetsFetch",
        method: "GET",
        path: "/spreadsheets/1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY/values/'%D0%9F%D0%BB%D0%B0%D0%BD'"
      }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.route, "manual-transfers");
    assert.deepEqual(response.body.data, { values: [["month"], ["2026-05"]] });
    assert.ok(requestedUrls.some((url) => url.includes("/%D0%9F%D0%BB%D0%B0%D0%BD")));
  } finally {
    global.fetch = previousFetch;
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", previousEmail);
    restoreEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", previousKey);
  }
});

test("UI normal flow is server-first and keeps OAuth fallback debug-only", () => {
  const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../google-auth.js", import.meta.url), "utf8");
  const sheets = readFileSync(new URL("../google-sheets.js", import.meta.url), "utf8");
  const orders = readFileSync(new URL("../orders.js", import.meta.url), "utf8");
  const finance = readFileSync(new URL("../finance.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../ui.js", import.meta.url), "utf8");

  assert.equal(main.includes("await trySilentGoogleConnect()"), false);
  assert.match(main, /requestDashboardLoad/);
  assert.match(sheets, /googleSheetsFetchViaManualServer/);
  assert.match(sheets, /withManualServerRoute\("\/api\/manual-orders"/);
  assert.match(sheets, /withManualServerRoute\("\/api\/manual-transfers"/);
  assert.match(ui, /withManualServerRoute\("\/api\/manual-savings"/);
  assert.doesNotMatch(orders, /ensureGoogleAccess\(/);
  assert.doesNotMatch(finance, /ensureGoogleAccess\(/);
  assert.match(auth, /Server access active — Google browser OAuth not required\./);
  assert.match(auth, /fallbackVisible/);
  assert.match(ui, /Server access active — Google browser OAuth not required\./);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
