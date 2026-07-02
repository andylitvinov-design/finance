import test from "node:test";
import assert from "node:assert/strict";

import {
  annotateBalanceDraftDuplicates,
  buildBalanceDraftBatch,
  buildBalanceScreenshotPrompt,
  normalizeBalanceDraftRows,
  parseBalanceScreenshotJson,
  parseBalanceScreenshotsToDraft,
  requestBalanceScreenshotVision,
  validateBalanceScreenshotImages,
} from "../server/balance-screenshot-draft.js";

const PNG = "data:image/png;base64,abcd";

test("validateBalanceScreenshotImages rejects empty, invalid, oversized, and too many", () => {
  assert.throws(() => validateBalanceScreenshotImages([]), /At least one/);
  assert.throws(
    () => validateBalanceScreenshotImages([{ dataUrl: "data:text/plain;base64,abc" }]),
    /PNG, JPEG, or WEBP/
  );
  assert.throws(
    () => validateBalanceScreenshotImages([{ dataUrl: `data:image/png;base64,${"a".repeat(9 * 1024 * 1024)}` }]),
    /too large/
  );
  assert.throws(
    () => validateBalanceScreenshotImages(Array.from({ length: 9 }, () => ({ dataUrl: PNG }))),
    /Too many/
  );
});

test("buildBalanceScreenshotPrompt forbids currency conversion and transactions", () => {
  const prompt = buildBalanceScreenshotPrompt({ channels: ["Бинанс spot", "пейпал дол"] });
  assert.match(prompt, /Do NOT convert between currencies/i);
  assert.match(prompt, /NOT an individual transaction/i);
  assert.match(prompt, /Бинанс spot/);
});

test("parseBalanceScreenshotJson throws structured error on non-JSON provider output", () => {
  assert.throws(() => parseBalanceScreenshotJson({ output_text: "not json {" }), /not valid JSON/i);
  assert.throws(() => parseBalanceScreenshotJson({}), /did not contain parseable text/i);
});

test("normalizeBalanceDraftRows canonicalizes channels and never auto-converts currency", () => {
  const rows = normalizeBalanceDraftRows({
    rows: [
      { channel: "бинанс spot", currency: "usdt", amount: 1689, confidence: 0.9, sourceImageIndex: 0 },
      { channel: "БАНК КАНАДА", currency: "cad", amount: 7351, confidence: 0.8, sourceImageIndex: 0 },
      { channel: "", currency: "USD", amount: 10, confidence: 0.5, sourceImageIndex: 0 },
      { channel: "пейпал дол", currency: "USD", amount: null, confidence: 0.3, sourceImageIndex: 0 },
    ],
    warnings: [],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].channel, "Бинанс spot");
  assert.equal(rows[0].currency, "USDT");
  assert.equal(rows[0].amount, 1689);
  assert.equal(rows[0].rate, "");
  assert.equal(rows[0].usdAmount, "");
  assert.equal(rows[1].channel, "БАНК КАНАДА cad");
});

test("buildBalanceDraftBatch retains the original screenshot as provenance", () => {
  const batch = buildBalanceDraftBatch({
    images: validateBalanceScreenshotImages([{ dataUrl: PNG, name: "wallet.png" }]),
    rows: [{ channel: "Бинанс spot", currency: "USDT", amount: 1689 }],
    date: "2026-06-30",
    now: new Date("2026-06-30T10:00:00.000Z"),
  });
  assert.equal(batch.status, "draft");
  assert.equal(batch.confirmed, false);
  assert.equal(batch.capturedDate, "2026-06-30");
  assert.equal(batch.screenshots.length, 1);
  assert.equal(batch.screenshots[0].dataUrl, PNG);
  assert.equal(batch.screenshots[0].name, "wallet.png");
  assert.equal(batch.rows[0].date, "2026-06-30");
  assert.equal(batch.rows[0].batchId, batch.batchId);
});

test("annotateBalanceDraftDuplicates flags existing and intra-batch duplicates by date|channel|currency", () => {
  const batch = buildBalanceDraftBatch({
    images: [],
    rows: [
      { channel: "Бинанс spot", currency: "USDT", amount: 1689 },
      { channel: "бинанс spot", currency: "usdt", amount: 1700 },
      { channel: "пейпал дол", currency: "USD", amount: 500 },
    ],
    date: "2026-06-30",
  });
  annotateBalanceDraftDuplicates(batch, [
    { date: "2026-06-30", channel: "Бинанс spot", currency: "USDT" },
  ]);
  assert.equal(batch.rows[0].duplicateOfExisting, true);
  assert.equal(batch.rows[1].duplicateOfExisting, true);
  assert.equal(batch.rows[1].duplicateInBatch, true);
  assert.equal(batch.rows[2].duplicateOfExisting, false);
  assert.equal(batch.rows[2].duplicateInBatch, false);
  assert.match(batch.warnings.join("\n"), /дубликатов/);
});

test("genuinely new same-amount different channel is not flagged duplicate", () => {
  const batch = buildBalanceDraftBatch({
    images: [],
    rows: [
      { channel: "пейпал дол", currency: "USD", amount: 500 },
      { channel: "трансервайз дол", currency: "USD", amount: 500 },
    ],
    date: "2026-06-30",
  });
  annotateBalanceDraftDuplicates(batch, []);
  assert.equal(batch.rows[0].duplicateOfExisting, false);
  assert.equal(batch.rows[1].duplicateOfExisting, false);
  assert.equal(batch.rows[1].duplicateInBatch, false);
});

test("requestBalanceScreenshotVision posts to OpenAI and parses JSON output", async () => {
  const calls = [];
  const parsed = await requestBalanceScreenshotVision(
    validateBalanceScreenshotImages([{ dataUrl: "data:image/jpeg;base64,abcd" }]),
    {
      apiKey: "test-key",
      model: "test-model",
      channels: ["Бинанс spot"],
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              output_text: JSON.stringify({
                rows: [{ channel: "Бинанс spot", currency: "USDT", amount: 1689, confidence: 0.9, sourceImageIndex: 0 }],
                warnings: [],
              }),
            };
          },
        };
      },
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.match(calls[0].options.headers.Authorization, /Bearer test-key/);
  assert.equal(parsed.rows[0].amount, 1689);
});

test("requestBalanceScreenshotVision surfaces provider HTTP errors", async () => {
  await assert.rejects(
    () =>
      requestBalanceScreenshotVision(validateBalanceScreenshotImages([{ dataUrl: PNG }]), {
        apiKey: "k",
        fetchImpl: async () => ({ ok: false, status: 429, async json() { return { error: { message: "quota exceeded" } }; } }),
      }),
    /quota exceeded/
  );
});

test("parseBalanceScreenshotsToDraft builds a duplicate-annotated draft via injected fetch", async () => {
  const batch = await parseBalanceScreenshotsToDraft(
    [{ dataUrl: PNG, name: "balances.png" }],
    {
      apiKey: "test-key",
      date: "2026-06-30",
      now: new Date("2026-06-30T10:00:00.000Z"),
      existingRows: [{ date: "2026-06-30", channel: "Бинанс spot", currency: "USDT" }],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            output_text: JSON.stringify({
              rows: [
                { channel: "бинанс spot", currency: "usdt", amount: 1689, confidence: 0.9, sourceImageIndex: 0 },
                { channel: "пейпал дол", currency: "USD", amount: 500, confidence: 0.8, sourceImageIndex: 0 },
              ],
              warnings: ["one balance was blurry"],
            }),
          };
        },
      }),
    }
  );
  assert.equal(batch.status, "draft");
  assert.equal(batch.rows.length, 2);
  assert.equal(batch.rows[0].channel, "Бинанс spot");
  assert.equal(batch.rows[0].duplicateOfExisting, true);
  assert.equal(batch.rows[1].duplicateOfExisting, false);
  assert.equal(batch.screenshots[0].dataUrl, PNG);
  assert.match(batch.warnings.join("\n"), /blurry/);
});
