const STATUS = {
  OK: "ok",
  MISMATCH: "mismatch",
  MISSING_OPENING: "missing_opening_balance",
  MISSING_PROVIDER: "missing_provider_balance",
  NEEDS_VERIFICATION: "needs_verification",
};

export function buildDailyCurrencyBalances(operations = [], balanceRows = []) {
  const movements = buildMovements(operations);
  const balanceIndex = buildBalanceIndex(balanceRows);
  const rows = [];

  for (const movement of movements.rows) {
    const opening = findOpeningBalance(movement, balanceIndex, movements.byKey);
    const providerReported = balanceIndex.byDateKey.get(`${movement.date}|${movement.key}`)?.amount ?? null;
    const needsVerification = balanceIndex.incompleteDateKeys.has(`${movement.date}|${movement.channel}`);
    const closing = opening === null ? null : round(opening + movement.net_change);
    const difference = providerReported !== null && closing !== null ? round(providerReported - closing) : null;

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
      status: resolveStatus({
        needsVerification,
        opening,
        providerReported,
        difference,
      }),
    });
  }

  return {
    rows,
    summary: {
      rows: rows.length,
      mismatch_rows: rows.filter((row) => row.status === STATUS.MISMATCH).length,
      missing_opening_balance_rows: rows.filter((row) => row.status === STATUS.MISSING_OPENING).length,
      missing_provider_balance_rows: rows.filter((row) => row.status === STATUS.MISSING_PROVIDER).length,
      excluded_missing_amount_net_rows: movements.excluded_missing_amount_net_rows,
    },
  };
}

function buildMovements(operations) {
  const grouped = new Map();
  let excludedMissingAmountNetRows = 0;

  for (const operation of operations || []) {
    const ledger = operation?.ledgerV2 || {};
    if (!String(ledger.amount_net ?? operation?.amountNet ?? "").trim()) {
      excludedMissingAmountNetRows += 1;
      continue;
    }

    const amount = parseNumber(ledger.balance_amount ?? operation?.balanceAmount);
    const date = normalizeDate(operation?.date ?? ledger.date);
    const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
    if (amount === null || !date || !currency) continue;

    const channel = getMovementChannel(operation, amount);
    if (!channel) continue;

    const key = makeKey(channel, currency);
    const dateKey = `${date}|${key}`;
    const current = grouped.get(dateKey) || {
      date,
      channel,
      currency,
      key,
      inflow: 0,
      outflow: 0,
      net_change: 0,
    };

    if (amount >= 0) current.inflow += amount;
    else current.outflow += Math.abs(amount);
    current.net_change += amount;
    grouped.set(dateKey, current);
  }

  const rows = Array.from(grouped.values()).sort(compareMovementRows);
  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.key)) byKey.set(row.key, []);
    byKey.get(row.key).push(row);
  }

  return {
    rows,
    byKey,
    excluded_missing_amount_net_rows: excludedMissingAmountNetRows,
  };
}

function buildBalanceIndex(balanceRows) {
  const byKey = new Map();
  const byDateKey = new Map();
  const incompleteDateKeys = new Set();

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
    const normalized = { date, channel, currency, key, amount };
    byDateKey.set(`${date}|${key}`, normalized);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(normalized);
  }

  for (const rows of byKey.values()) {
    rows.sort((left, right) => left.date.localeCompare(right.date));
  }

  return { byKey, byDateKey, incompleteDateKeys };
}

function findOpeningBalance(movement, balanceIndex, movementRowsByKey) {
  const snapshots = balanceIndex.byKey.get(movement.key) || [];
  const openingSnapshot = snapshots.filter((row) => row.date < movement.date).at(-1);
  if (!openingSnapshot) return null;

  const priorMovements = movementRowsByKey.get(movement.key) || [];
  const movementSinceSnapshot = priorMovements
    .filter((row) => row.date > openingSnapshot.date && row.date < movement.date)
    .reduce((sum, row) => sum + row.net_change, 0);

  return round(openingSnapshot.amount + movementSinceSnapshot);
}

function resolveStatus({ needsVerification, opening, providerReported, difference }) {
  if (needsVerification) return STATUS.NEEDS_VERIFICATION;
  if (opening === null) return STATUS.MISSING_OPENING;
  if (difference !== null && Math.abs(difference) > 0.0001) return STATUS.MISMATCH;
  if (providerReported === null) return STATUS.MISSING_PROVIDER;
  return STATUS.OK;
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
