import test from "node:test";
import assert from "node:assert/strict";

import handler from "../api/index.js";

const PNG = "data:image/png;base64,abcd";

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
    },
  };
}

test("parseBalanceScreenshot rejects non-POST methods with structured error", async () => {
  const response = createResponseRecorder();
  await handler({ method: "GET", query: { action: "parseBalanceScreenshot" } }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.body?.ok, false);
  assert.match(response.body?.error || "", /Unsupported method/);
});

test("parseBalanceScreenshot returns browser-ocr-required draft when OpenAI key is missing", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = createResponseRecorder();
    await handler(
      {
        method: "POST",
        query: { action: "parseBalanceScreenshot" },
        body: { images: [{ dataUrl: PNG }], date: "2026-06-30" },
      },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.source, "browser-ocr-required");
    assert.equal(response.body?.batch?.status, "draft");
    assert.equal(response.body?.batch?.confirmed, false);
    assert.equal(response.body?.batch?.capturedDate, "2026-06-30");
    // Original screenshot retained for provenance even without OCR.
    assert.equal(response.body?.batch?.screenshots?.[0]?.dataUrl, PNG);
    assert.deepEqual(response.body?.batch?.rows, []);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("parseBalanceScreenshot returns structured { ok:false } on non-JSON provider output", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  // Sheets read fails (no creds) -> graceful empty existing rows; OpenAI returns
  // a non-JSON body that should surface as a structured error.
  global.fetch = async (url) => {
    if (String(url).includes("openai.com")) {
      return { ok: true, status: 200, async json() { return { output_text: "totally not json {" }; } };
    }
    return { ok: false, status: 500, async json() { return {}; } };
  };
  try {
    const response = createResponseRecorder();
    await handler(
      {
        method: "POST",
        query: { action: "parseBalanceScreenshot" },
        body: { images: [{ dataUrl: PNG }], date: "2026-06-30" },
      },
      response
    );
    assert.equal(response.statusCode, 400);
    assert.equal(response.body?.ok, false);
    assert.equal(response.body?.action, "parseBalanceScreenshot");
    assert.match(response.body?.error || "", /not valid JSON/i);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  }
});

test("parseBalanceScreenshot rejects invalid images with structured error", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = createResponseRecorder();
    await handler(
      {
        method: "POST",
        query: { action: "parseBalanceScreenshot" },
        body: { images: [{ dataUrl: "data:text/plain;base64,abc" }] },
      },
      response
    );
    assert.equal(response.statusCode, 400);
    assert.equal(response.body?.ok, false);
    assert.match(response.body?.error || "", /PNG, JPEG, or WEBP/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
