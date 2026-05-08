const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const patchJs = fs.readFileSync(path.join(root, "expense-operations-edit-unlock.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("YooMoney operation edit unlock patch is loaded after ui.js", () => {
  const uiIndex = indexHtml.indexOf("./ui.js");
  const patchIndex = indexHtml.indexOf("./expense-operations-edit-unlock.js");

  assert.ok(uiIndex > 0, "ui.js should be loaded");
  assert.ok(patchIndex > uiIndex, "edit unlock patch must run after ui.js binds row handlers");
});

test("YooMoney operation edit unlock only targets operation action buttons", () => {
  assert.match(patchJs, /TARGET_SOURCES = new Set\(\["yoomoney"\]\)/);
  assert.match(patchJs, /ACTION_TEXT_RE = \/\^\(редактировать\|удалить\)\$\/i/);
  assert.match(patchJs, /isExpenseOperationsViewActive/);
  assert.match(patchJs, /normalize\(node\.textContent\) === "операции"/);
});

test("YooMoney operation edit unlock does not change finance semantics", () => {
  assert.doesNotMatch(patchJs, /amountNet|amount_net|amountGross|amount_gross|amountFee|amount_fee|balance/i);
  assert.doesNotMatch(patchJs, /fetch\(/);
  assert.doesNotMatch(patchJs, /googleSheetsFetch|overwriteSheetValues|batchUpdateSheetValues/);
});
