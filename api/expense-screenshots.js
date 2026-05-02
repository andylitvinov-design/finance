import {
  mapLedgerCategoryToLegacy,
  normalizeManualLedgerCategory,
  normalizeManualLedgerChannel,
} from "../server/manual-ledger-maps.js";

const MAX_IMAGE_COUNT = 8;
const MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;
const DEFAULT_MODEL = "gpt-4.1-mini";
const CATEGORY_SET = new Set(["business", "flat", "food", "fun", "travel", "study", "serviceIncome", "exchange", "extra"]);
const RECEIVED_TYPE_SET = new Set(["ezofact", "serviceincome", "exchange_in"]);

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  try {
    const payload = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const images = validateImages(payload.images);
    if (!process.env.OPENAI_API_KEY) {
      return response.status(200).json({
        ok: true,
        source: "browser-ocr-required",
        entries: [],
        received: [],
        spent: [],
        warnings: ["OPENAI_API_KEY is not configured. Falling back to browser OCR."]
      });
    }
    const result = await parseExpenseScreenshots(images, {
      fetchImpl: fetch,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_EXPENSE_MODEL || DEFAULT_MODEL,
      periodStart: payload.periodStart || "",
      periodEnd: payload.periodEnd || "",
      channels: Array.isArray(payload.channels) ? payload.channels : [],
      categories: Array.isArray(payload.categories) ? payload.categories : []
    });
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    if (shouldFallbackToBrowserOcr(error)) {
      return response.status(200).json({
        ok: true,
        source: "browser-ocr-required",
        entries: [],
        warnings: [buildBrowserOcrFallbackWarning(error)]
      });
    }
    return response.status(400).json({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function shouldFallbackToBrowserOcr(error) {
  const message = String(error && error.message ? error.message : error || "");
  return /openai|quota|rate limit|billing|insufficient_quota|invalid api key|authentication/i.test(message);
}

function buildBrowserOcrFallbackWarning(error) {
  const message = String(error && error.message ? error.message : error || "OpenAI OCR request failed.");
  return `${message} Falling back to browser OCR.`;
}

export function validateImages(images) {
  if (!Array.isArray(images) || !images.length) {
    throw new Error("At least one screenshot image is required.");
  }
  if (images.length > MAX_IMAGE_COUNT) {
    throw new Error(`Too many screenshots. Maximum is ${MAX_IMAGE_COUNT}.`);
  }
  return images.map((image, index) => {
    const dataUrl = String(image?.dataUrl || "").trim();
    if (!/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(dataUrl)) {
      throw new Error(`Screenshot ${index + 1} must be a PNG, JPEG, or WEBP data URL.`);
    }
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error(`Screenshot ${index + 1} is too large.`);
    }
    return {
      dataUrl,
      name: String(image?.name || `screenshot-${index + 1}`).slice(0, 120),
      uploadedAtDate: normalizeIsoDate(image?.uploadedAtDate),
      sourceImageIndex: index
    };
  });
}

export async function parseExpenseScreenshots(images, options = {}) {
  const content = [
    {
      type: "input_text",
      text: buildPrompt(options)
    },
    ...images.map((image) => ({
      type: "input_image",
      image_url: image.dataUrl,
      detail: "high"
    }))
  ];
  const fetchImpl = options.fetchImpl || fetch;
  const upstream = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_MODEL,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "expense_screenshot_parse",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              entries: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    date: { type: "string" },
                    dateSource: { type: "string", enum: ["screenshot", "upload_fallback", ""] },
                    channel: { type: "string" },
                    direction: { type: "string", enum: ["expense", "income"] },
                    localAmount: { type: "number" },
                    currency: { type: "string" },
                    usdAmount: { type: ["number", "null"] },
                    counterparty: { type: "string" },
                    organization: { type: "string" },
                    receivedType: { type: "string" },
                    suggestedCategory: { type: "string" },
                    confidence: { type: "number" },
                    sourceImageIndex: { type: "integer" }
                  },
                  required: [
                    "date",
                    "dateSource",
                    "channel",
                    "direction",
                    "localAmount",
                    "currency",
                    "usdAmount",
                    "counterparty",
                    "organization",
                    "receivedType",
                    "suggestedCategory",
                    "confidence",
                    "sourceImageIndex"
                  ]
                }
              },
              warnings: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["entries", "warnings"]
          }
        }
      }
    })
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    throw new Error(payload?.error?.message || `OpenAI returned HTTP ${upstream.status}.`);
  }
  const parsed = parseOpenAiJsonPayload(payload);
  return normalizeVisionResult(parsed, {
    ...options,
    uploadDates: images.map((image) => normalizeIsoDate(image.uploadedAtDate))
  });
}

export function parseOpenAiJsonPayload(payload) {
  const text =
    payload?.output_text ||
    (payload?.output || [])
      .flatMap((item) => item?.content || [])
      .map((part) => part?.text || "")
      .join("")
      .trim();
  if (!text) throw new Error("OpenAI response did not contain parseable text.");
  return JSON.parse(text);
}

export function normalizeVisionResult(result, options = {}) {
  const channels = Array.isArray(options.channels) ? options.channels.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const categories = new Set(
    (Array.isArray(options.categories) && options.categories.length ? options.categories : Array.from(CATEGORY_SET))
      .map((item) => normalizeCategory(item))
      .filter(Boolean)
  );
  categories.add("serviceIncome");
  categories.add("exchange");
  const warnings = Array.isArray(result?.warnings) ? result.warnings.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const uploadDates = Array.isArray(options.uploadDates) ? options.uploadDates : [];
  const entries = (Array.isArray(result?.entries) ? result.entries : []).map((entry, index) => {
    const channel = normalizeChannel(entry.channel, channels);
    const direction = entry.direction === "income" ? "income" : "expense";
    const receivedType = normalizeReceivedType(entry.receivedType, entry.counterparty || entry.organization || "", channel);
    const category = direction === "income"
      ? mapReceivedTypeToCategory(receivedType)
      : normalizeCategory(entry.suggestedCategory);
    const screenshotDate = normalizeIsoDate(entry.date);
    const fallbackDate = uploadDates[Number.isInteger(entry.sourceImageIndex) ? entry.sourceImageIndex : index] || "";
    const date = screenshotDate || fallbackDate;
    return {
      date,
      dateSource: screenshotDate ? "screenshot" : (fallbackDate ? "upload_fallback" : ""),
      channel,
      direction,
      localAmount: Math.abs(Number(entry.localAmount || 0)),
      currency: String(entry.currency || "").trim().toUpperCase(),
      usdAmount: Number.isFinite(Number(entry.usdAmount)) ? Math.abs(Number(entry.usdAmount)) : null,
      counterparty: String(entry.counterparty || entry.organization || "").trim(),
      organization: String(entry.organization || entry.counterparty || "").trim(),
      receivedType,
      suggestedCategory: categories.has(category) ? category : "business",
      confidence: clamp(Number(entry.confidence || 0), 0, 1),
      sourceImageIndex: Number.isInteger(entry.sourceImageIndex) ? entry.sourceImageIndex : index
    };
  }).filter((entry) => entry.date && entry.channel && entry.localAmount > 0);
  if (entries.some((entry) => entry.dateSource === "upload_fallback")) {
    warnings.push("Some operations used the screenshot upload date because the transaction date was not readable.");
  }
  return {
    entries,
    received: entries.filter((entry) => entry.direction === "income"),
    spent: entries.filter((entry) => entry.direction !== "income"),
    warnings
  };
}

function buildPrompt(options = {}) {
  const channels = (options.channels || []).join(", ");
  const categories = (options.categories || []).join(", ");
  return [
    "Parse bank/payment screenshots into expense ledger entries.",
    "Return only JSON matching the schema.",
    `Allowed channels: ${channels || "infer from screenshot"}.`,
    `Allowed categories: ${categories || "business, flat, food, fun, travel, study"}.`,
    "Use ISO date YYYY-MM-DD. Extract the operation date from the screenshot itself: incoming transfers use the received/transferred date, expenses use the charged/paid date.",
    "If the screenshot date is unreadable, leave date empty and set dateSource to upload_fallback.",
    `Selected period: ${options.periodStart || "unknown"} to ${options.periodEnd || "unknown"}.`,
    "For expenses use direction expense. For incoming money use direction income.",
    "For incoming money set receivedType to one of: ezofact, serviceincome, exchange_in. Use exchange_in only for exchange/crypto/top-up inflows. Use ezofact when the screenshot indicates EzoFact. Otherwise use serviceincome.",
    "Choose the transaction amount, not the balance, fee, subtotal, running total, or any intermediate amount. Preserve the visible currency.",
    "Choose the nearest matching channel and identify the real counterparty or merchant precisely. Put sender/payee/merchant in both counterparty and organization.",
    "Do not invent entries for unclear rows; add warnings instead."
  ].join("\n");
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? raw : "";
}

function normalizeChannel(value, channels) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return normalizeManualLedgerChannel(raw, channels);
}

function normalizeCategory(value) {
  const canonical = normalizeManualLedgerCategory(value, "");
  const normalized = mapLedgerCategoryToLegacy(canonical);
  return CATEGORY_SET.has(normalized) ? normalized : "";
}

function normalizeReceivedType(value, organization = "", channel = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  if (RECEIVED_TYPE_SET.has(normalized)) return normalized;
  const probe = `${organization} ${channel} ${value}`.toLowerCase();
  if (/ezo\s*fact|ezofact/.test(probe)) return "ezofact";
  if (/exchange|обмен|binance|crypto|крипт|p2p/.test(probe)) return "exchange_in";
  return "serviceincome";
}

function mapReceivedTypeToCategory(value) {
  return normalizeReceivedType(value) === "exchange_in" ? "exchange" : "serviceIncome";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
