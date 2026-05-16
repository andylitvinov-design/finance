const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "balance-snapshots-ui.js"), "utf8");

test("balance snapshots inventory UI loads after balance coverage and before main", () => {
  assert.ok(indexHtml.includes("./balance-snapshots-ui.js"));
  assert.ok(indexHtml.indexOf("./balance-coverage-ui.js") < indexHtml.indexOf("./balance-snapshots-ui.js"));
  assert.ok(indexHtml.indexOf("./balance-snapshots-ui.js") < indexHtml.indexOf("./main.js"));
});

test("balance snapshots inventory UI calls period-scoped endpoint", () => {
  assert.match(script, /\/api\/balance-snapshots/);
  assert.match(script, /q\.set\("from", start\)/);
  assert.match(script, /q\.set\("to", end\)/);
  assert.match(script, /cache: "no-store"/);
});

test("balance snapshots inventory UI renders safe coverage fields only", () => {
  assert.match(script, /Инвентарь остатков/);
  assert.match(script, /by_channel_currency/);
  assert.match(script, /valid_rows/);
  assert.match(script, /incomplete_rows/);
  assert.doesNotMatch(script, /balanceAmount/);
  assert.doesNotMatch(script, /provider_reported_balance/);
});

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.textContent = "";
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelectorAll(tagName) {
    const expected = String(tagName || "").toUpperCase();
    const matches = [];
    const visit = (node) => {
      if (node.tagName === expected) matches.push(node);
      node.children.forEach(visit);
    };
    visit(this);
    return matches;
  }
}

function textRows(table) {
  return table.querySelectorAll("tr").map((row) => row.querySelectorAll("th").concat(row.querySelectorAll("td")).map((cell) => cell.textContent));
}

function createContext() {
  const context = {
    window: {},
    document: {
      scripts: [],
      createElement(tagName) {
        return new FakeNode(tagName);
      },
      getElementById() {
        return { value: "" };
      },
    },
    URLSearchParams,
    fetch() {
      throw new Error("not used");
    },
    renderExpenseFinancialAnalysis: undefined,
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

test("balance snapshots UI renders input rows first with balance entry headers and statuses", () => {
  const context = createContext();
  const section = context.window.EzohataBalanceSnapshotsUi.renderInventory({
    balance_snapshots: {
      dates: ["2026-05-15"],
      valid_rows: 1,
      incomplete_rows: 0,
      by_channel_currency: [{ channel: "wise usd", currency: "USD", rows: 1, dates: ["2026-05-15"], first_date: "2026-05-15", last_date: "2026-05-15" }],
      input_rows: [
        { date: "2026-05-15", channel: "wise usd", currency: "USD", existing_amount: 1300, needs_input: false },
        { date: "2026-05-15", channel: "paypal eur", currency: "EUR", existing_amount: null, needs_input: true },
      ],
      rows: [{ date: "2026-05-15", channel: "wise usd", currency: "USD", amount: 1300 }],
    },
  });

  const firstTable = section.querySelectorAll("table")[0];
  const rows = textRows(firstTable);
  assert.deepEqual(rows[0], ["Date", "Channel", "Currency", "Balance", "Status"]);
  assert.deepEqual(rows[1], ["2026-05-15", "wise usd", "USD", "1300", "already entered"]);
  assert.deepEqual(rows[2], ["2026-05-15", "paypal eur", "EUR", "—", "needs input"]);
});
