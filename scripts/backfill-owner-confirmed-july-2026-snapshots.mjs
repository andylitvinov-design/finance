#!/usr/bin/env node

import {
  buildOstatkiUpsertPlan,
  readOstatkiValues,
  writeOstatkiRows,
} from "../api/save-balance-snapshot.js";
import {
  buildOwnerConfirmedJulySnapshotRows,
  computeFactualSnapshotChange,
} from "../server/authoritative-balance-snapshot-contract.js";

const HEADER = ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий", "source", "status", "raw_source_id"];

export async function buildJulyOwnerBackfillPlan(existingValues = null) {
  const owner_rows = buildOwnerConfirmedJulySnapshotRows();
  const upsert = await buildOstatkiUpsertPlan({ rows: owner_rows, ...(Array.isArray(existingValues) ? { existingValues } : {}) });
  const existingRows = Array.isArray(existingValues) ? existingValues.slice(1) : [];
  const batchRows = owner_rows.filter((row) => row.source === "owner_confirmed");
  const opening = batchRows.filter((row) => row.date === "2026-07-01");
  const closing = batchRows.filter((row) => row.date === "2026-07-29");
  const conflicts = findConflicts(existingRows, batchRows);
  return { owner_rows, upsert, conflicts, factual_change: computeFactualSnapshotChange(opening, closing) };
}

export function summarizeJulyOwnerBackfillPlan(plan = {}) {
  const ownerRows = plan.owner_rows || [];
  const totals = Object.fromEntries(["2026-07-01", "2026-07-29"].map((date) => [
    date,
    round(ownerRows.filter((row) => row.date === date).reduce((sum, row) => sum + Number(row.amount_usd || 0), 0)),
  ]));
  return {
    dry_run: true,
    snapshot_batch_ids: [...new Set(ownerRows.map((row) => row.snapshot_batch_id))].sort(),
    owner_rows: ownerRows.length,
    inserted: plan.upsert?.inserted?.length || 0,
    updated: plan.upsert?.updated?.length || 0,
    duplicate_batch_rows: 0,
    conflicts: plan.conflicts || [],
    before_after: { before_owner_batch_total_usd: 0, after_owner_batch_total_usd: totals },
    factual_change_usd: plan.factual_change?.factual_change_usd ?? null,
  };
}

function findConflicts(existingRows = [], ownerRows = []) {
  const keys = new Set(ownerRows.map((row) => `${row.date}|${row.channel}|${row.currency}`));
  return existingRows
    .filter((row) => keys.has(`${row[0]}|${row[1]}|${row[3]}`))
    .filter((row) => String(row[7] || "").trim() === "owner_confirmed" && String(row[9] || "").trim() && !String(row[9]).startsWith("owner-confirmed-july-2026"))
    .map((row) => ({ date: row[0], channel: row[1], currency: row[3], status: "needs_verification", reason: "different_owner_confirmed_raw_source_id" }));
}

function round(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--confirmed-owner-backfill")) {
    throw new Error("Apply requires --confirmed-owner-backfill to avoid accidental financial data mutation.");
  }
  const existingValues = await readOstatkiValues();
  const plan = await buildJulyOwnerBackfillPlan(existingValues);
  const summary = summarizeJulyOwnerBackfillPlan(plan);
  if (summary.conflicts.length) throw new Error(`Backfill conflicts: ${summary.conflicts.length}`);
  if (!apply) return console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  const save = await writeOstatkiRows(plan.upsert.outputRows);
  console.log(JSON.stringify({ ok: true, dry_run: false, ...summary, save }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}
