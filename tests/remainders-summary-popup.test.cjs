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
    this.disabled = false;
    this.textContent = "";
    this.listeners = {};
    this.nextSibling = null;
    this.attributes = {};
    this.scrollCalls = [];
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

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  querySelector(selector) {
    if (selector === ".remainders-summary-table-wrap" && this.className.split(/\s+/).includes("remainders-summary-table-wrap")) {
      return this;
    }
    for (const child of this.children) {
      const found = child.querySelector?.(selector);
      if (found) return found;
    }
    return null;
  }

  scrollBy(options) {
    this.scrollCalls.push(options);
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

function createDateDocument({ from = "2026-05-17", to = "2026-05-17" } = {}) {
  return {
    createElement(tag) {
      return new TestElement(tag);
    },
    getElementById(id) {
      if (id === "startDate") return { value: from };
      if (id === "endDate") return { value: to };
      return null;
    },
  };
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
      balances: {
        rows: [
          { channel: "PayPal", opening_amount_usd: "100", closing_amount_usd: "125" },
          { paymentChannel: "Wise", startUsd: "200,50", endUsd: "150,25", deltaUsd: "999" },
        ],
      },
      balance_coverage: {
        rows: [
          { channel: "Diagnostic fallback", opening_amount_usd: "1", closing_amount_usd: "2" },
        ],
      },
    },
  });

  assert.equal(summary.source, "data.balances.rows");
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

test("buildLiveRemaindersSummary fetches selected-date balance snapshots for Остатки popup", async () => {
  const api = loadApi();
  global.location = { href: "https://ezohata-incoming-ledger.vercel.app/" };
  global.document = createDateDocument({ from: "2026-05-01", to: "2026-05-17" });
  const requestedUrls = [];
  global.fetch = async (url) => {
    requestedUrls.push(url);
    if (/\/api\/balance-snapshots/.test(url)) {
      return {
        ok: true,
        async json() {
          return {
            balance_snapshots: {
              selected_date: "2026-05-17",
              selected_date_source: "merged",
              selected_date_rows: [
                { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: 870.42 },
              ],
              selected_date_diagnostics: [],
            },
          };
        },
      };
    }
    if (/\/api\/period-balance-reconciliation/.test(url)) {
      return {
        ok: true,
        async json() {
          return {
            period_balance_reconciliation: {
              by_channel_currency: [
                { channel: "трансервайз дол", currency: "USD", real_delta: 25 },
              ],
            },
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { balances: { remainders_rows: [] } };
      },
    };
  };

  const summary = await api.buildLiveRemaindersSummary({ data: {} });

  assert.equal(summary.selectedDateSnapshot.selected_date, "2026-05-17");
  assert.equal(summary.selectedDateSnapshot.selected_date_source, "merged");
  assert.ok(requestedUrls.some((url) =>
    /\/api\/balance-snapshots\?from=2026-05-01&to=2026-05-17$/.test(url)
  ));
  assert.ok(requestedUrls.some((url) =>
    /\/api\/period-balance-reconciliation\?from=2026-05-01&to=2026-05-17$/.test(url)
  ));
  resetRemaindersModule();
  delete global.location;
  delete global.fetch;
});

test("remainders popup renders selected-date channel currency balances", () => {
  const api = loadApi();
  const block = api.renderRemaindersSummaryBlock({
    ...api.buildRemaindersSummary({ balances: { remainders_rows: [] } }),
    selectedDateSnapshot: {
      selected_date: "2026-05-17",
      selected_date_source: "merged",
      selected_date_rows: [
        { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: 870.42 },
      ],
      selected_date_diagnostics: [],
    },
  }, makeMockDocument());
  const text = collectText(block);

  assert.match(text, /Остатки на выбранную дату/);
  assert.match(text, /Остатки сохранены на дату: 2026-05-17/);
  assert.doesNotMatch(text, /2026-05-17 · merged/);
  assert.doesNotMatch(text, /merged/);
  assert.match(text, /трансервайз дол/);
  assert.match(text, /870,42/);
  assert.match(text, /ИТОГО USD/);
  assert.doesNotMatch(text, /Дата/);
  resetRemaindersModule();
});

test("remainders popup renders period balance changes from saved snapshots and amount_net movement", () => {
  const api = loadApi();
  const block = api.renderRemaindersSummaryBlock({
    ...api.buildRemaindersSummary({
      balances: {
        remainders_rows: [
          { channel: "Diagnostic row", currency: "USD", closing_amount_usd: null },
        ],
      },
    }),
    selectedDateSnapshot: {
      period_from: "2026-05-01",
      period_to: "2026-05-17",
      selected_date: "2026-05-17",
      selected_date_rows: [
        { date: "2026-05-17", channel: "Wise USD", currency: "USD", amount: 125 },
        { date: "2026-05-17", channel: "Wise EUR", currency: "EUR", amount: 40 },
      ],
      rows: [
        { date: "2026-05-01", channel: "Wise USD", currency: "USD", amount: 100 },
        { date: "2026-05-01", channel: "Wise EUR", currency: "EUR", amount: 50 },
        { date: "2026-05-17", channel: "Wise USD", currency: "USD", amount: 125 },
        { date: "2026-05-17", channel: "Wise EUR", currency: "EUR", amount: 40 },
      ],
    },
    periodMovementRows: [
      { channel: "Wise USD", currency: "USD", real_delta: 20 },
      { channel: "Wise EUR", currency: "EUR", real_delta: -10 },
      { channel: "Only movement", currency: "USD", real_delta: 7 },
    ],
  }, makeMockDocument());
  const text = collectText(block);
  const diagnostics = block.children.find((child) => child.tag === "details");

  assert.match(text, /Изменение за период/);
  assert.match(text, /Остаток на начало/);
  assert.match(text, /Остаток на конец/);
  assert.match(text, /Движение средств/);
  assert.match(text, /Остаток плановый/);
  assert.match(text, /Остаток фактический/);
  assert.match(text, /Расхождение/);
  assert.match(text, /Wise USD/);
  assert.match(text, /25/);
  assert.match(text, /20/);
  assert.match(text, /120/);
  assert.match(text, /5/);
  assert.match(text, /Only movement/);
  assert.match(text, /ИТОГО USD/);
  assert.match(text, /ИТОГО EUR/);
  assert.doesNotMatch(collectText(diagnostics), /Изменение за период/);
  assert.doesNotMatch(text.replace(collectText(diagnostics), ""), /needs verification/);
  resetRemaindersModule();
});

test("remainders popup renders selected-date partial coverage warning", () => {
  const api = loadApi();
  const block = api.renderRemaindersSummaryBlock({
    ...api.buildRemaindersSummary({ balances: { remainders_rows: [] } }),
    selectedDateSnapshot: {
      selected_date: "2026-05-26",
      selected_date_source: "merged",
      selected_date_rows: [
        { date: "2026-05-26", channel: "трансервайз дол", currency: "USD", amount: 870.42 },
      ],
      selected_date_coverage: {
        expected_rows: 23,
        unique_channel_currency_count: 22,
        missing_channels: ["Binance funding|USDT"],
        duplicate_channel_currency_count: 0,
        status: "partial",
      },
      selected_date_diagnostics: [],
    },
  }, makeMockDocument());
  const text = collectText(block);

  assert.match(text, /Частичное покрытие: 22 из 23/);
  assert.match(text, /Binance funding\|USDT/);
  resetRemaindersModule();
});

test("remainders planned needs-verification table is rendered as collapsed diagnostics", () => {
  const api = loadApi();
  const block = api.renderRemaindersSummaryBlock(api.buildRemaindersSummary({
    balances: {
      remainders_rows: [
        { channel: "Missing opening", currency: "USD", closing_amount_usd: 10, movement_usd: 10 },
      ],
    },
  }), makeMockDocument());

  const diagnostics = block.children.find((child) => child.tag === "details");
  assert.ok(diagnostics);
  assert.equal(diagnostics.open, false);
  assert.match(collectText(diagnostics), /Диагностика сверки/);
  assert.match(collectText(diagnostics), /Missing opening/);
  resetRemaindersModule();
});

test("selected-date balances resolve multiple snapshot amount field names", () => {
  const api = loadApi();
  const block = api.renderRemaindersSummaryBlock({
    ...api.buildRemaindersSummary({ balances: { remainders_rows: [] } }),
    selectedDateSnapshot: {
      selected_date: "2026-05-20",
      selected_date_source: "merged",
      selected_date_rows: [
        { date: "2026-05-20", channel: "amount row", currency: "USD", amount: 1 },
        { date: "2026-05-20", channel: "balance row", currency: "USD", balance: 2 },
        { date: "2026-05-20", channel: "amount usd row", currency: "USD", amount_usd: 3 },
        { date: "2026-05-20", channel: "balance usd row", currency: "USD", balance_usd: 4 },
        { date: "2026-05-20", channel: "closing row", currency: "USD", closing_amount_usd: 5 },
        { date: "2026-05-20", channel: "end row", currency: "USD", end_amount_usd: 6 },
      ],
      selected_date_diagnostics: [],
    },
  }, makeMockDocument());
  const text = collectText(block);

  assert.equal(api.getSnapshotAmount({ amount: 1 }), 1);
  assert.equal(api.getSnapshotAmount({ balance: 2 }), 2);
  assert.equal(api.getSnapshotAmount({ amount_usd: 3 }), 3);
  assert.equal(api.getSnapshotAmount({ balance_usd: 4 }), 4);
  assert.equal(api.getSnapshotAmount({ closing_amount_usd: 5 }), 5);
  assert.equal(api.getSnapshotAmount({ end_amount_usd: 6 }), 6);
  assert.match(text, /1/);
  assert.match(text, /2/);
  assert.match(text, /3/);
  assert.match(text, /4/);
  assert.match(text, /5/);
  assert.match(text, /6/);
  resetRemaindersModule();
});

test("remainders popup renders guarded backfill diagnostic for missing selected-date balances", () => {
  const api = loadApi();
  const block = api.renderRemaindersSummaryBlock({
    ...api.buildRemaindersSummary({ balances: { remainders_rows: [] } }),
    selectedDateSnapshot: {
      selected_date: "2026-05-17",
      selected_date_source: "none",
      selected_date_rows: [],
      selected_date_diagnostics: [
        "No balance snapshot for this date; run guarded May backfill.",
        "Ignored 2 stale current-only auto rows for 2026-05-17.",
      ],
    },
  }, makeMockDocument());
  const text = collectText(block);

  assert.match(text, /No balance snapshot for this date; run guarded May backfill\./);
  assert.match(text, /Ignored 2 stale current-only auto rows/);
  assert.doesNotMatch(text, /остатки не найдены/i);
  resetRemaindersModule();
});

test("balance coverage diagnostics are not selected as visible remainders rows", () => {
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

  assert.equal(summary.source, null);
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.needsVerificationCount, 0);
  assert.match(text, /Канал/);
  assert.match(text, /ИТОГО/);
  assert.match(text, /source not found for remainders summary/);
  assert.doesNotMatch(text, /Missing opening/);
  assert.doesNotMatch(text, /Missing closing/);
  assert.equal(summary.totals.openingUsd, 0);
  assert.equal(summary.totals.closingUsd, 0);
  assert.equal(summary.totals.deltaUsd, 0);
  resetRemaindersModule();
});

test("actual remainders rows still render needs verification without inventing balances", () => {
  const api = loadApi();
  const summary = api.buildRemaindersSummary({
    balances: {
      remainders_rows: [
        { account: "Missing opening", closingUsd: 10, movement_usd: 10 },
        { wallet: "Missing closing", openingUsd: 10 },
      ],
    },
  });
  const block = api.renderRemaindersSummaryBlock(summary, makeMockDocument());
  const text = collectText(block);

  assert.equal(summary.needsVerificationCount, 2);
  assert.match(text, /Missing opening/);
  assert.match(text, /Missing closing/);
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

  assert.match(requestedUrl, /\/api\/index\?action=reconcileBalancesAndTransfers$/);
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

test("reconcile button refetches selected-date balance snapshots after successful POST", async () => {
  const api = loadApi();
  global.location = { href: "https://ezohata-incoming-ledger.vercel.app/" };
  global.document = createDateDocument({ from: "2026-05-01", to: "2026-05-20" });
  const requested = [];
  global.fetch = async (url, options = {}) => {
    requested.push({ url, method: options.method || "GET" });
    if (options.method === "POST") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            providers_checked: ["wise"],
            balances_pulled: 1,
            transfers_imported: 0,
            computed_rows_count: 0,
            provider_failures: [],
            needs_verification_rows: [],
            audit_snapshot: {
              balances: {
                remainders_rows: [
                  { channel: "Audit row", currency: "USD", opening_amount_usd: 1, closing_amount_usd: 2 },
                ],
              },
            },
          });
        },
      };
    }
    if (/\/api\/balance-snapshots/.test(url)) {
      return {
        ok: true,
        async json() {
          return {
            balance_snapshots: {
              selected_date: "2026-05-20",
              selected_date_source: "merged",
              selected_date_rows: [
                { date: "2026-05-20", channel: "Saved selected row", currency: "USD", amount: 827 },
              ],
              selected_date_diagnostics: [],
            },
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { balances: { remainders_rows: [] } };
      },
    };
  };
  const parent = new TestElement("div");
  const block = api.renderRemaindersSummaryBlock(api.buildRemaindersSummary({
    balances: {
      remainders_rows: [
        { channel: "Initial row", currency: "USD", opening_amount_usd: 1, closing_amount_usd: 1 },
      ],
    },
  }), makeMockDocument());
  parent.appendChild(block);

  await block.children[1].children[0].listeners.click();
  const text = collectText(parent.children[0]);

  assert.ok(requested.some((entry) =>
    entry.method === "POST" && /\/api\/index\?action=reconcileBalancesAndTransfers$/.test(entry.url)
  ));
  assert.ok(requested.some((entry) =>
    entry.method === "GET" && /\/api\/balance-snapshots\?from=2026-05-01&to=2026-05-20$/.test(entry.url)
  ));
  assert.match(text, /Saved selected row/);
  assert.match(text, /827/);
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

test("remainders popup renders movement and planned balance columns", () => {
  const api = loadApi();
  const summary = api.buildRemaindersSummary({
    balances: {
      remainders_rows: [
        {
          channel: "Wise USD",
          opening_amount_usd: 100,
          closing_amount_usd: null,
          movement_usd: 25,
          planned_closing_amount_usd: 125,
          planned_balance_computed: true,
        },
      ],
    },
  });
  const block = api.renderRemaindersSummaryBlock(summary, makeMockDocument());
  const text = collectText(block);

  assert.match(text, /Движение средств/);
  assert.match(text, /Остатки плановые/);
  assert.match(text, /25,0000/);
  assert.match(text, /125,0000/);
  assert.match(text, /плановые остатки расчетные/i);
  resetRemaindersModule();
});

test("remainders popup renders currency column and same channel currencies distinctly", () => {
  const api = loadApi();
  const summary = api.buildRemaindersSummary({
    balances: {
      remainders_rows: [
        {
          channel: "binance save",
          currency: "USDT",
          opening_amount_usd: 7432,
          closing_amount_usd: 5411.5338,
        },
        {
          channel: "binance save",
          currency: "USDC",
          opening_amount_usd: null,
          closing_amount_usd: null,
        },
      ],
    },
  });
  const block = api.renderRemaindersSummaryBlock(summary, makeMockDocument());
  const text = collectText(block);

  assert.match(text, /Валюта/);
  assert.match(text, /USDT/);
  assert.match(text, /USDC/);
  assert.deepEqual(summary.rows.map((row) => `${row.channel}/${row.currency}`), [
    "binance save/USDT",
    "binance save/USDC",
  ]);
  resetRemaindersModule();
});

test("reconcile result summary is rendered as grouped sections", () => {
  const api = loadApi();
  const panel = api.renderReconcileResult({
    providers_checked: ["wise", "paypal"],
    balances_pulled: 2,
    transfers_imported: 3,
    computed_rows_count: 1,
    provider_failures: [{ provider: "paypal", error: "OAuth failed" }],
    needs_verification_rows: [
      { channel: "Payoneer", currency: "USD", reason: "missing anchor" },
    ],
  }, makeMockDocument());
  const text = collectText(panel);

  assert.match(text, /Итог обновления/);
  assert.match(text, /Провайдеры/);
  assert.match(text, /Нужна проверка/);
  assert.match(text, /paypal: OAuth failed/);
  assert.ok(panel.children.length >= 3);
  resetRemaindersModule();
});

test("remainders table has a mobile horizontal scroll container", () => {
  const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");
  const mobileCss = fs.readFileSync(path.join(root, "mobile-finance-table-scroll.css"), "utf8");

  assert.match(styleCss, /\.page\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*hidden;/s);
  assert.match(styleCss, /\.hero\s*>\s*\*,\s*\.controls\s*>\s*\*,\s*\.metrics\s*>\s*\*\s*\{[^}]*min-width:\s*0;/s);
  assert.match(styleCss, /\.actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
  assert.match(styleCss, /\.hero\s*\{[^}]*overflow:\s*visible;/s);
  assert.match(styleCss, /\.remainders-summary-block\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*visible;/s);
  assert.match(styleCss, /\.remainders-summary-table-wrap\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*justify-self:\s*stretch;[^}]*overflow-x:\s*scroll;/s);
  assert.match(styleCss, /\.remainders-summary-table-wrap\s*\{[^}]*-webkit-overflow-scrolling:\s*touch;/s);
  assert.match(styleCss, /\.remainders-summary-table-wrap table\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*1040px;/s);
  assert.match(styleCss, /\.remainders-summary-table-wrap th,\s*\.remainders-summary-table-wrap td\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(styleCss, /\.remainders-summary-table-wrap table tr > :first-child\s*\{[^}]*max-width:\s*160px;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(mobileCss, /\.remainders-summary-table-wrap\s*\{[^}]*overflow-y:\s*visible;/s);
  assert.match(mobileCss, /\.remainders-summary-table-wrap\s*\{[^}]*touch-action:\s*pan-x pan-y;/s);
  assert.match(mobileCss, /\.remainders-summary-table-wrap table tr > :first-child\s*\{[^}]*max-width:\s*160px;[^}]*white-space:\s*normal;/s);
});

test("collapsed remainders diagnostics table keeps horizontal scroll controls", () => {
  const api = loadApi();
  const block = api.renderRemaindersSummaryBlock(api.buildRemaindersSummary({
    balances: {
      remainders_rows: [
        { channel: "PayPal", opening_amount_usd: 1, closing_amount_usd: 2 },
      ],
    },
  }), makeMockDocument());
  const diagnostics = block.children.find((child) => child.tag === "details");
  const controls = diagnostics.children.find((child) => child.className === "remainders-scroll-controls");
  const wrap = block.querySelector(".remainders-summary-table-wrap");

  assert.ok(diagnostics);
  assert.equal(diagnostics.open, false);
  assert.ok(controls);
  assert.equal(controls.children.length, 2);
  assert.match(controls.children[0].textContent, /Влево/);
  assert.match(controls.children[1].textContent, /Вправо/);

  controls.children[1].listeners.click();
  controls.children[0].listeners.click();
  assert.deepEqual(wrap.scrollCalls, [
    { left: 240, behavior: "auto" },
    { left: -240, behavior: "auto" },
  ]);
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
