const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function loadModule() {
  delete require.cache[require.resolve("../balance-screenshot-entry.js")];
  return require("../balance-screenshot-entry.js");
}

class FakeNode {
  constructor(tag) {
    this.tag = String(tag || "div").toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.type = "";
    this.title = "";
    this.id = "";
    this.disabled = false;
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.classList = {
      add: (...names) => {
        const set = new Set(String(this.className).split(/\s+/).filter(Boolean));
        names.forEach((name) => set.add(name));
        this.className = Array.from(set).join(" ");
      },
      remove: (...names) => {
        const set = new Set(String(this.className).split(/\s+/).filter(Boolean));
        names.forEach((name) => set.delete(name));
        this.className = Array.from(set).join(" ");
      },
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    this.listeners.click?.({ preventDefault() {}, stopPropagation() {} });
  }

  querySelector(selector) {
    const className = String(selector).replace(/^\./, "");
    const matches = (node) => String(node.className || "").split(/\s+/).includes(className);
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child)) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
}

function makeDoc() {
  return {
    createElement(tag) {
      return new FakeNode(tag);
    },
    getElementById() {
      return null;
    },
    addEventListener() {},
  };
}

test("index wires balance-screenshot-entry after remainders-tab and before main", () => {
  assert.ok(indexHtml.includes("./balance-screenshot-entry.js"));
  assert.ok(indexHtml.indexOf("./remainders-tab.js") < indexHtml.indexOf("./balance-screenshot-entry.js"));
  assert.ok(indexHtml.indexOf("./balance-screenshot-entry.js") < indexHtml.indexOf("./main.js"));
  // Adjacency between popup and remainders-tab must remain intact.
  assert.match(
    indexHtml,
    /remainders-summary-popup\.js(?:\?v=[^"]*)?"><\/script>\s*<script src="\.\/remainders-tab\.js"><\/script>/
  );
});

test("getTodayIso returns YYYY-MM-DD", () => {
  const api = loadModule();
  assert.equal(api.getTodayIso(new Date("2026-06-30T08:00:00")), "2026-06-30");
  assert.match(api.getTodayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test("toEditableRows maps draft rows and preserves duplicate flags", () => {
  const api = loadModule();
  const rows = api.toEditableRows([
    { channel: "Бинанс spot", currency: "usdt", amount: 1689, duplicateOfExisting: true },
    { channel: "пейпал дол", currency: "USD", amount: null },
  ]);
  assert.equal(rows[0].currency, "USDT");
  assert.equal(rows[0].amount, "1689");
  assert.equal(rows[0].duplicateOfExisting, true);
  assert.equal(rows[1].amount, "");
});

test("isRowSavable requires channel, currency and an amount or usd amount", () => {
  const api = loadModule();
  assert.equal(api.isRowSavable({ channel: "пейпал дол", currency: "USD", amount: "500" }), true);
  assert.equal(api.isRowSavable({ channel: "пейпал дол", currency: "USD", amount: "", usdAmount: "500" }), true);
  assert.equal(api.isRowSavable({ channel: "", currency: "USD", amount: "500" }), false);
  assert.equal(api.isRowSavable({ channel: "пейпал дол", currency: "", amount: "500" }), false);
  assert.equal(api.isRowSavable({ channel: "пейпал дол", currency: "USD", amount: "" }), false);
});

test("buildSavePayload filters non-savable rows, normalizes, and tags batch source", () => {
  const api = loadModule();
  const payload = api.buildSavePayload({
    date: "2026-06-30",
    batchId: "balance-draft:2026-06-30:x",
    rows: [
      { channel: "Бинанс spot", currency: "usdt", amount: "1689", comment: "" },
      { channel: "", currency: "USD", amount: "5" },
      { channel: "пейпал дол", currency: "usd", amount: "", usdAmount: "500", comment: "проверено" },
    ],
  });
  assert.equal(payload.rows.length, 2);
  assert.equal(payload.rows[0].date, "2026-06-30");
  assert.equal(payload.rows[0].currency, "USDT");
  assert.match(payload.rows[0].comment, /screenshot balance-draft/);
  assert.equal(payload.rows[1].usdAmount, "500");
  assert.equal(payload.rows[1].comment, "проверено");
});

test("summarizeDraft counts total, savable and duplicates", () => {
  const api = loadModule();
  const summary = api.summarizeDraft([
    { channel: "a", currency: "USD", amount: "1", duplicateOfExisting: true },
    { channel: "b", currency: "USD", amount: "2" },
    { channel: "", currency: "", amount: "" },
  ]);
  assert.deepEqual(summary, { total: 3, savable: 2, duplicates: 1 });
});

test("parseBalanceOcrText extracts labelled balances and ignores junk", () => {
  const api = loadModule();
  const rows = api.parseBalanceOcrText("PayPal USD: 1234.50 USD\nрандомный текст без чисел\nБинанс 1689 USDT");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, "1234.50");
  assert.equal(rows[0].currency, "USD");
  assert.equal(rows[1].currency, "USDT");
});

test("parseBalanceOcrText handles spreadsheet OCR rows with left and right numeric columns", () => {
  const api = loadModule();
  const rows = api.parseBalanceOcrText([
    "429 wise usd 429",
    "J} REVOLUT 101",
    "2026 Бтпансе заме изас 2026",
    "ЕКЗ Бинанс spot usdt 882",
    "14943 БАНК КАНАДА 11058",
    "500 600",
  ].join("\n"));

  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((row) => [row.channel, row.currency, row.amount]),
    [
      ["wise usd", "USD", "429"],
      ["REVOLUT", "", "101"],
      ["binance save usdc", "USDC", "2026"],
      ["Бинанс spot usdt", "USDT", "882"],
      ["БАНК КАНАДА", "CAD", "11058"],
    ]
  );
});

test("normalizeOcrCurrency maps symbols and 3-letter codes", () => {
  const api = loadModule();
  assert.equal(api.normalizeOcrCurrency("$"), "USD");
  assert.equal(api.normalizeOcrCurrency("€"), "EUR");
  assert.equal(api.normalizeOcrCurrency("грн"), "UAH");
  assert.equal(api.normalizeOcrCurrency("cad"), "CAD");
  assert.equal(api.normalizeOcrCurrency("zzzz"), "");
});

test("renderEntryPanel renders date input defaulting to today and a working Сегодня button", () => {
  const api = loadModule();
  const doc = makeDoc();
  const panel = api.renderEntryPanel(doc, { defaultDate: "" });
  assert.ok(String(panel.className).includes("balance-entry-panel"));
  const dateInput = panel.querySelector(".balance-entry-date");
  const todayButton = panel.querySelector(".balance-entry-today");
  const dropzone = panel.querySelector(".balance-entry-dropzone");
  assert.ok(dateInput);
  assert.ok(dropzone);
  assert.match(dateInput.value, /^\d{4}-\d{2}-\d{2}$/);
  dateInput.value = "2020-01-01";
  todayButton.click();
  assert.equal(dateInput.value, api.getTodayIso());
});
