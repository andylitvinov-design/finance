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
    titleWrap.appendChild(el("div", "tab-note", "Какие даты и каналы уже есть в листе Остатки. Суммы не показываются."));
    header.appendChild(titleWrap);
    section.appendChild(header);

    var cards = el("div", "metrics balance-snapshots-summary");
    [["Дат", data.dates?.length || 0], ["Последняя", latestDate(data)], ["Канал/валюта", data.by_channel_currency?.length || 0], ["Валидных", data.valid_rows || 0], ["Неполных", data.incomplete_rows || 0]].forEach(function (item) {
      var card = el("div", "metric");
      card.appendChild(el("div", "metric-label", item[0]));
      card.appendChild(el("div", "metric-value", item[1]));
      cards.appendChild(card);
    });
    section.appendChild(cards);
    section.appendChild(el("div", "finance-status", recommendation(data)));

    var pairs = Array.isArray(data.by_channel_currency) ? data.by_channel_currency : [];
    if (!pairs.length) {
      section.appendChild(el("div", "empty", "За выбранный период нет валидных строк Остатки."));
      return section;
    }
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

  function install() {
    if (typeof renderExpenseFinancialAnalysis !== "function" || renderExpenseFinancialAnalysis.__balanceSnapshotsWrapped) return false;
    var original = renderExpenseFinancialAnalysis;
    renderExpenseFinancialAnalysis = function () {
      var block = original.apply(this, arguments);
      var placeholder = el("section", "finance-analysis-section balance-snapshots-section");
      placeholder.appendChild(el("div", "config-note", "Загружаю инвентарь остатков..."));
      block.appendChild(placeholder);
      fetch(selectedUrl(), { cache: "no-store" })
        .then(function (response) { return response.json(); })
        .then(function (payload) { placeholder.replaceWith(renderInventory(payload)); })
        .catch(function (error) { placeholder.replaceWith(el("div", "finance-status error", "Инвентарь остатков недоступен: " + String(error?.message || error))); });
      return block;
    };
    renderExpenseFinancialAnalysis.__balanceSnapshotsWrapped = true;
    return true;
  }

  window.EzohataBalanceSnapshotsUi = { install: install, recommendation: recommendation, renderInventory: renderInventory };
  install();
})();
