(function installBinanceOneClickImport(root) {
  const BINANCE_API_PATH = "./api/binance-transactions";
  const PROVIDER = "binance";

  function hasRequiredGlobals() {
    return typeof root.renderExpenseAccountingBlock === "function" &&
      typeof root.normalizeIncomingSheetDateValue === "function" &&
      typeof root.normalizeExpenseAccountingEntry === "function" &&
      typeof root.renderTabs === "function" &&
      typeof root.setExpenseAccountingStatus === "function" &&
      root.state &&
      root.elements;
  }

  function isLoading() {
    const expense = root.state?.expenseAccounting || {};
    return Boolean(
      expense.loading ||
      expense.paypalLoading ||
      expense.wiseLoading ||
      expense.yoomoneyLoading ||
      expense.monobankLoading ||
      expense.privatBankLoading ||
      expense.privat24ImportLoading ||
      expense.statementImportLoading ||
      expense.tdBankLoading ||
      expense.binanceLoading
    );
  }

  async function readJsonResponse(response, providerLabel) {
    const text = await response.text().catch(() => "");
    const raw = String(text || "").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      const excerpt = raw.replace(/\s+/g, " ").slice(0, 300) || "non-JSON response";
      throw new Error(`${providerLabel} вернул не-JSON ответ (${response.status || "unknown"}): ${excerpt}`);
    }
  }

  async function loadBinanceExpenseStatement() {
    const startDate = root.normalizeIncomingSheetDateValue(root.elements.startDate.value);
    const endDate = root.normalizeIncomingSheetDateValue(root.elements.endDate.value);
    if (!startDate || !endDate) {
      root.setExpenseAccountingStatus("Выберите период для Binance-выписки.", true);
      root.renderTabs();
      return;
    }

    root.state.expenseAccounting.binanceLoading = true;
    root.setExpenseAccountingStatus("Запрашиваю Binance-выписку за выбранный период...", false);
    root.renderTabs();
    try {
      const response = await fetch(BINANCE_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate })
      });
      const payload = await readJsonResponse(response, "Binance");
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Binance вернул ошибку (${response.status}).`);
      }
      const entries = (payload.entries || []).map((entry, index) => root.normalizeExpenseAccountingEntry(entry, index));
      root.state.expenseAccounting.entries = [
        ...(root.state.expenseAccounting.entries || []).filter((entry) => entry.source !== PROVIDER),
        ...entries
      ];
      root.state.expenseAccounting.binanceSummary = typeof root.hasProviderSummaryData === "function" && root.hasProviderSummaryData(payload.summary)
        ? payload.summary
        : (typeof root.buildProviderExpenseSummary === "function" ? root.buildProviderExpenseSummary(entries) : payload.summary || null);
      root.state.expenseAccounting.warnings = payload.warnings || [];
      root.state.expenseAccounting.resultTab = typeof root.getExpenseAccountingDirectionCounts === "function" && root.getExpenseAccountingDirectionCounts().spent
        ? "spent"
        : "received";
      const statusParts = [];
      if (entries.length) statusParts.push(`Binance-выписка загружена: ${entries.length} строк из ${payload.transactionCount || entries.length} операций.`);
      else statusParts.push("Binance-выписка загружена, но строк за период не найдено.");
      if (payload.endpointStatus) {
        const endpointStatus = Object.entries(payload.endpointStatus)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");
        if (endpointStatus) statusParts.push(`Endpoint status: ${endpointStatus}.`);
      }
      statusParts.push("Проверьте категории перед внесением.");
      root.setExpenseAccountingStatus(statusParts.join(" "), false);
    } catch (error) {
      root.setExpenseAccountingStatus(error.message || "Не удалось загрузить Binance-выписку.", true);
    } finally {
      root.state.expenseAccounting.binanceLoading = false;
      root.renderTabs();
    }
  }

  function createBinanceButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.dataset.provider = PROVIDER;
    button.textContent = root.state?.expenseAccounting?.binanceLoading ? "Загружаю Binance..." : "Подтянуть Binance";
    button.disabled = isLoading();
    button.addEventListener("click", loadBinanceExpenseStatement);
    return button;
  }

  function injectBinanceButton(shell) {
    const actions = shell?.querySelector?.(".expense-actions");
    if (!actions || actions.querySelector('[data-provider="binance"]')) return shell;
    actions.appendChild(createBinanceButton());
    return shell;
  }

  function patchRenderExpenseAccountingBlock() {
    if (!hasRequiredGlobals() || root.__ezohataBinanceOneClickPatched) return;
    const original = root.renderExpenseAccountingBlock;
    root.renderExpenseAccountingBlock = function renderExpenseAccountingBlockWithBinance(...args) {
      const shell = original.apply(this, args);
      return injectBinanceButton(shell);
    };
    root.__ezohataBinanceOneClickPatched = true;
  }

  patchRenderExpenseAccountingBlock();
  root.EzohataBinanceOneClick = {
    loadBinanceExpenseStatement,
    injectBinanceButton,
    patchRenderExpenseAccountingBlock
  };
})(typeof window !== "undefined" ? window : globalThis);
