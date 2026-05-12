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

test("movement total balance is recomputed from visible normalized numeric rows only", () => {
  const row18148Balance = cell("td", "-999,0000");
  const row18149Balance = cell("td", "-999,0000");
  const row18153Balance = cell("td", "999,0000");
  const ignoredSummaryBalance = cell("td", "999,0000");
  const totalBalance = cell("td", "-340,5000");
  const afterTotalBalance = cell("td", "777,0000");
  const document = createDocument([
    table([
      row([cell("th", "NUMBER"), cell("th", "План"), cell("th", "Пришло"), cell("th", "Баланс")]),
      row([cell("td", "18148"), cell("td", "0"), cell("td", "6"), row18148Balance]),
      row([cell("td", "18149"), cell("td", "0"), cell("td", "103"), row18149Balance]),
      row([cell("td", "Сводка"), cell("td", "1"), cell("td", "999"), ignoredSummaryBalance]),
      row([cell("td", "18153"), cell("td", "51,5"), cell("td", "0"), row18153Balance]),
      row([cell("td", "Итого"), cell("td", ""), cell("td", ""), totalBalance]),
      row([cell("td", "18154"), cell("td", "0"), cell("td", "10"), afterTotalBalance]),
    ]),
  ]);

  const fixes = loadFixes(document);
  const changed = fixes.normalizeMovementBalanceVarianceTables(document);
  assert.equal(row18148Balance.textContent, "6,0000");
  assert.equal(row18149Balance.textContent, "103,0000");
  assert.equal(row18153Balance.textContent, "-51,5000");
  assert.equal(totalBalance.textContent, "57,5000");
  assert.equal(totalBalance.dataset.displaySignNormalized, "movement-total-visible-rows");
  assert.equal(ignoredSummaryBalance.textContent, "999,0000");
  assert.equal(afterTotalBalance.textContent, "777,0000");
  assert.equal(changed, 4);
});
