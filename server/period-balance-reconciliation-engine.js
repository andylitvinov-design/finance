import { normalizeBalanceValueContract } from "./balance-native-usd-contract.js";

const STATUS = {
  OK: "ok",
  MISMATCH: "mismatch",
  MISSING_OPENING: "missing_opening_balance",
  MISSING_PROVIDER: "missing_provider_balance",
  MISSING_CLOSING: "missing_closing_balance",
  CARRIED_FORWARD: "carried_forward_conditional",
  MISSING_AMOUNT_NET: "missing_amount_net",
  NEEDS_VERIFICATION: "needs_verification",
  NO_DATA: "no_data",
};

export function buildPeriodBalanceReconciliation({
  operations = [],
  balanceRows = [],
  autoBalanceRows = [],
  plannedRows = [],
  plannedSourceStatus = "",
  period = {},
} = {}) {
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  const warnings = [];
  const periodReal = buildRealMovementIndex(operations, { from, to });
  const planned = buildPlannedMovementIndex(plannedRows, { from, to });
  const balanceIndex = buildBalanceIndex(balanceRows, autoBalanceRows);
  const accountKeys = new Set([
    ...periodReal.byKey.keys(),
    ...planned.byKey.keys(),
    ...balanceIndex.keysBeforePeriod(from),
    ...balanceIndex.keysInPeriod({ from, to }),
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
    actionable_rows: buildActionableRows(rows),
    warnings,
  };
}

function buildAccountRow({ key, operations, planned, balanceIndex, from, to }) {
  const [channel, currency] = splitKey(key);
  if (!channel || !currency) return null;

  const openingSnapshot = balanceIndex.findOpening(key, from);
  const openingBalanceCandidate = openingSnapshot || balanceIndex.findOpeningAny(key, from);
  const closingSnapshot = balanceIndex.findClosing(key, { from, to });
  const exactTargetBalanceCandidate = to ? balanceIndex.findExactAny(key, to) : null;
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
  const missingAmountNetRows = Number(real?.missing_amount_net_rows || 0);

  const calculatedClosing = opening === null ? null : round(opening + realDelta);
  const plannedClosing = opening === null ? null : round(opening + plannedDelta);
  const manualProviderClosing = closingSnapshot?.amount ?? null;
  let closingSource = closingSnapshot ? "exact" : "missing";
  const canCarryForwardClosing = !closingSnapshot
    && !hasMovement
    && !missingAmountNetRows
    && calculatedClosing !== null
    && lastObservedClosingSnapshot;
  const carriedForwardClosing = canCarryForwardClosing ? lastObservedClosingSnapshot.amount : null;
  const displayedFactClosing = manualProviderClosing ?? carriedForwardClosing;
  if (canCarryForwardClosing) {
    closingSource = "carried_forward";
  }
  const factSource = resolveFactSource({ closingSnapshot, canCarryForwardClosing });
  const openingFactValueType = openingSnapshot?.value_type || openingBalanceCandidate?.value_type || null;
  const manualProviderFactValueType = closingSnapshot?.value_type || exactTargetBalanceCandidate?.value_type || null;
  const needsNativeCurrencyValue = needsNativeFactValue({
    openingSnapshot,
    openingBalanceCandidate,
    closingSnapshot,
    exactTargetBalanceCandidate,
  });
  const nativeFactMissingReason = buildNativeFactMissingReason({
    openingSnapshot,
    openingBalanceCandidate,
    closingSnapshot,
    exactTargetBalanceCandidate,
    to,
  });
  const realDifference = displayedFactClosing !== null && calculatedClosing !== null
    ? round(displayedFactClosing - calculatedClosing)
    : null;

  let status = STATUS.OK;
  if (missingAmountNetRows) {
    status = STATUS.MISSING_AMOUNT_NET;
  } else if (canCarryForwardClosing) {
    status = realDifference !== null && Math.abs(realDifference) > 0.0001
      ? STATUS.MISMATCH
      : STATUS.CARRIED_FORWARD;
  } else if (manualProviderClosing === null && hasMovement) {
    status = STATUS.MISSING_PROVIDER;
  } else if (opening === null && (hasMovement || hasPlan)) {
    status = STATUS.MISSING_OPENING;
  } else if (manualProviderClosing === null && !hasMovement && !hasPlan && opening === null) {
    status = STATUS.NO_DATA;
  } else if (manualProviderClosing === null && hasPlan) {
    status = STATUS.MISSING_PROVIDER;
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
    opening_balance_date: openingSnapshot?.date || null,
    opening_balance_source: openingSnapshot ? "exact" : "missing",
    planned_inflow: plannedInflow,
    planned_outflow: plannedOutflow,
    planned_delta: plannedDelta,
    planned_closing_balance: plannedClosing,
    real_inflow: realInflow,
    real_outflow: realOutflow,
    real_delta: realDelta,
    calculated_closing_balance: calculatedClosing,
    computed_real_closing_balance: calculatedClosing,
    manual_provider_closing_balance: roundedManualProviderClosing,
    manual_provider_closing_balance_date: closingSnapshot?.date || null,
    manual_provider_fact_lookup_key: makeLookupKey({ date: to, channel, currency }),
    balanceSource: closingSnapshot ? getResolvedBalanceSource(closingSnapshot) : "missing",
    needsManualConfirmation: closingSnapshot ? getResolvedBalanceSource(closingSnapshot) !== "manual_fact" : true,
    provider: closingSnapshot?.provider || null,
    sourceSheet: closingSnapshot?.sourceSheet || "",
    sourceRow: closingSnapshot?.sourceRow || null,
    sourceComment: closingSnapshot?.comment || "",
    carried_forward_balance: roundedCarriedForwardClosing,
    carried_forward_lookup_key: lastObservedClosingSnapshot
      ? makeLookupKey({ date: lastObservedClosingSnapshot.date, channel, currency })
      : null,
    displayed_fact_balance: roundedDisplayedFactClosing,
    factual_closing_balance: roundedDisplayedFactClosing,
    factual_closing_balance_date: closingSnapshot?.date || (canCarryForwardClosing ? lastObservedClosingSnapshot.date : null),
    closing_balance_source: closingSource,
    fact_source: factSource,
    needs_native_currency_value: needsNativeCurrencyValue,
    opening_fact_value_type: openingFactValueType,
    manual_provider_fact_value_type: manualProviderFactValueType,
    native_fact_missing_reason: nativeFactMissingReason,
    missing_fact_reason: buildMissingFactReason({
      closingSnapshot,
      nearestManualProviderFact,
      to,
    }),
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
      needsNativeCurrencyValue,
      openingFactValueType,
      manualProviderFactValueType,
      nativeFactMissingReason,
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

function resolveFactSource({ closingSnapshot, canCarryForwardClosing }) {
  if (closingSnapshot) return getBalanceFactSource(closingSnapshot);
  if (canCarryForwardClosing) return "carried_forward";
  return "missing";
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

function needsNativeFactValue({
  openingSnapshot,
  openingBalanceCandidate,
  closingSnapshot,
  exactTargetBalanceCandidate,
}) {
  return Boolean(
    (!openingSnapshot && openingBalanceCandidate?.value_type === "usd_only_needs_native") ||
    (!closingSnapshot && exactTargetBalanceCandidate?.value_type === "usd_only_needs_native")
  );
}

function buildNativeFactMissingReason({
  openingSnapshot,
  openingBalanceCandidate,
  closingSnapshot,
  exactTargetBalanceCandidate,
  to,
}) {
  if (!openingSnapshot && openingBalanceCandidate?.value_type === "usd_only_needs_native") {
    return "opening balance has USD equivalent only; native currency amount is required for reconciliation.";
  }
  if (!closingSnapshot && exactTargetBalanceCandidate?.value_type === "usd_only_needs_native") {
    return `period end ${to || "target date"} has USD equivalent only; native currency amount is required for reconciliation.`;
  }
  return null;
}

function getBalanceFactSource(row) {
  const resolved = getResolvedBalanceSource(row);
  if (resolved === "provider_auto") return "provider";
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

    if (balanceAmount >= 0) current.inflow += balanceAmount;
    else current.outflow += Math.abs(balanceAmount);
    current.rows += 1;
    current.movement_dates.push(date);
    byKey.set(key, current);
  }

  return {
    byKey,
    missing_amount_net_rows: missingAmountNetRows,
    paypal_missing_amount_net_rows: paypalMissingAmountNetRows,
  };
}

function getMovementWindowStart(openingDate, from) {
  if (!openingDate) return from;
  const afterOpening = addDays(openingDate, 1);
  if (!from) return afterOpening;
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

function buildBalanceIndex(balanceRows, autoBalanceRows = []) {
  const byKey = new Map();
  const allByKey = new Map();
  for (const row of normalizeBalanceRowsForPriority(balanceRows, autoBalanceRows)) {
    const date = normalizeDate(row?.date);
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    if (!date || !channel || !currency) continue;
    const contract = normalizeBalanceValueContract(row);
    const amount = parseNumber(contract.amount_native);
    const key = makeKey(channel, currency);
    const record = {
      date,
      channel,
      currency,
      amount,
      amount_usd: contract.amount_usd,
      fx_rate_to_usd: contract.fx_rate_to_usd,
      value_type: contract.value_type,
      source: row?.source || row?.fact_source || row?.provider || "",
      balanceSource: getResolvedBalanceSource(row),
      provider: row?.provider || null,
      sourceSheet: row?.sourceSheet || "",
      sourceRow: row?.sourceRow || null,
      comment: row?.comment || "",
    };
    const allRows = allByKey.get(key) || [];
    allRows.push(record);
    allByKey.set(key, allRows);
    if (!isValidNativeBalanceFact(record)) continue;
    const rows = byKey.get(key) || [];
    rows.push(record);
    byKey.set(key, rows);
  }
  for (const rows of byKey.values()) rows.sort(compareBalanceSnapshots);
  for (const rows of allByKey.values()) rows.sort(compareBalanceSnapshots);

  return {
    findOpening(key, from) {
      const rows = byKey.get(key) || [];
      if (!from) return rows[0] || null;
      return rows.filter((row) => row.date < from).at(-1) || null;
    },
    findClosing(key, { from, to }) {
      const rows = byKey.get(key) || [];
      if (to) return rows.find((row) => row.date === to) || null;
      return rows.filter((row) => (!from || row.date >= from)).at(-1) || null;
    },
    findOpeningAny(key, from) {
      const rows = allByKey.get(key) || [];
      if (!from) return rows[0] || null;
      return rows.filter((row) => row.date < from).at(-1) || null;
    },
    findExactAny(key, date) {
      const rows = allByKey.get(key) || [];
      return rows.find((row) => row.date === date) || null;
    },
    findLatestBeforeOrOn(key, to) {
      const rows = byKey.get(key) || [];
      if (!to) return rows.at(-1) || null;
      return rows.filter((row) => row.date <= to).at(-1) || null;
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
    keysBeforePeriod(from) {
      if (!from) return Array.from(allByKey.keys());
      return Array.from(allByKey.entries())
        .filter(([, rows]) => rows.some((row) => row.date < from))
        .map(([key]) => key);
    },
    keysInPeriod(period) {
      return Array.from(allByKey.entries())
        .filter(([, rows]) => rows.some((row) => isInPeriod(row.date, period)))
        .map(([key]) => key);
    },
  };
}

function normalizeBalanceRowsForPriority(balanceRows = [], autoBalanceRows = []) {
  return [
    ...(balanceRows || []).map((row) => ({
      ...row,
      balanceSource: getResolvedBalanceSource(row),
      sourceSheet: row?.sourceSheet || "Остатки",
    })),
    ...(autoBalanceRows || []).map((row) => ({
      ...row,
      balanceSource: "provider_auto",
      source: row?.source || "provider_auto",
      sourceSheet: row?.sourceSheet || "Авто Остатки",
    })),
  ];
}

function compareBalanceSnapshots(left, right) {
  const dateDiff = left.date.localeCompare(right.date);
  if (dateDiff) return dateDiff;
  return balanceSourcePriority(left) - balanceSourcePriority(right);
}

function balanceSourcePriority(row) {
  return getResolvedBalanceSource(row) === "manual_fact" ? 0 : 1;
}

function getResolvedBalanceSource(row = {}) {
  const explicit = String(row?.balanceSource || row?.balance_source || "").trim();
  if (explicit === "manual_fact" || explicit === "provider_auto" || explicit === "missing") return explicit;
  const source = normalizeText(`${row?.source || ""} ${row?.fact_source || ""} ${row?.provider || ""} ${row?.comment || ""}`);
  if (/wise auto snapshot|auto daily provider snapshot|provider snapshot|auto snapshot/.test(source)) return "provider_auto";
  if (/wise auto|paypal auto|binance auto|monobank auto|privatbank auto|yoomoney auto|provider auto/.test(source)) return "provider_auto";
  if (/provider|wise|paypal|binance|mono|monobank|privat|yoomoney|провайдер|банк/.test(source)) return "provider_auto";
  return "manual_fact";
}

function isValidNativeBalanceFact(row) {
  return row.amount !== null && ["native_and_usd", "native_only", "explicit_zero"].includes(row.value_type);
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

function buildSummary(rows, { missingAmountNetRows, plannedRows, plannedSourceStatus }) {
  const statusCounts = {};
  for (const row of rows || []) statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
  const failed = statusCounts[STATUS.MISMATCH] || 0;
  const incomplete = (statusCounts[STATUS.MISSING_OPENING] || 0)
    + (statusCounts[STATUS.MISSING_PROVIDER] || 0)
    + (statusCounts[STATUS.MISSING_CLOSING] || 0)
    + (statusCounts[STATUS.MISSING_AMOUNT_NET] || 0)
    + (statusCounts[STATUS.NEEDS_VERIFICATION] || 0);

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
      [STATUS.NEEDS_VERIFICATION]: statusCounts[STATUS.NEEDS_VERIFICATION] || 0,
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
  if (row.status === STATUS.CARRIED_FORWARD) return "Условно перенесено: за период нет движений и нет нового остатка, использован остаток прошлого периода.";
  if (row.status === STATUS.NO_DATA) return "Нет данных для сверки: нет начального остатка, движения, плана и факта.";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "Есть Ledger строки без amount_net; реальное изменение баланса нельзя считать полным.";
  if (row.status === STATUS.MISSING_OPENING) return "Нет начального Остатки перед периодом, но есть план/движение.";
  if (row.status === STATUS.MISSING_PROVIDER) return "Нет фактического остатка на дату; сверка по этому счету заблокирована до ввода баланса провайдера.";
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
  needsNativeCurrencyValue,
  openingFactValueType,
  manualProviderFactValueType,
  nativeFactMissingReason,
  to,
}) {
  const categories = [];
  const nativeDiagnostics = {
    needs_native_currency_value: Boolean(needsNativeCurrencyValue),
    opening_fact_value_type: openingFactValueType || null,
    manual_provider_fact_value_type: manualProviderFactValueType || null,
    native_fact_missing_reason: nativeFactMissingReason || null,
  };
  if (status === STATUS.NO_DATA) {
    return {
      ...nativeDiagnostics,
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
  if (needsNativeCurrencyValue) categories.push("missing native currency balance");
  return {
    ...nativeDiagnostics,
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
  if (row.status === STATUS.CARRIED_FORWARD) return "Проверить позже: добавить новый Остатки, если появится актуальный баланс.";
  if (row.status === STATUS.NO_DATA) return "Игнорировать: нет данных для сверки по этому счету/валюте.";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "Заполнить amount_net у Ledger строк по этому счету/валюте.";
  if (row.status === STATUS.MISSING_OPENING) return "Добавить Остатки до начала периода по этому счету/валюте.";
  if (row.status === STATUS.MISSING_PROVIDER) return "Добавить фактический остаток на дату окончания периода по этому счету/валюте.";
  if (row.status === STATUS.MISSING_CLOSING) return "Добавить фактический конечный Остатки за период по этому счету/валюте.";
  if (row.status === STATUS.MISMATCH) return "Проверить Ledger movements, amount_net и строку Остатки за период.";
  return "Проверить дату, счет, валюту и сумму в Ledger/Остатки.";
}

function buildRepairAction(row) {
  if (row.status === STATUS.OK) return "none";
  if (row.status === STATUS.CARRIED_FORWARD) return "confirm_carried_forward_before_append";
  if (row.status === STATUS.NO_DATA) return "ignore_no_data";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "fix_amount_net";
  if (row.status === STATUS.MISSING_OPENING) return "enter_opening_fact";
  if (row.status === STATUS.MISSING_PROVIDER) return "enter_manual_provider_fact";
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
    [STATUS.MISSING_CLOSING]: 4,
    [STATUS.NEEDS_VERIFICATION]: 4,
    [STATUS.CARRIED_FORWARD]: 8,
    [STATUS.OK]: 9,
    [STATUS.NO_DATA]: 10,
  };
  return priority[status] ?? 99;
}

function resolveCurrencyStatus(statusCounts) {
  if (statusCounts[STATUS.MISSING_AMOUNT_NET] || statusCounts[STATUS.MISMATCH]) return "failed";
  if (statusCounts[STATUS.MISSING_OPENING] || statusCounts[STATUS.MISSING_PROVIDER] || statusCounts[STATUS.MISSING_CLOSING] || statusCounts[STATUS.NEEDS_VERIFICATION]) return "blocked";
  if (statusCounts[STATUS.CARRIED_FORWARD]) return STATUS.CARRIED_FORWARD;
  if (statusCounts[STATUS.NO_DATA]) return STATUS.NO_DATA;
  return STATUS.OK;
}

function getMovementChannel(row, amount) {
  const ledger = row?.ledgerV2 || {};
  if (amount !== null && amount < 0) return String(ledger.from_channel || row?.fromChannel || row?.toChannel || "").trim();
  return String(ledger.to_channel || row?.toChannel || row?.fromChannel || "").trim();
}

function emptyMovement() {
  return { inflow: 0, outflow: 0, rows: 0, missing_amount_net_rows: 0, movement_dates: [] };
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
