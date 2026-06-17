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
    this._innerHTML = "";
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

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
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

function buildBalancePairRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    channel: index === 0 ? "БАНК КАНАДА cad" : `channel ${index + 1}`,
    currency: index === 0 ? "CAD" : "USD",
    start: { status: "ok", amount: index + 1, rate_to_usd: 1, amount_usd: index + 1, source_sheet: "Остатки", source_row: index + 10 },
    end: { status: "ok", amount: index + 2, rate_to_usd: 1, amount_usd: index + 2, source_sheet: "Авто Остатки", source_row: index + 20 },
  }));
}

function setupBalancePairsHarness({
  payload,
  body,
  statusCode = 200,
  ok = statusCode >= 200 && statusCode < 300,
  contentType = "application/json; charset=utf-8",
  from = "2026-04-01",
  to = "2026-04-30",
}) {
  resetModule();
  const content = new TestElement("div");
  const status = new TestElement("div");
  const startDate = new TestElement("input");
  startDate.value = from;
  const endDate = new TestElement("input");
  endDate.value = to;
  global.document = makeDocument({ startDate, endDate });
  global.window = global;
  global.state = {
    activeTab: "balancePairs",
    config: { tabs: [{ id: "movement", label: "Движение" }] },
  };
  global.elements = { startDate, endDate, tabPanels: new TestElement("div") };
  global.renderTabs = () => null;
  global.MutationObserver = class {
    observe() {}
  };
  global.fetch = async (url) => {
    assert.match(String(url), new RegExp(`/api/balance-pairs\\?from=${from}&to=${to}`));
    return {
      ok,
      status: statusCode,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-type" ? contentType : "";
        },
      },
      async text() {
        return body ?? JSON.stringify(payload);
      },
    };
  };
  const api = require("../balance-pairs-tab.js");
  return { api, content, status };
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
    const payload = {
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
          start: { amount: 35.3, rate_to_usd: 1, amount_usd: 35.3, status: "ok", snapshot_date: "2026-06-01", source_sheet: "Остатки", source_row: 12, source: "manual_fact", source_note: "Остатки #12 · manual_fact" },
          end: { status: "missing_snapshot", message: "missing snapshot" },
        },
        {
          channel: "Яндекс руб",
          currency: "RUB",
          start: { status: "missing_snapshot", message: "missing snapshot" },
          end: { amount: 993.15, status: "missing_fx", message: "missing FX RUB 2026-06-16", snapshot_date: "2026-06-16", source_sheet: "Авто Остатки", source_row: 44, source: "provider_auto", source_note: "Авто Остатки #44 · provider_auto" },
        },
      ],
      diagnostics: {
        missing_snapshot_rows: [
          {
            channel: "Яндекс руб",
            currency: "RUB",
            missing_start: true,
            missing_end: false,
            reason: "no snapshot found on or before start date",
          },
        ],
        copyable_missing_snapshot_rows: "channel\tcurrency\tmissing_start\tmissing_end\treason\nЯндекс руб\tRUB\ttrue\tfalse\tno snapshot found on or before start date",
      },
    };
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-type" ? "application/json; charset=utf-8" : "";
        },
      },
      async text() {
        return JSON.stringify(payload);
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
  assert.match(text, /source1/);
  assert.match(text, /sourceRow1/);
  assert.match(text, /Остатки #12 · manual_fact/);
  assert.match(text, /Авто Остатки #44 · provider_auto/);
  assert.match(text, /Missing snapshots: 1/);
  assert.match(text, /no snapshot found on or before start date/);
  assert.match(text, /missing snapshot/);
  assert.match(text, /missing FX RUB 2026-06-16/);
  assert.doesNotMatch(text, /needs verification/i);
  resetModule();
});

test("HTTP 200 with 37 rows renders diagnostics, summary, and table", async () => {
  const payload = {
    ok: true,
    period: { from: "2026-04-01", to: "2026-04-30" },
    summary: {
      expected_rows: 37,
      found_start_rows: 3,
      found_end_rows: 16,
      missing_start_rows: 34,
      missing_end_rows: 21,
      usd_complete_start: 3,
      usd_complete_end: 16,
      fx_missing: 0,
    },
    rows: buildBalancePairRows(37),
  };
  const { api, content, status } = setupBalancePairsHarness({ payload });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 200 · rows 37 · summary yes/);
  assert.match(text, /url: \/api\/balance-pairs\?from=2026-04-01&to=2026-04-30/);
  assert.match(text, /status: 200/);
  assert.match(text, /content-type: application\/json; charset=utf-8/);
  assert.match(text, /rows: 37/);
  assert.match(text, /summary: yes/);
  assert.match(text, /payload keys: ok, period, summary, rows/);
  assert.match(text, /Ожидаемых строк: 37/);
  assert.match(text, /Канал/);
  assert.match(text, /Валюта/);
  assert.match(text, /Остатки вал1/);
  assert.match(text, /Курс1/);
  assert.match(text, /Остатки usd1/);
  assert.match(text, /source1/);
  assert.match(text, /sourceRow1/);
  assert.match(text, /Остатки вал2/);
  assert.match(text, /Курс2/);
  assert.match(text, /Остатки usd2/);
  assert.match(text, /source2/);
  assert.match(text, /sourceRow2/);
  assert.match(text, /БАНК КАНАДА cad/);
  assert.ok(content.querySelector(".balance-pairs-content"));
  assert.ok(content.querySelector("table"));
  resetModule();
});

test("HTTP 200 empty body shows body diagnostics instead of generic HTTP 200", async () => {
  const { api, content, status } = setupBalancePairsHarness({ body: "" });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 200 · rows missing · summary no/);
  assert.match(text, /url: \/api\/balance-pairs\?from=2026-04-01&to=2026-04-30/);
  assert.match(text, /status: 200/);
  assert.match(text, /content-type: application\/json; charset=utf-8/);
  assert.match(text, /rows: missing/);
  assert.match(text, /summary: no/);
  assert.match(text, /payload keys: none/);
  assert.match(text, /body excerpt:/);
  assert.match(text, /render error: balance-pairs empty payload/);
  assert.notEqual(status.textContent, "balance-pairs HTTP 200");
  assert.equal(content.querySelector(".balance-pairs-content"), null);
  resetModule();
});

test("HTTP 200 HTML body shows content-type, parse error, and body excerpt", async () => {
  const body = "<!doctype html><html><body>Not JSON from edge</body></html>";
  const { api, content, status } = setupBalancePairsHarness({
    body,
    contentType: "text/html; charset=utf-8",
  });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 200 · rows missing · summary no/);
  assert.match(text, /content-type: text\/html; charset=utf-8/);
  assert.match(text, /parse error:/);
  assert.match(text, /body excerpt: <!doctype html><html><body>Not JSON from edge/);
  assert.match(text, /render error: balance-pairs parse error:/);
  assert.notEqual(status.textContent, "balance-pairs HTTP 200");
  assert.equal(content.querySelector(".balance-pairs-content"), null);
  resetModule();
});

test("HTTP 200 with payload.rows missing shows payload-shape diagnostics", async () => {
  const payload = {
    ok: true,
    period: { from: "2026-04-01", to: "2026-04-30" },
    summary: { expected_rows: 37 },
    balance_pairs: { rows: buildBalancePairRows(37) },
  };
  const { api, content, status } = setupBalancePairsHarness({ payload });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 200 · rows missing · summary yes/);
  assert.match(text, /rows: missing/);
  assert.match(text, /summary: yes/);
  assert.match(text, /payload keys: ok, period, summary, balance_pairs/);
  assert.match(text, /body excerpt: .*"balance_pairs"/);
  assert.match(text, /render error: balance-pairs payload\.rows missing/);
  assert.equal(content.querySelector(".balance-pairs-content"), null);
  resetModule();
});

test("HTTP 200 with payload ok false shows warnings, error, and diagnostics", async () => {
  const payload = {
    ok: false,
    status: "repository_failed",
    error: "Manual Google Sheets overlay failed: permission denied",
    warnings: [
      "manual Google Sheets read failed",
      "Auto balance sheet failed: permission denied",
    ],
    diagnostics: {
      source_route: "balance-pairs",
      manual_balances_loaded: 0,
      auto_balances_loaded: 0,
      env_config_missing: false,
    },
    period: { from: "2026-04-01", to: "2026-04-30" },
    summary: { expected_rows: 0 },
    rows: [],
  };
  const { api, content, status } = setupBalancePairsHarness({ payload });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 200 · rows 0 · summary yes/);
  assert.match(text, /payload error: Manual Google Sheets overlay failed: permission denied/);
  assert.match(text, /payload warning: manual Google Sheets read failed/);
  assert.match(text, /payload warning: Auto balance sheet failed: permission denied/);
  assert.match(text, /payload diagnostic source_route: balance-pairs/);
  assert.match(text, /payload diagnostic manual_balances_loaded: 0/);
  assert.match(text, /render error: Manual Google Sheets overlay failed: permission denied/);
  assert.notEqual(status.textContent, "balance-pairs HTTP 200");
  assert.equal(content.querySelector(".balance-pairs-content"), null);
  resetModule();
});

test("ok=false renders contract diagnostics and source_status (issue #552)", async () => {
  const payload = {
    ok: false,
    status: "repository_failed",
    source_status: "unavailable",
    error: "Manual Google Sheets overlay failed: 429 rate limited",
    warnings: ["manual Google Sheets read failed", "Auto balance sheet failed: 503"],
    diagnostics: {
      source_route: "balance-pairs",
      source_status: "unavailable",
      manual_repository_ok: false,
      manual_repository_warning: "Manual Google Sheets overlay failed: 429 rate limited",
      manual_balance_rows_loaded: 0,
      auto_balance_rows_loaded: 0,
      fx_rates_rows_loaded: 0,
    },
    period: { from: "2026-06-01", to: "2026-06-17" },
    summary: { expected_rows: 0 },
    rows: [],
  };
  const { api, content, status } = setupBalancePairsHarness({ payload, from: "2026-06-01", to: "2026-06-17" });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(text, /payload diagnostic source_status: unavailable/);
  assert.match(text, /payload diagnostic manual_repository_ok: false/);
  assert.match(text, /payload diagnostic auto_balance_rows_loaded: 0/);
  assert.match(text, /payload diagnostic fx_rates_rows_loaded: 0/);
  assert.match(text, /render error: Manual Google Sheets overlay failed: 429 rate limited/);
  assert.equal(content.querySelector(".balance-pairs-content"), null);
  resetModule();
});

test("ok=false without error field falls back to warnings, never bare payload ok=false", async () => {
  const payload = {
    ok: false,
    status: "repository_failed",
    warnings: ["manual Google Sheets read failed", "Auto balance sheet failed: 503"],
    diagnostics: { source_status: "unavailable", manual_repository_ok: false },
    period: { from: "2026-06-01", to: "2026-06-17" },
    summary: {},
    rows: [],
  };
  const { api, content, status } = setupBalancePairsHarness({ payload, from: "2026-06-01", to: "2026-06-17" });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(text, /render error: balance-pairs ok=false: manual Google Sheets read failed; Auto balance sheet failed: 503/);
  assert.doesNotMatch(text, /render error: balance-pairs payload ok=false/);
  assert.match(text, /payload warning: manual Google Sheets read failed/);
  resetModule();
});

test("HTTP 500 JSON error shows status and payload error", async () => {
  const payload = { ok: false, error: "backend exploded" };
  const { api, content, status } = setupBalancePairsHarness({ payload, statusCode: 500 });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 500 · rows missing · summary no/);
  assert.match(text, /status: 500/);
  assert.match(text, /content-type: application\/json; charset=utf-8/);
  assert.match(text, /payload keys: ok, error/);
  assert.match(text, /payload error: backend exploded/);
  assert.match(text, /body excerpt: \{"ok":false,"error":"backend exploded"\}/);
  assert.match(text, /render error: backend exploded/);
  assert.equal(content.querySelector(".balance-pairs-content"), null);
  resetModule();
});

test("HTTP 200 with render exception shows render error", async () => {
  const payload = {
    ok: true,
    period: { from: "2026-04-01", to: "2026-04-30" },
    summary: { expected_rows: 1 },
    rows: buildBalancePairRows(1),
  };
  const { api, content, status } = setupBalancePairsHarness({ payload });
  const createElement = global.document.createElement;
  global.document.createElement = (tag) => {
    if (tag === "table") throw new Error("table render exploded");
    return createElement(tag);
  };

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 200 · rows 1 · render error/);
  assert.match(text, /rows: 1/);
  assert.match(text, /summary: yes/);
  assert.match(text, /render error: table render exploded/);
  assert.equal(content.querySelector(".balance-pairs-content"), null);
  resetModule();
});

test("HTTP status alone is not a successful balance-pairs render", async () => {
  const payload = {
    ok: true,
    period: { from: "2026-04-01", to: "2026-04-30" },
    summary: { expected_rows: 0 },
    rows: [],
  };
  const { api, content, status } = setupBalancePairsHarness({ payload });

  await api.loadBalancePairsTabContent(content, status);

  const text = collectText(content);
  assert.match(status.textContent, /balance-pairs HTTP 200 · rows 0 · summary yes/);
  assert.match(text, /rows: 0/);
  assert.match(text, /summary: yes/);
  assert.match(text, /Нет balance-pairs строк за выбранный период/);
  assert.ok(content.querySelector(".balance-pairs-content"));
  assert.ok(content.textContent !== status.textContent);
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
  const payload = {
    ok: true,
    period: { from: "2026-06-01", to: "2026-06-17" },
    summary: { expected_rows: 1 },
    rows: [
      {
        channel: "пейпал дол",
        currency: "USD",
        start: { status: "ok", amount: 25, rate_to_usd: 1, amount_usd: 25, source_sheet: "Остатки", source_row: 7 },
        end: { status: "ok", amount: 40, rate_to_usd: 1, amount_usd: 40, source_sheet: "Авто Остатки", source_row: 8 },
      },
    ],
  };
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/json; charset=utf-8" : "";
      },
    },
    async text() {
      return JSON.stringify(payload);
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
  assert.match(text, /sourceRow2/);
  assert.match(text, /пейпал дол/);
  assert.doesNotMatch(text, /УСЛУГИ МНЕ/);
  assert.equal(activePanel.querySelector(".services-me-layer-block"), null);
  assert.ok(activePanel.querySelector(".balance-pairs-content"));

  resetModule();
});
