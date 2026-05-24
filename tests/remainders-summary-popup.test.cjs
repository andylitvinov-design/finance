const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function resetRemaindersModule() {
  delete require.cache[require.resolve("../remainders-summary-popup.js")];
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.elements;
  delete global.EzohataRemaindersSummaryPopup;
}

function loadApi() {
  resetRemaindersModule();
  return require("../remainders-summary-popup.js");
}

class TestElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.parentNode = null;
    this.id = "";
    this.className = "";
    this.type = "";
    this.textContent = "";
    this.listeners = {};
    this.nextSibling = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  setAttribute() {}

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }
}

function makeMockDocument() {
  return {
    createElement(tag) {
      return new TestElement(tag);
    },
  };
}

function collectText(node) {
  if (!node) return "";
  return [node.textContent || "", ...(node.children || []).map(collectText)].filter(Boolean).join("\n");
}

test("index contains remainders launcher after balance launcher", () => {
  assert.match(indexHtml, /id="remaindersLauncherButton"[^>]*>Остатки<\/button>/);
  assert.match(indexHtml, /id="balanceLauncherButton"[^>]*>Баланс<\/button>\s*<button id="remaindersLauncherButton"[^>]*>Остатки<\/button>/);
  assert.match(indexHtml, /balance-summary-popup\.js"><\/script>\s*<script src="\.\/remainders-summary-popup\.js"><\/script>/);
});

test("missing remainders launcher is created after balance launcher", () => {
  resetRemaindersModule();
  const doc = makeMockDocument();
  const parent = new TestElement("div");
  const balance = new TestElement("button");
  balance.id = "balanceLauncherButton";
  parent.appendChild(balance);
  doc.getElementById = (id) => {
    if (id === "balanceLauncherButton") return balance;
    return null;
  };
  global.document = doc;

  const api = require("../remainders-summary-popup.js");

  assert.equal(api.bindRemaindersLauncherButton(), true);
  assert.equal(parent.children[1].id, "remaindersLauncherButton");
  assert.equal(parent.children[1].textContent, "Остатки");
  resetRemaindersModule();
});

test("buildRemaindersSummary calculates opening, closing, and delta totals", () => {
  const api = loadApi();
  const summary = api.buildRemaindersSummary({
    data: {
      balance_coverage: {
        rows: [
          { channel: "PayPal", opening_amount_usd: "100", closing_amount_usd: "125" },
          { paymentChannel: "Wise", startUsd: "200,50", endUsd: "150,25", deltaUsd: "999" },
        ],
      },
    },
  });

  assert.equal(summary.source, "data.balance_coverage.rows");
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.rows[0].deltaUsd, 25);
  assert.equal(summary.rows[1].deltaUsd, -50.25);
  assert.equal(summary.totals.openingUsd, 300.5);
  assert.equal(summary.totals.closingUsd, 275.25);
  assert.equal(summary.totals.deltaUsd, -25.25);
  resetRemaindersModule();
});

test("missing values render needs verification instead of invented balances", () => {
  const api = loadApi();
  const summary = api.buildRemaindersSummary({
    data: {
      balanceCoverage: {
        rows: [
          { account: "Missing opening", closingUsd: 10, movement_usd: 10 },
          { wallet: "Missing closing", openingUsd: 10 },
        ],
      },
    },
  });
  const block = api.renderRemaindersSummaryBlock(summary, makeMockDocument());
  const text = collectText(block);

  assert.equal(summary.needsVerificationCount, 2);
  assert.match(text, /Канал/);
  assert.match(text, /ИТОГО/);
  assert.match(text, /needs verification/);
  assert.equal(summary.totals.openingUsd, 0);
  assert.equal(summary.totals.closingUsd, 0);
  assert.equal(summary.totals.deltaUsd, 0);
  resetRemaindersModule();
});

test("existing Balance popup behavior remains available", () => {
  const balanceApi = require("../balance-summary-popup.js");
  const block = balanceApi.renderBalanceSummaryBlock({
    ordersBase: 1000,
    percentRate: 3,
    totalOrdersPlusPercent: 1030,
    myOrders: 200,
    myOrdersPayable: 100,
    totalAccrued: 1130,
    totalPaid: 500,
    remainingToPay: 630,
    diagnostics: [],
    incomeChannelDistribution: {
      title: "Распределение оплат заказов/услуг по каналам",
      total: 100,
      channels: [{ channel: "PayPal", amount: 100, percent: 100 }],
      diagnostics: [],
    },
  }, makeMockDocument());

  assert.match(collectText(block), /ОСТАТОК оплатить: 630,0000/);
  assert.equal(balanceApi.BALANCE_BUTTON_ID, "balanceLauncherButton");
  resetRemaindersModule();
});
