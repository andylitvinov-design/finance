const test = require("node:test");
const assert = require("node:assert/strict");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this._textContent = "";
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.parentElement = null;
    this.title = "";
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value || "");
    this.children = [];
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const result = [];
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    const tagName = className ? "" : selector.toLowerCase();
    const visit = (node) => {
      node.children.forEach((child) => {
        if (className && String(child.className || "").split(/\s+/).includes(className)) result.push(child);
        else if (tagName && child.tag === tagName) result.push(child);
        visit(child);
      });
    };
    visit(this);
    return result;
  }

  get previousElementSibling() {
    const siblings = this.parentElement?.children || [];
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }
}

function collectText(node) {
  return [node.textContent || "", ...(node.children || []).map(collectText)].filter(Boolean).join("\n");
}

function makeDocument() {
  const body = new Element("body");
  return {
    readyState: "complete",
    body,
    createElement: (tag) => new Element(tag),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  };
}

function appendCell(row, text = "") {
  const cell = new Element("td");
  cell.textContent = text;
  row.appendChild(cell);
  return cell;
}

function loadCompactScript(doc) {
  delete require.cache[require.resolve("../balance-payment-gap-compact.js")];
  global.document = doc;
  global.MutationObserver = class {
    observe() {}
  };
  require("../balance-payment-gap-compact.js");
  delete global.document;
  delete global.MutationObserver;
}

test("compact payment gap script hides verbose source rows behind closed details", () => {
  const doc = makeDocument();
  const table = new Element("table");
  const body = new Element("tbody");
  const aggregateRow = new Element("tr");
  appendCell(aggregateRow, "Без канала");
  appendCell(aggregateRow, "103,0000");
  appendCell(aggregateRow, "payment channel missing");
  appendCell(aggregateRow, "rows: 18156, 18161, 18164, 18171, 18172, 18173, 18174, 18175, 18176; dates: 2026-05-08, 2026-05-14, 2026-05-15, 2026-05-16, 2026-05-17, 2026-05-18; client: Надежда Юзова");
  const detailRow = new Element("tr");
  detailRow.className = "balance-service-payment-gap-detail";
  const detailCell = appendCell(detailRow);
  [
    "row/order 18156; date 2026-05-08; client Надежда Юзова; order/service Повтор посвящения через Смерть-Сефира Йесод.; paymentMethod -; accrued 25.75; client paid 0; provider net 0; reason payment channel missing; status/reviewNote NEEDS VERIFICATION / payment channel missing",
    "row/order 18161; date 2026-05-14; client Ярослав Архипов; order/service Чистка комплексов по Маслоу 1; paymentMethod -; accrued 25.75; client paid 0; provider net 0; reason payment channel missing; status/reviewNote NEEDS VERIFICATION / payment channel missing",
  ].forEach((text) => {
    const line = new Element("div");
    line.className = "balance-service-payment-gap-source-row";
    line.textContent = text;
    detailCell.appendChild(line);
  });
  body.appendChild(aggregateRow);
  body.appendChild(detailRow);
  table.appendChild(body);
  doc.body.appendChild(table);

  loadCompactScript(doc);

  const details = detailRow.querySelector("details");
  assert.equal(details?.tag, "details");
  assert.equal(details.attributes.open, undefined);
  assert.equal(details.querySelector("summary").textContent, "Показать строки (2)");

  const compactText = collectText(detailRow);
  assert.match(compactText, /18156 · 2026-05-08 · accrued 25\.75 · paid 0 · provider net 0 · NEEDS VERIFICATION \/ payment channel missing/);
  assert.doesNotMatch(compactText, /order\/service Повтор посвящения/);
  assert.doesNotMatch(compactText, /paymentMethod -/);

  const aggregateText = collectText(aggregateRow);
  assert.match(aggregateText, /rows: 18156, 18161, 18164, 18171, 18172, 18173, 18174, 18175… \(\+1\)/);
  assert.match(aggregateText, /dates: 2026-05-08, 2026-05-14, 2026-05-15, 2026-05-16, 2026-05-17… \(\+1\)/);
});

test("compact payment gap script loads coverage orders diff enhancer", () => {
  const doc = makeDocument();
  loadCompactScript(doc);

  const scripts = doc.body.querySelectorAll("script");
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "./balance-coverage-orders-diff-ui.js");
  assert.equal(scripts[0].defer, true);
});
