(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.EzohataOrdersHelper = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SIMPLE_HEADERS = ["ДАТА", "ИМЯ", "ЗАКАЗ", "СТОИМОСТЬ"];
  const SIMPLE_WIDTH = SIMPLE_HEADERS.length;

  function normalizeCell(value) {
    return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  }

  function padRow(row, width) {
    const output = (Array.isArray(row) ? row : []).slice(0, width);
    while (output.length < width) output.push("");
    return output;
  }

  function normalizeDate(value, fallbackYearSource) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split("-");
      return `${day}.${month}.${year}`;
    }
    const shortMatch = raw.match(/^(\d{1,2})[/.](\d{1,2})$/);
    if (shortMatch) {
      const year = inferYear(fallbackYearSource);
      return `${String(shortMatch[1]).padStart(2, "0")}.${String(shortMatch[2]).padStart(2, "0")}.${year}`;
    }
    return raw;
  }

  function inferYear(value) {
    const raw = String(value || "").trim();
    const iso = raw.match(/^(\d{4})-\d{2}-\d{2}$/);
    if (iso) return iso[1];
    const ru = raw.match(/^\d{2}\.\d{2}\.(\d{4})$/);
    if (ru) return ru[1];
    return String(new Date().getFullYear());
  }

  function parseLooseNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value) {
    const numeric = typeof value === "number" ? value : parseLooseNumber(value);
    if (!Number.isFinite(numeric)) return "";
    return String(Math.round(numeric * 10000) / 10000).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function extractTrailingCost(text) {
    const raw = String(text || "").trim();
    if (!raw) return { text: "", cost: "" };
    const matches = [...raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?!.*\d)/g)];
    const last = matches[matches.length - 1];
    if (!last) return { text: raw, cost: "" };
    const cost = formatNumber(last[1]);
    const cleaned = raw.slice(0, last.index).replace(/[–—:\s/-]+$/, "").trim();
    return { text: cleaned || raw, cost };
  }

  function splitHeaderLine(line, fallbackYearSource) {
    const match = String(line || "").trim().match(/^(\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)\s+(.+)$/);
    if (!match) return null;
    return {
      date: normalizeDate(match[1], fallbackYearSource),
      name: match[2].trim(),
    };
  }

  function splitNameAndDescription(line) {
    const raw = String(line || "").trim();
    if (!raw) return { name: "", description: "" };
    const words = raw.split(/\s+/);
    if (words.length >= 3 && isNameWord(words[0]) && isNameWord(words[1])) {
      return {
        name: `${words[0]} ${words[1]}`.trim(),
        description: words.slice(2).join(" ").trim(),
      };
    }
    return { name: "", description: raw };
  }

  function isNameWord(word) {
    return /^[a-zа-яіїєґ-]+$/i.test(String(word || "").trim());
  }

  function stripLeadingNumbering(value) {
    return String(value || "").replace(/^\d+\)\s*/, "").trim();
  }

  function buildRow(date, name, orderText, cost) {
    return [date || "", name || "", orderText || "", cost || ""];
  }

  function parseManualOrdersTextBlocks(text, defaultDate) {
    const fallbackYearSource = defaultDate;
    return String(text || "")
      .split(/\n\s*\n+/)
      .map((block) => block.trim())
      .filter(Boolean)
      .flatMap((block) => parseBlock(block, fallbackYearSource))
      .filter((row) => row.some((cell) => String(cell || "").trim()));
  }

  function parseBlock(block, fallbackYearSource) {
    const lines = String(block || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];

    const header = splitHeaderLine(lines[0], fallbackYearSource);
    if (header) {
      const detailLines = lines.slice(1).map(stripLeadingNumbering).filter(Boolean);
      if (!detailLines.length) return [buildRow(header.date, header.name, "", "")];

      const parsed = extractTrailingCost(detailLines.join(" "));
      return [buildRow(header.date, header.name, parsed.text, parsed.cost)];
    }

    const merged = lines.join(" ");
    const nameSplit = splitNameAndDescription(merged);
    const parsed = extractTrailingCost(nameSplit.description);
    return [buildRow("", nameSplit.name, parsed.text, parsed.cost)];
  }

  function mapLegacyOrdersValues(values) {
    const rows = Array.isArray(values) ? values : [];
    if (!rows.length) {
      return { headers: SIMPLE_HEADERS.slice(), rows: [] };
    }

    const header = Array.isArray(rows[0]) ? rows[0].map((cell) => String(cell || "").trim()) : [];
    if (header.length <= SIMPLE_WIDTH) {
      return {
        headers: SIMPLE_HEADERS.slice(),
        rows: rows.slice(1).map((row) => padRow(row, SIMPLE_WIDTH)),
      };
    }

    const headerIndex = buildHeaderIndex(header);
    const mappedRows = rows.slice(1).map((row) => {
      const date = normalizeDate(readCell(row, headerIndex.date), "");
      const name = readCell(row, headerIndex.name);
      const service = readCell(row, headerIndex.order);
      const comment = readCell(row, headerIndex.comment);
      const cost = firstNonEmpty([
        readCell(row, headerIndex.costPrimary),
        readCell(row, headerIndex.costSecondary),
        readCell(row, headerIndex.costTertiary),
        readCell(row, headerIndex.costFallback),
      ]);
      return buildRow(
        date,
        name,
        [service, comment].filter(Boolean).join(" | "),
        formatNumber(cost)
      );
    });

    return {
      headers: SIMPLE_HEADERS.slice(),
      rows: mappedRows,
    };
  }

  function buildHeaderIndex(header) {
    return {
      date: findHeaderIndex(header, ["date", "дата"]),
      name: findHeaderIndex(header, ["client", "имя", "name", "клиент"]),
      order: findHeaderIndex(header, ["service", "заказ", "услуга", "order"]),
      comment: findHeaderIndex(header, ["comment", "комментарий", "note"]),
      costPrimary: findHeaderIndex(header, ["accrued +3%", "стоимость", "cost"]),
      costSecondary: findHeaderIndex(header, ["accrued"]),
      costTertiary: findHeaderIndex(header, ["price base", "price"]),
      costFallback: findHeaderIndex(header, ["получено в долларах итого (сводный)", "received total usd"]),
    };
  }

  function findHeaderIndex(header, aliases) {
    const normalizedAliases = new Set((aliases || []).map(normalizeCell));
    return (header || []).findIndex((cell) => normalizedAliases.has(normalizeCell(cell)));
  }

  function readCell(row, index) {
    return index >= 0 && index < (row || []).length ? String(row[index] || "").trim() : "";
  }

  function firstNonEmpty(values) {
    for (const value of values || []) {
      if (String(value || "").trim()) return value;
    }
    return "";
  }

  return {
    SIMPLE_HEADERS,
    parseManualOrdersTextBlocks,
    mapLegacyOrdersValues,
  };
});
