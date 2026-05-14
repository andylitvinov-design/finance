(function initBalanceCoverageUi(root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.EzohataBalanceCoverageUi = api;
    if (typeof root.document !== "undefined") api.installBalanceCoverageUi(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createBalanceCoverageUi(root) {
  const BLOCK_TITLE = "Сверка остатков по счетам";

  function installBalanceCoverageUi(globalRoot = root) {
    const original = globalRoot.renderExpenseFinancialAnalysis;
    if (typeof original !== "function" || original.__balanceCoverageWrapped) return false;

    function wrappedRenderExpenseFinancialAnalysis() {
      const block = original.apply(this, arguments);
      try {
        const coverageBlock = renderBalanceCoveragePlaceholder(globalRoot.document);
        block.appendChild(coverageBlock);
        loadAndRenderBalanceCoverage(globalRoot, coverageBlock);
      } catch (error) {
        // UI extension must never break the existing finance analysis screen.
      }
      return block;
    }
    wrappedRenderExpenseFinancialAnalysis.__balanceCoverageWrapped = true;
    globalRoot.renderExpenseFinancialAnalysis = wrappedRenderExpenseFinancialAnalysis;
    return true;
  }

  async function loadAndRenderBalanceCoverage(globalRoot, container) {
    const doc = globalRoot.document;
    if (!doc || !container) return;
    try {
      const snapshot = await fetchAuditSnapshotForSelectedPeriod(globalRoot);
      container.replaceWith(renderBalanceCoverageBlock(doc, snapshot));
    } catch (error) {
      container.replaceWith(renderBalanceCoverageError(doc, error));
    }
  }

  async function fetchAuditSnapshotForSelectedPeriod(globalRoot = root) {
    const doc = globalRoot.document;
    const startDate = String(doc?.getElementById("startDate")?.value || "").trim();
    const endDate = String(doc?.getElementById("endDate")?.value || "").trim();
    const params = new URLSearchParams();
    if (startDate) params.set("from", startDate);
    if (endDate) params.set("to", endDate);
    const url = `/api/audit-snapshot${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await globalRoot.fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Audit snapshot failed with HTTP ${response.status}`);
    }
    return payload;
  }

  function renderBalanceCoveragePlaceholder(doc) {
    const section = createCoverageSection(doc);
    const body = doc.createElement("div");
    body.className = "config-note";
    body.textContent = "Загружаю сверку остатков по счетам...";
    section.appendChild(body);
    return section;
  }

  function renderBalanceCoverageError(doc, error) {
    const section = createCoverageSection(doc);
    const status = doc.createElement("div");
    status.className = "finance-status error";
    status.textContent = `Сверка остатков пока недоступна: ${String(error?.message || error || "audit snapshot не загрузился")}`;
    section.appendChild(status);
    return section;
  }

  function renderBalanceCoverageBlock(doc, snapshot) {
    const section = createCoverageSection(doc);
    const coverage = snapshot?.balance_coverage;
    if (!coverage) {
      const empty = doc.createElement("div");
      empty.className = "finance-status error";
      empty.textContent = "Сверка остатков пока недоступна: audit snapshot не вернул balance_coverage.";
      section.appendChild(empty);
      return section;
    }

    section.appendChild(renderWeeklyBalanceSummary(doc, coverage.weekly_summary));
    section.appendChild(renderCoverageSummary(doc, coverage.summary || {}));
    section.appendChild(renderBalanceFixesBlock(doc, snapshot?.balance_fixes || {}));

    const rows = buildBalanceCoverageTableValues(snapshot);
    if (rows.length <= 1) {
      const empty = doc.createElement("div");
      empty.className = "empty";
      empty.textContent = "За выбранный период нет движения по счетам для сверки остатков.";
      section.appendChild(empty);
      return section;
    }

    const okOnly = rows.slice(1).every((row) => row[9] === getStatusLabel("ok"));
    if (okOnly) {
      const ok = doc.createElement("div");
      ok.className = "finance-status";
      ok.textContent = "Все остатки по счетам за период сверены.";
      section.appendChild(ok);
    }

    const wrap = doc.createElement("div");
    wrap.className = "table-wrap balance-coverage-table-wrap";
    wrap.appendChild(renderPlainCoverageTable(doc, rows));
    section.appendChild(wrap);
    return section;
  }

  function renderWeeklyBalanceSummary(doc, weekly) {
    const block = doc.createElement("div");
    block.className = "balance-weekly-summary";

    const title = doc.createElement("h4");
    title.textContent = "Сверка остатков за неделю";
    block.appendChild(title);

    const status = doc.createElement("div");
    status.className = weekly?.status === "failed" ? "finance-status error" : "finance-status";
    const statusLabel = weekly?.status === "ok" ? "OK" : weekly?.status === "failed" ? "НЕ ОК" : "Проверить";
    const period = weekly?.period || {};
    const periodText = period.from || period.to ? ` (${period.from || "?"} - ${period.to || "?"})` : "";
    status.textContent = weekly?.status === "ok"
      ? `OK${periodText}: Все счета за неделю сверены.`
      : `${statusLabel}${periodText}: есть расхождения или недостающие данные для сверки остатков.`;
    block.appendChild(status);

    const counters = doc.createElement("div");
    counters.className = "metrics balance-weekly-counters";
    [
      ["Проверено", weekly?.accounts_checked],
      ["Сверено", weekly?.fully_reconciled],
      ["Расхождения", weekly?.mismatch],
      ["Нет начального", weekly?.missing_opening_balance],
      ["Нет фактического", weekly?.missing_provider_balance],
      ["Без amount_net", weekly?.missing_amount_net_rows ?? weekly?.excluded_missing_amount_net_rows],
    ].forEach(([label, value]) => {
      const card = doc.createElement("div");
      card.className = "metric";
      const labelNode = doc.createElement("div");
      labelNode.className = "metric-label";
      labelNode.textContent = label;
      const valueNode = doc.createElement("div");
      valueNode.className = "metric-value";
      valueNode.textContent = String(Number(value || 0));
      card.append(labelNode, valueNode);
      counters.appendChild(card);
    });
    block.appendChild(counters);

    const actions = weekly?.actionable_accounts || [];
    if (actions.length) {
      block.appendChild(renderFixSubsection(
        doc,
        "Где исправить",
        ["Дата", "Счёт", "Валюта", "Разница", "Статус", "Что сделать"],
        actions.map((row) => [
          row.date || "—",
          row.channel || "—",
          row.currency || "—",
          formatCoverageNumber(row.difference),
          getStatusLabel(row.status),
          getStatusAction(row.status),
        ])
      ));
    }

    return block;
  }

  function renderBalanceFixesBlock(doc, fixes) {
    const block = doc.createElement("div");
    block.className = "balance-fixes-block";

    const title = doc.createElement("h4");
    title.textContent = "Что нужно исправить";
    block.appendChild(title);

    const amountNetRows = fixes?.missing_amount_net_rows || [];
    const ostatkiRows = fixes?.missing_ostatki_rows || [];
    if (!amountNetRows.length && !ostatkiRows.length) {
      const empty = doc.createElement("div");
      empty.className = "finance-status";
      empty.textContent = "Нет обязательных исправлений для сверки остатков.";
      block.appendChild(empty);
      return block;
    }

    if (amountNetRows.length) {
      block.appendChild(renderFixSubsection(
        doc,
        "Ledger amount_net fixes",
        [
          "Дата",
          "Счёт",
          "Валюта",
          "Сумма",
          "raw_source_id",
          "amount_net",
          "Что сделать",
        ],
        amountNetRows.map((row) => [
          row.date || "—",
          row.channel || "—",
          row.currency || "—",
          formatCoverageNumber(row.amount),
          row.raw_source_id || "—",
          formatCoverageNumber(row.recommended_amount_net),
          row.action || "—",
        ])
      ));
    }

    if (ostatkiRows.length) {
      const copyButton = doc.createElement("button");
      copyButton.type = "button";
      copyButton.className = "secondary";
      copyButton.textContent = "Скопировать строки для Остатки";
      copyButton.disabled = !String(fixes?.copyable_ostatki_rows || "").trim();
      copyButton.addEventListener("click", async () => {
        const text = String(fixes?.copyable_ostatki_rows || "");
        if (!text || !root?.navigator?.clipboard?.writeText) return;
        await root.navigator.clipboard.writeText(text);
      });
      block.appendChild(copyButton);
      block.appendChild(renderFixSubsection(
        doc,
        "Missing Остатки rows",
        ["Дата", "Счёт", "Валюта", "Сумма для Остатки"],
        ostatkiRows.map((row) => [
          row.date || "—",
          row.channel || "—",
          row.currency || "—",
          formatCoverageNumber(row.computed_closing_balance),
        ])
      ));
    }

    return block;
  }

  function renderFixSubsection(doc, titleText, header, rows) {
    const section = doc.createElement("div");
    section.className = "balance-fixes-subsection";
    const title = doc.createElement("div");
    title.className = "tab-note";
    title.textContent = titleText;
    section.appendChild(title);
    const wrap = doc.createElement("div");
    wrap.className = "table-wrap balance-fixes-table-wrap";
    wrap.appendChild(renderPlainCoverageTable(doc, [header, ...rows]));
    section.appendChild(wrap);
    return section;
  }

  function createCoverageSection(doc) {
    const section = doc.createElement("section");
    section.className = "finance-analysis-section balance-coverage-section";
    const header = doc.createElement("div");
    header.className = "tab-header";
    header.innerHTML = `<div><h3>${escapeHtml(BLOCK_TITLE)}</h3><div class="tab-note">Проверка: остаток был → движение по Ledger → остаток должен быть → фактический остаток → разница.</div></div>`;
    section.appendChild(header);
    return section;
  }

  function renderCoverageSummary(doc, summary) {
    const cards = doc.createElement("div");
    cards.className = "metrics balance-coverage-summary";
    const items = [
      ["С движением", summary.accounts_with_movement],
      ["Сверено", summary.fully_reconciled_accounts],
      ["Расхождения", summary.mismatch],
      ["Нет начального", summary.missing_opening_balance],
      ["Нет фактического", summary.missing_provider_balance],
      ["Без amount_net", summary.excluded_missing_amount_net_rows],
    ];
    items.forEach(([label, value]) => {
      const card = doc.createElement("div");
      card.className = "metric";
      const labelNode = doc.createElement("div");
      labelNode.className = "metric-label";
      labelNode.textContent = label;
      const valueNode = doc.createElement("div");
      valueNode.className = "metric-value";
      valueNode.textContent = String(Number(value || 0));
      card.append(labelNode, valueNode);
      cards.appendChild(card);
    });
    return cards;
  }

  function buildBalanceCoverageTableValues(snapshot) {
    const coverage = snapshot?.balance_coverage || {};
    const actionableKeys = new Set((coverage.actionable_accounts || []).map(accountKey));
    const accounts = [
      ...(coverage.actionable_accounts || []),
      ...(coverage.accounts || []).filter((row) => !actionableKeys.has(accountKey(row))),
    ];
    const header = [
      "Дата",
      "Счёт",
      "Валюта",
      "Было",
      "Пришло",
      "Ушло",
      "Должно быть",
      "Факт остаток",
      "Разница",
      "Статус",
      "Что сделать",
    ];
    return [
      header,
      ...accounts.map((row) => [
        row.date || "—",
        row.channel || "—",
        row.currency || "—",
        formatCoverageNumber(row.opening_balance),
        formatCoverageNumber(row.inflow),
        formatCoverageNumber(row.outflow),
        formatCoverageNumber(row.computed_closing_balance),
        formatCoverageNumber(row.provider_reported_balance),
        formatCoverageNumber(row.difference),
        getStatusLabel(row.status),
        getStatusAction(row.status),
      ]),
    ];
  }

  function renderPlainCoverageTable(doc, values) {
    const table = doc.createElement("table");
    const tbody = doc.createElement("tbody");
    values.forEach((row, rowIndex) => {
      const tr = doc.createElement("tr");
      if (rowIndex > 0) tr.dataset.status = String(values[rowIndex]?.[9] || "");
      row.forEach((cell) => {
        const node = doc.createElement(rowIndex === 0 ? "th" : "td");
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
    if (normalized === "mismatch") return "Расхождение";
    if (normalized === "missing_opening_balance") return "Нет начального остатка";
    if (normalized === "missing_provider_balance") return "Нет фактического остатка";
    return "Проверить";
  }

  function getStatusAction(status) {
    const normalized = String(status || "").trim();
    if (normalized === "ok") return "Сверено";
    if (normalized === "mismatch") return "Проверить выписку / Ledger / amount_net / Остатки";
    if (normalized === "missing_opening_balance") return "Добавить остаток на начало периода";
    if (normalized === "missing_provider_balance") return "Добавить фактический остаток в Остатки";
    return "Проверить выписку / Ledger / amount_net / Остатки";
  }

  function accountKey(row) {
    return `${row?.date || ""}|${row?.channel || ""}|${row?.currency || ""}`;
  }

  function formatCoverageNumber(value) {
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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return {
    BLOCK_TITLE,
    installBalanceCoverageUi,
    fetchAuditSnapshotForSelectedPeriod,
    renderBalanceCoverageBlock,
    buildBalanceCoverageTableValues,
    getStatusLabel,
    getStatusAction,
    formatCoverageNumber,
  };
});
