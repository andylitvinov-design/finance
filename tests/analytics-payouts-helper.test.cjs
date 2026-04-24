const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPayoutTotalRow,
  calculatePayoutTotalsByChannel,
  calculatePayoutUsdTotalFromTable,
  mapAnalyticsTopRows,
} = require("../analytics-payouts-helper.js");

test("buildPayoutTotalRow appends totals for current and usd amounts", () => {
  const header = ["DATE", "СУММА ТЕКУЩАЯ", "AMOUNT (USD)", "COMMENT"];
  const rows = [
    ["21.04.2026", "100,0000", "110,0000", ""],
    ["22.04.2026", "50,5000", "60,2500", "closed fact"],
  ];

  const totalRow = buildPayoutTotalRow(header, rows);

  assert.equal(totalRow[0], "Итого");
  assert.equal(totalRow[1], "150,5000");
  assert.equal(totalRow[2], "170,2500");
});

test("mapAnalyticsTopRows uses now value in the now column", () => {
  const rows = mapAnalyticsTopRows(
    [
      {
        channel: "Яндекс руб",
        now: "900",
        serviceIncome: "77",
        business: "10",
        flat: "20",
        food: "30",
        fun: "40",
        travel: "50",
        total: "150",
        exchange: "12",
        totalUsd: "1.5",
        nowUsd: "900",
      },
    ]
  );

  assert.deepEqual(rows[0], ["Яндекс руб", "900", "77", "10", "20", "30", "40", "50", "150", "12", "1.5", "900"]);
});

test("calculatePayoutUsdTotalFromTable prefers summary row total", () => {
  const total = calculatePayoutUsdTotalFromTable([
    ["DATE", "AMOUNT (USD)", "COMMENT"],
    ["21.04.2026", "100,0000", ""],
    ["22.04.2026", "50,0000", "closed fact"],
    ["Итого", "999,5000", ""],
  ]);

  assert.equal(total, 999.5);
});

test("calculatePayoutTotalsByChannel maps payout rows to matching channels", () => {
  const totals = calculatePayoutTotalsByChannel(
    [
      ["POSITION", "PAYMENT METHOD", "СУММА ТЕКУЩАЯ", "AMOUNT (USD)"],
      ["1", "приват 24-грн", "4000", "100"],
      ["2", "пейпал дол", "25", "25"],
      ["Итого", "", "4025", "125"],
    ],
    ["приват 24-грн", "пейпал дол", "Яндекс руб"]
  );

  assert.deepEqual(totals["приват 24-грн"], { local: 4000, usd: 100 });
  assert.deepEqual(totals["пейпал дол"], { local: 25, usd: 25 });
  assert.deepEqual(totals["Яндекс руб"], { local: 0, usd: 0 });
});
