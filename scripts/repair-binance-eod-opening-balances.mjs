#!/usr/bin/env node
import {
  getManualGoogleSheetsAccessToken,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
} from "../server/manual-google-sheets.js";

const SHEET_NAME = "Остатки";
const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const READ_RANGE = `'${SHEET_NAME}'!A:Z`;

const TARGET_ROWS = [
  {
    date: "2026-05-01",
    channel: "Бинанс spot",
    currency: "USDT",
    amount: "1093",
    amountUsd: "1093",
    source: "manual_confirmed_balance",
    status: "ok",
    rawSourceId: "manual_confirmed_balance:2026-05-01:binance-spot:USDT",
    comment: "EOD 23:59; includes Spot + Funding until Binance funding channel split; after Binance Pay -700.",
  },
  {
    date: "2026-05-01",
    channel: "binance save",
    currency: "USDT",
    amount: "7432",
    amountUsd: "7432",
    source: "manual_confirmed_balance",
    status: "ok",
    rawSourceId: "manual_confirmed_balance:2026-05-01:binance-save:USDT",
    comment: "EOD 23:59; Simple Earn / Save.",
  },
];

if (isCliEntrypoint()) {
  await main();
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    const accessToken = await getManualGoogleSheetsAccessToken({ scope: SHEETS_WRITE_SCOPE });
    const values = await readOstatkiValues(accessToken);
    const plan = buildBinanceEodOpeningBalanceRepairPlan(values);
    if (options.apply && plan.ok && plan.summary.change_rows) {
      await applyBinanceEodOpeningBalanceRepair(accessToken, plan);
    }
    printReport({ ...plan, dryRun: !options.apply, applied: Boolean(options.apply && plan.ok && plan.summary.change_rows) });
    if (!plan.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  }
}

export function parseArgs(argv = []) {
  const options = { apply: false, help: false };
  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function buildBinanceEodOpeningBalanceRepairPlan(values = []) {
  const headerIndex = findHeaderIndex(values);
  if (headerIndex === -1) return errorPlan(["Остатки header row was not found."]);
  const header = values[headerIndex] || [];
  const indexes = buildIndexes(header);
  const required = ["date", "channel", "amount", "currency", "amountUsd", "comment"];
  const missing = required.filter((name) => indexes[name] === -1);
  if (missing.length) return errorPlan([`Остатки required column(s) missing: ${missing.join(", ")}`]);

  const existingRows = values.slice(headerIndex + 1).map((row, offset) => ({
    row,
    rowNumber: headerIndex + offset + 2,
  }));
  const targetChanges = [];
  const errors = [];

  for (const target of TARGET_ROWS) {
    const matches = existingRows.filter(({ row }) => isTargetRow(row, indexes, target));
    if (matches.length > 1) {
      errors.push(`Ambiguous Остатки rows for ${target.date} ${target.channel}/${target.currency}: ${matches.map((item) => item.rowNumber).join(", ")}`);
      continue;
    }
    if (!matches.length) {
      targetChanges.push(buildAppendChange(target, values.length + targetChanges.filter((row) => row.action === "append").length + 1, indexes));
      continue;
    }
    targetChanges.push(buildUpdateChange(matches[0], indexes, target));
  }

  const unrelatedBinanceRows = existingRows
    .filter(({ row }) => String(cell(row, indexes.date)).trim() === "2026-05-01")
    .filter(({ row }) => /бинанс|binance/i.test(row.join(" ")))
    .filter(({ row }) => !TARGET_ROWS.some((target) => isTargetRow(row, indexes, target)))
    .map(({ row, rowNumber }) => ({
      rowNumber,
      date: cell(row, indexes.date),
      channel: cell(row, indexes.channel),
      amount: cell(row, indexes.amount),
      currency: cell(row, indexes.currency),
      amount_usd: cell(row, indexes.amountUsd),
      comment: cell(row, indexes.comment),
      action: "listed_not_touched",
    }));

  const changes = targetChanges.filter((row) => row.status === "change" || row.action === "append");
  const unchanged = targetChanges.filter((row) => row.status === "unchanged");
  return {
    ok: errors.length === 0 && targetChanges.length === TARGET_ROWS.length,
    sheet: SHEET_NAME,
    target: TARGET_ROWS.map(({ date, channel, currency, amount, amountUsd, rawSourceId }) => ({ date, channel, currency, amount, amount_usd: amountUsd, raw_source_id: rawSourceId })),
    changes,
    unchanged,
    rows: targetChanges,
    unrelatedBinanceRows,
    errors,
    summary: {
      matched_target_rows: targetChanges.filter((row) => row.action === "update").length,
      append_rows: targetChanges.filter((row) => row.action === "append").length,
      change_rows: changes.length,
      unchanged_rows: unchanged.length,
      unrelated_binance_rows_listed: unrelatedBinanceRows.length,
    },
  };
}

export function applyRepairPlanToValues(values = [], plan = {}) {
  const next = values.map((row) => Array.isArray(row) ? row.slice() : []);
  if (!plan.ok) return next;
  for (const change of plan.changes || []) {
    if (change.action === "append") {
      next.push(change.values.slice());
      continue;
    }
    const row = next[change.rowNumber - 1] || [];
    for (const update of change.updates || []) {
      row[update.columnIndex] = update.newValue;
    }
    next[change.rowNumber - 1] = row;
  }
  return next;
}

async function readOstatkiValues(accessToken) {
  const range = encodeURIComponent(READ_RANGE);
  const response = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets read failed with HTTP ${response.status}`);
  return payload.values || [];
}

async function applyBinanceEodOpeningBalanceRepair(accessToken, plan) {
  const data = [];
  for (const change of plan.changes || []) {
    if (change.action === "append") {
      data.push({
        range: `'${SHEET_NAME}'!A${change.rowNumber}:J${change.rowNumber}`,
        values: [change.values],
      });
      continue;
    }
    for (const update of change.updates || []) {
      data.push({
        range: `'${SHEET_NAME}'!${columnName(update.columnIndex + 1)}${change.rowNumber}`,
        values: [[update.newValue]],
      });
    }
  }
  if (!data.length) return;
  const response = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values:batchUpdate?valueInputOption=USER_ENTERED`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ data, valueInputOption: "USER_ENTERED" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Sheets write failed with HTTP ${response.status}`);
}

function buildUpdateChange(match, indexes, target) {
  const updates = [
    ["date", target.date],
    ["channel", target.channel],
    ["amount", target.amount],
    ["currency", target.currency],
    ["rate", "1"],
    ["amountUsd", target.amountUsd],
    ["comment", target.comment],
    ["source", target.source],
    ["status", target.status],
    ["rawSourceId", target.rawSourceId],
  ]
    .filter(([name]) => indexes[name] !== -1)
    .map(([name, newValue]) => ({
      field: name,
      columnIndex: indexes[name],
      oldValue: cell(match.row, indexes[name]),
      newValue,
    }))
    .filter((update) => String(update.oldValue || "") !== String(update.newValue || ""));

  return {
    action: "update",
    status: updates.length ? "change" : "unchanged",
    rowNumber: match.rowNumber,
    date: target.date,
    channel: target.channel,
    currency: target.currency,
    old_amount: cell(match.row, indexes.amount),
    old_amount_usd: cell(match.row, indexes.amountUsd),
    old_source: cell(match.row, indexes.source),
    old_status: cell(match.row, indexes.status),
    old_raw_source_id: cell(match.row, indexes.rawSourceId),
    new_amount: target.amount,
    new_amount_usd: target.amountUsd,
    new_source: indexes.source === -1 ? null : target.source,
    new_status: indexes.status === -1 ? null : target.status,
    new_raw_source_id: indexes.rawSourceId === -1 ? null : target.rawSourceId,
    updates,
  };
}

function buildAppendChange(target, rowNumber, indexes) {
  const values = [];
  values[indexes.date] = target.date;
  values[indexes.channel] = target.channel;
  values[indexes.amount] = target.amount;
  values[indexes.currency] = target.currency;
  if (indexes.rate !== -1) values[indexes.rate] = "1";
  values[indexes.amountUsd] = target.amountUsd;
  values[indexes.comment] = target.comment;
  if (indexes.source !== -1) values[indexes.source] = target.source;
  if (indexes.status !== -1) values[indexes.status] = target.status;
  if (indexes.rawSourceId !== -1) values[indexes.rawSourceId] = target.rawSourceId;
  return {
    action: "append",
    status: "change",
    rowNumber,
    date: target.date,
    channel: target.channel,
    currency: target.currency,
    new_amount: target.amount,
    new_amount_usd: target.amountUsd,
    new_source: indexes.source === -1 ? null : target.source,
    new_status: indexes.status === -1 ? null : target.status,
    new_raw_source_id: indexes.rawSourceId === -1 ? null : target.rawSourceId,
    values,
    updates: [],
  };
}

function buildIndexes(header) {
  return {
    date: findColumn(header, ["дата", "date"]),
    channel: findColumn(header, ["канал", "channel", "account"]),
    amount: findColumn(header, ["сумма", "amount"]),
    currency: findColumn(header, ["валюта", "currency"]),
    rate: findColumn(header, ["курс", "rate"]),
    amountUsd: findColumn(header, ["сумма_usd", "amount_usd", "usd amount", "usdAmount"]),
    comment: findColumn(header, ["комментарий", "comment"]),
    source: findColumn(header, ["source", "источник"]),
    status: findColumn(header, ["status", "статус"]),
    rawSourceId: findColumn(header, ["raw_source_id", "raw source id", "external_id"]),
  };
}

function isTargetRow(row, indexes, target) {
  return String(cell(row, indexes.date)).trim() === target.date
    && normalizeText(cell(row, indexes.channel)) === normalizeText(target.channel)
    && String(cell(row, indexes.currency)).trim().toUpperCase() === target.currency;
}

function findHeaderIndex(values) {
  return (values || []).findIndex((row) => {
    const normalized = (row || []).map(normalizeHeader);
    return normalized.includes("дата") && normalized.includes("канал") && normalized.includes("сумма");
  });
}

function findColumn(header, names) {
  const normalized = (header || []).map(normalizeHeader);
  return names.map(normalizeHeader).map((name) => normalized.indexOf(name)).find((index) => index !== -1) ?? -1;
}

function cell(row, index) {
  return index === -1 ? "" : String(row?.[index] || "");
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function errorPlan(errors) {
  return { ok: false, sheet: SHEET_NAME, rows: [], changes: [], unchanged: [], unrelatedBinanceRows: [], errors, summary: { matched_target_rows: 0, append_rows: 0, change_rows: 0, unchanged_rows: 0, unrelated_binance_rows_listed: 0 } };
}

function columnName(number) {
  let name = "";
  let current = number;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

function printHelp() {
  console.log("Usage: node scripts/repair-binance-eod-opening-balances.mjs [--apply]");
}

function isCliEntrypoint() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
}
