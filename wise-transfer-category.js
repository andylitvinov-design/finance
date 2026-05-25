(() => {
  const root = typeof window !== "undefined" ? window : globalThis;
  const WISE_TRANSFER_CATEGORY = "transferWise";
  const WISE_TRANSFER_LABEL = "Перевод Wise";
  const WISE_TARGET_CHANNEL = "wise boleslav usd";

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[\s_-]+/g, " ");
  }

  function isWiseTransferCategory(value) {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    return normalized === normalizeText(WISE_TRANSFER_CATEGORY) ||
      normalized === "wise transfer" ||
      normalized === "transfer wise" ||
      normalized === "перевод wise" ||
      normalized === "перевод вайз" ||
      (normalized.includes("перевод") && normalized.includes("wise"));
  }

  function isWiseTransferLedgerRow(entry) {
    if (isWiseTransferCategory(entry?.category || entry?.ledgerV2?.legacy_category)) return true;
    const category = normalizeText(entry?.category || entry?.ledgerV2?.legacy_category || entry?.ledgerV2?.category);
    const operation = normalizeText(entry?.operation || entry?.ledgerV2?.legacy_operation || entry?.ledgerV2?.operation);
    const toChannel = normalizeText(entry?.toChannel || entry?.to_channel || entry?.ledgerV2?.to_channel);
    return category === "partner" && operation === "partner transfer" && toChannel === normalizeText(WISE_TARGET_CHANNEL);
  }

  function isWiseTransferOperationDraft(value) {
    return isWiseTransferCategory(value?.category) ||
      isWiseTransferCategory(value?.toChannel) ||
      isWiseTransferCategory(value?.to_channel);
  }

  function normalizeWiseOperationDraft(draft) {
    const output = { ...(draft || {}) };
    if (!isWiseTransferOperationDraft(output)) return output;
    output.operation = "partner_transfer";
    output.category = "partner";
    output.toChannel = WISE_TARGET_CHANNEL;
    output.to_channel = WISE_TARGET_CHANNEL;
    output.direction = "out";
    return output;
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
    const tempName = `__ezohata_${name}_wise_replacement`;
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

  function normalizeDate(value) {
    if (typeof normalizeIncomingSheetDateValue === "function") return normalizeIncomingSheetDateValue(value);
    const raw = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  }

  function normalizePersistedNumber(value) {
    if (typeof normalizeManualFinancePersistedNumberInput === "function") {
      return normalizeManualFinancePersistedNumberInput(value);
    }
    return Number(value || 0).toFixed(4).replace(".", ",");
  }

  function installCategoryNormalizer() {
    const original = getFunction("normalizeManualExpenseCategory");
    if (typeof original !== "function" || original.__wiseTransferWrapped) return false;
    function wrappedNormalizeManualExpenseCategory(value) {
      if (isWiseTransferCategory(value)) return WISE_TRANSFER_CATEGORY;
      return original.apply(this, arguments);
    }
    wrappedNormalizeManualExpenseCategory.__wiseTransferWrapped = true;
    wrappedNormalizeManualExpenseCategory.__original = original;
    setFunction("normalizeManualExpenseCategory", wrappedNormalizeManualExpenseCategory);
    return true;
  }

  function ensureSelectHasWiseTransferOption(select) {
    if (!select) return false;
    if (!Array.from(select.options || []).some((option) => option.value === WISE_TRANSFER_CATEGORY)) {
      const option = document.createElement("option");
      option.value = WISE_TRANSFER_CATEGORY;
      option.textContent = WISE_TRANSFER_LABEL;
      select.appendChild(option);
      return true;
    }
    return false;
  }

  function selectWiseTransferCategory(container, entry) {
    if (!isWiseTransferLedgerRow(entry)) return;
    const select = container?.querySelector?.("select.expense-select");
    if (!select) return;
    ensureSelectHasWiseTransferOption(select);
    select.value = WISE_TRANSFER_CATEGORY;
  }

  function ensureWiseTransferOptions() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("select.expense-select").forEach((select) => {
      ensureSelectHasWiseTransferOption(select);
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
      if (typeof original !== "function" || original.__wiseTransferWrapped) return;
      function wrappedExpenseAccountingRender(entry) {
        const node = original.apply(this, arguments);
        selectWiseTransferCategory(node, entry);
        return node;
      }
      wrappedExpenseAccountingRender.__wiseTransferWrapped = true;
      wrappedExpenseAccountingRender.__original = original;
      setFunction(functionName, wrappedExpenseAccountingRender);
      patched = true;
    });
    return patched;
  }

  function installRenderPatch() {
    const original = getFunction("renderTabs");
    if (typeof original !== "function" || original.__wiseTransferWrapped) return false;
    function wrappedRenderTabs() {
      installCategoryNormalizer();
      installExpenseRowRenderPatch();
      const result = original.apply(this, arguments);
      ensureWiseTransferOptions();
      return result;
    }
    wrappedRenderTabs.__wiseTransferWrapped = true;
    wrappedRenderTabs.__original = original;
    setFunction("renderTabs", wrappedRenderTabs);
    return true;
  }

  function entryToWiseTransferRow(entry) {
    const localAmount = Math.abs(parseAmount(entry?.localAmount));
    const usdAmount = Math.abs(parseAmount(entry?.usdAmount || entry?.localAmount));
    return {
      transferDate: normalizeDate(entry?.date) || normalizeDate(getDateInputValue("endDate")) || "",
      who: String(entry?.organization || entry?.comment || WISE_TRANSFER_LABEL).trim() || WISE_TRANSFER_LABEL,
      amount: normalizePersistedNumber(localAmount),
      currency: String(entry?.currency || "USD").trim().toUpperCase(),
      channel: WISE_TARGET_CHANNEL,
      rate: "",
      usdAmount: usdAmount ? normalizePersistedNumber(usdAmount) : ""
    };
  }

  function operationDraftToWiseTransferRow(draft) {
    const amount = Math.abs(parseAmount(draft?.amountNet || draft?.amount_net || draft?.amount));
    return {
      transferDate: normalizeDate(draft?.date) || "",
      who: String(draft?.comment || WISE_TRANSFER_LABEL).trim() || WISE_TRANSFER_LABEL,
      amount: normalizePersistedNumber(amount),
      currency: String(draft?.currency || "USD").trim().toUpperCase(),
      channel: WISE_TARGET_CHANNEL,
      rate: "",
      usdAmount: normalizePersistedNumber(amount)
    };
  }

  function sameWiseTransferRow(left, right) {
    return normalizeDate(left?.transferDate || left?.date) === normalizeDate(right?.transferDate || right?.date) &&
      Math.abs(parseAmount(left?.amount) - parseAmount(right?.amount)) < 0.000001 &&
      String(left?.currency || "").trim().toUpperCase() === String(right?.currency || "").trim().toUpperCase() &&
      String(left?.channel || "").trim() === String(right?.channel || "").trim() &&
      String(left?.who || "").trim() === String(right?.who || "").trim();
  }

  function appendMissingTransferRows(existingRows, newRows) {
    const output = Array.isArray(existingRows) ? [...existingRows] : [];
    const addedRows = [];
    (Array.isArray(newRows) ? newRows : []).forEach((row) => {
      if (!row?.transferDate || !row?.channel || parseAmount(row?.amount) <= 0) return;
      if (output.some((existing) => sameWiseTransferRow(existing, row))) return;
      output.push(row);
      addedRows.push(row);
    });
    return { transferRows: output, addedRows };
  }

  async function readExistingManualTransfers(startDate, endDate) {
    if (typeof getManualTransfersSheetDirect !== "function") return { transferRows: [], commissionRows: [] };
    try {
      return await getManualTransfersSheetDirect(startDate, endDate);
    } catch {
      return { transferRows: [], commissionRows: [] };
    }
  }

  async function syncWiseOperationDraftToTransfers(draft) {
    const row = operationDraftToWiseTransferRow(draft);
    if (!row.transferDate || !row.channel || parseAmount(row.amount) <= 0) {
      return { wiseTransferRows: 0 };
    }
    if (typeof saveManualTransfersSheetDirect !== "function") {
      throw new Error("Не найден saveManualTransfersSheetDirect для сохранения Перевод Wise в Переводы.");
    }
    const startDate = normalizeDate(getDateInputValue("startDate")) || row.transferDate;
    const endDate = normalizeDate(getDateInputValue("endDate")) || row.transferDate;
    const existing = await readExistingManualTransfers(startDate, endDate);
    const deduped = appendMissingTransferRows(existing.transferRows || [], [row]);
    if (!deduped.addedRows.length) return { wiseTransferRows: 0, duplicateSkipped: true };
    const saved = await saveManualTransfersSheetDirect(
      startDate,
      endDate,
      deduped.transferRows,
      existing.commissionRows || []
    );
    if (typeof loadDashboardData === "function") await loadDashboardData();
    return { ...saved, wiseTransferRows: deduped.addedRows.length };
  }

  async function updateLedgerRowsForWiseEntries(entries) {
    const rows = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({ entry, sheetRowNumber: Number(entry?.sheetRowNumber || entry?.sheet_row_number || 0) }))
      .filter((row) => Number.isInteger(row.sheetRowNumber) && row.sheetRowNumber >= 2);
    if (!rows.length) return { updatedLedgerRows: 0 };
    const fetchImpl = typeof fetch === "function" ? fetch : root.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("Не найден fetch для обновления Ledger строки Перевод Wise.");
    }
    let updatedLedgerRows = 0;
    for (const row of rows) {
      const response = await fetchImpl("/api/ledger-operation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          sheetRowNumber: row.sheetRowNumber,
          operation: "partner_transfer",
          category: "partner",
          to_channel: WISE_TARGET_CHANNEL,
          direction: "out"
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        const message = payload?.error || `Ledger update HTTP ${response.status}`;
        throw new Error(`Не удалось обновить Ledger строку ${row.sheetRowNumber} как Перевод Wise: ${message}`);
      }
      updatedLedgerRows += 1;
    }
    return { updatedLedgerRows };
  }

  function installSavePatch() {
    const original = getFunction("saveExpenseAccountingEntriesDirect");
    if (typeof original !== "function" || original.__wiseTransferWrapped) return false;
    async function wrappedSaveExpenseAccountingEntriesDirect(entries) {
      const rows = Array.isArray(entries) ? entries : [];
      const wiseEntries = rows.filter((entry) => isWiseTransferLedgerRow(entry));
      const regularEntries = rows.filter((entry) => !isWiseTransferLedgerRow(entry));
      let result = { rowCount: 0 };
      if (regularEntries.length) {
        result = await original.call(this, regularEntries);
      }
      if (!wiseEntries.length) return result;
      if (typeof saveManualTransfersSheetDirect !== "function") {
        throw new Error("Не найден saveManualTransfersSheetDirect для сохранения Перевод Wise в Переводы.");
      }
      const startDate = normalizeDate(getDateInputValue("startDate")) || normalizeDate(getDateInputValue("endDate"));
      const endDate = normalizeDate(getDateInputValue("endDate")) || startDate;
      if (!startDate || !endDate) throw new Error("Выберите период для сохранения Перевод Wise.");
      const existing = await readExistingManualTransfers(startDate, endDate);
      const wiseTransferRows = wiseEntries.map(entryToWiseTransferRow).filter((row) => row.transferDate && row.channel && parseAmount(row.amount) > 0);
      const deduped = appendMissingTransferRows(existing.transferRows || [], wiseTransferRows);
      const saved = await saveManualTransfersSheetDirect(
        startDate,
        endDate,
        deduped.transferRows,
        existing.commissionRows || []
      );
      const ledgerUpdate = await updateLedgerRowsForWiseEntries(wiseEntries);
      return {
        ...result,
        ...saved,
        ...ledgerUpdate,
        rowCount: Number(result?.rowCount || 0) + deduped.addedRows.length,
        wiseTransferRows: deduped.addedRows.length
      };
    }
    wrappedSaveExpenseAccountingEntriesDirect.__wiseTransferWrapped = true;
    wrappedSaveExpenseAccountingEntriesDirect.__original = original;
    setFunction("saveExpenseAccountingEntriesDirect", wrappedSaveExpenseAccountingEntriesDirect);
    return true;
  }

  function installOperationEditorSavePatch() {
    const original = getFunction("saveExpenseOperationEdit");
    if (typeof original !== "function" || original.__wiseTransferWrapped) return false;
    async function wrappedSaveExpenseOperationEdit(row) {
      const draft = root.state?.expenseAccounting?.operationDraft;
      if (!isWiseTransferOperationDraft(draft)) {
        return original.apply(this, arguments);
      }
      const normalizedDraft = normalizeWiseOperationDraft(draft);
      root.state.expenseAccounting.operationDraft = normalizedDraft;
      const result = await original.apply(this, arguments);
      const saved = !root.state?.expenseAccounting?.operationDraft &&
        Number(root.state?.expenseAccounting?.editingSheetRowNumber || 0) === 0;
      if (!saved) return result;
      try {
        const transferResult = await syncWiseOperationDraftToTransfers(normalizedDraft);
        if (typeof setExpenseAccountingStatus === "function" && transferResult?.wiseTransferRows) {
          setExpenseAccountingStatus(`Ledger row ${row?.sheetRowNumber || normalizedDraft.sheetRowNumber} updated. Перевод Wise добавлен в Transfers.`, false);
        }
      } catch (error) {
        if (typeof setExpenseAccountingStatus === "function") {
          setExpenseAccountingStatus(error.message || "Не удалось добавить Перевод Wise в Transfers.", true);
        } else {
          throw error;
        }
      } finally {
        if (typeof renderTabs === "function") renderTabs();
      }
      return result;
    }
    wrappedSaveExpenseOperationEdit.__wiseTransferWrapped = true;
    wrappedSaveExpenseOperationEdit.__original = original;
    setFunction("saveExpenseOperationEdit", wrappedSaveExpenseOperationEdit);
    return true;
  }

  function install() {
    installCategoryNormalizer();
    installExpenseRowRenderPatch();
    installSavePatch();
    installOperationEditorSavePatch();
    installRenderPatch();
    ensureWiseTransferOptions();
  }

  root.EzohataWiseTransferCategory = {
    WISE_TRANSFER_CATEGORY,
    WISE_TRANSFER_LABEL,
    WISE_TARGET_CHANNEL,
    appendMissingTransferRows,
    entryToWiseTransferRow,
    install,
    isWiseTransferCategory,
    isWiseTransferLedgerRow,
    isWiseTransferOperationDraft,
    normalizeWiseOperationDraft,
    operationDraftToWiseTransferRow,
    sameWiseTransferRow,
    syncWiseOperationDraftToTransfers,
    updateLedgerRowsForWiseEntries
  };

  install();
})();
