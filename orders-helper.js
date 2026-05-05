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
    const fullMatch = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
    if (fullMatch) {
      const year = fullMatch[3].length === 2 ? `20${fullMatch[3]}` : fullMatch[3];
      return `${String(fullMatch[1]).padStart(2, "0")}.${String(fullMatch[2]).padStart(2, "0")}.${year}`;
    }
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
    const match = raw.match(/(?:^|[\s(])(\d+(?:[.,]\d+)?)$/);
    if (!match) return { text: raw, cost: "" };
    const cost = formatNumber(match[1]);
    const cleaned = raw.slice(0, raw.length - match[1].length).replace(/[–—:\s/(-]+$/, "").trim();
    return { text: cleaned || raw, cost };
  }

  function splitHeaderLine(line, fallbackYearSource) {
    const raw = String(line || "").trim();
    const numericMatch = raw.match(/^(\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)\s+(.+)$/);
    if (numericMatch) {
      return {
        date: normalizeDate(numericMatch[1], fallbackYearSource),
        name: numericMatch[2].trim(),
      };
    }
    const monthMatch = raw.match(/^(\d{1,2})\s+(января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь)\s+(?:(\d{4})\s+)?(.+)$/i);
    if (!monthMatch) return null;
    const month = getRussianMonthNumber(monthMatch[2]);
    if (!month) return null;
    const year = monthMatch[3] || inferYear(fallbackYearSource);
    return {
      date: `${String(monthMatch[1]).padStart(2, "0")}.${month}.${year}`,
      name: monthMatch[4].trim(),
    };
  }

  function getRussianMonthNumber(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/ё/g, "е");
    const months = {
      "января": "01",
      "январь": "01",
      "февраля": "02",
      "февраль": "02",
      "марта": "03",
      "март": "03",
      "апреля": "04",
      "апрель": "04",
      "мая": "05",
      "май": "05",
      "июня": "06",
      "июнь": "06",
      "июля": "07",
      "июль": "07",
      "августа": "08",
      "август": "08",
      "сентября": "09",
      "сентябрь": "09",
      "октября": "10",
      "октябрь": "10",
      "ноября": "11",
      "ноябрь": "11",
      "декабря": "12",
      "декабрь": "12",
    };
    return months[normalized] || "";
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

  function isNumberedLine(value) {
    return /^\d+\)\s*/.test(String(value || "").trim());
  }

  function isDecorativeLine(value) {
    const raw = String(value || "").trim();
    return Boolean(raw) && !/[\p{L}\p{N}]/u.test(raw);
  }

  function splitNumberedItems(lines) {
    const items = [];
    let current = [];
    (lines || []).forEach((line) => {
      const raw = String(line || "").trim();
      if (!raw) return;
      if (/^\d+\)\s*/.test(raw) && current.length) {
        items.push(current.join(" ").trim());
        current = [];
      }
      current.push(stripLeadingNumbering(raw));
    });
    if (current.length) items.push(current.join(" ").trim());
    return items.filter(Boolean);
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
      .filter((line) => !isDecorativeLine(line))
      .filter(Boolean);
    if (!lines.length) return [];

    const header = splitHeaderLine(lines[0], fallbackYearSource);
    if (header) {
      const detailItems = splitNumberedItems(lines.slice(1));
      if (!detailItems.length) return [buildRow(header.date, header.name, "", "")];
      return detailItems.map((item) => {
        const parsed = extractTrailingCost(item);
        return buildRow(header.date, header.name, parsed.text, parsed.cost);
      });
    }

    const hasNumberedItems = lines.some(isNumberedLine);
    return splitNumberedItems(lines).map((item) => {
      if (hasNumberedItems) {
        const parsed = extractTrailingCost(item);
        return buildRow("", "", parsed.text, parsed.cost);
      }
      const nameSplit = splitNameAndDescription(item);
      const parsed = extractTrailingCost(nameSplit.description);
      return buildRow("", nameSplit.name, parsed.text, parsed.cost);
    });
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
