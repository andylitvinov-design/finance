(function initPeriodBalanceReconciliationUi(root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.EzohataPeriodBalanceReconciliationUi = api;
    if (typeof root.document !== "undefined") api.installPeriodBalanceReconciliationUi(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPeriodBalanceReconciliationUi(root) {
  const channelDisplayOrder = root.EzohataChannelDisplayOrder || (typeof require === "function" ? require("./channel-display-order.js") : {});
  const BLOCK_TITLE = "Сверка баланса за период";

  function installPeriodBalanceReconciliationUi(globalRoot = root) {
    const original = globalRoot.renderAnalyticsSections;
    if (typeof original !== "function" || original.__periodBalanceReconciliationWrapped) return false;

    function wrappedRenderAnalyticsSections(container) {
      const result = original.apply(this, arguments);
      try {
        removeCompetingLegacyBalanceSections(container);
        const placeholder = renderPlaceholder(globalRoot.document);
        prependToAnalyticsContainer(container, placeholder);
        loadAndRender(globalRoot, placeholder);
      } catch (error) {
        // Additive UI extension must never break the existing analytics screen.
      }
      return result;
    }
    wrappedRenderAnalyticsSections.__periodBalanceReconciliationWrapped = true;
    globalRoot.renderAnalyticsSections = wrappedRenderAnalyticsSections;
    return true;
  }

  function removeCompetingLegacyBalanceSections(container) {
    Array.from(container?.children || []).forEach((child) => {
      const text = String(child?.textContent || "");
      if (!isCompetingLegacyBalanceSection(text)) return;
      if (typeof child.remove === "function") {
        child.remove();
        return;
      }
      const siblings = child.parentElement?.children;
      const index = Array.isArray(siblings) ? siblings.indexOf(child) : -1;
      if (index !== -1) siblings.splice(index, 1);
    });
  }

  function isCompetingLegacyBalanceSection(text) {
    const normalized = String(text || "").toUpperCase();
    return normalized.includes("БАЛАНС") &&
      normalized.includes("PLAN PROFIT") &&
      normalized.includes("РАЗНИЦА1") &&
      normalized.includes("EXTRA");
  }

  async function loadAndRender(globalRoot, container) {
    const doc = globalRoot.document;
    if (!doc || !container) return;
    try {
      const snapshot = await fetchPeriodBalanceReconciliation(globalRoot);
      container.replaceWith(renderPeriodBalanceBlock(doc, snapshot, { showDiagnostics: shouldShowDiagnostics(globalRoot) }));
    } catch (error) {
      container.replaceWith(renderError(doc, error));
    }
  }

  function shouldShowDiagnostics(globalRoot = root) {
    const search = String(globalRoot?.location?.search || globalRoot?.window?.location?.search || "");
    if (/[?&]debugPeriodBalance=1\b/.test(search)) return true;
    try {
      return String(globalRoot?.localStorage?.getItem?.("debugPeriodBalance") || "") === "1";
    } catch (error) {
      return false;
    }
  }

  function prependToAnalyticsContainer(container, node) {
    const children = Array.from(container.children || []);
    if (children[0] && typeof container.insertBefore === "function") {
      container.insertBefore(node, children[0]);
      return;
    }
    container.appendChild(node);
  }

  async function fetchPeriodBalanceReconciliation(globalRoot = root) {
    const doc = globalRoot.document;
    const startDate = String(doc?.getElementById("startDate")?.value || "").trim();
    const endDate = String(doc?.getElementById("endDate")?.value || "").trim();
    const params = new URLSearchParams();
    if (startDate) params.set("from", startDate);
    if (endDate) params.set("to", endDate);
    const url = `/api/period-balance-reconciliation${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await globalRoot.fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Period balance reconciliation failed with HTTP ${response.status}`);
    }
    return payload;
  }

  function renderPlaceholder(doc) {
    const section = createSection(doc);
    const body = doc.createElement("div");
    body.className = "config-note";
    body.textContent = "Загружаю сверку баланса за период...";
    section.appendChild(body);
    return section;
  }

  function renderError(doc, error) {
    const section = createSection(doc);
    const status = doc.createElement("div");
    status.className = "finance-status error";
    status.textContent = `Сверка баланса за период пока недоступна: ${String(error?.message || error || "API не загрузился")}`;
    section.appendChild(status);
    return section;
  }

  function renderPeriodBalanceBlock(doc, snapshot, options = {}) {
    const section = createSection(doc);
    const reconciliation = snapshot?.period_balance_reconciliation;
    if (!reconciliation) {
      const empty = doc.createElement("div");
      empty.className = "finance-status error";
      empty.textContent = "API не вернул period_balance_reconciliation.";
      section.appendChild(empty);
      return section;
    }

    const positionRows = reconciliation.by_channel_currency || [];
    const meaningfulRows = sortDisplayRows(positionRows.filter(isMeaningfulReconciliationRow));
    const emptyRows = sortDisplayRows(positionRows.filter((row) => !isMeaningfulReconciliationRow(row)));
    section.appendChild(renderSummary(doc, reconciliation.summary || {}, reconciliation.period || {}, positionRows));
    if (reconciliation.binance_wallet_diagnostics) {
      section.appendChild(renderBinanceWalletDiagnostics(doc, reconciliation.binance_wallet_diagnostics));
    }
    const visibleTotalUsdRow = chooseVisibleTotalUsdRow(reconciliation);
    section.appendChild(renderPositionTable(doc, meaningfulRows, reconciliation.summary || {}, visibleTotalUsdRow));
    if (options.showDiagnostics) {
      section.appendChild(renderDiagnosticPositionTable(doc, meaningfulRows, reconciliation.summary || {}, visibleTotalUsdRow));
      section.appendChild(renderTopTotals(doc, reconciliation || {}));
    }
    if (emptyRows.length) section.appendChild(renderNoDataRowsBlock(doc, emptyRows));

    const requiredManualFactRows = sortDisplayRows(reconciliation.required_manual_fact_rows || []);
    if (requiredManualFactRows.length) {
      section.appendChild(renderRequiredManualFactRows(doc, requiredManualFactRows));
    }

    const actions = sortDisplayRows(reconciliation.actionable_rows || []);
    if (actions.length) {
      section.appendChild(renderSubsection(
        doc,
        "Где исправить",
        ["Счёт", "Валюта", "Статус", "Реал разница", "План-реал", "Диагноз", "Что сделать"],
        actions.map((row) => [
          row.channel || "—",
          row.currency || "—",
          getStatusLabel(row.status),
          formatNumber(row.real_difference),
          formatNumber(row.plan_vs_real_delta),
          row.diagnosis || "—",
          row.fix_action || "—",
        ])
      ));
    }

    const warnings = snapshot?.warnings || reconciliation.warnings || [];
    if (warnings.length) {
      const note = doc.createElement("div");
      note.className = "config-note";
      note.textContent = `Warnings: ${warnings.slice(0, 3).join(" | ")}`;
      section.appendChild(note);
    }
    return section;
  }

  function renderBinanceWalletDiagnostics(doc, diagnostics) {
    const rows = [
      ...(diagnostics.wallets || []).map((row) => [
        row.channel || "—",
        formatNumber(row.opening),
        formatNumber(row.movement),
        formatNumber(row.closing_fact),
        formatNumber(row.difference),
        Object.entries(row.statuses || {}).map(([status, count]) => `${getStatusLabel(status)}: ${count}`).join(", ") || "—",
      ]),
      [
        "Binance total",
        formatNumber(diagnostics.total?.opening),
        formatNumber(diagnostics.total?.movement),
        formatNumber(diagnostics.total?.closing_fact),
        formatNumber(diagnostics.total?.difference),
        `Unmapped: ${diagnostics.unmapped_operations || 0}; needs verification: ${diagnostics.skipped_needs_verification || 0}`,
      ],
    ];
    return renderSubsection(
      doc,
      "Binance diagnostics",
      ["Wallet", "Opening", "Movement", "Closing fact", "Difference", "Status"],
      rows
    );
  }

  function createSection(doc) {
    const section = doc.createElement("section");
    section.className = "finance-analysis-section period-balance-reconciliation-section";
    const header = doc.createElement("div");
    header.className = "tab-header";
    header.innerHTML = `<div><h3>${escapeHtml(BLOCK_TITLE)}</h3><div class="tab-note">Период: начальный остаток → плановое изменение → реальное изменение → фактический остаток → расхождение.</div></div>`;
    section.appendChild(header);
    return section;
  }

  function renderSummary(doc, summary, period, positionRows) {
    const block = doc.createElement("div");
    block.className = "period-balance-verdict";
    const status = doc.createElement("div");
    const counts = getDisplayStatusCounts(summary, positionRows);
    const label = getFinalVerdict(summary, counts);
    status.className = label === "НЕ ОК" ? "finance-status error" : "finance-status";
    status.textContent = `ИТОГО: ${label} (${period.from || "?"} - ${period.to || "?"})`;
    block.appendChild(status);

    const cards = doc.createElement("div");
    cards.className = "metrics period-balance-summary";
    [
      ["Период", `${period.from || "?"} - ${period.to || "?"}`],
      ["Проверено позиций", counts.total],
      ["OK позиций", counts.ok],
      ["Расхождения", counts.mismatch],
      ["Нет факта на дату", counts.missing_provider_balance],
      ["Нет начального", counts.missing_opening_balance],
      ["Нет конечного", counts.missing_closing_balance],
      ["Нет amount_net", counts.missing_amount_net],
      ["Без amount_net", summary.missing_amount_net_rows],
      ["Факт из Остатки", summary.balance_source_counts?.manual_fact ?? summary.manual_fact_rows],
      ["Авто факт к подтверждению", summary.balance_source_counts?.provider_auto ?? summary.provider_auto_rows],
      ["Нужно ввести факт", summary.balance_source_counts?.missing ?? summary.missing_fact_rows],
      ["Заблокировано", summary.blocked],
    ].forEach(([text, value]) => {
      const card = doc.createElement("div");
      card.className = "metric";
      const labelNode = doc.createElement("div");
      labelNode.className = "metric-label";
      labelNode.textContent = text;
      const valueNode = doc.createElement("div");
      valueNode.className = "metric-value";
      valueNode.textContent = String(value ?? 0);
      card.append(labelNode, valueNode);
      cards.appendChild(card);
    });
    block.appendChild(cards);
    return block;
  }

  function getDisplayStatusCounts(summary, rows) {
    const statusCounts = summary?.status_counts || {};
    const rowsList = Array.isArray(rows) ? rows : [];
    const derived = rowsList.reduce((result, row) => {
      const status = String(row?.status || "needs_verification").trim() || "needs_verification";
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {});
    return {
      total: Number(summary?.positions_checked ?? rowsList.length ?? 0) || 0,
      ok: Number(statusCounts.ok ?? derived.ok ?? 0) || 0,
      mismatch: Number(statusCounts.mismatch ?? derived.mismatch ?? 0) || 0,
      missing_opening_balance: Number(statusCounts.missing_opening_balance ?? derived.missing_opening_balance ?? 0) || 0,
      missing_provider_balance: Number(statusCounts.missing_provider_balance ?? derived.missing_provider_balance ?? 0) || 0,
      missing_closing_balance: Number(statusCounts.missing_closing_balance ?? derived.missing_closing_balance ?? 0) || 0,
      missing_amount_net: Number(statusCounts.missing_amount_net ?? summary?.missing_amount_net_rows ?? derived.missing_amount_net ?? 0) || 0,
      needs_verification: Number(statusCounts.needs_verification ?? derived.needs_verification ?? 0) || 0,
    };
  }

  function getFinalVerdict(summary, counts) {
    const status = String(summary?.status || "").trim();
    if (status === "ok") return "OK";
    if (status === "failed") return "НЕ ОК";
    if (counts.mismatch || counts.missing_opening_balance || counts.missing_provider_balance || counts.missing_closing_balance || counts.missing_amount_net) return "НЕ ОК";
    if (counts.total && counts.ok === counts.total) return "OK";
    return "Проверить";
  }

  function renderTopTotals(doc, reconciliation) {
    const byCurrency = Array.isArray(reconciliation.by_currency) ? reconciliation.by_currency : [];
    const byPosition = Array.isArray(reconciliation.by_channel_currency) ? reconciliation.by_channel_currency : [];
    const currencies = getSummaryCurrencies(byCurrency, byPosition);
    const block = doc.createElement("div");
    block.className = "period-balance-total-summary";
    const title = doc.createElement("div");
    title.className = "tab-note";
    title.textContent = "Сводка по валютам, справочно";
    block.appendChild(title);
    if (!currencies.length) {
      const empty = doc.createElement("div");
      empty.className = "config-note";
      empty.textContent = "Нет валютных итогов для выбранного периода.";
      block.appendChild(empty);
      return block;
    }

    const openingTotals = sumPositionFieldByCurrency(byPosition, "opening_balance");
    const closingTotals = sumPositionFieldByCurrency(byPosition, "factual_closing_balance");
    const currencyTotals = indexRowsByCurrency(byCurrency);
    const rows = [
      ["Полная сумма остатков на конец дня 23:59 перед/на старт", (currency) => openingTotals.get(currency)],
      ["Полная сумма EOD balance на конец периода 23:59", (currency) => closingTotals.get(currency)],
      ["Плановая сумма приходов", (currency) => currencyTotals.get(currency)?.planned_inflow],
      ["Плановая сумма расходов", (currency) => currencyTotals.get(currency)?.planned_outflow],
      ["Плановый рост", (currency) => currencyTotals.get(currency)?.planned_delta],
      ["Фактический рост", (currency) => currencyTotals.get(currency)?.real_delta],
    ];
    const tableRows = [
      ["Показатель", ...currencies],
      ...rows.map(([label, getter]) => [label, ...currencies.map((currency) => formatNumber(getter(currency)))]),
    ];
    const wrap = doc.createElement("div");
    wrap.className = "table-wrap period-balance-table-wrap period-balance-total-wrap";
    wrap.appendChild(renderTable(doc, tableRows));
    block.appendChild(wrap);
    return block;
  }

  function getSummaryCurrencies(byCurrency, byPosition) {
    return Array.from(new Set([
      ...byCurrency.map((row) => String(row?.currency || "").trim().toUpperCase()).filter(Boolean),
      ...byPosition.map((row) => String(row?.currency || "").trim().toUpperCase()).filter(Boolean),
    ])).sort((left, right) => left.localeCompare(right));
  }

  function indexRowsByCurrency(rows) {
    const result = new Map();
    (rows || []).forEach((row) => {
      const currency = String(row?.currency || "").trim().toUpperCase();
      if (currency) result.set(currency, row);
    });
    return result;
  }

  function sumPositionFieldByCurrency(rows, field) {
    const result = new Map();
    (rows || []).forEach((row) => {
      const currency = String(row?.currency || "").trim().toUpperCase();
      if (!currency) return;
      const numeric = parseNumeric(row?.[field]);
      if (numeric === null) return;
      result.set(currency, (result.get(currency) || 0) + numeric);
    });
    return result;
  }

  function renderPositionTable(doc, rows, summary = {}, totalUsdRow = null) {
    if (shouldRenderNativePrimaryTable(rows)) {
      return renderNativePositionTable(doc, rows, totalUsdRow);
    }
    const tableRows = [
      ...sortDisplayRows(rows).map((row) => buildUsdTableRow(row)),
      ...(totalUsdRow ? [buildVisibleTotalUsdTableRow(totalUsdRow)] : []),
    ];
    const fxMissingText = formatFxMissingTotals(totalUsdRow);
    const block = renderSubsection(
      doc,
      "Остатки по каналам оплаты",
      ["Канал", "Остатки 1 USD", "Остатки 2 USD", "Изменение USD", "Движение средств USD", "Разница USD"],
      tableRows
    );
    if (fxMissingText) {
      const note = doc.createElement("div");
      note.className = "config-note";
      note.textContent = fxMissingText;
      block.appendChild(note);
    }
    return block;
  }

  function chooseVisibleTotalUsdRow(reconciliation = {}) {
    const primary = reconciliation.total_usd_row || null;
    const candidates = [
      reconciliation.canonical_total_usd_row,
      reconciliation.confirmed_total_usd_row,
      reconciliation.reconciliation_report_summary?.total_usd_row,
      reconciliation.summary?.total_usd_row,
      reconciliation.summary?.confirmed_total_usd_row,
    ].filter(Boolean);
    const primaryEnd = parseNumeric(primary?.confirmed_end_usd);
    if (primary && primaryEnd !== null && Math.abs(primaryEnd) > 0.0001) return primary;
    const confirmed = candidates.find((row) => {
      const end = parseNumeric(row?.confirmed_end_usd);
      return end !== null && Math.abs(end) > 0.0001;
    });
    if (!confirmed) return primary;
    return {
      ...confirmed,
      excluded_fx_missing_rows: confirmed.excluded_fx_missing_rows ?? primary?.excluded_fx_missing_rows,
      fx_missing_start_rows: confirmed.fx_missing_start_rows ?? primary?.fx_missing_start_rows,
      fx_missing_end_rows: confirmed.fx_missing_end_rows ?? primary?.fx_missing_end_rows,
      fx_missing_change_rows: confirmed.fx_missing_change_rows ?? primary?.fx_missing_change_rows,
      fx_missing_movement_rows: confirmed.fx_missing_movement_rows ?? primary?.fx_missing_movement_rows,
      fx_missing_diff_rows: confirmed.fx_missing_diff_rows ?? primary?.fx_missing_diff_rows,
    };
  }

  function shouldRenderNativePrimaryTable(rows) {
    const displayRows = sortDisplayRows(rows || []);
    if (!displayRows.length) return false;
    const nativeFallbackRows = displayRows.filter((row) => hasNativeBalanceValues(row) && !hasUsableUsdBalanceValues(row)).length;
    const usdRows = displayRows.filter(hasUsableUsdBalanceValues).length;
    return nativeFallbackRows > usdRows;
  }

  function hasNativeBalanceValues(row) {
    return getNativeOpening(row) !== null || getNativeConfirmedEnd(row) !== null || getNativeMovement(row) !== null;
  }

  function hasUsableUsdBalanceValues(row) {
    return parseNumeric(row?.opening_usd) !== null || parseNumeric(row?.confirmed_end_usd) !== null;
  }

  function renderNativePositionTable(doc, rows, totalUsdRow = null) {
    const block = renderSubsection(
      doc,
      "Остатки по каналам оплаты",
      ["Канал", "Валюта", "Остатки 1", "Остатки 2", "Изменение", "Движение средств", "Статус"],
      sortDisplayRows(rows).map((row) => buildNativeTableRow(row))
    );
    const fxMissingText = formatFxMissingTotals(totalUsdRow);
    if (fxMissingText) {
      const note = doc.createElement("div");
      note.className = "config-note";
      const confirmedEnd = parseNumeric(totalUsdRow?.confirmed_end_usd);
      note.textContent = confirmedEnd !== null && Math.abs(confirmedEnd) > 0.0001
        ? `USD table is incomplete; confirmed/canonical USD total is ${formatNumber(confirmedEnd)}. ${fxMissingText}`
        : fxMissingText;
      block.appendChild(note);
    }
    return block;
  }

  function buildNativeTableRow(row) {
    const opening = getNativeOpening(row);
    const confirmedEnd = getNativeConfirmedEnd(row);
    const change = getNativeChange(row, opening, confirmedEnd);
    const movement = getNativeMovement(row);
    return [
      row?.channel || "—",
      row?.currency || "—",
      formatNativeCell(opening),
      formatNativeCell(confirmedEnd),
      formatNativeCell(change),
      formatNativeCell(movement),
      getStatusLabel(row?.status),
    ];
  }

  function getNativeOpening(row) {
    return parseNumeric(row?.opening_native ?? row?.opening_fact_balance ?? row?.opening_balance);
  }

  function getNativeConfirmedEnd(row) {
    return parseNumeric(
      row?.confirmed_end_native ??
      row?.manual_provider_closing_balance ??
      row?.factual_closing_balance ??
      row?.displayed_fact_balance ??
      row?.carried_forward_balance
    );
  }

  function getNativeMovement(row) {
    return parseNumeric(row?.movement_native ?? row?.real_delta);
  }

  function getNativeChange(row, opening, confirmedEnd) {
    const explicit = parseNumeric(row?.change_native);
    if (explicit !== null) return explicit;
    return opening !== null && confirmedEnd !== null ? roundDisplayNumber(confirmedEnd - opening) : null;
  }

  function formatNativeCell(value) {
    return value === null ? "—" : formatNumber(value);
  }

  function buildUsdTableRow(row) {
    const start = parseNumeric(row?.opening_usd);
    const end = parseNumeric(row?.confirmed_end_usd);
    const movement = parseNumeric(row?.movement_usd);
    const change = getChangeUsd(row, start, end);
    const diff = getDiffUsd(row, change, movement);
    return [
      row?.channel || "—",
      formatUsdCell(row, "opening_usd", start),
      formatUsdCell(row, "confirmed_end_usd", end),
      formatDerivedUsdCell(row, ["opening_usd", "confirmed_end_usd"], change),
      formatUsdCell(row, "movement_usd", movement),
      formatDerivedUsdCell(row, ["opening_usd", "confirmed_end_usd", "movement_usd", "diff_usd"], diff),
    ];
  }

  function buildVisibleTotalUsdTableRow(row) {
    const start = parseNumeric(row?.opening_usd);
    const end = parseNumeric(row?.confirmed_end_usd);
    const movement = parseNumeric(row?.movement_usd);
    const change = getChangeUsd(row, start, end);
    const diff = getDiffUsd(row, change, movement);
    return [
      row?.label || "ВСЕГО USD",
      formatNumber(start),
      formatNumber(end),
      formatNumber(change),
      formatNumber(movement),
      formatNumber(diff),
    ];
  }

  function formatUsdCell(row, field, value) {
    if (value !== null) return formatNumber(value);
    return hasFxWarning(row, field) ? "fx_missing" : "—";
  }

  function formatDerivedUsdCell(row, fields, value) {
    if (value !== null) return formatNumber(value);
    return fields.some((field) => hasFxWarning(row, field)) ? "fx_missing" : "—";
  }

  function hasFxWarning(row, field) {
    return (row?.fx_warnings || []).some((warning) => String(warning || "").includes(field));
  }

  function getChangeUsd(row, start, end) {
    const explicit = parseNumeric(row?.change_usd);
    if (explicit !== null) return explicit;
    return start !== null && end !== null ? roundDisplayNumber(end - start) : null;
  }

  function getDiffUsd(row, change, movement) {
    const explicit = parseNumeric(row?.diff_usd);
    if (explicit !== null) return explicit;
    return change !== null && movement !== null ? roundDisplayNumber(change - movement) : null;
  }

  function formatFxMissingTotals(row) {
    if (!row) return "";
    const entries = [
      ["start", row?.fx_missing_start_rows],
      ["end", row?.fx_missing_end_rows],
      ["change", row?.fx_missing_change_rows],
      ["movement", row?.fx_missing_movement_rows],
      ["diff", row?.fx_missing_diff_rows],
    ]
      .map(([label, value]) => [label, Number(value || 0)])
      .filter(([, value]) => value > 0);
    const coverageText = formatTotalCoverage(row);
    if (entries.length) {
      return [`fx_missing: ${entries.map(([label, value]) => `${label}=${value}`).join(", ")}.`, coverageText]
        .filter(Boolean)
        .join(" ");
    }
    const rowCount = Number(row?.excluded_fx_missing_rows || 0);
    if (rowCount) {
      return [`fx_missing: ${rowCount} row(s) excluded from ВСЕГО USD where unavailable.`, coverageText]
        .filter(Boolean)
        .join(" ");
    }
    return coverageText;
  }

  function formatTotalCoverage(row) {
    if (String(row?.total_coverage_status || "").trim() !== "partial" && !row?.partial) return "";
    const excluded = Number(row?.rows_excluded_from_usd_total || 0);
    const counts = [
      ["start", row?.finite_start_rows],
      ["end", row?.finite_end_rows],
      ["change", row?.finite_change_rows],
      ["movement", row?.finite_movement_rows],
      ["diff", row?.finite_diff_rows],
    ]
      .map(([label, value]) => `${label}=${Number(value || 0)}`)
      .join(", ");
    const channels = (row?.excluded_channels || []).slice(0, 8).join("; ");
    const channelText = channels ? ` Excluded: ${channels}${(row?.excluded_channels || []).length > 8 ? "; ..." : ""}.` : "";
    return `ВСЕГО USD is partial; finite row coverage differs (${counts}); rows excluded from comparable USD total: ${excluded}.${channelText}`;
  }

  function roundDisplayNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * 10000) / 10000;
  }

  function renderDiagnosticPositionTable(doc, rows, summary = {}, totalUsdRow = null) {
    const tableRows = [
      ...sortDisplayRows(rows).map((row) => [
        row.channel || "—",
        row.currency || "—",
        formatCanonicalNative(row, "opening_native", row.opening_fact_balance ?? row.opening_balance),
        formatCanonicalNative(row, "movement_native", row.real_delta),
        formatCanonicalNative(row, "planned_end_native", row.calculated_closing_balance ?? row.computed_real_closing_balance),
        formatCanonicalNative(row, "confirmed_end_native", row.manual_provider_closing_balance ?? row.factual_closing_balance),
        formatCanonicalNative(row, "diff_native", row.real_difference),
        formatCanonicalUsd(row, "opening_usd"),
        formatCanonicalUsd(row, "movement_usd"),
        formatCanonicalUsd(row, "planned_end_usd"),
        formatCanonicalUsd(row, "confirmed_end_usd"),
        formatCanonicalUsd(row, "diff_usd"),
        formatFactDate(row),
        getFactSourceLabel(row),
        getFactSourceRowLabel(row),
        getStatusLabel(row.status),
        getFactDiagnosis(row),
      ]),
      ...buildChannelCurrencyTotalRows(rows, summary),
      ...(totalUsdRow ? [buildTotalUsdTableRow(totalUsdRow)] : []),
    ];
    return renderSubsection(
      doc,
      "Остатки по каналам оплаты (debug native)",
      ["КАНАЛ", "ВАЛЮТА", "OPENING NATIVE", "MOVEMENT NATIVE", "PLANNED END NATIVE", "CONFIRMED END NATIVE", "DIFF NATIVE", "OPENING USD", "MOVEMENT USD", "PLANNED END USD", "CONFIRMED END USD", "DIFF USD", "ФАКТ ДАТА", "ФАКТ ИСТОЧНИК", "SOURCE ROW", "СТАТУС", "ПРИЧИНА"],
      tableRows
    );
  }

  function formatCanonicalNative(row, field, fallback) {
    const value = row?.[field] ?? fallback;
    if (hasNumber(value)) return formatNumber(value);
    if (field === "opening_native" && String(row?.computedStatus || row?.computed_status || row?.status || "").trim() === "missing_opening_balance") {
      return "missing_opening_balance";
    }
    if (field === "confirmed_end_native" && (
      String(row?.factStatus || row?.fact_status || "").trim() === "missing"
      || String(row?.balanceSource || row?.balance_source || "").trim() === "missing"
      || String(row?.status || "").trim() === "missing_provider_balance"
    )) {
      return "missing fact";
    }
    return "—";
  }

  function formatCanonicalUsd(row, field) {
    if (hasNumber(row?.[field])) return formatNumber(row[field]);
    if ((row?.fx_warnings || []).some((warning) => String(warning || "").includes(field))) return "fx_missing";
    return "—";
  }

  function buildTotalUsdTableRow(row) {
    return [
      row.label || "ВСЕГО USD",
      row.currency || "USD",
      "—",
      "—",
      "—",
      "—",
      "—",
      formatNumber(row.opening_usd),
      formatNumber(row.movement_usd),
      formatNumber(row.planned_end_usd),
      formatNumber(row.confirmed_end_usd),
      formatNumber(row.diff_usd),
      "—",
      "—",
      "—",
      "Итого USD",
      `FX missing rows: ${Number(row.excluded_fx_missing_rows || 0)}`,
    ];
  }

  function formatOpeningBalance(row) {
    const value = row?.opening_fact_balance ?? row?.opening_balance;
    if (hasNumber(value)) return formatNumber(value);
    if (String(row?.computedStatus || row?.computed_status || row?.status || "").trim() === "missing_opening_balance") {
      return "missing_opening_balance";
    }
    return "—";
  }

  function formatComputedBalance(row) {
    const value = row?.calculated_closing_balance ?? row?.computed_real_closing_balance;
    if (hasNumber(value)) return formatNumber(value);
    if (String(row?.computedStatus || row?.computed_status || "").trim() === "missing_opening_balance") {
      return "missing_opening_balance";
    }
    return "—";
  }

  function formatFactBalance(row) {
    const factStatus = String(row?.factStatus || row?.fact_status || "").trim();
    const value = row?.manual_provider_closing_balance ?? (
      factStatus === "confirmed" || factStatus === "auto_pending" || factStatus === "calculated_from_previous"
        ? row?.factual_closing_balance
        : null
    );
    if (hasNumber(value)) return formatNumber(value);
    if (factStatus === "missing" || String(row?.balanceSource || row?.balance_source || "").trim() === "missing") {
      return "missing fact";
    }
    return "—";
  }

  function formatFactDate(row) {
    return row?.factDate || row?.fact_date || row?.manual_provider_closing_balance_date || row?.factual_closing_balance_date || "—";
  }

  function renderRequiredManualFactRows(doc, rows) {
    return renderSubsection(
      doc,
      "Что добавить в Остатки",
      ["Дата", "Канал", "Валюта", "Сумма", "Источник сейчас", "Статус", "Что сделать"],
      sortDisplayRows(rows).map((row) => [
        row.date || "—",
        row.channel || "—",
        row.currency || "—",
        formatNumber(row.amount),
        getFactSourceLabel(row),
        getStatusLabel(row.status),
        row.action || "Enter factual manual/provider balance in Остатки.",
      ])
    );
  }

  function renderNoDataRowsBlock(doc, rows) {
    const section = doc.createElement("div");
    section.className = "period-balance-subsection period-balance-no-data-subsection config-note";
    const title = doc.createElement("div");
    title.className = "tab-note";
    title.textContent = "Строки без данных";
    const count = doc.createElement("div");
    count.className = "config-note";
    count.textContent = `Скрыто строк без данных: ${rows.length}`;
    section.append(title, count);
    const wrap = doc.createElement("div");
    wrap.className = "table-wrap period-balance-table-wrap";
    wrap.appendChild(renderTable(doc, [
      ["КАНАЛ", "ВАЛЮТА", "СТАТУС", "ПРИЧИНА"],
      ...sortDisplayRows(rows).map((row) => [
        row.channel || "—",
        row.currency || "—",
        getStatusLabel(row.status),
        row.missing_fact_reason || row.diagnosis || "Нет данных для сверки",
      ]),
    ]));
    section.appendChild(wrap);
    return section;
  }

  function isMeaningfulReconciliationRow(row) {
    if (!row || typeof row !== "object") return false;
    const status = String(row.status || "").trim();
    const hasActivity = hasPositiveNumber(row.planned_rows)
      || hasPositiveNumber(row.movement_rows)
      || hasPositiveNumber(row.missing_amount_net_rows);
    const hasMajorValue = hasNumber(row.opening_fact_balance ?? row.opening_balance)
      || hasNumber(row.opening_native)
      || hasNumber(row.movement_native)
      || hasNumber(row.planned_end_native)
      || hasNumber(row.confirmed_end_native)
      || hasNumber(row.diff_native)
      || hasNumber(row.opening_usd)
      || hasNumber(row.movement_usd)
      || hasNumber(row.planned_end_usd)
      || hasNumber(row.confirmed_end_usd)
      || hasNumber(row.diff_usd)
      || hasNumber(row.planned_delta)
      || hasNumber(row.real_delta)
      || hasNumber(row.calculated_closing_balance ?? row.computed_real_closing_balance)
      || hasNumber(row.manual_provider_closing_balance)
      || hasNumber(row.carried_forward_balance)
      || hasNumber(row.displayed_fact_balance)
      || hasNumber(row.real_difference);
    if (status === "no_data" && !hasActivity && !hasNonZeroMajorValue(row)) return false;
    return hasMajorValue
      || ["mismatch", "missing_amount_net", "missing_provider_balance", "missing_opening_balance"].includes(status);
  }

  function hasNonZeroMajorValue(row) {
    return [
      row.opening_fact_balance ?? row.opening_balance,
      row.opening_native,
      row.movement_native,
      row.planned_end_native,
      row.confirmed_end_native,
      row.diff_native,
      row.opening_usd,
      row.movement_usd,
      row.planned_end_usd,
      row.confirmed_end_usd,
      row.diff_usd,
      row.planned_delta,
      row.real_delta,
      row.calculated_closing_balance ?? row.computed_real_closing_balance,
      row.manual_provider_closing_balance,
      row.carried_forward_balance,
      row.displayed_fact_balance,
      row.real_difference,
    ].some((value) => {
      const numeric = parseNumeric(value);
      return numeric !== null && Math.abs(numeric) > 0.0001;
    });
  }

  function hasNumber(value) {
    return parseNumeric(value) !== null;
  }

  function hasPositiveNumber(value) {
    const numeric = parseNumeric(value);
    return numeric !== null && Math.abs(numeric) > 0.0001;
  }

  function getCarriedForwardComparisonFact(row) {
    if (String(row?.fact_source || "").trim() !== "carried_forward") return null;
    return row.displayed_fact_balance ?? row.carried_forward_balance;
  }

  function shouldShowPlannedValues(row, summary = {}) {
    if (hasPositiveNumber(row?.planned_rows)) return true;
    if (hasPositiveNumber(summary?.planned_rows)) return true;
    return String(summary?.planned_source_status || "").trim() === "ok";
  }

  function formatPlannedNumber(value, row, summary = {}) {
    return shouldShowPlannedValues(row, summary) ? formatNumber(value) : "—";
  }

  function formatPlanVsRealDelta(row, summary = {}) {
    return shouldShowPlannedValues(row, summary) ? formatNumber(row?.plan_vs_real_delta) : "—";
  }

  function getFactSourceRowLabel(row) {
    const sourceRow = row?.sourceRow ?? row?.source_row;
    const sourceSheet = String(row?.sourceSheet || row?.source_sheet || "").trim();
    if (!sourceRow) return "—";
    return `${sourceSheet || "source"} #${sourceRow}`;
  }

  function getFactDiagnosis(row) {
    if (!row) return "—";
    if ((row.fx_diagnostics || []).length) return row.fx_diagnostics.join(" | ");
    if (!row.manual_provider_closing_balance_date && row.nearest_manual_provider_fact_date) {
      return `Нет факта на конец периода. Есть ближайший факт: ${row.nearest_manual_provider_fact_date} ${formatNumber(row.nearest_manual_provider_fact_amount)}.`;
    }
    if (!row.manual_provider_closing_balance_date && row.last_observed_closing_balance_date) {
      return `Факт есть на начало/ближайшую дату, нет факта на конец периода. Ближайшая дата: ${row.last_observed_closing_balance_date} ${formatNumber(row.last_observed_closing_balance)}.`;
    }
    return row.missing_fact_reason || row.diagnosis || "—";
  }

  function buildChannelCurrencyTotalRows(rows, summary = {}) {
    const totalsByCurrency = new Map();
    (rows || []).forEach((row) => {
      const currency = String(row?.currency || "").trim().toUpperCase();
      if (!currency) return;
      if (!totalsByCurrency.has(currency)) {
        totalsByCurrency.set(currency, {
          opening_native: createTotalBucket(),
          movement_native: createTotalBucket(),
          planned_end_native: createTotalBucket(),
          confirmed_end_native: createTotalBucket(),
          diff_native: createTotalBucket(),
          opening_usd: createTotalBucket(),
          movement_usd: createTotalBucket(),
          planned_end_usd: createTotalBucket(),
          confirmed_end_usd: createTotalBucket(),
          diff_usd: createTotalBucket(),
        });
      }
      const totals = totalsByCurrency.get(currency);
      addNumeric(totals, "opening_native", row.opening_native ?? row.opening_fact_balance ?? row.opening_balance);
      addNumeric(totals, "movement_native", row.movement_native ?? row.real_delta);
      addNumeric(totals, "planned_end_native", row.planned_end_native ?? row.calculated_closing_balance ?? row.computed_real_closing_balance);
      addNumeric(totals, "confirmed_end_native", row.confirmed_end_native ?? row.manual_provider_closing_balance ?? row.factual_closing_balance);
      addNumeric(totals, "diff_native", row.diff_native ?? row.real_difference);
      addNumeric(totals, "opening_usd", row.opening_usd);
      addNumeric(totals, "movement_usd", row.movement_usd);
      addNumeric(totals, "planned_end_usd", row.planned_end_usd);
      addNumeric(totals, "confirmed_end_usd", row.confirmed_end_usd);
      addNumeric(totals, "diff_usd", row.diff_usd);
    });
    return Array.from(totalsByCurrency.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => [
        `ИТОГО ${currency}`,
        currency,
        formatTotalBucket(totals.opening_native),
        formatTotalBucket(totals.movement_native),
        formatTotalBucket(totals.planned_end_native),
        formatTotalBucket(totals.confirmed_end_native),
        formatTotalBucket(totals.diff_native),
        formatTotalBucket(totals.opening_usd),
        formatTotalBucket(totals.movement_usd),
        formatTotalBucket(totals.planned_end_usd),
        formatTotalBucket(totals.confirmed_end_usd),
        formatTotalBucket(totals.diff_usd),
        "—",
        "—",
        "—",
        "Итого по валюте",
        "—",
      ]);
  }

  function createTotalBucket() {
    return { value: 0, count: 0 };
  }

  function addNumeric(target, field, value) {
    const numeric = parseNumeric(value);
    if (numeric === null) return;
    target[field].value += numeric;
    target[field].count += 1;
  }

  function formatTotalBucket(bucket) {
    if (!bucket?.count) return "—";
    return formatNumber(bucket.value);
  }

  function renderSubsection(doc, titleText, header, rows) {
    const section = doc.createElement("div");
    section.className = "period-balance-subsection";
    const title = doc.createElement("div");
    title.className = "tab-note";
    title.textContent = titleText;
    section.appendChild(title);
    const wrap = doc.createElement("div");
    wrap.className = "table-wrap period-balance-table-wrap";
    wrap.appendChild(renderTable(doc, [header, ...rows]));
    section.appendChild(wrap);
    return section;
  }

  function renderTable(doc, values) {
    const table = doc.createElement("table");
    const tbody = doc.createElement("tbody");
    values.forEach((row, index) => {
      const tr = doc.createElement("tr");
      row.forEach((cell) => {
        const node = doc.createElement(index === 0 ? "th" : "td");
        node.textContent = String(cell ?? "");
        tr.appendChild(node);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function getStatusLabel(status) {
    const normalized = String(status || "").trim();
    if (normalized === "ok") return "OK";
    if (normalized === "failed") return "НЕ ОК";
    if (normalized === "mismatch") return "Реальное расхождение";
    if (normalized === "missing_provider_balance") return "Нет фактического остатка на дату";
    if (normalized === "missing_opening_balance") return "Нет стартового остатка";
    if (normalized === "missing_closing_balance") return "Нет конечного остатка";
    if (normalized === "carried_forward_conditional") return "Условно перенесено";
    if (normalized === "missing_amount_net") return "Нет amount_net";
    if (normalized === "calculated_from_previous") return "calculated from previous";
    if (normalized === "no_data") return "Нет данных";
    return "Проверить";
  }

  function getFactSourceLabel(rowOrSource) {
    const row = rowOrSource && typeof rowOrSource === "object" ? rowOrSource : null;
    const normalizedBalanceSource = String(row?.balanceSource || row?.balance_source || "").trim();
    if (normalizedBalanceSource === "manual_fact") return "manual fact";
    if (normalizedBalanceSource === "provider_auto") return "auto, needs manual confirmation";
    if (normalizedBalanceSource === "calculated_balance") return "calculated from previous";
    if (normalizedBalanceSource === "missing") return "add manual fact balance";
    const normalized = String(row ? row.fact_source : rowOrSource || "").trim();
    if (normalized === "manual") return "manual fact";
    if (normalized === "provider") return "auto, needs manual confirmation";
    if (normalized === "calculated") return "calculated from previous";
    if (normalized === "carried_forward") return "перенесён";
    if (normalized === "missing") return "add manual fact balance";
    return normalized || "—";
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return String(Math.round(numeric * 10000) / 10000);
  }

  function parseNumeric(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function compareDisplayRows(left, right) {
    if (typeof channelDisplayOrder.compareChannelDisplayRows === "function") {
      return channelDisplayOrder.compareChannelDisplayRows(left, right);
    }
    if (left.currency !== right.currency) return String(left.currency || "").localeCompare(String(right.currency || ""));
    return String(left.channel || "").localeCompare(String(right.channel || ""));
  }

  function sortDisplayRows(rows) {
    return [...(rows || [])].sort(compareDisplayRows);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return {
    BLOCK_TITLE,
    installPeriodBalanceReconciliationUi,
    fetchPeriodBalanceReconciliation,
    renderPeriodBalanceBlock,
    getStatusLabel,
    formatNumber,
    isCompetingLegacyBalanceSection,
  };
});
