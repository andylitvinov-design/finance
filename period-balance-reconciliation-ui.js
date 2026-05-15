(function initPeriodBalanceReconciliationUi(root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.EzohataPeriodBalanceReconciliationUi = api;
    if (typeof root.document !== "undefined") api.installPeriodBalanceReconciliationUi(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPeriodBalanceReconciliationUi(root) {
  const BLOCK_TITLE = "Сверка баланса за период";

  function installPeriodBalanceReconciliationUi(globalRoot = root) {
    const original = globalRoot.renderExpenseFinancialAnalysis;
    if (typeof original !== "function" || original.__periodBalanceReconciliationWrapped) return false;

    function wrappedRenderExpenseFinancialAnalysis() {
      const block = original.apply(this, arguments);
      try {
        const placeholder = renderPlaceholder(globalRoot.document);
        block.appendChild(placeholder);
        loadAndRender(globalRoot, placeholder);
      } catch (error) {
        // Additive UI extension must never break the existing finance analysis screen.
      }
      return block;
    }
    wrappedRenderExpenseFinancialAnalysis.__periodBalanceReconciliationWrapped = true;
    globalRoot.renderExpenseFinancialAnalysis = wrappedRenderExpenseFinancialAnalysis;
    return true;
  }

  async function loadAndRender(globalRoot, container) {
    const doc = globalRoot.document;
    if (!doc || !container) return;
    try {
      const snapshot = await fetchPeriodBalanceReconciliation(globalRoot);
      container.replaceWith(renderPeriodBalanceBlock(doc, snapshot));
    } catch (error) {
      container.replaceWith(renderError(doc, error));
    }
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

  function renderPeriodBalanceBlock(doc, snapshot) {
    const section = createSection(doc);
    const reconciliation = snapshot?.period_balance_reconciliation;
    if (!reconciliation) {
      const empty = doc.createElement("div");
      empty.className = "finance-status error";
      empty.textContent = "API не вернул period_balance_reconciliation.";
      section.appendChild(empty);
      return section;
    }

    section.appendChild(renderSummary(doc, reconciliation.summary || {}, reconciliation.period || {}));
    section.appendChild(renderCurrencyTable(doc, reconciliation.by_currency || []));
    section.appendChild(renderPositionTable(doc, reconciliation.by_channel_currency || []));

    const actions = reconciliation.actionable_rows || [];
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

  function createSection(doc) {
    const section = doc.createElement("section");
    section.className = "finance-analysis-section period-balance-reconciliation-section";
    const header = doc.createElement("div");
    header.className = "tab-header";
    header.innerHTML = `<div><h3>${escapeHtml(BLOCK_TITLE)}</h3><div class="tab-note">Период: начальный остаток → плановое изменение → реальное изменение → фактический остаток → расхождение.</div></div>`;
    section.appendChild(header);
    return section;
  }

  function renderSummary(doc, summary, period) {
    const block = doc.createElement("div");
    const status = doc.createElement("div");
    status.className = summary.status === "failed" ? "finance-status error" : "finance-status";
    const label = summary.status === "ok" ? "OK" : summary.status === "failed" ? "НЕ ОК" : "Проверить";
    status.textContent = `${label} (${period.from || "?"} - ${period.to || "?"}): позиций ${Number(summary.positions_checked || 0)}, валют ${Number(summary.currencies_checked || 0)}, planned source: ${summary.planned_source_status || "needs_verification"}.`;
    block.appendChild(status);

    const cards = doc.createElement("div");
    cards.className = "metrics period-balance-summary";
    [
      ["Позиции", summary.positions_checked],
      ["Валюты", summary.currencies_checked],
      ["Каналы", summary.channels_checked],
      ["План строк", summary.planned_rows],
      ["Без amount_net", summary.missing_amount_net_rows],
      ["Условно перенесено", summary.status_counts?.carried_forward_conditional],
    ].forEach(([text, value]) => {
      const card = doc.createElement("div");
      card.className = "metric";
      const labelNode = doc.createElement("div");
      labelNode.className = "metric-label";
      labelNode.textContent = text;
      const valueNode = doc.createElement("div");
      valueNode.className = "metric-value";
      valueNode.textContent = String(Number(value || 0));
      card.append(labelNode, valueNode);
      cards.appendChild(card);
    });
    block.appendChild(cards);
    return block;
  }

  function renderCurrencyTable(doc, rows) {
    return renderSubsection(
      doc,
      "Изменение баланса по валютам",
      ["Валюта", "План приход", "План расход", "План изменение", "Реал приход", "Реал расход", "Реал изменение", "План-реал", "Реал разница", "Статус"],
      rows.map((row) => [
        row.currency || "—",
        formatNumber(row.planned_inflow),
        formatNumber(row.planned_outflow),
        formatNumber(row.planned_delta),
        formatNumber(row.real_inflow),
        formatNumber(row.real_outflow),
        formatNumber(row.real_delta),
        formatNumber(row.plan_vs_real_delta),
        formatNumber(row.real_difference),
        getStatusLabel(row.status),
      ])
    );
  }

  function renderPositionTable(doc, rows) {
    return renderSubsection(
      doc,
      "По счетам и валютам",
      ["Счёт", "Валюта", "Было", "План Δ", "План должно", "Реал Δ", "Реал должно", "Факт", "Разница", "Источник факта", "Статус"],
      rows.map((row) => [
        row.channel || "—",
        row.currency || "—",
        formatNumber(row.opening_balance),
        formatNumber(row.planned_delta),
        formatNumber(row.planned_closing_balance),
        formatNumber(row.real_delta),
        formatNumber(row.computed_real_closing_balance),
        formatNumber(row.factual_closing_balance),
        formatNumber(row.real_difference),
        row.closing_balance_source || "—",
        getStatusLabel(row.status),
      ])
    );
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
    if (normalized === "mismatch") return "Расхождение";
    if (normalized === "missing_opening_balance") return "Нет начального";
    if (normalized === "missing_closing_balance") return "Нет конечного";
    if (normalized === "carried_forward_conditional") return "Условно перенесено";
    if (normalized === "missing_amount_net") return "Нет amount_net";
    return "Проверить";
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return String(Math.round(numeric * 10000) / 10000);
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
  };
});
