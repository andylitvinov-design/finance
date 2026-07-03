#!/usr/bin/env node
// Read-only live finance integrity gate.
// Fetches /api/period-balance-reconciliation for the current month and fails
// when the ledger/balance layer degrades: FX holes, mismatches above the
// allowed count, or a blocked canonical total. Never writes any data.
//
// Usage:
//   npm run verify:finance                       # current month, production URL
//   node scripts/verify-finance-live.mjs --from=2026-06-01 --to=2026-06-30
//   node scripts/verify-finance-live.mjs --base=https://preview-url.vercel.app
//   node scripts/verify-finance-live.mjs --max-mismatch=6 --allow-blocked

const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";

export function parseArgs(argv = []) {
  const args = { base: DEFAULT_BASE_URL, maxMismatch: 0, allowBlocked: false, from: "", to: "" };
  for (const raw of argv) {
    const [key, value = ""] = String(raw).replace(/^--/, "").split("=");
    if (key === "base" && value) args.base = value.replace(/\/$/, "");
    else if (key === "from") args.from = value;
    else if (key === "to") args.to = value;
    else if (key === "max-mismatch") args.maxMismatch = Number.parseInt(value, 10) || 0;
    else if (key === "allow-blocked") args.allowBlocked = true;
  }
  return args;
}

export function currentMonthWindow(todayIso = new Date().toISOString().slice(0, 10)) {
  return { from: `${todayIso.slice(0, 7)}-01`, to: todayIso };
}

export function evaluateReconciliationSnapshot(snapshot, { maxMismatch = 0, allowBlocked = false } = {}) {
  const failures = [];
  const warnings = [];
  const recon = snapshot?.period_balance_reconciliation || {};
  const summary = recon.summary || {};
  const counts = summary.status_counts || {};
  const totalRow = recon.total_usd_row || {};
  const canonical = recon.canonical_total || {};

  if (snapshot?.ok === false) failures.push(`endpoint returned ok=false: ${snapshot?.error || "unknown error"}`);

  const excludedFxRows = Number(totalRow.excluded_fx_missing_rows || 0);
  if (excludedFxRows > 0) {
    failures.push(`fx_missing: ${excludedFxRows} row(s) excluded from ВСЕГО USD — run /api/ensure-fx-rates for the period`);
  }

  const mismatch = Number(counts.mismatch || 0);
  if (mismatch > maxMismatch) {
    failures.push(`mismatch positions: ${mismatch} > allowed ${maxMismatch}`);
  } else if (mismatch > 0) {
    warnings.push(`mismatch positions within allowance: ${mismatch}/${maxMismatch}`);
  }

  for (const key of ["missing_opening_balance", "missing_amount_net"]) {
    const value = Number(counts[key] || 0);
    if (value > 0) failures.push(`${key}: ${value} position(s)`);
  }
  for (const key of ["missing_provider_balance", "needs_verification"]) {
    const value = Number(counts[key] || 0);
    if (value > 0) warnings.push(`${key}: ${value} position(s) — needs a manual fact or provider data`);
  }

  const summaryStatus = String(summary.status || "unknown");
  if (["failed", "error"].includes(summaryStatus)) failures.push(`summary.status=${summaryStatus}`);
  else if (summaryStatus === "blocked" && !allowBlocked) failures.push("summary.status=blocked (pass --allow-blocked to downgrade to warning)");
  else if (summaryStatus === "blocked") warnings.push("summary.status=blocked");

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    metrics: {
      summary_status: summaryStatus,
      positions_checked: Number(summary.positions_checked || 0),
      mismatch,
      excluded_fx_missing_rows: excludedFxRows,
      opening_usd: totalRow.opening_usd ?? null,
      planned_end_usd: totalRow.planned_end_usd ?? null,
      confirmed_end_usd: totalRow.confirmed_end_usd ?? null,
      diff_usd: totalRow.diff_usd ?? null,
      canonical_status: canonical.status ?? null,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const window = args.from && args.to ? { from: args.from, to: args.to } : currentMonthWindow();
  const url = `${args.base}/api/period-balance-reconciliation?from=${window.from}&to=${window.to}`;
  console.log(`verify:finance → GET ${url}`);

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    console.error(`FAIL: HTTP ${response.status} from reconciliation endpoint`);
    process.exit(1);
  }
  const snapshot = await response.json();
  const result = evaluateReconciliationSnapshot(snapshot, args);

  console.log("metrics:", JSON.stringify(result.metrics, null, 2));
  for (const warning of result.warnings) console.log(`WARN: ${warning}`);
  for (const failure of result.failures) console.error(`FAIL: ${failure}`);
  if (!result.ok) {
    console.error(`verify:finance FAILED for ${window.from}..${window.to}`);
    process.exit(1);
  }
  console.log(`verify:finance OK for ${window.from}..${window.to}`);
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`verify:finance crashed: ${error?.message || error}`);
    process.exit(1);
  });
}
