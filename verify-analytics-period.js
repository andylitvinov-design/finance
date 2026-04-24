const assert = require("node:assert/strict");

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase();
}

function parseLooseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseIsoDate(value) {
  return new Date(`${value}T00:00:00`);
}

function parseDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{5}$/.test(raw)) {
    const utcDays = Math.floor(Number(raw) - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate());
  }
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function findDateColumnIndex(header) {
  return (header || []).findIndex((cell) => {
    const normalized = String(cell || "").trim().toLowerCase();
    return normalized.includes("date") || normalized.includes("дата");
  });
}

function hasAnyValue(row) {
  return (row || []).some((cell) => String(cell || "").trim());
}

function preparePayoutValues(values, startDate, endDate) {
  if (!Array.isArray(values) || !values.length) return values || [];
  const hasTitleRow = normalizeCell(values?.[0]?.[0]) === normalizeCell("Выплаты");
  const headerRowIndex = hasTitleRow ? 1 : 0;
  const header = values[headerRowIndex] || [];
  const dateColumn = findDateColumnIndex(header);
  if (dateColumn === -1) return values.slice(headerRowIndex);
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const filteredRows = values.slice(headerRowIndex + 1).filter((row) => {
    const cellDate = parseDisplayDate(row[dateColumn]);
    return cellDate && cellDate >= start && cellDate <= end;
  });
  return [header, ...filteredRows];
}

function buildTopRows(manualRows) {
  return manualRows.map((row) => [
    row.channel || "",
    row.now || "0,00",
    row.business || "",
    row.flat || "",
    row.food || "",
    row.fun || "",
    row.travel || "",
    row.total || ""
  ]);
}

const payoutValues = [
  ["Выплаты", "Журнал переводов за период"],
  ["POSITION", "DATE", "CLIENT", "AMOUNT (USD)"],
  ["1", "01.04.2026", "A", "10,00"],
  ["2", "30.04.2026", "B", "20,00"],
  ["3", "05.05.2026", "C", "999,00"]
];

const filteredPayouts = preparePayoutValues(payoutValues, "2026-04-01", "2026-04-30");
assert.equal(filteredPayouts.length, 3);
assert.equal(parseLooseNumber(filteredPayouts[1][3]) + parseLooseNumber(filteredPayouts[2][3]), 30);

const topRows = buildTopRows([
  { channel: "пейпал дол", business: "5,00", flat: "0,00", food: "0,00", fun: "0,00", travel: "0,00", total: "5,00" }
]);
assert.equal(topRows[0][1], "0,00");

console.log("verify-analytics-period: ok");
