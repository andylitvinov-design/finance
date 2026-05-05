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
  if (Object.prototype.hasOwnProperty.call(row, "amountUsd")) {
    return String(row.amountUsd ?? "").trim() === "";
  }
  if (Object.prototype.hasOwnProperty.call(row, "amount_usd")) {
    return String(row.amount_usd ?? "").trim() === "";
  }
  return String(row?.ledgerV2?.amount_usd ?? "").trim() === "";
}

export function countExchangeMissingAmountUsdRows(operations = []) {
  return (operations || []).filter(isExchangeMissingAmountUsdRow).length;
}
