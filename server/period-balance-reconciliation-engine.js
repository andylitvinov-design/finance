import {
  applyOwnerMayOpeningBalanceSeed,
  buildReconciliationAdjustedMayOpening,
} from "./may-2026-owner-opening-balances.js";

const STATUS = {
  OK: "ok",
  MISMATCH: "mismatch",
  MISSING_OPENING: "missing_opening_balance",
  MISSING_PROVIDER: "missing_provider_balance",
  MISSING_CLOSING: "missing_closing_balance",
  CARRIED_FORWARD: "carried_forward_conditional",
  MISSING_AMOUNT_NET: "missing_amount_net",
  CALCULATED_FROM_PREVIOUS: "calculated_from_previous",
  NEEDS_VERIFICATION: "needs_verification",
  PROVIDER_NOT_IMPLEMENTED: "provider_not_implemented",
  NEEDS_PROVIDER_PERMISSION: "needs_provider_permission",
  PROVIDER_ERROR: "provider_error",
  NOT_SUPPORTED_FOR_ACCOUNT: "not_supported_for_account",
  NO_DATA: "no_data",
};

export function buildPeriodBalanceReconciliation({
  operations = [],
  balanceRows = [],
  autoBalanceRows = [],
  calculatedBalanceRows = [],
  plannedRows = [],
  plannedSourceStatus = "",
  period = {},
} = {}) {
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  const warnings = [];
  const ownerMayOpeningSeed = applyOwnerMayOpeningBalanceSeed(balanceRows, {
    operations,
    period,
  });
  const effectiveBalanceRows = ownerMayOpeningSeed.rows || balanceRows;
  const periodReal = buildRealMovementIndex(operations, { from, to });
  const planned = buildPlannedMovementIndex(plannedRows, { from, to });
  const balanceIndex = buildBalanceIndex(effectiveBalanceRows, autoBalanceRows, calculatedBalanceRows);
  const accountKeys = new Set([
    ...periodReal.byKey.keys(),
    ...planned.byKey.keys(),
    ...balanceIndex.keysBeforePeriod(from),
    ...balanceIndex.keysInPeriod({ from, to }),
    ...balanceIndex.statusKeysInPeriod({ from, to }),
  ]);

  const rows = Array.from(accountKeys)
    .map((key) => buildAccountRow({
      key,
      operations,
      planned: planned.byKey.get(key),
      balanceIndex,
      from,
      to,
    }))
    .filter(Boolean)
    .sort(compareRows);

  const reconciliationReport = buildReconciliationReport(rows, balanceIndex, {
    period: { from, to },
    operations,
    balanceRows: [
      ...(effectiveBalanceRows || []),
      ...(autoBalanceRows || []),
      ...(calculatedBalanceRows || []),
    ],
  });
  const byCurrency = buildCurrencyRows(rows);
  const missingAmountNetRows = rows.reduce((sum, row) => sum + Number(row.missing_amount_net_rows || 0), 0);
  const summary = buildSummary(rows, {
    missingAmountNetRows,
    plannedRows: planned.rows,
    plannedSourceStatus,
  });
  const planSourceUnavailable = !planned.rows && plannedSourceStatus !== "available";
  if (planSourceUnavailable && rows.length) {
    warnings.push("needs verification: planned balance movement source is unavailable; planned_delta is 0 until planned rows are connected.");
  }
  if (missingAmountNetRows) {
    warnings.push(formatMissingAmountNetWarning(missingAmountNetRows, countPayPalMissingAmountNetRows(rows)));
  }

  return {
    period: { from: from || "needs verification", to: to || "needs verification" },
    planned_source_status: planned.rows ? "ok" : (plannedSourceStatus === "available" ? "available_empty" : "needs_verification"),
    real_source: "ledger.amount_net/balance_amount",
    summary,
    by_currency: byCurrency,
    by_channel_currency: rows,
    reconciliation_report: reconciliationReport.rows,
    reconciliation_report_summary: reconciliationReport.summary,
    actionable_rows: buildActionableRows(rows),
    warnings,
  };
}

function buildAccountRow({ key, operations, planned, balanceIndex, from, to }) {
  const [channel, currency] = splitKey(key);
  if (!channel || !currency) return null;

  const openingSnapshot = balanceIndex.findOpening(key, { from, to });
  const closingSnapshot = balanceIndex.findClosing(key, { from, to });
  const nearestManualProviderFact = balanceIndex.findNearest(key, to);
  const realFrom = getMovementWindowStart(openingSnapshot?.date, from);
  const real = buildRealMovementIndex(operations, { from: realFrom, to }).byKey.get(key);
  const lastObservedClosingSnapshot = closingSnapshot || balanceIndex.findLatestBeforeOrOn(key, to);
  const hasMovement = Boolean(real && (real.rows || real.inflow || real.outflow || real.missing_amount_net_rows));
  const hasPlan = Boolean(planned && (planned.rows || planned.inflow || planned.outflow));
  const opening = openingSnapshot?.amount ?? null;
  const plannedInflow = round(planned?.inflow || 0);
  const plannedOutflow = round(planned?.outflow || 0);
  const plannedDelta = round(plannedInflow - plannedOutflow);
  const realInflow = round(real?.inflow || 0);
  const realOutflow = round(real?.outflow || 0);
  const realDelta = round(realInflow - realOutflow);
  const incomeAmountNet = round(real?.income_amount_net || 0);
  const expenseAmountNet = round(real?.expense_amount_net || 0);
  const transferIn = round(real?.transfer_in || 0);
  const transferOut = round(real?.transfer_out || 0);
  const exchangeDelta = round(real?.exchange_delta || 0);
  const providerAdjustments = round(real?.provider_adjustments || 0);
  const incomeAmountUsd = round(real?.income_amount_usd || 0);
  const expenseAmountUsd = round(real?.expense_amount_usd || 0);
  const transferInUsd = round(real?.transfer_in_usd || 0);
  const transferOutUsd = round(real?.transfer_out_usd || 0);
  const exchangeDeltaUsd = round(real?.exchange_delta_usd || 0);
  const providerAdjustmentsUsd = round(real?.provider_adjustments_usd || 0);
  const missingAmountNetRows = Number(real?.missing_amount_net_rows || 0);

  const calculatedClosing = opening === null ? null : round(opening + realDelta);
  const plannedClosing = opening === null ? null : round(opening + plannedDelta);
  const factBalance = resolveFactBalance({
    channel,
    currency,
    targetDate: to,
    balanceIndex,
  });
  const isCalculatedFact = factBalance.status === STATUS.CALCULATED_FROM_PREVIOUS;
  const manualProviderClosing = isCalculatedFact ? null : factBalance.amount;
  let closingSource = factBalance.status === "missing" ? "missing" : (isCalculatedFact ? "calculated" : "exact");
  const canCarryForwardClosing = !closingSnapshot
    && !hasMovement
    && !missingAmountNetRows
    && calculatedClosing !== null
    && lastObservedClosingSnapshot;
  const carriedForwardClosing = canCarryForwardClosing ? lastObservedClosingSnapshot.amount : null;
  const displayedFactClosing = isCalculatedFact ? factBalance.amount : manualProviderClosing;
  const factSource = factBalance.status === "confirmed"
    ? "manual"
    : factBalance.status === "derived_pending"
      ? "derived"
      : factBalance.status === "auto_pending"
      ? "provider"
      : isCalculatedFact
      ? "calculated"
      : "missing";
  const realDifference = displayedFactClosing !== null && calculatedClosing !== null
    ? round(displayedFactClosing - calculatedClosing)
    : null;

  let status = STATUS.OK;
  if (missingAmountNetRows) {
    status = STATUS.MISSING_AMOUNT_NET;
  } else if (isCalculatedFact) {
    status = STATUS.CALCULATED_FROM_PREVIOUS;
  } else if (isProviderLimitationStatus(factBalance.status) && manualProviderClosing === null) {
    status = factBalance.status;
  } else if (opening === null && (hasMovement || hasPlan)) {
    status = STATUS.MISSING_OPENING;
  } else if (manualProviderClosing === null && (hasMovement || hasPlan || opening !== null)) {
    status = STATUS.MISSING_PROVIDER;
  } else if (manualProviderClosing === null && !hasMovement && !hasPlan && opening === null) {
    status = STATUS.NO_DATA;
  } else if (calculatedClosing !== null && manualProviderClosing !== null && Math.abs(round(manualProviderClosing - calculatedClosing)) > 0.0001) {
    status = STATUS.MISMATCH;
  }

  const planVsRealDelta = round(realDelta - plannedDelta);
  const roundedOpening = opening === null ? null : round(opening);
  const roundedManualProviderClosing = manualProviderClosing === null ? null : round(manualProviderClosing);
  const roundedCarriedForwardClosing = carriedForwardClosing === null ? null : round(carriedForwardClosing);
  const roundedDisplayedFactClosing = displayedFactClosing === null ? null : round(displayedFactClosing);

  const row = {
    channel,
    currency,
    opening_fact_balance: roundedOpening,
    opening_balance: roundedOpening,
    opening_amount_usd: openingSnapshot?.amount_usd ?? null,
    opening_balance_date: openingSnapshot?.date || null,
    opening_balance_source: openingSnapshot ? "exact" : "missing",
    planned_inflow: plannedInflow,
    planned_outflow: plannedOutflow,
    planned_delta: plannedDelta,
    planned_closing_balance: plannedClosing,
    real_inflow: realInflow,
    real_outflow: realOutflow,
    real_delta: realDelta,
    income_amount_net: incomeAmountNet,
    expense_amount_net: expenseAmountNet,
    transfer_in: transferIn,
    transfer_out: transferOut,
    exchange_delta: exchangeDelta,
    provider_adjustments: providerAdjustments,
    income_amount_usd: incomeAmountUsd,
    expense_amount_usd: expenseAmountUsd,
    transfer_in_usd: transferInUsd,
    transfer_out_usd: transferOutUsd,
    exchange_delta_usd: exchangeDeltaUsd,
    provider_adjustments_usd: providerAdjustmentsUsd,
    calculated_closing_balance: calculatedClosing,
    calculated_closing_balance_usd: calculateExpectedUsdClosing({
      openingUsd: openingSnapshot?.amount_usd,
      real,
    }),
    computed_real_closing_balance: calculatedClosing,
    manual_provider_closing_balance: roundedManualProviderClosing,
    manual_provider_closing_balance_usd: factBalance.amount_usd,
    manual_provider_closing_balance_date: factBalance.date,
    manual_provider_fact_lookup_key: makeLookupKey({ date: to, channel, currency }),
    fact_balance: factBalance,
    factStatus: factBalance.status,
    fact_status: factBalance.status,
    factDate: factBalance.date,
    fact_date: factBalance.date,
    factSource: factBalance.sourceType,
    fact_source_type: factBalance.sourceType,
    repairHint: factBalance.repairHint,
    repair_hint: factBalance.repairHint,
    computedStatus: opening === null && (hasMovement || hasPlan) ? STATUS.MISSING_OPENING : "ok",
    computed_status: opening === null && (hasMovement || hasPlan) ? STATUS.MISSING_OPENING : "ok",
    balanceSource: factBalance.status === "confirmed"
      ? "manual_fact"
      : (factBalance.status === "derived_pending" ? "derived_balance" : (factBalance.status === "auto_pending" ? "provider_auto" : (isCalculatedFact ? "calculated_balance" : "missing"))),
    needsManualConfirmation: !["confirmed", STATUS.CALCULATED_FROM_PREVIOUS].includes(factBalance.status),
    providerStatus: isProviderLimitationStatus(factBalance.status) ? factBalance.status : null,
    provider_status: isProviderLimitationStatus(factBalance.status) ? factBalance.status : null,
    provider: factBalance.provider || null,
    sourceSheet: factBalance.sourceSheet || "",
    sourceRow: factBalance.sourceRow || null,
    sourceComment: factBalance.comment || "",
    carried_forward_balance: roundedCarriedForwardClosing,
    carried_forward_lookup_key: lastObservedClosingSnapshot
      ? makeLookupKey({ date: lastObservedClosingSnapshot.date, channel, currency })
      : null,
    displayed_fact_balance: roundedDisplayedFactClosing,
    factual_closing_balance: roundedDisplayedFactClosing,
    factual_closing_balance_date: factBalance.date,
    closing_balance_source: closingSource,
    fact_source: factSource,
    missing_fact_reason: factBalance.status === "missing" ? factBalance.warning : null,
    fact_warning: factBalance.warning,
    nearest_manual_provider_fact_date: nearestManualProviderFact?.date || null,
    nearest_manual_provider_fact_amount: nearestManualProviderFact?.amount ?? null,
    last_observed_closing_balance: lastObservedClosingSnapshot?.amount ?? null,
    last_observed_closing_balance_date: lastObservedClosingSnapshot?.date || null,
    last_observed_closing_balance_source: lastObservedClosingSnapshot ? (closingSnapshot ? "exact" : "stale") : "missing",
    real_difference: realDifference,
    plan_vs_real_delta: planVsRealDelta,
    movement_rows: Number(real?.rows || 0),
    planned_rows: Number(planned?.rows || 0),
    missing_amount_net_rows: missingAmountNetRows,
    status,
    diagnostics: buildDiagnostics({
      status,
      missingAmountNetRows,
      opening,
      displayedFactClosing,
      realDifference,
      realInflow,
      realOutflow,
      lastObservedClosingSnapshot,
      closingSnapshot,
      nearestManualProviderFact,
      to,
    }),
    repair_template: buildRepairTemplate({
      status,
      channel,
      currency,
      to,
      movementDate: firstMovementDate(real),
      calculatedClosing,
    }),
    can_write_to_ostatki: Boolean(manualProviderClosing !== null && closingSnapshot),
  };

  return {
    ...row,
    diagnosis: buildDiagnosis(row),
    fix_action: buildFixAction(row),
    repair_action: buildRepairAction(row),
    formula: buildFormula(row),
    fix_priority: getFixPriority(row.status),
  };
}

export function resolveFactBalance({ channel, currency, targetDate, balanceIndex } = {}) {
  const key = makeKey(String(channel || "").trim(), String(currency || "").trim().toUpperCase());
  const normalizedTargetDate = normalizeDate(targetDate);
  const snapshot = balanceIndex?.findClosing?.(key, { to: normalizedTargetDate }) || null;
  if (!snapshot) {
    const providerStatus = balanceIndex?.findStatus?.(key, normalizedTargetDate) || null;
    if (providerStatus && isProviderLimitationStatus(providerStatus.status)) {
      return {
        status: providerStatus.status,
        amount: null,
        date: providerStatus.date,
        sourceSheet: providerStatus.sourceSheet || "Авто Остатки",
        sourceRow: providerStatus.sourceRow || null,
        sourceType: "provider status",
        provider: providerStatus.provider || null,
        comment: providerStatus.comment || "",
        warning: providerStatus.comment || providerStatus.status,
        repairHint: providerStatus.status === STATUS.NEEDS_PROVIDER_PERMISSION
          ? `configure provider permission for ${String(channel || "").trim()}/${String(currency || "").trim().toUpperCase()}`
          : `provider balance status for ${String(channel || "").trim()}/${String(currency || "").trim().toUpperCase()}: ${providerStatus.status}`,
      };
    }
    const nearest = balanceIndex?.findNearest?.(key, normalizedTargetDate) || null;
    const warning = nearest?.date
      ? `manual/provider fact exists for ${nearest.date}, but period end is ${normalizedTargetDate || "selected date"}; exact date fact is missing.`
      : `manual/provider fact is missing for period end ${normalizedTargetDate || "selected date"}.`;
    return {
      status: "missing",
      amount: null,
      date: null,
      sourceSheet: null,
      sourceRow: null,
      sourceType: null,
      provider: null,
      comment: "",
      warning,
      repairHint: `add fact balance for ${String(channel || "").trim()}/${String(currency || "").trim().toUpperCase()}/${normalizedTargetDate || "selected date"}`,
    };
  }
  const balanceSource = getResolvedBalanceSource(snapshot);
  const auto = balanceSource === "provider_auto";
  const derived = balanceSource === "derived_balance";
  const calculated = balanceSource === "calculated_balance";
  return {
    status: calculated ? STATUS.CALCULATED_FROM_PREVIOUS : (derived ? "derived_pending" : (auto ? "auto_pending" : "confirmed")),
    amount: round(snapshot.amount),
    amount_usd: snapshot.amount_usd ?? null,
    date: snapshot.date,
    sourceSheet: snapshot.sourceSheet || (calculated ? "Расчетные Остатки" : (auto || derived ? "Авто Остатки" : "Остатки")),
    sourceRow: snapshot.sourceRow || null,
    sourceType: calculated ? "calculated" : (derived ? "derived" : (auto ? "auto" : "manual fact")),
    provider: snapshot.provider || null,
    comment: snapshot.comment || "",
    warning: calculated ? "calculated from previous known EOD and Ledger amount_net" : (derived ? "derived from confirmed opening and Ledger amount_net" : (auto ? "needs manual confirmation" : null)),
    repairHint: calculated
      ? null
      : (derived
      ? `review derived PayPal balance for ${String(channel || "").trim()}/${String(currency || "").trim().toUpperCase()}/${snapshot.date}`
      : (auto
      ? `confirm auto balance for ${String(channel || "").trim()}/${String(currency || "").trim().toUpperCase()}/${snapshot.date} in Остатки`
      : null)),
  };
}

function makeLookupKey({ date, channel, currency }) {
  return [
    normalizeDate(date),
    String(channel || "").trim(),
    String(currency || "").trim().toUpperCase(),
  ].join("|");
}

function buildMissingFactReason({ closingSnapshot, nearestManualProviderFact, to }) {
  if (closingSnapshot) return null;
  if (!to) return "exact manual/provider fact is missing for the selected period end.";
  if (nearestManualProviderFact?.date) {
    return `manual/provider fact exists for ${nearestManualProviderFact.date}, but period end is ${to}; exact date fact is missing.`;
  }
  return `manual/provider fact is missing for period end ${to}.`;
}

function getBalanceFactSource(row) {
  const resolved = getResolvedBalanceSource(row);
  if (resolved === "provider_auto") return "provider";
  if (resolved === "derived_balance") return "derived";
  if (resolved === "manual_fact") return "manual";
  return "missing";
}

function buildRealMovementIndex(operations, period) {
  const byKey = new Map();
  let missingAmountNetRows = 0;
  let paypalMissingAmountNetRows = 0;

  for (const row of operations || []) {
    const date = normalizeDate(row?.date ?? row?.ledgerV2?.date);
    if (!isInPeriod(date, period)) continue;

    const ledger = row?.ledgerV2 || {};
    const hasAmountNet = String(ledger.amount_net ?? row?.amountNet ?? row?.amount_net ?? "").trim();
    const balanceAmount = parseNumber(ledger.balance_amount ?? row?.balanceAmount);
    const currency = String(ledger.currency || row?.currency || "").trim().toUpperCase();
    const channel = getMovementChannel(row, balanceAmount);
    if (!currency || !channel) continue;

    const key = makeKey(channel, currency);
    const current = byKey.get(key) || emptyMovement();
    if (!hasAmountNet) {
      missingAmountNetRows += 1;
      if (isPayPalAmountNetPermissionRow(row)) paypalMissingAmountNetRows += 1;
      current.missing_amount_net_rows += 1;
      current.movement_dates.push(date);
      byKey.set(key, current);
      continue;
    }
    if (balanceAmount === null) continue;

    const amountUsd = parseSignedUsdAmount(row, balanceAmount, currency);
    addMovementBreakdown(current, row, {
      balanceAmount,
      amountUsd,
      currency,
    });
    current.rows += 1;
    current.movement_dates.push(date);
    byKey.set(key, current);

    const syntheticTransfer = buildSyntheticTransferIn(row, {
      date,
      currency,
      balanceAmount,
      amountUsd,
      operations,
    });
    if (syntheticTransfer) {
      const syntheticKey = makeKey(syntheticTransfer.channel, currency);
      const syntheticCurrent = byKey.get(syntheticKey) || emptyMovement();
      addMovementBreakdown(syntheticCurrent, row, {
        balanceAmount: syntheticTransfer.balanceAmount,
        amountUsd: syntheticTransfer.amountUsd,
        currency,
      });
      syntheticCurrent.rows += 1;
      syntheticCurrent.movement_dates.push(date);
      byKey.set(syntheticKey, syntheticCurrent);
    }
  }

  return {
    byKey,
    missing_amount_net_rows: missingAmountNetRows,
    paypal_missing_amount_net_rows: paypalMissingAmountNetRows,
  };
}

function buildSyntheticTransferIn(row, { date, currency, balanceAmount, amountUsd, operations }) {
  if (normalizeOperation(row) !== "transfer" || balanceAmount >= 0) return null;
  const ledger = row?.ledgerV2 || {};
  const toChannel = String(ledger.to_channel || row?.toChannel || "").trim();
  const fromChannel = String(ledger.from_channel || row?.fromChannel || "").trim();
  if (!toChannel || !fromChannel) return null;
  if (hasOppositeTransferLeg(row, { date, currency, amount: Math.abs(balanceAmount), operations })) return null;
  return {
    channel: toChannel,
    balanceAmount: Math.abs(balanceAmount),
    amountUsd: amountUsd === null ? null : Math.abs(amountUsd),
  };
}

function hasOppositeTransferLeg(row, { date, currency, amount, operations }) {
  const ledger = row?.ledgerV2 || {};
  const groupId = String(ledger.transfer_group_id || row?.transferGroupId || row?.transfer_group_id || "").trim();
  const fromChannel = String(ledger.from_channel || row?.fromChannel || "").trim();
  const toChannel = String(ledger.to_channel || row?.toChannel || "").trim();
  return (operations || []).some((candidate) => {
    if (candidate === row || normalizeOperation(candidate) !== "transfer") return false;
    const candidateLedger = candidate?.ledgerV2 || {};
    const candidateDate = normalizeDate(candidate?.date ?? candidateLedger.date);
    const candidateCurrency = String(candidateLedger.currency || candidate?.currency || "").trim().toUpperCase();
    const candidateAmount = parseNumber(candidateLedger.balance_amount ?? candidate?.balanceAmount);
    if (candidateDate !== date || candidateCurrency !== currency || candidateAmount === null || candidateAmount <= 0) return false;
    const candidateGroupId = String(candidateLedger.transfer_group_id || candidate?.transferGroupId || candidate?.transfer_group_id || "").trim();
    if (groupId && candidateGroupId && groupId === candidateGroupId) return true;
    const candidateFrom = String(candidateLedger.from_channel || candidate?.fromChannel || "").trim();
    const candidateTo = String(candidateLedger.to_channel || candidate?.toChannel || "").trim();
    return candidateFrom === fromChannel
      && candidateTo === toChannel
      && Math.abs(Math.abs(candidateAmount) - amount) < 0.0001;
  });
}

function getMovementWindowStart(openingDate, from) {
  // Balance snapshots are EOD 23:59. Same-day movements are included in the
  // snapshot and must not be counted again after that snapshot.
  if (!openingDate) return from;
  const afterOpening = addDays(openingDate, 1);
  if (!from) return afterOpening;
  if (openingDate === from) return afterOpening;
  return afterOpening && afterOpening < from ? afterOpening : from;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function countPayPalMissingAmountNetRows(rows = []) {
  return rows
    .filter((row) => Number(row.missing_amount_net_rows || 0))
    .filter((row) => /paypal|пейпал/i.test(`${row.channel} ${row.source || ""}`))
    .reduce((sum, row) => sum + Number(row.missing_amount_net_rows || 0), 0);
}

function formatMissingAmountNetWarning(missingRows, paypalRows) {
  if (missingRows && missingRows === paypalRows) {
    return `Ledger v2 needs provider permission: ${missingRows} PayPal row(s) have empty amount_net/fee; real balance reconciliation is incomplete.`;
  }
  return `Ledger v2 error: ${missingRows} row(s) have empty amount_net; real balance reconciliation is incomplete.`;
}

function isPayPalAmountNetPermissionRow(row) {
  const ledger = row?.ledgerV2 || {};
  const source = normalizeText(row?.source || ledger.source || "");
  const rawSourceId = String(row?.rawSourceId || row?.raw_source_id || row?.externalId || row?.external_id || ledger.external_id || "").trim();
  const channel = normalizeText([row?.fromChannel, row?.toChannel, row?.from_channel, row?.to_channel, ledger.from_channel, ledger.to_channel].filter(Boolean).join(" "));
  return source.includes("paypal") || /^paypal[:_-]/i.test(rawSourceId) || /пейпал|paypal/.test(channel);
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPlannedMovementIndex(plannedRows, period) {
  const byKey = new Map();
  let rows = 0;

  for (const row of plannedRows || []) {
    const date = normalizeDate(row?.date || row?.planned_date || row?.operationDate || row?.operation_date);
    if (!isInPeriod(date, period)) continue;
    const amount = parseNumber(
      row?.planned_balance_amount ??
      row?.planned_amount_net ??
      row?.planned_amount ??
      row?.plan_amount ??
      row?.amount_net ??
      row?.amount
    );
    if (amount === null) continue;
    const currency = String(row?.currency || row?.planned_currency || "").trim().toUpperCase();
    if (!currency) continue;
    const channel = String(
      row?.channel ||
      row?.to_channel ||
      row?.toChannel ||
      row?.from_channel ||
      row?.fromChannel ||
      row?.account ||
      ""
    ).trim();
    if (!channel) continue;

    const key = makeKey(channel, currency);
    const current = byKey.get(key) || emptyMovement();
    const kind = String(row?.operation || row?.type || row?.direction || "").trim().toLowerCase();
    const isOutflow = amount < 0 || /expense|out|расход|spend/.test(kind);
    if (isOutflow) current.outflow += Math.abs(amount);
    else current.inflow += Math.abs(amount);
    current.rows += 1;
    rows += 1;
    byKey.set(key, current);
  }

  return { byKey, rows };
}

function buildBalanceIndex(balanceRows, autoBalanceRows = [], calculatedBalanceRows = []) {
  const byKey = new Map();
  const statusByKey = new Map();
  for (const row of normalizeBalanceRowsForPriority(balanceRows, autoBalanceRows, calculatedBalanceRows)) {
    const date = normalizeDate(row?.date);
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    const key = makeKey(channel, currency);
    const rowStatus = normalizeProviderBalanceStatus(row?.status || row?.autoBalanceStatus || row?.auto_balance_status);
    if (date && channel && currency && rowStatus && !["ok", "zero_balance", "derived_from_confirmed_opening"].includes(rowStatus)) {
      const statusRows = statusByKey.get(key) || [];
      statusRows.push({
        date,
        channel,
        currency,
        status: rowStatus,
        source: row?.source || row?.fact_source || row?.provider || "",
        provider: row?.provider || null,
        sourceSheet: row?.sourceSheet || "",
        sourceRow: row?.sourceRow || null,
        comment: row?.comment || "",
      });
      statusByKey.set(key, statusRows);
    }
    if (!date || !channel || !currency || amount === null) continue;
    const rows = byKey.get(key) || [];
    rows.push({
      date,
      channel,
      currency,
      amount,
      amount_usd: resolveSnapshotUsdAmount(row, amount, currency),
      source: row?.source || row?.fact_source || row?.provider || "",
      balanceSource: getResolvedBalanceSource(row),
      provider: row?.provider || null,
      sourceSheet: row?.sourceSheet || "",
      sourceRow: row?.sourceRow || null,
      comment: row?.comment || "",
    });
    byKey.set(key, rows);
  }
  for (const rows of byKey.values()) rows.sort(compareBalanceSnapshots);
  for (const rows of statusByKey.values()) rows.sort((left, right) => left.date.localeCompare(right.date));

  return {
    findOpening(key, { from, to } = {}) {
      const rows = byKey.get(key) || [];
      if (!from) return rows[0] || null;
      // Balance snapshots are EOD 23:59. For multi-day periods, the from-date
      // snapshot is an opening EOD fact and same-day movements start next day.
      // For same-day periods, use the previous EOD snapshot to avoid treating
      // the same EOD fact as both opening and closing.
      if (from && to && from === to) return latestPreferred(rows.filter((row) => row.date < from));
      return latestPreferred(rows.filter((row) =>
        row.date < from || (row.date === from && getResolvedBalanceSource(row) !== "calculated_balance")
      ));
    },
    findClosing(key, { from, to }) {
      const rows = byKey.get(key) || [];
      if (to) return rows.find((row) => row.date === to) || null;
      return rows.filter((row) => (!from || row.date >= from)).at(-1) || null;
    },
    findLatestBeforeOrOn(key, to) {
      const rows = byKey.get(key) || [];
      if (!to) return latestPreferred(rows);
      return latestPreferred(rows.filter((row) => row.date <= to));
    },
    findNearest(key, to) {
      const rows = byKey.get(key) || [];
      if (!rows.length) return null;
      if (!to) return rows.at(-1) || null;
      const exact = rows.find((row) => row.date === to);
      if (exact) return exact;
      const before = rows.filter((row) => row.date < to).at(-1);
      const after = rows.find((row) => row.date > to);
      if (!before) return after || null;
      if (!after) return before;
      const targetDate = new Date(`${to}T00:00:00Z`);
      const beforeDistance = Math.abs(targetDate - new Date(`${before.date}T00:00:00Z`));
      const afterDistance = Math.abs(new Date(`${after.date}T00:00:00Z`) - targetDate);
      return afterDistance < beforeDistance ? after : before;
    },
    findStatus(key, to) {
      const rows = statusByKey.get(key) || [];
      if (!rows.length) return null;
      if (!to) return rows.at(-1) || null;
      return rows.find((row) => row.date === to) || null;
    },
    keysBeforePeriod(from) {
      if (!from) return Array.from(byKey.keys());
      return Array.from(byKey.entries())
        .filter(([, rows]) => rows.some((row) => row.date < from))
        .map(([key]) => key);
    },
    keysInPeriod(period) {
      return Array.from(byKey.entries())
        .filter(([, rows]) => rows.some((row) => isInPeriod(row.date, period)))
        .map(([key]) => key);
    },
    statusKeysInPeriod(period) {
      return Array.from(statusByKey.entries())
        .filter(([, rows]) => rows.some((row) => isInPeriod(row.date, period)))
        .map(([key]) => key);
    },
    findAliasCandidate(key) {
      const [channel, currency] = splitKey(key);
      const normalizedChannel = normalizeAliasText(channel);
      if (!normalizedChannel || !currency) return null;
      for (const candidateKey of byKey.keys()) {
        const [candidateChannel, candidateCurrency] = splitKey(candidateKey);
        if (candidateCurrency !== currency) continue;
        if (candidateChannel === channel) continue;
        if (normalizeAliasText(candidateChannel) === normalizedChannel) return candidateChannel;
      }
      return null;
    },
  };
}

function latestPreferred(rows = []) {
  if (!rows.length) return null;
  const latestDate = rows.at(-1)?.date;
  return rows
    .filter((row) => row.date === latestDate)
    .sort((left, right) => balanceSourcePriority(left) - balanceSourcePriority(right))[0] || null;
}

function normalizeBalanceRowsForPriority(balanceRows = [], autoBalanceRows = [], calculatedBalanceRows = []) {
  return [
    ...(balanceRows || []).map((row) => ({
      ...row,
      balanceSource: getResolvedBalanceSource(row),
      sourceSheet: row?.sourceSheet || "Остатки",
    })),
    ...(autoBalanceRows || []).map((row) => ({
      ...row,
      balanceSource: isManualBalanceSource(row) ? "manual_fact" : getResolvedBalanceSource(row),
      source: row?.source || "provider_auto",
      sourceSheet: row?.sourceSheet || "Авто Остатки",
    })),
    ...(calculatedBalanceRows || []).map((row) => ({
      ...row,
      amount: row?.amount ?? row?.balanceAmount ?? row?.calculated_eod,
      balanceAmount: row?.balanceAmount ?? row?.amount ?? row?.calculated_eod,
      balanceSource: "calculated_balance",
      source: row?.source || "calculated",
      fact_source: row?.fact_source || "calculated",
      sourceSheet: row?.sourceSheet || "Расчетные Остатки",
    })),
  ];
}

function compareBalanceSnapshots(left, right) {
  const dateDiff = left.date.localeCompare(right.date);
  if (dateDiff) return dateDiff;
  return balanceSourcePriority(left) - balanceSourcePriority(right);
}

function balanceSourcePriority(row) {
  const source = getResolvedBalanceSource(row);
  if (source === "manual_fact") return 0;
  if (source === "provider_auto") return 1;
  if (source === "derived_balance") return 2;
  if (source === "calculated_balance") return 3;
  return 4;
}

function getResolvedBalanceSource(row = {}) {
  const source = normalizeText(`${row?.source || ""} ${row?.fact_source || ""} ${row?.provider || ""} ${row?.comment || ""}`);
  const explicit = String(row?.balanceSource || row?.balance_source || "").trim();
  if (explicit === "manual_fact" || explicit === "provider_auto" || explicit === "derived_balance" || explicit === "calculated_balance" || explicit === "missing") return explicit;
  if (/calculated_balance|calculated|расчетные остатки/.test(source)) return "calculated_balance";
  if (/manual confirmed|manual balance|manual fact|paypal manual balance|paypal manual confirmed|paypal_manual_balance|paypal_manual_confirmed_balance/.test(source)) return "manual_fact";
  if (/paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed paypal balance/.test(source)) return "derived_balance";
  if (isManualBalanceSource(row)) return "manual_fact";
  if (/wise auto snapshot|auto daily provider snapshot|provider snapshot|auto snapshot/.test(source)) return "provider_auto";
  if (/wise auto|paypal auto|binance auto|monobank auto|privatbank auto|yoomoney auto|provider auto/.test(source)) return "provider_auto";
  if (/provider|wise|paypal|binance|mono|monobank|privat|yoomoney|провайдер|банк/.test(source)) return "provider_auto";
  return "manual_fact";
}

function isManualBalanceSource(row = {}) {
  const raw = String(`${row?.source || ""} ${row?.fact_source || ""} ${row?.comment || ""}`).trim().toLowerCase();
  return /paypal_manual_balance|paypal_manual_confirmed_balance|manual PayPal balance|manual confirmed|manual fact/i.test(raw);
}

function normalizeProviderBalanceStatus(value) {
  const status = String(value || "").trim();
  if (status === "needs_permission") return STATUS.NEEDS_PROVIDER_PERMISSION;
  return status;
}

function isProviderLimitationStatus(status) {
  return [
    STATUS.PROVIDER_NOT_IMPLEMENTED,
    STATUS.NEEDS_PROVIDER_PERMISSION,
    STATUS.PROVIDER_ERROR,
    STATUS.NOT_SUPPORTED_FOR_ACCOUNT,
  ].includes(String(status || "").trim());
}

function buildCurrencyRows(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const current = grouped.get(row.currency) || {
      currency: row.currency,
      positions: 0,
      planned_inflow: 0,
      planned_outflow: 0,
      planned_delta: 0,
      real_inflow: 0,
      real_outflow: 0,
      real_delta: 0,
      plan_vs_real_delta: 0,
      real_difference: 0,
      status_counts: {},
    };
    current.positions += 1;
    current.planned_inflow += Number(row.planned_inflow || 0);
    current.planned_outflow += Number(row.planned_outflow || 0);
    current.planned_delta += Number(row.planned_delta || 0);
    current.real_inflow += Number(row.real_inflow || 0);
    current.real_outflow += Number(row.real_outflow || 0);
    current.real_delta += Number(row.real_delta || 0);
    current.plan_vs_real_delta += Number(row.plan_vs_real_delta || 0);
    if (row.real_difference !== null && row.real_difference !== undefined) current.real_difference += Number(row.real_difference || 0);
    current.status_counts[row.status] = (current.status_counts[row.status] || 0) + 1;
    grouped.set(row.currency, current);
  }
  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      planned_inflow: round(row.planned_inflow),
      planned_outflow: round(row.planned_outflow),
      planned_delta: round(row.planned_delta),
      real_inflow: round(row.real_inflow),
      real_outflow: round(row.real_outflow),
      real_delta: round(row.real_delta),
      plan_vs_real_delta: round(row.plan_vs_real_delta),
      real_difference: round(row.real_difference),
      status: resolveCurrencyStatus(row.status_counts),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function buildReconciliationReport(rows = [], balanceIndex, { period = {}, operations = [], balanceRows = [] } = {}) {
  const reportRows = rows.map((row) => {
    const key = makeKey(row.channel, row.currency);
    const aliasCandidate = balanceIndex?.findAliasCandidate?.(key) || null;
    const expectedUsd = coalesceNumber(
      row.calculated_closing_balance_usd,
      isStableUsdCurrency(row.currency) ? row.computed_real_closing_balance : null
    );
    const confirmedUsd = coalesceNumber(
      row.manual_provider_closing_balance_usd,
      isStableUsdCurrency(row.currency) ? row.factual_closing_balance : null
    );
    return {
      channel: row.channel,
      currency: row.currency,
      opening_2026_05_01: row.opening_balance,
      opening_2026_05_01_usd: coalesceNumber(
        row.opening_amount_usd,
        isStableUsdCurrency(row.currency) ? row.opening_balance : null
      ),
      opening_balance_date: row.opening_balance_date,
      income_amount_net: row.income_amount_net,
      income_amount_usd: row.income_amount_usd,
      expense_amount_net: row.expense_amount_net,
      expense_amount_usd: row.expense_amount_usd,
      transfer_in: row.transfer_in,
      transfer_in_usd: row.transfer_in_usd,
      transfer_out: row.transfer_out,
      transfer_out_usd: row.transfer_out_usd,
      exchange_delta: row.exchange_delta,
      exchange_delta_usd: row.exchange_delta_usd,
      provider_adjustments: row.provider_adjustments,
      provider_adjustments_usd: row.provider_adjustments_usd,
      expected_later_balance: row.computed_real_closing_balance,
      expected_later_balance_usd: expectedUsd,
      confirmed_later_balance: row.factual_closing_balance,
      confirmed_later_balance_usd: confirmedUsd,
      confirmed_later_balance_date: row.factual_closing_balance_date,
      diff: row.real_difference,
      diff_usd: expectedUsd !== null && confirmedUsd !== null ? round(confirmedUsd - expectedUsd) : null,
      status: row.status,
      suspected_cause: classifySuspectedCause(row, aliasCandidate),
      ...(aliasCandidate ? { alias_candidate: aliasCandidate } : {}),
    };
  });

  const systemOpeningTotalUsd = round(reportRows.reduce((sum, row) => sum + Number(row.opening_2026_05_01_usd || 0), 0));
  const ownerConfirmedOpeningTotalUsd = getOwnerConfirmedOpeningTotalUsd(period);
  const adjustedOpening = buildReconciliationAdjustedMayOpening({ operations, balanceRows, period });
  return {
    rows: reportRows,
    summary: {
      rows: reportRows.length,
      owner_confirmed_opening_2026_05_01_total_usd: ownerConfirmedOpeningTotalUsd,
      owner_input_opening_total_usd: adjustedOpening.owner_input_opening_total_usd,
      reconciliation_adjusted_opening_total_usd: adjustedOpening.reconciliation_adjusted_opening_total_usd,
      diff_from_owner_input_total_usd: adjustedOpening.diff_from_owner_input_total_usd,
      opening_adjustment_rows: adjustedOpening.rows,
      adjusted_rows: adjustedOpening.adjusted_rows,
      needs_verification_rows: adjustedOpening.needs_verification_rows,
      pending_movement_verification_rows: adjustedOpening.pending_movement_verification_rows,
      paypal_movement_diagnostics: adjustedOpening.paypal_movement_diagnostics,
      system_opening_2026_05_01_total_usd: systemOpeningTotalUsd,
      opening_total_diff_usd: ownerConfirmedOpeningTotalUsd === null ? null : round(systemOpeningTotalUsd - ownerConfirmedOpeningTotalUsd),
      status_counts: reportRows.reduce((counts, row) => {
        counts[row.status] = (counts[row.status] || 0) + 1;
        return counts;
      }, {}),
      transfer_in: round(reportRows.reduce((sum, row) => sum + Number(row.transfer_in || 0), 0)),
      transfer_out: round(reportRows.reduce((sum, row) => sum + Number(row.transfer_out || 0), 0)),
      transfer_net: round(reportRows.reduce((sum, row) => sum + Number(row.transfer_in || 0) - Number(row.transfer_out || 0), 0)),
      diff_usd: round(reportRows.reduce((sum, row) => sum + Number(row.diff_usd || 0), 0)),
    },
  };
}

function getOwnerConfirmedOpeningTotalUsd(period = {}) {
  return period.from === "2026-05-01" ? 24993 : null;
}

function classifySuspectedCause(row, aliasCandidate) {
  if (row.status === STATUS.OK || row.status === STATUS.CALCULATED_FROM_PREVIOUS || row.status === STATUS.NO_DATA) return "none";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "missing_amount_net";
  if (aliasCandidate) return "channel_alias_mismatch";
  if (row.status === STATUS.MISSING_OPENING) return "missing_opening_balance";
  if (row.status === STATUS.MISSING_PROVIDER) return "missing_confirmed_later_balance";
  if (isProviderLimitationStatus(row.status)) return "provider_balance_unavailable";
  if (row.status === STATUS.MISMATCH && Number(row.movement_rows || 0) > 0) return "missing_or_extra_ledger_movement";
  if (row.status === STATUS.MISMATCH) return "confirmed_balance_conflict";
  return "needs_verification";
}

function addMovementBreakdown(current, row, { balanceAmount, amountUsd, currency }) {
  const operation = normalizeOperation(row);
  const absAmount = Math.abs(balanceAmount);
  const absUsd = amountUsd === null ? null : Math.abs(amountUsd);

  if (balanceAmount >= 0) current.inflow += balanceAmount;
  else current.outflow += absAmount;

  if (amountUsd !== null) {
    current.net_change_usd += amountUsd;
    current.has_usd_change = true;
  } else if (isStableUsdCurrency(currency)) {
    current.net_change_usd += balanceAmount;
    current.has_usd_change = true;
  }

  if (operation === "transfer") {
    if (balanceAmount >= 0) {
      current.transfer_in += absAmount;
      if (absUsd !== null) current.transfer_in_usd += absUsd;
    } else {
      current.transfer_out += absAmount;
      if (absUsd !== null) current.transfer_out_usd += absUsd;
    }
    return;
  }

  if (operation === "exchange") {
    current.exchange_delta += balanceAmount;
    if (amountUsd !== null) current.exchange_delta_usd += amountUsd;
    return;
  }

  if (/adjustment|provider|balance/.test(operation)) {
    current.provider_adjustments += balanceAmount;
    if (amountUsd !== null) current.provider_adjustments_usd += amountUsd;
    return;
  }

  if (operation === "expense" || balanceAmount < 0) {
    current.expense_amount_net += absAmount;
    if (absUsd !== null) current.expense_amount_usd += absUsd;
  } else {
    current.income_amount_net += absAmount;
    if (absUsd !== null) current.income_amount_usd += absUsd;
  }
}

function normalizeOperation(row = {}) {
  const ledger = row?.ledgerV2 || {};
  const operation = String(ledger.operation || row.operation || row.type || "").trim().toLowerCase();
  if (/transfer|перевод/.test(operation)) return "transfer";
  if (/exchange|обмен/.test(operation)) return "exchange";
  if (/expense|out|расход/.test(operation)) return "expense";
  if (/income|in|доход|приход/.test(operation)) return "income";
  return operation || "income";
}

function parseSignedUsdAmount(row, balanceAmount, currency) {
  const ledger = row?.ledgerV2 || {};
  const parsed = parseNumber(ledger.amount_usd ?? row?.amountUsd ?? row?.amount_usd ?? row?.usdAmount);
  if (parsed !== null) {
    const signed = Math.abs(parsed) * (balanceAmount < 0 ? -1 : 1);
    return round(signed);
  }
  return isStableUsdCurrency(currency) ? round(balanceAmount) : null;
}

function calculateExpectedUsdClosing({ openingUsd, real } = {}) {
  const parsedOpeningUsd = coalesceNumber(openingUsd);
  if (parsedOpeningUsd === null) return null;
  if (!real?.has_usd_change) return null;
  return round(parsedOpeningUsd + Number(real.net_change_usd || 0));
}

function resolveSnapshotUsdAmount(row, amount, currency) {
  const parsed = parseNumber(row?.amount_usd ?? row?.amountUsd ?? row?.usdAmount ?? row?.balance_usd ?? row?.balanceUsd);
  if (parsed !== null) return round(parsed);
  return isStableUsdCurrency(currency) && amount !== null ? round(amount) : null;
}

function coalesceNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return round(parsed);
  }
  return null;
}

function isStableUsdCurrency(currency = "") {
  return ["USD", "USDT", "USDC"].includes(String(currency || "").trim().toUpperCase());
}

function normalizeAliasText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function buildSummary(rows, { missingAmountNetRows, plannedRows, plannedSourceStatus }) {
  const statusCounts = {};
  for (const row of rows || []) statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
  const failed = statusCounts[STATUS.MISMATCH] || 0;
  const incomplete = (statusCounts[STATUS.MISSING_OPENING] || 0)
    + (statusCounts[STATUS.MISSING_PROVIDER] || 0)
    + (statusCounts[STATUS.MISSING_CLOSING] || 0)
    + (statusCounts[STATUS.MISSING_AMOUNT_NET] || 0)
    + (statusCounts[STATUS.NEEDS_VERIFICATION] || 0)
    + countProviderLimitationStatuses(statusCounts);

  return {
    status: failed ? "failed" : incomplete ? "blocked" : "ok",
    positions_checked: rows.length,
    currencies_checked: new Set((rows || []).map((row) => row.currency)).size,
    channels_checked: new Set((rows || []).map((row) => row.channel)).size,
    planned_rows: Number(plannedRows || 0),
    planned_source_status: plannedRows ? "ok" : (plannedSourceStatus === "available" ? "available_empty" : "needs_verification"),
    missing_amount_net_rows: Number(missingAmountNetRows || 0),
    status_counts: {
      [STATUS.OK]: statusCounts[STATUS.OK] || 0,
      [STATUS.MISMATCH]: statusCounts[STATUS.MISMATCH] || 0,
      [STATUS.MISSING_PROVIDER]: statusCounts[STATUS.MISSING_PROVIDER] || 0,
      [STATUS.MISSING_OPENING]: statusCounts[STATUS.MISSING_OPENING] || 0,
      [STATUS.MISSING_CLOSING]: statusCounts[STATUS.MISSING_CLOSING] || 0,
      [STATUS.CARRIED_FORWARD]: statusCounts[STATUS.CARRIED_FORWARD] || 0,
      [STATUS.MISSING_AMOUNT_NET]: statusCounts[STATUS.MISSING_AMOUNT_NET] || 0,
      [STATUS.CALCULATED_FROM_PREVIOUS]: statusCounts[STATUS.CALCULATED_FROM_PREVIOUS] || 0,
      [STATUS.NEEDS_VERIFICATION]: statusCounts[STATUS.NEEDS_VERIFICATION] || 0,
      [STATUS.PROVIDER_NOT_IMPLEMENTED]: statusCounts[STATUS.PROVIDER_NOT_IMPLEMENTED] || 0,
      [STATUS.NEEDS_PROVIDER_PERMISSION]: statusCounts[STATUS.NEEDS_PROVIDER_PERMISSION] || 0,
      [STATUS.PROVIDER_ERROR]: statusCounts[STATUS.PROVIDER_ERROR] || 0,
      [STATUS.NOT_SUPPORTED_FOR_ACCOUNT]: statusCounts[STATUS.NOT_SUPPORTED_FOR_ACCOUNT] || 0,
      [STATUS.NO_DATA]: statusCounts[STATUS.NO_DATA] || 0,
    },
    blocked: incomplete,
  };
}

function buildActionableRows(rows) {
  return (rows || [])
    .filter((row) => row.status !== STATUS.OK && row.status !== STATUS.CARRIED_FORWARD && row.status !== STATUS.NO_DATA)
    .sort((left, right) => {
      const priorityDiff = getFixPriority(left.status) - getFixPriority(right.status);
      if (priorityDiff) return priorityDiff;
      return compareRows(left, right);
    })
    .slice(0, 15);
}

function buildDiagnosis(row) {
  if (row.status === STATUS.OK) return "Сверено: фактический остаток совпадает с реальным расчетным остатком.";
  if (row.status === STATUS.CALCULATED_FROM_PREVIOUS) return "Рассчитано: нет нового факта, использован предыдущий известный EOD плюс Ledger amount_net.";
  if (row.status === STATUS.CARRIED_FORWARD) return "Условно перенесено: за период нет движений и нет нового остатка, использован остаток прошлого периода.";
  if (row.status === STATUS.NO_DATA) return "Нет данных для сверки: нет начального остатка, движения, плана и факта.";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "Есть Ledger строки без amount_net; реальное изменение баланса нельзя считать полным.";
  if (row.status === STATUS.MISSING_OPENING) return "Нет начального Остатки перед периодом, но есть план/движение.";
  if (row.status === STATUS.MISSING_PROVIDER) return "Нет фактического остатка на дату; сверка по этому счету заблокирована до ввода баланса провайдера.";
  if (row.status === STATUS.PROVIDER_NOT_IMPLEMENTED) return "Автоматический остаток для этого провайдера не реализован; нужен ручной факт или новый API-адаптер.";
  if (row.status === STATUS.NEEDS_PROVIDER_PERMISSION) return "Провайдерский остаток доступен только после настройки токена или разрешений.";
  if (row.status === STATUS.PROVIDER_ERROR) return "Провайдерский остаток не получен из-за ошибки API; статус сохранен в Авто Остатки.";
  if (row.status === STATUS.NOT_SUPPORTED_FOR_ACCOUNT) return "Провайдерский остаток не поддерживается для текущего аккаунта.";
  if (row.status === STATUS.MISSING_CLOSING) return "Есть план/движение, но нет нового фактического Остатки за период.";
  if (row.status === STATUS.MISMATCH) return "Расхождение: фактический конечный остаток не равен реальному расчетному остатку.";
  return "Нужна проверка: не хватает данных для полной сверки периода.";
}

function buildDiagnostics({
  status,
  missingAmountNetRows,
  opening,
  displayedFactClosing,
  realDifference,
  realInflow,
  realOutflow,
  lastObservedClosingSnapshot,
  closingSnapshot,
  nearestManualProviderFact,
  to,
}) {
  const categories = [];
  if (status === STATUS.NO_DATA) {
    return {
      categories,
      has_exact_provider_balance: Boolean(closingSnapshot),
      last_observed_balance_date: lastObservedClosingSnapshot?.date || null,
      nearest_manual_provider_fact_date: nearestManualProviderFact?.date || null,
      missing_fact_reason: buildMissingFactReason({ closingSnapshot, nearestManualProviderFact, to }),
      needs_provider_balance_on_target_date: false,
      has_movement: false,
      true_mismatch: false,
    };
  }
  if (status === STATUS.MISMATCH) {
    categories.push("missing ledger movement", "fee/net mismatch", "sign/direction issue", "amount_net issue");
  }
  if (status === STATUS.MISSING_AMOUNT_NET || missingAmountNetRows) categories.push("amount_net issue");
  if (status === STATUS.MISSING_OPENING || opening === null) categories.push("missing opening balance");
  if (status === STATUS.MISSING_PROVIDER || displayedFactClosing === null) categories.push("missing provider balance");
  if (isProviderLimitationStatus(status)) categories.push(status);
  return {
    categories: Array.from(new Set(categories)),
    has_exact_provider_balance: Boolean(closingSnapshot),
    last_observed_balance_date: lastObservedClosingSnapshot?.date || null,
    nearest_manual_provider_fact_date: nearestManualProviderFact?.date || null,
    missing_fact_reason: buildMissingFactReason({ closingSnapshot, nearestManualProviderFact, to }),
    needs_provider_balance_on_target_date: status === STATUS.MISSING_PROVIDER,
    has_movement: Boolean(realInflow || realOutflow || missingAmountNetRows),
    true_mismatch: status === STATUS.MISMATCH && displayedFactClosing !== null && realDifference !== null,
  };
}

function buildFixAction(row) {
  if (row.status === STATUS.OK) return "Действий не требуется.";
  if (row.status === STATUS.CALCULATED_FROM_PREVIOUS) return "Действий не требуется для плановой сверки; при появлении факта добавить его в Остатки.";
  if (row.status === STATUS.CARRIED_FORWARD) return "Проверить позже: добавить новый Остатки, если появится актуальный баланс.";
  if (row.status === STATUS.NO_DATA) return "Игнорировать: нет данных для сверки по этому счету/валюте.";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "Заполнить amount_net у Ledger строк по этому счету/валюте.";
  if (row.status === STATUS.MISSING_OPENING) return "Добавить Остатки до начала периода по этому счету/валюте.";
  if (row.status === STATUS.MISSING_PROVIDER) return "Добавить фактический остаток на дату окончания периода по этому счету/валюте.";
  if (row.status === STATUS.PROVIDER_NOT_IMPLEMENTED) return "Оставить статус в Авто Остатки или добавить ручной факт в Остатки.";
  if (row.status === STATUS.NEEDS_PROVIDER_PERMISSION) return "Настроить разрешение провайдера, затем повторить auto-balance snapshot.";
  if (row.status === STATUS.PROVIDER_ERROR) return "Проверить ошибку провайдера и повторить auto-balance snapshot.";
  if (row.status === STATUS.NOT_SUPPORTED_FOR_ACCOUNT) return "Оставить статус или добавить ручной факт, если провайдер не поддерживает API-баланс.";
  if (row.status === STATUS.MISSING_CLOSING) return "Добавить фактический конечный Остатки за период по этому счету/валюте.";
  if (row.status === STATUS.MISMATCH) return "Проверить Ledger movements, amount_net и строку Остатки за период.";
  return "Проверить дату, счет, валюту и сумму в Ledger/Остатки.";
}

function buildRepairAction(row) {
  if (row.status === STATUS.OK) return "none";
  if (row.status === STATUS.CALCULATED_FROM_PREVIOUS) return "none_calculated_from_previous";
  if (row.status === STATUS.CARRIED_FORWARD) return "confirm_carried_forward_before_append";
  if (row.status === STATUS.NO_DATA) return "ignore_no_data";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "fix_amount_net";
  if (row.status === STATUS.MISSING_OPENING) return "enter_opening_fact";
  if (row.status === STATUS.MISSING_PROVIDER) return "enter_manual_provider_fact";
  if (row.status === STATUS.PROVIDER_NOT_IMPLEMENTED) return "provider_not_implemented_or_enter_manual_fact";
  if (row.status === STATUS.NEEDS_PROVIDER_PERMISSION) return "configure_provider_permission";
  if (row.status === STATUS.PROVIDER_ERROR) return "retry_provider_snapshot";
  if (row.status === STATUS.NOT_SUPPORTED_FOR_ACCOUNT) return "provider_not_supported_or_enter_manual_fact";
  if (row.status === STATUS.MISSING_CLOSING) return "enter_closing_fact";
  if (row.status === STATUS.MISMATCH) return "investigate_mismatch";
  return "needs_verification";
}

function buildRepairTemplate({ status, channel, currency, to, movementDate, calculatedClosing }) {
  if (status === STATUS.MISSING_PROVIDER) {
    return {
      sheet: "Остатки",
      date: to || "",
      channel,
      currency,
      amount: null,
      expected_closing_hint: calculatedClosing,
      safe_fill: "amount must be factual provider/manual balance; expected_closing_hint is not an auto-fill value",
    };
  }
  if (isProviderLimitationStatus(status)) {
    return {
      sheet: "Авто Остатки",
      date: to || "",
      channel,
      currency,
      amount: null,
      provider_status: status,
      safe_fill: "status row is diagnostic only; do not write computed closing as factual balance",
    };
  }
  if (status === STATUS.MISSING_OPENING) {
    return {
      sheet: "Остатки",
      date: previousDate(movementDate || to),
      channel,
      currency,
      amount: null,
      safe_fill: "amount must be factual opening balance before first movement",
    };
  }
  return null;
}

function previousDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function firstMovementDate(real) {
  const dates = (real?.movement_dates || []).filter(Boolean).sort();
  return dates[0] || "";
}

function buildFormula(row) {
  return [
    `opening_fact ${formatValue(row.opening_fact_balance)}`,
    `+ real_delta ${formatValue(row.real_delta)}`,
    `= calculated_closing ${formatValue(row.calculated_closing_balance)}`,
    `; manual_provider_fact ${formatValue(row.manual_provider_closing_balance)}`,
    `; carried_forward ${formatValue(row.carried_forward_balance)}`,
    `; displayed_fact ${formatValue(row.displayed_fact_balance)}`,
    `; fact_source ${formatValue(row.fact_source)}`,
    `; real_difference ${formatValue(row.real_difference)}`,
    `; planned_delta ${formatValue(row.planned_delta)}`,
    `; plan_vs_real_delta ${formatValue(row.plan_vs_real_delta)}`,
  ].join(" ");
}

function getFixPriority(status) {
  const priority = {
    [STATUS.MISSING_AMOUNT_NET]: 0,
    [STATUS.MISMATCH]: 1,
    [STATUS.MISSING_OPENING]: 2,
    [STATUS.MISSING_PROVIDER]: 3,
    [STATUS.NEEDS_PROVIDER_PERMISSION]: 3,
    [STATUS.PROVIDER_NOT_IMPLEMENTED]: 3,
    [STATUS.PROVIDER_ERROR]: 3,
    [STATUS.NOT_SUPPORTED_FOR_ACCOUNT]: 3,
    [STATUS.MISSING_CLOSING]: 4,
    [STATUS.NEEDS_VERIFICATION]: 4,
    [STATUS.CARRIED_FORWARD]: 8,
    [STATUS.CALCULATED_FROM_PREVIOUS]: 8,
    [STATUS.OK]: 9,
    [STATUS.NO_DATA]: 10,
  };
  return priority[status] ?? 99;
}

function resolveCurrencyStatus(statusCounts) {
  if (statusCounts[STATUS.MISSING_AMOUNT_NET] || statusCounts[STATUS.MISMATCH]) return "failed";
  if (statusCounts[STATUS.MISSING_OPENING] || statusCounts[STATUS.MISSING_PROVIDER] || statusCounts[STATUS.MISSING_CLOSING] || statusCounts[STATUS.NEEDS_VERIFICATION] || countProviderLimitationStatuses(statusCounts)) return "blocked";
  if (statusCounts[STATUS.CALCULATED_FROM_PREVIOUS]) return STATUS.CALCULATED_FROM_PREVIOUS;
  if (statusCounts[STATUS.CARRIED_FORWARD]) return STATUS.CARRIED_FORWARD;
  if (statusCounts[STATUS.NO_DATA]) return STATUS.NO_DATA;
  return STATUS.OK;
}

function countProviderLimitationStatuses(statusCounts = {}) {
  return (statusCounts[STATUS.PROVIDER_NOT_IMPLEMENTED] || 0)
    + (statusCounts[STATUS.NEEDS_PROVIDER_PERMISSION] || 0)
    + (statusCounts[STATUS.PROVIDER_ERROR] || 0)
    + (statusCounts[STATUS.NOT_SUPPORTED_FOR_ACCOUNT] || 0);
}

function getMovementChannel(row, amount) {
  const ledger = row?.ledgerV2 || {};
  if (amount !== null && amount < 0) return String(ledger.from_channel || row?.fromChannel || row?.toChannel || "").trim();
  return String(ledger.to_channel || row?.toChannel || row?.fromChannel || "").trim();
}

function emptyMovement() {
  return {
    inflow: 0,
    outflow: 0,
    rows: 0,
    missing_amount_net_rows: 0,
    movement_dates: [],
    income_amount_net: 0,
    expense_amount_net: 0,
    transfer_in: 0,
    transfer_out: 0,
    exchange_delta: 0,
    provider_adjustments: 0,
    income_amount_usd: 0,
    expense_amount_usd: 0,
    transfer_in_usd: 0,
    transfer_out_usd: 0,
    exchange_delta_usd: 0,
    provider_adjustments_usd: 0,
    net_change_usd: 0,
    has_usd_change: false,
  };
}

function makeKey(channel, currency) {
  return `${channel}|${currency}`;
}

function splitKey(key) {
  const [channel, currency] = String(key || "").split("|");
  return [channel || "", currency || ""];
}

function compareRows(left, right) {
  if (left.currency !== right.currency) return left.currency.localeCompare(right.currency);
  return left.channel.localeCompare(right.channel);
}

function isInPeriod(date, { from, to }) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  return "";
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

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "missing";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(round(numeric)) : String(value);
}
