const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../balance-coverage-ui.js");

test("balance coverage UI maps statuses to user-facing labels and actions", () => {
  assert.equal(ui.getStatusLabel("ok"), "OK");
  assert.equal(ui.getStatusLabel("mismatch"), "Расхождение");
  assert.equal(ui.getStatusLabel("missing_opening_balance"), "Нет начального остатка");
  assert.equal(ui.getStatusLabel("missing_provider_balance"), "Введите фактический остаток");
  assert.equal(ui.getStatusAction("mismatch"), "Проверить выписку / amount_net / Остатки");
  assert.equal(ui.getStatusAction("missing_provider_balance"), "Добавить фактический остаток на дату в лист Остатки");
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
  assert.equal(rows[1][10], "Проверить выписку / amount_net / Остатки");
  assert.equal(rows[2][9], "OK");
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
