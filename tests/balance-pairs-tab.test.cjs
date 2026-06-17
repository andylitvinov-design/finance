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
    if (selector === ".tab-panel.active" && hasClass(this, "tab-panel") && hasClass(this, "active")) return this;
    for (const child of this.children) {
      const found = child.querySelector?.(selector);
      if (found) return found;
    }
    return null;
  }
}

function hasClass(node, name) {
  return String(node.className || "").split(/\s+/).includes(name);
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
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.elements;
  delete global.fetch;
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
