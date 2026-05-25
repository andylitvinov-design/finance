#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import { saveAutoBalanceSnapshotRows } from "../server/auto-balance-snapshots.js";

export const OPENING_DATE = "2026-05-01";
export const OPENING_BALANCE_TARGETS = [
  { provider: "binance", channel: "Бинанс spot", currency: "USDT", source: "binance_derived_opening_balance" },
  { provider: "binance", channel: "Бинанс spot", currency: "USDC", source: "binance_derived_opening_balance", optional: true },
  { provider: "binance", channel: "Binance funding", currency: "USDT", source: "binance_derived_opening_balance" },
  { provider: "revolut", channel: "REVOLUT евро", currency: "EUR", source: "revolut_derived_opening_balance" },
];

const DERIVED_STATUS = "derived_opening_from_later_factual_balance";
const ONE_TO_ONE_USD_CURRENCIES = new Set(["USD", "USDT", "USDC"]);
const EUR_USD_RATE = 1.16;

export function buildOpeningBalanceRepairPlan({ repository = {}, openingDate = OPENING_DATE, targets = OPENING_BALANCE_TARGETS, now = new Date().toISOString() } = {}) {
  const balances = [...(repository.balances || []), ...(repository.autoBalances || [])];
  const operations = repository.operations || [];
  const changes = [];
  const skipped = [];
  const blocked = [];

  for (const target of targets) {
    const existingOpening = findSameDateBalance({ balances, target, date: openingDate });
    if (existingOpening && isFactualOpeningBalance(existingOpening)) {
      skipped.push(buildSkip(target, "opening_factual_balance_exists", existingOpening));
      continue;
    }
    if (existingOpening && isSameDerivedOpening(existingOpening, target)) {
      skipped.push(buildSkip(target, "derived_opening_balance_exists", existingOpening));
      continue;
    }

    const laterFactual = findNearestLaterFactualBalance({ balances, target, openingDate });
    if (!laterFactual) {
      skipped.push(buildSkip(target, target.optional ? "optional_later_factual_balance_not_found" : "later_factual_balance_not_found"));
      continue;
    }

    const movements = collectSignedLedgerMovements({
      operations,
      target,
      openingDate,
      laterDate: laterFactual.date,
    });
    if (movements.blocked_rows.length) {
      blocked.push({
        ...target,
        reason: "missing_or_invalid_ledger_amount",
        later_factual_date: laterFactual.date,
        later_factual_amount: laterFactual.amount,
        movement_row_count: movements.rows.length,
        blocked_rows: movements.blocked_rows,
      });
      continue;
    }

    const openingAmount = roundMoney(laterFactual.amount - movements.ledger_delta);
    const amountUsd = toUsdAmount(openingAmount, target.currency);
    changes.push({
      date: openingDate,
      provider: target.provider,
      channel: target.channel,
      amount: formatSheetNumber(openingAmount),
      currency: target.currency,
      rate: formatSheetNumber(usdRate(target.currency), 6),
      amountUsd: formatSheetNumber(amountUsd),
      source: target.source,
      fetchedAt: now,
      rawSourceId: `${target.source}:${openingDate}:${target.channel}:${target.currency}`,
      status: DERIVED_STATUS,
      comment: `Derived opening balance from later factual ${laterFactual.date}; movement rows ${movements.rows.length}; ledger delta ${formatDotNumber(movements.ledger_delta)}.`,
      later_factual_date: laterFactual.date,
      later_factual_amount: laterFactual.amount,
      ledger_delta: movements.ledger_delta,
      movement_row_count: movements.rows.length,
      movement_rows: movements.rows.map((row) => row.row),
    });
  }

  return {
    ok: blocked.length === 0,
    dryRun: true,
    openingDate,
    targetCount: targets.length,
    changes,
    skipped,
    blocked,
    summary: {
      changes: changes.length,
      skipped: skipped.length,
      blocked: blocked.length,
    },
  };
}

export async function applyOpeningBalanceRepairPlan(plan = {}, { saveRows = saveAutoBalanceSnapshotRows } = {}) {
  if (!plan.ok) {
    throw new Error(`Opening balance repair is blocked: ${plan.blocked?.map((row) => `${row.channel} ${row.currency}`).join(", ")}`);
  }
  if (!plan.changes?.length) {
    return { rowCount: 0, savedAt: new Date().toISOString(), rows: [] };
  }
  const result = await saveRows(plan.changes);
  return { ...result, rows: plan.changes };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.apply && options.dryRun) throw new Error("Use either --dry-run or --apply, not both.");
  const repository = await loadManualRepositoryFromGoogleSheets();
  if (!repository.ok) throw new Error(repository.warning || "Manual repository is unavailable.");
  const plan = buildOpeningBalanceRepairPlan({ repository });
  if (options.apply) {
    const applyResult = await applyOpeningBalanceRepairPlan(plan);
    console.log(JSON.stringify({ ...plan, dryRun: false, applied: true, applyResult }, null, 2));
  } else {
    console.log(JSON.stringify(plan, null, 2));
  }
  if (!plan.ok) process.exitCode = 1;
}

function findSameDateBalance({ balances, target, date }) {
  return (balances || []).find((row) =>
    normalizeDate(row?.date) === date &&
    sameTarget(row, target) &&
    Number.isFinite(parseNumber(row?.balanceAmount ?? row?.amount))
  ) || null;
}

function findNearestLaterFactualBalance({ balances, target, openingDate }) {
  return (balances || [])
    .filter((row) =>
      normalizeDate(row?.date) > openingDate &&
      sameTarget(row, target) &&
      isLaterFactualBalance(row)
    )
    .map((row) => ({
      row,
      date: normalizeDate(row.date),
      amount: parseNumber(row?.balanceAmount ?? row?.amount),
    }))
    .filter((row) => Number.isFinite(row.amount))
    .sort((left, right) => left.date.localeCompare(right.date))[0] || null;
}

function collectSignedLedgerMovements({ operations = [], target, openingDate, laterDate }) {
  const rows = [];
  const blocked_rows = [];
  let ledgerDelta = 0;
  for (const operation of operations || []) {
    const ledger = operation?.ledgerV2 || {};
    const rowDate = normalizeDate(operation?.date || ledger.date);
    if (!rowDate || rowDate <= openingDate || rowDate > laterDate) continue;
    if (normalizeCurrency(operation?.currency || ledger.currency) !== target.currency) continue;
    const fromChannel = String(operation?.fromChannel || ledger.from_channel || "").trim();
    const toChannel = String(operation?.toChannel || ledger.to_channel || "").trim();
    if (fromChannel !== target.channel && toChannel !== target.channel) continue;

    const rowRef = {
      row: operation?.sheetRowNumber || operation?.sourceRow || null,
      date: rowDate,
      reason: "",
      raw_source_id: operation?.rawSourceId || operation?.raw_source_id || ledger.raw_source_id || ledger.external_id || "",
    };
    const amountNetRaw = operation?.amountNet ?? operation?.amount_net ?? ledger.amount_net;
    const amountNet = parseNumber(amountNetRaw);
    if (!String(amountNetRaw ?? "").trim() || !Number.isFinite(amountNet)) {
      blocked_rows.push({ ...rowRef, reason: "missing_amount_net" });
      continue;
    }
    const balanceAmountRaw = operation?.balanceAmount ?? operation?.balance_amount ?? ledger.balance_amount;
    const balanceAmount = parseNumber(balanceAmountRaw);
    if (!String(balanceAmountRaw ?? "").trim() || !Number.isFinite(balanceAmount)) {
      blocked_rows.push({ ...rowRef, reason: "missing_or_invalid_signed_balance_amount" });
      continue;
    }
    rows.push({ row: rowRef.row, date: rowDate, raw_source_id: rowRef.raw_source_id, balance_amount: balanceAmount });
    ledgerDelta += balanceAmount;
  }
  return { rows, blocked_rows, ledger_delta: roundMoney(ledgerDelta) };
}

function isFactualOpeningBalance(row = {}) {
  const status = normalizeStatus(row?.status || row?.autoBalanceStatus || row?.auto_balance_status || row?.balanceStatus);
  if (["provider_not_implemented", "needs_provider_permission", "needs_manual_confirmed_balance", "current_only_not_historical"].includes(status)) return false;
  return !isSameDerivedOpening(row, { source: row?.source });
}

function isSameDerivedOpening(row = {}, target = {}) {
  return normalizeSource(row?.source) === normalizeSource(target.source) &&
    normalizeStatus(row?.status || row?.autoBalanceStatus || row?.auto_balance_status) === DERIVED_STATUS;
}

function isLaterFactualBalance(row = {}) {
  const amount = parseNumber(row?.balanceAmount ?? row?.amount);
  if (!Number.isFinite(amount)) return false;
  const status = normalizeStatus(row?.status || row?.autoBalanceStatus || row?.auto_balance_status || row?.balanceStatus);
  if (["provider_not_implemented", "needs_provider_permission", "needs_manual_confirmed_balance", "current_only_not_historical"].includes(status)) return false;
  if (status && !["ok", "zero_balance"].includes(status)) return false;
  const source = normalizeSource(row?.source);
  return source !== "binance_derived_opening_balance" && source !== "revolut_derived_opening_balance";
}

function sameTarget(row = {}, target = {}) {
  return String(row?.channel || row?.accountName || "").trim() === target.channel &&
    normalizeCurrency(row?.currency) === target.currency;
}

function buildSkip(target, reason, row = null) {
  return {
    ...target,
    reason,
    existing_date: row?.date || "",
    existing_amount: row ? parseNumber(row?.balanceAmount ?? row?.amount) : null,
    existing_source: row?.source || "",
    existing_status: row?.status || row?.autoBalanceStatus || row?.auto_balance_status || "",
  };
}

function parseArgs(argv = []) {
  const options = { dryRun: true, apply: false, help: false };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log("Usage: node scripts/repair-opening-balances-2026-05-01.mjs [--dry-run|--apply]");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSource(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  const numeric = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function usdRate(currency) {
  if (ONE_TO_ONE_USD_CURRENCIES.has(currency)) return 1;
  if (currency === "EUR") return EUR_USD_RATE;
  return 0;
}

function toUsdAmount(amount, currency) {
  return roundMoney(amount * usdRate(currency));
}

function roundMoney(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function formatSheetNumber(value, precision = 4) {
  if (!Number.isFinite(Number(value))) return "";
  const rounded = Math.round(Number(value) * (10 ** precision)) / (10 ** precision);
  return String(rounded).replace(".", ",");
}

function formatDotNumber(value) {
  return String(roundMoney(value));
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}
