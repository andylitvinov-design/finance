"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("sheet-config.json contains expenseAccounting tab", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../sheet-config.json"), "utf8"));
  const tab = (config.tabs || []).find((t) => t.id === "expenseAccounting");
  assert.ok(tab, "expenseAccounting tab must exist in sheet-config.json");
  assert.equal(tab.label, "Учет расходов");
  assert.equal(tab.sheetName, "Расходы");
});

test("sheet-config.json expenseAccounting is between manualFinance and orders", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../sheet-config.json"), "utf8"));
  const ids = (config.tabs || []).map((t) => t.id);
  const factIdx = ids.indexOf("manualFinance");
  const expIdx = ids.indexOf("expenseAccounting");
  const ordIdx = ids.indexOf("orders");
  assert.ok(expIdx !== -1);
  assert.ok(expIdx > factIdx, "must come after fact");
  assert.ok(expIdx < ordIdx, "must come before orders");
});

test("ui.js renderTabs handles expenseAccounting branch", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui.js"), "utf8");
  assert.ok(src.includes('tab.id === "expenseAccounting"'));
  assert.ok(src.includes("renderExpenseAccountingBlock()"));
});

test("renderExpenseAccountingBlock creates all three subtabs", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui.js"), "utf8");
  assert.ok(src.includes("список затрат"));
  assert.ok(src.includes("операции"));
  assert.ok(src.includes("анализ финансов"));
});

test("state.js initializes expenseAccounting.activeSubtab", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../state.js"), "utf8");
  assert.ok(src.includes("expenseAccounting"));
  assert.ok(src.includes("activeSubtab"));
});

test("no filter in ui.js excludes expenseAccounting", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui.js"), "utf8");
  const suspects = (src.match(/\.filter\([^)]{0,120}/g) || [])
    .filter((m) => m.includes("expenseAccounting"));
  assert.equal(suspects.length, 0, `Found filter that may hide expenseAccounting: ${suspects.join(", ")}`);
});

test("main.js renders tabs without automatic silent Google OAuth", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8");
  const firstRenderTabs = src.indexOf("renderTabs();");
  const initializeGoogleAuth = src.indexOf("await initializeGoogleAuth();");
  assert.ok(firstRenderTabs !== -1, "init must call renderTabs");
  assert.ok(initializeGoogleAuth !== -1, "init must initialize Google auth");
  assert.equal(src.includes("await trySilentGoogleConnect()"), false, "normal init must not trigger silent Google OAuth");
  assert.ok(firstRenderTabs < initializeGoogleAuth, "tabs must render before Google auth initialization can block");
});
