// ============================================================
// GROUPED ORDER BALANCE DISPLAY FIX
// ============================================================
// Display-only movement table normalizer.
//
// Existing movement rows are calculated independently. Some orders are split
// across adjacent rows for the same client/date, while the payment is recorded
// on one row of the group. That can show one overpaid row and positive sibling
// balances even when the adjacent group is fully paid. This normalizer first
// applies the existing display semantics `fact - plan`, then zeroes row balances
// only when the adjacent same-client/date group already nets to zero.

(function attachGroupedOrderBalanceFix(root) {
  if (!root) return;

  function normalizeNumberText(value) {
    return String(value ?? "").trim().replace(/\s+/g, "");
  }

  function parseLooseNumber(value) {
    const normalized = normalizeNumberText(value)
      .replace(/,/g, ".")
      .replace(/[^0-9.+-]/g, "");
    if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatLikePrevious(value, previousText = "") {
    const decimals = (String(previousText).split(/[,.]/)[1] || "").replace(/[^0-9]/g, "").length;
    const safeDecimals = Math.min(Math.max(decimals || 4, 0), 6);
    return Number(value || 0).toFixed(safeDecimals).replace(".", ",");
  }

  function normalizeLookupText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function collectElements(node, predicate, matches = []) {
    if (!node) return matches;
    if (predicate(node)) matches.push(node);
    const children = Array.isArray(node.children) ? node.children : Array.from(node.children || []);
    children.forEach((child) => collectElements(child, predicate, matches));
    return matches;
  }

  function queryAll(node, selector) {
    if (!node) return [];
    if (typeof node.querySelectorAll === "function") return Array.from(node.querySelectorAll(selector));
    const tagName = String(selector || "").trim().toUpperCase();
    if (!tagName || /[^A-Z0-9-]/.test(tagName)) return [];
    return collectElements(node, (item) => String(item.tagName || "").toUpperCase() === tagName);
  }

  function findColumnByAliases(cells, aliases) {
    const normalizedAliases = (aliases || []).map(normalizeLookupText).filter(Boolean);
    const normalizedCells = (cells || []).map((cell) => normalizeLookupText(cell?.textContent ?? cell));
    for (const alias of normalizedAliases) {
      const exactIndex = normalizedCells.findIndex((text) => text === alias);
      if (exactIndex !== -1) return exactIndex;
    }
    for (const alias of normalizedAliases) {
      const partialIndex = normalizedCells.findIndex((text) => text && text.includes(alias));
      if (partialIndex !== -1) return partialIndex;
    }
    return -1;
  }

  function findColumnIndexesByAliases(cells, aliases) {
    const normalizedAliases = (aliases || []).map(normalizeLookupText).filter(Boolean);
    const normalizedCells = (cells || []).map((cell) => normalizeLookupText(cell?.textContent ?? cell));
    const indexes = [];
    normalizedCells.forEach((text, index) => {
      if (!text) return;
      if (normalizedAliases.some((alias) => text === alias || text.includes(alias))) indexes.push(index);
    });
    return indexes;
  }

  function rowCells(row) {
    return Array.from(row?.children || []);
  }

  function isNumericOrderRow(row, numberIndex) {
    const value = rowCells(row)[numberIndex]?.textContent;
    return /^\d+$/.test(String(value || "").trim());
  }

  function findHeaderRow(rows) {
    for (let index = 0; index < rows.length; index += 1) {
      const cells = rowCells(rows[index]);
      if (!cells.length) continue;
      const numberIndex = findColumnByAliases(cells, ["number", "номер"]);
      const clientIndex = findColumnByAliases(cells, ["client", "клиент", "имя"]);
      const balanceIndex = findColumnByAliases(cells, ["balance", "баланс", "остаток"]);
      if (numberIndex !== -1 && clientIndex !== -1 && balanceIndex !== -1) {
        return { rowIndex: index, cells };
      }
    }
    return null;
  }

  function groupKey(row, dateIndex, clientIndex) {
    const cells = rowCells(row);
    const date = normalizeLookupText(cells[dateIndex]?.textContent);
    const client = normalizeLookupText(cells[clientIndex]?.textContent);
    return date && client ? `${date}|${client}` : "";
  }

  function appendReviewNote(row, reviewIndex, note) {
    if (reviewIndex === -1) return;
    const cells = rowCells(row);
    const reviewCell = cells[reviewIndex];
    if (!reviewCell) return;
    const current = String(reviewCell.textContent || "").trim();
    if (current.includes(note)) return;
    reviewCell.textContent = current ? `${current} | ${note}` : note;
  }

  function firstParsedNumber(cells, indexes, fallback = null) {
    for (const index of indexes || []) {
      const parsed = parseLooseNumber(cells[index]?.textContent);
      if (parsed !== null) return parsed;
    }
    return fallback;
  }

  function findPrioritizedActualUsdIndexes(headerCells, balanceIndex) {
    const groups = [
      findColumnIndexesByAliases(headerCells, [
        "дошло до нас usd",
        "net received usd",
        "received net usd"
      ]),
      findColumnIndexesByAliases(headerCells, [
        "оплачено клиентом usd",
        "client paid usd",
        "paid by client usd"
      ]),
      findColumnIndexesByAliases(headerCells, [
        "получено в долларах",
        "received total usd",
        "total received usd",
        "received usd",
        "paid usd",
        "actual usd",
        "fact usd"
      ])
    ];
    return groups
      .map((indexes) => indexes.filter((index) => balanceIndex === -1 || index < balanceIndex))
      .filter((indexes) => indexes.length);
  }

  function selectActualUsd(cells, prioritizedIndexGroups, fallback = null) {
    for (const indexes of prioritizedIndexGroups || []) {
      const parsed = firstParsedNumber(cells, indexes, null);
      if (parsed !== null) return parsed;
    }
    return fallback;
  }

  function groupZeroTolerance(planTotal) {
    const plan = Math.abs(Number(planTotal) || 0);
    return Math.max(0.02, Math.min(2.5, plan * 0.02));
  }

  function normalizeGroupedOrderBalanceTables(rootNode = root.document) {
    const tables = queryAll(rootNode, "table");
    let changed = 0;
    tables.forEach((table) => {
      const rows = queryAll(table, "tr");
      if (rows.length < 3) return;
      const header = findHeaderRow(rows);
      if (!header) return;
      const headerCells = header.cells;

      const numberIndex = findColumnByAliases(headerCells, ["number", "номер"]);
      const dateIndex = findColumnByAliases(headerCells, ["date", "дата"]);
      const clientIndex = findColumnByAliases(headerCells, ["client", "клиент", "имя"]);
      const planIndex = findColumnByAliases(headerCells, [
        "accrued +3%", "70% of +3%", "план", "planned", "plan", "accrued", "стоимость", "cost"
      ]);
      const balanceIndex = findColumnByAliases(headerCells, ["balance", "баланс", "остаток"]);
      const reviewIndex = findColumnByAliases(headerCells, ["review note", "комментарий", "note"]);
      const actualIndexGroups = findPrioritizedActualUsdIndexes(headerCells, balanceIndex);
      if ([numberIndex, dateIndex, clientIndex, planIndex, balanceIndex].some((index) => index === -1) || !actualIndexGroups.length) return;

      const totalRowIndex = rows.findIndex((row, index) => {
        if (index <= header.rowIndex) return false;
        return normalizeLookupText(rowCells(row)[numberIndex]?.textContent) === "итого";
      });
      const candidateRows = totalRowIndex === -1
        ? rows.slice(header.rowIndex + 1)
        : rows.slice(header.rowIndex + 1, totalRowIndex);
      const dataRows = candidateRows.filter((row) => isNumericOrderRow(row, numberIndex));
      if (!dataRows.length) return;

      dataRows.forEach((row) => {
        const cells = rowCells(row);
        const plan = parseLooseNumber(cells[planIndex]?.textContent);
        const actual = selectActualUsd(cells, actualIndexGroups, 0);
        const balanceCell = cells[balanceIndex];
        if (plan === null || actual === null || !balanceCell) return;
        const previousText = String(balanceCell.textContent || "");
        const nextText = formatLikePrevious(actual - plan, previousText);
        balanceCell.dataset = balanceCell.dataset || {};
        balanceCell.dataset.displaySignNormalized = "movement-fact-minus-plan";
        if (previousText !== nextText) {
          balanceCell.textContent = nextText;
          changed += 1;
        }
      });

      let index = 0;
      while (index < dataRows.length) {
        const key = groupKey(dataRows[index], dateIndex, clientIndex);
        if (!key) {
          index += 1;
          continue;
        }
        const group = [dataRows[index]];
        index += 1;
        while (index < dataRows.length && groupKey(dataRows[index], dateIndex, clientIndex) === key) {
          group.push(dataRows[index]);
          index += 1;
        }
        if (group.length < 3) continue;

        const balances = group.map((row) => parseLooseNumber(rowCells(row)[balanceIndex]?.textContent));
        if (balances.some((value) => value === null)) continue;
        const sum = balances.reduce((acc, value) => acc + value, 0);
        const planTotal = group.reduce((acc, row) => acc + (parseLooseNumber(rowCells(row)[planIndex]?.textContent) || 0), 0);
        const hasPositive = balances.some((value) => value > 0.01);
        const hasNegative = balances.some((value) => value < -0.01);
        if (Math.abs(sum) > groupZeroTolerance(planTotal) || !hasPositive || !hasNegative) continue;

        group.forEach((row) => {
          const balanceCell = rowCells(row)[balanceIndex];
          if (!balanceCell) return;
          const previousText = String(balanceCell.textContent || "");
          const nextText = formatLikePrevious(0, previousText);
          balanceCell.dataset = balanceCell.dataset || {};
          balanceCell.dataset.displaySignNormalized = "grouped-order-zero-balance";
          if (previousText !== nextText) {
            balanceCell.textContent = nextText;
            changed += 1;
          }
          appendReviewNote(row, reviewIndex, "group balance reconciled");
        });
      }

      if (totalRowIndex !== -1) {
        const totalCells = rowCells(rows[totalRowIndex]);
        const totalBalanceCell = totalCells[balanceIndex];
        if (!totalBalanceCell) return;
        const visibleRowsSum = dataRows.reduce((sum, row) => {
          const value = parseLooseNumber(rowCells(row)[balanceIndex]?.textContent);
          return value === null ? sum : sum + value;
        }, 0);
        const previousText = String(totalBalanceCell.textContent || "");
        const nextText = formatLikePrevious(visibleRowsSum, previousText);
        totalBalanceCell.dataset = totalBalanceCell.dataset || {};
        totalBalanceCell.dataset.displaySignNormalized = "grouped-order-total-visible-rows";
        if (previousText !== nextText) {
          totalBalanceCell.textContent = nextText;
          changed += 1;
        }
      }
    });
    return changed;
  }

  function installGroupedOrderBalanceFix() {
    const target = root.document?.getElementById?.("tabPanels") || root.document?.body;
    if (!target) return;
    target.dataset = target.dataset || {};
    // Prevent the older movement observer from installing and fighting this combined normalizer.
    target.dataset.movementBalanceDisplayObserver = "true";
    if (target.dataset.groupedOrderBalanceObserver === "true") return;
    target.dataset.groupedOrderBalanceObserver = "true";

    let normalizeScheduled = false;
    let isNormalizing = false;

    function runNormalize() {
      normalizeScheduled = false;
      if (isNormalizing) return;
      isNormalizing = true;
      try {
        normalizeGroupedOrderBalanceTables(target);
      } finally {
        isNormalizing = false;
      }
    }

    function scheduleNormalize() {
      if (normalizeScheduled || isNormalizing) return;
      normalizeScheduled = true;
      if (typeof root.requestAnimationFrame === "function") {
        root.requestAnimationFrame(runNormalize);
      } else {
        setTimeout(runNormalize, 0);
      }
    }

    runNormalize();

    const Observer = root.MutationObserver || globalThis.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(scheduleNormalize);
    observer.observe(target, { childList: true, subtree: true });
  }

  root.EzohataGroupedOrderBalanceFix = {
    install: installGroupedOrderBalanceFix,
    normalizeGroupedOrderBalanceTables,
  };

  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", installGroupedOrderBalanceFix, { once: true });
  } else {
    installGroupedOrderBalanceFix();
  }
})(typeof window !== "undefined" ? window : globalThis);
