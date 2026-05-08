export function hasLedgerAmountNet(row = {}) {
  return String(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net ?? "").trim() !== "";
}

export function countMissingAmountNetRows(operations = []) {
  return (operations || []).filter((row) => !hasLedgerAmountNet(row)).length;
}

export function isExchangeOperation(row = {}) {
  const operation = String(row?.ledgerV2?.operation || row?.operation || "").trim();
  const category = String(row?.ledgerV2?.category || row?.category || "").trim();
  return operation === "exchange" ||
    operation === "exchange_in" ||
    operation === "exchange_out" ||
    category === "exchange";
}

export function isExchangeMissingAmountUsdRow(row = {}) {
  if (!isExchangeOperation(row)) return false;
  if (hasNonZeroLedgerAmountUsd(row?.ledgerV2?.amount_usd)) return false;
  if (Object.prototype.hasOwnProperty.call(row, "amountUsd")) {
    return String(row.amountUsd ?? "").trim() === "";
  }
  if (Object.prototype.hasOwnProperty.call(row, "amount_usd")) {
    return String(row.amount_usd ?? "").trim() === "";
  }
  return String(row?.ledgerV2?.amount_usd ?? "").trim() === "";
}

function hasNonZeroLedgerAmountUsd(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  const numeric = Number(raw.replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(numeric)) return true;
  return numeric !== 0;
}

export function countExchangeMissingAmountUsdRows(operations = []) {
  return (operations || []).filter(isExchangeMissingAmountUsdRow).length;
}
