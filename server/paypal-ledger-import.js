import { normalizeManualLedgerCategory } from "./manual-ledger-maps.js";

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = text(value).replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function amount(value) {
  const parsed = number(value);
  return parsed === null ? "" : String(Math.abs(parsed));
}

function stableId(row = {}) {
  return text(row.sourceTransactionId || row.rawSourceId || row.raw_source_id || row.externalId || row.external_id);
}

function externalId(row = {}) {
  return text(row.externalId || row.external_id || stableId(row));
}

function existingIds(rows = []) {
  return new Set((rows || []).flatMap((row) => [
    row.externalId,
    row.external_id,
    row.rawSourceId,
    row.raw_source_id,
    row.sourceTransactionId,
    row.source_transaction_id,
  ].map(text)).filter(Boolean));
}

function isValidEntry(entry = {}) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(entry.date)) &&
    Boolean(text(entry.channel)) &&
    Boolean(text(entry.currency).toUpperCase()) &&
    Boolean(stableId(entry)) &&
    (number(entry.localAmount) ?? number(entry.amountGross) ?? number(entry.amount_gross)) !== null;
}

function isIncompleteFeeOrNet(entry = {}) {
  return number(entry.amountFee ?? entry.amount_fee ?? entry.feeAmount) === null ||
    number(entry.amountNet ?? entry.amount_net ?? entry.netAmount) === null;
}

function buildLedgerRow(entry, timestamp) {
  const direction = text(entry.direction).toLowerCase();
  const sourceId = stableId(entry);
  const gross = amount(entry.amountGross ?? entry.amount_gross ?? entry.grossAmount ?? entry.localAmount);
  const fee = amount(entry.amountFee ?? entry.amount_fee ?? entry.feeAmount);
  const net = amount(entry.amountNet ?? entry.amount_net ?? entry.netAmount);
  const channel = text(entry.channel);
  const category = normalizeManualLedgerCategory(entry.suggestedCategory || entry.category, direction === "income" ? "servicein" : "business");
  const common = {
    date: text(entry.date),
    amount: amount(entry.localAmount ?? entry.amountGross ?? entry.amount_gross),
    currency: text(entry.currency).toUpperCase(),
    amountUsd: amount(entry.usdAmount ?? entry.amount_usd),
    amountGross: gross,
    amountFee: fee,
    amountNet: net,
    category,
    subcategory: text(entry.subcategory),
    comment: text(entry.description || entry.transactionSubject || entry.organization),
    counterparty: text(entry.counterparty || entry.counterpartyName || entry.organization),
    description: text(entry.description || entry.transactionSubject),
    source: "paypal",
    rawSourceId: sourceId,
    transferGroupId: text(entry.exchangeGroupId || entry.exchange_group_id),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (direction === "income") {
    return { ...common, operation: "income", fromChannel: "", toChannel: channel, direction: "in", externalId: externalId(entry) };
  }
  if (direction === "exchange") {
    return {
      ...common,
      operation: "exchange_out",
      fromChannel: channel,
      toChannel: text(entry.toChannel || entry.to_channel),
      direction: "out",
      category: "exchange",
      externalId: `${externalId(entry)}:out`,
    };
  }
  return {
    ...common,
    operation: category === "business" ? "business_expense" : "personal_expense",
    fromChannel: channel,
    toChannel: "",
    direction: "out",
    externalId: externalId(entry),
  };
}

export function buildPayPalLedgerImportPlan({ entries = [], existingRows = [], now = new Date().toISOString() } = {}) {
  const seen = existingIds(existingRows);
  const rows = [];
  const counts = {
    fetched: entries.length,
    new: 0,
    duplicates: 0,
    skipped: 0,
    invalid: 0,
    incomplete_fee_net: 0,
    incoming: 0,
    outgoing: 0,
    exchange: 0,
  };
  for (const entry of entries || []) {
    if (text(entry.entryKind).toLowerCase() === "fee") {
      counts.skipped += 1;
      continue;
    }
    if (!isValidEntry(entry)) {
      counts.invalid += 1;
      continue;
    }
    const direction = text(entry.direction).toLowerCase();
    if (direction === "income") counts.incoming += 1;
    else if (direction === "exchange") counts.exchange += 1;
    else counts.outgoing += 1;
    if (isIncompleteFeeOrNet(entry)) counts.incomplete_fee_net += 1;
    const row = buildLedgerRow(entry, now);
    const ids = [row.externalId, row.rawSourceId].map(text).filter(Boolean);
    if (ids.some((id) => seen.has(id))) {
      counts.duplicates += 1;
      continue;
    }
    ids.forEach((id) => seen.add(id));
    rows.push(row);
    counts.new += 1;
  }
  return { rows, counts };
}

export function buildPayPalLedgerImportVerification(rows = []) {
  const classify = (direction) => (rows || []).filter((row) => row.direction === direction &&
    text(row.amountGross) && text(row.amountNet) && text(row.externalId) && text(row.rawSourceId));
  return {
    incoming: classify("in").length > 0,
    outgoing: classify("out").length > 0,
    allStableSourceTransactionIds: (rows || []).every((row) => text(row.rawSourceId) && text(row.externalId)),
    balanceAmountField: "amount_net",
  };
}
