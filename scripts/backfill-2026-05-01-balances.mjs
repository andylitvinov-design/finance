#!/usr/bin/env node

import { saveAutoBalanceSnapshotRows } from "../server/auto-balance-snapshots.js";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";

export const TARGET_DATE = "2026-05-01";
export const BACKFILL_COMMENT = "user provided 2026-05-01 balance";

const USD_RATES = {
  USD: 1,
  EUR: 1.16,
  CAD: 0.74,
  UAH: 1 / 43.86,
  RUB: 1 / 84.5563,
  LOCAL: 1 / 18,
};

export const USER_BALANCE_ROWS = [
  { inputChannel: "ЯД яндекс", channel: "Яндекс руб", currency: "RUB", amount: 1722, resolution: "known_channel_alias" },
  { inputChannel: "пейпал дол", channel: "пейпал дол", currency: "USD", amount: 435.0, resolution: "exact_known_channel" },
  { inputChannel: "пейпал евр", channel: "пейпал евр", currency: "EUR", amount: 0, resolution: "exact_known_channel" },
  { inputChannel: "деп24-дол", channel: "деп24-дол", currency: "USD", amount: 0, resolution: "user_provided_channel_not_in_config" },
  { inputChannel: "деп24-евро", channel: "деп24-евро", currency: "EUR", amount: 0, resolution: "user_provided_channel_not_in_config" },
  { inputChannel: "пейпал cad", channel: "пейпал сad", currency: "CAD", amount: 0, resolution: "known_channel_alias" },
  { inputChannel: "24-грн", channel: "приват 24-грн", currency: "UAH", amount: 11239, resolution: "known_channel_alias", note: "second screenshot value 254 was not stored as a separate row" },
  { inputChannel: "монобанк", channel: "монобанк грн", currency: "UAH", amount: 26670, resolution: "known_channel_alias", note: "second screenshot value 603 was not stored as a separate row" },
  { inputChannel: "трансервайз евро", channel: "трансервайз евро", currency: "EUR", amount: 0, resolution: "exact_known_channel" },
  { inputChannel: "трансервайз дол", channel: "трансервайз дол", currency: "USD", amount: 2639, resolution: "exact_known_channel" },
  { inputChannel: "REVOLUT", channel: "REVOLUT", currency: "EUR", amount: 378, resolution: "user_provided_channel_currency" },
  { inputChannel: "Payoneer - eur", channel: "Payoneer - eur", currency: "EUR", amount: 1284, resolution: "exact_known_channel" },
  { inputChannel: "Payoneer - dol", channel: "Payoneer - dol", currency: "USD", amount: 3, resolution: "exact_known_channel" },
  { inputChannel: "Бинанс spot", channel: "Бинанс spot", currency: "USD", amount: 1090, resolution: "exact_known_channel" },
  { inputChannel: "binance save", channel: "binance save", currency: "USD", amount: 8519, resolution: "exact_known_channel" },
  { inputChannel: "Нал-я-евр", channel: "Налично -я-евр", currency: "EUR", amount: 91, resolution: "known_channel_alias" },
  { inputChannel: "местная валюты", channel: "местная валюты", currency: "LOCAL", amount: 0, resolution: "known_channel_local_currency" },
  { inputChannel: "БАНК КАНАДА", channel: "БАНК КАНАДА cad", currency: "CAD", amount: 7351, resolution: "known_channel_alias" },
  { inputChannel: "24-евро", channel: "приват 24-евро", currency: "EUR", amount: 1.0, resolution: "known_channel_alias" },
  { inputChannel: "карта май", channel: "карта май", currency: "UNKNOWN", amount: 0, resolution: "user_provided_unknown_currency" },
  { inputChannel: "нал евро", channel: "нал-мам-евро", currency: "EUR", amount: 580, resolution: "known_channel_alias" },
  { inputChannel: "24-дол", channel: "приват 24-дол", currency: "USD", amount: 43, resolution: "known_channel_alias" },
];

export function buildBackfillRows(rows = USER_BALANCE_ROWS) {
  return rows.map((row) => {
    const rate = USD_RATES[row.currency] || "";
    const usdAmount = rate === "" ? "" : roundAmount(Number(row.amount) * rate);
    return {
      date: TARGET_DATE,
      channel: row.channel,
      amount: row.amount,
      currency: row.currency,
      rate,
      usdAmount,
      comment: BACKFILL_COMMENT,
      inputChannel: row.inputChannel,
      resolution: row.resolution,
      note: row.note || "",
    };
  });
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
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) {
      duplicateInputs.push({ ...row, reason: "duplicate_input_key" });
      continue;
    }
    seen.add(key);
    const existing = existingByKey.get(key);
    if (existing && sameAmount(existing, row)) {
      skippedRows.push({ ...row, reason: "existing_same_amount" });
      continue;
    }
    rowsToWrite.push({ ...row, action: existing ? "update" : "create", existingAmount: existing?.amount ?? existing?.balanceAmount ?? null });
  }

  return { rowsToWrite, skippedRows, duplicateInputs };
}

export function summarizeBackfillPlan(classification) {
  return {
    target_date: TARGET_DATE,
    create: classification.rowsToWrite.filter((row) => row.action === "create").length,
    update: classification.rowsToWrite.filter((row) => row.action === "update").length,
    skip: classification.skippedRows.length,
    duplicate_input: classification.duplicateInputs.length,
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
    action: row.action || undefined,
    existing_amount: row.existingAmount ?? undefined,
    reason: row.reason || undefined,
    resolution: row.resolution,
    note: row.note || undefined,
  };
}

function rowKey(row) {
  return [
    String(row?.date || "").trim(),
    String(row?.channel || row?.accountName || "").trim(),
    String(row?.currency || "").trim().toUpperCase(),
  ].join("|");
}

function sameAmount(existing, row) {
  return numericAmount(existing?.amount ?? existing?.balanceAmount) === numericAmount(row?.amount);
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
