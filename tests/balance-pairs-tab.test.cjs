const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

class TestElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.parentNode = null;
    this.id = "";
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.listeners = {};
    this.dataset = {};
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (matchesSelector(node, selector)) matches.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return matches;
  }
}

function hasClass(node, name) {
  return String(node.className || "").split(/\s+/).includes(name);
}

function matchesSelector(node, selector) {
  if (selector === ".tab-panel.active") return hasClass(node, "tab-panel") && hasClass(node, "active");
  if (selector.startsWith(".")) {
    return selector.slice(1).split(".").every((name) => hasClass(node, name));
  }
  return node.tag === selector;
}

function collectText(node) {
  return [
    node.textContent || "",
    node.innerHTML || "",
    ...(node.children || []).map(collectText),
  ].flat().join(" ");
}

function resetModule() {
  delete require.cache[require.resolve("../balance-pairs-tab.js")];
  delete require.cache[require.resolve("../servicein-services-me-layer.js")];
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.elements;
  delete global.fetch;
  delete global.renderTabs;
  delete global.MutationObserver;
  delete global.EzohataManualLedgerContract;
  delete global.renderResponsiveDataView;
  delete global.renderPlainTable;
  delete global.setTimeout;
}

function makeDocument(nodes = {}) {
  return {
    createElement(tag) {
      return new TestElement(tag);
    },
    getElementById(id) {
      return nodes[id] || null;
    },
    addEventListener() {},
    readyState: "complete",
  };
}

test("index wires balance pairs tab script after legacy remainders tab", () => {
  assert.match(indexHtml, /remainders-tab\.js"><\/script>\s*<script src="\.\/balance-pairs-tab\.js(?:\?v=[^"]*)?"><\/script>/);
});

test("balance pairs tab renders summary, all rows, and exact cell reasons", async () => {
  resetModule();
  const tabPanel = new TestElement("section");
  tabPanel.className = "tab-panel active";
  const tabPanels = new TestElement("div");
  tabPanels.appendChild(tabPanel);
  const startDate = new TestElement("input");
  startDate.value = "2026-06-01";
  const endDate = new TestElement("input");
  endDate.value = "2026-06-16";

  global.document = makeDocument({ startDate, endDate });
  global.window = global;
  global.state = {
    activeTab: "balancePairs",
    config: {
      tabs: [{ id: "movement", label: "Движение" }],
    },
  };
  global.elements = { tabPanels, startDate, endDate };
  global.renderTabs = () => tabPanel;
  global.MutationObserver = class {
    observe() {}
  };
  global.fetch = async (url) => {
    assert.match(String(url), /\/api\/balance-pairs\?from=2026-06-01&to=2026-06-16/);
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          period: { from: "2026-06-01", to: "2026-06-16" },
          summary: {
            expected_rows: 2,
            found_start_rows: 1,
            found_end_rows: 1,
            missing_start_rows: 1,
            missing_end_rows: 1,
            usd_complete_start: 1,
            usd_complete_end: 0,
            fx_missing: 1,
          },
          rows: [
            {
              channel: "пейпал дол",
              currency: "USD",
              start: { amount: 35.3, rate_to_usd: 1, amount_usd: 35.3, status: "ok", snapshot_date: "2026-06-01" },
              end: { status: "missing_snapshot", message: "missing snapshot" },
            },
            {
              channel: "Яндекс руб",
              currency: "RUB",
              start: { status: "missing_snapshot", message: "missing snapshot" },
              end: { amount: 993.15, status: "missing_fx", message: "missing FX RUB 2026-06-16", snapshot_date: "2026-06-16" },
            },
          ],
        };
      },
    };
  };

  const api = require("../balance-pairs-tab.js");
  assert.equal(global.state.config.tabs.some((tab) => tab.id === "balancePairs" && tab.label === "Остатки 2"), true);
  global.renderTabs();
  await api.loadBalancePairsTabContent(tabPanel.children[0].children[1]);

  const text = collectText(tabPanel);
  assert.match(text, /Остатки 2/);
  assert.match(text, /balance-pairs HTTP 200 · rows 2/);
  assert.match(text, /Ожидаемых строк: 2/);
  assert.match(text, /Найдено на начало: 1/);
  assert.match(text, /FX missing: 1/);
  assert.match(text, /пейпал дол/);
  assert.match(text, /Яндекс руб/);
  assert.match(text, /missing snapshot/);
  assert.match(text, /missing FX RUB 2026-06-16/);
  assert.doesNotMatch(text, /needs verification/i);
  resetModule();
});

test("balance pairs tab keeps its table body and excludes services-me block", async () => {
  resetModule();
  const tabPanel = new TestElement("section");
  tabPanel.className = "tab-panel active";
  const tabPanels = new TestElement("div");
  tabPanels.appendChild(tabPanel);
  const startDate = new TestElement("input");
  startDate.value = "2026-06-01";
  const endDate = new TestElement("input");
  endDate.value = "2026-06-17";

  global.document = makeDocument({ startDate, endDate });
  global.document.querySelector = (selector) => tabPanels.querySelector(selector);
  global.document.querySelectorAll = (selector) => tabPanels.querySelectorAll(selector);
  global.window = global;
  global.state = {
    activeTab: "balancePairs",
    config: {
      tabs: [{ id: "movement", label: "Движение" }],
    },
    manualFinance: {
      data: {
        ledgerRows: [
          { date: "2026-06-10", operation: "income", category: "servicein", direction: "in", subcategory: "services_me", toChannel: "пейпал дол", amount: "25", currency: "USD", amount_usd: "25" },
        ],
      },
    },
  };
  global.elements = { tabPanels, startDate, endDate };
  global.renderTabs = function renderTabsStub() {
    const panel = global.elements.tabPanels.querySelector(".tab-panel.active");
    if (!panel) return null;
    panel.innerHTML = "";
    panel.appendChild(new TestElement("div"));
    return panel;
  };
  global.renderResponsiveDataView = (values) => {
    const node = new TestElement("div");
    node.textContent = values.flat().join(" ");
    return node;
  };
  global.renderPlainTable = global.renderResponsiveDataView;
  global.setTimeout = () => 0;
  global.MutationObserver = class {
    observe() {}
  };
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        ok: true,
        period: { from: "2026-06-01", to: "2026-06-17" },
        summary: { expected_rows: 1 },
        rows: [
          {
            channel: "пейпал дол",
            currency: "USD",
            start: { status: "ok", amount: 25, rate_to_usd: 1, amount_usd: 25 },
            end: { status: "ok", amount: 40, rate_to_usd: 1, amount_usd: 40 },
          },
        ],
      };
    },
  });

  const balancePairsApi = require("../balance-pairs-tab.js");
  global.renderTabs();
  const shell = global.elements.tabPanels.querySelector(".tab-panel.active").children.at(-1);
  await balancePairsApi.loadBalancePairsTabContent(shell.children[2], shell.children[1]);
  require("../servicein-services-me-layer.js");
  await Promise.resolve();
  await Promise.resolve();

  const activePanel = global.elements.tabPanels.querySelector(".tab-panel.active");
  const text = collectText(activePanel);
  assert.match(text, /Остатки 2/);
  assert.match(text, /Канал/);
  assert.match(text, /Остатки вал1/);
  assert.match(text, /пейпал дол/);
  assert.doesNotMatch(text, /УСЛУГИ МНЕ/);
  assert.equal(activePanel.querySelector(".services-me-layer-block"), null);
  assert.ok(activePanel.querySelector(".balance-pairs-content"));

  resetModule();
});
