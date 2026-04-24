const assert = require("node:assert/strict");

function clone2dArray(values) {
  return (values || []).map((row) => (row || []).slice());
}

function hasAnyValue(row) {
  return (row || []).some((cell) => String(cell || "").trim());
}

function splitAnalyticsSections(values) {
  const sections = [];
  let index = 0;
  while (index < values.length) {
    const title = String(values[index]?.[0] || "").trim();
    if (!title) {
      index += 1;
      continue;
    }
    const header = values[index + 1] || [];
    const rows = [];
    let cursor = index + 2;
    while (cursor < values.length && hasAnyValue(values[cursor])) {
      rows.push(values[cursor]);
      cursor += 1;
    }
    if (header.length) sections.push({ title, rows: [header, ...rows] });
    index = cursor + 1;
  }
  return sections;
}

function getAnalyticsSections(values, movementSummaryRows) {
  const sections = splitAnalyticsSections(values);
  if (!movementSummaryRows.length) return sections;
  return [
    {
      title: "Итоги за выбранный период",
      rows: [["Показатель", "Значение"], ...clone2dArray(movementSummaryRows)]
    },
    ...sections
  ];
}

function getAnalyticsExportRows(values, movementSummaryRows) {
  const sections = getAnalyticsSections(values, movementSummaryRows);
  if (!sections.length) return values;
  const output = [];
  sections.forEach((section, index) => {
    if (index > 0) output.push([]);
    output.push([section.title]);
    section.rows.forEach((row) => output.push((row || []).slice()));
  });
  return output;
}

function truncateTableValues(values, columnCount) {
  return clone2dArray(values);
}

const analyticsValues = [
  ["Личные расходы"],
  ["валюта", "now", "business", "flat", "food", "fun", "travel", "total"],
  ["paypal", "10", "1", "2", "3", "4", "0", "10"],
  [],
  ["Plan"],
  ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11"],
  ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"]
];

const movementSummaryRows = [
  ["Всего приход", "100"],
  ["Всего расход", "30"]
];

const sections = getAnalyticsSections(analyticsValues, movementSummaryRows);
assert.equal(sections[0].title, "Итоги за выбранный период");
assert.deepEqual(sections[0].rows, [["Показатель", "Значение"], ...movementSummaryRows]);
assert.equal(sections[1].title, "Личные расходы");

const exportRows = getAnalyticsExportRows(analyticsValues, movementSummaryRows);
assert.deepEqual(exportRows.slice(0, 4), [
  ["Итоги за выбранный период"],
  ["Показатель", "Значение"],
  ["Всего приход", "100"],
  ["Всего расход", "30"]
]);

const mobileRows = truncateTableValues(sections[2].rows, 10);
assert.equal(mobileRows[0].length, 11);
assert.equal(mobileRows[1].length, 11);
assert.deepEqual(mobileRows[1], ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"]);

console.log("verify-analytics-layout: ok");
