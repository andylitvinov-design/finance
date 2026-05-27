export const OWNER_MAY_OPENING_BALANCE_DATE = "2026-05-01";
export const OWNER_MAY_OPENING_BALANCE_SOURCE = "manual_owner_confirmed_2026_05_01";

export const OWNER_MAY_OPENING_BALANCES = [
  { inputChannel: "смано ЯД", channel: "Яндекс руб", currency: "RUB", amount: "", amountUsd: 1722 },
  { inputChannel: "пейпал дол", channel: "пейпал дол", currency: "USD", amount: 435, amountUsd: 435 },
  { inputChannel: "пейпал евр", channel: "пейпал евр", currency: "EUR", amount: 0, amountUsd: 0 },
  { inputChannel: "деп24-дол", channel: "деп24-дол", currency: "USD", amount: 0, amountUsd: 0 },
  { inputChannel: "деп24-евро", channel: "деп24-евро", currency: "EUR", amount: 0, amountUsd: 0 },
  { inputChannel: "пейпал cad", channel: "пейпал сad", currency: "CAD", amount: 0, amountUsd: 0 },
  { inputChannel: "24-грн", channel: "приват 24-грн", currency: "UAH", amount: 11239, amountUsd: 254 },
  { inputChannel: "монобанк", channel: "монобанк грн", currency: "UAH", amount: 26670, amountUsd: 603 },
  { inputChannel: "трансервайз евро", channel: "трансервайз евро", currency: "EUR", amount: 0, amountUsd: 0 },
  { inputChannel: "трансервайз дол", channel: "трансервайз дол", currency: "USD", amount: 2639, amountUsd: 2639 },
  {
    inputChannel: "REVOLUT USD",
    channel: "REVOLUT дол",
    currency: "USD",
    amount: 18.38,
    amountUsd: 18.38,
    adjustmentReason: "owner_revolut_currency_split_from_new_screenshot",
    confidence: "high",
    confidenceNote: "new Revolut screenshot shows USD 18.38; old combined REVOLUT 378 is superseded",
    supersededOwnerInput: { inputChannel: "REVOLUT", amount: 378, amountUsd: 378 },
  },
  {
    inputChannel: "REVOLUT EUR",
    channel: "REVOLUT евро",
    currency: "EUR",
    amount: 213.48,
    amountUsd: 344.62,
    adjustmentReason: "owner_revolut_currency_split_from_new_screenshot",
    confidence: "medium-high",
    confidenceNote: "new Revolut screenshot shows EUR 110.74 after visible post-May-1 EUR transactions -100 and -2.74",
    supersededOwnerInput: { inputChannel: "REVOLUT", amount: 378, amountUsd: 378 },
  },
  {
    inputChannel: "REVOLUT CHF",
    channel: "REVOLUT франк",
    currency: "CHF",
    amount: 15,
    amountUsd: 15,
    adjustmentReason: "owner_revolut_currency_split_from_new_screenshot",
    confidence: "high",
    confidenceNote: "new Revolut screenshot shows CHF 15",
    supersededOwnerInput: { inputChannel: "REVOLUT", amount: 378, amountUsd: 378 },
  },
  {
    inputChannel: "REVOLUT GBP",
    channel: "REVOLUT фунт",
    currency: "GBP",
    amount: 0,
    amountUsd: 0,
    adjustmentReason: "owner_revolut_currency_split_from_new_screenshot",
    confidence: "high",
    confidenceNote: "new Revolut screenshot shows GBP 0",
    supersededOwnerInput: { inputChannel: "REVOLUT", amount: 378, amountUsd: 378 },
  },
  { inputChannel: "Payoneer - eur", channel: "Payoneer - eur", currency: "EUR", amount: "", amountUsd: 1284 },
  { inputChannel: "Payoneer - dol", channel: "Payoneer - dol", currency: "USD", amount: 3, amountUsd: 3 },
  {
    inputChannel: "Бинанс spot",
    channel: "Бинанс spot",
    currency: "USDT",
    amount: 1087.6223,
    amountUsd: 1087.6223,
    adjustmentReason: "owner_combined_usdt_usdc_split",
    confidence: "medium",
    confidenceNote: "high for split arithmetic, medium until confirmed in source rows",
  },
  {
    inputChannel: "Бинанс spot",
    channel: "Бинанс spot",
    currency: "USDC",
    amount: 2.3777,
    amountUsd: 2.3777,
    adjustmentReason: "owner_combined_usdt_usdc_split",
    confidence: "medium",
    confidenceNote: "high for split arithmetic, medium until confirmed in source rows",
  },
  { inputChannel: "binance save", channel: "binance save", currency: "USDT", amount: 8519, amountUsd: 8519 },
  { inputChannel: "Нал-я-евр", channel: "Налично -я-евр", currency: "EUR", amount: "", amountUsd: 91 },
  { inputChannel: "местная валюты", channel: "местная валюты", currency: "LOCAL", amount: 0, amountUsd: 0 },
  { inputChannel: "БАНК КАНАДА", channel: "БАНК КАНАДА cad", currency: "CAD", amount: 7351, amountUsd: 7351 },
  { inputChannel: "ФОП - мамо", channel: "приват-фоп", currency: "UAH", amount: 0, amountUsd: 0 },
  { inputChannel: "24-евро", channel: "приват 24-евро", currency: "EUR", amount: "", amountUsd: 1 },
  { inputChannel: "карта тай", channel: "карта тай", currency: "THB", amount: 0, amountUsd: 0 },
  { inputChannel: "нал-мам-е", channel: "нал-мам-евро", currency: "EUR", amount: "", amountUsd: 580 },
  { inputChannel: "нал-мам-д", channel: "нал-мам-дол", currency: "USD", amount: 0, amountUsd: 0 },
  { inputChannel: "24-дол", channel: "приват 24-дол", currency: "USD", amount: 43, amountUsd: 43 },
  { inputChannel: "переплата Богдану", channel: "переплата Богдану", currency: "USD", amount: 0, amountUsd: 0 },
];

const PAYPAL_PLANNED_OPENING_KEYS = new Set([
  balanceKey("пейпал дол", "USD"),
  balanceKey("пейпал евр", "EUR"),
  balanceKey("пейпал сad", "CAD"),
]);
const PAYPAL_SCREENSHOT_OPENING_REASON = "owner_paypal_screenshot_opening";
const PAYPAL_SCREENSHOT_OPENINGS = new Map([
  [balanceKey("пейпал дол", "USD"), {
    opening: 202.97,
    openingUsd: 202.97,
    confirmed: 12.07,
    confirmedUsd: 12.07,
    screenshotMovement: -190.9,
  }],
  [balanceKey("пейпал евр", "EUR"), {
    opening: 175.25,
    openingUsd: null,
    confirmed: 0,
    confirmedUsd: null,
    screenshotMovement: -175.25,
  }],
  [balanceKey("пейпал сad", "CAD"), {
    opening: 19.5,
    openingUsd: null,
    confirmed: 0,
    confirmedUsd: null,
    screenshotMovement: -19.5,
  }],
]);

const PAYPAL_MOVEMENT_DIAGNOSTIC_SOURCE_ROW_ORDER = [501, 504, 502, 503];
const PAYPAL_MOVEMENT_DIAGNOSTIC_SOURCE_ROWS = new Set(PAYPAL_MOVEMENT_DIAGNOSTIC_SOURCE_ROW_ORDER);
const REVOLUT_CURRENCY_SPLIT_REASON = "owner_revolut_currency_split_from_new_screenshot";

const SUPERSEDED_MAY_OPENING_KEYS = new Set([
  ...OWNER_MAY_OPENING_BALANCES.map((row) => balanceKey(row.channel, row.currency)),
  balanceKey("binance save", "USD"),
  balanceKey("binance save", "USDC"),
  balanceKey("legacy_combined_binance_spot_funding", "USDT"),
  balanceKey("Бинанс spot", "USD"),
  balanceKey("Бинанс spot", "USDC"),
  balanceKey("REVOLUT евро", "EUR"),
  balanceKey("карта май", "UNKNOWN"),
]);

const DETECTION_KEYS = new Set([
  balanceKey("пейпал дол", "USD"),
  balanceKey("приват 24-грн", "UAH"),
  balanceKey("монобанк грн", "UAH"),
  balanceKey("БАНК КАНАДА cad", "CAD"),
  balanceKey("binance save", "USDT"),
  balanceKey("Яндекс руб", "RUB"),
  balanceKey("Payoneer - eur", "EUR"),
  balanceKey("трансервайз дол", "USD"),
  balanceKey("Налично -я-евр", "EUR"),
  balanceKey("нал-мам-евро", "EUR"),
]);

export function buildOwnerMayOpeningBalanceRows(rows = OWNER_MAY_OPENING_BALANCES, options = {}) {
  const validation = validateOwnerMayOpeningBalances(rows);
  const adjustedTotalOnly = options.allowAdjustedTotal === true
    && validation.errors.every((error) => /^owner total_usd mismatch: /.test(error));
  if (!validation.ok && !adjustedTotalOnly) {
    throw new Error(`Invalid owner-confirmed 2026-05-01 opening balances: ${validation.errors.join("; ")}`);
  }
  return rows.map((row) => ({
    date: OWNER_MAY_OPENING_BALANCE_DATE,
    channel: row.channel,
    accountName: row.channel,
    currency: row.currency,
    amount: row.amount,
    balanceAmount: row.amount,
    usdAmount: row.amountUsd,
    amountUsd: row.amountUsd,
    amount_usd: row.amountUsd,
    balance_usd: row.amountUsd,
    superseded_owner_input: row.supersededOwnerInput || null,
    source: OWNER_MAY_OPENING_BALANCE_SOURCE,
    fact_source: OWNER_MAY_OPENING_BALANCE_SOURCE,
    balanceSource: "manual_fact",
    sourceSheet: "Owner Confirmed",
    comment: `Owner-confirmed opening balance for ${OWNER_MAY_OPENING_BALANCE_DATE}; input channel: ${row.inputChannel}.`,
  }));
}

export function applyOwnerMayOpeningBalanceSeed(balanceRows = [], options = {}) {
  if (!shouldApplyOwnerMayOpeningSeed(balanceRows, options)) {
    return {
      rows: balanceRows,
      applied: false,
      owner_total_usd: ownerMayOpeningTotalUsd(),
      owner_input_opening_total_usd: ownerMayOpeningTotalUsd(),
      reconciliation_adjusted_opening: buildReconciliationAdjustedMayOpening({
        ownerRows: options.ownerRows || OWNER_MAY_OPENING_BALANCES,
        balanceRows,
        operations: options.operations || [],
        period: options.period || {},
      }),
      warnings: [],
    };
  }
  const reconciliationAdjustedOpening = buildReconciliationAdjustedMayOpening({
    ownerRows: options.ownerRows || OWNER_MAY_OPENING_BALANCES,
    balanceRows,
    operations: options.operations || [],
    period: options.period || {},
  });
  const ownerRows = buildOwnerMayOpeningBalanceRows(
    buildAdjustedOwnerRows(options.ownerRows || OWNER_MAY_OPENING_BALANCES, reconciliationAdjustedOpening),
    { allowAdjustedTotal: true }
  );
  const filtered = (balanceRows || []).filter((row) => {
    if (normalizeDate(row?.date) !== OWNER_MAY_OPENING_BALANCE_DATE) return true;
    return !SUPERSEDED_MAY_OPENING_KEYS.has(balanceKey(row?.channel || row?.accountName || row?.account, row?.currency));
  });
  return {
    rows: [...filtered, ...ownerRows],
    applied: true,
    owner_total_usd: ownerMayOpeningTotalUsd(options.ownerRows || OWNER_MAY_OPENING_BALANCES),
    owner_input_opening_total_usd: reconciliationAdjustedOpening.owner_input_opening_total_usd,
    reconciliation_adjusted_opening_total_usd: reconciliationAdjustedOpening.reconciliation_adjusted_opening_total_usd,
    diff_from_owner_input_total_usd: reconciliationAdjustedOpening.diff_from_owner_input_total_usd,
    reconciliation_adjusted_opening: reconciliationAdjustedOpening,
    warnings: [`owner-confirmed ${OWNER_MAY_OPENING_BALANCE_DATE} opening balance seed applied; total_usd=24993`],
  };
}

export function shouldApplyOwnerMayOpeningSeed(balanceRows = [], options = {}) {
  if (options.force === true) return true;
  if (options.force === false) return false;
  let detected = 0;
  for (const row of balanceRows || []) {
    if (normalizeDate(row?.date) !== OWNER_MAY_OPENING_BALANCE_DATE) continue;
    if (DETECTION_KEYS.has(balanceKey(row?.channel || row?.accountName || row?.account, row?.currency))) detected += 1;
  }
  return detected >= 6;
}

export function validateOwnerMayOpeningBalances(rows = OWNER_MAY_OPENING_BALANCES) {
  const errors = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (!String(row?.inputChannel || "").trim()) errors.push("missing inputChannel");
    if (!String(row?.channel || "").trim() || !String(row?.currency || "").trim()) {
      errors.push(`unmapped owner balance channel: ${row?.inputChannel || "unknown"}`);
      continue;
    }
    const key = balanceKey(row.channel, row.currency);
    if (seen.has(key)) errors.push(`duplicate mapped owner balance key: ${key}`);
    seen.add(key);
    if (!Number.isFinite(Number(row.amountUsd))) errors.push(`missing amount_usd for ${row.inputChannel}`);
  }
  const total = ownerMayOpeningTotalUsd(rows);
  if (total !== 24993) errors.push(`owner total_usd mismatch: ${total} !== 24993`);
  return { ok: errors.length === 0, errors, total_usd: total };
}

export function ownerMayOpeningTotalUsd(rows = OWNER_MAY_OPENING_BALANCES) {
  return round((rows || []).reduce((sum, row) => sum + Number(row?.amountUsd || 0), 0));
}

export function buildReconciliationAdjustedMayOpening({
  ownerRows = OWNER_MAY_OPENING_BALANCES,
  balanceRows = [],
  operations = [],
  period = {},
} = {}) {
  const ownerByKey = new Map();
  for (const row of ownerRows || []) {
    ownerByKey.set(balanceKey(row.channel, row.currency), row);
  }
  const latestFacts = buildLatestLaterConfirmedBalanceIndex(balanceRows, period);
  const keys = new Set([...ownerByKey.keys(), ...latestFacts.keys()]);
  const rows = Array.from(keys).map((key) => {
    const [channel, currency] = splitBalanceKey(key);
    const owner = ownerByKey.get(key) || null;
    const fact = latestFacts.get(key) || null;
    const movement = fact
      ? sumLedgerMovements({ operations, channel, currency, from: addDays(OWNER_MAY_OPENING_BALANCE_DATE, 1), to: fact.date })
      : { native: 0, usd: 0, hasUsd: false };
    const ownerInput = parseNumber(owner?.amount);
    const ownerInputUsd = parseNumber(owner?.amountUsd);
    const impliedOpening = fact ? round(fact.amount - movement.native) : null;
    let impliedOpeningUsd = fact && fact.amount_usd !== null
      ? round(fact.amount_usd - (movement.hasUsd ? movement.usd : 0))
      : estimateAdjustedUsd({ ownerInput, ownerInputUsd, adjustedOpening: impliedOpening });
    const diff = ownerInput !== null && impliedOpening !== null ? round(impliedOpening - ownerInput) : null;
    const tolerance = getOpeningTolerance(currency);
    const withinTolerance = diff !== null && Math.abs(diff) <= tolerance;

    let reason = owner?.adjustmentReason || "missing_later_confirmed_balance";
    let confidence = owner?.confidence || "medium";
    let adjustedOpening = ownerInput;
    let adjustedOpeningUsd = ownerInputUsd;
    let status = "not_adjusted";
    let plannedOpeningCandidate = null;
    let plannedOpeningCandidateUsd = null;
    const preservesOwnerAdjustmentReason = Boolean(owner?.adjustmentReason);

    if (owner && fact && owner.adjustmentReason === REVOLUT_CURRENCY_SPLIT_REASON) {
      reason = owner.adjustmentReason;
      confidence = owner.confidence || "medium";
      status = "adjusted";
      adjustedOpening = ownerInput;
      adjustedOpeningUsd = ownerInputUsd;
    } else if (owner && fact && withinTolerance) {
      reason = preservesOwnerAdjustmentReason ? owner.adjustmentReason : "rounding_or_fx";
      confidence = owner?.confidence || "high";
      status = "adjusted";
      adjustedOpening = impliedOpening;
      adjustedOpeningUsd = impliedOpeningUsd ?? estimateAdjustedUsd({ ownerInput, ownerInputUsd, adjustedOpening });
    } else if (owner && fact) {
      reason = "needs_verification";
      confidence = "low";
    } else if (!owner && fact) {
      reason = "candidate_missing_opening";
      confidence = "low";
      status = "candidate_missing_opening";
      adjustedOpening = null;
      adjustedOpeningUsd = null;
    }

    const paypalScreenshot = PAYPAL_SCREENSHOT_OPENINGS.get(key) || null;
    const hasMatchingPayPalScreenshotFact = Boolean(
      owner
      && fact
      && paypalScreenshot
      && fact.date === "2026-05-27"
      && Math.abs(round(Number(fact.amount) - Number(paypalScreenshot.confirmed))) <= 0.0001
    );

    if (hasMatchingPayPalScreenshotFact) {
      reason = PAYPAL_SCREENSHOT_OPENING_REASON;
      confidence = "high";
      status = "adjusted";
      adjustedOpening = paypalScreenshot.opening;
      adjustedOpeningUsd = paypalScreenshot.openingUsd;
      impliedOpeningUsd = paypalScreenshot.openingUsd;
    } else if (owner && fact && PAYPAL_PLANNED_OPENING_KEYS.has(key)) {
      reason = "planned_from_confirmed_balance_minus_ledger_movements";
      confidence = "medium";
      status = "pending_movement_verification";
      plannedOpeningCandidate = impliedOpening;
      plannedOpeningCandidateUsd = impliedOpeningUsd;
      adjustedOpening = ownerInput;
      adjustedOpeningUsd = ownerInputUsd;
    }

    return {
      channel,
      currency,
      owner_input: ownerInput,
      owner_input_usd: ownerInputUsd,
      owner_input_total_usd: ownerInputUsd,
      implied_opening: impliedOpening,
      implied_opening_usd: impliedOpeningUsd,
      adjusted_opening: adjustedOpening,
      adjusted_opening_usd: adjustedOpeningUsd,
      diff,
      tolerance,
      reason,
      adjustment_reason: reason,
      confidence,
      confidence_note: owner?.confidenceNote || null,
      superseded_owner_input: hasMatchingPayPalScreenshotFact
        ? { inputChannel: owner.inputChannel, amount: ownerInput, amountUsd: ownerInputUsd }
        : owner?.supersededOwnerInput || null,
      status,
      planned_opening_candidate: plannedOpeningCandidate,
      planned_opening_candidate_usd: plannedOpeningCandidateUsd,
      screenshot_movement: hasMatchingPayPalScreenshotFact ? paypalScreenshot.screenshotMovement : null,
      ledger_vs_screenshot_movement_diff: hasMatchingPayPalScreenshotFact && fact
        ? round(movement.native - paypalScreenshot.screenshotMovement)
        : null,
      later_confirmed_balance: fact?.amount ?? null,
      later_confirmed_balance_usd: hasMatchingPayPalScreenshotFact
        ? paypalScreenshot.confirmedUsd
        : fact?.amount_usd ?? null,
      later_confirmed_balance_date: fact?.date || null,
      ledger_movement_from_2026_05_02_to_confirmed_date: fact ? movement.native : null,
      ledger_movement_usd_from_2026_05_02_to_confirmed_date: fact && movement.hasUsd ? movement.usd : null,
      source: owner ? "owner_input" : "candidate_from_later_confirmed_balance",
    };
  }).sort((left, right) => left.channel === right.channel ? left.currency.localeCompare(right.currency) : left.channel.localeCompare(right.channel));

  const ownerTotal = ownerMayOpeningTotalUsd(ownerRows);
  const adjustedTotal = round(rows.reduce((sum, row) => sum + Number(row.adjusted_opening_usd ?? row.owner_input_usd ?? 0), 0));
  const adjustedRows = rows.filter((row) => row.status === "adjusted" && Math.abs(Number(row.diff || 0)) > 0);
  const needsVerificationRows = rows.filter((row) => row.reason === "needs_verification" || row.reason === "candidate_missing_opening");
  const pendingMovementVerificationRows = rows.filter((row) => row.status === "pending_movement_verification");
  const paypalMovementDiagnostics = buildPayPalMovementDiagnostics({ operations, rows });

  return {
    owner_input_opening_total_usd: ownerTotal,
    owner_input_total_usd: ownerTotal,
    reconciliation_adjusted_opening_total_usd: adjustedTotal,
    adjusted_total_usd: adjustedTotal,
    diff_from_owner_input_total_usd: round(adjustedTotal - ownerTotal),
    rows,
    per_channel_table: rows,
    adjusted_rows: adjustedRows,
    needs_verification_rows: needsVerificationRows,
    pending_movement_verification_rows: pendingMovementVerificationRows,
    paypal_movement_diagnostics: paypalMovementDiagnostics,
    no_silent_overwrites: true,
  };
}

export function isSupersededOwnerMayOpeningBalanceKey(channel, currency) {
  return SUPERSEDED_MAY_OPENING_KEYS.has(balanceKey(channel, currency));
}

function balanceKey(channel, currency) {
  return `${String(channel || "").trim()}|${String(currency || "").trim().toUpperCase()}`;
}

function splitBalanceKey(key) {
  const [channel, currency] = String(key || "").split("|");
  return [channel || "", currency || ""];
}

function buildAdjustedOwnerRows(ownerRows, report) {
  const rowsByKey = new Map((report?.rows || []).map((row) => [balanceKey(row.channel, row.currency), row]));
  return (ownerRows || []).map((row) => {
    const adjustment = rowsByKey.get(balanceKey(row.channel, row.currency));
    if (!adjustment || !["rounding_or_fx", PAYPAL_SCREENSHOT_OPENING_REASON].includes(adjustment.reason)) return row;
    return {
      ...row,
      amount: adjustment.adjusted_opening ?? row.amount,
      amountUsd: adjustment.adjusted_opening_usd ?? row.amountUsd,
      ownerInputAmount: row.amount,
      ownerInputAmountUsd: row.amountUsd,
      adjustmentReason: adjustment.reason,
    };
  });
}

function buildLatestLaterConfirmedBalanceIndex(balanceRows = [], period = {}) {
  const latest = new Map();
  for (const row of balanceRows || []) {
    const date = normalizeDate(row?.date);
    if (!date || date <= OWNER_MAY_OPENING_BALANCE_DATE) continue;
    const channel = String(row?.channel || row?.accountName || row?.account || "").trim();
    const currency = String(row?.currency || "").trim().toUpperCase();
    const amount = parseNumber(row?.balanceAmount ?? row?.amount);
    if (!channel || !currency || amount === null) continue;
    const key = balanceKey(channel, currency);
    const current = latest.get(key);
    if (current && current.date > date) continue;
    latest.set(key, {
      date,
      channel,
      currency,
      amount,
      amount_usd: resolveUsdAmount(row, amount, currency),
    });
  }
  return latest;
}

function sumLedgerMovements({ operations = [], channel, currency, from, to }) {
  let native = 0;
  let usd = 0;
  let hasUsd = false;
  for (const operation of operations || []) {
    const ledger = operation?.ledgerV2 || {};
    const date = normalizeDate(operation?.date ?? ledger.date);
    if (!date || date < from || date > to) continue;
    const operationCurrency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
    if (operationCurrency !== currency) continue;
    const amount = parseNumber(ledger.balance_amount ?? operation?.balanceAmount);
    if (amount === null) continue;
    if (getMovementChannel(operation, amount) !== channel) continue;
    native += amount;
    const amountUsd = parseSignedUsdAmount(operation, amount, currency);
    if (amountUsd !== null) {
      usd += amountUsd;
      hasUsd = true;
    }
  }
  return { native: round(native), usd: round(usd), hasUsd };
}

function buildPayPalMovementDiagnostics({ operations = [], rows = [] } = {}) {
  const paypalRowsByKey = new Map(
    (rows || [])
      .filter((row) => PAYPAL_PLANNED_OPENING_KEYS.has(balanceKey(row.channel, row.currency)))
      .map((row) => [balanceKey(row.channel, row.currency), row])
  );
  return (operations || [])
    .map((operation) => buildPayPalMovementDiagnostic(operation, paypalRowsByKey))
    .filter(Boolean)
    .sort((left, right) => PAYPAL_MOVEMENT_DIAGNOSTIC_SOURCE_ROW_ORDER.indexOf(left.source_row) - PAYPAL_MOVEMENT_DIAGNOSTIC_SOURCE_ROW_ORDER.indexOf(right.source_row));
}

function buildPayPalMovementDiagnostic(operation, paypalRowsByKey) {
  const sourceRow = parseSourceRow(operation);
  if (!PAYPAL_MOVEMENT_DIAGNOSTIC_SOURCE_ROWS.has(sourceRow)) return null;
  const ledger = operation?.ledgerV2 || {};
  const date = normalizeDate(operation?.date ?? ledger.date);
  const currency = String(ledger.currency || operation?.currency || "").trim().toUpperCase();
  const balanceAmount = parseNumber(ledger.balance_amount ?? operation?.balanceAmount);
  const channel = getMovementChannel(operation, balanceAmount);
  const key = balanceKey(channel, currency);
  const paypalRow = paypalRowsByKey.get(key) || null;
  const amountNet = parseNumber(ledger.amount_net ?? operation?.amountNet ?? operation?.amount_net ?? operation?.net);
  const gross = parseNumber(ledger.amount_gross ?? operation?.amountGross ?? operation?.amount_gross ?? operation?.gross);
  const fee = parseNumber(ledger.amount_fee ?? operation?.amountFee ?? operation?.amount_fee ?? operation?.fee);
  const net = parseNumber(ledger.net ?? operation?.net ?? ledger.amount_net ?? operation?.amountNet ?? operation?.amount_net);
  const afterOpeningDate = Boolean(date && date > OWNER_MAY_OPENING_BALANCE_DATE);
  return {
    source_row: sourceRow,
    sourceRow,
    date: date || null,
    channel: channel || null,
    currency: currency || null,
    amount_net: amountNet,
    gross,
    fee,
    net,
    sourceTransactionId: String(operation?.sourceTransactionId || operation?.source_transaction_id || ledger.sourceTransactionId || ledger.source_transaction_id || "").trim() || null,
    raw_source_id: String(operation?.raw_source_id || operation?.rawSourceId || ledger.raw_source_id || ledger.external_id || operation?.externalId || operation?.external_id || "").trim() || null,
    direction: balanceAmount < 0 ? "outflow" : "inflow",
    counterparty: String(operation?.counterparty || operation?.counterpartyName || ledger.counterparty || "").trim() || null,
    description: String(operation?.description || ledger.description || operation?.comment || ledger.comment || "").trim() || null,
    after_2026_05_01: afterOpeningDate,
    included_in_paypal_movement_sum: Boolean(afterOpeningDate && paypalRow?.later_confirmed_balance_date && date <= paypalRow.later_confirmed_balance_date && paypalRow.status === "pending_movement_verification"),
  };
}

function parseSourceRow(operation = {}) {
  const parsed = Number(
    operation?.sourceRow
    ?? operation?.source_row
    ?? operation?.sheetRowNumber
    ?? operation?.sheet_row_number
    ?? operation?.ledgerV2?.sourceRow
    ?? operation?.ledgerV2?.source_row
    ?? operation?.ledgerV2?.sheetRowNumber
    ?? operation?.ledgerV2?.sheet_row_number
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function getMovementChannel(operation, amount) {
  const ledger = operation?.ledgerV2 || {};
  const from = String(ledger.from_channel || operation?.fromChannel || operation?.from_channel || "").trim();
  const to = String(ledger.to_channel || operation?.toChannel || operation?.to_channel || "").trim();
  const fallback = String(operation?.channel || operation?.accountName || operation?.account || "").trim();
  return Number(amount) < 0 ? (from || fallback || to) : (to || fallback || from);
}

function parseSignedUsdAmount(operation, amount, currency) {
  const ledger = operation?.ledgerV2 || {};
  const parsed = parseNumber(ledger.amount_usd ?? operation?.amountUsd ?? operation?.amount_usd);
  if (parsed !== null) return Number(amount) < 0 ? -Math.abs(parsed) : Math.abs(parsed);
  if (isStableUsdCurrency(currency)) return amount;
  return null;
}

function resolveUsdAmount(row, amount, currency) {
  const parsed = parseNumber(row?.amount_usd ?? row?.amountUsd ?? row?.usdAmount ?? row?.balance_usd);
  if (parsed !== null) return parsed;
  if (isStableUsdCurrency(currency)) return amount;
  return null;
}

function estimateAdjustedUsd({ ownerInput, ownerInputUsd, adjustedOpening }) {
  if (ownerInput === null || ownerInputUsd === null || adjustedOpening === null) return ownerInputUsd;
  if (ownerInput === 0) return ownerInputUsd;
  return round(adjustedOpening * (ownerInputUsd / ownerInput));
}

function getOpeningTolerance(currency) {
  const normalized = String(currency || "").trim().toUpperCase();
  if (normalized === "UAH") return 5;
  if (["BTC", "ETH", "BNB"].includes(normalized)) return 0.00000001;
  return 0.5;
}

function isStableUsdCurrency(currency) {
  return ["USD", "USDT", "USDC"].includes(String(currency || "").trim().toUpperCase());
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(",", ".").replace(/\s+/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}
