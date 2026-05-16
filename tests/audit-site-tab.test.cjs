const test = require("node:test");
const assert = require("node:assert/strict");

class FakeClassList {
  constructor(node) {
    this.node = node;
  }

  _set(classes) {
    this.node.className = [...classes].join(" ");
  }

  _classes() {
    return new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
  }

  add(name) {
    const classes = this._classes();
    classes.add(name);
    this._set(classes);
  }

  remove(name) {
    const classes = this._classes();
    classes.delete(name);
    this._set(classes);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.contains(name) : Boolean(force);
    if (shouldAdd) this.add(name);
    else this.remove(name);
    return shouldAdd;
  }

  contains(name) {
    return this._classes().has(name);
  }
}

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.textContent = "";
    this.dataset = {};
    this.children = [];
    this.events = {};
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.value = "";
    this.type = "";
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  addEventListener(event, handler) {
    this.events[event] = handler;
  }

  click() {
    this.events.click?.();
  }

  focus() {}

  select() {}

  setAttribute(name, value) {
    this[name] = String(value);
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || "";
  }

  _walk() {
    const output = [];
    const visit = (node) => {
      output.push(node);
      node.children.forEach(visit);
    };
    visit(this);
    return output;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const nodes = this._walk().slice(1);
    if (selector === ".tab.active") {
      return nodes.filter((node) => node.classList?.contains("tab") && node.classList?.contains("active"));
    }
    const dataTabMatch = selector.match(/^\[data-tab-id="([^"]+)"\]$/);
    if (dataTabMatch) {
      return nodes.filter((node) => node.dataset?.tabId === dataTabMatch[1]);
    }
    return [];
  }
}

function resetModule() {
  delete require.cache[require.resolve("../audit-site-tab.js")];
  delete global.__ezohataAuditTabInstalled;
  delete global.EzohataAuditSiteTab;
  delete global.document;
  delete global.state;
  delete global.elements;
  delete global.renderTabs;
  delete global.AuditBridge;
  delete global.fetch;
  delete global.navigator;
  delete global.open;
}

function setupDom() {
  resetModule();
  const nodesById = {};
  global.document = {
    getElementById(id) {
      return nodesById[id] || null;
    },
    createElement(tagName) {
      return new FakeNode(tagName);
    },
  };
  global.document.nodesById = nodesById;
  global.elements = {
    tabs: new FakeNode("div"),
    tabPanels: new FakeNode("div"),
  };
  global.state = {
    activeTab: "movement",
    config: {
      tabs: [{ id: "movement", label: "Движение средства" }],
    },
  };
  global.AuditBridge = {
    createAuditBridge() {
      return {
        runAudit: async () => ({ copied: true }),
        copyCurrentPrompt: async () => ({ copied: true }),
      };
    },
  };
  global.renderTabs = function originalRenderTabs() {
    global.elements.tabs.innerHTML = "";
    const button = global.document.createElement("button");
    button.className = "tab active";
    button.textContent = "Движение средства";
    button.dataset.tabId = "movement";
    global.elements.tabs.appendChild(button);
    global.elements.tabPanels.innerHTML = "";
    const panel = global.document.createElement("section");
    panel.className = "tab-panel active";
    global.elements.tabPanels.appendChild(panel);
  };
}

test("audit site tab is appended as UI-only tab without mutating data tab config", () => {
  setupDom();
  const originalTabs = global.state.config.tabs;

  require("../audit-site-tab.js");
  global.renderTabs();

  const auditButton = global.elements.tabs.querySelector('[data-tab-id="audit"]');
  assert.ok(auditButton);
  assert.equal(auditButton.textContent, "Аудит");
  assert.equal(global.state.config.tabs, originalTabs);
  assert.deepEqual(global.state.config.tabs, [{ id: "movement", label: "Движение средства" }]);

  resetModule();
});

test("static audit launcher button click renders audit panel without mutating data tab config", () => {
  setupDom();
  const launcher = new FakeNode("button");
  global.document.nodesById.auditLauncherButton = launcher;
  const originalTabs = global.state.config.tabs;

  require("../audit-site-tab.js");
  launcher.click();

  assert.equal(global.state.activeTab, "audit");
  assert.equal(global.state.config.tabs, originalTabs);
  assert.equal(global.state.config.tabs.length, 1);
  assert.equal(global.elements.tabPanels.children.length, 1);
  assert.equal(global.elements.tabPanels.children[0].className, "tab-panel active");

  resetModule();
});

test("audit site tab renders debugger panel and keeps only audit tab active", () => {
  setupDom();

  require("../audit-site-tab.js");
  global.state.activeTab = "audit";
  global.renderTabs();

  const activeTabs = global.elements.tabs.querySelectorAll(".tab.active");
  assert.equal(activeTabs.length, 1);
  assert.equal(activeTabs[0].dataset.tabId, "audit");
  assert.equal(global.elements.tabPanels.children.length, 1);
  assert.equal(global.elements.tabPanels.children[0].className, "tab-panel active");
  assert.ok(global.elements.tabPanels.children[0].children[0]);
  assert.equal(global.state.config.tabs.length, 1);

  resetModule();
});
