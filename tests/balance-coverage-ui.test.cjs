const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../balance-coverage-ui.js");

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.eventListeners = {};
    this._textContent = "";
    this._innerHTML = "";
    this.type = "";
    this.disabled = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, "");
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener;
  }
}

function createTestDocument() {
  return {
    createElement(tagName) {
      return new TestElement(tagName);
    },
  };
}

test("balance coverage UI maps statuses to user-facing labels and actions", () => {
  assert.equal(ui.getStatusLabel("ok"), "OK");
  assert.equal(ui.getStatusLabel("mismatch"), "Расхождение");
  assert.equal(ui.getStatusLabel("missing_opening_balance"), "Нет начального остатка");
  assert.equal(ui.getStatusLabel("missing_provider_balance"), "Нет фактического остатка");
  assert.equal(ui.getStatusAction("mismatch"), "Проверить выписку / Ledger / amount_net / Остатки");
  assert.equal(ui.getStatusAction("missing_opening_balance"), "Добавить остаток на начало периода");
  assert.equal(ui.getStatusAction("missing_provider_balance"), "Добавить фактический остаток в Остатки");
});

test("balance coverage UI builds table with actionable rows first", () => {
  const rows = ui.buildBalanceCoverageTableValues({
    balance_coverage: {
      accounts: [
        {
          date: "2026-05-02",
          channel: "wise usd",
          currency: "USD",
          opening_balance: 1000,
          inflow: 206,
          outflow: 0,
          computed_closing_balance: 1206,
          provider_reported_balance: 1206,
          difference: 0,
          status: "ok",
        },
        {
          date: "2026-05-03",
          channel: "wise usd",
          currency: "USD",
          opening_balance: 1206,
          inflow: 0,
          outflow: 5,
          computed_closing_balance: 1201,
          provider_reported_balance: 1199,
          difference: -2,
          status: "mismatch",
        },
      ],
      actionable_accounts: [
        {
          date: "2026-05-03",
          channel: "wise usd",
          currency: "USD",
          opening_balance: 1206,
          inflow: 0,
          outflow: 5,
          computed_closing_balance: 1201,
          provider_reported_balance: 1199,
          difference: -2,
          status: "mismatch",
        },
      ],
    },
  });

  assert.equal(rows[0][0], "Дата");
  assert.equal(rows[1][9], "Расхождение");
  assert.equal(rows[1][10], "Проверить выписку / Ledger / amount_net / Остатки");
  assert.equal(rows[2][9], "OK");
});

test("balance coverage UI renders missing opening/provider balances as text, not blanks", () => {
  const rows = ui.buildBalanceCoverageTableValues({
    balance_coverage: {
      accounts: [
        {
          date: "2026-05-11",
          channel: "монобанк грн",
          currency: "UAH",
          opening_balance: null,
          inflow: 100,
          outflow: 0,
          computed_closing_balance: null,
          provider_reported_balance: 120,
          difference: null,
          status: "missing_opening_balance",
        },
        {
          date: "2026-05-11",
          channel: "пейпал дол",
          currency: "USD",
          opening_balance: 10,
          inflow: 0,
          outflow: 5,
          computed_closing_balance: 5,
          provider_reported_balance: null,
          difference: null,
          status: "missing_provider_balance",
        },
      ],
      actionable_accounts: [],
    },
  });

  assert.equal(rows[1][3], "—");
  assert.equal(rows[1][9], "Нет начального остатка");
  assert.equal(rows[1][10], "Добавить остаток на начало периода");
  assert.equal(rows[2][7], "—");
  assert.equal(rows[2][9], "Нет фактического остатка");
  assert.equal(rows[2][10], "Добавить фактический остаток в Остатки");
});

test("balance coverage UI keeps same channel with multiple currencies separate", () => {
  const rows = ui.buildBalanceCoverageTableValues({
    balance_coverage: {
      accounts: [
        { date: "2026-05-02", channel: "wise", currency: "USD", net_change: 100, status: "ok" },
        { date: "2026-05-02", channel: "wise", currency: "EUR", net_change: 50, status: "ok" },
      ],
      actionable_accounts: [],
    },
  });

  assert.deepEqual(
    rows.slice(1).map((row) => ({ channel: row[1], currency: row[2], netChange: row[6] })),
    [
      { channel: "wise", currency: "USD", netChange: "—" },
      { channel: "wise", currency: "EUR", netChange: "—" },
    ]
  );
  assert.equal(rows.length, 3);
});

test("balance coverage UI renders actionable fixes and copy button", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [
        {
          date: "2026-05-06",
          channel: "монобанк грн",
          currency: "UAH",
          amount: 253,
          raw_source_id: "EXu_R1-KOv6NC6HsBw",
          recommended_amount_net: 253,
          action: "Set amount_net to 253",
        },
      ],
      missing_ostatki_rows: [
        {
          date: "2026-04-30",
          channel: "монобанк грн",
          currency: "UAH",
          computed_closing_balance: 17363,
          action: "Add factual closing balance to Остатки",
        },
      ],
      copyable_ostatki_rows: "date\tchannel\tcurrency\tamount\n2026-04-30\tмонобанк грн\tUAH\t17363",
    },
  });

  assert.match(block.textContent, /Что нужно исправить/);
  assert.match(block.textContent, /Скопировать строки для Остатки/);
  assert.match(block.textContent, /EXu_R1-KOv6NC6HsBw/);
  assert.match(block.textContent, /17363/);
});

test("balance coverage UI renders weekly not-ok summary with exact action rows", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      weekly_summary: {
        period: { from: "2026-05-11", to: "2026-05-17" },
        status: "failed",
        accounts_checked: 5,
        fully_reconciled: 0,
        mismatch: 1,
        missing_opening_balance: 0,
        missing_provider_balance: 4,
        needs_verification: 0,
        missing_amount_net_rows: 1,
        excluded_missing_amount_net_rows: 1,
        actionable_accounts: [
          {
            date: "2026-05-12",
            channel: "трансервайз дол",
            currency: "USD",
            difference: -138.59,
            status: "mismatch",
          },
          {
            date: "2026-05-11",
            channel: "монобанк грн",
            currency: "UAH",
            computed_closing_balance: 14033,
            status: "missing_provider_balance",
          },
        ],
      },
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_ostatki_rows: [],
      copyable_ostatki_rows: "",
    },
  });

  assert.match(block.textContent, /Сверка остатков за неделю/);
  assert.match(block.textContent, /НЕ ОК/);
  assert.match(block.textContent, /2026-05-12/);
  assert.match(block.textContent, /трансервайз дол/);
  assert.match(block.textContent, /-138\.59/);
  assert.match(block.textContent, /Проверить выписку \/ Ledger \/ amount_net \/ Остатки/);
  assert.match(block.textContent, /Добавить фактический остаток в Остатки/);
});

test("balance coverage UI renders weekly ok summary only when blocking counters are zero", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      weekly_summary: {
        period: { from: "2026-05-11", to: "2026-05-17" },
        status: "ok",
        accounts_checked: 2,
        fully_reconciled: 2,
        mismatch: 0,
        missing_opening_balance: 0,
        missing_provider_balance: 0,
        needs_verification: 0,
        missing_amount_net_rows: 0,
        excluded_missing_amount_net_rows: 0,
        actionable_accounts: [],
      },
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_ostatki_rows: [],
      copyable_ostatki_rows: "",
    },
  });

  assert.match(block.textContent, /Сверка остатков за неделю/);
  assert.match(block.textContent, /OK/);
  assert.match(block.textContent, /Все счета за неделю сверены/);
});

test("balance coverage UI shows empty success message when there are no required fixes", () => {
  const block = ui.renderBalanceCoverageBlock(createTestDocument(), {
    balance_coverage: {
      summary: {},
      accounts: [],
      actionable_accounts: [],
    },
    balance_fixes: {
      missing_amount_net_rows: [],
      missing_ostatki_rows: [],
      copyable_ostatki_rows: "",
    },
  });

  assert.match(block.textContent, /Нет обязательных исправлений для сверки остатков\./);
});
