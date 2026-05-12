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
const SOURCE_KEYS = ["manual", "fact", "paypal", "wise", "monobank", "privatbank", "td_bank", "migration", "unknown"];
const FINANCE_ANALYSIS_CHANNELS = [
  "Яндекс руб",
  "пейпал дол",
  "пейпал евр",
  "пейпал сad",
  "приват 24-дол",
  "приват 24-евро",
  "приват 24-грн",
  "монобанк грн",
  "БАНК КАНАДА cad",
  "трансервайз дол",
  "трансервайз евро",
  "приват-фоп",
];
const FINANCE_ANALYSIS_FALLBACK_USD_RATES = {
  RUB: 1 / 84.5563,
  UAH: 1 / 43.86,
  EUR: 1.16,
  CAD: 0.74,
};

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
  const financeAnalysis = buildFinanceAnalysisAudit(repository, operations, period);

  warnings.push(...(repository.warnings || []).map(toSafeWarning).filter(Boolean));
  warnings.push(...balanceResult.warnings);
  warnings.push(...paypal.warnings);
  warnings.push(...exchange.warnings);
  warnings.push(...buildSourceWarnings(sources, summary.ledger_rows));
  warnings.push(...buildAnalyticsWarnings(repository));
  warnings.push(...financeAnalysis.warnings);

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
    balance_coverage: balanceCoverage,
    balance_fixes: balanceFixes,
    finance_analysis: financeAnalysis,
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
    balance_coverage: buildBalanceCoverage({
      rows: [],
      summary: { excluded_missing_amount_net_rows: 0 },
    }),
    balance_fixes: {
      missing_amount_net_rows: [],
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

function parsePeriodFilter(query = {}) {
  const period = String(query.period || "").trim();
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
    warnings.push(`Ledger v2 error: ${missingAmountNetRows} row(s) have empty amount_net; balance was not calculated.`);
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
  const missingOstatkiRows = buildMissingOstatkiFixRows(balanceCoverage);
  return {
    missing_amount_net_rows: missingAmountNetRows,
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
  return {
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
    reason: "amount_net is empty, so the row is excluded from balance reconciliation.",
    action,
  };
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
    if (grossValue !== null) {
      gross += Math.abs(grossValue);
      hasGross = true;
    }
    if (feeValue !== null) {
      fee += Math.abs(feeValue);
      hasFee = true;
    } else {
      missingFeeRows += 1;
      warnings.push(`PayPal warning: missing fee${externalId ? ` for ${externalId}` : ""}; net is not counted as exact.`);
    }
    if (feeValue !== null && netValue !== null) {
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

function buildFinanceAnalysisAudit(repository, operations, period) {
  const plannedRows = collectFinanceAnalysisPlannedRows(repository, period);
  const actualRows = collectFinanceAnalysisActualRows(operations);
  const matchedActualIndexes = new Set();
  const rowsByChannel = new Map(FINANCE_ANALYSIS_CHANNELS.map((channel) => [channel, {
    channel,
    planned_count: 0,
    planned_total: 0,
    actual_auto_mcp_count: 0,
    actual_total: 0,
    unmatched_planned: [],
    unmatched_actual: [],
    possible_channel_mismatches: [],
  }]));

  for (const planned of plannedRows) {
    const channelRow = ensureFinanceAnalysisChannel(rowsByChannel, planned.channel);
    channelRow.planned_count += 1;
    channelRow.planned_total = round(channelRow.planned_total + planned.amountUsd);
  }

  for (const actual of actualRows) {
    const channelRow = ensureFinanceAnalysisChannel(rowsByChannel, actual.channel);
    channelRow.actual_auto_mcp_count += 1;
    channelRow.actual_total = round(channelRow.actual_total + actual.amountUsd);
  }

  const plannedMatches = plannedRows.map((planned) => {
    const actualIndex = actualRows.findIndex((actual, index) =>
      !matchedActualIndexes.has(index) &&
      planned.channel === actual.channel &&
      haveStableFinanceAnalysisKey(planned.keys, actual.keys)
    );
    if (actualIndex !== -1) matchedActualIndexes.add(actualIndex);
    return { planned, matched: actualIndex !== -1 };
  });

  for (const { planned, matched } of plannedMatches) {
    if (matched) continue;
    ensureFinanceAnalysisChannel(rowsByChannel, planned.channel).unmatched_planned.push(omitFinanceAnalysisKeys(planned));
  }
  actualRows.forEach((actual, index) => {
    if (matchedActualIndexes.has(index)) return;
    ensureFinanceAnalysisChannel(rowsByChannel, actual.channel).unmatched_actual.push(omitFinanceAnalysisKeys(actual));
  });

  for (const planned of plannedRows) {
    for (const actual of actualRows) {
      if (planned.channel === actual.channel) continue;
      if (!isPossibleFinanceAnalysisAmountMatch(planned.amountUsd, actual.amountUsd)) continue;
      ensureFinanceAnalysisChannel(rowsByChannel, planned.channel).possible_channel_mismatches.push({
        planned_channel: planned.channel,
        actual_channel: actual.channel,
        planned_id: planned.id,
        actual_id: actual.id,
        planned_amount: round(planned.amountUsd),
        actual_amount: round(actual.amountUsd),
        reason: "amounts are close but normalized channels differ; no stable key match was available",
      });
    }
  }

  const channelRows = Array.from(rowsByChannel.values())
    .map((row) => ({
      ...row,
      planned_total: round(row.planned_total),
      actual_total: round(row.actual_total),
    }))
    .filter((row) =>
      row.planned_count ||
      row.actual_auto_mcp_count ||
      row.unmatched_planned.length ||
      row.unmatched_actual.length ||
      row.possible_channel_mismatches.length
    );

  return {
    period,
    source: {
      planned: plannedRows.length ? "finance analysis movement/order rows" : "unavailable in audit snapshot repository",
      actual: "normalized ledger operations filtered by audit snapshot period",
      matching: "stable keys only; no fuzzy same-channel or cross-channel matching is applied",
    },
    channels: channelRows,
    totals: {
      planned_count: plannedRows.length,
      planned_total: round(plannedRows.reduce((sum, row) => sum + row.amountUsd, 0)),
      actual_auto_mcp_count: actualRows.length,
      actual_total: round(actualRows.reduce((sum, row) => sum + row.amountUsd, 0)),
      unmatched_planned: channelRows.reduce((sum, row) => sum + row.unmatched_planned.length, 0),
      unmatched_actual: channelRows.reduce((sum, row) => sum + row.unmatched_actual.length, 0),
      possible_channel_mismatches: channelRows.reduce((sum, row) => sum + row.possible_channel_mismatches.length, 0),
    },
    warnings: plannedRows.length
      ? []
      : ["needs verification: finance analysis planned order rows are not available in the audit snapshot repository."],
  };
}

function collectFinanceAnalysisPlannedRows(repository, period) {
  const candidates =
    repository?.financeAnalysis?.plannedRows ||
    repository?.financeAnalysis?.planRows ||
    repository?.views?.financeAnalysis?.plannedRows ||
    repository?.views?.financeAnalysis?.planRows ||
    repository?.views?.movementRows ||
    repository?.movementValues ||
    [];
  const rows = Array.isArray(candidates) && Array.isArray(candidates[0]) && candidates.some((row) => Array.isArray(row) && row.length > 10)
    ? candidates.slice(3)
    : candidates;
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeFinanceAnalysisPlannedRow(row, index))
    .filter(Boolean)
    .filter((row) => isDateWithinPeriod(row.date, period));
}

function normalizeFinanceAnalysisPlannedRow(row, index) {
  if (Array.isArray(row)) {
    const orderId = String(row[0] || "").trim();
    const paymentMethod = String(row[14] || "").trim();
    const channel = resolveFinanceAnalysisChannel(paymentMethod);
    const amountUsd = parseNumber(row[17]);
    if (!orderId || !channel || !amountUsd) return null;
    return {
      id: orderId,
      date: normalizeDate(row[1]),
      channel,
      amountUsd: round(amountUsd),
      source: "planned_order",
      label: [row[2], paymentMethod].map((value) => String(value || "").trim()).filter(Boolean).join(" | "),
      keys: collectStableKeys({ orderId, comment: row[2], sourceTransactionId: row[0] }),
    };
  }
  if (!row || typeof row !== "object") return null;
  const channel = resolveFinanceAnalysisChannel(row.channel || row.paymentMethod || row.payment_method || row.method);
  const amountUsd = firstNumber([
    row.planned_total,
    row.plannedTotal,
    row.plannedTotalUsd,
    row.accruedPlusUsd,
    row.accruedPlus,
    row.accrued_plus,
    row.amountUsd,
    row.amount_usd,
  ]);
  if (!channel || !amountUsd) return null;
  const id = String(row.orderId || row.order_id || row.id || `planned-${index + 1}`).trim();
  return {
    id,
    date: normalizeDate(row.date || row.orderDate || row.createdAt),
    channel,
    amountUsd: round(amountUsd),
    source: "planned_order",
    label: String(row.client || row.customer || row.comment || "").trim(),
    keys: collectStableKeys(row),
  };
}

function collectFinanceAnalysisActualRows(operations) {
  return (operations || [])
    .map((row, index) => normalizeFinanceAnalysisActualRow(row, index))
    .filter(Boolean);
}

function normalizeFinanceAnalysisActualRow(rawRow, index) {
  const row = rawRow?.ledgerV2 || rawRow || {};
  const operation = normalizeAuditText(row.operation || row.legacy_operation || rawRow?.operation || rawRow?.legacy_operation);
  const category = normalizeAuditText(row.category || row.legacy_category || rawRow?.category || rawRow?.legacy_category);
  if (!["income", "servicein", "serviceincome", "ezoin", "ezofact"].includes(operation || category)) return null;
  const source = normalizeFinanceAnalysisSource(row.source || rawRow?.source || rawRow?.displaySource || "");
  if (!isFinanceAnalysisAutoSource(source)) return null;
  const channel = resolveFinanceAnalysisChannel(row.to_channel || row.toChannel || rawRow?.to_channel || rawRow?.toChannel || row.channel || rawRow?.channel || "");
  if (!channel) return null;
  const amountUsd = getFinanceAnalysisActualUsd(rawRow);
  if (amountUsd <= 0) return null;
  return {
    id: String(row.external_id || row.raw_source_id || rawRow?.externalId || rawRow?.rawSourceId || rawRow?.id || `actual-${index + 1}`).trim(),
    date: normalizeDate(row.date || rawRow?.date),
    channel,
    amountUsd: round(amountUsd),
    source,
    label: String(row.comment || rawRow?.comment || row.counterparty || rawRow?.counterparty || "").trim(),
    keys: collectStableKeys({ ...rawRow, ...row }),
  };
}

function getFinanceAnalysisActualUsd(rawRow) {
  const row = rawRow?.ledgerV2 || rawRow || {};
  const explicit = firstNumber([row.amount_usd, row.amountUsd, rawRow?.amountUsd, rawRow?.usdAmount]);
  if (explicit) return Math.abs(explicit);
  const currency = String(row.currency || rawRow?.currency || "").trim().toUpperCase();
  const local = Math.abs(firstNumber([row.amount_net, rawRow?.amountNet, row.amount, rawRow?.amount]) || 0);
  if (!local) return 0;
  if (currency === "USD") return local;
  const rate = FINANCE_ANALYSIS_FALLBACK_USD_RATES[currency] || 0;
  return rate ? local * rate : 0;
}

function ensureFinanceAnalysisChannel(map, channel) {
  if (!map.has(channel)) {
    map.set(channel, {
      channel,
      planned_count: 0,
      planned_total: 0,
      actual_auto_mcp_count: 0,
      actual_total: 0,
      unmatched_planned: [],
      unmatched_actual: [],
      possible_channel_mismatches: [],
    });
  }
  return map.get(channel);
}

function resolveFinanceAnalysisChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeAuditText(raw);
  const exact = FINANCE_ANALYSIS_CHANNELS.find((channel) => normalizeAuditText(channel) === normalized);
  if (exact) return exact;
  if (/(yoomoney|юmoney|юмани|юмоней|yandex|яндекс).*(rub|руб)|(?:rub|руб).*(yoomoney|юmoney|юмани|юмоней|yandex|яндекс)|сайт.*руб/.test(normalized)) return "Яндекс руб";
  if (/(paypal|пейпал|пэйпэл).*(eur|евр|euro)|(?:eur|евр|euro).*(paypal|пейпал|пэйпэл)/.test(normalized)) return "пейпал евр";
  if (/(paypal|пейпал|пэйпэл).*(cad|канада)|(?:cad|канада).*(paypal|пейпал|пэйпэл)/.test(normalized)) return "пейпал сad";
  if (/(paypal|пейпал|пэйпэл).*(usd|дол)|(?:usd|дол).*(paypal|пейпал|пэйпэл)|^paypal$|^пейпал$/.test(normalized)) return "пейпал дол";
  if (/wise.*eur|transferwise.*eur|трансервайз.*евро/.test(normalized)) return "трансервайз евро";
  if (/wise.*usd|transferwise.*usd|трансервайз.*дол/.test(normalized)) return "трансервайз дол";
  if (/(mono|monobank|монобанк).*(uah|грн|грив)|(?:uah|грн|грив).*(mono|monobank|монобанк)/.test(normalized)) return "монобанк грн";
  if (/(privat|приват).*(fop|фоп)|(?:fop|фоп).*(privat|приват)/.test(normalized)) return "приват-фоп";
  if (/(privat|приват).*(usd|дол)|(?:usd|дол).*(privat|приват)/.test(normalized)) return "приват 24-дол";
  if (/(privat|приват).*(eur|евр|euro)|(?:eur|евр|euro).*(privat|приват)/.test(normalized)) return "приват 24-евро";
  if (/(privat|приват).*(uah|грн|грив)|(?:uah|грн|грив).*(privat|приват)/.test(normalized)) return "приват 24-грн";
  return "";
}

function normalizeFinanceAnalysisSource(value) {
  const token = normalizeAuditText(value).replace(/\s+/g, "_");
  if (token === "paypal_mcp") return "paypal";
  if (token === "mcp_import") return "mcp";
  if (token === "tdbank") return "td_bank";
  return token;
}

function isFinanceAnalysisAutoSource(source) {
  return ["wise", "paypal", "monobank", "privatbank", "td_bank", "yoomoney", "youmoney", "yandex", "provider", "mcp", "import"].includes(source);
}

function collectStableKeys(row = {}) {
  const values = [
    row.sourceTransactionId,
    row.source_transaction_id,
    row.rawSourceId,
    row.raw_source_id,
    row.externalId,
    row.external_id,
    row.orderId,
    row.order_id,
    row.id,
    row.comment,
    row.client,
    row.customer,
    row.counterparty,
  ];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function haveStableFinanceAnalysisKey(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some((key) => rightSet.has(key));
}

function isPossibleFinanceAnalysisAmountMatch(left, right) {
  const a = Math.abs(Number(left || 0));
  const b = Math.abs(Number(right || 0));
  if (!a || !b) return false;
  return Math.abs(a - b) <= Math.max(5, Math.min(a, b) * 0.1);
}

function omitFinanceAnalysisKeys(row) {
  const { keys, ...safeRow } = row;
  return safeRow;
}

function isDateWithinPeriod(date, period = {}) {
  if (!date) return true;
  if (period.from && date < period.from) return false;
  if (period.to && date > period.to) return false;
  return true;
}

function firstNumber(values) {
  for (const value of values || []) {
    const parsed = parseNumber(value);
    if (parsed !== null) return parsed;
  }
  return 0;
}

function normalizeAuditText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return source === "paypal" || /paypal|пейпал/.test(channel);
}

function normalizeSource(row) {
  const raw = String(row?.source || row?.ledgerV2?.source || "").trim().toLowerCase();
  if (raw === "privat_bank") return "privatbank";
  if (raw === "tdbank") return "td_bank";
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
