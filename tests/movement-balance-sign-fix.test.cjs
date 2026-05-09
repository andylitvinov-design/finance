const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const fixesJs = fs.readFileSync(path.join(root, "live-finance-fixes.js"), "utf8");

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

function loadFixes(document) {
  const window = {
    document,
    MutationObserver: function MutationObserver() {
      return { observe() {} };
    },
  };
  const context = { window, globalThis: window, MutationObserver: window.MutationObserver };
  vm.createContext(context);
  vm.runInContext(fixesJs, context);
  return window.EzohataLiveFinanceFixes;
}

test("movement balance sign is positive when received amount is above plan", () => {
  const balanceCell = cell("td", "-20,0000");
  const document = createDocument([
    table([
      row([cell("th", "Канал"), cell("th", "План"), cell("th", "Пришло"), cell("th", "Баланс")]),
      row([cell("td", "пейпал дол"), cell("td", "100,0000"), cell("td", "120,0000"), balanceCell]),
    ]),
  ]);

  const fixes = loadFixes(document);
  assert.equal(fixes.normalizeMovementBalanceVarianceTables(document), 1);
  assert.equal(balanceCell.textContent, "20,0000");
  assert.equal(balanceCell.dataset.displaySignNormalized, "movement-fact-minus-plan");
});

test("movement balance sign is negative when received amount is below plan", () => {
  const balanceCell = cell("td", "30,0000");
  const document = createDocument([
    table([
      row([cell("th", "Канал"), cell("th", "план = ACCRUED"), cell("th", "получено в долларах"), cell("th", "остаток")]),
      row([cell("td", "Яндекс руб"), cell("td", "100,0000"), cell("td", "70,0000"), balanceCell]),
    ]),
  ]);

  const fixes = loadFixes(document);
  assert.equal(fixes.normalizeMovementBalanceVarianceTables(document), 1);
  assert.equal(balanceCell.textContent, "-30,0000");
});

test("movement balance sign normalizer ignores tables without plan/fact/balance columns", () => {
  const untouchedCell = cell("td", "-20,0000");
  const document = createDocument([
    table([
      row([cell("th", "Канал"), cell("th", "Пришло"), cell("th", "Комментарий")]),
      row([cell("td", "пейпал дол"), cell("td", "120,0000"), untouchedCell]),
    ]),
  ]);

  const fixes = loadFixes(document);
  assert.equal(fixes.normalizeMovementBalanceVarianceTables(document), 0);
  assert.equal(untouchedCell.textContent, "-20,0000");
});
