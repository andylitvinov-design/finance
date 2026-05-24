#!/usr/bin/env node

import { saveAutoBalanceSnapshotRows } from "../server/auto-balance-snapshots.js";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";

export const DEFAULT_TARGET_DATE = "2026-05-24";
export const BINANCE_USER_CONFIRMED_SOURCE = "user_confirmed_binance_balance";
export const BINANCE_LEGACY_COMBINED_CHANNEL = "legacy_combined_binance_spot_funding";

export const USER_CONFIRMED_BINANCE_FACTS = [
  {
    date: "2026-03-25",
    provider: "binance",
    channel: "binance save",
    currency: "USDT",
    expression: "6754 + 2017 - 896",
    comment: "user confirmed legacy combined Binance save balance; historical currency split unavailable",
    historical: true,
    legacyCombined: true,
    splitSolvability: "underdetermined",
  },
  {
    date: "2026-03-25",
    provider: "binance",
    channel: BINANCE_LEGACY_COMBINED_CHANNEL,
    currency: "USDT",
    expression: "356 + 1074 - 95 - 990",
    comment: "user confirmed legacy combined Binance spot+funding balance; do not split into factual rows",
    historical: true,
    legacyCombined: true,
    splitSolvability: "underdetermined",
  },
];

export const USER_CONFIRMED_BINANCE_CURRENT_FACTS = [
  {
    provider: "binance",
    channel: "Бинанс spot",
    currency: "USDT",
    amount: 1211.91,
    comment: "user confirmed current Binance spot balance",
  },
  {
    provider: "binance",
    channel: "Binance funding",
    currency: "USDT",
    amount: 0,
    comment: "user confirmed current Binance funding balance",
  },
  {
    provider: "binance",
    channel: "binance save",
    currency: "USDT",
    amount: 5411.3694,
    comment: "user confirmed current Binance save USDT balance",
  },
  {
    provider: "binance",
    channel: "binance save",
    currency: "USDC",
    amount: 2019.822684,
    comment: "user confirmed current Binance save USDC balance",
  },
];

export function buildUserConfirmedBinanceRows({ targetDate = DEFAULT_TARGET_DATE } = {}) {
  const currentDate = normalizeIsoDate(targetDate);
  if (!currentDate) throw new Error("targetDate must be YYYY-MM-DD.");
  return [
    ...USER_CONFIRMED_BINANCE_FACTS.map((fact) => buildBinanceRepairRow({
      ...fact,
      amount: evaluateSimpleExpression(fact.expression),
      rawSourceId: `${BINANCE_USER_CONFIRMED_SOURCE}:${fact.date}:${fact.channel}:${fact.currency}`,
    })),
    ...USER_CONFIRMED_BINANCE_CURRENT_FACTS.map((fact) => buildBinanceRepairRow({
      ...fact,
      date: currentDate,
      rawSourceId: `${BINANCE_USER_CONFIRMED_SOURCE}:${currentDate}:${fact.channel}:${fact.currency}`,
    })),
  ];
}

export function classifyBinanceRepairRows(existingAutoBalances = [], rows = buildUserConfirmedBinanceRows()) {
  const existingByKey = new Map();
  for (const row of existingAutoBalances || []) {
    existingByKey.set(balanceKey(row), row);
  }

  const rowsToWrite = [];
  const skippedRows = [];
  const reportRows = [];

  for (const row of rows || []) {
    const existing = existingByKey.get(balanceKey(row));
    const classified = classifyBinanceRepairRow(row, existing);
    reportRows.push(classified);
    if (classified.safeAction === "skip_existing_same_value") {
      skippedRows.push(classified);
    } else {
      rowsToWrite.push(classified);
    }
  }

  return {
    rowsToWrite,
    skippedRows,
    reportRows,
    historical_split_solvability: "underdetermined",
    legacy_combined_channel_used: rows.some((row) => row.channel === BINANCE_LEGACY_COMBINED_CHANNEL),
  };
}

export function summarizeBinanceRepairPlan(classification = {}, { targetDate = DEFAULT_TARGET_DATE } = {}) {
  return {
    target_date: normalizeIsoDate(targetDate),
    create_or_update: (classification.rowsToWrite || []).length,
    skip_existing_same_value: (classification.skippedRows || []).length,
    historical_split_solvability: classification.historical_split_solvability || "underdetermined",
    legacy_combined_channel_used: classification.legacy_combined_channel_used === true,
    rows_to_write: (classification.rowsToWrite || []).map(publicRowSummary),
    skipped_rows: (classification.skippedRows || []).map(publicRowSummary),
    report_rows: (classification.reportRows || []).map(publicRowSummary),
  };
}

function buildBinanceRepairRow({
  date,
  provider = "binance",
  channel,
  currency = "USDT",
  amount,
  comment,
  rawSourceId,
  legacyCombined = false,
  splitSolvability = "",
}) {
  const numericAmount = toNumber(amount);
  if (!Number.isFinite(numericAmount)) throw new Error(`Invalid Binance amount for ${channel}.`);
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const rate = ["USD", "USDT", "USDC"].includes(normalizedCurrency) ? 1 : "";
  return {
    date: normalizeIsoDate(date),
    provider,
    channel,
    amount: round(numericAmount),
    currency: normalizedCurrency,
    rate,
    amountUsd: rate === 1 ? round(numericAmount) : "",
    usdAmount: rate === 1 ? round(numericAmount) : "",
    source: BINANCE_USER_CONFIRMED_SOURCE,
    rawSourceId,
    status: numericAmount === 0 ? "zero_balance" : "ok",
    comment,
    factual_provider_balance: true,
    computed_balance: false,
    legacy_combined: legacyCombined,
    split_solvability: splitSolvability,
  };
}

function classifyBinanceRepairRow(row, existing) {
  const existingAmount = existing ? toNumber(existing.amount ?? existing.balanceAmount) : null;
  const explicitExistingUsd = existing ? toNumber(existing.usdAmount ?? existing.amountUsd ?? existing.amount_usd) : null;
  const existingUsd = explicitExistingUsd === null && ["USD", "USDT", "USDC"].includes(String(existing?.currency || row.currency || "").trim().toUpperCase())
    ? existingAmount
    : explicitExistingUsd;
  const amount = toNumber(row.amount);
  const usdAmount = toNumber(row.usdAmount);
  const base = {
    ...row,
    existingAmount,
    existingUsd,
    classification: row.legacy_combined ? "legacy_combined_anchor" : "user_confirmed_anchor",
    safeAction: row.legacy_combined ? "write_legacy_combined_anchor" : "write_user_confirmed_anchor",
  };
  if (existing && existingAmount === amount && explicitExistingUsd === usdAmount) {
    return {
      ...base,
      safeAction: "skip_existing_same_value",
      reason: "existing_auto_balance_same_value",
    };
  }
  return {
    ...base,
    action: existing ? "update" : "create",
  };
}

function publicRowSummary(row) {
  return {
    date: row.date,
    provider: row.provider,
    channel: row.channel,
    currency: row.currency,
    amount: row.amount,
    amount_usd: row.usdAmount,
    source: row.source,
    status: row.status,
    action: row.action || undefined,
    safe_action: row.safeAction,
    classification: row.classification,
    reason: row.reason || undefined,
    legacy_combined: row.legacy_combined === true || undefined,
    split_solvability: row.split_solvability || undefined,
    comment: row.comment,
  };
}

export function evaluateSimpleExpression(expression) {
  const raw = String(expression || "").trim();
  if (!/^\d+(?:\.\d+)?(?:\s*[+-]\s*\d+(?:\.\d+)?)*$/.test(raw)) {
    throw new Error(`Unsupported expression: ${expression}`);
  }
  const tokens = raw.match(/[+-]?\s*\d+(?:\.\d+)?/g) || [];
  return round(tokens.reduce((sum, token) => sum + Number(token.replace(/\s/g, "")), 0));
}

function balanceKey(row = {}) {
  return [
    normalizeIsoDate(row.date),
    String(row.provider || "binance").trim().toLowerCase(),
    String(row.channel || "").trim(),
    String(row.currency || "").trim().toUpperCase(),
  ].join("|");
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(numeric) ? round(numeric) : null;
}

function round(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function isApplyMode(argv = process.argv) {
  return argv.includes("--apply");
}

function getTargetDate(argv = process.argv) {
  const dateArg = argv.find((arg) => arg.startsWith("--date="));
  return normalizeIsoDate(dateArg ? dateArg.slice("--date=".length) : "") || DEFAULT_TARGET_DATE;
}

async function main() {
  const targetDate = getTargetDate();
  const repository = await loadManualRepositoryFromGoogleSheets();
  if (!repository.ok) {
    console.error(JSON.stringify({ ok: false, error: repository.warning || "Google Sheets repository unavailable" }, null, 2));
    process.exitCode = 1;
    return;
  }

  const rows = buildUserConfirmedBinanceRows({ targetDate });
  const classification = classifyBinanceRepairRows(repository.autoBalances || [], rows);
  const summary = summarizeBinanceRepairPlan(classification, { targetDate });
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
