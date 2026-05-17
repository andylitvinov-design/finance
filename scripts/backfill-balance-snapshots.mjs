#!/usr/bin/env node

import { runAutoBalanceSnapshots } from "../server/auto-balance-snapshots.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { from: "", to: "", apply: false, dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--from") args.from = normalizeDate(argv[++index]);
    else if (item === "--to") args.to = normalizeDate(argv[++index]);
    else if (item === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (item === "--dry-run") {
      args.apply = false;
      args.dryRun = true;
    }
  }
  if (!args.from || !args.to) throw new Error("Usage: scripts/backfill-balance-snapshots.mjs --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run|--apply]");
  if (args.from > args.to) throw new Error("--from must be before or equal to --to");
  return args;
}

export async function buildBalanceSnapshotBackfillPlan(options = {}) {
  const args = {
    from: normalizeDate(options.from),
    to: normalizeDate(options.to),
    apply: Boolean(options.apply),
    dryRun: options.apply ? false : true,
  };
  if (!args.from || !args.to) throw new Error("from and to are required");
  if (args.from > args.to) throw new Error("from must be before or equal to to");
  const today = todayUtcDate();
  const dates = enumerateDates(args.from, args.to);
  const results = [];
  for (const date of dates) {
    if (args.apply && date !== today) {
      results.push({
        ok: true,
        date,
        inserted: 0,
        updated: 0,
        skipped: 1,
        warnings: ["needs verification: historical provider balance backfill is not applied from current-balance endpoints."],
      });
      continue;
    }
    const result = await runAutoBalanceSnapshots({
      query: { date, dryRun: args.dryRun ? "1" : "" },
      env: options.env || process.env,
      fetchImpl: options.fetchImpl || fetch,
    });
    results.push({
      ok: Boolean(result.ok),
      date,
      inserted: Number(result.inserted || 0),
      updated: Number(result.updated || 0),
      skipped: Number(result.skipped ?? result.skipped_rows ?? 0),
      warnings: result.warnings || [],
      dry_run: Boolean(result.dryRun),
    });
  }
  return {
    ok: results.every((row) => row.ok),
    dry_run: args.dryRun,
    from: args.from,
    to: args.to,
    inserted: results.reduce((sum, row) => sum + row.inserted, 0),
    updated: results.reduce((sum, row) => sum + row.updated, 0),
    skipped: results.reduce((sum, row) => sum + row.skipped, 0),
    warnings: unique(results.flatMap((row) => row.warnings || [])),
    results,
  };
}

function enumerateDates(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function todayUtcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function unique(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

async function main() {
  const args = parseArgs();
  const result = await buildBalanceSnapshotBackfillPlan(args);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}
