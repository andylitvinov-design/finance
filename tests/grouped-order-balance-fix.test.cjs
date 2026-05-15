const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const fixJs = fs.readFileSync(path.join(root, "grouped-order-balance-fix.js"), "utf8");

class TestElement {
  constructor(tagName, text = "") {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.dataset = {};
    this._textContent = String(text ?? "");
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }
}

function cell(tagName, text) {
  return new TestElement(tagName, text);
}

function row(cells) {
  const tr = new TestElement("tr");
  tr.append(...cells);
  return tr;
}

function table(rows) {
  const tableNode = new TestElement("table");
  tableNode.append(...rows);
  return tableNode;
}

function createDocument(children = []) {
  return {
    readyState: "loading",
    children,
    body: new TestElement("body"),
    getElementById() {
      return null;
    },
    addEventListener() {},
  };
}

function loadFix(document) {
  const window = {
    document,
    MutationObserver: function MutationObserver() {
      return { observe() {} };
    },
  };
  const context = { window, globalThis: window, MutationObserver: window.MutationObserver };
  vm.createContext(context);
  vm.runInContext(fixJs, context);
  return window.EzohataGroupedOrderBalanceFix;
}

test("grouped adjacent same-client rows are zeroed only when group balance nets to zero", () => {
  const firstBalance = cell("td", "-103,0000");
  const secondBalance = cell("td", "50,0000");
  const thirdBalance = cell("td", "53,0000");
  const totalBalance = cell("td", "500,0000");
  const firstReview = cell("td", "");
  const secondReview = cell("td", "manual review | underpaid");
  const thirdReview = cell("td", "manual review | underpaid");
  const document = createDocument([
    table([
      row([
        cell("th", "NUMBER"),
        cell("th", "DATE"),
        cell("th", "CLIENT"),
        cell("th", "ACCRUED +3%"),
        cell("th", "ОПЛАЧЕНО КЛИЕНТОМ USD"),
        cell("th", "BALANCE"),
        cell("th", "REVIEW NOTE"),
      ]),
      row([cell("td", "18149"), cell("td", "14.05.2026"), cell("td", "Инна Устименко"), cell("td", "0"), cell("td", "103"), firstBalance, firstReview]),
      row([cell("td", "18150"), cell("td", "14.05.2026"), cell("td", "Инна Устименко"), cell("td", "50"), cell("td", "0"), secondBalance, secondReview]),
      row([cell("td", "18151"), cell("td", "14.05.2026"), cell("td", "Инна Устименко"), cell("td", "53"), cell("td", "0"), thirdBalance, thirdReview]),
      row([cell("td", "Итого"), cell("td", ""), cell("td", ""), cell("td", "103"), cell("td", "103"), totalBalance, cell("td", "")]),
    ]),
  ]);

  const fix = loadFix(document);
  assert.equal(fix.normalizeGroupedOrderBalanceTables(document), 7);
  assert.equal(firstBalance.textContent, "0,0000");
  assert.equal(secondBalance.textContent, "0,0000");
  assert.equal(thirdBalance.textContent, "0,0000");
  assert.equal(totalBalance.textContent, "0,0000");
  assert.equal(firstBalance.dataset.displaySignNormalized, "grouped-order-zero-balance");
  assert.match(secondReview.textContent, /group balance reconciled/);
});

test("grouped balance fix does not hide truly underpaid groups", () => {
  const firstBalance = cell("td", "-40,0000");
  const secondBalance = cell("td", "50,0000");
  const document = createDocument([
    table([
      row([
        cell("th", "NUMBER"),
        cell("th", "DATE"),
        cell("th", "CLIENT"),
        cell("th", "ACCRUED +3%"),
        cell("th", "ОПЛАЧЕНО КЛИЕНТОМ USD"),
        cell("th", "BALANCE"),
      ]),
      row([cell("td", "18161"), cell("td", "14.05.2026"), cell("td", "Архипова"), cell("td", "50"), cell("td", "40"), firstBalance]),
      row([cell("td", "18162"), cell("td", "14.05.2026"), cell("td", "Архипова"), cell("td", "50"), cell("td", "0"), secondBalance]),
    ]),
  ]);

  const fix = loadFix(document);
  assert.equal(fix.normalizeGroupedOrderBalanceTables(document), 1);
  assert.equal(firstBalance.textContent, "-10,0000");
  assert.equal(secondBalance.textContent, "-50,0000");
});

test("grouped balance fix script is loaded after live fixes and before main", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const liveFixIndex = html.indexOf("./live-finance-fixes.js");
  const groupedFixIndex = html.indexOf("./grouped-order-balance-fix.js");
  const mainIndex = html.indexOf("./main.js");
  assert.ok(liveFixIndex !== -1, "live finance fixes are loaded");
  assert.ok(groupedFixIndex !== -1, "grouped order balance fix is loaded");
  assert.ok(mainIndex !== -1, "main.js is loaded");
  assert.ok(liveFixIndex < groupedFixIndex, "grouped fix loads after live fixes");
  assert.ok(groupedFixIndex < mainIndex, "grouped fix loads before app boot");
});
