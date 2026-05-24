(function initRemaindersSummaryPopup(root) {
  "use strict";

  const BALANCE_BUTTON_ID = "balanceLauncherButton";
  const REMAINDERS_BUTTON_ID = "remaindersLauncherButton";
  const REMAINDERS_BLOCK_ID = "remaindersSummaryBlock";
  const NEEDS_VERIFICATION = "needs verification";

  const CHANNEL_FIELDS = ["channel", "account", "wallet", "name", "payment_channel", "paymentChannel", "to_channel", "toChannel"];
  const OPENING_FIELDS = ["opening_amount_usd", "openingUsd", "start_amount_usd", "startUsd", "balance_start_usd", "startBalanceUsd", "opening_balance_usd"];
  const CLOSING_FIELDS = ["closing_amount_usd", "closingUsd", "end_amount_usd", "endUsd", "balance_end_usd", "endBalanceUsd", "closing_balance_usd"];
  const DELTA_FIELDS = ["delta_amount_usd", "deltaUsd", "change_usd", "changeUsd", "movement_usd"];

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
    const openingUsd = parseNumber(firstDefined(row, OPENING_FIELDS));
    const closingUsd = parseNumber(firstDefined(row, CLOSING_FIELDS));
    const fallbackDeltaUsd = parseNumber(firstDefined(row, DELTA_FIELDS));
    const deltaUsd = openingUsd !== null && closingUsd !== null ? closingUsd - openingUsd : fallbackDeltaUsd;
    const needsVerification = openingUsd === null || closingUsd === null || deltaUsd === null;
    return { channel, openingUsd, closingUsd, deltaUsd, needsVerification };
  }

  function buildRemaindersSummary(input, options = {}) {
    const { source, rows } = resolveRemaindersRows(input, options);
    const normalizedRows = rows.map(normalizeRemaindersRow);
    const completeRows = normalizedRows.filter((row) => !row.needsVerification);
    const totals = completeRows.reduce((sum, row) => ({
      openingUsd: sum.openingUsd + row.openingUsd,
      closingUsd: sum.closingUsd + row.closingUsd,
      deltaUsd: sum.deltaUsd + row.deltaUsd,
    }), { openingUsd: 0, closingUsd: 0, deltaUsd: 0 });
    const needsVerificationCount = normalizedRows.length - completeRows.length;
    return {
      source,
      rows: normalizedRows,
      totals,
      needsVerificationCount,
      diagnostics: source ? [] : [`${NEEDS_VERIFICATION}: source not found for remainders summary.`],
    };
  }

  function getDateInputValue(id) {
    const fromElements = root.elements?.[id]?.value;
    if (fromElements) return fromElements;
    return root.document?.getElementById?.(id)?.value || "";
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

  async function fetchAuditSnapshotRemainders() {
    if (typeof root.fetch !== "function") return null;
    const response = await root.fetch(buildAuditSnapshotUrl().toString(), { cache: "no-store" });
    if (!response?.ok) throw new Error(`audit snapshot returned ${response?.status || "unknown status"}`);
    return response.json();
  }

  async function buildLiveRemaindersSummary(input, options = {}) {
    const current = buildRemaindersSummary(input, options);
    if (current.source && current.rows.length) return current;
    try {
      const snapshot = await fetchAuditSnapshotRemainders();
      if (!snapshot) return current;
      const fetched = buildRemaindersSummary(snapshot);
      return fetched.source ? fetched : current;
    } catch (error) {
      return {
        ...current,
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

  function renderRemaindersSummaryBlock(summary, doc = root.document) {
    const block = doc.createElement("div");
    block.id = REMAINDERS_BLOCK_ID;
    block.className = "balance-summary-block remainders-summary-block";
    block.setAttribute("aria-live", "polite");

    const title = doc.createElement("h3");
    title.textContent = "Остатки по каналам";
    block.appendChild(title);

    const wrap = doc.createElement("div");
    wrap.className = "table-wrap remainders-summary-table-wrap";
    const table = doc.createElement("table");
    const thead = doc.createElement("thead");
    const header = doc.createElement("tr");
    ["Канал", "Было на начало периода, USD", "Стало на конец периода, USD", "Изменение, USD"].forEach((label) => {
      header.appendChild(renderHeaderCell(doc, label));
    });
    thead.appendChild(header);
    table.appendChild(thead);

    const tbody = doc.createElement("tbody");
    summary.rows.forEach((row) => {
      const tr = doc.createElement("tr");
      if (row.needsVerification) tr.className = "needs-verification";
      tr.appendChild(renderCell(doc, row.channel));
      tr.appendChild(renderCell(doc, formatMoney(row.openingUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatMoney(row.closingUsd), "numeric"));
      tr.appendChild(renderCell(doc, formatMoney(row.deltaUsd), "numeric"));
      tbody.appendChild(tr);
    });

    const total = doc.createElement("tr");
    total.className = "balance-income-channel-total";
    total.appendChild(renderCell(doc, "ИТОГО"));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.totals.openingUsd : null), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.totals.closingUsd : null), "numeric"));
    total.appendChild(renderCell(doc, formatMoney(summary.rows.length ? summary.totals.deltaUsd : null), "numeric"));
    tbody.appendChild(total);
    table.appendChild(tbody);
    wrap.appendChild(table);
    block.appendChild(wrap);

    const diagnostics = [...(summary.diagnostics || [])];
    if (summary.needsVerificationCount) {
      diagnostics.push(`${NEEDS_VERIFICATION}: ${summary.needsVerificationCount} row(s) have missing opening/closing USD values.`);
    }
    if (diagnostics.length) {
      const note = doc.createElement("div");
      note.className = "balance-summary-diagnostics";
      note.textContent = diagnostics.join(" ");
      block.appendChild(note);
    }
    return block;
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
    renderRemaindersSummaryBlock,
    bindRemaindersLauncherButton,
    startRemaindersSummary,
    updateRemaindersSummaryBlock,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataRemaindersSummaryPopup = api;
  startRemaindersSummary();
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", startRemaindersSummary);
})(typeof globalThis !== "undefined" ? globalThis : window);
