(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.EzohataManualFinanceFormulas = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function defaultParseLooseNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function defaultRoundTo2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function isManualFinanceFormula(value) {
    return /^\s*=/.test(String(value ?? ""));
  }

  function evaluateManualFinanceFormula(rawValue, rows, options = {}, visited = new Set()) {
    const raw = String(rawValue ?? "").trim();
    if (!isManualFinanceFormula(raw)) return null;
    const normalized = raw.replace(/\s+/g, "").replace(/,/g, ".").replace(/^=/, "");
    if (!normalized) return null;

    const formulaKeyByColumn = options.formulaKeyByColumn || {};
    const formulaRowOffset = Number.isFinite(options.formulaRowOffset) ? options.formulaRowOffset : 0;
    const expression = normalized.replace(/\$?([A-Z]+)\$?(\d+)/gi, (_, column, rowNumber) => {
      const key = formulaKeyByColumn[String(column || "").toUpperCase()];
      const targetIndex = Number(rowNumber) - formulaRowOffset;
      if (!key || !Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= rows.length) return "0";
      return String(evaluateManualFinanceCellNumericValue(rows, targetIndex, key, options, visited));
    });

    if (!/^[\d.+\-*/()]+$/.test(expression) || !/\d/.test(expression)) return null;

    try {
      const numeric = Function('"use strict"; return (' + expression + ');')();
      return Number.isFinite(numeric) ? numeric : null;
    } catch {
      return null;
    }
  }

  function evaluateManualFinanceCellNumericValue(rows, rowIndex, key, options = {}, visited = new Set()) {
    const row = rows?.[rowIndex];
    if (!row) return 0;
    const cellId = `${rowIndex}:${key}`;
    if (visited.has(cellId)) return 0;

    const nextVisited = new Set(visited);
    nextVisited.add(cellId);
    const evaluated = evaluateManualFinanceFormula(row[key], rows, options, nextVisited);
    if (evaluated !== null) return evaluated;

    const parseLooseNumber = options.parseLooseNumber || defaultParseLooseNumber;
    return parseLooseNumber(row[key]);
  }

  function normalizeManualFinancePersistedNumberInput(value, options = {}) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const roundTo2 = options.roundTo2 || defaultRoundTo2;
    if (isManualFinanceFormula(raw)) {
      const rows = Array.isArray(options.rows) ? options.rows : [];
      const evaluated = evaluateManualFinanceFormula(raw, rows, options);
      if (evaluated === null || !Number.isFinite(evaluated)) return "";
      return String(roundTo2(evaluated));
    }

    const parseLooseNumber = options.parseLooseNumber || defaultParseLooseNumber;
    const parsed = parseLooseNumber(raw);
    return Number.isFinite(parsed) ? String(roundTo2(parsed)) : "";
  }

  return {
    isManualFinanceFormula,
    evaluateManualFinanceFormula,
    evaluateManualFinanceCellNumericValue,
    normalizeManualFinancePersistedNumberInput,
  };
});
