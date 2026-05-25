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

  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index !== -1) {
      next.parentNode = this;
      previous.parentNode = null;
      this.children[index] = next;
    }
    return previous;
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

test("buildRemaindersSummary prefers audit snapshot remainders rows", () => {
  const api = loadApi();
  const summary = api.buildRemaindersSummary({
    data: {
      balances: {
        remainders_rows: [
          { channel: "Wise EUR", opening_amount_usd: 540, closing_amount_usd: 648, delta_amount_usd: 108 },
        ],
      },
      balance_coverage: {
        rows: [
          { channel: "Old fallback", opening_amount_usd: 1, closing_amount_usd: 2 },
        ],
      },
    },
  });

  assert.equal(summary.source, "data.balances.remainders_rows");
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].channel, "Wise EUR");
  assert.equal(summary.rows[0].openingUsd, 540);
  assert.equal(summary.rows[0].closingUsd, 648);
  assert.equal(summary.rows[0].deltaUsd, 108);
  resetRemaindersModule();
});

test("buildLiveRemaindersSummary fetches audit snapshot when dashboard state has no source", async () => {
  const api = loadApi();
  global.location = { href: "https://ezohata-incoming-ledger.vercel.app/" };
  global.document = {
    getElementById(id) {
      if (id === "startDate") return { value: "2026-05-01" };
      if (id === "endDate") return { value: "2026-05-31" };
      return null;
    },
  };
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return {
          balances: {
            remainders_rows: [
              { channel: "Wise USD", opening_amount_usd: 100, closing_amount_usd: 125 },
            ],
          },
        };
      },
    };
  };

  const summary = await api.buildLiveRemaindersSummary({ data: {} });

  assert.equal(summary.source, "data.balances.remainders_rows");
  assert.equal(summary.rows[0].channel, "Wise USD");
  assert.equal(summary.rows[0].deltaUsd, 25);
  assert.match(requestedUrl, /\/api\/audit-snapshot\?from=2026-05-01&to=2026-05-31$/);
  resetRemaindersModule();
  delete global.location;
  delete global.fetch;
});

test("buildLiveRemaindersSummary fetches audit snapshot instead of trusting manual balance fallback", async () => {
  const api = loadApi();
  global.location = { href: "https://ezohata-incoming-ledger.vercel.app/" };
  global.document = { getElementById: () => null };
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        balances: {
          remainders_rows: [
            { channel: "Audit source", opening_amount_usd: 10, closing_amount_usd: 12 },
          ],
        },
      };
    },
  });

  const summary = await api.buildLiveRemaindersSummary({
    data: {
      manual: {
        balances: [
          { channel: "Manual fallback", closing_amount_usd: 999 },
        ],
      },
    },
  });

  assert.equal(summary.source, "data.balances.remainders_rows");
  assert.equal(summary.rows[0].channel, "Audit source");
  resetRemaindersModule();
  delete global.location;
  delete global.fetch;
});

test("buildLiveRemaindersSummary uses URL period when date inputs are empty", async () => {
  const api = loadApi();
  global.location = { href: "https://ezohata-incoming-ledger.vercel.app/?from=2026-05-01&to=2026-05-31" };
  global.document = { getElementById: () => null };
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return { balances: { remainders_rows: [] } };
      },
    };
  };

  await api.buildLiveRemaindersSummary({ data: {} });

  assert.match(requestedUrl, /\/api\/audit-snapshot\?from=2026-05-01&to=2026-05-31$/);
  resetRemaindersModule();
  delete global.location;
  delete global.fetch;
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

test("remainders popup renders reconcile button", () => {
  const api = loadApi();
  const summary = api.buildRemaindersSummary({
    data: {
      balances: {
        remainders_rows: [
          { channel: "Wise USD", opening_amount_usd: 100, closing_amount_usd: null },
        ],
      },
    },
  });
  const block = api.renderRemaindersSummaryBlock(summary, makeMockDocument());
  const text = collectText(block);

  assert.match(text, /Обновить остатки и пересчитать/);
  resetRemaindersModule();
});

test("reconcile workflow posts selected period and renders structured result", async () => {
  const api = loadApi();
  global.location = { href: "https://ezohata-incoming-ledger.vercel.app/" };
  global.document = {
    getElementById(id) {
      if (id === "startDate") return { value: "2026-05-01" };
      if (id === "endDate") return { value: "2026-05-31" };
      return null;
    },
  };
  let requestedUrl = "";
  let requestedBody = null;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          ok: true,
          providers_checked: ["wise", "monobank"],
          balances_pulled: 2,
          transfers_imported: 3,
          computed_rows_count: 1,
          provider_failures: [{ provider: "paypal", error: "PayPal permission missing" }],
          needs_verification_rows: [{ channel: "Payoneer - dol", currency: "USD", reason: "missing closing_usd" }],
          audit_snapshot: {
            balances: {
              remainders_rows: [
                { channel: "Computed", opening_amount_usd: 1, closing_amount_usd: 2, computed_balance: true, factual_provider_balance: false },
              ],
            },
          },
        });
      },
    };
  };

  const result = await api.runBalanceReconcileWorkflow();
  const panel = api.renderReconcileResult(result, makeMockDocument());

  assert.match(requestedUrl, /\/api\/reconcile-balances-and-transfers$/);
  assert.deepEqual(requestedBody, { from: "2026-05-01", to: "2026-05-31" });
  assert.match(collectText(panel), /providers checked: wise, monobank/);
  assert.match(collectText(panel), /balances pulled: 2/);
  assert.match(collectText(panel), /transfers imported: 3/);
  assert.match(collectText(panel), /computed rows: 1/);
  assert.match(collectText(panel), /Payoneer - dol USD: missing closing_usd/);
  assert.match(collectText(panel), /paypal: PayPal permission missing/);
  resetRemaindersModule();
  delete global.location;
  delete global.fetch;
});

test("provider non-json failures render safe structured errors", async () => {
  const api = loadApi();
  global.location = { href: "https://ezohata-incoming-ledger.vercel.app/" };
  global.document = { getElementById: () => null };
  global.fetch = async () => ({
    ok: false,
    status: 502,
    async text() {
      return "<html>bad gateway</html>";
    },
  });

  await assert.rejects(
    () => api.runBalanceReconcileWorkflow(),
    /reconcile-balances-and-transfers returned non-JSON response \(502\): <html>bad gateway<\/html>/
  );
  resetRemaindersModule();
  delete global.location;
  delete global.fetch;
});

test("computed rows remain computed and not factual after reconcile payload", () => {
  const api = loadApi();
  const result = {
    computed_rows_count: 1,
    computed_rows_factual_conflicts: 0,
    audit_snapshot: {
      balances: {
        remainders_rows: [
          {
            channel: "монобанк грн",
            opening_amount_usd: 10,
            closing_amount_usd: 12,
            computed_balance: true,
            factual_provider_balance: false,
          },
        ],
      },
    },
  };
  const summary = api.buildRemaindersSummary(result.audit_snapshot);

  assert.equal(result.computed_rows_factual_conflicts, 0);
  assert.equal(summary.rows[0].channel, "монобанк грн");
  assert.equal(summary.rows[0].closingUsd, 12);
  resetRemaindersModule();
});

test("remainders table has a mobile horizontal scroll container", () => {
  const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");

  assert.match(styleCss, /\.remainders-summary-table-wrap\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(styleCss, /\.remainders-summary-table-wrap\s*\{[^}]*-webkit-overflow-scrolling:\s*touch;/s);
  assert.match(styleCss, /\.remainders-summary-table-wrap table\s*\{[^}]*min-width:\s*760px;/s);
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
