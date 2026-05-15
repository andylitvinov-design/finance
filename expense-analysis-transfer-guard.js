(() => {
  const root = typeof window !== "undefined" ? window : globalThis;

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function getGlobalValue(name) {
    try {
      if (root[name] !== undefined) return root[name];
      return (0, eval)(`typeof ${name} !== "undefined" ? ${name} : undefined`);
    } catch {
      return undefined;
    }
  }

  function setFunction(name, value) {
    root[name] = value;
    const tempName = `__ezohata_${name}_transfer_guard_replacement`;
    try {
      root[tempName] = value;
      return (0, eval)(`${name} = ${tempName}`);
    } catch {
      return value;
    } finally {
      try { delete root[tempName]; } catch {}
    }
  }

  function isFopTransferLike(row) {
    const operation = normalizeText(row?.operation || row?.ledgerV2?.operation || row?.ledgerV2?.legacy_operation);
    const category = normalizeText(row?.category || row?.ledgerV2?.category || row?.ledgerV2?.legacy_category);
    const direction = normalizeText(row?.direction || row?.ledgerV2?.direction);
    const toChannel = normalizeText(row?.toChannel || row?.to_channel || row?.ledgerV2?.to_channel);
    const text = normalizeText([
      row?.comment,
      row?.description,
      row?.ledgerV2?.comment,
      row?.ledgerV2?.description,
    ].filter(Boolean).join(" "));

    if (category === "transferfop" || category === "transfer fop" || category === "перевод фоп") return true;
    if (category === "partner" && operation === "partner transfer" && toChannel === "приват фоп") return true;
    if (toChannel === "приват фоп" && direction === "out" && /transfer|перевод|fop|фоп/.test(`${operation} ${category} ${text}`)) return true;
    return false;
  }

  function install() {
    const original = getGlobalValue("isTransferOrExchangeRow");
    if (typeof original !== "function" || original.__expenseAnalysisTransferGuardWrapped) return false;

    function wrappedIsTransferOrExchangeRow(row) {
      if (isFopTransferLike(row)) return true;
      return original.apply(this, arguments);
    }

    wrappedIsTransferOrExchangeRow.__expenseAnalysisTransferGuardWrapped = true;
    wrappedIsTransferOrExchangeRow.__original = original;
    setFunction("isTransferOrExchangeRow", wrappedIsTransferOrExchangeRow);
    return true;
  }

  root.EzohataExpenseAnalysisTransferGuard = {
    install,
    isFopTransferLike,
  };

  install();
})();
