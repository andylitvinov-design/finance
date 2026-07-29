import { loadAutoBalanceRowsFromGoogleSheets } from "./auto-balance-repository.js";
import { mergeManualAndAutoBalances } from "./balance-snapshot-merge.js";
import {
  buildDailyCalculatedBalances,
  toCalculatedBalanceSnapshotRows,
} from "./daily-calculated-balances.js";
import { buildDailyBalanceCoverage } from "./daily-balance-engine.js";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { buildPeriodBalanceReconciliation } from "./period-balance-reconciliation-engine.js";
import { buildProviderLedgerReconciliation } from "./provider-ledger-reconciliation-engine.js";
import { fetchYooMoneyStatementEntries } from "../api/yoomoney-transactions.js";
import { canonicalOstatkiChannel } from "../api/save-balance-snapshot.js";

// The reconciliation engine groups positions and looks up facts by the raw
// balance-row channel. Fold known Остатки channel aliases (e.g. the OCR-truncated
// "binance save uf" -> "binance save") to their canonical wallet before grouping so
// stored facts reconcile under the right position. canonicalOstatkiChannel is a
// non-destructive passthrough for unknown channels, so this only affects mapped aliases.
function canonicalizeBalanceRowChannels(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const rawChannel = row?.channel ?? row?.accountName ?? row?.account ?? "";
    const canonical = canonicalOstatkiChannel(rawChannel);
    if (!canonical || canonical === rawChannel) return row;
    return { ...row, channel: canonical };
  });
}

const DEFERRED_OCR_ALIAS_CANDIDATES = [
  {
    alias: "binance save u",
    currency: "USDT",
    canonical: "binance save",
    status: "needs_owner_resolution",
  },
  {
    alias: "binance spot ц",
    currency: "USDC",
    canonical: "Бинанс spot",
    status: "needs_owner_resolution",
  },
  {
    alias: "Бинанс spot us",
    currency: "USDT",
    canonical: "Бинанс spot",
    status: "possible_separate_wallet",
    note: "possible separate Binance-US wallet",
  },
];

const PROJECT_NAME = "ezohata-incoming-ledger";
const MANUAL_BALANCE_SHEET_NAME = "Остатки";
const AUTO_BALANCE_SHEET_NAME = "Авто Остатки";

export default async function periodBalanceReconciliationHandler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") return response.status(200).json({ ok: true });
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }
  if (String(request.query?.mode || "").trim().toLowerCase() === "apply") {
    return response.status(400).json({
      ok: false,
      error: "period balance reconciliation is dry-run only; apply mode is not available on this endpoint",
    });
  }

  const snapshot = await buildPeriodBalanceReconciliationSnapshot({
    query: request.query || {},
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
    autoBalanceLoader: loadAutoBalanceRowsFromGoogleSheets,
  });
  return response.status(200).json(snapshot);
}

export async function buildPeriodBalanceReconciliationSnapshot(options = {}) {
  const query = options.query || {};
  const period = parsePeriod(query);
  const mode = parseMode(query);
  const includeDailyBalances = parseBoolean(query.includeDailyBalances);
  const warnings = [];
  const repository = await loadRepository(options.repositoryLoader);
  const autoBalances = Array.isArray(repository?.autoBalances)
    ? { ok: true, balances: repository.autoBalances, warnings: [] }
    : (options.autoBalanceLoader
      ? await loadAutoBalances(options.autoBalanceLoader)
      : { ok: true, balances: [], warnings: [] });

  if (!repository.ok) {
    warnings.push("needs verification: manual Google Sheets read access is unavailable.");
    if (repository.warning) warnings.push(toSafeWarning(repository.warning));
    warnings.push(...(autoBalances.warnings || []).map(toSafeWarning).filter(Boolean));
    const balanceRows = mergeManualAndAutoBalances([], Array.isArray(autoBalances.balances) ? autoBalances.balances : []).rows;
    const reconciliation = buildPeriodBalanceReconciliation({
      operations: [],
      balanceRows,
      calculatedBalanceRows: [],
      fxRates: Array.isArray(repository.fxRates) ? repository.fxRates : [],
      plannedRows: [],
      plannedSourceStatus: "needs_verification",
      period,
    });
    annotateReconciliationSources(reconciliation, balanceRows);
    annotateBalanceSourceDiagnostics(reconciliation, period);
    annotateDailyBalanceCoverage(reconciliation, {
      operations: [],
      balanceRows,
      period,
      includeDailyBalances,
    });
    reconciliation.source_status = "needs_verification";
    reconciliation.summary = {
      ...(reconciliation.summary || {}),
      status: "needs_verification",
    };
    reconciliation.total_usd_row = {
      ...(reconciliation.total_usd_row || {}),
      total_coverage_status: "unavailable",
      partial: true,
      status: "needs_verification",
    };
    reconciliation.reconciliation_report_summary = {
      ...(reconciliation.reconciliation_report_summary || {}),
      total_usd_row: reconciliation.total_usd_row,
    };
    reconciliation.canonical_total = {
      ...(reconciliation.canonical_total || {}),
      source: "needs_verification",
      canonical_total_usd: null,
      totals_match: false,
      status: "needs_verification",
      explanation: "Manual balance and Ledger sources are unavailable; zero values are not financial facts.",
    };
    reconciliation.canonical_total_usd_row = {
      ...(reconciliation.canonical_total_usd_row || {}),
      total_coverage_status: "unavailable",
      partial: true,
      status: "needs_verification",
      source: "needs_verification",
      canonical_total_usd: null,
      totals_match: false,
    };
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      project: PROJECT_NAME,
      period,
      mode,
      mutates_data: false,
      period_balance_reconciliation: reconciliation,
      warnings: unique(warnings),
    };
  }

  const plannedRows = resolvePlannedRows(repository);
  const plannedSourceStatus = resolvePlannedSourceStatus(repository, plannedRows);
  const manualBalances = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalanceRows = Array.isArray(autoBalances.balances) ? autoBalances.balances : [];
  const autoStatusRows = autoBalanceRows.filter((row) => isAutoStatusOnlyRow(row));
  const balanceSnapshotMerge = mergeManualAndAutoBalances(manualBalances, autoBalanceRows);
  const rawBalanceRows = balanceSnapshotMerge.rows || balanceSnapshotMerge.merged || [];
  const ocrAliasCollisions = buildOcrAliasCollisionDiagnostics(rawBalanceRows);
  const balanceRows = canonicalizeBalanceRowChannels(rawBalanceRows);
  const calculatedBalances = buildDailyCalculatedBalances({
    operations: repository.operations || [],
    balanceRows,
    period,
  });
  const calculatedBalanceRows = toCalculatedBalanceSnapshotRows(calculatedBalances.rows);
  const sourceRows = [...balanceRows, ...calculatedBalanceRows];
  const reconciliation = buildPeriodBalanceReconciliation({
    operations: repository.operations || [],
    balanceRows,
    calculatedBalanceRows,
    fxRates: Array.isArray(repository.fxRates) ? repository.fxRates : [],
    plannedRows,
    plannedSourceStatus,
    period,
  });
  annotateReconciliationSources(reconciliation, sourceRows);
  annotateBalanceSourceDiagnostics(reconciliation, period);
  annotateDailyBalanceCoverage(reconciliation, {
    operations: repository.operations || [],
    balanceRows: sourceRows,
    period,
    includeDailyBalances,
  });
  annotateBinanceWalletDiagnostics(reconciliation, repository.operations || [], period);
  const yooMoneyProviderEvidence = await loadYooMoneyProviderEvidence(period, options);
  annotateProviderLedgerReconciliation(reconciliation, repository.operations || [], period, yooMoneyProviderEvidence);
  reconciliation.diagnostics = {
    ...(reconciliation.diagnostics || {}),
    manual_balance_snapshot_rows_loaded: manualBalances.length,
    auto_balance_snapshot_rows_loaded: autoBalanceRows.length,
    auto_balance_status_rows_loaded: autoStatusRows.length,
    auto_balance_status_counts: countAutoBalanceStatuses(autoStatusRows),
    balance_snapshot_rows_loaded: balanceRows.length,
    ocr_alias_collisions: ocrAliasCollisions,
    calculated_balance_rows_built: calculatedBalanceRows.length,
    fx_rates_rows_loaded: Array.isArray(repository.fxRates) ? repository.fxRates.length : 0,
    fx_rates_status_counts: repository.fxRateDiagnostics?.status_counts || {},
    analytics_fact_rows_rendered: (reconciliation.by_channel_currency || [])
      .filter((row) => row.factual_closing_balance !== null && row.factual_closing_balance !== undefined).length,
  };
  warnings.push(...(repository.warnings || []).map(toSafeWarning).filter(Boolean));
  warnings.push(...(autoBalances.warnings || []).map(toSafeWarning).filter(Boolean));
  warnings.push(...reconciliation.warnings);
  warnings.push(...ocrAliasCollisions.map(formatOcrAliasCollisionWarning));
  if (!plannedRows.length && plannedSourceStatus !== "available") {
    warnings.push(
      "needs verification: planned income/expense source is not connected to period balance reconciliation yet; TODO expose UI movementValues order-plan rows and manual finance planned expense rows server-side as repository.plannedRows before planned_delta can be trusted."
    );
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    project: PROJECT_NAME,
    period,
    mode,
    mutates_data: false,
    period_balance_reconciliation: reconciliation,
    warnings: unique(warnings),
  };
}

function buildOcrAliasCollisionDiagnostics(balanceRows = []) {
  const rows = Array.isArray(balanceRows) ? balanceRows : [];
  const rowsByKey = new Map();
  rows.forEach((row) => {
    const date = normalizeDate(row.date);
    const currency = normalizeCurrency(row.currency);
    const channel = normalizeLookupText(row.channel || row.accountName || row.account || "");
    if (!date || !currency || !channel) return;
    const key = balanceCollisionKey(date, channel, currency);
    const existing = rowsByKey.get(key) || [];
    existing.push(row);
    rowsByKey.set(key, existing);
  });

  const collisions = [];
  rows.forEach((aliasRow) => {
    const date = normalizeDate(aliasRow.date);
    const currency = normalizeCurrency(aliasRow.currency);
    const channel = normalizeLookupText(aliasRow.channel || aliasRow.accountName || aliasRow.account || "");
    if (!date || !currency || !channel) return;
    const candidate = DEFERRED_OCR_ALIAS_CANDIDATES.find((entry) => (
      normalizeLookupText(entry.alias) === channel && entry.currency === currency
    ));
    if (!candidate) return;

    const canonicalRows = rowsByKey.get(
      balanceCollisionKey(date, normalizeLookupText(candidate.canonical), currency)
    ) || [];
    canonicalRows.forEach((canonicalRow) => {
      const aliasAmount = parseBalanceAmount(aliasRow);
      const canonicalAmount = parseBalanceAmount(canonicalRow);
      if (!Number.isFinite(aliasAmount) || !Number.isFinite(canonicalAmount)) return;
      if (sameBalanceAmount(aliasAmount, canonicalAmount)) return;
      collisions.push({
        status: candidate.status,
        date,
        currency,
        alias_channel: String(aliasRow.channel || aliasRow.accountName || aliasRow.account || "").trim(),
        alias_amount: round(aliasAmount),
        candidate_canonical_channel: candidate.canonical,
        canonical_amount: round(canonicalAmount),
        amount_delta: round(aliasAmount - canonicalAmount),
        action: "keep_rows_unchanged_until_owner_resolution",
        note: candidate.note || "same-date canonical fact has a different amount",
        source: "manual_balance_ocr_alias_collision",
        alias_source_sheet: aliasRow.sourceSheet || aliasRow.source_sheet || "",
        alias_source_row: aliasRow.sourceRow || aliasRow.source_row || null,
        canonical_source_sheet: canonicalRow.sourceSheet || canonicalRow.source_sheet || "",
        canonical_source_row: canonicalRow.sourceRow || canonicalRow.source_row || null,
      });
    });
  });
  return collisions;
}

function formatOcrAliasCollisionWarning(item = {}) {
  return [
    "ocr alias collision:",
    `${item.alias_channel}/${item.currency}`,
    `on ${item.date}`,
    `matches candidate ${item.candidate_canonical_channel}`,
    `but amounts differ (${item.alias_amount} vs ${item.canonical_amount});`,
    `status=${item.status}; rows kept unchanged`,
  ].join(" ");
}

function balanceCollisionKey(date, channel, currency) {
  return [date, channel, currency].join("|");
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function parseBalanceAmount(row = {}) {
  const raw = row.amount ?? row.balanceAmount ?? row.balance_amount ?? row.value ?? "";
  const normalized = String(raw ?? "").trim().replace(/\s+/g, "").replace(/,/g, ".").replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function sameBalanceAmount(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.0001;
}

function annotateDailyBalanceCoverage(reconciliation, {
  operations = [],
  balanceRows = [],
  period = {},
  includeDailyBalances = false,
} = {}) {
  const coverage = buildDailyBalanceCoverage({
    operations,
    balanceRows,
    period,
    activePairs: (reconciliation.by_channel_currency || []).map((row) => ({
      channel: row.channel,
      currency: row.currency,
    })),
  });
  const summary = coverage.summary || {};
  reconciliation.daily_balance_coverage = {
    period_from: summary.period_from,
    period_to: summary.period_to,
    period_days: summary.period_days,
    active_pairs: summary.active_pairs,
    expected_rows: summary.expected_rows,
    actual_rows: summary.actual_rows,
    complete: summary.complete,
    status_counts: summary.status_counts || {},
    missing_opening_balance_rows: summary.missing_opening_balance_rows || 0,
    computed_from_previous_day_rows: summary.computed_from_previous_day_rows || 0,
    provider_auto_rows: summary.provider_auto_rows || 0,
    manual_fact_rows: summary.manual_fact_rows || 0,
    provider_status_rows: summary.provider_status_rows || 0,
    mismatch_rows: summary.mismatch_rows || 0,
    missing_amount_net_rows: summary.missing_amount_net_rows || summary.excluded_missing_amount_net_rows || 0,
    missing_dates_preview: summary.missing_dates_preview || [],
    actionable_rows_preview: coverage.actionable_rows || [],
  };
  if (includeDailyBalances) {
    reconciliation.daily_balance_rows = coverage.rows;
  } else {
    delete reconciliation.daily_balance_rows;
    reconciliation.daily_balance_rows_preview = coverage.rows.slice(0, 30);
  }
}

function annotateBinanceWalletDiagnostics(reconciliation, operations = [], period = {}) {
  const wallets = ["Бинанс spot", "Binance funding", "binance save"];
  const walletRows = wallets.map((channel) => {
    const rows = (reconciliation.by_channel_currency || []).filter((row) => row.channel === channel);
    return {
      channel,
      opening: round(rows.reduce((sum, row) => sum + Number(row.opening_balance || row.opening_fact_balance || 0), 0)),
      movement: round(rows.reduce((sum, row) => sum + Number(row.real_delta || 0), 0)),
      closing_fact: rows.some((row) => row.manual_provider_closing_balance !== null && row.manual_provider_closing_balance !== undefined)
        ? round(rows.reduce((sum, row) => sum + Number(row.manual_provider_closing_balance || 0), 0))
        : null,
      difference: rows.some((row) => row.real_difference !== null && row.real_difference !== undefined)
        ? round(rows.reduce((sum, row) => sum + Number(row.real_difference || 0), 0))
        : null,
      rows: rows.length,
      statuses: countStatuses(rows),
    };
  });
  const total = {
    channel: "Binance total",
    opening: round(walletRows.reduce((sum, row) => sum + Number(row.opening || 0), 0)),
    movement: round(walletRows.reduce((sum, row) => sum + Number(row.movement || 0), 0)),
    closing_fact: walletRows.some((row) => row.closing_fact !== null)
      ? round(walletRows.reduce((sum, row) => sum + Number(row.closing_fact || 0), 0))
      : null,
    difference: walletRows.some((row) => row.difference !== null)
      ? round(walletRows.reduce((sum, row) => sum + Number(row.difference || 0), 0))
      : null,
  };
  const binanceOperations = (operations || []).filter((row) => isBinanceOperation(row) && isOperationInPeriod(row, period));
  reconciliation.binance_wallet_diagnostics = {
    wallets: walletRows,
    total,
    unmapped_operations: binanceOperations.filter((row) => !operationTouchesAnyChannel(row, wallets)).length,
    skipped_needs_verification: binanceOperations.filter((row) => /needs[_ ]verification/i.test(`${row.reviewStatus || row.review_status || row.comment || ""}`)).length,
  };
}

function operationTouchesAnyChannel(row = {}, channels = []) {
  const values = [
    row.fromChannel,
    row.from_channel,
    row.toChannel,
    row.to_channel,
    row.channel,
    row.ledgerV2?.from_channel,
    row.ledgerV2?.to_channel,
    row.ledgerV2?.channel,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return values.some((value) => channels.includes(value));
}

function isBinanceOperation(row = {}) {
  const text = [
    row.source,
    row.rawSourceId,
    row.raw_source_id,
    row.externalId,
    row.external_id,
    row.fromChannel,
    row.from_channel,
    row.toChannel,
    row.to_channel,
    row.ledgerV2?.source,
    row.ledgerV2?.external_id,
    row.ledgerV2?.from_channel,
    row.ledgerV2?.to_channel,
  ].map((value) => String(value || "").trim()).join(" ");
  return /binance|бинанс/i.test(text);
}

function isOperationInPeriod(row = {}, period = {}) {
  const date = String(row.date || row.ledgerV2?.date || "").slice(0, 10);
  if (!date) return false;
  const from = String(period.from || "").slice(0, 10);
  const to = String(period.to || "").slice(0, 10);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function countStatuses(rows = []) {
  return rows.reduce((counts, row) => {
    const status = String(row.status || "").trim() || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function round(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function isAutoStatusOnlyRow(row = {}) {
  const status = String(row.status || row.autoBalanceStatus || row.auto_balance_status || "").trim();
  const amount = String(row.balanceAmount ?? row.amount ?? "").trim();
  const amountUsd = String(row.usdAmount ?? row.amountUsd ?? row.amount_usd ?? "").trim();
  return Boolean(status && !["ok", "zero_balance"].includes(status) && !amount && !amountUsd);
}

function countAutoBalanceStatuses(rows = []) {
  return rows.reduce((counts, row) => {
    const status = String(row.status || row.autoBalanceStatus || row.auto_balance_status || "").trim();
    if (status) counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

async function loadYooMoneyProviderEvidence(period = {}, options = {}) {
  if (typeof options.yooMoneyProviderEvidenceLoader === "function") {
    return options.yooMoneyProviderEvidenceLoader(period);
  }

  const accessToken = String(options.yooMoneyAccessToken ?? process.env.YOOMONEY_ACCESS_TOKEN ?? "").trim();
  if (!accessToken) {
    return {
      source: "not_connected",
      warning: {
        code: "yoomoney_not_connected",
        status: "provider_not_connected",
        message: "YooMoney API token is not configured.",
      },
      rows: [],
    };
  }

  try {
    const result = await fetchYooMoneyStatementEntries({
      startDate: period.from,
      endDate: period.to,
      accessToken,
      currency: options.yooMoneyCurrency || process.env.YOOMONEY_CURRENCY || "RUB",
      baseUrl: options.yooMoneyBaseUrl || process.env.YOOMONEY_API_BASE,
      fetchImpl: options.yooMoneyFetchImpl || fetch,
    });
    return {
      source: "live_yoomoney",
      warning: null,
      rows: convertYooMoneyEntriesToProviderEvidenceRows(result.entries || []),
    };
  } catch (error) {
    return {
      source: "provider_error",
      warning: {
        code: "yoomoney_provider_error",
        status: "provider_error",
        message: toSafeWarning(error?.message || error || "YooMoney provider request failed."),
      },
      rows: [],
    };
  }
}

export function convertYooMoneyEntriesToProviderEvidenceRows(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const currency = String(entry?.currency || "RUB").trim().toUpperCase() || "RUB";
      const amount = Math.abs(Number(entry?.localAmount ?? entry?.amount ?? 0)) || 0;
      const direction = String(entry?.direction || "").trim().toLowerCase();
      const signedAmount = direction === "income" ? amount : -amount;
      const sourceId = String(
        entry?.source_id
          || entry?.operation_id
          || entry?.sourceTransactionId
          || entry?.id
          || ""
      ).trim();
      return {
        date: String(entry?.date || "").slice(0, 10),
        signedAmount,
        signed_amount: signedAmount,
        currency,
        channel: "Яндекс руб",
        source: "yoomoney",
        provider: "yoomoney",
        source_id: sourceId,
        operation_id: sourceId,
        evidence_id: sourceId ? `yoomoney-live-${sourceId}` : `yoomoney-live-${index + 1}`,
        description: [
          entry?.description,
          entry?.organization,
          entry?.comment,
          entry?.counterpartyName,
          entry?.counterparty,
        ].map((part) => String(part || "").trim()).filter(Boolean).join(" | "),
      };
    })
    .filter((row) => row.date && row.currency === "RUB" && Math.abs(row.signedAmount) > 0);
}

function annotateProviderLedgerReconciliation(reconciliation, operations = [], period = {}, providerEvidenceResult = {}) {
  const yoomoneyBalanceDiagnostics = (reconciliation.by_channel_currency || [])
    .filter((row) => row.channel === "Яндекс руб" && row.currency === "RUB")
    .filter((row) => row.status && row.status !== "ok" && row.status !== "no_data")
    .map((row) => ({
      date: row.manual_provider_closing_balance_date || period.to || "",
      channel: row.channel,
      currency: row.currency,
      status: row.status,
      computed_closing_balance: row.calculated_closing_balance,
      provider_reported_balance: row.manual_provider_closing_balance,
      sourceRow: row.sourceRow || row.source_row || null,
    }));
  const providerEvidenceSource = providerEvidenceResult.source || "not_connected";
  const providerWarning = providerEvidenceResult.warning || null;
  const providerEvidenceRows = Array.isArray(providerEvidenceResult.rows) ? providerEvidenceResult.rows : [];
  const yoomoney = providerEvidenceSource === "live_yoomoney"
    ? buildProviderLedgerReconciliation({
      source: "yoomoney",
      channel: "Яндекс руб",
      currency: "RUB",
      providerEvidence: providerEvidenceRows,
      ledgerRows: operations,
      balanceDiagnostics: yoomoneyBalanceDiagnostics,
      period,
    })
    : buildDisconnectedProviderLedgerReconciliation({
      source: "yoomoney",
      channel: "Яндекс руб",
      currency: "RUB",
      period,
      providerEvidenceSource,
      providerWarning,
    });
  yoomoney.provider_evidence_source = providerEvidenceSource;
  yoomoney.provider_warning = providerWarning;
  reconciliation.provider_ledger_reconciliation = { yoomoney };
  reconciliation.summary = {
    ...(reconciliation.summary || {}),
    transaction_reconciliation_status: yoomoney.transaction_reconciliation_status,
    monthly_total_status: yoomoney.monthly_total_status,
    date_alignment_status: yoomoney.date_alignment_status,
    extra_ledger_status: yoomoney.extra_ledger_status,
    manual_migration_status: yoomoney.manual_migration_status,
    provider_evidence_total: yoomoney.provider_evidence_total,
    ledger_provider_total: yoomoney.ledger_provider_total,
    raw_ledger_yoomoney_total: yoomoney.raw_ledger_yoomoney_total,
    confirmed_matched_ledger_total: yoomoney.confirmed_matched_ledger_total,
    legacy_source_yoomoney_total: yoomoney.legacy_source_yoomoney_total,
    extra_ledger_total: yoomoney.extra_ledger_total,
    ledger_manual_migration_total: yoomoney.ledger_manual_migration_total,
    manual_migration_total: yoomoney.manual_migration_total,
    combined_total: yoomoney.combined_total,
    provider_net: yoomoney.provider_net,
    raw_ledger_yoomoney_net: yoomoney.raw_ledger_yoomoney_net,
    confirmed_matched_ledger_net: yoomoney.confirmed_matched_ledger_net,
    transaction_monthly_delta: yoomoney.transaction_monthly_delta,
    transaction_delta: yoomoney.transaction_delta,
    manual_migration_delta: yoomoney.manual_migration_delta,
    stale_ostatki_rows: yoomoney.stale_ostatki_rows,
    manual_confirmation_required_rows: yoomoney.manual_confirmation_required_rows,
    provider_evidence_source: yoomoney.provider_evidence_source,
    provider_warning: yoomoney.provider_warning,
    safe_fixes_available: yoomoney.safe_fixes_available,
  };
}

function buildDisconnectedProviderLedgerReconciliation({
  source = "",
  channel = "",
  currency = "",
  period = {},
  providerEvidenceSource = "not_connected",
  providerWarning = null,
} = {}) {
  const emptyTotal = {
    income: 0,
    expense: 0,
    net: 0,
    income_display: "0.00",
    expense_display: "0.00",
    net_display: "0.00",
  };
  const status = providerEvidenceSource === "provider_error" ? "provider_error" : "provider_not_connected";
  return {
    source,
    channel,
    currency,
    period: {
      from: period.from || null,
      to: period.to || null,
    },
    status,
    transaction_reconciliation_status: status,
    monthly_total_status: status,
    date_alignment_status: status,
    extra_ledger_status: status,
    manual_migration_status: status,
    provider_evidence_source: providerEvidenceSource,
    provider_warning: providerWarning,
    provider_evidence_total: emptyTotal,
    ledger_provider_total: emptyTotal,
    raw_ledger_yoomoney_total: emptyTotal,
    confirmed_matched_ledger_total: emptyTotal,
    legacy_source_yoomoney_total: emptyTotal,
    extra_ledger_total: emptyTotal,
    ledger_manual_migration_total: emptyTotal,
    manual_migration_total: emptyTotal,
    combined_total: emptyTotal,
    provider_net: 0,
    raw_ledger_yoomoney_net: 0,
    confirmed_matched_ledger_net: 0,
    transaction_monthly_delta: 0,
    transaction_delta: 0,
    manual_migration_delta: 0,
    provider_totals: { by_month: {}, total: emptyTotal },
    ledger_totals: { by_month: {}, total: { yoomoney: emptyTotal, manual_migration: emptyTotal, combined: emptyTotal } },
    differences: { by_month: {} },
    row_level: {
      provider_rows: [],
      ledger_rows: [],
      provider_total_rows: [],
      ledger_yoomoney_total_rows: [],
      excluded_ledger_rows: [],
      extra_provider_rows: [],
      extra_ledger_rows: [],
      wrong_date_rows: [],
      manual_migration_rows: [],
      provider_status_counts: {},
      ledger_status_counts: {},
      matched_exact: [],
      matched_wrong_date: [],
      missing_in_ledger: [],
      duplicate_in_ledger: [],
      extra_manual_migration: [],
    },
    safe_fixes_available: [],
    manual_blockers: {},
    balance_diagnostics: { rows: [], copyable_rows: [] },
    stale_ostatki_rows: [],
    manual_confirmation_required_rows: [],
  };
}

function annotateReconciliationSources(reconciliation, balanceRows = []) {
  const lookup = buildBalanceRowLookup(balanceRows);
  reconciliation.by_channel_currency = (reconciliation.by_channel_currency || []).map((row) => {
    const sourceRow = findSourceBalanceRow(row, lookup);
    const balanceSource = sourceRow
      ? (isStatusOnlyBalanceRow(sourceRow) ? "missing" : normalizeBalanceSource(sourceRow, "manual_fact"))
      : "missing";
    return {
      ...row,
      balanceSource,
      balance_source: balanceSource,
      needsManualConfirmation: !["manual_fact", "calculated_balance"].includes(balanceSource),
      needs_manual_confirmation: !["manual_fact", "calculated_balance"].includes(balanceSource),
      provider: sourceRow?.provider || "",
      sourceSheet: sourceRow?.sourceSheet || getDefaultSourceSheet(balanceSource),
      source_sheet: sourceRow?.sourceSheet || getDefaultSourceSheet(balanceSource),
      sourceRow: sourceRow?.sourceRow || null,
      source_row: sourceRow?.sourceRow || null,
      sourceComment: sourceRow?.comment || "",
      source_comment: sourceRow?.comment || "",
    };
  });
  reconciliation.actionable_rows = (reconciliation.actionable_rows || []).map((row) => {
    const sourceRow = findSourceBalanceRow(row, lookup);
    const balanceSource = sourceRow
      ? (isStatusOnlyBalanceRow(sourceRow) ? "missing" : normalizeBalanceSource(sourceRow, "manual_fact"))
      : String(row.balanceSource || row.balance_source || "missing").trim() || "missing";
    return {
      ...row,
      balanceSource,
      balance_source: balanceSource,
      needsManualConfirmation: !["manual_fact", "calculated_balance"].includes(balanceSource),
      needs_manual_confirmation: !["manual_fact", "calculated_balance"].includes(balanceSource),
      sourceSheet: sourceRow?.sourceSheet || row.sourceSheet || getDefaultSourceSheet(balanceSource),
      source_sheet: sourceRow?.sourceSheet || row.source_sheet || row.sourceSheet || getDefaultSourceSheet(balanceSource),
      sourceRow: sourceRow?.sourceRow || row.sourceRow || null,
      source_row: sourceRow?.sourceRow || row.source_row || row.sourceRow || null,
      sourceComment: sourceRow?.comment || row.sourceComment || "",
      source_comment: sourceRow?.comment || row.source_comment || row.sourceComment || "",
    };
  });
}

function annotateBalanceSourceDiagnostics(reconciliation, period = {}) {
  const rows = Array.isArray(reconciliation.by_channel_currency) ? reconciliation.by_channel_currency : [];
  const counts = { manual_fact: 0, provider_auto: 0, missing: 0 };
  rows.forEach((row) => {
    const source = String(row.balanceSource || row.balance_source || "missing").trim();
    if (["derived_balance", "calculated_balance"].includes(source) && !Object.prototype.hasOwnProperty.call(counts, source)) counts[source] = 0;
    if (Object.prototype.hasOwnProperty.call(counts, source)) counts[source] += 1;
    else counts.missing += 1;
  });
  reconciliation.summary = {
    ...(reconciliation.summary || {}),
    balance_source_counts: counts,
    manual_fact_rows: counts.manual_fact,
    provider_auto_rows: counts.provider_auto,
    derived_balance_rows: counts.derived_balance || 0,
    calculated_balance_rows: counts.calculated_balance || 0,
    missing_fact_rows: counts.missing,
  };
  reconciliation.required_manual_fact_rows = rows
    .filter((row) => row.needsManualConfirmation || row.needs_manual_confirmation || String(row.balanceSource || row.balance_source || "") !== "manual_fact")
    .filter((row) => String(row.balanceSource || row.balance_source || "") !== "calculated_balance")
    .filter((row) => String(row.status || "") !== "no_data")
    .map((row) => buildRequiredManualFactRow(row, period));
}

function buildRequiredManualFactRow(row, period = {}) {
  const source = String(row.balanceSource || row.balance_source || "missing").trim() || "missing";
  return {
    sheet: MANUAL_BALANCE_SHEET_NAME,
    date: period.to || row.manual_provider_closing_balance_date || "",
    channel: row.channel || "",
    currency: row.currency || "",
    amount: null,
    amount_hint: source === "provider_auto" || source === "derived_balance" ? row.manual_provider_closing_balance : null,
    balanceSource: source,
    balance_source: source,
    needsManualConfirmation: true,
    needs_manual_confirmation: true,
    sourceSheet: row.sourceSheet || row.source_sheet || "",
    source_sheet: row.source_sheet || row.sourceSheet || "",
    sourceRow: row.sourceRow || row.source_row || null,
    source_row: row.source_row || row.sourceRow || null,
    status: row.status || "",
    reason: row.missing_fact_reason || row.diagnosis || "",
    action: source === "derived_balance"
      ? "Review derived PayPal balance, then enter factual balance in Остатки if manual confirmation is needed."
      : (source === "provider_auto"
      ? "Confirm provider auto balance, then enter the factual balance in Остатки."
      : "Enter factual manual/provider balance in Остатки."),
  };
}

function buildBalanceRowLookup(balanceRows = []) {
  const lookup = new Map();
  (balanceRows || []).forEach((row) => {
    const key = balanceDatedKey(row.date, row.channel || row.accountName || row.account, row.currency);
    if (!key) return;
    const existing = lookup.get(key);
    if (existing && compareBalanceSourcePriority(existing, row) <= 0) return;
    lookup.set(key, row);
  });
  return lookup;
}

function findSourceBalanceRow(row, lookup) {
  const date = row.manual_provider_closing_balance_date || "";
  const exactKey = balanceDatedKey(date, row.channel, row.currency);
  if (exactKey && lookup.has(exactKey)) return lookup.get(exactKey);
  return null;
}

function isStatusOnlyBalanceRow(row = {}) {
  const status = String(row.status || row.autoBalanceStatus || row.auto_balance_status || "").trim();
  const amount = String(row.balanceAmount ?? row.amount ?? "").trim();
  const amountUsd = String(row.usdAmount ?? row.amountUsd ?? row.amount_usd ?? "").trim();
  return Boolean(status && !["ok", "zero_balance"].includes(status) && !amount && !amountUsd);
}

function balanceDatedKey(date, channel, currency) {
  const normalizedDate = normalizeDate(date);
  const normalizedChannel = String(channel || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!normalizedDate || !normalizedChannel || !normalizedCurrency) return "";
  return [normalizedDate, normalizedChannel, normalizedCurrency].join("|");
}

function normalizeBalanceSource(row = {}, fallback = "manual_fact") {
  const text = [
    row.source,
    row.fact_source,
    row.provider,
    row.comment,
    row.sourceSheet,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/calculated_balance|calculated|расчетные остатки/.test(text)) return "calculated_balance";
  if (/paypal_manual_balance|paypal_manual_confirmed_balance|manual paypal balance|manual confirmed|manual fact/.test(text)) return "manual_fact";
  if (/paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed paypal balance/.test(text)) return "derived_balance";
  if (/auto snapshot|provider_auto|provider|wise|paypal|monobank|binance|privat|yoomoney/.test(text)) return "provider_auto";
  return fallback;
}

function compareBalanceSourcePriority(left, right) {
  return balanceSourcePriority(left) - balanceSourcePriority(right);
}

function balanceSourcePriority(row = {}) {
  if (isStatusOnlyBalanceRow(row)) return 4;
  const source = normalizeBalanceSource(row, "missing");
  if (source === "manual_fact") return 0;
  if (source === "provider_auto") return 1;
  if (source === "derived_balance") return 2;
  if (source === "calculated_balance") return 3;
  return 4;
}

function getDefaultSourceSheet(balanceSource) {
  if (balanceSource === "manual_fact") return MANUAL_BALANCE_SHEET_NAME;
  if (balanceSource === "provider_auto" || balanceSource === "derived_balance") return AUTO_BALANCE_SHEET_NAME;
  if (balanceSource === "calculated_balance") return "Расчетные Остатки";
  return "";
}

function resolvePlannedRows(repository) {
  const candidates = [
    repository?.plannedRows,
    repository?.planRows,
    repository?.plannedOperations,
    repository?.views?.plannedRows,
    repository?.views?.planRows,
    repository?.analytics?.plannedRows,
  ];
  for (const rows of candidates) {
    if (Array.isArray(rows) && rows.length) return rows;
  }
  return [];
}

function resolvePlannedSourceStatus(repository, plannedRows) {
  if (Array.isArray(plannedRows) && plannedRows.length) return "ok";
  return repository?.plannedSourceStatus === "available" ? "available" : "needs_verification";
}

async function loadRepository(repositoryLoader = loadManualRepositoryFromGoogleSheets) {
  try {
    return await repositoryLoader();
  } catch (error) {
    return {
      ok: false,
      warning: `Manual Google Sheets overlay failed: ${String(error?.message || error)}`,
    };
  }
}

async function loadAutoBalances(autoBalanceLoader = loadAutoBalanceRowsFromGoogleSheets) {
  try {
    return await autoBalanceLoader();
  } catch (error) {
    return {
      ok: false,
      balances: [],
      warnings: [`Auto balance sheet failed: ${String(error?.message || error)}`],
    };
  }
}

function parsePeriod(query = {}) {
  const period = String(query.period || "").trim();
  if (/^\d{4}-\d{2}$/.test(period)) {
    return { from: `${period}-01`, to: lastDayOfMonth(period) };
  }
  return {
    from: normalizeDate(query.from || query.startDate || query.dateFrom),
    to: normalizeDate(query.to || query.endDate || query.dateTo),
  };
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseMode(query = {}) {
  const mode = String(query.mode || query.dryRun || "").trim().toLowerCase();
  return {
    requested: mode || "dry_run",
    effective: "dry_run",
    dry_run: true,
    apply_available: false,
    apply_guard: "No Ledger or balance rows are modified by period-balance-reconciliation.",
  };
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  return "";
}

function lastDayOfMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function unique(values) {
  return [...new Set((values || []).map(toSafeWarning).filter(Boolean))];
}

function toSafeWarning(value) {
  return String(value || "")
    .replace(/service account credentials/gi, "service account access")
    .replace(/\bcredentials\b/gi, "access")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=._~-]+/gi, "Basic [redacted]")
    .replace(/access_token['":=\s]+[A-Za-z0-9._~+/-]+/gi, "access_token [redacted]")
    .replace(/refresh_token['":=\s]+[A-Za-z0-9._~+/-]+/gi, "refresh_token [redacted]")
    .trim();
}
