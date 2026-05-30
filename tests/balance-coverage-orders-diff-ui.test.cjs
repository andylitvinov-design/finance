const test = require("node:test");
const assert = require("node:assert/strict");

function resetModule() {
  delete require.cache[require.resolve("../balance-coverage-orders-diff-ui.js")];
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.EzohataBalanceCoverageOrdersDiffUi;
}

function loadApi() {
  resetModule();
  return require("../balance-coverage-orders-diff-ui.js");
}

function makeMockDocument() {
  return {
    createElement(tag) {
      return {
        tag,
        children: [],
        textContent: "",
        className: "",
        dataset: {},
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getAttribute(name) {
          return this.attributes[name];
        },
        appendChild(child) {
          this.children.push(child);
          child.parentNode = this;
          return child;
        },
      };
    },
  };
}

function collectText(node) {
  if (!node) return "";
  return [node.textContent || "", ...(node.children || []).map(collectText)].filter(Boolean).join("\n");
}

test("coverage rows expose orders, covered, signed difference, and totals", () => {
  const api = loadApi();
  const result = api.buildCoverageChannelRows({
    rows: [
      { channel: "Wise", accruedPlus3Usd: 100, allocatedPaidUsd: 120, status: "covered" },
      { channel: "Wise", accruedPlus3Usd: 50, allocatedPaidUsd: 25, status: "underpaid" },
      { channel: "PayPal", accruedPlus3Usd: 100, allocatedPaidUsd: 113.87, status: "overpaid" },
      { channel: "Binance", accruedPlus3Usd: 500, allocatedPaidUsd: 500, status: "excluded" },
    ],
  });

  const wise = result.rows.find((row) => row.channel === "Wise");
  const paypal = result.rows.find((row) => row.channel === "PayPal");

  assert.equal(wise.ordersUsd, 150);
  assert.equal(wise.coveredUsd, 145);
  assert.equal(wise.differenceUsd, -5);
  assert.equal(paypal.ordersUsd, 100);
  assert.equal(paypal.coveredUsd, 113.87);
  assert.equal(paypal.differenceUsd, 13.87);
  assert.equal(result.totals.ordersUsd, 250);
  assert.equal(result.totals.coveredUsd, 258.87);
  assert.equal(result.totals.differenceUsd, 8.87);
  assert.equal(result.rows.some((row) => row.channel === "Binance"), false);
  resetModule();
});

test("coverage summary merges raw rows to avoid defaulting missing orders to zero", () => {
  const api = loadApi();
  const result = api.buildCoverageChannelRows({
    summaryByChannel: {
      Wise: { channel: "Wise", coveredUsd: 125, allocatedPaidUsd: 130, rowCount: 2 },
    },
    rows: [
      { channel: "Wise", accruedPlus3Usd: 100, allocatedPaidUsd: 100, status: "covered" },
      { channel: "Wise", accruedPlus3Usd: 50, allocatedPaidUsd: 30, status: "underpaid" },
    ],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].ordersUsd, 150);
  assert.equal(result.rows[0].coveredUsd, 130);
  assert.equal(result.rows[0].differenceUsd, -20);
  assert.deepEqual(result.diagnostics, []);
  resetModule();
});

test("missing coverage source fields produce needs verification instead of silent zero", () => {
  const api = loadApi();
  const result = api.buildCoverageChannelRows({
    summaryByChannel: {
      "Unknown source": { channel: "Unknown source", coveredUsd: 99 },
    },
    rows: [],
  });

  assert.equal(result.rows.length, 0);
  assert.match(result.diagnostics.join("\n"), /needs verification: missing orders\/coverage source for Unknown source/);
  resetModule();
});

test("coverage table renders new columns and total row", () => {
  const api = loadApi();
  const { table, diagnostics } = api.renderCoverageTable({
    rows: [
      { channel: "Wise", accruedPlus3Usd: 100, allocatedPaidUsd: 80, status: "underpaid" },
      { channel: "PayPal", accruedPlus3Usd: 100, allocatedPaidUsd: 120, status: "overpaid" },
    ],
  }, makeMockDocument());
  const text = collectText(table);

  assert.deepEqual(diagnostics, []);
  assert.match(text, /заказы USD/);
  assert.match(text, /Распределено на заказы/);
  assert.match(text, /Покрыто по плану/);
  assert.match(text, /разница USD/);
  assert.match(text, /Wise/);
  assert.match(text, /-20,0000/);
  assert.match(text, /PayPal/);
  assert.match(text, /20,0000/);
  assert.match(text, /Итого/);
  assert.match(text, /200,0000/);
  resetModule();
});
