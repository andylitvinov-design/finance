"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("manual-orders client requests use sheetsFetch through the manual server route", () => {
  const sheets = fs.readFileSync(path.resolve(__dirname, "../google-sheets.js"), "utf8");
  const orders = fs.readFileSync(path.resolve(__dirname, "../orders.js"), "utf8");

  assert.match(sheets, /withManualServerRoute\("\/api\/manual-orders"/);
  assert.match(sheets, /JSON\.stringify\(\{\s*action:\s*"sheetsFetch"/);
  assert.doesNotMatch(orders, /action:\s*["']getOrders["']/);
});

test("loadDashboardData starts independent manual workbook reads in parallel", async () => {
  const context = createLoadDashboardContext();
  const release = {};
  const started = [];
  const makeGate = (name) => new Promise((resolve) => {
    release[name] = resolve;
    started.push(name);
  });
  context.syncManualFinanceForCurrentPeriod = () => makeGate("finance");
  context.syncManualTransfersForCurrentRange = () => makeGate("transfers");
  context.syncManualOrdersForCurrentRange = () => makeGate("orders");

  const load = context.loadDashboardData();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started.length, 3);
  assert.deepEqual(new Set(started), new Set(["finance", "transfers", "orders"]));
  release.finance();
  release.transfers();
  release.orders();
  await load;
});

test("unsupported manual workbook action cannot keep dashboard in loading state or block expense tab", async () => {
  const context = createLoadDashboardContext();
  context.syncManualFinanceForCurrentPeriod = async () => {};
  context.syncManualTransfersForCurrentRange = async () => {};
  context.syncManualOrdersForCurrentRange = async () => {
    throw new Error("Unsupported manual workbook action.");
  };

  await context.loadDashboardData();

  assert.equal(context.loadingStates.at(-1), false);
  assert.equal(context.renderTabsCalls > 0, true);
  assert.equal(context.renderMetricsCalls > 0, true);
  assert.match(context.statusMessages.at(-1), /browser incoming-data aggregation|loaded/i);
});

function createLoadDashboardContext() {
  const src = fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8");
  const context = {
    elements: {
      startDate: { value: "2026-04-01" },
      endDate: { value: "2026-04-30" }
    },
    state: {
      data: null,
      manualFinance: {},
      manualTransfers: {},
      manualOrders: {}
    },
    loadingStates: [],
    statusMessages: [],
    renderMetricsCalls: 0,
    renderTabsCalls: 0,
    setLoading(value) {
      context.loadingStates.push(value);
    },
    setStatus(message) {
      context.statusMessages.push(message);
    },
    async loadDashboardDataDirect(startDate, endDate) {
      return { period: { startDate, endDate }, tabs: {} };
    },
    hasConfiguredManualFinanceEndpoint() {
      return true;
    },
    async syncManualFinanceForCurrentPeriod() {},
    async syncManualTransfersForCurrentRange() {},
    async syncManualOrdersForCurrentRange() {},
    async applyClientSideDerivedData() {},
    renderMetrics() {
      context.renderMetricsCalls += 1;
    },
    renderTabs() {
      context.renderTabsCalls += 1;
    },
    buildLoadedStatus() {
      return "browser incoming-data aggregation";
    }
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction(src, "loadDashboardData")}\nthis.loadDashboardData = loadDashboardData;`, context);
  return context;
}

function extractFunction(src, name) {
  const start = src.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = src.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < src.length; index += 1) {
    if (src[index] === "{") depth += 1;
    if (src[index] === "}") depth -= 1;
    if (depth === 0) return src.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}
