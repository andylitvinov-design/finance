(function initRemaindersSummaryPopup(root) {
  "use strict";

  const BALANCE_BUTTON_ID = "balanceLauncherButton";
  const REMAINDERS_BUTTON_ID = "remaindersLauncherButton";
  const REMAINDERS_BLOCK_ID = "remaindersSummaryBlock";
  const NEEDS_VERIFICATION = "needs verification";
  const RECONCILE_BUTTON_TEXT = "Обновить остатки и пересчитать";

  const CHANNEL_FIELDS = ["channel", "account", "wallet", "name", "payment_channel", "paymentChannel", "to_channel", "toChannel"];
  const CURRENCY_FIELDS = ["currency", "account_currency", "accountCurrency", "balance_currency", "balanceCurrency"];
  const OPENING_FIELDS = ["opening_amount_usd", "openingUsd", "start_amount_usd", "startUsd", "balance_start_usd", "startBalanceUsd", "opening_balance_usd"];
  const CLOSING_FIELDS = ["closing_amount_usd", "closingUsd", "end_amount_usd", "endUsd", "balance_end_usd", "endBalanceUsd", "closing_balance_usd"];
  const DELTA_FIELDS = ["delta_amount_usd", "deltaUsd", "change_usd", "changeUsd"];
  const MOVEMENT_FIELDS = ["movement_usd", "movement_amount_usd", "movementUsd"];
  const PLANNED_FIELDS = ["planned_closing_amount_usd", "plannedClosingUsd", "planned_balance_usd"];

  function getRootState() {
    if (typeof state !== "undefined") return state;
    return root.state || {};
  }

  function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  }

  function firstDefined(row, fields) {
    for (const field of fields) {
      if (hasOwn(row, field)) return row[field];
    }
    return undefined;
  }

  function parseNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const parsed = Number(String(value).trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatMoney(value) {
    return Number.isFinite(value) ? value.toFixed(4).replace(".", ",") : NEEDS_VERIFICATION;
  }

  function asRows(source) {
    if (Array.isArray(source)) return source;
    if (Array.isArray(source?.rows)) return source.rows;
    return null;
  }

  function getData(input, options = {}) {
    if (options.data) return options.data;
    if (input?.data) return input.data;
    return input || getRootState()?.data || {};
  }

  function resolveRemaindersRows(input, options = {}) {
    const data = getData(input, options);
    const candidates = [
      ["data.balances.remainders_rows", data?.balances?.remainders_rows],
      ["balances.remainders_rows", input?.balances?.remainders_rows],
      ["data.balances.remaindersRows", data?.balances?.remaindersRows],
      ["balances.remaindersRows", input?.balances?.remaindersRows],
      ["data.balance_coverage.rows", data?.balance_coverage?.rows],
      ["data.balanceCoverage.rows", data?.balanceCoverage?.rows],
      ["balance_coverage.rows", input?.balance_coverage?.rows],
      ["balanceCoverage.rows", input?.balanceCoverage?.rows],
      ["data.balances.rows", data?.balances?.rows],
      ["balances.rows", input?.balances?.rows],
      ["data.manual.balanceRows", data?.manual?.balanceRows],
      ["data.manual.balances", data?.manual?.balances],
    ];
    for (const [source, value] of candidates) {
      const rows = asRows(value);
      if (rows?.length) return { source, rows };
    }
    return { source: null, rows: [] };
  }

  function normalizeRemaindersRow(row) {
    const channel = String(firstDefined(row, CHANNEL_FIELDS) || "").trim() || "Не указан";
    const currency = String(firstDefined(row, CURRENCY_FIELDS) || "").trim().toUpperCase() || "n/a";
    const openingUsd = parseNumber(firstDefined(row, OPENING_FIELDS));
    const closingUsd = parseNumber(firstDefined(row, CLOSING_FIELDS));
    const movementUsd = parseNumber(firstDefined(row, MOVEMENT_FIELDS));
    const plannedClosingUsd = parseNumber(firstDefined(row, PLANNED_FIELDS));
    const fallbackDeltaUsd = parseNumber(firstDefined(row, DELTA_FIELDS));
    const deltaUsd = openingUsd !== null && closingUsd !== null ? closingUsd - openingUsd : fallbackDeltaUsd;
    const needsVerification = openingUsd === null || closingUsd === null || deltaUsd === null;
    const plannedNeedsVerification = plannedClosingUsd === null;
    return { channel, currency, openingUsd, closingUsd, deltaUsd, movementUsd, plannedClosingUsd, needsVerification, plannedNeedsVerification };
  }

  function buildRemaindersSummary(input, options = {}) {
    const { source, rows } = resolveRemaindersRows(input, options);
    const normalizedRows = rows.map(normalizeRemaindersRow);
    const completeRows = normalizedRows.filter((row) => !row.needsVerification);
    const plannedRows = normalizedRows.filter((row) => row.plannedClosingUsd !== null);
    const totals = completeRows.reduce((sum, row) => ({
      openingUsd: sum.openingUsd + row.openingUsd,
      closingUsd: sum.closingUsd + row.closingUsd,
      deltaUsd: sum.deltaUsd + row.deltaUsd,
    }), { openingUsd: 0, closingUsd: 0, deltaUsd: 0 });
    const plannedTotals = plannedRows.reduce((sum, row) => ({
      movementUsd: sum.movementUsd + row.movementUsd,
      plannedClosingUsd: sum.plannedClosingUsd + row.plannedClosingUsd,
    }), { movementUsd: 0, plannedClosingUsd: 0 });
    const needsVerificationCount = normalizedRows.length - completeRows.length;
    return {
      source,
      rows: normalizedRows,
      totals,
      plannedTotals,
      needsVerificationCount,
      diagnostics: source ? [] : [`${NEEDS_VERIFICATION}: source not found for remainders summary.`],
    };
  }

  function getDateInputValue(id) {
    const fromElements = root.elements?.[id]?.value;
    if (fromElements) return fromElements;
    const fromInput = root.document?.getElementById?.(id)?.value;
    if (fromInput) return fromInput;
    const params = new URL(root.location?.href || "https://ezohata-incoming-ledger.vercel.app/").searchParams;
    if (id === "startDate") return params.get("from") || params.get("startDate") || "";
    if (id === "endDate") return params.get("to") || params.get("endDate") || "";
    return "";
  }

  function buildAuditSnapshotUrl() {
    const base = root.location?.href || "https://ezohata-incoming-ledger.vercel.app/";
    const url = new URL("./api/audit-snapshot", base);
    const from = getDateInputValue("startDate");
    const to = getDateInputValue("endDate");
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    return url;
  }

  function buildSelectedDateBalanceSnapshotsUrl() {
    const base = root.location?.href || "https://ezohata-incoming-ledger.vercel.app/";
    const url = new URL("./api/balance-snapshots", base);
    const selectedDate = getDateInputValue("endDate") || getDateInputValue("startDate");
    if (selectedDate) {
      url.searchParams.set("from", selectedDate);
      url.searchParams.set("to", selectedDate);
    }
    return url;
  }

  function buildReconcileUrl() {
    const base = root.location?.href || "https://ezohata-incoming-ledger.vercel.app/";
    return new URL("./api/index?action=reconcileBalancesAndTransfers", base);
  }

  async function fetchAuditSnapshotRemainders() {
    if (typeof root.fetch !== "function") return null;
    const response = await root.fetch(buildAuditSnapshotUrl().toString(), { cache: "no-store" });
    if (!response?.ok) throw new Error(`audit snapshot returned ${response?.status || "unknown status"}`);
    return response.json();
  }

  async function fetchSelectedDateBalanceSnapshot() {
    if (typeof root.fetch !== "function") return null;
    const response = await root.fetch(buildSelectedDateBalanceSnapshotsUrl().toString(), { cache: "no-store" });
    if (!response?.ok) throw new Error(`balance snapshots returned ${response?.status || "unknown status"}`);
    const payload = await response.json();
    return payload?.balance_snapshots || null;
  }

  async function readJsonResponse(response, label) {
    const text = await response.text?.().catch?.(() => "") || "";
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_error) {
      const excerpt = String(text).replace(/\s+/g, " ").slice(0, 300) || "non-JSON response";
      throw new Error(`${label} returned non-JSON response (${response?.status || "unknown"}): ${excerpt}`);
    }
  }

  async function runBalanceReconcileWorkflow() {
    if (typeof root.fetch !== "function") throw new Error("fetch is unavailable");
    const from = getDateInputValue("startDate");
    const to = getDateInputValue("endDate");
    const response = await root.fetch(buildReconcileUrl().toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ from, to }),
    });
    const payload = await readJsonResponse(response, "reconcile-balances-and-transfers");
    if (!response?.ok || !payload?.ok) {
      throw new Error(payload?.error || payload?.errors?.[0]?.message || `reconcile returned ${response?.status || "unknown status"}`);
    }
    return payload;
  }

  async function buildLiveRemaindersSummary(input, options = {}) {
    const current = buildRemaindersSummary(input, options);
    const selectedDateSnapshot = await fetchSelectedDateBalanceSnapshot().catch((error) => ({
      selected_date_source: "none",
      selected_date_rows: [],
      selected_date_diagnostics: [
        `No balance snapshot for this date; run guarded May backfill.`,
        `${NEEDS_VERIFICATION}: balance snapshots fetch failed (${String(error?.message || error)}).`,
      ],
    }));
    if (/remainders_?rows/i.test(current.source || "") && current.rows.length) {
      return { ...current, selectedDateSnapshot };
    }
    try {
      const snapshot = await fetchAuditSnapshotRemainders();
      if (!snapshot) return { ...current, selectedDateSnapshot };
      const fetched = buildRemaindersSummary(snapshot);
      return { ...(fetched.source ? fetched : current), selectedDateSnapshot };
    } catch (error) {
      return {
        ...current,
        selectedDateSnapshot,
        diagnostics: [
          ...(current.diagnostics || []),
          `${NEEDS_VERIFICATION}: audit snapshot fetch failed (${String(error?.message || error)}).`,
        ],
      };
    }
  }

  function renderCell(doc, value, className) {
    const cell = doc.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value;
    return cell;
  }

  function renderHeaderCell(doc, value) {
    const cell = doc.createElement("th");
    cell.textContent = value;
    return cell;
  }

  function scrollRemaindersTable(wrap, left) {
    if (!wrap) return;
    if (typeof wrap.scrollBy === "function") {
      wrap.scrollBy({ left, behavior: "auto" });
      return;
    }
    wrap.scrollLeft = Number(wrap.scrollLeft || 0) + left;
  }

  function renderRemaindersScrollControls(wrap, doc = root.document) {
    const controls = doc.createElement("div");
    controls.className = "remainders-scroll-controls";
    [
      ["Влево", -240],
      ["Вправо", 240],
    ].forEach(([label, left]) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "ghost remainders-scroll-button";
      button.textContent = label;
      button.addEventListener("click", () => scrollRemaindersTable(wrap, left));
      controls.appendChild(button);
    });
    return controls;
  }

  function renderSelectedDateSnapshotBlock(snapshot, doc = root.document) {
    if (!snapshot) return null;
    const rows = Array.isArray(snapshot.selected_date_rows) ? snapshot.selected_date_rows : [];
    const section = doc.createElement("section");
    section.className = "selected-date-balance-snapshots";
    const title = doc.createElement("h4");
    title.textContent = "Остатки на выбранную дату";
    section.appendChild(title);

    const meta = doc.createElement("div");
    meta.className = "tab-note";
    meta.textContent = `${snapshot.selected_date || "Дата не выбрана"} · ${snapshot.selected_date_source || "none"}`;
    section.appendChild(meta);

    if (rows.length) {
      const wrap = doc.createElement("div");
      wrap.className = "table-wrap remainders-summary-table-wrap";
      const table = doc.createElement("table");
      const thead = doc.createElement("thead");
      const header = doc.createElement("tr");
      ["Дата", "Канал", "Валюта", "Остаток"].forEach((label) => header.appendChild(renderHeaderCell(doc, label)));
      thead.appendChild(header);
      table.appendChild(thead);
      const tbody = doc.createElement("tbody");
      rows.forEach((row) => {
        const tr = doc.createElement("tr");
        tr.appendChild(renderCell(doc, row.date || snapshot.selected_date || "—"));
        tr.appendChild(renderCell(doc, row.channel || "—"));
        tr.appendChild(renderCell(doc, row.currency || "—"));
        tr.appendChild(renderCell(doc, formatSnapshotAmount(row.amount), "numeric"));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      section.appendChild(wrap);
      return section;
    }

    const diagnostics = Array.isArray(snapshot.selected_date_diagnostics) && snapshot.selected_date_diagnostics.length
      ? snapshot.selected_date_diagnostics
      : ["No balance snapshot for this date; run guarded May backfill."];
    const note = doc.createElement("div");
    note.className = "balance-summary-diagnostics";
    note.textContent = diagnostics.join(" ");
    section.appendChild(note);
    return section;
  }

  function formatSnapshotAmount(value) {
    const parsed = parseNumber(value);
    if (!Number.isFinite(parsed)) return "—";
    return String(Math.round(parsed * 10000) / 10000).replace(".", ",");
  }

  function renderRemaindersSummaryBlock(summary, doc = root.document) {
    const block = doc.createElement("div");
    block.id = REMAINDERS_BLOCK_ID;
    block.className = "balance-summary-block remainders-summary-block";
    block.setAttribute("aria-live", "polite");

    const title = doc.createElement("h3");
    title.textContent = "Остатки по каналам";
    block.appendChild(title);

    const actions = doc.createElement("div");
    actions.className = "balance-summary-actions remainders-summary-actions";
    const refreshButton = doc.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "secondary";
    refreshButton.textContent = summary.reconcileLoading ? "Обновляю остатки..." : RECONCILE_BUTTON_TEXT;
    refreshButton.disabled = Boolean(summary.reconcileLoading);
    refreshButton.addEventListener("click", async () => {
      const loading = renderRemaindersSummaryBlock({ ...summary, reconcileLoading: true }, doc);
      block.parentNode?.replaceChild?.(loading, block);
      try {
        const result = await runBalanceReconcileWorkflow();
        const nextSummary = buildRemaindersSummary(result.audit_snapshot || {});
        const next = renderRemaindersSummaryBlock({ ...nextSummary, reconcileResult: result }, doc);
        loading.parentNode?.replaceChild?.(next, loading);
      } catch (error) {
        const next = renderRemaindersSummaryBlock({
          ...summary,
          reconcileResult: { ok: false, error: String(error?.message || error) },
        }, doc);
        loading.parentNode?.replaceChild?.(next, loading);
      }
    });
    actions.appendChild(refreshButton);
    block.appendChild(actions);

    if (summary.reconcileResult) {
      block.appendChild(renderReconcileResult(summary.reconcileResult, doc));
    }

    const selectedDateBlock = renderSelectedDateSnapshotBlock(summary.selectedDateSnapshot, doc);
    if (selectedDateBlock) block.appendChild(selectedDateBlock);

    const wrap = doc.createElement("div");
    wrap.className = "table-wrap remainders-summary-table-wrap";
    block.appendChild(renderRemaindersScrollControls(wrap, doc));
    const table = doc.createElement("table");
    const thead = doc.createElement("thead");
    const header = doc.createElement("tr");
    ["Канал", "Валюта", "Было на начало периода, USD", "Стало на конец периода, USD", "Изменение, USD", "Движение средств", "Остатки плановые"].forEach((label) => {
      header.appendChild(renderHeaderCell(doc, label));
    });
    thead.appendChild(header);
    table.appendChild(thead);

    const tbody = doc.createElement("tbody");
    summary.rows.forEach((row) => {
      const tr = doc.createElement("tr");
      if (row.needsVerification) tr.className = "needs-verification";
      tr.appendChild(renderCell(doc, row.channel));
      tr.appendChild(renderCell(doc, row.currency));
      tr.appendChild(renderCell(doc, formatMoney(row.openingUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatMoney(row.closingUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatMoney(row.deltaUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatMoney(row.movementUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatMoney(row.plannedClosingUsd), "numeric"));
      tbody.appendChild(tr);
    });

    const total = doc.createElement("tr");
    total.className = "balance-income-channel-total";
    total.appendChild(renderCell(doc, "ИТОГО"));
    total.appendChild(renderCell(doc, ""));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.totals.openingUsd : null), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.totals.closingUsd : null), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.totals.deltaUsd : null), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.plannedTotals?.movementUsd : null), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.plannedTotals?.plannedClosingUsd : null), "numeric"));
    tbody.appendChild(total);
    table.appendChild(tbody);
    wrap.appendChild(table);
    block.appendChild(wrap);

    const diagnostics = [...(summary.diagnostics || [])];
    if (summary.needsVerificationCount) {
      diagnostics.push(`${NEEDS_VERIFICATION}: ${summary.needsVerificationCount} row(s) have missing opening/closing USD values.`);
    }
    if (summary.rows.some((row) => row.plannedClosingUsd !== null)) {
      diagnostics.push("Плановые остатки расчетные: opening_amount_usd + Ledger movement_usd from amount_net; factual closing_amount_usd is not overwritten.");
    }
    if (diagnostics.length) {
      const note = doc.createElement("div");
      note.className = "balance-summary-diagnostics";
      note.textContent = diagnostics.join(" ");
      block.appendChild(note);
    }
    return block;
  }

  function renderReconcileResult(result, doc = root.document) {
    const panel = doc.createElement("div");
    panel.className = "balance-summary-diagnostics remainders-reconcile-result";
    const failures = Array.isArray(result.provider_failures) ? result.provider_failures : [];
    const needsRows = Array.isArray(result.needs_verification_rows) ? result.needs_verification_rows : [];
    const providerFailures = failures
      .map((row) => `${row.provider || "provider"}: ${row.error || row.status || "error"}`)
      .slice(0, 6);
    const needsReasons = needsRows
      .map((row) => `${row.channel || "Не указан"} ${row.currency || ""}: ${row.reason || row.status || NEEDS_VERIFICATION}`.trim())
      .slice(0, 8);
    appendReconcileSection(doc, panel, "Итог обновления", [
      `providers checked: ${(result.providers_checked || []).join(", ") || "none"}`,
      `balances pulled: ${Number(result.balances_pulled || 0)}`,
      `transfers imported: ${Number(result.transfers_imported || 0)}`,
      `computed rows: ${Number(result.computed_rows_count || 0)}`,
      `needs verification rows: ${needsRows.length}`,
    ]);
    appendReconcileSection(doc, panel, "Провайдеры", providerFailures.length ? providerFailures : ["provider failures/errors: none"]);
    appendReconcileSection(doc, panel, "Нужна проверка", needsReasons.length ? needsReasons : ["reasons: none"]);
    if (result.error) appendReconcileSection(doc, panel, "Ошибка", [`error: ${result.error}`]);
    return panel;
  }

  function appendReconcileSection(doc, panel, title, rows) {
    const section = doc.createElement("section");
    section.className = "remainders-reconcile-section";
    const heading = doc.createElement("strong");
    heading.textContent = title;
    section.appendChild(heading);
    const list = doc.createElement("ul");
    rows.forEach((text) => {
      const item = doc.createElement("li");
      item.textContent = text;
      list.appendChild(item);
    });
    section.appendChild(list);
    panel.appendChild(section);
  }

  function getSummaryMount(doc = root.document) {
    return doc?.querySelector?.(".hero .controls") || doc?.getElementById?.(BALANCE_BUTTON_ID)?.parentNode || doc?.body || null;
  }

  function ensureRemaindersLauncherButton() {
    const doc = root.document;
    const existing = doc?.getElementById?.(REMAINDERS_BUTTON_ID);
    if (existing) return existing;
    const balanceButton = doc?.getElementById?.(BALANCE_BUTTON_ID);
    if (!doc?.createElement || !balanceButton?.parentNode) return null;
    const button = doc.createElement("button");
    button.id = REMAINDERS_BUTTON_ID;
    button.className = "secondary";
    button.type = "button";
    button.textContent = "Остатки";
    if (balanceButton.nextSibling) balanceButton.parentNode.insertBefore(button, balanceButton.nextSibling);
    else balanceButton.parentNode.appendChild(button);
    return button;
  }

  async function updateRemaindersSummaryBlock() {
    const doc = root.document;
    const existing = doc?.getElementById?.(REMAINDERS_BLOCK_ID);
    if (!existing) return false;
    const next = renderRemaindersSummaryBlock(await buildLiveRemaindersSummary(), doc);
    existing.parentNode?.replaceChild?.(next, existing);
    return true;
  }

  function bindRemaindersLauncherButton() {
    const doc = root.document;
    const launcher = ensureRemaindersLauncherButton();
    if (!launcher || launcher.__ezohataRemaindersLauncherBound) return Boolean(launcher);
    launcher.__ezohataRemaindersLauncherBound = true;
    launcher.addEventListener("click", async () => {
      const existing = doc.getElementById(REMAINDERS_BLOCK_ID);
      if (existing) {
        existing.remove?.();
        return;
      }
      const block = renderRemaindersSummaryBlock(await buildLiveRemaindersSummary(), doc);
      const mount = getSummaryMount(doc);
      if (mount?.insertAdjacentElement) mount.insertAdjacentElement("afterend", block);
      else mount?.appendChild?.(block);
    });
    return true;
  }

  function patchRenderMetrics() {
    if (typeof root.renderMetrics !== "function" || root.renderMetrics.__ezohataRemaindersSummaryPatched) return false;
    const original = root.renderMetrics;
    root.renderMetrics = function renderMetricsWithRemaindersSummary(...args) {
      const result = original.apply(this, args);
      updateRemaindersSummaryBlock();
      return result;
    };
    root.renderMetrics.__ezohataRemaindersSummaryPatched = true;
    return true;
  }

  function startRemaindersSummary() {
    bindRemaindersLauncherButton();
    patchRenderMetrics();
  }

  const api = {
    REMAINDERS_BUTTON_ID,
    REMAINDERS_BLOCK_ID,
    buildRemaindersSummary,
    buildLiveRemaindersSummary,
    runBalanceReconcileWorkflow,
    renderRemaindersSummaryBlock,
    renderReconcileResult,
    bindRemaindersLauncherButton,
    startRemaindersSummary,
    updateRemaindersSummaryBlock,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataRemaindersSummaryPopup = api;
  startRemaindersSummary();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startRemaindersSummary);
})(typeof globalThis !== "undefined" ? globalThis : window);
