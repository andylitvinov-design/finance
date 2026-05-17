const STATUS = {
  OK: "ok",
  MISMATCH: "mismatch",
  MISSING_OPENING: "missing_opening_balance",
  MISSING_CLOSING: "missing_closing_balance",
  CARRIED_FORWARD: "carried_forward_conditional",
  MISSING_AMOUNT_NET: "missing_amount_net",
  NEEDS_VERIFICATION: "needs_verification",
};

export function buildPeriodBalanceReconciliation({
  operations = [],
  balanceRows = [],
  plannedRows = [],
  plannedSourceStatus = "",
  period = {},
} = {}) {
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  const warnings = [];
  const periodReal = buildRealMovementIndex(operations, { from, to });
  const planned = buildPlannedMovementIndex(plannedRows, { from, to });
  const balanceIndex = buildBalanceIndex(balanceRows);
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
  const closingSnapshot = balanceIndex.findClosing(key, { from, to });
  const realFrom = getMovementWindowStart(openingSnapshot?.date, from);
  const real = buildRealMovementIndex(operations, { from: realFrom, to }).byKey.get(key);
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

  const computedRealClosing = opening === null ? null : round(opening + realDelta);
  const plannedClosing = opening === null ? null : round(opening + plannedDelta);
  let factualClosing = closingSnapshot?.amount ?? null;
  let closingSource = closingSnapshot ? "exact" : "missing";

  let status = STATUS.OK;
  if (missingAmountNetRows) {
    status = STATUS.MISSING_AMOUNT_NET;
  } else if (opening === null && (hasMovement || hasPlan)) {
    status = STATUS.MISSING_OPENING;
  } else if (factualClosing === null && !hasMovement && !hasPlan && opening !== null) {
    factualClosing = opening;
    closingSource = "carried_forward";
    status = STATUS.CARRIED_FORWARD;
  } else if (factualClosing === null && (hasMovement || hasPlan)) {
    status = STATUS.MISSING_CLOSING;
  } else if (computedRealClosing !== null && factualClosing !== null && Math.abs(round(factualClosing - computedRealClosing)) > 0.0001) {
    status = STATUS.MISMATCH;
  }

  const realDifference = factualClosing !== null && computedRealClosing !== null
    ? round(factualClosing - computedRealClosing)
    : null;
  const planVsRealDelta = round(realDelta - plannedDelta);

  const row = {
    channel,
    currency,
    opening_balance: opening === null ? null : round(opening),
    opening_balance_date: openingSnapshot?.date || null,
    opening_balance_source: openingSnapshot ? "exact" : "missing",
    planned_inflow: plannedInflow,
    planned_outflow: plannedOutflow,
    planned_delta: plannedDelta,
    planned_closing_balance: plannedClosing,
    real_inflow: realInflow,
    real_outflow: realOutflow,
    real_delta: realDelta,
    computed_real_closing_balance: computedRealClosing,
    factual_closing_balance: factualClosing === null ? null : round(factualClosing),
    factual_closing_balance_date: closingSnapshot?.date || null,
    closing_balance_source: closingSource,
    real_difference: realDifference,
    plan_vs_real_delta: planVsRealDelta,
    movement_rows: Number(real?.rows || 0),
    planned_rows: Number(planned?.rows || 0),
    missing_amount_net_rows: missingAmountNetRows,
    status,
  };

  return {
    ...row,
    diagnosis: buildDiagnosis(row),
    fix_action: buildFixAction(row),
    formula: buildFormula(row),
    fix_priority: getFixPriority(row.status),
  };
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
      byKey.set(key, current);
      continue;
    }
    if (balanceAmount === null) continue;

    if (balanceAmount >= 0) current.inflow += balanceAmount;
    else current.outflow += Math.abs(balanceAmount);
    current.rows += 1;
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

function buildBalanceIndex(balanceRows) {
  const byKey = new Map();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    if (!date || !channel || !currency || amount === null) continue;
    const key = makeKey(channel, currency);
    const rows = byKey.get(key) || [];
    rows.push({ date, channel, currency, amount });
    byKey.set(key, rows);
  }
  for (const rows of byKey.values()) rows.sort((left, right) => left.date.localeCompare(right.date));

  return {
    findOpening(key, from) {
      const rows = byKey.get(key) || [];
      if (!from) return rows[0] || null;
      return rows.filter((row) => row.date < from).at(-1) || null;
    },
    findClosing(key, { from, to }) {
      const rows = byKey.get(key) || [];
      return rows.filter((row) => (!from || row.date >= from) && (!to || row.date <= to)).at(-1) || null;
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
  };
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
  const failed = (statusCounts[STATUS.MISMATCH] || 0) + Number(missingAmountNetRows || 0);
  const incomplete = (statusCounts[STATUS.MISSING_OPENING] || 0)
    + (statusCounts[STATUS.MISSING_CLOSING] || 0)
    + (statusCounts[STATUS.NEEDS_VERIFICATION] || 0);

  return {
    status: failed ? "failed" : incomplete ? "needs_verification" : "ok",
    positions_checked: rows.length,
    currencies_checked: new Set((rows || []).map((row) => row.currency)).size,
    channels_checked: new Set((rows || []).map((row) => row.channel)).size,
    planned_rows: Number(plannedRows || 0),
    planned_source_status: plannedRows ? "ok" : (plannedSourceStatus === "available" ? "available_empty" : "needs_verification"),
    missing_amount_net_rows: Number(missingAmountNetRows || 0),
    status_counts: {
      [STATUS.OK]: statusCounts[STATUS.OK] || 0,
      [STATUS.MISMATCH]: statusCounts[STATUS.MISMATCH] || 0,
      [STATUS.MISSING_OPENING]: statusCounts[STATUS.MISSING_OPENING] || 0,
      [STATUS.MISSING_CLOSING]: statusCounts[STATUS.MISSING_CLOSING] || 0,
      [STATUS.CARRIED_FORWARD]: statusCounts[STATUS.CARRIED_FORWARD] || 0,
      [STATUS.MISSING_AMOUNT_NET]: statusCounts[STATUS.MISSING_AMOUNT_NET] || 0,
      [STATUS.NEEDS_VERIFICATION]: statusCounts[STATUS.NEEDS_VERIFICATION] || 0,
    },
  };
}

function buildActionableRows(rows) {
  return (rows || [])
    .filter((row) => row.status !== STATUS.OK && row.status !== STATUS.CARRIED_FORWARD)
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
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "Есть Ledger строки без amount_net; реальное изменение баланса нельзя считать полным.";
  if (row.status === STATUS.MISSING_OPENING) return "Нет начального Остатки перед периодом, но есть план/движение.";
  if (row.status === STATUS.MISSING_CLOSING) return "Есть план/движение, но нет нового фактического Остатки за период.";
  if (row.status === STATUS.MISMATCH) return "Расхождение: фактический конечный остаток не равен реальному расчетному остатку.";
  return "Нужна проверка: не хватает данных для полной сверки периода.";
}

function buildFixAction(row) {
  if (row.status === STATUS.OK) return "Действий не требуется.";
  if (row.status === STATUS.CARRIED_FORWARD) return "Проверить позже: добавить новый Остатки, если появится актуальный баланс.";
  if (row.status === STATUS.MISSING_AMOUNT_NET) return "Заполнить amount_net у Ledger строк по этому счету/валюте.";
  if (row.status === STATUS.MISSING_OPENING) return "Добавить Остатки до начала периода по этому счету/валюте.";
  if (row.status === STATUS.MISSING_CLOSING) return "Добавить фактический конечный Остатки за период по этому счету/валюте.";
  if (row.status === STATUS.MISMATCH) return "Проверить Ledger movements, amount_net и строку Остатки за период.";
  return "Проверить дату, счет, валюту и сумму в Ledger/Остатки.";
}

function buildFormula(row) {
  return [
    `opening ${formatValue(row.opening_balance)}`,
    `+ real_delta ${formatValue(row.real_delta)}`,
    `= computed_real_closing ${formatValue(row.computed_real_closing_balance)}`,
    `; fact ${formatValue(row.factual_closing_balance)}`,
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
    [STATUS.MISSING_CLOSING]: 3,
    [STATUS.NEEDS_VERIFICATION]: 4,
    [STATUS.CARRIED_FORWARD]: 8,
    [STATUS.OK]: 9,
  };
  return priority[status] ?? 99;
}

function resolveCurrencyStatus(statusCounts) {
  if (statusCounts[STATUS.MISSING_AMOUNT_NET] || statusCounts[STATUS.MISMATCH]) return "failed";
  if (statusCounts[STATUS.MISSING_OPENING] || statusCounts[STATUS.MISSING_CLOSING] || statusCounts[STATUS.NEEDS_VERIFICATION]) return "needs_verification";
  if (statusCounts[STATUS.CARRIED_FORWARD]) return STATUS.CARRIED_FORWARD;
  return STATUS.OK;
}

function getMovementChannel(row, amount) {
  const ledger = row?.ledgerV2 || {};
  if (amount !== null && amount < 0) return String(ledger.from_channel || row?.fromChannel || row?.toChannel || "").trim();
  return String(ledger.to_channel || row?.toChannel || row?.fromChannel || "").trim();
}

function emptyMovement() {
  return { inflow: 0, outflow: 0, rows: 0, missing_amount_net_rows: 0 };
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
