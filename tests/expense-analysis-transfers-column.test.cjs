const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "expense-analysis-transfers-column.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

class ElementStub {
  constructor(tagName, textContent = "") {
    this.tagName = String(tagName || "").toLowerCase();
    this.children = [];
    this.textContent = textContent;
    this.innerText = textContent;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  insertBefore(child, before) {
    if (!before) {
      this.children.push(child);
      return child;
    }
    const index = this.children.indexOf(before);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  querySelectorAll(selector) {
    const target = String(selector || "").toLowerCase();
    const matches = [];
    const visit = (node) => {
      if (node.tagName === target) matches.push(node);
      (node.children || []).forEach(visit);
    };
    visit(this);
    return matches;
  }
}

function cell(tagName, text) {
  return new ElementStub(tagName, text);
}

function loadContext(extra = {}) {
  const context = {
    console: { warn() {} },
    state: {},
    document: {
      createElement: (tagName) => new ElementStub(tagName),
      getElementById(id) {
        return ({
          startDate: { value: "2026-05-01" },
          endDate: { value: "2026-05-31" },
        })[id] || null;
      },
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(numeric) ? numeric : 0;
    },
    formatSheetNumber(value) {
      return Number(value || 0).toFixed(4).replace(".", ",");
    },
    canonicalManualFinanceChannel(value) {
      const raw = String(value || "").trim();
      const normalized = raw.toLowerCase();
      return ({
        "wise": "трансервайз дол",
        "wise usd": "трансервайз дол",
        "transferwise": "трансервайз дол",
        "paypal usd": "пейпал дол",
      })[normalized] || raw;
    },
    ...extra,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

test("expense-analysis transfers column script is loaded after period guard", () => {
  const periodGuardIndex = indexHtml.indexOf("./expense-analysis-period-fix.js");
  const transfersColumnIndex = indexHtml.indexOf("./expense-analysis-transfers-column.js");
  const coverageIndex = indexHtml.indexOf("./balance-coverage-ui.js");

  assert.notEqual(transfersColumnIndex, -1);
  assert.ok(periodGuardIndex < transfersColumnIndex);
  assert.ok(transfersColumnIndex < coverageIndex);
});

test("buildTransferOutByChannel groups period transfer outflows separately from real expenses", () => {
  const context = loadContext();
  const totals = context.EzohataExpenseAnalysisTransfersColumn.buildTransferOutByChannel([
    { date: "2026-05-04", operation: "transfer_out", fromChannel: "wise usd", toChannel: "пейпал дол", amountUsd: "-52.94" },
    { date: "2026-05-05", operation: "exchange_out", fromChannel: "пейпал дол", toChannel: "wise usd", amount_usd: "-10" },
    { date: "2026-05-06", operation: "business_expense", category: "business", fromChannel: "wise usd", amountUsd: "-99" },
    { date: "2026-04-29", operation: "transfer_out", fromChannel: "wise usd", amountUsd: "-500" },
  ], { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(totals["трансервайз дол"], 52.94);
  assert.equal(totals["пейпал дол"], 10);
  assert.equal(totals["wise usd"], undefined);
});

test("enhanceExpenseAnalysisTable inserts Переводы between Потрачено реал and Разница", () => {
  const context = loadContext({
    state: {
      analyticsFact: {
        transferRows: [
          { date: "2026-05-04", operation: "transfer_out", fromChannel: "wise usd", toChannel: "пейпал дол", amountUsd: "-52.94" },
        ],
      },
    },
  });

  const rootNode = new ElementStub("div");
  const table = new ElementStub("table");
  const header = new ElementStub("tr");
  header.append(
    cell("th", "КАНАЛ"),
    cell("th", "ПОТРАЧЕНО ПЛАН"),
    cell("th", "ПОТРАЧЕНО РЕАЛ"),
    cell("th", "РАЗНИЦА")
  );
  const wiseRow = new ElementStub("tr");
  wiseRow.append(
    cell("td", "трансервайз дол"),
    cell("td", "519,4400"),
    cell("td", "572,3800"),
    cell("td", "-52,9400")
  );
  table.append(header, wiseRow);
  rootNode.appendChild(table);

  context.EzohataExpenseAnalysisTransfersColumn.enhanceExpenseAnalysisTable(rootNode);

  assert.equal(header.children.map((node) => node.textContent).join("|"), "КАНАЛ|ПОТРАЧЕНО ПЛАН|ПОТРАЧЕНО РЕАЛ|Переводы|РАЗНИЦА");
  assert.equal(wiseRow.children.map((node) => node.textContent).join("|"), "трансервайз дол|519,4400|572,3800|52,9400|-52,9400");
});
