import fs from "node:fs";
import path from "node:path";

const STATUS = {
  OK: "ok",
  COMPUTED_FROM_PREVIOUS_DAY: "computed_from_previous_day",
  MANUAL_FACT: "manual_fact",
  PROVIDER_AUTO: "provider_auto",
  PROVIDER_DERIVED: "provider_derived",
  MISMATCH: "mismatch",
  MISSING_OPENING: "missing_opening_balance",
  MISSING_PROVIDER: "missing_provider_balance",
  NEEDS_PROVIDER_PERMISSION: "needs_provider_permission",
  PROVIDER_NOT_IMPLEMENTED: "provider_not_implemented",
  PROVIDER_ERROR: "provider_error",
  MISSING_AMOUNT_NET: "missing_amount_net",
  NEEDS_VERIFICATION: "needs_verification",
};

const PROVIDER_STATUS_PRIORITY = [
  STATUS.NEEDS_PROVIDER_PERMISSION,
  STATUS.PROVIDER_ERROR,
  STATUS.PROVIDER_NOT_IMPLEMENTED,
  STATUS.MISSING_PROVIDER,
];

export function buildDailyCurrencyBalances(operations = [], balanceRows = [], options = {}) {
  if (options?.period) {
    return buildDailyBalanceCoverage({
      operations,
      balanceRows,
      period: options.period,
      activePairs: options.activePairs,
      configuredChannels: options.configuredChannels,
    });
  }

  const movements = buildMovements(operations);
  const balanceIndex = buildBalanceIndex(balanceRows);
  const rows = [];

  for (const movementRows of movements.byKey.values()) {
    let carriedOpening = null;
    let lastMovementDate = null;
    for (const movement of movementRows) {
      const openingSnapshot = findOpeningSnapshot(movement, balanceIndex);
      const hasNewOpeningAnchor = openingSnapshot && (!lastMovementDate || openingSnapshot.date > lastMovementDate);
      const opening = carriedOpening === null || hasNewOpeningAnchor
        ? (openingSnapshot?.amount ?? null)
        : carriedOpening;
      const providerReported = balanceIndex.byDateKey.get(`${movement.date}|${movement.key}`)?.amount ?? null;
      const needsVerification = balanceIndex.incompleteDateKeys.has(`${movement.date}|${movement.channel}`);
      const closing = opening === null ? null : round(opening + movement.net_change);
      const difference = providerReported !== null && closing !== null ? round(providerReported - closing) : null;
      const status = resolveStatus({
        needsVerification,
        opening,
        providerReported,
        difference,
      });

      rows.push({
        date: movement.date,
        channel: movement.channel,
        currency: movement.currency,
        opening_balance: opening === null ? null : round(opening),
        inflow: round(movement.inflow),
        outflow: round(movement.outflow),
        net_change: round(movement.net_change),
        closing_balance: closing,
        provider_reported_balance: providerReported === null ? null : round(providerReported),
        difference,
        status,
        ...buildMissingProviderContext({
          status,
          movement,
          closing,
          balanceIndex,
        }),
      });

      const providerSnapshot = balanceIndex.byDateKey.get(`${movement.date}|${movement.key}`) || null;
      carriedOpening = shouldCarryComputedClosing({ status, closing, providerReported, providerSnapshot })
        ? closing
        : providerReported ?? closing;
      lastMovementDate = movement.date;
    }
  }

  rows.sort(compareMovementRows);

  const status_counts = buildStatusCounts(rows, [
    STATUS.OK,
    STATUS.MISMATCH,
    STATUS.MISSING_OPENING,
    STATUS.MISSING_PROVIDER,
    STATUS.NEEDS_VERIFICATION,
  ]);

  return {
    rows,
    actionable_rows: buildActionableRows(rows),
    summary: {
      rows: rows.length,
      mismatch_rows: status_counts[STATUS.MISMATCH],
      missing_opening_balance_rows: status_counts[STATUS.MISSING_OPENING],
      missing_provider_balance_rows: status_counts[STATUS.MISSING_PROVIDER],
      excluded_missing_amount_net_rows: movements.excluded_missing_amount_net_rows,
      status_counts,
    },
  };
}

export function buildDailyBalanceCoverage({
  operations = [],
  balanceRows = [],
  period = {},
  activePairs = [],
  configuredChannels,
} = {}) {
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  const dates = buildDateRange(from, to);
  const movements = buildMovements(operations, { includeMissingAmountNetRows: true });
  const balanceIndex = buildCoverageBalanceIndex(balanceRows);
  const pairs = buildActivePairs({
    operations,
    balanceRows,
    activePairs,
    configuredChannels,
  });
  const rows = [];

  for (const pair of pairs) {
    const key = makeKey(pair.channel, pair.currency);
    const openingSnapshot = findCoverageOpeningSnapshot(balanceIndex, key, from);
    let opening = openingSnapshot?.amount ?? null;
    let blockedByMissingNet = false;

    for (const date of dates) {
      const movement = movements.byDateKey.get(`${date}|${key}`) || emptyMovementRow({ date, pair, key });
      const missingNetCount = movement.missing_amount_net_rows || 0;
      if (missingNetCount) blockedByMissingNet = true;

      const manualSnapshot = balanceIndex.manualByDateKey.get(`${date}|${key}`) || null;
      const autoSnapshot = balanceIndex.autoByDateKey.get(`${date}|${key}`) || null;
      const providerStatus = selectProviderStatus(balanceIndex.statusByDateKey.get(`${date}|${key}`) || []);
      const computedClosing = opening === null || blockedByMissingNet
        ? null
        : round(opening + movement.net_change);
      const resolved = resolveCoverageFinal({
        opening,
        computedClosing,
        manualSnapshot,
        autoSnapshot,
        providerStatus,
        missingNetCount,
        blockedByMissingNet,
      });

      rows.push({
        date,
        channel: pair.channel,
        currency: pair.currency,
        opening_balance: opening === null ? null : round(opening),
        ledger_inflow: round(movement.inflow),
        ledger_outflow: round(movement.outflow),
        ledger_delta: round(movement.net_change),
        computed_closing_balance: computedClosing,
        manual_balance_snapshot: manualSnapshot ? buildSnapshotDiagnostic(manualSnapshot) : null,
        auto_provider_balance_snapshot: autoSnapshot ? buildSnapshotDiagnostic(autoSnapshot) : null,
        provider_status: providerStatus?.status || null,
        final_balance: resolved.final_balance,
        source: resolved.source,
        difference: resolved.difference,
        status: resolved.status,
        missing_amount_net_rows: missingNetCount,
        opening_balance_source: openingSnapshot ? "snapshot" : "missing",
        opening_balance_date: openingSnapshot?.date || null,
        inflow: round(movement.inflow),
        outflow: round(movement.outflow),
        net_change: round(movement.net_change),
        closing_balance: computedClosing,
        provider_reported_balance: resolved.provider_reported_balance,
      });

      if (computedClosing !== null && !blockedByMissingNet) {
        opening = computedClosing;
      }
    }
  }

  rows.sort(compareMovementRows);
  const status_counts = buildStatusCounts(rows);
  const expectedRows = dates.length * pairs.length;
  const missingDatesPreview = buildMissingDatesPreview({ rows, dates, pairs });

  return {
    rows,
    actionable_rows: buildActionableRows(rows),
    summary: {
      rows: rows.length,
      period_from: from || "needs verification",
      period_to: to || "needs verification",
      period_days: dates.length,
      active_pairs: pairs.length,
      expected_rows: expectedRows,
      actual_rows: rows.length,
      complete: Boolean(dates.length && rows.length === expectedRows && missingDatesPreview.length === 0),
      mismatch_rows: status_counts[STATUS.MISMATCH],
      missing_opening_balance_rows: status_counts[STATUS.MISSING_OPENING],
      missing_provider_balance_rows: status_counts[STATUS.MISSING_PROVIDER],
      computed_from_previous_day_rows: status_counts[STATUS.COMPUTED_FROM_PREVIOUS_DAY],
      provider_auto_rows: status_counts[STATUS.PROVIDER_AUTO],
      manual_fact_rows: status_counts[STATUS.MANUAL_FACT],
      provider_status_rows: countProviderStatusRows(status_counts),
      missing_amount_net_rows: status_counts[STATUS.MISSING_AMOUNT_NET],
      excluded_missing_amount_net_rows: movements.excluded_missing_amount_net_rows,
      status_counts,
      missing_dates_preview: missingDatesPreview,
    },
  };
}

function buildMovements(operations, { includeMissingAmountNetRows = false } = {}) {
  const grouped = new Map();
  let excludedMissingAmountNetRows = 0;

  for (const operation of operations || []) {
    const ledger = operation?.ledgerV2 || {};
    const date = normalizeDate(operation?.date ?? ledger.date);
    const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
    const amount = parseNumber(ledger.balance_amount ?? operation?.balanceAmount);
    const channel = amount === null ? getMovementChannel(operation, 1) : getMovementChannel(operation, amount);
    const key = channel && currency ? makeKey(channel, currency) : "";
    const dateKey = date && key ? `${date}|${key}` : "";

    if (!String(ledger.amount_net ?? operation?.amountNet ?? operation?.amount_net ?? "").trim()) {
      excludedMissingAmountNetRows += 1;
      if (includeMissingAmountNetRows && dateKey) {
        const current = grouped.get(dateKey) || {
          date,
          channel,
          currency,
          key,
          inflow: 0,
          outflow: 0,
          net_change: 0,
          missing_amount_net_rows: 0,
        };
        current.missing_amount_net_rows += 1;
        grouped.set(dateKey, current);
      }
      continue;
    }

    if (amount === null || !date || !currency) continue;

    if (!channel) continue;

    const current = grouped.get(dateKey) || {
      date,
      channel,
      currency,
      key,
      inflow: 0,
      outflow: 0,
      net_change: 0,
      missing_amount_net_rows: 0,
    };

    if (amount >= 0) current.inflow += amount;
    else current.outflow += Math.abs(amount);
    current.net_change += amount;
    grouped.set(dateKey, current);
  }

  const rows = Array.from(grouped.values()).sort(compareMovementRows);
  const byKey = new Map();
  const byDateKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.key)) byKey.set(row.key, []);
    byKey.get(row.key).push(row);
    byDateKey.set(`${row.date}|${row.key}`, row);
  }

  return {
    rows,
    byKey,
    byDateKey,
    excluded_missing_amount_net_rows: excludedMissingAmountNetRows,
  };
}

function buildBalanceIndex(balanceRows) {
  const byKey = new Map();
  const byDateKey = new Map();
  const incompleteDateKeys = new Set();

  // Balance snapshots are EOD 23:59. Same-day movements are included in the
  // snapshot and must not be counted again after that snapshot.
  // A prior snapshot is used as the next day's opening balance; a same-day
  // snapshot is compared against computed closing as provider_reported_balance.
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);

    if (!date || !channel) continue;
    if (!currency || amount === null) {
      incompleteDateKeys.add(`${date}|${channel}`);
      continue;
    }

    const key = makeKey(channel, currency);
    const normalized = {
      date,
      channel,
      currency,
      key,
      amount,
      source: String(row?.source || row?.balanceSource || row?.balance_source || row?.fact_source || "").trim(),
      sourceSheet: String(row?.sourceSheet || row?.source_sheet || "").trim(),
      sourceRow: row?.sourceRow || row?.source_row || null,
      provider: String(row?.provider || "").trim(),
      comment: String(row?.comment || "").trim(),
    };
    byDateKey.set(`${date}|${key}`, normalized);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(normalized);
  }

  for (const rows of byKey.values()) {
    rows.sort((left, right) => left.date.localeCompare(right.date));
  }

  return { byKey, byDateKey, incompleteDateKeys };
}

function buildMissingProviderContext({ status, movement, closing, balanceIndex }) {
  if (status !== STATUS.MISSING_PROVIDER) return {};
  const laterSnapshot = findNearestLaterSnapshot(movement, balanceIndex);
  if (!laterSnapshot) {
    return {
      missing_provider_balance_context: "no_later_fact",
      missing_provider_balance_reason: `No provider/manual fact exists for ${movement.date} ${movement.channel} ${movement.currency}.`,
    };
  }
  const amount = round(laterSnapshot.amount);
  return {
    missing_provider_balance_context: "later_fact_exists",
    missing_provider_balance_reason: `Provider/manual fact exists for ${laterSnapshot.date}, but exact same-day fact is missing for ${movement.date}.`,
    nearest_later_provider_fact_date: laterSnapshot.date,
    nearest_later_provider_fact_amount: amount,
    nearest_later_provider_fact_source: laterSnapshot.source || "",
    nearest_later_provider_fact_source_sheet: laterSnapshot.sourceSheet || "",
    nearest_later_provider_fact_source_row: laterSnapshot.sourceRow || null,
    later_provider_fact_difference: closing === null ? null : round(amount - closing),
  };
}

function findNearestLaterSnapshot(movement, balanceIndex) {
  const snapshots = balanceIndex.byKey.get(movement.key) || [];
  return snapshots.find((row) => row.date > movement.date && row.amount !== null) || null;
}

function buildCoverageBalanceIndex(balanceRows) {
  const allByKey = new Map();
  const manualByDateKey = new Map();
  const autoByDateKey = new Map();
  const statusByDateKey = new Map();

  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const key = makeKey(channel, currency);
    if (!date || !channel || !currency) continue;

    const status = normalizeProviderStatus(row?.status || row?.autoBalanceStatus || row?.auto_balance_status);
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    const normalized = {
      date,
      channel,
      currency,
      key,
      amount,
      status,
      source: String(row?.source || row?.balanceSource || row?.balance_source || row?.fact_source || "").trim(),
      sourceSheet: String(row?.sourceSheet || row?.source_sheet || "").trim(),
      provider: String(row?.provider || "").trim(),
      sourceRow: row?.sourceRow || row?.source_row || null,
      comment: String(row?.comment || "").trim(),
      sourceType: getCoverageSourceType(row),
    };
    const dateKey = `${date}|${key}`;

    if (amount !== null) {
      addBalanceSnapshot(allByKey, normalized);
      if (normalized.sourceType === "manual_fact") {
        setPreferredSnapshot(manualByDateKey, dateKey, normalized);
      } else {
        setPreferredSnapshot(autoByDateKey, dateKey, normalized);
      }
      continue;
    }

    if (status) {
      const rows = statusByDateKey.get(dateKey) || [];
      rows.push(normalized);
      statusByDateKey.set(dateKey, rows);
    }
  }

  for (const rows of allByKey.values()) {
    rows.sort((left, right) => left.date.localeCompare(right.date) || sourcePriority(left) - sourcePriority(right));
  }

  return { allByKey, manualByDateKey, autoByDateKey, statusByDateKey };
}

function addBalanceSnapshot(map, row) {
  const rows = map.get(row.key) || [];
  rows.push(row);
  map.set(row.key, rows);
}

function setPreferredSnapshot(map, key, row) {
  const existing = map.get(key);
  if (!existing || sourcePriority(row) < sourcePriority(existing)) map.set(key, row);
}

function findOpeningBalance(movement, balanceIndex) {
  const openingSnapshot = findOpeningSnapshot(movement, balanceIndex);
  return openingSnapshot ? round(openingSnapshot.amount) : null;
}

function findOpeningSnapshot(movement, balanceIndex) {
  const snapshots = balanceIndex.byKey.get(movement.key) || [];
  const openingSnapshot = snapshots.filter((row) => row.date < movement.date).at(-1);
  if (!openingSnapshot) return null;
  return {
    ...openingSnapshot,
    amount: round(openingSnapshot.amount),
  };
}

function findCoverageOpeningSnapshot(balanceIndex, key, from) {
  const snapshots = balanceIndex.allByKey.get(key) || [];
  const candidates = snapshots.filter((row) => row.amount !== null && (!from || row.date < from));
  if (!candidates.length) return null;
  return candidates.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return sourcePriority(left) - sourcePriority(right);
  }).at(-1);
}

function resolveCoverageFinal({
  opening,
  computedClosing,
  manualSnapshot,
  autoSnapshot,
  providerStatus,
  missingNetCount,
  blockedByMissingNet,
}) {
  if (missingNetCount || blockedByMissingNet) {
    return {
      final_balance: null,
      source: "missing_amount_net",
      difference: null,
      provider_reported_balance: snapshotAmount(manualSnapshot) ?? snapshotAmount(autoSnapshot),
      status: STATUS.MISSING_AMOUNT_NET,
    };
  }
  if (opening === null) {
    if (providerStatus?.status && isProviderStatus(providerStatus.status)) {
      return {
        final_balance: null,
        source: "provider_status",
        difference: null,
        provider_reported_balance: snapshotAmount(manualSnapshot) ?? snapshotAmount(autoSnapshot),
        status: providerStatus.status,
      };
    }
    return {
      final_balance: null,
      source: "missing_opening_balance",
      difference: null,
      provider_reported_balance: snapshotAmount(manualSnapshot) ?? snapshotAmount(autoSnapshot),
      status: STATUS.MISSING_OPENING,
    };
  }

  if (manualSnapshot?.amount !== null && manualSnapshot?.amount !== undefined) {
    return resolveSnapshotStatus({
      snapshot: manualSnapshot,
      computedClosing,
      matchedStatus: STATUS.MANUAL_FACT,
      source: "manual_fact",
    });
  }
  if (autoSnapshot?.amount !== null && autoSnapshot?.amount !== undefined) {
    const source = autoSnapshot.sourceType === "derived_balance" ? "provider_derived" : "provider_auto";
    const matchedStatus = autoSnapshot.sourceType === "derived_balance"
      ? STATUS.PROVIDER_DERIVED
      : STATUS.PROVIDER_AUTO;
    return resolveSnapshotStatus({ snapshot: autoSnapshot, computedClosing, matchedStatus, source });
  }
  if (providerStatus?.status && isProviderStatus(providerStatus.status)) {
    return {
      final_balance: computedClosing,
      source: "computed_daily_balance",
      difference: null,
      provider_reported_balance: null,
      status: providerStatus.status,
    };
  }
  return {
    final_balance: computedClosing,
    source: "computed_daily_balance",
    difference: null,
    provider_reported_balance: null,
    status: STATUS.COMPUTED_FROM_PREVIOUS_DAY,
  };
}

function resolveSnapshotStatus({ snapshot, computedClosing, matchedStatus, source }) {
  const amount = round(snapshot.amount);
  const difference = computedClosing === null ? null : round(amount - computedClosing);
  return {
    final_balance: amount,
    source,
    difference,
    provider_reported_balance: amount,
    status: difference !== null && Math.abs(difference) > 0.0001 ? STATUS.MISMATCH : matchedStatus,
  };
}

function shouldCarryComputedClosing({ status, closing, providerReported, providerSnapshot }) {
  if (closing === null) return false;
  if (status !== STATUS.MISMATCH || providerReported === null) return true;
  return isProviderAutoSnapshot(providerSnapshot);
}

function isProviderAutoSnapshot(row) {
  const text = [
    row?.source,
    row?.sourceSheet,
    row?.comment,
  ].map((value) => String(value || "").trim().toLowerCase()).join(" ");
  return /provider_auto|авто остатки|wise auto snapshot|auto daily provider snapshot|provider snapshot|auto snapshot/.test(text);
}

function resolveStatus({ needsVerification, opening, providerReported, difference }) {
  if (needsVerification) return STATUS.NEEDS_VERIFICATION;
  if (opening === null) return STATUS.MISSING_OPENING;
  if (difference !== null && Math.abs(difference) > 0.0001) return STATUS.MISMATCH;
  if (providerReported === null) return STATUS.MISSING_PROVIDER;
  return STATUS.OK;
}

function buildStatusCounts(rows, statuses = [
  STATUS.OK,
  STATUS.COMPUTED_FROM_PREVIOUS_DAY,
  STATUS.MANUAL_FACT,
  STATUS.PROVIDER_AUTO,
  STATUS.PROVIDER_DERIVED,
  STATUS.MISMATCH,
  STATUS.MISSING_OPENING,
  STATUS.MISSING_PROVIDER,
  STATUS.NEEDS_PROVIDER_PERMISSION,
  STATUS.PROVIDER_NOT_IMPLEMENTED,
  STATUS.PROVIDER_ERROR,
  STATUS.MISSING_AMOUNT_NET,
  STATUS.NEEDS_VERIFICATION,
]) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const row of rows || []) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }
  return counts;
}

function buildActionableRows(rows) {
  const priority = {
    [STATUS.MISMATCH]: 0,
    [STATUS.MISSING_AMOUNT_NET]: 1,
    [STATUS.NEEDS_VERIFICATION]: 2,
    [STATUS.NEEDS_PROVIDER_PERMISSION]: 3,
    [STATUS.PROVIDER_ERROR]: 4,
    [STATUS.PROVIDER_NOT_IMPLEMENTED]: 5,
    [STATUS.MISSING_OPENING]: 6,
    [STATUS.MISSING_PROVIDER]: 7,
  };
  return (rows || [])
    .filter((row) => row.status && ![
      STATUS.OK,
      STATUS.COMPUTED_FROM_PREVIOUS_DAY,
      STATUS.MANUAL_FACT,
      STATUS.PROVIDER_AUTO,
      STATUS.PROVIDER_DERIVED,
    ].includes(row.status))
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

function buildActivePairs({ operations = [], balanceRows = [], activePairs = [], configuredChannels } = {}) {
  const pairs = new Map();
  for (const channel of configuredChannels ?? loadConfiguredChannels()) {
    const currency = inferCurrencyFromChannel(channel);
    if (currency) addActivePair(pairs, { channel, currency });
  }
  for (const pair of activePairs || []) addActivePair(pairs, pair);
  for (const row of balanceRows || []) addActivePair(pairs, {
    channel: row?.channel || row?.accountName || row?.account,
    currency: row?.currency,
  });
  for (const operation of operations || []) {
    for (const pair of getOperationChannelCurrencyPairs(operation)) addActivePair(pairs, pair);
  }
  return Array.from(pairs.values()).sort(compareChannelCurrency);
}

function getOperationChannelCurrencyPairs(operation) {
  const ledger = operation?.ledgerV2 || {};
  const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
  if (!currency) return [];
  const amount = parseNumber(ledger.balance_amount ?? operation?.balanceAmount);
  const operationName = String(ledger.operation || operation?.operation || "").trim().toLowerCase();
  const from = String(ledger.from_channel || operation?.fromChannel || operation?.from_channel || "").trim();
  const to = String(ledger.to_channel || operation?.toChannel || operation?.to_channel || "").trim();
  const fallback = String(operation?.channel || operation?.accountName || operation?.account || "").trim();
  if (operationName === "income") return [{ channel: to || fallback, currency }];
  if (["expense", "business_expense", "personal_expense"].includes(operationName)) return [{ channel: from || fallback, currency }];
  if (operationName === "exchange_in") return [{ channel: to || fallback, currency }];
  if (operationName === "exchange_out") return [{ channel: from || fallback, currency }];
  if (operationName === "transfer" || operationName === "partner_transfer") {
    if (amount === null) return [from || fallback, to].filter(Boolean).map((channel) => ({ channel, currency }));
    return [{ channel: getMovementChannel(operation, amount), currency }];
  }
  return [{ channel: fallback || getMovementChannel(operation, amount ?? 1), currency }].filter((pair) => pair.channel);
}

function addActivePair(map, pair) {
  const channel = String(pair?.channel || "").trim();
  const currency = String(pair?.currency || "").trim().toUpperCase();
  if (!channel || !currency) return;
  const key = makeKey(channel, currency);
  if (!map.has(key)) map.set(key, { channel, currency, key });
}

function loadConfiguredChannels() {
  try {
    const configPath = path.join(process.cwd(), "sheet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return Array.isArray(config?.manualFinance?.channels) ? config.manualFinance.channels : [];
  } catch {
    return [];
  }
}

function inferCurrencyFromChannel(channel) {
  const normalized = String(channel || "").toLowerCase();
  if (/\b(cad|сad)\b|канад/.test(normalized)) return "CAD";
  if (/\b(eur|euro)\b|евр|евро/.test(normalized)) return "EUR";
  if (/\b(uah)\b|грн/.test(normalized)) return "UAH";
  if (/\b(rub)\b|руб|яндекс/.test(normalized)) return "RUB";
  if (/\b(usdt)\b|spot|save|binance/.test(normalized)) return "USDT";
  if (/\b(usd|usdc)\b|дол|dol|wise/.test(normalized)) return "USD";
  return "";
}

function buildDateRange(from, to) {
  if (!from || !to || from > to) return [];
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function emptyMovementRow({ date, pair, key }) {
  return {
    date,
    channel: pair.channel,
    currency: pair.currency,
    key,
    inflow: 0,
    outflow: 0,
    net_change: 0,
    missing_amount_net_rows: 0,
  };
}

function buildSnapshotDiagnostic(row) {
  return {
    date: row.date,
    channel: row.channel,
    currency: row.currency,
    amount: round(row.amount),
    source: row.sourceType,
    status: row.status || null,
    provider: row.provider || null,
    sourceSheet: row.sourceSheet || "",
    sourceRow: row.sourceRow || null,
    comment: row.comment || "",
  };
}

function snapshotAmount(row) {
  return row?.amount === null || row?.amount === undefined ? null : round(row.amount);
}

function getCoverageSourceType(row = {}) {
  const text = [
    row.source,
    row.fact_source,
    row.balanceSource,
    row.balance_source,
    row.provider,
    row.comment,
    row.sourceSheet,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/paypal_manual_balance|paypal_manual_confirmed_balance|manual paypal balance|manual confirmed|manual fact|остатки/.test(text) && !/авто остатки/.test(text)) return "manual_fact";
  if (/paypal_derived_balance|derived_from_confirmed_opening|derived from latest confirmed paypal balance|derived_balance/.test(text)) return "derived_balance";
  if (/auto snapshot|provider_auto|provider|wise|paypal|monobank|binance|privat|yoomoney|авто остатки/.test(text)) return "provider_auto";
  return "manual_fact";
}

function sourcePriority(row = {}) {
  if (row.sourceType === "manual_fact") return 0;
  if (row.sourceType === "provider_auto") return 1;
  if (row.sourceType === "derived_balance") return 2;
  return 3;
}

function normalizeProviderStatus(value) {
  const status = String(value || "").trim();
  if (status === "needs_permission") return STATUS.NEEDS_PROVIDER_PERMISSION;
  if (status === "not_implemented") return STATUS.PROVIDER_NOT_IMPLEMENTED;
  if (status === "error") return STATUS.PROVIDER_ERROR;
  return status;
}

function isProviderStatus(status) {
  return [
    STATUS.NEEDS_PROVIDER_PERMISSION,
    STATUS.PROVIDER_NOT_IMPLEMENTED,
    STATUS.PROVIDER_ERROR,
    STATUS.MISSING_PROVIDER,
  ].includes(String(status || "").trim());
}

function selectProviderStatus(rows = []) {
  if (!rows.length) return null;
  return rows
    .slice()
    .sort((left, right) => {
      const leftPriority = PROVIDER_STATUS_PRIORITY.indexOf(left.status);
      const rightPriority = PROVIDER_STATUS_PRIORITY.indexOf(right.status);
      return (leftPriority === -1 ? 99 : leftPriority) - (rightPriority === -1 ? 99 : rightPriority);
    })[0] || null;
}

function countProviderStatusRows(statusCounts = {}) {
  return [
    STATUS.MISSING_PROVIDER,
    STATUS.NEEDS_PROVIDER_PERMISSION,
    STATUS.PROVIDER_NOT_IMPLEMENTED,
    STATUS.PROVIDER_ERROR,
  ].reduce((sum, status) => sum + Number(statusCounts[status] || 0), 0);
}

function buildMissingDatesPreview({ rows = [], dates = [], pairs = [] } = {}) {
  const seen = new Set(rows.map((row) => `${row.date}|${makeKey(row.channel, row.currency)}`));
  const missing = [];
  for (const date of dates) {
    for (const pair of pairs) {
      const key = `${date}|${makeKey(pair.channel, pair.currency)}`;
      if (!seen.has(key)) missing.push({ date, channel: pair.channel, currency: pair.currency });
      if (missing.length >= 10) return missing;
    }
  }
  return missing;
}

function getMovementChannel(row, amount) {
  const ledger = row?.ledgerV2 || {};
  if (amount < 0) return String(ledger.from_channel || row?.fromChannel || row?.toChannel || "").trim();
  return String(ledger.to_channel || row?.toChannel || row?.fromChannel || "").trim();
}

function makeKey(channel, currency) {
  return `${channel}|${currency}`;
}

function compareMovementRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function compareChannelCurrency(left, right) {
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
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
