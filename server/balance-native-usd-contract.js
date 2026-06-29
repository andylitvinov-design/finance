const VALUE_TYPES = new Set([
  "native_and_usd",
  "native_only",
  "usd_only_needs_native",
  "explicit_zero",
  "carried_forward",
  "calculated_hint",
  "needs_verification",
]);

export function parseBalanceNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = normalizeNumericText(raw);
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function classifyBalanceValue(row = {}) {
  if (isCalculatedHint(row)) return "calculated_hint";
  if (isCarriedForward(row)) return "carried_forward";

  const explicitType = normalizeValueType(row?.value_type ?? row?.valueType);
  if (explicitType && VALUE_TYPES.has(explicitType)) return explicitType;

  const native = parseBalanceNumber(getNativeValue(row));
  const usd = parseBalanceNumber(getUsdValue(row));
  const currency = normalizeCurrency(row?.currency);
  const hasNativeInput = hasExplicitValue(getNativeValue(row));
  const hasUsdInput = hasExplicitValue(getUsdValue(row));

  if (hasNativeInput && native === 0) return "explicit_zero";
  if (native !== null && currency === "USD") return "native_and_usd";
  if (native !== null && usd !== null) return "native_and_usd";
  if (native !== null) return "native_only";
  if (native === null && usd !== null && hasUsdInput) return "usd_only_needs_native";
  return "needs_verification";
}

export function normalizeBalanceValueContract(row = {}) {
  const valueType = classifyBalanceValue(row);
  if (valueType === "calculated_hint" || valueType === "carried_forward") {
    return emptyContract(valueType);
  }

  const native = parseBalanceNumber(getNativeValue(row));
  const explicitUsd = parseBalanceNumber(getUsdValue(row));
  const currency = normalizeCurrency(row?.currency);
  const rate = parseBalanceNumber(row?.fx_rate_to_usd ?? row?.fxRateToUsd ?? row?.rate);
  const amountUsd = resolveAmountUsd({ native, explicitUsd, currency });
  const fxRate = resolveFxRate({ native, amountUsd, currency, rate });

  return {
    amount_native: native,
    amount_usd: amountUsd,
    fx_rate_to_usd: fxRate,
    value_type: valueType,
  };
}

function emptyContract(valueType) {
  return {
    amount_native: null,
    amount_usd: null,
    fx_rate_to_usd: null,
    value_type: valueType,
  };
}

function resolveAmountUsd({ native, explicitUsd, currency }) {
  if (explicitUsd !== null) return explicitUsd;
  if (currency === "USD" && native !== null) return native;
  return null;
}

function resolveFxRate({ native, amountUsd, currency, rate }) {
  if (currency === "USD" && native !== null) return 1;
  if (rate !== null) return rate;
  if (native !== null && native !== 0 && amountUsd !== null) return amountUsd / native;
  return null;
}

function getNativeValue(row = {}) {
  if (Object.prototype.hasOwnProperty.call(row, "amount_native")) return row.amount_native;
  if (Object.prototype.hasOwnProperty.call(row, "nativeAmount")) return row.nativeAmount;
  if (Object.prototype.hasOwnProperty.call(row, "balanceAmount")) return row.balanceAmount;
  if (Object.prototype.hasOwnProperty.call(row, "amount")) return row.amount;
  return undefined;
}

function getUsdValue(row = {}) {
  if (Object.prototype.hasOwnProperty.call(row, "amount_usd")) return row.amount_usd;
  if (Object.prototype.hasOwnProperty.call(row, "amountUsd")) return row.amountUsd;
  if (Object.prototype.hasOwnProperty.call(row, "usdAmount")) return row.usdAmount;
  return undefined;
}

function hasExplicitValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeValueType(value) {
  return String(value || "").trim().toLowerCase();
}

function isCalculatedHint(row = {}) {
  if (hasExplicitValue(row?.calculated_closing_balance)) return true;
  if (hasExplicitValue(row?.computed_real_closing_balance)) return true;
  if (hasExplicitValue(row?.expected_closing_hint)) return true;
  const marker = [
    row?.source,
    row?.fact_source,
    row?.value_type,
    row?.valueType,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /(^|[^a-z])(calculated|computed)([^a-z]|$)/.test(marker);
}

function isCarriedForward(row = {}) {
  const marker = [
    row?.source,
    row?.fact_source,
    row?.value_type,
    row?.valueType,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /carried[_ -]?forward/.test(marker);
}

function normalizeNumericText(raw) {
  const compact = String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return compact
      .replace(new RegExp(`\\${thousandsSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
  }
  if (lastComma !== -1) return compact.replace(/,/g, ".");
  return compact.replace(/,/g, "");
}
