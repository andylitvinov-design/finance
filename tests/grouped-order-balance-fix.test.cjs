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

function createDocument(children = [], options = {}) {
  return {
    readyState: options.readyState || "loading",
    children,
    body: new TestElement("body"),
    getElementById(id) {
      if (options.elementsById && Object.hasOwn(options.elementsById, id)) {
        return options.elementsById[id];
      }
      return null;
    },
    addEventListener() {},
  };
}

function loadFix(document, options = {}) {
  const observers = [];
  const window = {
    document,
    MutationObserver: function MutationObserver(callback) {
      const observer = {
        callback,
        observeTarget: null,
        observeOptions: null,
        observe(target, observeOptions) {
          this.observeTarget = target;
          this.observeOptions = observeOptions;
        },
      };
      observers.push(observer);
      return observer;
    },
  };
  if (typeof options.requestAnimationFrame === "function") {
    window.requestAnimationFrame = options.requestAnimationFrame;
  }
  const context = { window, globalThis: window, MutationObserver: window.MutationObserver };
  vm.createContext(context);
  vm.runInContext(fixJs, context);
  return { fix: window.EzohataGroupedOrderBalanceFix, observers, window };
}

function numericText(value) {
  return Number(String(value || "").replace(",", "."));
}

test("movement rows 18170-18172 preserve positive and negative balances in signed total", () => {
  const row18170Balance = cell("td", "0,0000");
  const row18171Balance = cell("td", "0,0000");
  const row18172Balance = cell("td", "0,0000");
  const totalBalance = cell("td", "0,0000");
  const document = createDocument([
    table([
      row([
        cell("th", "NUMBER"),
        cell("th", "DATE"),
        cell("th", "CLIENT"),
        cell("th", "ACCRUED"),
        cell("th", "ACCRUED +3%"),
        cell("th", "ПОЛУЧЕНО В ДОЛЛАРАХ"),
        cell("th", "ОПЛАЧЕНО КЛИЕНТОМ USD"),
        cell("th", "ДОШЛО ДО НАС USD"),
        cell("th", "BALANCE"),
      ]),
      row([cell("td", "18170"), cell("td", "20.05.2026"), cell("td", "Вилл"), cell("td", "25"), cell("td", "25,75"), cell("td", "26,50"), cell("td", "26,50"), cell("td", "26,50"), row18170Balance]),
      row([cell("td", "18171"), cell("td", "21.05.2026"), cell("td", "Вилл"), cell("td", "0"), cell("td", "0"), cell("td", ""), cell("td", ""), cell("td", ""), row18171Balance]),
      row([cell("td", "18172"), cell("td", "22.05.2026"), cell("td", "Вилл"), cell("td", "225"), cell("td", "231,75"), cell("td", "25,00"), cell("td", "25,00"), cell("td", "25,00"), row18172Balance]),
      row([cell("td", "Итого"), cell("td", ""), cell("td", ""), cell("td", "250"), cell("td", "257,50"), cell("td", "51,50"), cell("td", "51,50"), cell("td", "51,50"), totalBalance]),
    ]),
  ]);

  const { fix } = loadFix(document);
  assert.ok(fix.normalizeGroupedOrderBalanceTables(document) > 0);

  assert.equal(row18170Balance.textContent, "0,7500");
  assert.equal(row18172Balance.textContent, "-206,7500");
  assert.equal(totalBalance.textContent, "-206,0000");
  assert.equal(numericText(row18170Balance.textContent) + numericText(row18172Balance.textContent), -206);
  assert.equal(row18171Balance.textContent, "0,0000");
});

test("actual USD selection prefers net received over misleading received total", () => {
  const balance = cell("td", "0,0000");
  const totalBalance = cell("td", "0,0000");
  const document = createDocument([
    table([
      row([
        cell("th", "NUMBER"),
        cell("th", "DATE"),
        cell("th", "CLIENT"),
        cell("th", "ACCRUED +3%"),
        cell("th", "ПОЛУЧЕНО В ДОЛЛАРАХ"),
        cell("th", "NET RECEIVED USD"),
        cell("th", "BALANCE"),
      ]),
      row([cell("td", "18172"), cell("td", "22.05.2026"), cell("td", "Вилл"), cell("td", "231,75"), cell("td", "438,50"), cell("td", "25,00"), balance]),
      row([cell("td", "Итого"), cell("td", ""), cell("td", ""), cell("td", "231,75"), cell("td", "438,50"), cell("td", "25,00"), totalBalance]),
    ]),
  ]);

  const { fix } = loadFix(document);
  assert.ok(fix.normalizeGroupedOrderBalanceTables(document) > 0);

  assert.equal(balance.textContent, "-206,7500");
  assert.equal(totalBalance.textContent, "-206,7500");
});

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

  const { fix } = loadFix(document);
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

  const { fix } = loadFix(document);
  assert.equal(fix.normalizeGroupedOrderBalanceTables(document), 2);
  assert.equal(firstBalance.textContent, "-10,0000");
  assert.equal(secondBalance.textContent, "-50,0000");
});

test("two-row same-client groups keep both signed balances visible", () => {
  const underpaidBalance = cell("td", "206,0000");
  const overpaidBalance = cell("td", "-206,0000");
  const totalBalance = cell("td", "0,0000");
  const document = createDocument([
    table([
      row([
        cell("th", "NUMBER"),
        cell("th", "DATE"),
        cell("th", "CLIENT"),
        cell("th", "ACCRUED +3%"),
        cell("th", "ДОШЛО ДО НАС USD"),
        cell("th", "BALANCE"),
      ]),
      row([cell("td", "18171"), cell("td", "22.05.2026"), cell("td", "Вилл"), cell("td", "206"), cell("td", ""), underpaidBalance]),
      row([cell("td", "18172"), cell("td", "22.05.2026"), cell("td", "Вилл"), cell("td", "25,75"), cell("td", "231,75"), overpaidBalance]),
      row([cell("td", "Итого"), cell("td", ""), cell("td", ""), cell("td", "231,75"), cell("td", "231,75"), totalBalance]),
    ]),
  ]);

  const { fix } = loadFix(document);
  assert.ok(fix.normalizeGroupedOrderBalanceTables(document) > 0);
  assert.equal(underpaidBalance.textContent, "-206,0000");
  assert.equal(overpaidBalance.textContent, "206,0000");
  assert.equal(totalBalance.textContent, "0,0000");
});

test("movement table metadata rows and split payments normalize like the live grouped rows", () => {
  const innaFirstBalance = cell("td", "103");
  const innaSecondBalance = cell("td", "5,15");
  const innaThirdBalance = cell("td", "-110,35");
  const arkFirstBalance = cell("td", "25,75");
  const arkFourthBalance = cell("td", "-77,75");
  const uahBalance = cell("td", "-6");
  const underpaidFirstBalance = cell("td", "40");
  const underpaidSecondBalance = cell("td", "-30");
  const document = createDocument([
    table([
      row([cell("th", "дата 1"), cell("th", "01.05.2026"), cell("th", "дата 2"), cell("th", "15.05.2026")]),
      row([cell("td", "Поменяй даты."), cell("td", ""), cell("td", ""), cell("td", "Обновлено")]),
      row([
        cell("th", "NUMBER"),
        cell("th", "DATE"),
        cell("th", "CLIENT"),
        cell("th", "SERVICE"),
        cell("th", "ACCRUED"),
        cell("th", "ACCRUED +3%"),
        cell("th", "PAYMENT METHOD"),
        cell("th", "ПОЛУЧЕНО В ДОЛЛАРАХ"),
        cell("th", "ПОЛУЧЕНО В РУБЛЯХ"),
        cell("th", "ПОЛУЧЕНО В ГРИВНАХ"),
        cell("th", "ОПЛАЧЕНО КЛИЕНТОМ USD"),
        cell("th", "ДОШЛО ДО НАС USD"),
        cell("th", "BALANCE"),
        cell("th", "REVIEW NOTE"),
      ]),
      row([cell("td", "18149"), cell("td", "05.05.2026"), cell("td", "Инна Устименко"), cell("td", "A"), cell("td", "100"), cell("td", "103"), cell("td", "пейпал дол"), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), innaFirstBalance, cell("td", "")]),
      row([cell("td", "18150"), cell("td", "05.05.2026"), cell("td", "Инна Устименко"), cell("td", "B"), cell("td", "5"), cell("td", "5,15"), cell("td", "пейпал дол"), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), innaSecondBalance, cell("td", "")]),
      row([cell("td", "18151"), cell("td", "05.05.2026"), cell("td", "Инна Устименко"), cell("td", "C"), cell("td", "5"), cell("td", "5,15"), cell("td", "сайт, дол"), cell("td", "115,5"), cell("td", ""), cell("td", ""), cell("td", "115,5"), cell("td", ""), innaThirdBalance, cell("td", "")]),
      row([cell("td", "18155"), cell("td", "08.05.2026"), cell("td", "Надежда Юзова"), cell("td", "UAH"), cell("td", "100"), cell("td", "103"), cell("td", "сайт,рубли"), cell("td", ""), cell("td", ""), cell("td", "8703,04"), cell("td", "109"), cell("td", ""), uahBalance, cell("td", "")]),
      row([cell("td", "18161"), cell("td", "14.05.2026"), cell("td", "Ярослав Архипов"), cell("td", "A"), cell("td", "25"), cell("td", "25,75"), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), arkFirstBalance, cell("td", "")]),
      row([cell("td", "18162"), cell("td", "14.05.2026"), cell("td", "Ярослав Архипов"), cell("td", "B"), cell("td", "25"), cell("td", "25,75"), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", "25,75"), cell("td", "")]),
      row([cell("td", "18163"), cell("td", "14.05.2026"), cell("td", "Ярослав Архипов"), cell("td", "C"), cell("td", "25"), cell("td", "25,75"), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", ""), cell("td", "25,75"), cell("td", "")]),
      row([cell("td", "18164"), cell("td", "14.05.2026"), cell("td", "Ярослав Архипов"), cell("td", "D"), cell("td", "25"), cell("td", "25,25"), cell("td", "крипта"), cell("td", "103"), cell("td", ""), cell("td", ""), cell("td", "103"), cell("td", ""), arkFourthBalance, cell("td", "")]),
      row([cell("td", "19000"), cell("td", "15.05.2026"), cell("td", "Under Paid"), cell("td", "A"), cell("td", "50"), cell("td", "50"), cell("td", "card"), cell("td", "10"), cell("td", ""), cell("td", ""), cell("td", "10"), cell("td", ""), underpaidFirstBalance, cell("td", "")]),
      row([cell("td", "19001"), cell("td", "15.05.2026"), cell("td", "Under Paid"), cell("td", "B"), cell("td", "50"), cell("td", "50"), cell("td", "card"), cell("td", "20"), cell("td", ""), cell("td", ""), cell("td", "20"), cell("td", ""), underpaidSecondBalance, cell("td", "")]),
    ]),
  ]);

  const { fix } = loadFix(document);
  assert.ok(fix.normalizeGroupedOrderBalanceTables(document) > 0);
  assert.equal(numericText(innaFirstBalance.textContent), 0);
  assert.equal(numericText(innaSecondBalance.textContent), 0);
  assert.equal(numericText(innaThirdBalance.textContent), 0);
  assert.equal(numericText(arkFirstBalance.textContent), 0);
  assert.equal(numericText(arkFourthBalance.textContent), 0);
  assert.equal(uahBalance.textContent, "6,0000");
  assert.equal(underpaidFirstBalance.textContent, "-40,0000");
  assert.equal(underpaidSecondBalance.textContent, "-30,0000");
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

test("installer observes tabPanels without characterData mutations", () => {
  const tabPanels = new TestElement("div");
  const document = createDocument([], {
    readyState: "complete",
    elementsById: { tabPanels },
  });

  const { observers } = loadFix(document);

  assert.equal(observers.length, 1);
  assert.equal(observers[0].observeTarget, tabPanels);
  assert.equal(observers[0].observeOptions.childList, true);
  assert.equal(observers[0].observeOptions.subtree, true);
  assert.equal(Object.hasOwn(observers[0].observeOptions, "characterData"), false);
});

test("rapid observer callbacks are debounced into one normalization pass", () => {
  const balance = cell("td", "99,0000");
  const tabPanels = new TestElement("div");
  tabPanels.append(table([
    row([
      cell("th", "NUMBER"),
      cell("th", "DATE"),
      cell("th", "CLIENT"),
      cell("th", "ACCRUED +3%"),
      cell("th", "ОПЛАЧЕНО КЛИЕНТОМ USD"),
      cell("th", "BALANCE"),
    ]),
    row([cell("td", "18149"), cell("td", "14.05.2026"), cell("td", "Инна Устименко"), cell("td", "50"), cell("td", "40"), balance]),
    row([cell("td", "Итого"), cell("td", ""), cell("td", ""), cell("td", "50"), cell("td", "40"), cell("td", "99,0000")]),
  ]));
  const rafCallbacks = [];
  const document = createDocument([], {
    readyState: "complete",
    elementsById: { tabPanels },
  });

  const { observers } = loadFix(document, {
    requestAnimationFrame(callback) {
      rafCallbacks.push(callback);
    },
  });
  assert.equal(balance.textContent, "-10,0000");

  balance.textContent = "99,0000";
  observers[0].callback();
  observers[0].callback();
  observers[0].callback();

  assert.equal(rafCallbacks.length, 1);
  assert.equal(balance.textContent, "99,0000");
  rafCallbacks[0]();
  assert.equal(balance.textContent, "-10,0000");
});

test("installer normalizes tabPanels only, not the full document", () => {
  const outsideBalance = cell("td", "99,0000");
  const insideBalance = cell("td", "99,0000");
  const outsideTable = table([
    row([
      cell("th", "NUMBER"),
      cell("th", "DATE"),
      cell("th", "CLIENT"),
      cell("th", "ACCRUED +3%"),
      cell("th", "ОПЛАЧЕНО КЛИЕНТОМ USD"),
      cell("th", "BALANCE"),
    ]),
    row([cell("td", "18148"), cell("td", "14.05.2026"), cell("td", "Outside"), cell("td", "50"), cell("td", "40"), outsideBalance]),
    row([cell("td", "Итого"), cell("td", ""), cell("td", ""), cell("td", "50"), cell("td", "40"), cell("td", "99,0000")]),
  ]);
  const tabPanels = new TestElement("div");
  tabPanels.append(table([
    row([
      cell("th", "NUMBER"),
      cell("th", "DATE"),
      cell("th", "CLIENT"),
      cell("th", "ACCRUED +3%"),
      cell("th", "ОПЛАЧЕНО КЛИЕНТОМ USD"),
      cell("th", "BALANCE"),
    ]),
    row([cell("td", "18149"), cell("td", "14.05.2026"), cell("td", "Inside"), cell("td", "50"), cell("td", "40"), insideBalance]),
    row([cell("td", "Итого"), cell("td", ""), cell("td", ""), cell("td", "50"), cell("td", "40"), cell("td", "99,0000")]),
  ]));
  const document = createDocument([outsideTable, tabPanels], {
    readyState: "complete",
    elementsById: { tabPanels },
  });

  loadFix(document);

  assert.equal(outsideBalance.textContent, "99,0000");
  assert.equal(insideBalance.textContent, "-10,0000");
});
