(function compactPaymentGapDiagnostics(root) {
  "use strict";

  const DETAIL_ROW_SELECTOR = ".balance-service-payment-gap-detail";
  const SOURCE_ROW_SELECTOR = ".balance-service-payment-gap-source-row";
  const PROCESSED_FLAG = "ezohataPaymentGapCompacted";
  const CANONICAL_PAID_DIAGNOSTIC = "needs verification: totalPaid metrics differed from actual payments by channel; using actual payments by channel as canonical paid total.";

  function splitList(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function shortenItems(items, limit = 6) {
    if (!items.length) return "";
    if (items.length <= limit) return items.join(", ");
    return items.slice(0, limit).join(", ") + "… (+" + (items.length - limit) + ")";
  }

  function parseNumber(value) {
    if (typeof root.parseLooseNumber === "function") {
      const parsed = root.parseLooseNumber(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isActualPaymentsDistribution(distribution = {}) {
    const source = String(distribution.source || "");
    const title = String(distribution.title || "");
    return source === "realIncome.actualPaymentSummaryByChannel" || title === "Факт оплат по каналам";
  }

  function applyCanonicalPaidSummary(summary = {}) {
    const distribution = summary.incomeChannelDistribution || null;
    const canonicalPaid = parseNumber(distribution?.total);
    if (!distribution || !isActualPaymentsDistribution(distribution) || canonicalPaid <= 0) return summary;
    const currentPaid = parseNumber(summary.totalPaid);
    const totalAccrued = parseNumber(summary.totalAccrued);
    const next = {
      ...summary,
      totalPaid: canonicalPaid,
      remainingToPay: totalAccrued - canonicalPaid,
      diagnostics: Array.isArray(summary.diagnostics) ? [...summary.diagnostics] : [],
      sources: {
        ...(summary.sources || {}),
        totalPaid: "realIncome.actualPaymentSummaryByChannel",
      },
    };
    if (Math.abs(currentPaid - canonicalPaid) > 0.0001 && !next.diagnostics.includes(CANONICAL_PAID_DIAGNOSTIC)) {
      next.diagnostics.push(CANONICAL_PAID_DIAGNOSTIC);
    }
    return next;
  }

  function patchCanonicalPaidSummary() {
    const api = root.EzohataBalanceSummaryPopup;
    if (!api || api.__ezohataCanonicalPaidPatched || typeof api.buildBalanceTextSummary !== "function") return false;
    const originalBuild = api.buildBalanceTextSummary;
    api.buildBalanceTextSummary = function buildBalanceTextSummaryWithCanonicalPaid() {
      return applyCanonicalPaidSummary(originalBuild.apply(this, arguments));
    };
    api.__ezohataCanonicalPaidPatched = true;
    return true;
  }

  function replaceExistingSummaryBlock(doc = root.document) {
    patchCanonicalPaidSummary();
    const api = root.EzohataBalanceSummaryPopup;
    const blockId = api?.BALANCE_BLOCK_ID || "balanceSummaryBlock";
    const existing = doc?.getElementById?.(blockId);
    if (!existing || typeof api?.buildBalanceTextSummary !== "function" || typeof api?.renderBalanceSummaryBlock !== "function") return false;
    const next = api.renderBalanceSummaryBlock(api.buildBalanceTextSummary(), doc);
    existing.parentNode?.replaceChild?.(next, existing);
    return true;
  }

  function compactSourceSummary(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "source rows missing from API — needs verification") return raw;
    const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);
    const next = [];
    parts.forEach((part) => {
      const match = part.match(/^(rows|dates|client):\s*(.+)$/i);
      if (!match) {
        next.push(part);
        return;
      }
      const key = match[1].toLowerCase();
      const valuePart = match[2];
      if (key === "rows") next.push("rows: " + shortenItems(splitList(valuePart), 8));
      else if (key === "dates") next.push("dates: " + shortenItems(splitList(valuePart), 5));
      else next.push(part);
    });
    return next.join("; ");
  }

  function extractField(text, label) {
    const pattern = new RegExp(label + "\\s+([^;]+)", "i");
    return String(text || "").match(pattern)?.[1]?.trim() || "";
  }

  function extractStatus(text) {
    const explicit = extractField(text, "status/reviewNote");
    if (!explicit || explicit === "-") return "";
    return explicit.split(";").map((part) => part.trim()).filter(Boolean)[0] || explicit;
  }

  function compactDetailText(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    const row = extractField(text, "row/order") || "-";
    const date = extractField(text, "date") || "-";
    const accrued = extractField(text, "accrued") || "-";
    const paid = extractField(text, "client paid") || "-";
    const providerNet = extractField(text, "provider net");
    const included = extractField(text, "included");
    const reason = extractField(text, "reason") || "-";
    const status = extractStatus(text);
    const netOrIncluded = providerNet ? "provider net " + providerNet : "included " + (included || "-");
    return [
      row,
      date,
      "accrued " + accrued,
      "paid " + paid,
      netOrIncluded,
      status || reason,
    ].filter(Boolean).join(" · ");
  }

  function compactAggregateRow(detailRow) {
    const aggregateRow = detailRow?.previousElementSibling;
    if (!aggregateRow || aggregateRow.dataset?.[PROCESSED_FLAG] === "1") return;
    const cells = aggregateRow.querySelectorAll?.("td") || [];
    if (cells.length >= 4) cells[3].textContent = compactSourceSummary(cells[3].textContent);
    aggregateRow.dataset[PROCESSED_FLAG] = "1";
  }

  function compactDetailRow(detailRow, doc = root.document) {
    if (!detailRow || detailRow.dataset?.[PROCESSED_FLAG] === "1") return;
    const cell = detailRow.querySelector?.("td");
    if (!cell) return;
    const sourceNodes = Array.from(cell.querySelectorAll?.(SOURCE_ROW_SELECTOR) || []);
    const rawLines = sourceNodes.length
      ? sourceNodes.map((node) => node.textContent || "").filter(Boolean)
      : [cell.textContent || ""].filter(Boolean);
    const count = rawLines.length;
    cell.textContent = "";

    const details = doc.createElement("details");
    details.className = "balance-service-payment-gap-compact-details";
    const summary = doc.createElement("summary");
    summary.textContent = count ? "Показать строки (" + count + ")" : "Показать строки";
    details.appendChild(summary);

    if (!count) {
      const empty = doc.createElement("div");
      empty.className = "balance-service-payment-gap-source-row compact";
      empty.textContent = "source rows missing from API — needs verification";
      details.appendChild(empty);
    } else {
      rawLines.forEach((rawLine) => {
        const line = doc.createElement("div");
        line.className = "balance-service-payment-gap-source-row compact";
        line.textContent = compactDetailText(rawLine);
        line.title = rawLine;
        details.appendChild(line);
      });
    }

    cell.appendChild(details);
    detailRow.dataset[PROCESSED_FLAG] = "1";
  }

  function compactPaymentGapBlock(doc = root.document) {
    if (!doc?.querySelectorAll) return;
    Array.from(doc.querySelectorAll(DETAIL_ROW_SELECTOR)).forEach((detailRow) => {
      compactAggregateRow(detailRow);
      compactDetailRow(detailRow, doc);
    });
  }

  function loadCoverageOrdersDiffEnhancer(doc = root.document) {
    if (!doc?.createElement || doc.querySelector?.('script[src="./balance-coverage-orders-diff-ui.js"]')) return;
    const script = doc.createElement("script");
    script.src = "./balance-coverage-orders-diff-ui.js";
    script.defer = true;
    (doc.head || doc.body)?.appendChild?.(script);
  }

  function start() {
    const doc = root.document;
    patchCanonicalPaidSummary();
    loadCoverageOrdersDiffEnhancer(doc);
    compactPaymentGapBlock(doc);
    doc?.getElementById?.("balanceLauncherButton")?.addEventListener?.("click", () => root.setTimeout?.(() => replaceExistingSummaryBlock(doc), 0));
    if (typeof root.renderMetrics === "function" && !root.renderMetrics.__ezohataCanonicalPaidCompactedPatched) {
      const original = root.renderMetrics;
      root.renderMetrics = function renderMetricsWithCanonicalPaidCompact() {
        const result = original.apply(this, arguments);
        root.setTimeout?.(() => replaceExistingSummaryBlock(doc), 0);
        return result;
      };
      root.renderMetrics.__ezohataCanonicalPaidCompactedPatched = true;
    }
    root.setTimeout?.(() => replaceExistingSummaryBlock(doc), 0);
    if (!doc?.body || typeof root.MutationObserver !== "function") return;
    const observer = new root.MutationObserver(() => compactPaymentGapBlock(doc));
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  const api = {
    applyCanonicalPaidSummary,
    compactPaymentGapBlock,
    patchCanonicalPaidSummary,
    replaceExistingSummaryBlock,
    start,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EzohataPaymentGapCompact = api;
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof globalThis !== "undefined" ? globalThis : window);
