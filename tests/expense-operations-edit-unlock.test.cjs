const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const uiJs = fs.readFileSync(path.join(root, "ui.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("YooMoney operation edit unlock DOM patch is no longer loaded", () => {
  assert.doesNotMatch(indexHtml, /expense-operations-edit-unlock\.js/);
});

test("server manual overlay rows can be edited without browser Google OAuth", () => {
  assert.match(uiJs, /function isServerManualOverlayOperationRow/);
  assert.match(uiJs, /function canEditExpenseOperationRow/);
  assert.match(uiJs, /hasConfiguredManualFinanceEndpoint\(\) \|\| isServerManualOverlayOperationRow\(row\)/);
  assert.match(uiJs, /serverManualOverlay:/);
});

test("server manual overlay saves through ledger-operation endpoint instead of browser Sheets OAuth", () => {
  assert.match(uiJs, /postLedgerOperation\("update"/);
  assert.match(uiJs, /postLedgerOperation\("delete"/);
  assert.match(uiJs, /\.\/api\/ledger-operation/);
  assert.match(uiJs, /updateManualLedgerRowDirect\(state\.expenseAccounting\.operationDraft\)/);
  assert.match(uiJs, /deleteManualLedgerRowDirect\(row\.sheetRowNumber\)/);
});
