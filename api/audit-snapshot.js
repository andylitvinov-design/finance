import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";
import { buildDailyCurrencyBalances } from "../server/daily-balance-engine.js";
import { buildBalanceCoverage } from "../server/balance-coverage-engine.js";
import {
  countMissingAmountNetRows,
  isExchangeMissingAmountUsdRow,
} from "../server/ledger-audit-helpers.js";

const PROJECT_NAME = "ezohata-incoming-ledger";
const PUBLIC_SUMMARY_ONLY_WARNING =
  "includeRows is disabled in Phase 1 public summary-only mode; raw and sanitized rows are not returned.";
const SOURCE_KEYS = ["manual", "fact", "paypal", "paypal_personal_manual", "wise", "monobank", "privatbank", "td_bank", "migration", "unknown"];

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
    return emptySnapshot({ generatedAt, period: periodFilter.period, warnings, auditChecks });
  }

  const operations = filterOperations(repository.operations || [], periodFilter);
  const period = resolvePeriod(periodFilter, operations);
  const schema = buildSchema(repository);
  const summary = buildSummary(operations, repository);
  const balanceResult = buildBalances(operations);
  const periodDailyBalanceResult = buildDailyCurrencyBalances(operations, repository.balances || []);
  const dailyBalanceResult = filterDailyBalanceResult(
    buildDailyCurrencyBalances(repository.operations || [], repository.balances || []),
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

  return {
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
      excluded_missing_amount_net_rows: Number(excludedMissingAmountNetRows || 0),
      status_counts,
    },
  };
}

function buildDailyBalanceStatusCounts(rows) {
  const counts = {
    ok: 0,
    mismatch: 0,
    missing_opening_balance: 0,
    missing_provider_balance: 0,
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
  };
  return (rows || [])
    .filter((row) => row.status && row.status !== "ok")
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
      action: "Add factual closing balance to Остатки",
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
    "date\tchannel\tcurrency\tamount",
    ...copyableRows.map((row) => [
      row.date || "",
      row.channel || "",
      row.currency || "",
      formatFixNumber(row.computed_closing_balance),
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
  return source === "paypal" || source === "paypal_personal_manual" || /paypal|пейпал/.test(channel);
}

function isPayPalPersonalManualRow(row) {
  const source = normalizeSource(row);
  const marker = `${row?.comment || ""} ${row?.description || ""} ${row?.ledgerV2?.comment || ""}`.toLowerCase();
  return source === "paypal_personal_manual" || /paypal_personal_manual|manual_provider_confirmed|fee_unavailable_personal_account/.test(marker);
}

function normalizeSource(row) {
  const raw = String(row?.source || row?.ledgerV2?.source || "").trim().toLowerCase();
  if (raw === "privat_bank") return "privatbank";
  if (raw === "tdbank") return "td_bank";
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
