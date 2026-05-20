#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  normalizeBinanceCsvTransaction,
  parseBinanceTransactionHistoryCsv,
} from "../server/binance-transactions.js";
import {
  getManualGoogleSheetsAccessToken,
  loadManualRepositoryFromGoogleSheets,
  MANUAL_LEDGER_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
} from "../server/manual-google-sheets.js";

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const LEDGER_HEADERS = [
  "date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd",
  "amount_gross", "amount_fee", "amount_net", "category",
  "subcategory", "direction", "comment", "counterparty", "description", "source", "external_id",
  "raw_source_id", "transfer_group_id", "created_at", "updated_at"
];

function parseArgs(argv = []) {
  const args = { from: "2026-03-10", to: "2026-05-20", file: "", apply: false, confirmReviewed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") args.from = argv[++index] || args.from;
    else if (arg === "--to") args.to = argv[++index] || args.to;
    else if (arg === "--file") args.file = argv[++index] || "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--confirm-reviewed") args.confirmReviewed = true;
  }
  return args;
}

function inPeriod(entry, from, to) {
  const date = String(entry?.date || "").slice(0, 10);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function existingSourceIds(repository = {}) {
  const ids = new Set();
  for (const row of repository.operations || []) {
    [
      row.rawSourceId,
      row.raw_source_id,
      row.externalId,
      row.external_id,
      row.ledgerV2?.external_id,
    ].forEach((value) => {
      const id = String(value || "").trim();
      if (id) ids.add(id);
    });
  }
  return ids;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) throw new Error("Usage: node scripts/binance-backfill.mjs --file <binance-history.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--apply --confirm-reviewed]");
  if (args.apply && !args.confirmReviewed) {
    throw new Error("Refusing Binance backfill apply without --confirm-reviewed. Run dry-run first and review rows_to_add, existing_duplicates, ambiguous_rows, and needs_wallet_split.");
  }

  const csv = await readFile(args.file, "utf8");
  const normalized = parseBinanceTransactionHistoryCsv(csv)
    .flatMap((row, index) => normalizeBinanceCsvTransaction(row, index))
    .filter((entry) => inPeriod(entry, args.from, args.to));
  const repository = await loadManualRepositoryFromGoogleSheets().catch((error) => ({ ok: false, operations: [], warning: String(error?.message || error) }));
  const existing = existingSourceIds(repository);
  const rowsToAdd = [];
  const existingDuplicates = [];
  const ambiguousRows = [];
  const needsWalletSplit = [];

  for (const entry of normalized) {
    const id = String(entry.rawSourceId || entry.sourceTransactionId || "").trim();
    if (!id) {
      ambiguousRows.push(entry);
      continue;
    }
    if (existing.has(id)) {
      existingDuplicates.push(entry);
      continue;
    }
    if (entry.needsVerification) {
      needsWalletSplit.push(entry);
      continue;
    }
    rowsToAdd.push(entry);
  }

  let applied = { attempted: 0, appended: 0 };
  if (args.apply) {
    applied = await appendLedgerRows(rowsToAdd);
  }

  console.log(JSON.stringify({
    ok: true,
    dry_run: !args.apply,
    applied,
    period: { from: args.from, to: args.to },
    repository_ok: Boolean(repository.ok),
    repository_warning: repository.warning || null,
    rows_to_add: rowsToAdd,
    existing_duplicates: existingDuplicates,
    ambiguous_rows: ambiguousRows,
    needs_wallet_split: needsWalletSplit,
    summary: {
      parsed_rows: normalized.length,
      rows_to_add: rowsToAdd.length,
      existing_duplicates: existingDuplicates.length,
      ambiguous_rows: ambiguousRows.length,
      needs_wallet_split: needsWalletSplit.length,
    },
  }, null, 2));
}

async function appendLedgerRows(entries = [], { fetchImpl = fetch } = {}) {
  if (!entries.length) return { attempted: 0, appended: 0 };
  const now = new Date().toISOString();
  const values = entries.map((entry) => buildLedgerRow(entry, now));
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE, fetchImpl });
  const range = `'${escapeSheetName(MANUAL_LEDGER_SHEET_NAME)}'!A:V`;
  const url = new URL(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Sheets append failed with HTTP ${response.status}`);
  }
  return {
    attempted: values.length,
    appended: Number(payload?.updates?.updatedRows || values.length),
  };
}

function buildLedgerRow(entry = {}, now = new Date().toISOString()) {
  const amount = Math.abs(Number(entry.localAmount ?? entry.amount ?? 0));
  const amountNet = Number(entry.netAmount ?? entry.amountNet ?? entry.amount_net ?? 0);
  const currency = String(entry.currency || "USDT").trim() || "USDT";
  const operation = entry.operation === "transfer"
    ? "transfer"
    : entry.direction === "out"
      ? "expense"
      : "income";
  const category = entry.category || entry.suggestedCategory || (operation === "transfer" ? "exchange" : operation === "income" ? "servicein" : "business");
  const row = {
    date: String(entry.date || "").slice(0, 10),
    operation,
    from_channel: entry.fromChannel || "",
    to_channel: entry.toChannel || "",
    amount,
    currency,
    amount_usd: isUsdLike(currency) ? amountNet : "",
    amount_gross: amount,
    amount_fee: entry.feeAmount || 0,
    amount_net: amountNet,
    category,
    subcategory: "",
    direction: operation === "transfer" ? "neutral" : entry.direction === "out" ? "out" : "in",
    comment: entry.comment || entry.description || "",
    counterparty: entry.counterparty || "",
    description: entry.description || entry.organization || "",
    source: entry.source || "binance_csv",
    external_id: entry.externalId || entry.sourceTransactionId || entry.rawSourceId || "",
    raw_source_id: entry.rawSourceId || entry.sourceTransactionId || "",
    transfer_group_id: entry.transferGroupId || entry.transfer_group_id || "",
    created_at: now,
    updated_at: now,
  };
  return LEDGER_HEADERS.map((header) => String(row[header] ?? ""));
}

function isUsdLike(currency = "") {
  return ["USD", "USDT", "USDC", "BUSD", "FDUSD", "TUSD"].includes(String(currency || "").trim().toUpperCase());
}

function escapeSheetName(value) {
  return String(value || "").replace(/'/g, "''");
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
