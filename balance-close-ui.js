(function initBalanceCloseUi(root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.EzohataBalanceCloseUi = api;
    if (typeof root.document !== "undefined") api.installBalanceCloseUi(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createBalanceCloseUi(root) {
  const BLOCK_TITLE = "Balance Close";

  function installBalanceCloseUi(globalRoot = root) {
    const original = globalRoot.renderExpenseFinancialAnalysis;
    if (typeof original !== "function" || original.__balanceCloseWrapped) return false;
    function wrappedRenderExpenseFinancialAnalysis() {
      const block = original.apply(this, arguments);
      try {
        const node = renderPlaceholder(globalRoot.document);
        block.appendChild(node);
        loadAndRender(globalRoot, node);
      } catch (error) {}
      return block;
    }
    wrappedRenderExpenseFinancialAnalysis.__balanceCloseWrapped = true;
    globalRoot.renderExpenseFinancialAnalysis = wrappedRenderExpenseFinancialAnalysis;
    return true;
  }

  async function loadAndRender(globalRoot, container) {
    try {
      const snapshot = await fetchSnapshot(globalRoot);
      container.replaceWith(renderBalanceCloseBlock(globalRoot.document, snapshot));
    } catch (error) {
      container.replaceWith(renderError(globalRoot.document, error));
    }
  }

  async function fetchSnapshot(globalRoot = root) {
    const doc = globalRoot.document;
    const params = new URLSearchParams();
    const from = String(doc?.getElementById("startDate")?.value || "").trim();
    const to = String(doc?.getElementById("endDate")?.value || "").trim();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const response = await globalRoot.fetch(`/api/audit-snapshot${params.toString() ? `?${params}` : ""}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }

  function buildBalanceCloseFromSnapshot(snapshot = {}) {
    if (snapshot.balance_close) return snapshot.balance_close;
    const fixes = snapshot.balance_fixes || {};
    const coverage = snapshot.balance_coverage || {};
    const summary = coverage.summary || {};
    const missingNet = Array.isArray(fixes.missing_amount_net_rows) ? fixes.missing_amount_net_rows.length : 0;
    const missingBalances = Array.isArray(fixes.missing_ostatki_rows) ? fixes.missing_ostatki_rows.length : 0;
    const mismatches = Number(summary.mismatch || 0);
    const verifyRows = Number(summary.needs_verification || 0);
    const hard = missingNet + missingBalances + mismatches;
    const canClose = hard === 0 && verifyRows === 0;
    const status = canClose ? "closable" : (hard ? "blocked" : "needs_verification");
    return {
      status,
      can_close: canClose,
      blocking_counts: {
        missing_amount_net_rows: missingNet,
        missing_ostatki_rows: missingBalances,
        mismatch_rows: mismatches,
        needs_verification_rows: verifyRows,
      },
      steps: [
        makeStep("amount_net", "Ledger amount_net", missingNet),
        makeStep("balances", "Factual balances", missingBalances),
        makeStep("mismatch", "Mismatches", mismatches),
        makeStep("verification", "Final review", verifyRows, canClose),
      ],
      message: makeMessage(status, missingNet, missingBalances, mismatches, verifyRows),
    };
  }

  function makeStep(name, label, count, canClose = false) {
    return { name, label, count, status: count ? "blocked" : (canClose ? "ok" : "ok"), action: count ? "Resolve before close" : "OK" };
  }

  function makeMessage(status, missingNet, missingBalances, mismatches, verifyRows) {
    if (status === "closable") return "Can close: all balances are reconciled.";
    if (status === "needs_verification") return `Needs review: ${verifyRows} rows require verification.`;
    const parts = [];
    if (missingNet) parts.push(`${missingNet} missing amount_net`);
    if (missingBalances) parts.push(`${missingBalances} missing factual balances`);
    if (mismatches) parts.push(`${mismatches} mismatches`);
    return `Cannot close: ${parts.join(", ")}.`;
  }

  function renderPlaceholder(doc) {
    const section = createSection(doc);
    const div = doc.createElement("div");
    div.className = "config-note";
    div.textContent = "Loading balance close status...";
    section.appendChild(div);
    return section;
  }

  function renderError(doc, error) {
    const section = createSection(doc);
    const div = doc.createElement("div");
    div.className = "finance-status error";
    div.textContent = `Balance close unavailable: ${String(error?.message || error || "unknown error")}`;
    section.appendChild(div);
    return section;
  }

  function renderBalanceCloseBlock(doc, snapshot) {
    const close = buildBalanceCloseFromSnapshot(snapshot);
    const section = createSection(doc);
    const status = doc.createElement("div");
    status.className = close.can_close ? "finance-status" : "finance-status error";
    status.textContent = `${getCloseStatusLabel(close.status)}. ${close.message}`;
    section.appendChild(status);
    const wrap = doc.createElement("div");
    wrap.className = "table-wrap balance-close-table-wrap";
    wrap.appendChild(renderTable(doc, buildCloseTableValues(close)));
    section.appendChild(wrap);
    return section;
  }

  function createSection(doc) {
    const section = doc.createElement("section");
    section.className = "finance-analysis-section balance-close-section";
    const title = doc.createElement("h3");
    title.textContent = BLOCK_TITLE;
    section.appendChild(title);
    return section;
  }

  function buildCloseTableValues(close = {}) {
    return [["Step", "Status", "Count", "Action"], ...(close.steps || []).map((s) => [s.label, getStepStatusLabel(s.status), String(Number(s.count || 0)), s.action])];
  }

  function renderTable(doc, rows) {
    const table = doc.createElement("table");
    const tbody = doc.createElement("tbody");
    rows.forEach((row, index) => {
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

  function getCloseStatusLabel(status) {
    if (status === "closable") return "Status: can close";
    if (status === "needs_verification") return "Status: needs review";
    return "Status: cannot close";
  }

  function getStepStatusLabel(status) {
    if (status === "ok") return "OK";
    if (status === "needs_verification") return "Needs review";
    return "Blocks close";
  }

  return { BLOCK_TITLE, installBalanceCloseUi, buildBalanceCloseFromSnapshot, buildCloseTableValues, getCloseStatusLabel, getStepStatusLabel, renderBalanceCloseBlock };
});
