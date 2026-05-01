const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const uiJs = fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8");

test("UI exposes personal Privat24 CSV/XLSX import as the primary path", () => {
  assert.match(uiJs, /Для личного Приват24 используйте импорт выписки CSV\/XLSX\. Business API доступен только для бизнес-счетов\./);
  assert.match(uiJs, /Импорт Privat24 CSV\/XLSX/);
  assert.match(uiJs, /Privat API \(business\)/);
  assert.match(uiJs, /function renderPrivat24ImportHelper/);
  assert.match(uiJs, /async function importPrivat24StatementFile/);
  assert.match(uiJs, /function readPrivat24XlsxFile/);
  assert.match(uiJs, /action: "parseStatement"/);
});
