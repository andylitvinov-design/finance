#!/usr/bin/env node
import { inspect } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appendManualOstatkiRows, loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import { buildPeriodBalanceReconciliation } from "../server/period-balance-reconciliation-engine.js";
import { buildWiseAmountNetHistoryFix } from "./fix-wise-amount-net-history.mjs";

if (isCliEntrypoint()) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repository = await loadRepairRepository(options);
  if (!repository.ok) {
    const result = { ok: false, dryRun: !options.apply, error: repository.warning || "Manual repository unavailable." };
    print(result, options);
    process.exitCode = 1;
    return;
  }
  const report = buildRepairReport({ repository, options });
  if (options.apply) {
    report.applied = await applyRequestedRepairs({ repository, report, options });
    report.dryRun = false;
  }
  print(report, options);
}

export function parseArgs(argv = []) {
  const options = {
    from: "2026-05-01",
    to: "2026-05-17",
    baseUrl: "https://ezohata-incoming-ledger.vercel.app",
    json: false,
    apply: false,
    paypalPersonalConfirmations: new Map(),
    zeroBalances: new Set(),
    useExpectedForZeroMovement: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--from") options.from = argv[++index] || "";
    else if (arg === "--to") options.to = argv[++index] || "";
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
    else if (arg.startsWith("--to=")) options.to = arg.slice("--to=".length);
    else if (arg === "--base-url") options.baseUrl = String(argv[++index] || "").replace(/\/+$/, "");
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length).replace(/\/+$/, "");
    else if (arg === "--paypal-personal-confirm") addConfirmation(options, argv[++index] || "");
    else if (arg.startsWith("--paypal-personal-confirm=")) addConfirmation(options, arg.slice("--paypal-personal-confirm=".length));
    else if (arg === "--zero-balance") options.zeroBalances.add(argv[++index] || "");
    else if (arg.startsWith("--zero-balance=")) options.zeroBalances.add(arg.slice("--zero-balance=".length));
    else if (arg === "--use-expected-for-zero-movement") options.useExpectedForZeroMovement = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function buildRepairReport({ repository, options }) {
  const period = { from: options.from, to: options.to };
  const reconciliation = buildPeriodBalanceReconciliation({
    operations: repository.operations || [],
    balanceRows: repository.balances || [],
    plannedRows: repository.plannedRows || [],
    plannedSourceStatus: repository.plannedSourceStatus,
    period,
  });
  const missingProviderRows = buildMissingProviderTemplates(reconciliation, options);
  const missingOpeningRows = buildMissingOpeningTemplates(reconciliation);
  const ostatkiRepair = buildOstatkiRepairRows({
    reconciliation,
    balanceRows: repository.balances || [],
    options,
  });
  const paypalCandidates = buildPayPalPersonalCandidates(repository.operations || [], options);
  const wise = buildWiseRemainingMismatchDetails({ reconciliation, operations: repository.operations || [] });
  const wiseFix = repository.ledgerValues?.length
    ? buildWiseAmountNetHistoryFix(repository.ledgerValues || [])
    : buildWiseFixSummaryFromOperations(repository.operations || []);

  return {
    ok: true,
    dryRun: !options.apply,
    period,
    reconciliation_summary: reconciliation.summary,
    actionable_rows: reconciliation.actionable_rows || [],
    ostatki_repair_rows: ostatkiRepair.rows,
    skipped_ostatki_repair_rows: ostatkiRepair.skipped,
    missing_balance_template_rows: missingProviderRows,
    missing_opening_balance_rows: missingOpeningRows,
    paypal_personal_manual_confirmation_candidates: paypalCandidates,
    wise_remaining_mismatch_details: wise,
    wise_card_amount_net_fix_summary: {
      safeWiseCardDebitRows: wiseFix.safeWiseCardDebitRows || 0,
      totalCorrection: wiseFix.totalCorrection || 0,
      may2026Correction: wiseFix.may2026Correction || 0,
    },
    copyable_ostatki_template: buildCopyableOstatkiTemplate([...ostatkiRepair.rows, ...missingOpeningRows]),
    warnings: [
      "amount must stay blank unless the user has factual provider/manual balance",
      "expected_closing is a hint only; it is not a provider amount",
      "--apply appends eligible carried-forward rows to Остатки only; Ledger is not changed by this script",
      "missing_provider_balance rows with movement require a manual provider fact; calculated closing is only a hint",
    ],
  };
}

async function loadRepairRepository(options) {
  const local = await loadManualRepositoryFromGoogleSheets();
  if (local.ok) return local;
  const live = await loadRepositoryFromLiveEndpoint(options);
  return live.ok ? live : local;
}

async function loadRepositoryFromLiveEndpoint(options) {
  try {
    const baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
    const url = `${baseUrl}/api?action=getDashboardData&from=${encodeURIComponent(options.from)}&to=${encodeURIComponent(options.to)}`;
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    const manual = payload?.data?.manual || {};
    const operations = manual.operations || [];
    const balances = manual.balanceRows || manual.balances || [];
    if (!response.ok || !Array.isArray(operations)) {
      return { ok: false, warning: payload?.error || `Live dashboard data failed with HTTP ${response.status}` };
    }
    return {
      ok: true,
      source: "live-dashboard-data",
      operations,
      balances,
      plannedRows: manual.plannedRows || manual.planRows || [],
      plannedSourceStatus: "available",
      ledgerValues: [],
      warnings: manual.warnings || [],
    };
  } catch (error) {
    return { ok: false, warning: `Live dashboard data failed: ${String(error?.message || error)}` };
  }
}

function buildMissingProviderTemplates(reconciliation, options) {
  return (reconciliation.by_channel_currency || [])
    .filter((row) => row.status === "missing_provider_balance")
    .map((row) => {
      const key = `${row.channel}|${row.currency}`;
      const confirmedZero = options.zeroBalances.has(key);
      const canUseExpected = options.useExpectedForZeroMovement && Number(row.real_delta || 0) === 0;
      return {
        date: reconciliation.period?.to || options.to,
        channel: row.channel,
        currency: row.currency,
        amount: confirmedZero ? 0 : null,
        expected_closing_hint: row.calculated_closing_balance ?? row.computed_real_closing_balance,
        expected_closing_source: "computed_from_opening_plus_amount_net_movements",
        safe_fill: confirmedZero
          ? "user confirmed zero balance"
          : canUseExpected
            ? "eligible only if user explicitly accepts --use-expected-for-zero-movement"
            : "blank until factual provider/manual balance is entered",
        status: row.status,
      };
    });
}

function buildOstatkiRepairRows({ reconciliation, balanceRows, options }) {
  const existingKeys = new Set((balanceRows || []).map(buildBalanceKey));
  const rows = [];
  const skipped = [];
  for (const row of reconciliation.by_channel_currency || []) {
    const key = buildBalanceKey({
      date: reconciliation.period?.to || options.to,
      channel: row.channel,
      currency: row.currency,
    });
    if (existingKeys.has(key)) {
      if (row.status === "carried_forward_conditional" || row.status === "missing_provider_balance") {
        skipped.push({
          date: reconciliation.period?.to || options.to,
          channel: row.channel,
          currency: row.currency,
          status: row.status,
          reason: "duplicate_date_channel_currency",
        });
      }
      continue;
    }
    if (row.status === "carried_forward_conditional") {
      existingKeys.add(key);
      rows.push({
        date: reconciliation.period?.to || options.to,
        channel: row.channel,
        currency: row.currency,
        amount: row.carried_forward_balance,
        factual_closing_balance_date: row.factual_closing_balance_date,
        closing_balance_source: row.closing_balance_source,
        fact_source: row.fact_source,
        status: row.status,
        movement_rows: row.movement_rows,
        missing_amount_net_rows: row.missing_amount_net_rows,
        action: "append_carried_forward_balance",
        can_write_to_ostatki: true,
        safe_fill: "eligible only after explicit confirmation: no movement, no missing amount_net, carried forward from last observed Остатки",
        comment: `carried_forward_conditional from ${row.factual_closing_balance_date || "last observed"} via period reconciliation`,
      });
    } else if (row.status === "missing_provider_balance" && Number(row.movement_rows || 0) > 0) {
      rows.push({
        date: reconciliation.period?.to || options.to,
        channel: row.channel,
        currency: row.currency,
        amount: null,
        expected_closing_hint: row.calculated_closing_balance ?? row.computed_real_closing_balance,
        expected_closing_source: "computed_from_opening_plus_amount_net_movements",
        status: row.status,
        movement_rows: row.movement_rows,
        missing_amount_net_rows: row.missing_amount_net_rows,
        action: "manual_provider_fact_required",
        can_write_to_ostatki: false,
        safe_fill: "нужен фактический баланс провайдера; computed_real_closing_balance is not a fact",
      });
    }
  }
  return { rows, skipped };
}

function buildMissingOpeningTemplates(reconciliation) {
  return (reconciliation.by_channel_currency || [])
    .filter((row) => row.status === "missing_opening_balance")
    .map((row) => ({
      date: row.repair_template?.date || previousDate(reconciliation.period?.from),
      channel: row.channel,
      currency: row.currency,
      amount: null,
      status: row.status,
      movement_rows: row.movement_rows,
      action: "enter factual opening balance before first movement",
    }));
}

function buildPayPalPersonalCandidates(operations, options) {
  return (operations || [])
    .filter((row) => isPayPalRow(row))
    .filter((row) => !String(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net ?? "").trim())
    .map((row) => {
      const rawSourceId = getRawSourceId(row);
      const confirmedAmount = options.paypalPersonalConfirmations.get(rawSourceId) ?? null;
      return {
        sheetRowNumber: row.sheetRowNumber,
        date: row.date,
        operation: row.operation,
        channel: row.toChannel || row.fromChannel || row.ledgerV2?.to_channel || row.ledgerV2?.from_channel || "",
        currency: row.currency || row.ledgerV2?.currency || "",
        gross: row.amountGross || row.ledgerV2?.amount_gross || row.amount,
        fee: row.amountFee || row.ledgerV2?.amount_fee || "",
        amount_net: row.amountNet || row.ledgerV2?.amount_net || "",
        raw_source_id: rawSourceId,
        comment: row.comment || row.ledgerV2?.comment || "",
        confirmed_amount_net: confirmedAmount,
        source_after_apply: confirmedAmount === null ? null : "paypal_personal_manual",
        warning_status: "fee_unavailable_personal_account",
        action: confirmedAmount === null
          ? `run with --paypal-personal-confirm ${rawSourceId}=<net> only after manual PayPal personal confirmation`
          : "ready for explicit manual confirmation apply",
      };
    });
}

function buildWiseRemainingMismatchDetails({ reconciliation, operations }) {
  const row = (reconciliation.by_channel_currency || [])
    .find((item) => item.channel === "трансервайз дол" && item.currency === "USD");
  const wiseRows = (operations || [])
    .filter((operation) => operation.date >= "2026-05-01" && operation.date <= "2026-05-17")
    .filter((operation) => /wise|transferwise|трансервайз/i.test(`${operation.source || ""} ${operation.fromChannel || ""} ${operation.toChannel || ""}`))
    .map((operation) => ({
      sheetRowNumber: operation.sheetRowNumber,
      date: operation.date,
      operation: operation.operation,
      from_channel: operation.fromChannel,
      to_channel: operation.toChannel,
      amount: operation.amount,
      amount_fee: operation.amountFee,
      amount_net: operation.amountNet,
      balance_amount: operation.balanceAmount,
      raw_source_id: getRawSourceId(operation),
    }));
  return {
    status: row?.status || "not_found",
    opening: row?.opening_balance ?? null,
    real_delta: row?.real_delta ?? null,
    expected_closing: row?.calculated_closing_balance ?? row?.computed_real_closing_balance ?? null,
    factual_closing: row?.manual_provider_closing_balance ?? row?.displayed_fact_balance ?? row?.factual_closing_balance ?? null,
    diff: row?.real_difference ?? null,
    note: row?.real_difference
      ? "remaining mismatch needs row-level verification; check stale Остатки, missing Wise movement, duplicate, CARD fee semantics, or provider statement mismatch"
      : "no Wise USD mismatch detected in reconciliation",
    may_rows: wiseRows,
  };
}

function buildWiseFixSummaryFromOperations(operations) {
  const candidates = (operations || []).map(getWiseCardDebitCandidateFromOperation).filter(Boolean);
  return {
    safeWiseCardDebitRows: candidates.length,
    totalCorrection: round(candidates.reduce((sum, row) => sum + row.delta, 0)),
    may2026Correction: round(candidates
      .filter((row) => row.date >= "2026-05-01" && row.date <= "2026-05-17")
      .reduce((sum, row) => sum + row.delta, 0)),
    candidateRows: candidates,
  };
}

function getWiseCardDebitCandidateFromOperation(row) {
  const rawSourceId = getRawSourceId(row);
  const isWise = /wise|transferwise|трансервайз/i.test(`${row?.source || ""} ${row?.fromChannel || ""} ${row?.toChannel || ""} ${rawSourceId}`);
  if (!isWise || !/^CARD-/i.test(rawSourceId)) return null;
  const amount = parseNumber(row.amount ?? row.ledgerV2?.amount);
  const gross = parseNumber(row.amountGross ?? row.ledgerV2?.amount_gross) ?? Math.abs(amount || 0);
  const fee = parseNumber(row.amountFee ?? row.ledgerV2?.amount_fee);
  const net = parseNumber(row.amountNet ?? row.ledgerV2?.amount_net);
  if (amount === null || gross === null || fee === null || net === null) return null;
  const fullDebit = Math.abs(gross || amount);
  const feeReducedNet = round(Math.max(0, fullDebit - Math.abs(fee)));
  if (Math.abs(net - feeReducedNet) > 0.0001) return null;
  if (Math.abs(fullDebit - net) <= 0.0001) return null;
  return {
    sheetRowNumber: row.sheetRowNumber,
    date: row.date,
    operation: row.operation,
    from_channel: row.fromChannel || row.ledgerV2?.from_channel || "",
    currency: row.currency || row.ledgerV2?.currency || "",
    raw_source_id: rawSourceId,
    previousAmountNet: round(net),
    nextAmountNet: round(fullDebit),
    fee: round(fee),
    delta: round(fullDebit - net),
  };
}

export async function applyRequestedRepairs({ report, appendOstatkiRowsImpl = appendManualOstatkiRows }) {
  const rows = (report.ostatki_repair_rows || [])
    .filter((row) => row.action === "append_carried_forward_balance")
    .filter((row) => row.amount !== null && row.amount !== undefined && row.amount !== "");
  if (!rows.length) {
    return { type: "ostatki_append", appended: [], skipped: [], appendRowCount: 0 };
  }
  const result = await appendOstatkiRowsImpl({ rows });
  return { type: "ostatki_append", ...result };
}

function buildCopyableOstatkiTemplate(rows) {
  return [
    "date\tchannel\tcurrency\tamount\texpected_closing_hint",
    ...(rows || []).map((row) => [
      row.date || "",
      row.channel || "",
      row.currency || "",
      row.amount === null || row.amount === undefined ? "" : row.amount,
      row.expected_closing_hint === null || row.expected_closing_hint === undefined ? "" : row.expected_closing_hint,
    ].join("\t")),
  ].join("\n");
}

function buildBalanceKey(row) {
  return [
    String(row?.date || "").trim(),
    normalizeKeyText(row?.channel || row?.accountName || row?.account || ""),
    String(row?.currency || "").trim().toUpperCase(),
  ].join("|");
}

function normalizeKeyText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function addConfirmation(options, value) {
  const [id, amount] = String(value || "").split("=");
  if (!id || !amount) throw new Error("--paypal-personal-confirm must be raw_source_id=amount");
  const numeric = Number(String(amount).replace(",", "."));
  if (!Number.isFinite(numeric)) throw new Error(`Invalid PayPal confirmation amount: ${amount}`);
  options.paypalPersonalConfirmations.set(id.trim(), numeric);
}

function isPayPalRow(row) {
  return /paypal|пейпал/i.test(`${row?.source || ""} ${row?.fromChannel || ""} ${row?.toChannel || ""} ${row?.rawSourceId || ""}`);
}

function getRawSourceId(row) {
  return String(row?.rawSourceId || row?.raw_source_id || row?.externalId || row?.external_id || row?.ledgerV2?.external_id || "").trim();
}

function appendMarker(candidate, marker) {
  const base = String(candidate.comment || "").trim();
  return [base, marker].filter(Boolean).join(" | ");
}

function previousDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function print(report, options) {
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else console.log(inspect(report, { depth: 8, colors: false }));
}

function isCliEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
