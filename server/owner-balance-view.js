import registry from "../balance-channel-registry.js";
import { normalizeContractRow } from "./authoritative-balance-snapshot-contract.js";

export function buildOwnerBalanceView(rows = [], { date = "" } = {}) {
  const normalized = (rows || []).map((row) => ({ raw: row, row: normalizeContractRow(row) }));
  const selectedDate = String(date || "").slice(0, 10);
  const candidates = normalized.filter(({ row }) => row.date === selectedDate && row.source === "owner_confirmed" && row.completeness === "full" && row.snapshot_batch_id);
  const batchId = candidates[0]?.row.snapshot_batch_id || "";
  const ownerRows = candidates
    .filter(({ row }) => row.snapshot_batch_id === batchId)
    .map(({ row }) => toOwnerRow(row))
    .sort((left, right) => left.display_order - right.display_order);
  const diagnostics = normalized
    .filter(({ row }) => row.date === selectedDate)
    .filter(({ row }) => !batchId || row.snapshot_batch_id !== batchId)
    .map(({ raw, row }) => toDiagnosticRow(raw, row));
  const explicit_zero_count = ownerRows.filter((row) => row.explicit_zero).length;
  const omitted_count = ownerRows.filter((row) => row.omitted).length;
  return {
    owner_rows: ownerRows,
    diagnostic_rows: diagnostics,
    owner_total: round(ownerRows.reduce((sum, row) => sum + numeric(row.amount_usd), 0)),
    diagnostic_component_total: round(diagnostics.reduce((sum, row) => sum + numeric(row.amount_usd), 0)),
    snapshot_batch_id: batchId || null,
    completeness: ownerRows[0]?.completeness || null,
    explicit_zero_count,
    omitted_count,
    excluded_component_count: diagnostics.filter((row) => row.role !== "unresolved").length,
    unresolved_mapping_count: diagnostics.filter((row) => row.role === "unresolved").length,
    unmapped_aliases: [...new Set(diagnostics.filter((row) => row.role === "unresolved").map((row) => row.channel))],
  };
}

function toOwnerRow(row) {
  const owner = registry.getOwnerChannel(row.owner_key) || registry.resolveOwnerChannel(row.channel, row.currency) && registry.getOwnerChannel(registry.resolveOwnerChannel(row.channel, row.currency).key);
  return {
    ...row,
    owner_key: owner?.key || row.owner_key || "",
    display_name: owner?.display_name || row.channel,
    display_order: owner?.display_order || Number.MAX_SAFE_INTEGER,
    channel: owner?.display_name || row.channel,
  };
}

function toDiagnosticRow(raw, row) {
  const classified = registry.classifyRawBalanceRow(raw);
  return { ...raw, ...row, owner_key: classified.key || null, role: classified.role, mapping_status: classified.status, exclusion_reason: "owner_confirmed_full_batch" };
}

function numeric(value) { const n = Number(String(value ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; }
function round(value) { return Math.round(value * 10000) / 10000; }
