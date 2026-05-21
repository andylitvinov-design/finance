const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.events = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.parentNode = null;
    this.type = "";
  }

  set id(value) {
    this._id = String(value || "");
    if (this._id) this.ownerDocument.nodesById[this._id] = this;
  }

  get id() {
    return this._id || "";
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    if (node.id) this.ownerDocument.nodesById[node.id] = node;
    return node;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  insertAdjacentElement(_position, node) {
    return this.appendChild(node);
  }

  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index !== -1) {
      next.parentNode = this;
      previous.parentNode = null;
      this.children[index] = next;
      if (next.id) this.ownerDocument.nodesById[next.id] = next;
    }
    return previous;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) this.parentNode.children.splice(index, 1);
    if (this.id) delete this.ownerDocument.nodesById[this.id];
    this.parentNode = null;
  }

  addEventListener(event, handler) {
    this.events[event] = handler;
  }

  click() {
    this.events.click?.();
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  get innerText() {
    return [this.textContent, ...this.children.map((child) => child.innerText)].filter(Boolean).join("\n");
  }
}

function makeDocument() {
  const document = {
    nodesById: {},
    body: null,
    readyState: "complete",
    createElement(tagName) {
      return new FakeNode(tagName, document);
    },
    getElementById(id) {
      return document.nodesById[id] || null;
    },
    querySelector(selector) {
      if (selector === ".hero .controls") return document.controls;
      return null;
    },
    addEventListener() {},
  };
  document.body = document.createElement("body");
  document.controls = document.createElement("div");
  document.body.appendChild(document.controls);
  return document;
}

function resetBalanceModule() {
  delete require.cache[require.resolve("../balance-summary-popup.js")];
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.elements;
  delete global.buildTopMetricsSummary;
  delete global.EzohataBalanceSummaryPopup;
}

test("top balance button opens and toggles balance block without switching to audit", () => {
  resetBalanceModule();
  const document = makeDocument();
  const button = document.createElement("button");
  button.id = "balanceLauncherButton";
  button.textContent = "Баланс";
  document.controls.appendChild(button);
  global.document = document;
  global.state = { activeTab: "movement" };
  global.buildTopMetricsSummary = () => ({ totalOrders: 1100, totalPaid: 500, personalOrdersAfterDiscount: 200 });

  require("../balance-summary-popup.js");
  button.click();

  const block = document.getElementById("balanceSummaryBlock");
  assert.ok(block);
  assert.equal(global.state.activeTab, "movement");
  assert.match(block.innerText, /ВСЕГО НАЧИСЛЕНО/);

  button.click();
  assert.equal(document.getElementById("balanceSummaryBlock"), null);
  resetBalanceModule();
});

test("bottom audit tab remains available while top button is balance", () => {
  resetBalanceModule();
  assert.match(indexHtml, /id="balanceLauncherButton"[^>]*>Баланс<\/button>/);
  assert.doesNotMatch(indexHtml, /id="auditLauncherButton"[^>]*>Аудит<\/button>/);
  assert.match(indexHtml, /audit-site-tab\.js/);
});

test("balance summary math matches accrual formula", () => {
  resetBalanceModule();
  const api = require("../balance-summary-popup.js");
  const summary = api.buildBalanceTextSummary({
    orders: 1000,
    percentToOrders: 100,
    myOrders: 200,
    paid: 500,
  });

  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.seventyPercent, 770);
  assert.equal(summary.myOrdersHalf, 100);
  assert.equal(summary.totalAccrued, 870);
  assert.equal(summary.remainingToPay, 370);
  resetBalanceModule();
});

test("missing myOrders source emits diagnostic and never NaN", () => {
  resetBalanceModule();
  const api = require("../balance-summary-popup.js");
  const summary = api.buildBalanceTextSummary({ orders: 1000, percentToOrders: 100, paid: 500 });

  assert.equal(Number.isNaN(summary.myOrders), false);
  assert.equal(summary.myOrders, 0);
  assert.match(summary.diagnostics.join("\n"), /needs verification: source not found for myOrders/);
  resetBalanceModule();
});

test("selected period excludes outside rows from orders and paid-derived summary", () => {
  resetBalanceModule();
  const api = require("../balance-summary-popup.js");
  const summary = api.buildBalanceTextSummary(
    {
      state: {
        data: {
          tabs: {
            movement: {
              values: [
                ["NUMBER", "DATE", "ACCRUED", "ACCRUED +3%"],
                ["1", "2026-04-30", "1000", "1100"],
                ["2", "2026-05-10", "1000", "1100"],
              ],
            },
            orders: { values: [] },
          },
        },
      },
      totalPaid: 500,
      personalOrdersAfterDiscount: 200,
    },
    { startDate: "2026-05-01", endDate: "2026-05-31" }
  );

  assert.equal(summary.orders, 1000);
  assert.equal(summary.percentToOrders, 100);
  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.totalPaid, 500);
  assert.equal(summary.remainingToPay, 370);
  resetBalanceModule();
});
