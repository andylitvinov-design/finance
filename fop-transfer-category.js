(() => {
  const root = typeof window !== "undefined" ? window : globalThis;
  const FOP_TRANSFER_CATEGORY = "transferFop";
  const FOP_TRANSFER_LABEL = "Перевод ФОП";

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[\s_-]+/g, " ");
  }

  function isFopTransferCategory(value) {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    return normalized === normalizeText(FOP_TRANSFER_CATEGORY) ||
      normalized === "fop transfer" ||
      normalized === "transfer fop" ||
      normalized === "перевод фоп" ||
      (normalized.includes("перевод") && normalized.includes("фоп"));
  }

  function getGlobalValue(name) {
    try {
      if (root[name] !== undefined) return root[name];
      return (0, eval)(`typeof ${name} !== "undefined" ? ${name} : undefined`);
    } catch {
      return undefined;
    }
  }

  function getFunction(name) {
    const value = getGlobalValue(name);
    return typeof value === "function" ? value : null;
  }

  function setFunction(name, value) {
    root[name] = value;
    const tempName = `__ezohata_${name}_replacement`;
    try {
      root[tempName] = value;
      return (0, eval)(`${name} = ${tempName}`);
    } catch {
      return value;
    } finally {
      try { delete root[tempName]; } catch {}
    }
  }

  function getElements() {
    return getGlobalValue("elements") || root.elements || {};
  }

  function getDateInputValue(id) {
    const appElements = getElements();
    if (appElements?.[id]?.value) return appElements[id].value;
    if (typeof document !== "undefined") return document.getElementById(id)?.value || "";
    return "";
  }

  function parseAmount(value) {
    if (typeof parseLooseNumber === "function") return parseLooseNumber(value);
    const normalized = String(value ?? "").replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function formatAmount(value) {
    if (typeof formatSheetNumber === "function") return formatSheetNumber(value);
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function normalizeDate(value) {
    if (typeof normalizeIncomingSheetDateValue === "function") return normalizeIncomingSheetDateValue(value);
    const raw = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  }

  function normalizePersistedNumber(value) {
    if (typeof normalizeManualFinancePersistedNumberInput === "function") {
      return normalizeManualFinancePersistedNumberInput(value);
    }
    return formatAmount(value);
  }

  function installCategoryNormalizer() {
    const original = getFunction("normalizeManualExpenseCategory");
    if (typeof original !== "function" || original.__fopTransferWrapped) return false;
    function wrappedNormalizeManualExpenseCategory(value) {
      if (isFopTransferCategory(value)) return FOP_TRANSFER_CATEGORY;
      return original.apply(this, arguments);
    }
    wrappedNormalizeManualExpenseCategory.__fopTransferWrapped = true;
    wrappedNormalizeManualExpenseCategory.__original = original;
    setFunction("normalizeManualExpenseCategory", wrappedNormalizeManualExpenseCategory);
    return true;
  }

  function ensureSelectHasFopTransferOption(select) {
    if (!select) return false;
    if (!Array.from(select.options || []).some((option) => option.value === FOP_TRANSFER_CATEGORY)) {
      const option = document.createElement("option");
      option.value = FOP_TRANSFER_CATEGORY;
      option.textContent = FOP_TRANSFER_LABEL;
      select.appendChild(option);
      return true;
    }
    return false;
  }

  function selectFopTransferCategory(container, entry) {
    if (!isFopTransferCategory(entry?.category)) return;
    const select = container?.querySelector?.("select.expense-select");
    if (!select) return;
    ensureSelectHasFopTransferOption(select);
    select.value = FOP_TRANSFER_CATEGORY;
  }

  function ensureFopTransferOptions() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("select.expense-select").forEach((select) => {
      ensureSelectHasFopTransferOption(select);
    });
  }

  function installExpenseRowRenderPatch() {
    let patched = false;
    [
      "renderExpenseAccountingTableRow",
      "renderExpenseAccountingMobileCard",
      "renderExpenseAccountingRow"
    ].forEach((functionName) => {
      const original = getFunction(functionName);
      if (typeof original !== "function" || original.__fopTransferWrapped) return;
      function wrappedExpenseAccountingRender(entry) {
        const node = original.apply(this, arguments);
        selectFopTransferCategory(node, entry);
        return node;
      }
      wrappedExpenseAccountingRender.__fopTransferWrapped = true;
      wrappedExpenseAccountingRender.__original = original;
      setFunction(functionName, wrappedExpenseAccountingRender);
      patched = true;
    });
    return patched;
  }

  function installRenderPatch() {
    const original = getFunction("renderTabs");
    if (typeof original !== "function" || original.__fopTransferWrapped) return false;
    function wrappedRenderTabs() {
      installCategoryNormalizer();
      installExpenseRowRenderPatch();
      const result = original.apply(this, arguments);
      ensureFopTransferOptions();
      return result;
    }
    wrappedRenderTabs.__fopTransferWrapped = true;
    wrappedRenderTabs.__original = original;
    setFunction("renderTabs", wrappedRenderTabs);
    return true;
  }

  function entryToFopTransferRow(entry) {
    const localAmount = Math.abs(parseAmount(entry?.localAmount));
    const usdAmount = Math.abs(parseAmount(entry?.usdAmount));
    const currency = String(entry?.currency || (typeof inferManualFinanceChannelCurrency === "function" ? inferManualFinanceChannelCurrency(entry?.channel) : "")).trim().toUpperCase();
    const rate = localAmount && usdAmount && currency !== "USD" ? localAmount / usdAmount : "";
    return {
      transferDate: normalizeDate(entry?.date) || normalizeDate(getDateInputValue("endDate")) || "",
      who: String(entry?.organization || FOP_TRANSFER_LABEL).trim() || FOP_TRANSFER_LABEL,
      amount: normalizePersistedNumber(localAmount),
      currency,
      channel: String(entry?.channel || "").trim(),
      rate: rate ? normalizePersistedNumber(rate) : "",
      usdAmount: usdAmount ? normalizePersistedNumber(usdAmount) : ""
    };
  }

  async function readExistingManualTransfers(startDate, endDate) {
    if (typeof getManualTransfersSheetDirect !== "function") return { transferRows: [], commissionRows: [] };
    try {
      return await getManualTransfersSheetDirect(startDate, endDate);
    } catch {
      return { transferRows: [], commissionRows: [] };
    }
  }

  function installSavePatch() {
    const original = getFunction("saveExpenseAccountingEntriesDirect");
    if (typeof original !== "function" || original.__fopTransferWrapped) return false;
    async function wrappedSaveExpenseAccountingEntriesDirect(entries) {
      const rows = Array.isArray(entries) ? entries : [];
      const fopEntries = rows.filter((entry) => isFopTransferCategory(entry?.category));
      const regularEntries = rows.filter((entry) => !isFopTransferCategory(entry?.category));
      let result = { rowCount: 0 };
      if (regularEntries.length) {
        result = await original.call(this, regularEntries);
      }
      if (!fopEntries.length) return result;
      if (typeof saveManualTransfersSheetDirect !== "function") {
        throw new Error("Не найден saveManualTransfersSheetDirect для сохранения Перевод ФОП в Переводы.");
      }
      const startDate = normalizeDate(getDateInputValue("startDate")) || normalizeDate(getDateInputValue("endDate"));
      const endDate = normalizeDate(getDateInputValue("endDate")) || startDate;
      if (!startDate || !endDate) throw new Error("Выберите период для сохранения Перевод ФОП.");
      const existing = await readExistingManualTransfers(startDate, endDate);
      const fopTransferRows = fopEntries.map(entryToFopTransferRow).filter((row) => row.transferDate && row.channel && parseAmount(row.amount) > 0);
      const saved = await saveManualTransfersSheetDirect(
        startDate,
        endDate,
        [...(existing.transferRows || []), ...fopTransferRows],
        existing.commissionRows || []
      );
      return {
        ...result,
        ...saved,
        rowCount: Number(result?.rowCount || 0) + fopTransferRows.length,
        fopTransferRows: fopTransferRows.length
      };
    }
    wrappedSaveExpenseAccountingEntriesDirect.__fopTransferWrapped = true;
    wrappedSaveExpenseAccountingEntriesDirect.__original = original;
    setFunction("saveExpenseAccountingEntriesDirect", wrappedSaveExpenseAccountingEntriesDirect);
    return true;
  }

  function install() {
    installCategoryNormalizer();
    installExpenseRowRenderPatch();
    installSavePatch();
    installRenderPatch();
    ensureFopTransferOptions();
  }

  root.EzohataFopTransferCategory = {
    FOP_TRANSFER_CATEGORY,
    FOP_TRANSFER_LABEL,
    entryToFopTransferRow,
    install,
    isFopTransferCategory
  };

  install();
})();
