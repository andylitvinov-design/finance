(function () {
  function selectedUrl() {
    var start = document.getElementById("startDate")?.value || "";
    var end = document.getElementById("endDate")?.value || "";
    var q = new URLSearchParams();
    if (start) q.set("from", start);
    if (end) q.set("to", end);
    return "/api/balance-snapshots" + (String(q) ? "?" + String(q) : "");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function latestDate(data) {
    var dates = Array.isArray(data?.dates) ? data.dates.slice().sort() : [];
    return dates.length ? dates[dates.length - 1] : "—";
  }

  function recommendation(data) {
    var valid = Number(data?.valid_rows || 0);
    var dates = Array.isArray(data?.dates) ? data.dates : [];
    var incomplete = Number(data?.incomplete_rows || 0);
    if (!valid) return "Добавить Остатки на начало и конец месяца по каждому активному каналу.";
    if (incomplete) return "Исправить неполные строки Остатки: дата, канал, валюта и сумма обязательны.";
    if (dates.length < 2) return "Добавить второй snapshot остатков, чтобы сверять движение между датами.";
    return "Покрытие остатков найдено. Следующий шаг — добавить недостающие активные каналы.";
  }

  function renderInventory(payload) {
    var data = payload?.balance_snapshots || {};
    var section = el("section", "finance-analysis-section balance-snapshots-section");
    var header = el("div", "tab-header");
    var titleWrap = el("div");
    titleWrap.appendChild(el("h3", "", "Инвентарь остатков"));
    titleWrap.appendChild(el("div", "tab-note", "Остатки для сверки нужно вносить во вкладку Остатки, не во Факт."));
    header.appendChild(titleWrap);
    section.appendChild(header);

    var cards = el("div", "metrics balance-snapshots-summary");
    [["Дат", data.dates?.length || 0], ["Целевая", inputTargetDate(data)], ["К вводу", countNeedsInput(data.input_rows)], ["Канал/валюта", data.by_channel_currency?.length || 0], ["Native valid", data.native_valid_rows ?? data.valid_rows ?? 0], ["USD-only", data.usd_only_rows || 0]].forEach(function (item) {
      var card = el("div", "metric");
      card.appendChild(el("div", "metric-label", item[0]));
      card.appendChild(el("div", "metric-value", item[1]));
      cards.appendChild(card);
    });
    section.appendChild(cards);
    section.appendChild(el("div", "finance-status", recommendation(data)));

    var inputRows = Array.isArray(data.input_rows) ? data.input_rows : [];
    if (inputRows.length) {
      section.appendChild(renderInputRowsTable(inputRows));
    } else {
      section.appendChild(el("div", "empty", "Нет активных каналов для ввода остатков."));
    }

    var ownerRows = Array.isArray(data.owner_rows) ? data.owner_rows : [];
    var selectedRows = Array.isArray(data.selected_rows) ? data.selected_rows : [];
    var autoRows = Array.isArray(data.auto_balance_rows) ? data.auto_balance_rows : [];
    var confirmedRows = Array.isArray(data.confirmed_rows) ? data.confirmed_rows : [];
    var rows = Array.isArray(data.rows) ? data.rows : [];
    if (ownerRows.length) {
      section.appendChild(el("h4", "", "Owner-confirmed остатки"));
      section.appendChild(renderRowsTable(ownerRows));
      section.appendChild(el("div", "tab-note", "Owner TOTAL: " + formatAmount(data.owner_total)));
    } else if (selectedRows.length) section.appendChild(renderSelectedRowsTable(selectedRows));
    else if (rows.length) section.appendChild(renderRowsTable(rows));
    if (confirmedRows.length) section.appendChild(renderConfirmedRowsBlock(confirmedRows));
    var diagnostics = renderRawRowsDiagnostics(autoRows);
    if (diagnostics) section.appendChild(diagnostics);
    if (Array.isArray(data.diagnostic_rows) && data.diagnostic_rows.length) {
      var ownerDiagnostics = el("details", "balance-snapshots-diagnostics");
      ownerDiagnostics.appendChild(el("summary", "", "Technical diagnostics (excluded from owner TOTAL)"));
      ownerDiagnostics.appendChild(renderRowsTable(data.diagnostic_rows));
      section.appendChild(ownerDiagnostics);
    }
    if (!rows.length && !inputRows.length) return section;

    var pairs = Array.isArray(data.by_channel_currency) ? data.by_channel_currency : [];
    if (pairs.length) section.appendChild(renderCoverageTable(pairs));
    return section;
  }

  function inputTargetDate(data) {
    var rows = Array.isArray(data?.input_rows) ? data.input_rows : [];
    return rows[0]?.date || latestDate(data);
  }

  function countNeedsInput(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) { return row.needs_input; }).length;
  }

  function renderInputRowsTable(rows) {
    var wrap = el("div", "table-wrap balance-snapshots-table-wrap");
    var table = el("table");
    var tbody = el("tbody");
    var head = el("tr");
    ["Date", "Sheet", "Channel", "Currency", "Balance", "Status"].forEach(function (cell) { head.appendChild(el("th", "", cell)); });
    tbody.appendChild(head);
    rows.forEach(function (row) {
      var tr = el("tr");
      [
        row.date || "—",
        row.sheet || "Остатки",
        row.channel || "—",
        row.currency || "—",
        formatAmount(row.existing_amount ?? row.amount),
        row.needs_input ? "needs input" : "already entered",
      ].forEach(function (cell) { tr.appendChild(el("td", "", cell)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderRowsTable(rows) {
    var wrap = el("div", "table-wrap balance-snapshots-table-wrap");
    var table = el("table");
    var tbody = el("tbody");
    var head = el("tr");
    ["Дата", "Канал", "Валюта", "Native fact", "USD equivalent", "Value type", "Status"].forEach(function (cell) { head.appendChild(el("th", "", cell)); });
    tbody.appendChild(head);
    rows.forEach(function (row) {
      var tr = el("tr");
      [
        row.date || "—",
        row.channel || "—",
        row.currency || "—",
        formatAmount(row.amount_native ?? row.amount),
        formatAmount(row.amount_usd),
        formatValueType(row.value_type),
        row.needs_native_currency_value ? "needs native amount" : (row.valid_native_balance === false ? "needs verification" : "ok"),
      ].forEach(function (cell) { tr.appendChild(el("td", "", cell)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderSelectedRowsTable(rows) {
    var wrap = el("div", "table-wrap balance-snapshots-table-wrap");
    var table = el("table");
    var tbody = el("tbody");
    var head = el("tr");
    ["Дата", "Канал", "Валюта", "Выбранный остаток", "Выбран из", "Статус"].forEach(function (cell) { head.appendChild(el("th", "", cell)); });
    tbody.appendChild(head);
    rows.forEach(function (row) {
      var tr = el("tr");
      [
        row.date || "—",
        row.channel || "—",
        row.currency || "—",
        formatAmount(row.amount),
        row.selected_from || "—",
        row.status || "—",
      ].forEach(function (cell) { tr.appendChild(el("td", "", cell)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderConfirmedRowsBlock(rows) {
    var section = el("div", "balance-snapshots-confirmed-block");
    section.appendChild(el("div", "tab-note", "Все строки Остатки / подтверждённые остатки"));
    section.appendChild(renderTypedRowsTable(rows, {
      headers: ["Дата", "Канал", "Валюта", "Подтвержденный остаток", "Источник", "Статус"],
      amountHeader: "Подтвержденный остаток",
    }));
    return section;
  }

  function renderRawRowsDiagnostics(autoRows) {
    if (!autoRows.length) return null;
    var details = el("details", "balance-snapshots-diagnostics");
    details.appendChild(el("summary", "", "Диагностика источников остатков"));
    details.appendChild(el("div", "tab-note", "Raw auto rows are diagnostic only. Main balance display must use selected_rows or selected_date_rows."));
    if (autoRows.length) details.appendChild(renderTypedRowsTable(autoRows, {
      headers: ["Дата", "Канал", "Валюта", "Автоостаток", "Источник", "Статус"],
      amountHeader: "Автоостаток",
    }));
    return details;
  }

  function renderTypedRowsTable(rows, options) {
    var wrap = el("div", "table-wrap balance-snapshots-table-wrap");
    var table = el("table");
    var tbody = el("tbody");
    var head = el("tr");
    options.headers.forEach(function (cell) { head.appendChild(el("th", "", cell)); });
    tbody.appendChild(head);
    rows.forEach(function (row) {
      var tr = el("tr");
      [
        row.date || "—",
        row.channel || "—",
        row.currency || "—",
        formatAmount(row.amount),
        row.source_sheet || row.source || "—",
        row.status || "—",
      ].forEach(function (cell) { tr.appendChild(el("td", "", cell)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderCoverageTable(pairs) {
    var section = el("div", "balance-snapshots-coverage-block");
    section.appendChild(el("div", "tab-note", "Покрытие по каналам/валютам"));
    var wrap = el("div", "table-wrap balance-snapshots-table-wrap");
    var table = el("table");
    var tbody = el("tbody");
    var head = el("tr");
    ["Канал", "Валюта", "Строк", "Первая дата", "Последняя дата", "Даты"].forEach(function (cell) { head.appendChild(el("th", "", cell)); });
    tbody.appendChild(head);
    pairs.forEach(function (row) {
      var tr = el("tr");
      [row.channel || "—", row.currency || "—", row.rows || 0, row.first_date || "—", row.last_date || "—", Array.isArray(row.dates) ? row.dates.join(", ") : "—"].forEach(function (cell) { tr.appendChild(el("td", "", cell)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    return section;
  }

  function formatAmount(value) {
    if (value === null || value === undefined || value === "") return "—";
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return String(Math.round(numeric * 10000) / 10000);
  }

  function formatValueType(value) {
    var type = String(value || "").trim();
    var labels = {
      native_and_usd: "native + USD",
      native_only: "native",
      usd_only_needs_native: "USD-only",
      explicit_zero: "zero",
      carried_forward: "carried forward",
      calculated_hint: "calculated hint",
      needs_verification: "needs verification",
    };
    return labels[type] || "—";
  }

  function install() {
    if (!isDebugMode()) return false;
    if (typeof renderAnalyticsSections !== "function" || renderAnalyticsSections.__balanceSnapshotsWrapped) return false;
    var original = renderAnalyticsSections;
    renderAnalyticsSections = function (container) {
      var result = original.apply(this, arguments);
      var placeholder = el("section", "finance-analysis-section balance-snapshots-section");
      placeholder.appendChild(el("div", "config-note", "Загружаю инвентарь остатков..."));
      container.appendChild(placeholder);
      fetch(selectedUrl(), { cache: "no-store" })
        .then(function (response) { return response.json(); })
        .then(function (payload) { placeholder.replaceWith(renderInventory(payload)); })
        .catch(function (error) { placeholder.replaceWith(el("div", "finance-status error", "Инвентарь остатков недоступен: " + String(error?.message || error))); });
      return result;
    };
    renderAnalyticsSections.__balanceSnapshotsWrapped = true;
    return true;
  }

  function isDebugMode() {
    try {
      var params = new URLSearchParams(String(window.location?.search || ""));
      if (params.get("debugBalanceSnapshots") === "1") return true;
      if (params.get("debug") === "balance-snapshots") return true;
      return window.localStorage?.getItem("ezohata.debugBalanceSnapshots") === "1";
    } catch (error) {
      return false;
    }
  }

  window.EzohataBalanceSnapshotsUi = { install: install, recommendation: recommendation, renderInventory: renderInventory, formatAmount: formatAmount, formatValueType: formatValueType, isDebugMode: isDebugMode };
  install();
})();
