const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const fixesJs = fs.readFileSync(path.join(root, "live-finance-fixes.js"), "utf8");
const scrollCss = fs.readFileSync(path.join(root, "mobile-finance-table-scroll.css"), "utf8");

function runFixesWithHelper(helper) {
  const listeners = {};
  const window = {
    document: {
      readyState: "loading",
      getElementById: () => null,
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
    EzohataOrdersHelper: helper,
    MutationObserver: function MutationObserver() {
      return { observe() {} };
    },
  };
  const context = { window, globalThis: window, MutationObserver: window.MutationObserver };
  vm.createContext(context);
  vm.runInContext(fixesJs, context);
  if (listeners.DOMContentLoaded) listeners.DOMContentLoaded();
  return window;
}

test("live finance fixes load before config and mobile scroll CSS after base CSS", () => {
  assert.match(indexHtml, /<link rel="stylesheet" href="style\.css">\s*<link rel="stylesheet" href="mobile-finance-table-scroll\.css">/);
  assert.match(indexHtml, /<script src="\.\/orders-helper\.js"><\/script>\s*<script src="\.\/live-finance-fixes\.js"><\/script>\s*<script src="\.\/grouped-order-balance-fix\.js"><\/script>\s*<script src="\.\/manual-ledger-contract\.js"><\/script>/);
});

test("live finance fixes normalize text discounts before orders mapping reaches config", () => {
  const helper = {
    mapLegacyOrdersValues: (values) => ({
      headers: ["ДАТА", "ИМЯ", "ЗАКАЗ", "СТОИМОСТЬ"],
      rows: values.slice(1).map((row) => [row[1], row[2], row[3], row[6]]),
    }),
  };
  runFixesWithHelper(helper);

  const mapped = helper.mapLegacyOrdersValues([
    ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACCRUED +3%", "СКИДКА", "STATUS"],
    ["18152", "03.05.2026", "Сергей Ковалев", "Заказ 1", "", "100", "103", "-50%", "NEEDS VERIFICATION"],
    ["18153", "03.05.2026", "Сергей Ковалев", "Заказ 2", "", "100", "103", "-50 %", "NEEDS VERIFICATION"],
    ["18154", "03.05.2026", "Сергей Ковалев", "Заказ 3", "", "100", "103", "0,5", "NEEDS VERIFICATION"],
  ]);

  assert.equal(helper.parseDiscountMultiplier("-50%"), 0.5);
  assert.equal(helper.computeDiscountedAmount("103", "-50%"), 51.5);
  assert.deepEqual(mapped.rows.map((row) => row[3]), ["51.5", "51.5", "51.5"]);
});

test("live finance fixes use action multiplier and propagate within same date/client group", () => {
  const helper = {
    mapLegacyOrdersValues: (values) => ({
      headers: ["ДАТА", "ИМЯ", "ЗАКАЗ", "СТОИМОСТЬ"],
      rows: values.slice(1).map((row) => [row[1], row[2], row[3], row[6]]),
    }),
  };
  runFixesWithHelper(helper);

  const mapped = helper.mapLegacyOrdersValues([
    ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACCRUED +3%", "ACTION", "STATUS"],
    ["18152", "03.05.2026", "Сергей Ковалев", "Заказ 1", "", "100", "103", "", "NEEDS VERIFICATION"],
    ["18153", "03.05.2026", "Сергей Ковалев", "Заказ 2", "", "100", "103", "0.5", "NEEDS VERIFICATION"],
    ["18154", "04.05.2026", "Другой Клиент", "Заказ 3", "", "100", "103", "", "NEEDS VERIFICATION"],
  ]);

  assert.equal(helper.parseDiscountMultiplier("0.5"), 0.5);
  assert.deepEqual(mapped.rows.map((row) => row[3]), ["51.5", "51.5", "103"]);
});

test("paid total display fix changes only negative metric text to absolute display", () => {
  let metricText = "-847,7385";
  const metric = {
    dataset: {},
    get textContent() { return metricText; },
    set textContent(value) { metricText = value; },
  };
  const window = {
    document: {
      readyState: "loading",
      getElementById: (id) => (id === "metricBalances" ? metric : null),
      addEventListener: () => {},
    },
    EzohataOrdersHelper: { mapLegacyOrdersValues: (values) => ({ headers: values[0] || [], rows: values.slice(1) }) },
    MutationObserver: function MutationObserver() {
      return { observe() {} };
    },
  };
  const context = { window, globalThis: window, MutationObserver: window.MutationObserver };
  vm.createContext(context);
  vm.runInContext(fixesJs, context);

  assert.equal(window.EzohataLiveFinanceFixes.normalizePaidTotalDisplay(), true);
  assert.equal(metric.textContent, "847,7385");
  assert.equal(metric.dataset.displaySignNormalized, "absolute-paid-total");
});

test("mobile finance CSS forces full intrinsic-width horizontal scroll", () => {
  assert.match(scrollCss, /overflow-x: auto;/);
  assert.match(scrollCss, /-webkit-overflow-scrolling: touch;/);
  assert.match(scrollCss, /width: max-content;/);
  assert.match(scrollCss, /min-width: max-content;/);
  assert.match(scrollCss, /white-space: nowrap;/);
  assert.match(scrollCss, /position: static;/);
});
