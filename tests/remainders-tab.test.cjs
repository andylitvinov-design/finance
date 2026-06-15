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
    this.type = "";
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.title = "";
    this.attributes = {};
    this.listeners = {};
    this.classList = {
      add: (...names) => {
        const current = new Set(String(this.className || "").split(/\s+/).filter(Boolean));
        names.forEach((name) => current.add(name));
        this.className = Array.from(current).join(" ");
      },
      toggle: () => {},
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index >= 0) {
      next.parentNode = this;
      previous.parentNode = null;
      this.children[index] = next;
    }
    return previous;
  }

  cloneNode() {
    const clone = new TestElement(this.tag);
    clone.id = this.id;
    clone.type = this.type;
    clone.className = this.className;
    clone.textContent = this.textContent;
    clone.title = this.title;
    clone.value = this.value;
    return clone;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  querySelector(selector) {
    if (selector === ".tab-panel.active" && hasClass(this, "tab-panel") && hasClass(this, "active")) return this;
    if (selector === ".remainders-diagnostics-details" && this.tag === "details" && hasClass(this, "remainders-diagnostics-details")) return this;
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

function resetRemaindersTabModule() {
  delete require.cache[require.resolve("../remainders-tab.js")];
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.elements;
  delete global.requestDashboardLoad;
  delete global.EzohataRemaindersSummaryPopup;
  delete global.EzohataRemaindersTab;
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

test("index wires remainders tab script after remainders popup", () => {
  assert.match(indexHtml, /id="remaindersLauncherButton"[^>]*>Остатки<\/button>/);
  assert.match(indexHtml, /remainders-summary-popup\.js(?:\?v=[^"]*)?"><\/script>\s*<script src="\.\/remainders-tab\.js"><\/script>/);
});

test("month-start button replaces popup launcher and sets current month start", () => {
  resetRemaindersTabModule();
  const parent = new TestElement("div");
  const button = new TestElement("button");
  button.id = "remaindersLauncherButton";
  button.className = "secondary";
  button.type = "button";
  button.textContent = "Остатки";
  parent.appendChild(button);
  const startDate = new TestElement("input");
  startDate.value = "2026-05-17";
  let requestCount = 0;

  global.document = makeDocument({ remaindersLauncherButton: button, startDate });
  global.elements = { startDate };
  global.requestDashboardLoad = () => { requestCount += 1; };

  const api = require("../remainders-tab.js");

  assert.equal(parent.children[0].textContent, "1 число");
  assert.equal(parent.children[0].__ezohataRemaindersLauncherBound, true);
  api.setStartDateToCurrentMonthStart();
  const expected = new Date();
  const expectedIso = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-01`;
  assert.equal(startDate.value, expectedIso);
  assert.equal(requestCount, 1);
  resetRemaindersTabModule();
});

test("remainders tab config is inserted and renders remainders content", () => {
  resetRemaindersTabModule();
  const tabPanel = new TestElement("section");
  tabPanel.className = "tab-panel active";
  const tabPanels = new TestElement("div");
  tabPanels.appendChild(tabPanel);
  const renderedBlock = new TestElement("div");
  renderedBlock.id = "remaindersSummaryBlock";
  const details = new TestElement("details");
  details.className = "remainders-diagnostics-details";
  renderedBlock.appendChild(details);

  global.document = makeDocument();
  global.state = {
    activeTab: "remainders",
    data: {},
    config: {
      tabs: [
        { id: "movement", label: "Движение" },
        { id: "analytics", label: "Аналитика" },
      ],
    },
  };
  global.elements = { tabPanels };
  global.renderTabs = () => tabPanel;
  global.EzohataRemaindersSummaryPopup = {
    async buildLiveRemaindersSummary() {
      return { rows: [] };
    },
    renderRemaindersSummaryBlock() {
      return renderedBlock;
    },
  };

  const api = require("../remainders-tab.js");
  assert.equal(global.state.config.tabs.some((tab) => tab.id === "remainders"), true);
  global.renderTabs();

  assert.equal(tabPanel.children[0].className.includes("remainders-tab-shell"), true);
  assert.equal(api.renderRemaindersTabBlock().className.includes("remainders-tab-shell"), true);
  resetRemaindersTabModule();
});
