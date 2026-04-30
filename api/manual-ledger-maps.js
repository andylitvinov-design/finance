import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const contract = require("../manual-ledger-contract.js");

function loadSheetConfigMaps() {
  try {
    const configPath = path.join(__dirname, "..", "sheet-config.json");
    const payload = JSON.parse(readFileSync(configPath, "utf8"));
    return {
      categoryMap: payload?.manualFinance?.categoryMap || contract.CATEGORY_MAP,
      channelMap: payload?.manualFinance?.channelMap || contract.CHANNEL_MAP,
    };
  } catch {
    return {
      categoryMap: contract.CATEGORY_MAP,
      channelMap: contract.CHANNEL_MAP,
    };
  }
}

const loaded = loadSheetConfigMaps();

export const CATEGORY_MAP = loaded.categoryMap;
export const CHANNEL_MAP = loaded.channelMap;
export const MANUAL_LEDGER_HEADERS = contract.MANUAL_LEDGER_HEADERS;
export const MANUAL_LEDGER_OPERATIONS = contract.MANUAL_LEDGER_OPERATIONS;
export const MANUAL_LEDGER_DIRECTIONS = contract.MANUAL_LEDGER_DIRECTIONS;
export const CANONICAL_LEDGER_CATEGORIES = contract.CANONICAL_LEDGER_CATEGORIES;
export const LEGACY_CATEGORY_BY_CANONICAL = contract.LEGACY_CATEGORY_BY_CANONICAL;
export const CANONICAL_BY_LEGACY_CATEGORY = contract.CANONICAL_BY_LEGACY_CATEGORY;

export function normalizeToken(value) {
  return contract.normalizeToken(value);
}

export function normalizeManualLedgerCategory(value, fallback = "extra") {
  const category = contract.normalizeManualLedgerCategory(value, fallback);
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, category) ? category : fallback;
}

export function mapLedgerCategoryToLegacy(category) {
  return contract.mapLedgerCategoryToLegacy(category);
}

export function normalizeManualLedgerChannel(value, channels = []) {
  const raw = String(value || "").trim();
  const token = contract.normalizeToken(raw);
  if (!token) return "";
  const exact = (channels || []).find((channel) => contract.normalizeToken(channel) === token);
  if (exact) return exact;
  for (const [channel, aliases] of Object.entries(CHANNEL_MAP)) {
    const known = [channel, ...(aliases || [])].map(contract.normalizeToken);
    if (known.includes(token)) {
      return (channels || []).find((item) => contract.normalizeToken(item) === contract.normalizeToken(channel)) || channel;
    }
  }
  return raw;
}

export function normalizeManualLedgerOperation(value, category = "") {
  return contract.normalizeManualLedgerOperation(value, category);
}

export function normalizeManualLedgerDirection(value, operation = "") {
  return contract.normalizeManualLedgerDirection(value, operation);
}
