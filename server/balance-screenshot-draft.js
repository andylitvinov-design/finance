// Balance screenshot -> draft batch pipeline.
//
// Finance-safety contract for this module:
// - It NEVER writes to the final balances. It only produces a reviewable draft
//   batch. The confirmed write stays in api/save-balance-snapshot.js, which the
//   UI calls only after the owner confirms the preview.
// - The original screenshot(s) are retained on the draft batch as provenance
//   before any parsing result is trusted.
// - It performs NO currency conversion: usdAmount/rate are left empty so the
//   owner supplies them explicitly if needed.
// - Duplicate protection keys on date + channel_normalized + currency, reusing
//   the exact same key builder as the confirmed save path so the preview shows
//   what the save path would treat as a duplicate.
// - Provider/parse failures throw, and callers convert them into structured
//   JSON `{ ok: false, error }`.

import { buildOstatkiKey, canonicalOstatkiChannel } from "../api/save-balance-snapshot.js";

const MAX_IMAGE_COUNT = 8;
const MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;
const DEFAULT_MODEL = "gpt-4.1-mini";
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const BALANCE_PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          channel: { type: "string" },
          currency: { type: "string" },
          amount: { type: ["number", "null"] },
          confidence: { type: "number" },
          sourceImageIndex: { type: "integer" },
        },
        required: ["channel", "currency", "amount", "confidence", "sourceImageIndex"],
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["rows", "warnings"],
};

export function validateBalanceScreenshotImages(images) {
  if (!Array.isArray(images) || !images.length) {
    throw new Error("At least one balance screenshot image is required.");
  }
  if (images.length > MAX_IMAGE_COUNT) {
    throw new Error(`Too many screenshots. Maximum is ${MAX_IMAGE_COUNT}.`);
  }
  return images.map((image, index) => {
    const dataUrl = String(image?.dataUrl || "").trim();
    if (!IMAGE_DATA_URL_PATTERN.test(dataUrl)) {
      throw new Error(`Screenshot ${index + 1} must be a PNG, JPEG, or WEBP data URL.`);
    }
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error(`Screenshot ${index + 1} is too large.`);
    }
    return {
      dataUrl,
      name: String(image?.name || `balance-screenshot-${index + 1}`).slice(0, 120),
      byteLength: estimateDataUrlBytes(dataUrl),
      sourceImageIndex: index,
    };
  });
}

export function buildBalanceScreenshotPrompt(options = {}) {
  const channels = (Array.isArray(options.channels) ? options.channels : [])
    .map((channel) => String(channel || "").trim())
    .filter(Boolean)
    .join(", ");
  return [
    "You read a screenshot of account/wallet balances and extract the current balance for each money channel.",
    "Return only JSON matching the schema.",
    `Known money channels: ${channels || "infer channel names from the screenshot"}.`,
    "Each row is one account/wallet balance snapshot, NOT an individual transaction.",
    "Extract the displayed available or total balance amount for each account, the account/channel label, and the currency code.",
    "Preserve the visible currency code exactly (USD, EUR, UAH, RUB, CAD, USDT, GBP, CHF, ...).",
    "Do NOT convert between currencies and do NOT compute a USD value. Leave amount in its native currency and never invent a converted number.",
    "Choose the balance figure, not a transaction amount, fee, or running subtotal.",
    "If a balance is unreadable or ambiguous, do not invent it. Add a warning string instead.",
  ].join("\n");
}

export function buildBalanceScreenshotVisionRequestBody(images, options = {}) {
  const content = [
    { type: "input_text", text: buildBalanceScreenshotPrompt(options) },
    ...images.map((image) => ({
      type: "input_image",
      image_url: image.dataUrl,
      detail: "high",
    })),
  ];
  return {
    model: options.model || DEFAULT_MODEL,
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "balance_screenshot_parse",
        strict: true,
        schema: BALANCE_PARSE_SCHEMA,
      },
    },
  };
}

export async function requestBalanceScreenshotVision(images, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const upstream = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(buildBalanceScreenshotVisionRequestBody(images, options)),
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    throw new Error(payload?.error?.message || `OpenAI returned HTTP ${upstream.status}.`);
  }
  return parseBalanceScreenshotJson(payload);
}

export function parseBalanceScreenshotJson(payload) {
  const text =
    payload?.output_text ||
    (payload?.output || [])
      .flatMap((item) => item?.content || [])
      .map((part) => part?.text || "")
      .join("")
      .trim();
  if (!text) {
    throw new Error("OpenAI response did not contain parseable text.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI response was not valid JSON.");
  }
}

export function normalizeBalanceDraftRows(parsed, options = {}) {
  const channels = Array.isArray(options.channels) ? options.channels : [];
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  return rows
    .map((row, index) => {
      const channelRaw = String(row?.channel || "").trim();
      const canonical = canonicalOstatkiChannel(channelRaw);
      const rawAmount = row?.amount;
      const amount =
        rawAmount === null || rawAmount === undefined || rawAmount === ""
          ? null
          : Number(rawAmount);
      return {
        channel: canonical || channelRaw,
        channelRaw,
        currency: String(row?.currency || "").trim().toUpperCase(),
        amount: Number.isFinite(amount) ? amount : null,
        rate: "",
        usdAmount: "",
        comment: "",
        confidence: clamp(Number(row?.confidence || 0), 0, 1),
        sourceImageIndex: Number.isInteger(row?.sourceImageIndex) ? row.sourceImageIndex : index,
        source: "ocr",
      };
    })
    .filter((row) => row.channel && row.currency && row.amount !== null);
}

export function buildBalanceDraftBatch({ images = [], rows = [], date = "", now } = {}) {
  const capturedDate = normalizeIsoDate(date);
  const createdAtIso = toIsoTimestamp(now);
  const screenshots = (Array.isArray(images) ? images : []).map((image, index) => ({
    name: String(image?.name || `balance-screenshot-${index + 1}`),
    sourceImageIndex: Number.isInteger(image?.sourceImageIndex) ? image.sourceImageIndex : index,
    byteLength: Number.isFinite(image?.byteLength) ? image.byteLength : null,
    // Original screenshot is retained verbatim as provenance before the parsed
    // rows are trusted or saved.
    dataUrl: String(image?.dataUrl || ""),
  }));
  const batchId = buildBalanceBatchId(capturedDate, screenshots, createdAtIso);
  const draftRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    date: capturedDate,
    batchId,
    status: "draft",
    confirmed: false,
  }));
  return {
    batchId,
    capturedDate,
    createdAtIso,
    status: "draft",
    confirmed: false,
    screenshots,
    rows: draftRows,
    warnings: [],
  };
}

export function annotateBalanceDraftDuplicates(batch, existingRows = []) {
  const existingKeys = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) =>
        buildOstatkiKey({
          date: row?.date,
          channel: row?.channel,
          currency: row?.currency,
        })
      )
      .filter(Boolean)
  );
  const seenInBatch = new Set();
  const rows = (Array.isArray(batch?.rows) ? batch.rows : []).map((row) => {
    const key = buildOstatkiKey({
      date: batch.capturedDate,
      channel: row.channel,
      currency: row.currency,
    });
    const duplicateOfExisting = existingKeys.has(key);
    const duplicateInBatch = seenInBatch.has(key);
    seenInBatch.add(key);
    return { ...row, dedupeKey: key, duplicateOfExisting, duplicateInBatch };
  });
  batch.rows = rows;
  const existingDuplicates = rows.filter((row) => row.duplicateOfExisting).length;
  const batchDuplicates = rows.filter((row) => row.duplicateInBatch).length;
  const warnings = Array.isArray(batch.warnings) ? [...batch.warnings] : [];
  if (existingDuplicates) {
    warnings.push(
      `Найдено возможных дубликатов по дате/каналу/валюте уже в Остатках: ${existingDuplicates}. Проверьте перед сохранением.`
    );
  }
  if (batchDuplicates) {
    warnings.push(
      `Повторяющиеся строки внутри импорта (дата/канал/валюта): ${batchDuplicates}.`
    );
  }
  batch.warnings = warnings;
  return batch;
}

export async function parseBalanceScreenshotsToDraft(images, options = {}) {
  const prepared = validateBalanceScreenshotImages(images);
  const parsed = await requestBalanceScreenshotVision(prepared, options);
  const rows = normalizeBalanceDraftRows(parsed, options);
  const batch = buildBalanceDraftBatch({
    images: prepared,
    rows,
    date: options.date,
    now: options.now,
  });
  const parsedWarnings = Array.isArray(parsed?.warnings)
    ? parsed.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
    : [];
  batch.warnings = parsedWarnings;
  annotateBalanceDraftDuplicates(batch, options.existingRows || []);
  return batch;
}

export function shouldFallbackToBrowserOcr(error) {
  const message = String(error && error.message ? error.message : error || "");
  // Genuine provider-availability failures fall back to browser OCR. Parse/JSON
  // failures must NOT fall back — they surface as structured { ok: false, error }.
  if (/not valid json|did not contain parseable text/i.test(message)) return false;
  return /quota|rate limit|billing|insufficient_quota|invalid api key|authentication|returned http/i.test(message);
}

function buildBalanceBatchId(date, screenshots, createdAtIso) {
  const fingerprint = (Array.isArray(screenshots) ? screenshots : [])
    .map((shot) => `${shot.sourceImageIndex}:${shot.byteLength ?? 0}`)
    .join("|");
  return [
    "balance-draft",
    normalizeIsoDate(date) || "unknown-date",
    String(createdAtIso || "").replace(/[^0-9tz:.+-]/gi, "") || "no-ts",
    hashString(fingerprint).toString(16),
  ].join(":");
}

function hashString(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function toIsoTimestamp(now) {
  if (typeof now === "string" && now.trim()) return now.trim();
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now.toISOString();
  return "";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
