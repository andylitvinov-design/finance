import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import { mergeManualAndAutoBalances } from "../server/balance-snapshot-merge.js";
import {
  applyOwnerMayOpeningBalanceSeed,
  isSupersededOwnerMayOpeningBalanceKey,
} from "../server/may-2026-owner-opening-balances.js";
import { buildDailyCurrencyBalances } from "../server/daily-balance-engine.js";
import { buildBalanceCoverage } from "../server/balance-coverage-engine.js";
import {
  countMissingAmountNetRows,
  isExchangeMissingAmountUsdRow,
} from "../server/ledger-audit-helpers.js";

const PROJECT_NAME = "ezohata-incoming-ledger";
const PUBLIC_SUMMARY_ONLY_WARNING =
  "includeRows is disabled in Phase 1 public summary-only mode; raw and sanitized rows are not returned.";
const SOURCE_KEYS = [
  "manual",
  "fact",
  "paypal",
  "paypal_manual",
  "paypal_personal_manual",
  "wise",
  "monobank",
  "privatbank",
  "td_bank",
  "yoomoney",
  "binance",
  "migration",
  "unknown",
];

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  const snapshot = await buildAuditSnapshot({
    query: request.query || {},
    repositoryLoader: loadManualRepositoryFromGoogleSheets,
  });
  return response.status(200).json(snapshot);
}

export async function buildAuditSnapshot(options = {}) {
  const query = options.query || {};
  const generatedAt = new Date().toISOString();
  const periodFilter = parsePeriodFilter(query);
  const includeRowsRequested = parseBoolean(query.includeRows);
  const warnings = [];
  const auditChecks = [];

  if (includeRowsRequested) warnings.push(PUBLIC_SUMMARY_ONLY_WARNING);

  const repository = await loadRepository(options.repositoryLoader);
  if (!repository.ok) {
    warnings.push("needs verification: manual Google Sheets read access is unavailable.");
    if (repository.warning) warnings.push(toSafeWarning(repository.warning));
    auditChecks.push({
      name: "manual_google_sheets_access",
      status: "needs verification",
      message: "Audit snapshot could not read live ledger data.",
    });
    const snapshot = emptySnapshot({ generatedAt, period: periodFilter.period, warnings, auditChecks });
    return isHandoffMode(query) ? compactAuditSnapshotForHandoff(snapshot) : snapshot;
  }

  const operations = filterOperations(repository.operations || [], periodFilter);
  const period = resolvePeriod(periodFilter, operations);
  const schema = buildSchema(repository);
  const summary = buildSummary(operations, repository);
  const balanceResult = buildBalances(operations);
  const manualBalanceRows = Array.isArray(repository.balances) ? repository.balances : [];
  const autoBalanceRows = Array.isArray(repository.autoBalances) ? repository.autoBalances : [];
  const balanceSnapshotMerge = mergeManualAndAutoBalances(manualBalanceRows, autoBalanceRows);
  const ownerMayOpeningSeed = applyOwnerMayOpeningBalanceSeed(balanceSnapshotMerge.rows || balanceSnapshotMerge.merged || [], {
    operations,
    period,
  });
  const balanceRows = ownerMayOpeningSeed.rows;
  const periodDailyBalanceResult = buildDailyCurrencyBalances(operations, balanceRows);
  const dailyBalanceResult = filterDailyBalanceResult(
    buildDailyCurrencyBalances(repository.operations || [], balanceRows),
    periodFilter,
    periodDailyBalanceResult.summary.excluded_missing_amount_net_rows
  );
  const balanceCoverage = buildBalanceCoverage(dailyBalanceResult);
  const paypal = buildPayPalSummary(operations);
  const exchange = buildExchangeSummary(operations);
  const sources = buildSourcesSummary(operations);
  const balanceFixes = buildBalanceFixes(operations, balanceCoverage);
  const weeklyBalanceSummary = buildWeeklyBalanceSummary({
    period,
    balanceCoverage,
    balanceFixes,
    balanceResult,
    dailyBalanceResult,
  });

  warnings.push(...(repository.warnings || []).map(toSafeWarning).filter(Boolean));
  warnings.push(...ownerMayOpeningSeed.warnings);
  warnings.push(...balanceResult.warnings);
  warnings.push(...paypal.warnings);
  warnings.push(...exchange.warnings);
  warnings.push(...buildSourceWarnings(sources, summary.ledger_rows));
  warnings.push(...buildAnalyticsWarnings(repository));

  auditChecks.push(
    {
      name: "ledger_contract",
      status: schema.ledger_contract === "v2-compatible" ? "ok" : "needs verification",
      message: `Ledger schema reported as ${repository.schema || "unknown"}.`,
    },
    {
      name: "balance_amount_source",
      status: balanceResult.missing_amount_net_rows ? "needs verification" : "ok",
      message: balanceResult.missing_amount_net_rows
        ? "Some balance rows are excluded because amount_net is missing."
        : "Balance uses amount_net-compatible normalized ledger values.",
    },
    {
      name: "balance_coverage",
      status: balanceCoverage.summary.mismatch || balanceCoverage.summary.missing_opening_balance || balanceCoverage.summary.missing_provider_balance || balanceCoverage.summary.needs_verification
        ? "needs verification"
        : "ok",
      message: balanceCoverage.summary.accounts_with_movement
        ? `Balance coverage: ${balanceCoverage.summary.fully_reconciled_accounts}/${balanceCoverage.summary.accounts_with_movement} account-currency rows reconciled.`
        : "No account-currency movement rows found for the selected period.",
    },
    {
      name: "paypal_permissions",
      status: paypal.permission_status,
      message: "Live PayPal Transaction Search permissions are not exercised by the public audit snapshot.",
    },
    {
      name: "analytics_source",
      status: repository.views ? "ok" : "needs verification",
      message: repository.views
        ? "Analytics-compatible views are derived from normalized ledger operations."
        : "Analytics source normalization needs verification.",
    }
  );

  const snapshot = {
    ok: true,
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period,
    schema,
    summary,
    balances: {
      by_channel: balanceResult.by_channel,
      total_usd: balanceResult.total_usd,
      uses_amount_net: true,
      fallback_amount_rows: balanceResult.fallback_amount_rows,
      missing_amount_net_rows: balanceResult.missing_amount_net_rows,
      excluded_missing_amount_net_rows: balanceResult.excluded_missing_amount_net_rows,
      manual_balance_rows: manualBalanceRows.length,
      auto_balance_rows: autoBalanceRows.length,
      merged_balance_rows: balanceRows.length,
      owner_confirmed_may_opening_balance_seed_applied: ownerMayOpeningSeed.applied,
      owner_confirmed_may_opening_total_usd: ownerMayOpeningSeed.applied ? ownerMayOpeningSeed.owner_total_usd : null,
      ...(ownerMayOpeningSeed.applied ? {
        owner_input_opening_total_usd: ownerMayOpeningSeed.reconciliation_adjusted_opening?.owner_input_opening_total_usd ?? null,
        reconciliation_adjusted_opening_total_usd: ownerMayOpeningSeed.reconciliation_adjusted_opening?.reconciliation_adjusted_opening_total_usd ?? null,
        diff_from_owner_input_total_usd: ownerMayOpeningSeed.reconciliation_adjusted_opening?.diff_from_owner_input_total_usd ?? null,
        reconciliation_adjusted_opening: ownerMayOpeningSeed.reconciliation_adjusted_opening,
        adjusted_rows: ownerMayOpeningSeed.reconciliation_adjusted_opening?.adjusted_rows || [],
        needs_verification_rows: ownerMayOpeningSeed.reconciliation_adjusted_opening?.needs_verification_rows || [],
        pending_movement_verification_rows: ownerMayOpeningSeed.reconciliation_adjusted_opening?.pending_movement_verification_rows || [],
        paypal_movement_diagnostics: ownerMayOpeningSeed.reconciliation_adjusted_opening?.paypal_movement_diagnostics || [],
      } : {}),
      auto_balance_rows_used_as_fallback: balanceSnapshotMerge.autoUsed ?? balanceSnapshotMerge.auto_balance_rows_used_as_fallback ?? null,
      auto_balance_rows_ignored_due_to_manual: balanceSnapshotMerge.autoIgnored ?? balanceSnapshotMerge.auto_balance_rows_ignored_due_to_manual ?? null,
      auto_balance_rows_ignored_as_stale_current: balanceSnapshotMerge.autoIgnoredStaleCurrent ?? balanceSnapshotMerge.auto_balance_rows_ignored_as_stale_current ?? null,
      remainders_rows: buildRemaindersRows(balanceCoverage.accounts || [], {
        balanceRows,
        period,
        operations,
        ownerMayOpeningSeedApplied: ownerMayOpeningSeed.applied,
      }),
    },
    daily_balances: {
      uses_amount_net: true,
      rows: dailyBalanceResult.rows,
      actionable_rows: dailyBalanceResult.actionable_rows,
      summary: dailyBalanceResult.summary,
    },
    balance_coverage: {
      ...balanceCoverage,
      weekly_summary: weeklyBalanceSummary,
    },
    balance_fixes: balanceFixes,
    paypal,
    exchange: omitInternalWarnings(exchange),
    sources,
    warnings: unique(warnings),
    audit_checks: auditChecks,
  };
  return isHandoffMode(query) ? compactAuditSnapshotForHandoff(snapshot) : snapshot;
}

export function compactAuditSnapshotForHandoff(snapshot = {}) {
  const omittedPaths = [];
  const dailyBalances = snapshot.daily_balances || {};
  const balanceCoverage = snapshot.balance_coverage || {};
  const balanceFixes = snapshot.balance_fixes || {};
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];

  if (Object.prototype.hasOwnProperty.call(dailyBalances, "rows")) omittedPaths.push("daily_balances.rows");
  if (Object.prototype.hasOwnProperty.call(balanceCoverage, "accounts")) omittedPaths.push("balance_coverage.accounts");
  if (balanceCoverage.weekly_summary?.copyable_ostatki_rows) {
    omittedPaths.push("balance_coverage.weekly_summary.copyable_ostatki_rows");
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "balance_fixes")) omittedPaths.push("balance_fixes");
  if (warnings.length > 20) omittedPaths.push("warnings[20..]");

  return {
    ok: snapshot.ok,
    generated_at: snapshot.generated_at,
    project: snapshot.project,
    period: snapshot.period,
    schema: snapshot.schema,
    summary: snapshot.summary,
    balances: snapshot.balances,
    daily_balances: {
      uses_amount_net: dailyBalances.uses_amount_net,
      summary: dailyBalances.summary,
      actionable_rows: (dailyBalances.actionable_rows || []).slice(0, 10).map(compactActionableRow),
    },
    balance_coverage: {
      summary: balanceCoverage.summary,
      weekly_summary: compactWeeklyBalanceSummary(balanceCoverage.weekly_summary),
      actionable_accounts: (balanceCoverage.actionable_accounts || []).slice(0, 10).map(compactActionableRow),
    },
    paypal: snapshot.paypal,
    exchange: snapshot.exchange,
    sources: snapshot.sources,
    warnings: warnings.slice(0, 20),
    audit_checks: snapshot.audit_checks,
    audit_handoff: {
      compact: true,
      mode: "handoff",
      omitted_paths: omittedPaths,
      source_size_bytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
      balance_fixes_summary: {
        missing_amount_net_rows: Array.isArray(balanceFixes.missing_amount_net_rows)
          ? balanceFixes.missing_amount_net_rows.length
          : 0,
        missing_opening_balance_rows: Array.isArray(balanceFixes.missing_opening_balance_rows)
          ? balanceFixes.missing_opening_balance_rows.length
          : 0,
        missing_ostatki_rows: Array.isArray(balanceFixes.missing_ostatki_rows)
          ? balanceFixes.missing_ostatki_rows.length
          : 0,
      },
    },
  };
}

function compactWeeklyBalanceSummary(weeklySummary = {}) {
  return {
    ...weeklySummary,
    actionable_accounts: (weeklySummary.actionable_accounts || []).slice(0, 10).map(compactActionableRow),
    copyable_ostatki_rows: weeklySummary.copyable_ostatki_rows
      ? "[omitted in handoff mode]"
      : weeklySummary.copyable_ostatki_rows,
  };
}

function isHandoffMode(query = {}) {
  return String(query.mode || "").trim().toLowerCase() === "handoff";
}

function compactActionableRow(row = {}) {
  return {
    date: row.date,
    channel: row.channel,
    currency: row.currency,
    status: row.status,
    opening_balance: row.opening_balance,
    movement_amount: row.movement_amount,
    expected_closing_balance: row.expected_closing_balance,
    provider_balance: row.provider_balance,
    closing_balance: row.closing_balance,
    difference: row.difference,
    action: row.action,
    reason: row.reason,
  };
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

function emptySnapshot({ generatedAt, period, warnings, auditChecks }) {
  return {
    ok: true,
    generated_at: generatedAt,
    project: PROJECT_NAME,
    period,
    schema: {
      ledger_contract: "v2-compatible",
      sheet_layout: "v1-compatible",
      source_of_truth: "ledger",
      physical_sheet_migration: false,
    },
    summary: {
      ledger_rows: 0,
      income_rows: 0,
      expense_rows: 0,
      transfer_rows: 0,
      exchange_rows: 0,
      unknown_source_rows: 0,
    },
    balances: {
      by_channel: [],
      total_usd: null,
      uses_amount_net: true,
      fallback_amount_rows: 0,
      missing_amount_net_rows: 0,
      excluded_missing_amount_net_rows: 0,
      manual_balance_rows: 0,
      auto_balance_rows: 0,
      merged_balance_rows: 0,
      auto_balance_rows_used_as_fallback: null,
      auto_balance_rows_ignored_due_to_manual: null,
      auto_balance_rows_ignored_as_stale_current: null,
      remainders_rows: [],
    },
    daily_balances: {
      uses_amount_net: true,
      rows: [],
      actionable_rows: [],
      summary: {
        rows: 0,
        mismatch_rows: 0,
        missing_opening_balance_rows: 0,
        missing_provider_balance_rows: 0,
        excluded_missing_amount_net_rows: 0,
        status_counts: {
          ok: 0,
          mismatch: 0,
          missing_opening_balance: 0,
          missing_provider_balance: 0,
          needs_verification: 0,
        },
      },
    },
    balance_coverage: {
      ...buildBalanceCoverage({
        rows: [],
        summary: { excluded_missing_amount_net_rows: 0 },
      }),
      weekly_summary: {
        period,
        status: "ok",
        accounts_checked: 0,
        fully_reconciled: 0,
        mismatch: 0,
        missing_opening_balance: 0,
        missing_provider_balance: 0,
        needs_verification: 0,
        missing_amount_net_rows: 0,
        excluded_missing_amount_net_rows: 0,
        actionable_accounts: [],
        copyable_ostatki_rows: "",
      },
    },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_opening_balance_rows: [],
      missing_ostatki_rows: [],
      copyable_ostatki_rows: "",
    },
    paypal: {
      rows: 0,
      gross_total_usd: null,
      fee_total_usd: null,
      net_total_usd: null,
      missing_counterparty_rows: 0,
      permission_status: "needs verification",
    },
    exchange: {
      rows: 0,
      missing_amount_usd_rows: 0,
      total_out_usd: null,
      total_in_usd: null,
      compatibility_mode: true,
    },
    sources: Object.fromEntries(SOURCE_KEYS.map((key) => [key, 0])),
    warnings: unique(warnings),
    audit_checks: auditChecks,
  };
}

function buildWeeklyBalanceSummary({
  period,
  balanceCoverage,
  balanceFixes,
  balanceResult,
  dailyBalanceResult,
}) {
  const coverageSummary = balanceCoverage?.summary || {};
  const missingAmountNetRows = Number(balanceResult?.missing_amount_net_rows || 0);
  const excludedMissingAmountNetRows = Number(
    dailyBalanceResult?.summary?.excluded_missing_amount_net_rows ??
      coverageSummary.excluded_missing_amount_net_rows ??
      0
  );
  const mismatch = Number(coverageSummary.mismatch || 0);
  const missingOpeningBalance = Number(coverageSummary.missing_opening_balance || 0);
  const missingProviderBalance = Number(coverageSummary.missing_provider_balance || 0);
  const needsVerification = Number(coverageSummary.needs_verification || 0);
  const failed = mismatch || missingAmountNetRows || excludedMissingAmountNetRows;
  const incomplete = missingOpeningBalance || missingProviderBalance || needsVerification;

  return {
    period,
    status: failed ? "failed" : incomplete ? "needs_verification" : "ok",
    accounts_checked: Number(coverageSummary.accounts_with_movement || 0),
    fully_reconciled: Number(coverageSummary.fully_reconciled_accounts || 0),
    mismatch,
    missing_opening_balance: missingOpeningBalance,
    missing_provider_balance: missingProviderBalance,
    needs_verification: needsVerification,
    missing_amount_net_rows: missingAmountNetRows,
    excluded_missing_amount_net_rows: excludedMissingAmountNetRows,
    actionable_accounts: balanceCoverage?.actionable_accounts || [],
    copyable_ostatki_rows: String(balanceFixes?.copyable_ostatki_rows || ""),
  };
}

function buildRemaindersRows(accounts = [], options = {}) {
  const grouped = new Map();
  for (const anchor of buildRemaindersOpeningAnchors(options.balanceRows || [], options.period || {})) {
    addRemaindersGroupedRow(grouped, {
      date: anchor.date,
      channel: anchor.channel,
      currency: anchor.currency,
      opening_amount_usd: anchor.opening_amount_usd,
      closing_amount_usd: null,
      status: anchor.opening_amount_usd === null ? "needs_verification" : "ok",
      source: anchor.source,
      inclusion_source: "opening_anchor",
      movement_usd: null,
      movement_usd_safe: false,
      movement_usd_reason: "missing_ledger_movement",
      computed_balance: false,
      factual_provider_balance: true,
      opening_anchor: true,
    });
  }
  for (const anchor of buildRemaindersClosingAnchors(options.balanceRows || [], options.period || {})) {
    addRemaindersGroupedRow(grouped, {
      date: anchor.date,
      channel: anchor.channel,
      currency: anchor.currency,
      opening_amount_usd: null,
      closing_amount_usd: anchor.closing_amount_usd,
      status: anchor.closing_amount_usd === null ? "needs_verification" : "ok",
      source: anchor.source,
      inclusion_source: "closing_anchor",
      movement_usd: null,
      movement_usd_safe: false,
      movement_usd_reason: "missing_ledger_movement",
      computed_balance: false,
      factual_provider_balance: true,
      closing_anchor: true,
    });
  }
  for (const movement of buildRemaindersLedgerMovementRows(options.operations || [])) {
    addRemaindersGroupedRow(grouped, movement);
  }
  for (const account of accounts || []) {
    const channel = String(account?.channel || "").trim();
    const currency = String(account?.currency || "").trim().toUpperCase();
    if (!channel || !currency) continue;
    if (options.ownerMayOpeningSeedApplied && isSupersededOwnerMayOpeningBalanceKey(channel, currency)) continue;
    addRemaindersGroupedRow(grouped, {
      date: account.date,
      channel,
      currency,
      opening_amount_usd: nullableRound(account.opening_amount_usd ?? account.openingUsd),
      closing_amount_usd: nullableRound(account.closing_amount_usd ?? account.closingUsd),
      status: account.status || "needs_verification",
      source: account.source || account.balance_source || "balance_coverage.accounts",
      inclusion_source: "balance_coverage",
      movement_usd: normalizeRemaindersCoverageMovementUsd(account),
      movement_usd_safe: account.movement_usd_safe === true && normalizeRemaindersCoverageMovementUsd(account) !== null,
      movement_usd_reason: account.movement_usd_reason || "missing_movement_usd",
      computed_balance: account.computed_balance === true,
      factual_provider_balance: account.factual_provider_balance === false ? false : account.computed_balance !== true,
    });
  }

  return Array.from(grouped.values())
    .map((rows) => {
      rows.sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
      const first = rows[0] || {};
      const last = rows.at(-1) || {};
      const openingRow = rows.find((row) => row.opening_amount_usd !== null && row.opening_amount_usd !== undefined) || {};
      const closingRow = rows.toReversed().find((row) => row.closing_amount_usd !== null && row.closing_amount_usd !== undefined) || {};
      const openingUsd = openingRow.opening_amount_usd ?? null;
      const closingUsd = closingRow.closing_amount_usd ?? null;
      const movementStatus = summarizeRemaindersMovement(rows);
      const plannedClosingUsd = openingUsd !== null && movementStatus.safe
        ? round(openingUsd + movementStatus.movement_usd)
        : null;
      const complete = openingUsd !== null && closingUsd !== null;
      const computed = rows.some((row) => row.computed_balance === true);
      const computedSource = rows.find((row) => row.computed_balance === true && row.source)?.source || "computed_from_opening_and_ledger";
      const inclusionSource = summarizeRemaindersInclusionSource(rows);
      return {
        channel: first.channel || last.channel || "",
        currency: first.currency || last.currency || "",
        opening_amount_usd: openingUsd,
        closing_amount_usd: closingUsd,
        delta_amount_usd: complete ? round(closingUsd - openingUsd) : null,
        movement_usd: movementStatus.safe ? movementStatus.movement_usd : null,
        planned_closing_amount_usd: plannedClosingUsd,
        planned_balance_computed: plannedClosingUsd !== null,
        planned_balance_source: plannedClosingUsd !== null ? "computed_from_opening_plus_ledger_movement" : "needs_verification",
        planned_balance_reason: buildPlannedBalanceReason({ openingUsd, movementStatus, plannedClosingUsd }),
        openingUsd,
        closingUsd,
        deltaUsd: complete ? round(closingUsd - openingUsd) : null,
        status: complete ? "ok" : "needs_verification",
        source: computed ? computedSource : (first.opening_anchor ? first.source : "balance_coverage.accounts"),
        inclusion_source: inclusionSource,
        period_start_date: first.date || "",
        period_end_date: last.date || "",
        row_count: rows.length,
        needs_verification: !complete,
        ...buildRemaindersVerificationContext({ first, last, complete }),
        ...(computed ? {
          computed_balance: true,
          factual_provider_balance: false,
        } : {}),
      };
    })
    .sort((left, right) => {
      if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
      return left.currency.localeCompare(right.currency);
    });
}

function addRemaindersGroupedRow(grouped, row) {
  const channel = String(row?.channel || "").trim();
  const currency = String(row?.currency || "").trim().toUpperCase();
  if (!channel || !currency) return;
  const key = makeRemaindersKey(channel, currency);
  const normalized = { ...row, channel, currency };
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(normalized);
}

function makeRemaindersKey(channel, currency) {
  return `${normalizeRemaindersChannel(channel)}|${String(currency || "").trim().toUpperCase()}`;
}

function normalizeRemaindersChannel(channel) {
  return String(channel || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function summarizeRemaindersInclusionSource(rows = []) {
  const priority = [
    "opening_anchor",
    "ledger_movement",
    "income_channel",
    "closing_anchor",
    "balance_coverage",
  ];
  const sources = new Set(rows.map((row) => row.inclusion_source).filter(Boolean));
  return priority.find((source) => sources.has(source)) || "balance_coverage";
}

function normalizeRemaindersCoverageMovementUsd(account = {}) {
  const movementUsd = nullableRound(account.movement_usd);
  if (movementUsd === null) return null;
  const netChange = parseNumber(account.net_change);
  if (netChange !== null && netChange < 0) return -Math.abs(movementUsd);
  return movementUsd;
}

function summarizeRemaindersMovement(rows = []) {
  const coverageRows = rows.filter((row) => row.inclusion_source === "balance_coverage");
  const ledgerRows = rows.filter((row) => row.inclusion_source === "ledger_movement");
  const unsafeAmountNet = coverageRows.some((row) => row.movement_usd_reason === "missing_amount_net");
  const coverageHasUnsafeMovement = coverageRows.some((row) => row.movement_usd_safe !== true);
  const coverageHasCompleteAnchors = coverageRows.some((row) =>
    (row.opening_amount_usd !== null || row.openingUsd !== null) &&
    (row.closing_amount_usd !== null || row.closingUsd !== null)
  );
  const movementRows = coverageHasUnsafeMovement
    ? coverageRows
    : coverageRows.some((row) => row.movement_usd_safe === true) && (coverageHasCompleteAnchors || !ledgerRows.length)
      ? coverageRows
      : ledgerRows;
  if (!movementRows.length) {
    return { safe: true, movement_usd: 0, reason: "zero_safe_ledger_movement" };
  }
  if (!ledgerRows.length && !unsafeAmountNet) {
    const onlyMissingMovement = movementRows.every((row) =>
      row.movement_usd_safe !== true &&
        (row.movement_usd === null || row.movement_usd === undefined) &&
        (!row.movement_usd_reason || row.movement_usd_reason === "missing_movement_usd" || row.movement_usd_reason === "missing_ledger_movement")
    );
    if (onlyMissingMovement) return { safe: true, movement_usd: 0, reason: "zero_safe_ledger_movement" };
  }
  let total = 0;
  for (const row of movementRows) {
    if (row.movement_usd_safe !== true || row.movement_usd === null || row.movement_usd === undefined) {
      return { safe: false, movement_usd: null, reason: row.movement_usd_reason || "missing_movement_usd" };
    }
    total += Number(row.movement_usd);
  }
  return { safe: true, movement_usd: round(total), reason: "amount_net_ledger_movement" };
}

function buildPlannedBalanceReason({ openingUsd, movementStatus, plannedClosingUsd }) {
  if (openingUsd === null) return "needs_verification: missing opening_amount_usd";
  if (plannedClosingUsd !== null && movementStatus?.reason === "zero_safe_ledger_movement") {
    return "opening_amount_usd + zero safe ledger movement";
  }
  if (plannedClosingUsd !== null) return "opening_amount_usd + amount_net ledger movement";
  if (!movementStatus.safe) return `needs_verification: ${movementStatus.reason || "missing movement_usd"}`;
  return "needs_verification";
}

function buildRemaindersOpeningAnchors(balanceRows = [], period = {}) {
  const from = normalizeDate(period.from);
  if (!from) return [];
  const isFirstDayOfMonth = /^\d{4}-\d{2}-01$/.test(from);
  const priorKeys = new Set();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    if (!date || date >= from) continue;
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    if (channel && currency) priorKeys.add(makeRemaindersKey(channel, currency));
  }
  const anchors = new Map();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    if (date !== from) continue;
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    if (!channel || !currency) continue;
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    const key = makeRemaindersKey(channel, currency);
    if (!isFirstDayOfMonth && priorKeys.has(key)) continue;
    const anchor = {
      key,
      date,
      channel,
      currency,
      opening_amount_usd: nullableRound(resolveRemaindersSnapshotUsdAmount(row, amount, currency)),
      source: getRemaindersAnchorSource(row),
      priority: getRemaindersAnchorPriority(row),
    };
    const existing = anchors.get(key);
    if (!existing || anchor.priority < existing.priority) anchors.set(key, anchor);
  }
  return Array.from(anchors.values()).sort((left, right) => {
    if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
    return left.currency.localeCompare(right.currency);
  });
}

function buildRemaindersClosingAnchors(balanceRows = [], period = {}) {
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  if (!from || !to) return [];
  const anchors = new Map();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    if (!date || date <= from || date > to) continue;
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    if (!channel || !currency) continue;
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    const key = makeRemaindersKey(channel, currency);
    const anchor = {
      key,
      date,
      channel,
      currency,
      closing_amount_usd: nullableRound(resolveRemaindersSnapshotUsdAmount(row, amount, currency)),
      source: getRemaindersAnchorSource(row),
      priority: getRemaindersAnchorPriority(row),
    };
    const existing = anchors.get(key);
    if (
      !existing ||
      anchor.date > existing.date ||
      (anchor.date === existing.date && anchor.priority < existing.priority)
    ) {
      anchors.set(key, anchor);
    }
  }
  return Array.from(anchors.values()).sort((left, right) => {
    if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
    return left.currency.localeCompare(right.currency);
  });
}

function buildRemaindersLedgerMovementRows(operations = []) {
  const grouped = new Map();
  for (const operation of operations || []) {
    for (const movement of getRemaindersOperationMovements(operation)) {
      const channel = String(movement.channel || "").trim();
      const currency = String(movement.currency || "").trim().toUpperCase();
      if (!channel || !currency) continue;
      const key = makeRemaindersKey(channel, currency);
      const existing = grouped.get(key) || {
        date: movement.date,
        channel,
        currency,
        opening_amount_usd: null,
        closing_amount_usd: null,
        status: "needs_verification",
        source: "ledger_movement",
        inclusion_source: "ledger_movement",
        movement_usd: 0,
        movement_usd_safe: true,
        movement_usd_reason: "amount_usd_ledger_movement",
        computed_balance: false,
        factual_provider_balance: false,
      };
      existing.date = [existing.date, movement.date].filter(Boolean).sort()[0] || "";
      existing.movement_usd += movement.movement_usd;
      grouped.set(key, existing);
    }
  }
  return Array.from(grouped.values()).map((row) => ({
    ...row,
    movement_usd: round(row.movement_usd),
  }));
}

function getRemaindersOperationMovements(row = {}) {
  const ledger = row?.ledgerV2 || {};
  const operation = String(ledger.operation || row?.operation || "").trim().toLowerCase();
  const date = normalizeDate(ledger.date || row?.date);
  const currency = String(ledger.currency || row?.currency || "").trim().toUpperCase();
  const from = String(ledger.from_channel || row?.fromChannel || row?.from_channel || "").trim();
  const to = String(ledger.to_channel || row?.toChannel || row?.to_channel || row?.payment_channel || row?.paymentChannel || "").trim();
  const fallback = String(row?.channel || row?.accountName || row?.account || "").trim();
  const amountUsd = parseNumber(ledger.amount_usd ?? row?.amountUsd ?? row?.amount_usd);
  if (!date || !currency || amountUsd === null) return [];
  if (operation === "income" || operation === "exchange_in") {
    return [{ date, channel: to || fallback, currency, movement_usd: Math.abs(amountUsd) }];
  }
  if (["expense", "business_expense", "personal_expense", "exchange_out"].includes(operation)) {
    return [{ date, channel: from || fallback, currency, movement_usd: -Math.abs(amountUsd) }];
  }
  if (operation === "transfer" || operation === "partner_transfer") {
    const balanceAmount = parseNumber(ledger.balance_amount ?? row?.balanceAmount);
    if (balanceAmount !== null) {
      return [{
        date,
        channel: balanceAmount < 0 ? (from || fallback) : (to || fallback || from),
        currency,
        movement_usd: balanceAmount < 0 ? -Math.abs(amountUsd) : Math.abs(amountUsd),
      }];
    }
    return [
      { date, channel: from || fallback, currency, movement_usd: -Math.abs(amountUsd) },
      { date, channel: to, currency, movement_usd: Math.abs(amountUsd) },
    ];
  }
  return [{ date, channel: fallback || to || from, currency, movement_usd: amountUsd }];
}

function resolveRemaindersSnapshotUsdAmount(row = {}, amount = null, currency = "") {
  const explicit = parseNumber(
    row?.amount_usd ??
      row?.amountUsd ??
      row?.usdAmount ??
      row?.balance_usd ??
      row?.balanceUsd
  );
  if (explicit !== null) return explicit;
  const numericAmount = amount === null || amount === undefined ? parseNumber(row?.balanceAmount ?? row?.amount) : amount;
  if (numericAmount === null) return null;
  const rate = parseNumber(row?.rate ?? row?.usdRate ?? row?.usd_rate);
  if (rate !== null && rate > 0) return numericAmount * rate;
  if (["USD", "USDT", "USDC"].includes(String(currency || row?.currency || "").trim().toUpperCase())) return numericAmount;
  return null;
}

function getRemaindersAnchorSource(row = {}) {
  const sheet = String(row?.sourceSheet || row?.source_sheet || "").trim();
  const source = String(row?.source || row?.balanceSource || row?.balance_source || row?.fact_source || "").trim();
  if (/Остатки/i.test(sheet) || /manual_fact|manual/i.test(source)) return "manual_may_opening_anchor";
  if (/Авто Остатки/i.test(sheet) || /provider|auto/i.test(source)) return "auto_may_opening_anchor";
  return "period_start_balance_anchor";
}

function getRemaindersAnchorPriority(row = {}) {
  const source = getRemaindersAnchorSource(row);
  if (source === "manual_may_opening_anchor") return 0;
  if (source === "auto_may_opening_anchor") return 1;
  return 2;
}

function buildRemaindersVerificationContext({ first = {}, last = {}, complete = false } = {}) {
  if (complete) return {};
  const currency = String(first.currency || last.currency || "").trim().toUpperCase();
  if (currency !== "RUB") {
    return {
      needs_verification_reason: "missing_opening_or_closing_anchor",
    };
  }
  return {
    needs_verification_reason: "missing_usd_rate_or_amount_usd",
    fix_action: "Add a trusted rate or amount_usd for the factual RUB anchor date; native RUB alone is not enough for USD remainders.",
  };
}

function nullableRound(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? round(numeric) : null;
}

function parsePeriodFilter(query = {}) {
  const period = String(query.period || "").trim();
  const range = period.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    return {
      from: range[1],
      to: range[2],
      period: { from: range[1], to: range[2] },
    };
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    return {
      from: `${period}-01`,
      to: lastDayOfMonth(period),
      period: { from: `${period}-01`, to: lastDayOfMonth(period) },
    };
  }
  const from = normalizeDate(query.from || query.startDate || query.dateFrom);
  const to = normalizeDate(query.to || query.endDate || query.dateTo);
  return {
    from,
    to,
    period: {
      from: from || "needs verification",
      to: to || "needs verification",
    },
  };
}

function resolvePeriod(periodFilter, operations) {
  if (periodFilter.from || periodFilter.to) return periodFilter.period;
  const dates = (operations || []).map((row) => normalizeDate(row?.date)).filter(Boolean).sort();
  return {
    from: dates[0] || "needs verification",
    to: dates.at(-1) || "needs verification",
  };
}

function filterOperations(operations, periodFilter) {
  return (operations || []).filter((row) => {
    const date = normalizeDate(row?.date);
    if (!date) return false;
    if (periodFilter.from && date < periodFilter.from) return false;
    if (periodFilter.to && date > periodFilter.to) return false;
    return true;
  });
}

function filterDailyBalanceResult(result, periodFilter, excludedMissingAmountNetRows = 0) {
  const rows = (result?.rows || []).filter((row) => {
    const date = normalizeDate(row?.date);
    if (!date) return false;
    if (periodFilter.from && date < periodFilter.from) return false;
    if (periodFilter.to && date > periodFilter.to) return false;
    return true;
  });
  const status_counts = buildDailyBalanceStatusCounts(rows);
  return {
    rows,
    actionable_rows: buildDailyBalanceActionableRows(rows),
    summary: {
      rows: rows.length,
      mismatch_rows: status_counts.mismatch,
      missing_opening_balance_rows: status_counts.missing_opening_balance,
      missing_provider_balance_rows: status_counts.missing_provider_balance,
      missing_amount_net_rows: status_counts.missing_amount_net,
      computed_between_confirmed_anchor_rows: status_counts.computed_between_confirmed_anchors,
      excluded_missing_amount_net_rows: Number(excludedMissingAmountNetRows || 0),
      status_counts,
    },
  };
}

function buildDailyBalanceStatusCounts(rows) {
  const counts = {
    ok: 0,
    computed_between_confirmed_anchors: 0,
    mismatch: 0,
    missing_opening_balance: 0,
    missing_provider_balance: 0,
    missing_amount_net: 0,
    needs_verification: 0,
  };
  for (const row of rows || []) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }
  return counts;
}

function buildDailyBalanceActionableRows(rows) {
  const priority = {
    mismatch: 0,
    needs_verification: 1,
    missing_opening_balance: 2,
    missing_provider_balance: 3,
    missing_amount_net: 4,
  };
  return (rows || [])
    .filter((row) => row.status && !["ok", "computed_between_confirmed_anchors"].includes(row.status))
    .sort((left, right) => {
      const leftPriority = priority[left.status] ?? 99;
      const rightPriority = priority[right.status] ?? 99;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
      return left.currency.localeCompare(right.currency);
    })
    .slice(0, 10);
}

function buildSchema(repository) {
  const schema = String(repository?.schema || "");
  return {
    ledger_contract: /^ledger-v[12]|ledger-v2-compatible/.test(schema) ? "v2-compatible" : "needs verification",
    sheet_layout: schema === "ledger-v2-compatible" ? "v2-compatible" : "v1-compatible",
    source_of_truth: "ledger",
    physical_sheet_migration: false,
  };
}

function buildSummary(operations, repository) {
  const counts = {
    ledger_rows: operations.length,
    income_rows: 0,
    expense_rows: 0,
    transfer_rows: 0,
    exchange_rows: 0,
    unknown_source_rows: 0,
  };
  for (const row of operations) {
    const operation = getV2Operation(row);
    if (operation === "income") counts.income_rows += 1;
    else if (operation === "expense") counts.expense_rows += 1;
    else if (operation === "transfer") counts.transfer_rows += 1;
    else if (operation === "exchange") counts.exchange_rows += 1;
    if (normalizeSource(row) === "unknown") counts.unknown_source_rows += 1;
  }
  counts.expense_rows += Array.isArray(repository?.commissionRows) ? repository.commissionRows.length : 0;
  counts.transfer_rows += Array.isArray(repository?.transfers) ? repository.transfers.length : 0;
  counts.exchange_rows += (operations || []).filter((row) => isExchangeRow(row)).length - counts.exchange_rows;
  return counts;
}

function buildBalances(operations) {
  const grouped = new Map();
  const warnings = [];
  const missingAmountNetRows = countMissingAmountNetRows(operations);
  let excludedMissingAmountNetRows = 0;
  let totalUsd = 0;
  let hasTotalUsd = false;

  for (const row of operations) {
    const ledger = row?.ledgerV2 || {};
    if (!String(ledger.amount_net ?? row.amountNet ?? "").trim()) {
      excludedMissingAmountNetRows += 1;
      continue;
    }
    const balanceAmount = parseNumber(ledger.balance_amount ?? row.balanceAmount);
    if (balanceAmount === null) continue;
    const channel = getBalanceChannel(row, balanceAmount);
    if (!channel) continue;
    const existing = grouped.get(channel) || { channel, balance_amount: 0, balance_usd: 0, rows: 0 };
    existing.balance_amount += balanceAmount;
    existing.rows += 1;
    const usd = parseNumber(ledger.amount_usd ?? row.amountUsd);
    if (usd !== null) {
      existing.balance_usd += usd;
      totalUsd += usd;
      hasTotalUsd = true;
    }
    grouped.set(channel, existing);
  }

  if (missingAmountNetRows) {
    warnings.push(formatMissingAmountNetWarning(operations, "balance was not calculated."));
  }

  return {
    by_channel: Array.from(grouped.values())
      .sort((left, right) => left.channel.localeCompare(right.channel))
      .map((row) => ({
        channel: row.channel,
        balance_amount: round(row.balance_amount),
        balance_usd: row.rows ? round(row.balance_usd) : null,
        rows: row.rows,
      })),
    total_usd: hasTotalUsd ? round(totalUsd) : null,
    fallback_amount_rows: 0,
    missing_amount_net_rows: missingAmountNetRows,
    excluded_missing_amount_net_rows: excludedMissingAmountNetRows,
    warnings,
  };
}

function buildBalanceFixes(operations, balanceCoverage) {
  const missingAmountNetRows = (operations || [])
    .filter((row) => !String(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net ?? "").trim())
    .map(buildMissingAmountNetFixRow)
    .filter(Boolean);
  const missingOpeningBalanceRows = buildMissingOpeningBalanceFixRows(balanceCoverage);
  const missingOstatkiRows = buildMissingOstatkiFixRows(balanceCoverage);
  return {
    missing_amount_net_rows: missingAmountNetRows,
    missing_opening_balance_rows: missingOpeningBalanceRows,
    missing_ostatki_rows: missingOstatkiRows,
    copyable_ostatki_rows: buildCopyableOstatkiRows(missingOstatkiRows),
  };
}

function buildMissingAmountNetFixRow(row) {
  const ledger = row?.ledgerV2 || {};
  const amount = parseNumber(ledger.amount ?? row.amount);
  const source = normalizeSource(row);
  const paypal = isPayPalRow(row);
  const recommendedAmountNet = !paypal && amount !== null && isSimpleAmountNetSource(source) ? round(Math.abs(amount)) : null;
  const action = paypal
    ? "verify PayPal fee/net; do not auto-fill"
    : recommendedAmountNet !== null
      ? `Set amount_net to ${formatFixNumber(recommendedAmountNet)}`
      : "Review amount_net manually before balance reconciliation";
  const fix = {
    date: normalizeDate(ledger.date || row.date),
    operation: getV2Operation(row),
    from_channel: String(ledger.from_channel || row.fromChannel || "").trim(),
    to_channel: String(ledger.to_channel || row.toChannel || "").trim(),
    channel: getFixChannel(row),
    currency: String(ledger.currency || row.currency || "").trim().toUpperCase(),
    amount,
    raw_source_id: String(
      ledger.raw_source_id ||
        row.rawSourceId ||
        row.raw_source_id ||
        ledger.external_id ||
        row.externalId ||
        row.external_id ||
        ""
    ).trim(),
    recommended_amount_net: recommendedAmountNet,
    reason: paypal
      ? "PayPal fee/net is unavailable for this account context, so amount_net is intentionally empty until provider net is proven or the personal-account net is manually confirmed."
      : "amount_net is empty, so the row is excluded from balance reconciliation.",
    action,
  };
  if (paypal) {
    fix.manual_confirmation_supported = true;
    fix.manual_confirmation_source = "paypal_personal_manual";
    fix.warning_status = "fee_unavailable_personal_account";
    fix.manual_confirmation_action = "After explicit user confirmation, set amount_net and source=paypal_personal_manual/manual_provider_confirmed; preserve fee unavailable warning.";
  }
  return fix;
}

function formatMissingAmountNetWarning(operations, suffix) {
  const missing = (operations || []).filter((row) => !String(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net ?? "").trim());
  const paypalRows = missing.filter(isPayPalRow);
  if (missing.length && paypalRows.length === missing.length) {
    return `Ledger v2 needs provider permission: ${missing.length} PayPal row(s) have empty amount_net/fee; ${suffix}`;
  }
  return `Ledger v2 error: ${missing.length} row(s) have empty amount_net; ${suffix}`;
}

function isSimpleAmountNetSource(source) {
  return ["monobank", "privatbank", "td_bank", "wise", "manual", "fact"].includes(source);
}

function getFixChannel(row) {
  const ledger = row?.ledgerV2 || {};
  const operation = getV2Operation(row);
  if (operation === "expense") return String(ledger.from_channel || row.fromChannel || "").trim();
  if (operation === "income") return String(ledger.to_channel || row.toChannel || "").trim();
  return String(ledger.to_channel || row.toChannel || ledger.from_channel || row.fromChannel || "").trim();
}

function buildMissingOstatkiFixRows(balanceCoverage) {
  return (balanceCoverage?.accounts || [])
    .filter((row) => row?.status === "missing_provider_balance")
    .map((row) => ({
      date: row.date,
      channel: row.channel,
      currency: row.currency,
      computed_closing_balance: row.computed_closing_balance,
      amount_hint: row.computed_closing_balance,
      do_not_apply_automatically: true,
      action: "Confirm provider closing balance, then add factual balance to Остатки",
    }))
    .sort((left, right) => {
      if (left.date !== right.date) return String(left.date || "").localeCompare(String(right.date || ""));
      if (left.channel !== right.channel) return String(left.channel || "").localeCompare(String(right.channel || ""));
      return String(left.currency || "").localeCompare(String(right.currency || ""));
    });
}

function buildMissingOpeningBalanceFixRows(balanceCoverage) {
  return (balanceCoverage?.accounts || [])
    .filter((row) => row?.status === "missing_opening_balance")
    .map((row) => ({
      required_date: previousDate(row.date),
      movement_date: row.date,
      channel: row.channel,
      currency: row.currency,
      amount: null,
      diagnosis: row.diagnosis,
      action: "Add a factual opening balance row to Остатки before the movement date; amount must come from provider/manual statement.",
    }))
    .sort((left, right) => {
      if (left.required_date !== right.required_date) return String(left.required_date || "").localeCompare(String(right.required_date || ""));
      if (left.channel !== right.channel) return String(left.channel || "").localeCompare(String(right.channel || ""));
      return String(left.currency || "").localeCompare(String(right.currency || ""));
    });
}

function buildCopyableOstatkiRows(rows) {
  const copyableRows = (rows || []).filter((row) => row.computed_closing_balance !== null && row.computed_closing_balance !== undefined);
  if (!copyableRows.length) return "";
  return [
    "date\tchannel\tcurrency\tcurrent_ostatki_amount\tcomputed_amount_hint\trequired_provider_evidence\tdo_not_apply_automatically",
    ...copyableRows.map((row) => [
      row.date || "",
      row.channel || "",
      row.currency || "",
      row.current_ostatki_amount ?? "",
      formatFixNumber(row.computed_closing_balance),
      "Provider closing balance for this exact date/channel/currency",
      "true",
    ].join("\t")),
  ].join("\n");
}

function buildPayPalSummary(operations) {
  const paypalRows = (operations || []).filter(isPayPalRow);
  let gross = 0;
  let fee = 0;
  let net = 0;
  let hasGross = false;
  let hasFee = false;
  let hasNet = false;
  let missingCounterpartyRows = 0;
  let missingFeeRows = 0;
  let paypalManualRows = 0;
  let paypalRefundRows = 0;
  const paypalCurrencies = new Set();
  const warnings = [];

  for (const row of paypalRows) {
    const ledger = row?.ledgerV2 || {};
    const grossValue = parseNumber(ledger.amount_gross ?? row.amountGross ?? row.amount);
    const feeValue = parseNumber(ledger.amount_fee ?? row.amountFee);
    const netValue = parseNumber(ledger.amount_net ?? row.amountNet ?? ledger.balance_amount ?? row.balanceAmount);
    const externalId = String(
      ledger.external_id ||
        ledger.raw_source_id ||
        row.external_id ||
        row.rawSourceId ||
        row.sourceTransactionId ||
        row.id ||
        ""
    ).trim();
    const manuallyConfirmed = isPayPalPersonalManualRow(row);
    const manualFallback = isPayPalManualRow(row);
    const currency = String(ledger.currency || row.currency || "").trim().toUpperCase();
    if (manualFallback) paypalManualRows += 1;
    if (currency) paypalCurrencies.add(currency);
    if (isPayPalRefundRow(row)) paypalRefundRows += 1;
    if (grossValue !== null) {
      gross += Math.abs(grossValue);
      hasGross = true;
    }
    if (feeValue !== null) {
      fee += Math.abs(feeValue);
      hasFee = true;
    } else {
      missingFeeRows += 1;
      warnings.push(manuallyConfirmed
        ? `PayPal personal manual confirmation: fee unavailable${externalId ? ` for ${externalId}` : ""}; amount_net is user-confirmed, not provider-proven.`
        : `PayPal warning: missing fee${externalId ? ` for ${externalId}` : ""}; net is not counted as exact.`);
    }
    if ((feeValue !== null || manuallyConfirmed) && netValue !== null) {
      net += netValue;
      hasNet = true;
    }
    if (!String(row.counterparty || row.description || row.comment || "").trim()) missingCounterpartyRows += 1;
  }

  return {
    rows: paypalRows.length,
    gross_total_usd: hasGross ? round(gross) : null,
    fee_total_usd: hasFee ? round(fee) : null,
    net_total_usd: hasNet ? round(net) : null,
    missing_fee_rows: missingFeeRows,
    missing_counterparty_rows: missingCounterpartyRows,
    permission_status: "needs verification",
    net_status: hasNet && missingFeeRows ? "mixed_provider_and_manual" : hasNet ? "provider_proven" : "missing_net",
    personal_manual_confirmed_rows: paypalRows.filter(isPayPalPersonalManualRow).length,
    paypal_manual_rows: paypalManualRows,
    paypal_fee_missing_rows: missingFeeRows,
    paypal_currencies: Array.from(paypalCurrencies).sort(),
    paypal_refund_rows: paypalRefundRows,
    warning_status: paypalRows.some(isPayPalPersonalManualRow) ? "fee_unavailable_personal_account" : null,
    warnings: unique(warnings),
  };
}

function buildExchangeSummary(operations) {
  const exchangeRows = (operations || []).filter(isExchangeRow);
  let missingAmountUsdRows = 0;
  let totalOut = 0;
  let totalIn = 0;
  let hasOut = false;
  let hasIn = false;

  for (const row of exchangeRows) {
    const amountUsd = parseNumber(row?.ledgerV2?.amount_usd ?? row.amountUsd);
    if (isExchangeMissingAmountUsdRow(row)) {
      missingAmountUsdRows += 1;
      continue;
    }
    if (amountUsd === null) continue;
    if (amountUsd < 0) {
      totalOut += amountUsd;
      hasOut = true;
    } else if (amountUsd > 0) {
      totalIn += amountUsd;
      hasIn = true;
    }
  }

  return {
    rows: exchangeRows.length,
    missing_amount_usd_rows: missingAmountUsdRows,
    total_out_usd: hasOut ? round(totalOut) : null,
    total_in_usd: hasIn ? round(totalIn) : null,
    compatibility_mode: false,
    warnings: missingAmountUsdRows
      ? [`Ledger v2 warning: ${missingAmountUsdRows} exchange row(s) have empty amount_usd.`]
      : [],
  };
}

function buildSourcesSummary(operations) {
  const sources = Object.fromEntries(SOURCE_KEYS.map((key) => [key, 0]));
  for (const row of operations || []) {
    const source = normalizeSource(row);
    sources[source] = (sources[source] || 0) + 1;
  }
  return sources;
}

function buildSourceWarnings(sources, totalRows) {
  const warnings = [];
  if (sources.unknown) warnings.push(`needs verification: ${sources.unknown} ledger row(s) have unknown source.`);
  if (sources.manual || sources.fact) warnings.push("source note: manual/fact rows may include inferred legacy sources.");
  if (totalRows && sources.unknown / totalRows >= 0.25) {
    warnings.push("needs verification: source=unknown is high relative to ledger row count.");
  }
  return warnings;
}

function buildAnalyticsWarnings(repository) {
  if (repository?.views) return [];
  return ["needs verification: analytics normalized ledger view is unavailable."];
}

function getV2Operation(row) {
  const operation = String(row?.ledgerV2?.operation || "").trim();
  if (operation) return operation;
  const raw = String(row?.operation || "").trim();
  if (raw === "exchange_in" || raw === "exchange_out") return "exchange";
  if (raw === "business_expense" || raw === "personal_expense") return "expense";
  if (raw === "partner_transfer") return "transfer";
  return raw || "adjustment";
}

function isExchangeRow(row) {
  return getV2Operation(row) === "exchange" || String(row?.category || row?.ledgerV2?.category || "") === "exchange";
}

function isPayPalRow(row) {
  const source = normalizeSource(row);
  const channel = `${row?.fromChannel || ""} ${row?.toChannel || ""} ${row?.ledgerV2?.from_channel || ""} ${row?.ledgerV2?.to_channel || ""}`.toLowerCase();
  return source === "paypal" || source === "paypal_manual" || source === "paypal_personal_manual" || /paypal|пейпал/.test(channel);
}

function isPayPalManualRow(row) {
  const source = normalizeSource(row);
  return source === "paypal_manual" || source === "paypal_personal_manual";
}

function isPayPalPersonalManualRow(row) {
  const source = normalizeSource(row);
  const marker = `${row?.comment || ""} ${row?.description || ""} ${row?.ledgerV2?.comment || ""}`.toLowerCase();
  return source === "paypal_manual" || source === "paypal_personal_manual" || /paypal_manual|paypal_personal_manual|manual_provider_confirmed|fee_unavailable_personal_account/.test(marker);
}

function isPayPalRefundRow(row) {
  const marker = `${row?.entryKind || ""} ${row?.operationType || ""} ${row?.operation_type || ""} ${row?.comment || ""} ${row?.description || ""} ${row?.ledgerV2?.comment || ""} ${row?.rawSourceId || ""} ${row?.raw_source_id || ""} ${row?.ledgerV2?.external_id || ""}`.toLowerCase();
  return /\brefund\b|возврат|expense correction/.test(marker);
}

function normalizeSource(row) {
  const raw = String(row?.source || row?.ledgerV2?.source || "").trim().toLowerCase();
  if (raw === "privat_bank") return "privatbank";
  if (raw === "tdbank") return "td_bank";
  if (raw === "paypal_manual") return "paypal_manual";
  if (raw === "paypal_personal" || raw === "manual_provider_confirmed") return "paypal_personal_manual";
  if (raw === "mcp" || raw === "photo" || raw === "provider" || raw === "import") return "unknown";
  if (SOURCE_KEYS.includes(raw)) return raw;
  if (!raw || raw === "other" || raw === "google_sheets") return "unknown";
  return SOURCE_KEYS.includes(raw) ? raw : "unknown";
}

function getBalanceChannel(row, balanceAmount) {
  const ledger = row?.ledgerV2 || {};
  if (balanceAmount < 0) return String(ledger.from_channel || row.fromChannel || row.toChannel || "").trim();
  return String(ledger.to_channel || row.toChannel || row.fromChannel || "").trim();
}

function omitInternalWarnings(exchange) {
  const { warnings, ...safeExchange } = exchange;
  return safeExchange;
}

function parseBoolean(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) {
    return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  }
  return "";
}

function previousDate(value) {
  const date = normalizeDate(value);
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function lastDayOfMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
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

function formatFixNumber(value) {
  const rounded = round(value);
  return Number.isFinite(rounded) ? String(rounded) : "";
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
