#!/usr/bin/env node

import { saveAutoBalanceSnapshotRows } from "../server/auto-balance-snapshots.js";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import {
  OWNER_MAY_OPENING_BALANCES,
  ownerMayOpeningTotalUsd,
  validateOwnerMayOpeningBalances,
} from "../server/may-2026-owner-opening-balances.js";

export const TARGET_DATE = "2026-05-01";
export const BACKFILL_COMMENT = "user provided 2026-05-01 balance";

export const USER_BALANCE_ROWS = OWNER_MAY_OPENING_BALANCES.map((row) => ({
  inputChannel: row.inputChannel,
  channel: row.channel,
  currency: row.currency,
  nativeAmount: row.amount,
  amountUsd: row.amountUsd,
  valueType: row.amount === "" ? "usd_equivalent_only" : Number(row.amount) === 0 ? "explicit_zero" : "native_or_usd",
  resolution: "owner_confirmed_channel",
}));

export function buildBackfillRows(rows = USER_BALANCE_ROWS) {
  const validation = validateOwnerMayOpeningBalances(rows.map((row) => ({
    inputChannel: row.inputChannel,
    channel: row.channel,
    currency: row.currency,
    amount: row.nativeAmount,
    amountUsd: row.amountUsd,
  })));
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return rows.map((row) => ({
    date: TARGET_DATE,
    channel: row.channel,
    amount: row.nativeAmount === null || row.nativeAmount === undefined ? "" : row.nativeAmount,
    currency: row.currency,
    rate: "",
    usdAmount: row.amountUsd === null || row.amountUsd === undefined ? "" : row.amountUsd,
    comment: BACKFILL_COMMENT,
    inputChannel: row.inputChannel,
    resolution: row.resolution,
    valueType: row.valueType,
    expectedNativeAmount: row.nativeAmount,
    expectedAmountUsd: row.amountUsd,
    note: row.note || "",
  }));
}

export function classifyBackfillRows(existingBalances = [], rows = buildBackfillRows()) {
  const existingByKey = new Map();
  for (const row of existingBalances || []) {
    if (row?.date !== TARGET_DATE) continue;
    existingByKey.set(rowKey(row), row);
  }

  const seen = new Set();
  const rowsToWrite = [];
  const skippedRows = [];
  const duplicateInputs = [];
  const reportRows = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) {
      const duplicate = { ...row, reason: "duplicate_input_key", classification: "missing_native_amount", safeAction: "skip_duplicate_input" };
      duplicateInputs.push(duplicate);
      reportRows.push(duplicate);
      continue;
    }
    if (key !== "||") seen.add(key);
    const existing = existingByKey.get(key);
    const classified = classifyRow(row, existing);
    reportRows.push(classified);
    if (!isWritableAction(classified.safeAction)) {
      skippedRows.push(classified);
      continue;
    }
    if (existing && sameBackfillRow(existing, classified)) {
      const skipped = { ...classified, safeAction: "skip_existing_same_value", reason: "existing_same_value" };
      skippedRows.push(skipped);
      reportRows[reportRows.length - 1] = skipped;
      continue;
    }
    rowsToWrite.push({ ...classified, action: existing ? "update" : "create" });
  }

  return { rowsToWrite, skippedRows, duplicateInputs, reportRows };
}

export function summarizeBackfillPlan(classification) {
  return {
    target_date: TARGET_DATE,
    expected_total_usd: ownerMayOpeningTotalUsd(),
    create: classification.rowsToWrite.filter((row) => row.action === "create").length,
    update: classification.rowsToWrite.filter((row) => row.action === "update").length,
    skip: classification.skippedRows.length,
    duplicate_input: classification.duplicateInputs.length,
    report_rows: (classification.reportRows || []).map(publicRowSummary),
    rows_to_write: classification.rowsToWrite.map(publicRowSummary),
    skipped_rows: classification.skippedRows.map(publicRowSummary),
    duplicate_input_rows: classification.duplicateInputs.map(publicRowSummary),
  };
}

function publicRowSummary(row) {
  return {
    date: row.date,
    input_channel: row.inputChannel,
    channel: row.channel,
    currency: row.currency,
    amount: row.amount,
    amount_usd: row.usdAmount,
    expected_native_amount: row.expectedNativeAmount,
    expected_amount_usd: row.expectedAmountUsd,
    current_amount: row.existingAmount ?? undefined,
    current_amount_usd: row.existingAmountUsd ?? undefined,
    classification: row.classification,
    safe_action: row.safeAction,
    action: row.action || undefined,
    reason: row.reason || undefined,
    resolution: row.resolution,
    value_type: row.valueType,
    note: row.note || undefined,
  };
}

function classifyRow(row, existing) {
  const existingAmount = existing ? numericAmount(existing?.amount ?? existing?.balanceAmount) : null;
  const existingAmountUsd = existing ? numericAmount(existing?.usdAmount ?? existing?.amountUsd) : null;
  const expectedNative = numericAmount(row.expectedNativeAmount);
  const expectedUsd = numericAmount(row.expectedAmountUsd);
  const base = {
    ...row,
    existingAmount,
    existingAmountUsd,
  };

  if (row.valueType === "missing_channel_alias" || !row.channel || !row.currency) {
    return { ...base, classification: "missing_channel_alias", safeAction: "skip_missing_channel_alias" };
  }
  if (row.valueType === "blank") {
    return { ...base, classification: "missing_native_amount", safeAction: "skip_blank_value" };
  }
  if (row.valueType === "usd_equivalent_only") {
    const classification = existing && existingAmount === expectedUsd
      ? "present_wrong_amount_usd_used_as_native"
      : "needs_native_currency_value";
    return {
      ...base,
      amount: "",
      usdAmount: expectedUsd,
      classification,
      safeAction: "write_amount_usd_only_needs_native",
      reason: "user_value_is_usd_equivalent_only",
    };
  }
  if (row.valueType === "explicit_zero") {
    const classification = existing && existingAmount === 0 ? "present_placeholder_zero" : "missing_native_amount";
    return { ...base, amount: 0, usdAmount: 0, classification, safeAction: "write_native_zero" };
  }
  const classification = existing && existingAmount === expectedNative ? "present_correct_native" : "missing_native_amount";
  return {
    ...base,
    amount: expectedNative,
    usdAmount: expectedUsd,
    classification,
    safeAction: "write_native_amount",
  };
}

function isWritableAction(action) {
  return ["write_native_amount", "write_native_zero", "write_amount_usd_only_needs_native"].includes(action);
}

function rowKey(row) {
  return [
    String(row?.date || "").trim(),
    String(row?.channel || row?.accountName || "").trim(),
    String(row?.currency || "").trim().toUpperCase(),
  ].join("|");
}

function sameBackfillRow(existing, row) {
  return numericAmount(existing?.amount ?? existing?.balanceAmount) === numericAmount(row?.amount)
    && numericAmount(existing?.usdAmount ?? existing?.amountUsd) === numericAmount(row?.usdAmount);
}

function numericAmount(value) {
  const numeric = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? roundAmount(numeric) : null;
}

function roundAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return Math.round(numeric * 10000) / 10000;
}

function isApplyMode(argv = process.argv) {
  return argv.includes("--apply");
}

async function main() {
  const repository = await loadManualRepositoryFromGoogleSheets();
  if (!repository.ok) {
    console.error(JSON.stringify({ ok: false, error: repository.warning || "Google Sheets repository unavailable" }, null, 2));
    process.exitCode = 1;
    return;
  }

  const classification = classifyBackfillRows(repository.balances || []);
  const summary = summarizeBackfillPlan(classification);
  if (!isApplyMode()) {
    console.log(JSON.stringify({ ok: true, dry_run: true, ...summary }, null, 2));
    return;
  }

  let save = { rowCount: 0, skipped: "no_changes" };
  if (classification.rowsToWrite.length) {
    save = await saveAutoBalanceSnapshotRows(classification.rowsToWrite);
  }
  console.log(JSON.stringify({ ok: true, dry_run: false, ...summary, save }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  });
}
