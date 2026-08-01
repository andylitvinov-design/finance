import registry from "../balance-channel-registry.js";

const STATUS_PREFIX = "snapshot_contract_v1:";

export const OWNER_CONFIRMED_JULY_SNAPSHOT_BATCHES = Object.freeze([
  {
    effective_date: "2026-07-01",
    snapshot_batch_id: "owner-confirmed-2026-07-01",
    raw_source_id: "owner-confirmed-july-2026-07-01",
    rows: [
      ["Яндекс", 107403, "RUB", 1413], ["PayPal USD", 64, "USD", 63.7], ["PayPal EUR", 0, "EUR", 0],
      ["Dep24 USD", 0, "USD", 0], ["Dep24 EUR", 0, "EUR", 0], ["PayPal CAD", 0, "CAD", 0],
      ["Privat24 UAH", -5125, "UAH", -119], ["Monobank", 11446, "UAH", 266], ["Wise EUR", 149, "EUR", 173],
      ["Wise USD", 1275, "USD", 1275], ["Revolut aggregate", 123, "owner-reported", 261, "aggregate"],
      ["Payoneer EUR", 597, "EUR", 693], ["Payoneer USD", 3, "USD", 3], ["Binance Save USDC", 2024, "USDC", 2023.8],
      ["Binance Spot aggregate", 1262, "USD-equivalent", 1262, "aggregate"], ["Binance Save USDT", 5413, "USDT", 5413],
      ["Cash EUR", 495, "EUR", 574], ["Local currencies", 0, "LOCAL", 0], ["Bank Canada", 10526, "CAD", 7789],
    ],
  },
  {
    effective_date: "2026-07-29",
    snapshot_batch_id: "owner-confirmed-2026-07-29",
    raw_source_id: "owner-confirmed-july-2026-07-29",
    rows: [
      ["Яндекс", 40437, "RUB", 482], ["PayPal USD", 235, "USD", 234.7], ["PayPal EUR", 0, "EUR", 0],
      ["Dep24 USD", 0, "USD", 0], ["Dep24 EUR", 0, "EUR", 0], ["PayPal CAD", 0, "CAD", 0],
      ["Privat24 UAH", 5317, "UAH", 119], ["Monobank", 577, "UAH", 13], ["Wise EUR", 0, "EUR", 0],
      ["Wise USD", 270, "USD", 270], ["Revolut aggregate", 1, "owner-reported", 1, "aggregate"],
      ["Payoneer EUR", 65, "EUR", 75], ["Payoneer USD", 3, "USD", 3], ["Binance Save USDC", 2029, "USDC", 2028.8],
      ["Binance Spot aggregate", 394, "USD-equivalent", 394, "aggregate"], ["Binance Save USDT", 44, "USDT/owner-reported", 5075, "standalone", "needs_verification"],
      ["Cash EUR", 495, "EUR", 574], ["Local currencies", 0, "LOCAL", 0], ["ZEN", 685, "USD-equivalent", 685], ["Bank Canada", 16892, "CAD", 12500],
    ],
  },
]);

export function serializeSnapshotContractStatus(metadata = {}) {
  const contract = compactMetadata(metadata);
  return `${STATUS_PREFIX}${encodeURIComponent(JSON.stringify(contract))}`;
}

export function parseSnapshotContractStatus(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith(STATUS_PREFIX)) return { metadata_reliability: "legacy_unreliable" };
  try {
    return normalizeMetadata(JSON.parse(decodeURIComponent(raw.slice(STATUS_PREFIX.length))));
  } catch {
    return { metadata_reliability: "legacy_unreliable", parse_error: "invalid_snapshot_contract_status" };
  }
}

export function buildOwnerConfirmedJulySnapshotRows({ createdAt = "2026-07-29T00:00:00.000Z", createdBy = "owner" } = {}) {
  return OWNER_CONFIRMED_JULY_SNAPSHOT_BATCHES.flatMap((batch) => batch.rows.map((entry) => {
    const [channel, amount, currency, amountUsd, representation = "standalone", reliability = "reliable"] = entry;
    const ownerMapping = registry.resolveOwnerChannel(channel, currency);
    const owner = registry.getOwnerChannel(ownerMapping.key);
    if (!owner || ownerMapping.status !== "mapped") {
      throw new Error(`Owner-confirmed fixture row is not in the canonical registry: ${channel} / ${currency}`);
    }
    const metadata = {
      owner_key: owner.key,
      snapshot_batch_id: batch.snapshot_batch_id,
      effective_date: batch.effective_date,
      source: "owner_confirmed",
      completeness: "full",
      explicit_zero: amount === 0,
      representation,
      raw_source_id: batch.raw_source_id,
      metadata_reliability: reliability,
      created_at: createdAt,
      created_by: createdBy,
    };
    return {
      date: batch.effective_date,
      channel: owner.display_name,
      display_name: owner.display_name,
      display_order: owner.display_order,
      owner_key: owner.key,
      amount,
      currency,
      rate: "",
      amount_usd: amountUsd,
      usdAmount: amountUsd,
      comment: "owner_confirmed_full_snapshot",
      metadataSource: "owner_confirmed",
      metadataStatus: serializeSnapshotContractStatus(metadata),
      rawSourceId: batch.raw_source_id,
      ...metadata,
    };
  }).sort((left, right) => left.display_order - right.display_order));
}

export function composeAuthoritativeSnapshotRows(rows = []) {
  const entries = (rows || []).map((original) => ({ original, normalized: normalizeContractRow(original) }));
  const normalizedRows = entries.map((entry) => entry.normalized);
  const candidates = new Map();
  for (const row of normalizedRows) {
    if (!isAuthoritativeFullOwnerRow(row)) continue;
    const key = `${row.effective_date}|${row.snapshot_batch_id}`;
    const group = candidates.get(key) || { date: row.effective_date, batch_id: row.snapshot_batch_id, rows: [] };
    group.rows.push(row);
    candidates.set(key, group);
  }

  const selectedByDate = new Map();
  const conflicts = [];
  for (const group of candidates.values()) {
    const current = selectedByDate.get(group.date);
    if (!current) {
      selectedByDate.set(group.date, group);
      continue;
    }
    conflicts.push({ date: group.date, batch_ids: [current.batch_id, group.batch_id].sort(), status: "needs_verification" });
    if (compareBatch(group, current) < 0) selectedByDate.set(group.date, group);
  }

  const authoritativeBatches = Array.from(selectedByDate.values()).map((group) => ({
    effective_date: group.date,
    snapshot_batch_id: group.batch_id,
    source: "owner_confirmed",
    completeness: "full",
    factual_row_count: group.rows.length,
    total_usd: round(group.rows.reduce((sum, row) => sum + numeric(row.amount_usd), 0)),
    excluded_component_count: 0,
    total_source_status: "factual_full",
  })).sort((left, right) => left.effective_date.localeCompare(right.effective_date));

  const activeRows = [];
  const excludedRows = [];
  for (const { original, normalized: row } of entries) {
    const batch = selectedByDate.get(row.effective_date);
    if (!batch) {
      activeRows.push(original);
      continue;
    }
    if (row.snapshot_batch_id === batch.batch_id) {
      activeRows.push({ ...original, ...row });
      continue;
    }
    excludedRows.push({
      ...row,
      excluded_from_authoritative_total: true,
      exclusion_reason: "owner_confirmed_full_batch",
      authoritative_snapshot_batch_id: batch.batch_id,
    });
  }
  return { rows: activeRows, excluded_rows: excludedRows, authoritative_batches: authoritativeBatches, conflicts };
}

export function computeFactualSnapshotChange(openingRows = [], closingRows = []) {
  const total = (rows) => round((rows || []).reduce((sum, row) => sum + numeric(row.amount_usd ?? row.usdAmount), 0));
  const opening_total_usd = total(openingRows);
  const closing_total_usd = total(closingRows);
  return { opening_total_usd, closing_total_usd, factual_change_usd: round(closing_total_usd - opening_total_usd) };
}

export function normalizeContractRow(row = {}) {
  const persisted = parseSnapshotContractStatus(row.metadataStatus ?? row.metadata_status ?? row.status);
  const metadata = normalizeMetadata({
    ...persisted,
    snapshot_batch_id: row.snapshot_batch_id ?? row.snapshotBatchId ?? persisted.snapshot_batch_id,
    effective_date: row.effective_date ?? row.effectiveDate ?? row.date ?? persisted.effective_date,
    source: row.metadataSource ?? row.metadata_source ?? row.source ?? persisted.source,
    raw_source_id: row.rawSourceId ?? row.raw_source_id ?? persisted.raw_source_id,
    owner_key: row.owner_key ?? row.ownerKey ?? persisted.owner_key,
    completeness: row.completeness ?? persisted.completeness,
    explicit_zero: row.explicit_zero ?? row.explicitZero ?? persisted.explicit_zero,
    omitted: row.omitted ?? persisted.omitted,
    representation: row.representation ?? persisted.representation,
    metadata_reliability: row.metadata_reliability ?? row.metadataReliability ?? persisted.metadata_reliability,
    created_at: row.created_at ?? row.createdAt ?? persisted.created_at,
    created_by: row.created_by ?? row.createdBy ?? persisted.created_by,
  });
  return {
    ...row,
    ...metadata,
    source: metadata.source || row.source || "",
    owner_key: metadata.owner_key,
    date: metadata.effective_date || row.date || "",
    amount_usd: numericOrNull(row.amount_usd ?? row.usdAmount),
  };
}

function isAuthoritativeFullOwnerRow(row = {}) {
  return row.source === "owner_confirmed" && row.completeness === "full" && Boolean(row.snapshot_batch_id) && Boolean(row.effective_date);
}

function compareBatch(left, right) {
  const reliability = (batch) => batch.rows.some((row) => row.metadata_reliability === "reliable") ? 0 : 1;
  const reliableDiff = reliability(left) - reliability(right);
  if (reliableDiff) return reliableDiff;
  const leftCreated = left.rows.map((row) => row.created_at || "").sort().at(-1) || "";
  const rightCreated = right.rows.map((row) => row.created_at || "").sort().at(-1) || "";
  return rightCreated.localeCompare(leftCreated) || left.batch_id.localeCompare(right.batch_id);
}

function compactMetadata(metadata = {}) {
  const normalized = normalizeMetadata(metadata);
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined && value !== "" && value !== null));
}

function normalizeMetadata(metadata = {}) {
  const source = normalizeEnum(metadata.source, ["owner_confirmed", "provider", "manual", "ocr_confirmed", "derived", "calculated", "migration"], "");
  const completeness = normalizeEnum(metadata.completeness, ["full", "partial"], "partial");
  const representation = normalizeEnum(metadata.representation, ["aggregate", "component", "standalone"], "standalone");
  const metadata_reliability = normalizeEnum(metadata.metadata_reliability, ["reliable", "legacy_unreliable", "needs_verification"], "legacy_unreliable");
  return {
    owner_key: String(metadata.owner_key || "").trim(),
    snapshot_batch_id: String(metadata.snapshot_batch_id || "").trim(),
    effective_date: normalizeDate(metadata.effective_date),
    source,
    completeness,
    explicit_zero: metadata.explicit_zero === true || String(metadata.explicit_zero).toLowerCase() === "true",
    omitted: metadata.omitted === true || String(metadata.omitted).toLowerCase() === "true" ? true : undefined,
    representation,
    raw_source_id: String(metadata.raw_source_id || "").trim(),
    metadata_reliability,
    created_at: String(metadata.created_at || "").trim(),
    created_by: String(metadata.created_by || "").trim(),
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function numericOrNull(value) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function numeric(value) {
  return numericOrNull(value) ?? 0;
}

function round(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}
