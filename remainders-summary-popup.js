(function initRemaindersSummaryPopup(root) {
  "use strict";

  const channelDisplayOrder = root.EzohataChannelDisplayOrder || (typeof require === "function" ? require("./channel-display-order.js") : {});
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
  const SNAPSHOT_AMOUNT_FIELDS = ["amount", "balance", "amount_usd", "balance_usd", "closing_amount_usd", "closingUsd", "end_amount_usd", "endUsd", "closing_balance_usd"];
  const PERIOD_MOVEMENT_FIELDS = ["real_delta", "movement", "movement_amount", "movementAmount", "balance_amount", "amount_net", "amountNet"];

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

  function formatUsdCell(value) {
    return Number.isFinite(value) ? formatMoney(value) : "fx_missing";
  }

  function computeVisibleUsdRow(row) {
    const changeUsd = Number.isFinite(row.openingUsd) && Number.isFinite(row.closingUsd)
      ? row.closingUsd - row.openingUsd
      : null;
    const diffUsd = Number.isFinite(changeUsd) && Number.isFinite(row.movementUsd)
      ? changeUsd - row.movementUsd
      : null;
    return {
      channel: row.channel,
      openingUsd: row.openingUsd,
      closingUsd: row.closingUsd,
      changeUsd,
      movementUsd: row.movementUsd,
      diffUsd,
      fxMissing: typeof row.fxMissing === "boolean"
        ? row.fxMissing
        : ![
          row.openingUsd,
          row.closingUsd,
          changeUsd,
          row.movementUsd,
          diffUsd,
        ].every(Number.isFinite),
    };
  }

  function buildVisibleUsdTotals(rows) {
    return (rows || []).reduce((totals, row) => {
      const visible = computeVisibleUsdRow(row);
      if (visible.fxMissing) {
        totals.fxMissingCount += 1;
        return totals;
      }
      totals.openingUsd += visible.openingUsd;
      totals.closingUsd += visible.closingUsd;
      totals.changeUsd += visible.changeUsd;
      totals.movementUsd += visible.movementUsd;
      totals.diffUsd += visible.diffUsd;
      return totals;
    }, {
      openingUsd: 0,
      closingUsd: 0,
      changeUsd: 0,
      movementUsd: 0,
      diffUsd: 0,
      fxMissingCount: 0,
    });
  }

  function buildVisibleUsdRowsFromPeriodReconciliation(reconciliation) {
    return sortDisplayRows(reconciliation?.by_channel_currency || [])
      .filter((row) => row?.channel && row.channel !== "ВСЕГО USD")
      .map((row) => ({
        sort_channel: row.channel || "",
        channel: `${row.channel || ""}${row.currency ? ` ${row.currency}` : ""}`.trim(),
        openingUsd: parseNumber(row.opening_usd),
        closingUsd: parseNumber(row.confirmed_end_usd),
        movementUsd: parseNumber(row.movement_usd),
        fxMissing: Array.isArray(row.fx_warnings) && row.fx_warnings.length > 0,
      }));
  }

  function buildVisibleUsdTotalFromPeriodReconciliation(reconciliation) {
    const row = reconciliation?.total_usd_row || null;
    if (!row) return null;
    return {
      openingUsd: parseNumber(row.opening_usd) || 0,
      closingUsd: parseNumber(row.confirmed_end_usd) || 0,
      changeUsd: parseNumber(row.change_usd) || 0,
      movementUsd: parseNumber(row.movement_usd) || 0,
      diffUsd: parseNumber(row.diff_usd) || 0,
      fxMissingCount: Number(row.excluded_fx_missing_rows || 0),
    };
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
      ["data.balances.rows", data?.balances?.rows],
      ["balances.rows", input?.balances?.rows],
      ["data.manual.balanceRows", data?.manual?.balanceRows],
      ["data.manual.balances", data?.manual?.balances],
    ];
    for (const [source, value] of candidates) {
      const rows = asRows(value);
      const visibleRows = rows?.filter(isVisibleRemaindersRow);
      if (visibleRows?.length) return { source, rows: visibleRows };
    }
    return { source: null, rows: [] };
  }

  function isVisibleRemaindersRow(row) {
    if (!row || typeof row !== "object") return false;
    const rowSource = String(row.source || row.inclusion_source || "").toLowerCase();
    const rowStatus = String(row.status || row.planned_balance_source || "").toLowerCase();
    const fromCoverageDiagnostics = /balance[_\s-]?coverage/.test(rowSource);
    const diagnosticOnly = rowStatus.includes("needs") || row.needs_verification === true;
    const hasBalanceValue = [
      firstDefined(row, OPENING_FIELDS),
      firstDefined(row, CLOSING_FIELDS),
      firstDefined(row, PLANNED_FIELDS),
    ].some((value) => parseNumber(value) !== null);
    return !(fromCoverageDiagnostics && diagnosticOnly && !hasBalanceValue);
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
    const normalizedRows = sortDisplayRows(rows.map(normalizeRemaindersRow));
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
    const from = getDateInputValue("startDate");
    const to = getDateInputValue("endDate") || from;
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    return url;
  }

  function buildPeriodBalanceReconciliationUrl() {
    const base = root.location?.href || "https://ezohata-incoming-ledger.vercel.app/";
    const url = new URL("./api/period-balance-reconciliation", base);
    const from = getDateInputValue("startDate");
    const to = getDateInputValue("endDate");
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
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
    const snapshot = payload?.balance_snapshots || null;
    if (!snapshot) return null;
    return {
      period_from: payload?.period?.from || getDateInputValue("startDate") || snapshot.period_from || null,
      period_to: payload?.period?.to || getDateInputValue("endDate") || snapshot.selected_date || snapshot.period_to || null,
      ...snapshot,
    };
  }

  async function fetchPeriodBalanceReconciliation() {
    if (typeof root.fetch !== "function") return null;
    const response = await root.fetch(buildPeriodBalanceReconciliationUrl().toString(), { cache: "no-store" });
    if (!response?.ok) throw new Error(`period balance reconciliation returned ${response?.status || "unknown status"}`);
    const payload = await response.json();
    return payload?.period_balance_reconciliation || null;
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
      period_from: getDateInputValue("startDate") || null,
      period_to: getDateInputValue("endDate") || null,
      selected_date_source: "none",
      selected_date_rows: [],
      selected_date_diagnostics: [
        `No balance snapshot for this date; run guarded May backfill.`,
        `${NEEDS_VERIFICATION}: balance snapshots fetch failed (${String(error?.message || error)}).`,
      ],
    }));
    const periodReconciliation = await fetchPeriodBalanceReconciliation().catch(() => null);
    const periodMovementRows = periodReconciliation?.by_channel_currency || [];
    if (/remainders_?rows/i.test(current.source || "") && current.rows.length) {
      return { ...current, selectedDateSnapshot, periodReconciliation, periodMovementRows };
    }
    try {
      const snapshot = await fetchAuditSnapshotRemainders();
      if (!snapshot) return { ...current, selectedDateSnapshot, periodReconciliation, periodMovementRows };
      const fetched = buildRemaindersSummary(snapshot);
      return { ...(fetched.source ? fetched : current), selectedDateSnapshot, periodReconciliation, periodMovementRows };
    } catch (error) {
      return {
        ...current,
        selectedDateSnapshot,
        periodReconciliation,
        periodMovementRows,
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
    const rows = sortDisplayRows(Array.isArray(snapshot.selected_date_rows) ? snapshot.selected_date_rows : []);
    const section = doc.createElement("section");
    section.className = "selected-date-balance-snapshots";
    const title = doc.createElement("h4");
    title.textContent = "Остатки на выбранную дату";
    section.appendChild(title);

    if (rows.length) {
      if (snapshot.selected_date) {
        const meta = doc.createElement("div");
        meta.className = "tab-note";
        const coverage = snapshot.selected_date_coverage || {};
        const uniqueCount = Number(coverage.unique_channel_currency_count || rows.length);
        const expectedCount = Number(coverage.expected_rows || 0);
        meta.textContent = expectedCount
          ? `Остатки сохранены на дату: ${snapshot.selected_date} · каналов: ${uniqueCount}`
          : `Остатки сохранены на дату: ${snapshot.selected_date}`;
        section.appendChild(meta);
        if (expectedCount && (uniqueCount < expectedCount || Number(coverage.duplicate_channel_currency_count || 0) > 0)) {
          const warning = doc.createElement("div");
          warning.className = "balance-summary-diagnostics";
          const missing = Array.isArray(coverage.missing_channels) ? coverage.missing_channels.slice(0, 12) : [];
          const duplicateCount = Number(coverage.duplicate_channel_currency_count || 0);
          warning.textContent = [
            uniqueCount < expectedCount ? `Частичное покрытие: ${uniqueCount} из ${expectedCount}` : "",
            missing.length ? `нет: ${missing.join(", ")}` : "",
            duplicateCount ? `дубликаты: ${duplicateCount}` : "",
          ].filter(Boolean).join(" · ");
          section.appendChild(warning);
        }
      }
      const wrap = doc.createElement("div");
      wrap.className = "table-wrap remainders-summary-table-wrap";
      const table = doc.createElement("table");
      const thead = doc.createElement("thead");
      const header = doc.createElement("tr");
      ["Канал", "Валюта", "Остаток"].forEach((label) => header.appendChild(renderHeaderCell(doc, label)));
      thead.appendChild(header);
      table.appendChild(thead);
      const tbody = doc.createElement("tbody");
      rows.forEach((row) => {
        const tr = doc.createElement("tr");
        tr.appendChild(renderCell(doc, row.channel || "—"));
        tr.appendChild(renderCell(doc, row.currency || "—"));
        tr.appendChild(renderCell(doc, formatSnapshotAmount(getSnapshotAmount(row)), "numeric"));
        tbody.appendChild(tr);
      });
      buildSnapshotCurrencyTotals(rows).forEach((row) => {
        const tr = doc.createElement("tr");
        tr.className = "balance-income-channel-total";
        tr.appendChild(renderCell(doc, `ИТОГО ${row.currency}`));
        tr.appendChild(renderCell(doc, row.currency));
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

  function getSnapshotAmount(row) {
    return firstDefined(row, SNAPSHOT_AMOUNT_FIELDS);
  }

  function getRowKey(row) {
    const channel = String(firstDefined(row, CHANNEL_FIELDS) || "").trim() || "Не указан";
    const currency = String(firstDefined(row, CURRENCY_FIELDS) || "").trim().toUpperCase() || "N/A";
    return `${channel}\u0000${currency}`;
  }

  function splitRowKey(key) {
    const [channel, currency] = String(key || "").split("\u0000");
    return { channel: channel || "Не указан", currency: currency || "N/A" };
  }

  function buildSnapshotCurrencyTotals(rows) {
    const totals = new Map();
    (rows || []).forEach((row) => {
      const amount = parseNumber(getSnapshotAmount(row));
      if (amount === null) return;
      const currency = String(firstDefined(row, CURRENCY_FIELDS) || "").trim().toUpperCase() || "N/A";
      totals.set(currency, (totals.get(currency) || 0) + amount);
    });
    return Array.from(totals, ([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
  }

  function buildPeriodBalanceChangeRows(snapshot, movementRows = []) {
    if (!snapshot) return [];
    const periodFrom = snapshot.period_from || snapshot.from || getDateInputValue("startDate");
    const periodTo = snapshot.period_to || snapshot.to || snapshot.selected_date || getDateInputValue("endDate") || periodFrom;
    if (!periodFrom && !periodTo) return [];

    const allSnapshotRows = [
      ...(Array.isArray(snapshot.rows) ? snapshot.rows : []),
      ...(Array.isArray(snapshot.selected_date_rows) ? snapshot.selected_date_rows : []),
    ];
    const opening = new Map();
    const closing = new Map();
    allSnapshotRows.forEach((row) => {
      const date = String(row?.date || "").slice(0, 10);
      const amount = parseNumber(getSnapshotAmount(row));
      if (amount === null) return;
      const key = getRowKey(row);
      if (date === periodFrom && !opening.has(key)) opening.set(key, amount);
      if (date === periodTo) closing.set(key, amount);
    });

    const movement = new Map();
    (movementRows || []).forEach((row) => {
      const value = parseNumber(firstDefined(row, PERIOD_MOVEMENT_FIELDS));
      if (value === null) return;
      const key = getRowKey(row);
      movement.set(key, (movement.get(key) || 0) + value);
    });

    const keys = new Set([...opening.keys(), ...closing.keys(), ...movement.keys()]);
    return Array.from(keys).map((key) => {
      const { channel, currency } = splitRowKey(key);
      const openingBalance = opening.has(key) ? opening.get(key) : 0;
      const closingBalance = closing.has(key) ? closing.get(key) : 0;
      const movementAmount = movement.has(key) ? movement.get(key) : 0;
      const plannedBalance = openingBalance + movementAmount;
      const change = closingBalance - openingBalance;
      const diff = closingBalance - plannedBalance;
      return {
        channel,
        currency,
        openingBalance,
        closingBalance,
        change,
        movementAmount,
        plannedBalance,
        factualBalance: closingBalance,
        diff,
      };
    }).sort(compareDisplayRows);
  }

  function buildPeriodBalanceChangeTotals(rows) {
    const totals = new Map();
    (rows || []).forEach((row) => {
      const current = totals.get(row.currency) || {
        channel: `ИТОГО ${row.currency}`,
        currency: row.currency,
        openingBalance: 0,
        closingBalance: 0,
        change: 0,
        movementAmount: 0,
        plannedBalance: 0,
        factualBalance: 0,
        diff: 0,
      };
      current.openingBalance += row.openingBalance;
      current.closingBalance += row.closingBalance;
      current.change += row.change;
      current.movementAmount += row.movementAmount;
      current.plannedBalance += row.plannedBalance;
      current.factualBalance += row.factualBalance;
      current.diff += row.diff;
      totals.set(row.currency, current);
    });
    return Array.from(totals.values()).sort((a, b) => a.currency.localeCompare(b.currency));
  }

  function appendPeriodChangeRow(doc, tbody, row, className = "") {
    const tr = doc.createElement("tr");
    if (className) tr.className = className;
    tr.appendChild(renderCell(doc, row.channel));
    tr.appendChild(renderCell(doc, row.currency));
    tr.appendChild(renderCell(doc, formatSnapshotAmount(row.openingBalance), "numeric"));
    tr.appendChild(renderCell(doc, formatSnapshotAmount(row.closingBalance), "numeric"));
    tr.appendChild(renderCell(doc, formatSnapshotAmount(row.change), "numeric"));
    tr.appendChild(renderCell(doc, formatSnapshotAmount(row.movementAmount), "numeric"));
    tr.appendChild(renderCell(doc, formatSnapshotAmount(row.plannedBalance), "numeric"));
    tr.appendChild(renderCell(doc, formatSnapshotAmount(row.factualBalance), "numeric"));
    tr.appendChild(renderCell(doc, formatSnapshotAmount(row.diff), "numeric"));
    tbody.appendChild(tr);
  }

  function renderPeriodBalanceChangesBlock(snapshot, movementRows = [], doc = root.document) {
    const rows = buildPeriodBalanceChangeRows(snapshot, movementRows);
    if (!rows.length) return null;
    const section = doc.createElement("section");
    section.className = "period-balance-changes";
    const title = doc.createElement("h4");
    title.textContent = "Изменение за период";
    section.appendChild(title);

    const wrap = doc.createElement("div");
    wrap.className = "table-wrap remainders-summary-table-wrap";
    const table = doc.createElement("table");
    const thead = doc.createElement("thead");
    const header = doc.createElement("tr");
    [
      "Канал",
      "Валюта",
      "Остаток на начало",
      "Остаток на конец",
      "Изменение",
      "Движение средств",
      "Остаток плановый",
      "Остаток фактический",
      "Расхождение",
    ].forEach((label) => header.appendChild(renderHeaderCell(doc, label)));
    thead.appendChild(header);
    table.appendChild(thead);
    const tbody = doc.createElement("tbody");
    rows.forEach((row) => appendPeriodChangeRow(doc, tbody, row));
    buildPeriodBalanceChangeTotals(rows).forEach((row) => appendPeriodChangeRow(doc, tbody, row, "balance-income-channel-total"));
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    return section;
  }

  function renderDefaultUsdBalancesTable(summary, doc = root.document) {
    const periodRows = buildVisibleUsdRowsFromPeriodReconciliation(summary.periodReconciliation);
    const rows = sortDisplayRows(periodRows.length ? periodRows : (summary.rows || []));
    const totals = buildVisibleUsdTotalFromPeriodReconciliation(summary.periodReconciliation) || buildVisibleUsdTotals(rows);
    const section = doc.createElement("section");
    section.className = "remainders-usd-balances";
    const title = doc.createElement("h4");
    title.textContent = "Остатки по каналам оплаты";
    section.appendChild(title);

    const wrap = doc.createElement("div");
    wrap.className = "table-wrap remainders-summary-table-wrap";
    wrap.appendChild(renderRemaindersScrollControls(wrap, doc));
    const table = doc.createElement("table");
    const thead = doc.createElement("thead");
    const header = doc.createElement("tr");
    [
      "Канал",
      "Остатки 1 USD",
      "Остатки 2 USD",
      "Изменение USD",
      "Движение средств USD",
      "Разница USD",
    ].forEach((label) => header.appendChild(renderHeaderCell(doc, label)));
    thead.appendChild(header);
    table.appendChild(thead);

    const tbody = doc.createElement("tbody");
    rows.forEach((row) => {
      const visible = computeVisibleUsdRow(row);
      const tr = doc.createElement("tr");
      if (visible.fxMissing) tr.className = "needs-verification";
      tr.appendChild(renderCell(doc, visible.channel));
      tr.appendChild(renderCell(doc, formatUsdCell(visible.openingUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatUsdCell(visible.closingUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatUsdCell(visible.changeUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatUsdCell(visible.movementUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatUsdCell(visible.diffUsd), "numeric"));
      tbody.appendChild(tr);
    });

    const total = doc.createElement("tr");
    total.className = "balance-income-channel-total";
    total.appendChild(renderCell(doc, "ВСЕГО USD"));
    total.appendChild(renderCell(doc, formatMoney(totals.openingUsd), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(totals.closingUsd), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(totals.changeUsd), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(totals.movementUsd), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(totals.diffUsd), "numeric"));
    tbody.appendChild(total);
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);

    if (totals.fxMissingCount) {
      const note = doc.createElement("div");
      note.className = "balance-summary-diagnostics";
      note.textContent = `fx_missing: ${totals.fxMissingCount} row(s) excluded from ВСЕГО USD.`;
      section.appendChild(note);
    }
    return section;
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
        const nextSummary = await buildLiveRemaindersSummary(result.audit_snapshot || {});
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

    block.appendChild(renderDefaultUsdBalancesTable(summary, doc));

    const details = doc.createElement("details");
    details.className = "remainders-diagnostics-details";
    details.open = false;
    const detailsSummary = doc.createElement("summary");
    detailsSummary.textContent = "Диагностика сверки";
    details.appendChild(detailsSummary);
    block.appendChild(details);

    const selectedDateBlock = renderSelectedDateSnapshotBlock(summary.selectedDateSnapshot, doc);
    if (selectedDateBlock) details.appendChild(selectedDateBlock);
    const periodChangesBlock = renderPeriodBalanceChangesBlock(summary.selectedDateSnapshot, summary.periodMovementRows || [], doc);
    if (periodChangesBlock) details.appendChild(periodChangesBlock);

    const wrap = doc.createElement("div");
    wrap.className = "table-wrap remainders-summary-table-wrap";
    details.appendChild(renderRemaindersScrollControls(wrap, doc));
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
    details.appendChild(wrap);

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
      details.appendChild(note);
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

  const api = {
    REMAINDERS_BUTTON_ID,
    REMAINDERS_BLOCK_ID,
    buildRemaindersSummary,
    buildLiveRemaindersSummary,
    buildPeriodBalanceChangeRows,
    getSnapshotAmount,
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
