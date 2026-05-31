const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const guardJs = fs.readFileSync(path.join(root, "monthly-plan-visible-fix.js"), "utf8");

function createNode(className = "") {
  const node = {
    className,
    children: [],
    parentNode: null,
    removed: false,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    prepend(child) {
      child.parentNode = this;
      this.children.unshift(child);
      return child;
    },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.children.indexOf(before);
      if (index === -1) this.children.push(child);
      else this.children.splice(index, 0, child);
      return child;
    },
    remove() {
      this.removed = true;
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    },
    querySelector(selector) {
      if (selector === ".finance-status") return this.children.find((child) => child.className === "finance-status") || null;
      if (selector === "#monthly-plan-expense-balance") return this.children.find((child) => child.id === "monthly-plan-expense-balance") || null;
      return null;
    },
  };
  return node;
}

test("index loads monthly plan visibility guard after monthly-plan core", () => {
  const monthlyPlanIndex = indexHtml.indexOf("./monthly-plan.js");
  const guardIndex = indexHtml.indexOf("./monthly-plan-visible-fix.js");
  assert.ok(monthlyPlanIndex > 0, "monthly-plan.js must be loaded");
  assert.ok(guardIndex > monthlyPlanIndex, "visibility guard must load after monthly-plan.js");
});

test("monthly plan visibility guard exposes deterministic tab functions", () => {
  assert.match(guardJs, /function ensureMonthlyPlanTabButton\(\)/);
  assert.match(guardJs, /globalThis\.ensureMonthlyPlanTabButton = ensureMonthlyPlanTabButton/);
  assert.match(guardJs, /globalThis\.openMonthlyPlanTab = openMonthlyPlanTab/);
  assert.match(guardJs, /globalThis\.insertMonthlyPlanExpenseBalance = insertMonthlyPlanExpenseBalance/);
  assert.match(guardJs, /План/);
});

test("visibility guard inserts expense balance section after Plan status", () => {
  const context = {
    state: { activeTab: "monthlyPlan" },
    elements: {
      tabs: {
        querySelectorAll() { return []; },
        appendChild() {},
      },
      tabPanels: { innerHTML: "", appendChild() {} },
    },
    document: {
      createElement(tag) {
        return createNode(tag);
      },
    },
    window: {
      setInterval() { return 1; },
      clearInterval() {},
      addEventListener() {},
    },
    renderMonthlyPlanBlock() {},
    refreshGoogleControlsVisibility() {},
    MonthlyPlanExpenseBalance: {
      renderMonthlyPlanExpenseBalance() {
        const section = createNode("expense-section");
        section.id = "monthly-plan-expense-balance";
        return section;
      },
    },
  };
  context.globalThis = context;
  const vm = require("node:vm");
  vm.createContext(context);
  vm.runInContext(guardJs, context, { filename: "monthly-plan-visible-fix.js" });

  const block = createNode("finance-shell");
  const status = createNode("finance-status");
  const grid = createNode("monthly-plan-grid");
  block.appendChild(status);
  block.appendChild(grid);

  assert.equal(context.insertMonthlyPlanExpenseBalance(block), true);
  assert.equal(block.children[0], status);
  assert.equal(block.children[1].id, "monthly-plan-expense-balance");
  assert.equal(block.children[2], grid);
});
