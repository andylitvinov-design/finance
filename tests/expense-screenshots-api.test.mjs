import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  normalizeVisionResult,
  parseExpenseScreenshots,
  validateImages,
} from "../api/expense-screenshots.js";

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

test("validateImages rejects invalid and oversized screenshots", () => {
  assert.throws(() => validateImages([]), /At least one/);
  assert.throws(
    () => validateImages([{ dataUrl: "data:text/plain;base64,abc" }]),
    /PNG, JPEG, or WEBP/
  );
  assert.throws(
    () => validateImages([{ dataUrl: `data:image/png;base64,${"a".repeat(9 * 1024 * 1024)}` }]),
    /too large/
  );
});

test("normalizeVisionResult keeps study as a separate category", () => {
  const result = normalizeVisionResult(
    {
      entries: [
        {
          date: "2026-04-20",
          channel: "монобанк грн",
          direction: "expense",
          localAmount: 1200,
          currency: "uah",
          usdAmount: 30,
          organization: "Course",
          suggestedCategory: "обучение",
          confidence: 0.77,
          sourceImageIndex: 0
        }
      ],
      warnings: []
    },
    {
      channels: ["монобанк грн"],
      categories: ["business", "flat", "food", "fun", "travel", "study"]
    }
  );

  assert.equal(result.entries[0].suggestedCategory, "study");
  assert.equal(result.entries[0].channel, "монобанк грн");
  assert.equal(result.entries[0].usdAmount, 30);
});

test("parseExpenseScreenshots sends images to OpenAI and parses JSON output", async () => {
  const calls = [];
  const result = await parseExpenseScreenshots(
    [{ dataUrl: "data:image/jpeg;base64,abcd", sourceImageIndex: 0 }],
    {
      apiKey: "test-key",
      model: "test-model",
      channels: ["Яндекс руб"],
      categories: ["business", "flat", "food", "fun", "travel", "study"],
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              output_text: JSON.stringify({
                entries: [
                  {
                    date: "2026-04-21",
                    channel: "Яндекс руб",
                    direction: "expense",
                    localAmount: 500,
                    currency: "RUB",
                    usdAmount: null,
                    organization: "Store",
                    suggestedCategory: "food",
                    confidence: 0.8,
                    sourceImageIndex: 0
                  }
                ],
                warnings: []
              })
            };
          }
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.match(calls[0].options.headers.Authorization, /Bearer test-key/);
  assert.equal(result.entries[0].suggestedCategory, "food");
});

test("handler requests browser OCR fallback when OpenAI key is missing", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = createResponseRecorder();
    await handler(
      {
        method: "POST",
        body: {
          images: [{ dataUrl: "data:image/jpeg;base64,abcd" }]
        }
      },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.source, "browser-ocr-required");
    assert.deepEqual(response.body?.entries, []);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("handler falls back to browser OCR when OpenAI upstream is unavailable", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => ({
    ok: false,
    status: 429,
    async json() {
      return {
        error: {
          message: "You exceeded your current quota."
        }
      };
    }
  });

  try {
    const response = createResponseRecorder();
    await handler(
      {
        method: "POST",
        body: {
          images: [{ dataUrl: "data:image/jpeg;base64,abcd" }]
        }
      },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.source, "browser-ocr-required");
    assert.deepEqual(response.body?.entries, []);
    assert.match(response.body?.warnings?.[0] || "", /quota|OpenAI/i);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    global.fetch = previousFetch;
  }
});
