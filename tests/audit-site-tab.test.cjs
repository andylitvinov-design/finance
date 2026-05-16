const test = require("node:test");
const assert = require("node:assert/strict");

class ClassList {
  constructor(node) { this.node = node; }
  values() { return new Set(String(this.node.className || "").split(/\s+/).filter(Boolean)); }
  save(values) { this.node.className = [...values].join(" "); }
  add(value) { const values = this.values(); values.add(value); this.save(values); }
  remove(value) { const values = this.values(); values.delete(value); this.save(values); }
  toggle(value, force) { force ? this.add(value) : this.remove(value); }
  contains(value) { return this.values().has(value); }
}

class Node {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.dataset = {};
    this.events = {};
    this.classList = new ClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.value = "";
  }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  addEventListener(name, handler) { this.events[name] = handler; }
  click() { this.events.click?.(); }
  focus() {}
  select() {}
  setAttribute(name, value) { this[name] = String(value); }
  set innerHTML(value) { this._innerHTML = String(value || ""); this.children = []; }
  get innerHTML() { return this._innerHTML || ""; }
  walk() { const out = []; const visit = (n) => { out.push(n); n.children.forEach(visit); }; visit(this); return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const nodes = this.walk().slice(1);
    if (selector === ".tab.active") return nodes.filter((n) => n.classList.contains("tab") && n.classList.contains("active"));
    const match = selector.match(/^\[data-tab-id="([^"]+)"\]$/);
    if (match) return nodes.filter((n) => n.dataset?.tabId === match[1]);
    return [];
  }
}

function reset() {
  delete require.cache[require.resolve("../audit-site-tab.js")];
  delete global.__ezohataAuditTabInstalled;
  delete global.EzohataAuditSiteTab;
  delete global.document;
  delete global.state;
  delete global.elements;
  delete global.renderTabs;
  delete global.AuditBridge;
}

function setup() {
  reset();
  global.document = { createElement: (tag) => new Node(tag) };
  global.elements = { tabs: new Node("div"), tabPanels: new Node("div") };
  global.state = { activeTab: "movement", config: { tabs: [{ id: "movement", label: "Движение" }] } };
  global.AuditBridge = { createAuditBridge: () => ({ runAudit: async () => ({}), copyCurrentPrompt: async () => ({}) }) };
  global.renderTabs = function originalRenderTabs() {
    global.elements.tabs.innerHTML = "";
    const movement = global.document.createElement("button");
    movement.className = "tab active";
    movement.dataset.tabId = "movement";
    movement.textContent = "Движение";
    global.elements.tabs.appendChild(movement);
    global.elements.tabPanels.innerHTML = "";
    global.elements.tabPanels.appendChild(global.document.createElement("section"));
  };
}

test("audit tab is appended without mutating configured data tabs", () => {
  setup();
  const originalTabs = global.state.config.tabs;
  require("../audit-site-tab.js");
  global.renderTabs();

  const auditButton = global.elements.tabs.querySelector('[data-tab-id="audit"]');
  assert.ok(auditButton);
  assert.equal(auditButton.textContent, "Аудит");
  assert.equal(global.state.config.tabs, originalTabs);
  assert.deepEqual(global.state.config.tabs, [{ id: "movement", label: "Движение" }]);
  reset();
});

test("audit view renders panel and keeps only audit tab active", () => {
  setup();
  require("../audit-site-tab.js");
  global.state.activeTab = "audit";
  global.renderTabs();

  const activeTabs = global.elements.tabs.querySelectorAll(".tab.active");
  assert.equal(activeTabs.length, 1);
  assert.equal(activeTabs[0].dataset.tabId, "audit");
  assert.equal(global.elements.tabPanels.children.length, 1);
  assert.equal(global.state.config.tabs.length, 1);
  reset();
});
