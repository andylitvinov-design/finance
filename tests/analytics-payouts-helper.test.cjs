const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPayoutTotalRow,
  buildMovementPaymentSummaryRows,
  buildTransferPayoutRowsWithUsd,
  calculateCommissionTotalsByChannel,
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

test("buildMovementPaymentSummaryRows summarizes movement metrics by payment channel", () => {
  const rows = buildMovementPaymentSummaryRows(
    [
      ["NUMBER", "CLIENT", "PAYMENT METHOD", "ACCRUED", "ACCRUED +3%", "70% OF +3%", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
      ["1", "А", "сайт, рубли", "100", "103", "72.1", "90", "13"],
      ["2", "А", "сайт рубли", "50", "51.5", "36.05", "60", "-8.5"],
      ["18110", "Инна Устименко", "", "100", "103", "72.1", "", "-103"],
      ["18111", "Инна Устименко", "сайт, дол, пэйпэл", "200", "206", "144.2", "315", "109"]
    ],
    ["Яндекс руб", "пейпал дол", "приват 24-грн"],
    {
      "Яндекс руб": {
        localPatterns: [/сайт рубли/i],
        usdPatterns: [/сайт рубли/i]
      },
      "пейпал дол": {
        usdPatterns: [/сайт, дол, пэйпэл|сайт, пэйпэл, дол/i]
      }
    }
  );

  assert.deepEqual(rows[0], ["Яндекс руб", "150,0000", "154,5000", "108,1500", "150,0000", "4,5000"]);
  assert.deepEqual(rows[1], ["пейпал дол", "300,0000", "309,0000", "216,3000", "315,0000", "6,0000"]);
  assert.deepEqual(rows[2], ["приват 24-грн", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000"]);
  assert.deepEqual(rows[3], ["Итого", "450,0000", "463,5000", "324,4500", "465,0000", "10,5000"]);
});

test("buildMovementPaymentSummaryRows maps Lozin monobank payments to monobank UAH", () => {
  const rows = buildMovementPaymentSummaryRows(
    [
      ["NUMBER", "CLIENT", "PAYMENT METHOD", "ACCRUED", "ACCRUED +3%", "70% OF +3%", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
      ["18114", "Валерия Лозина", "", "200", "206", "144.2", "", "-206"],
      ["18115", "Валерия Лозина", "", "30", "30.9", "21.63", "", "-30.9"],
      ["18116", "сын Валерии Лозиной", "карта Андрей", "100", "103", "72.1", "339.89", "236.89"]
    ],
    ["монобанк грн", "приват 24-грн"],
    {
      "монобанк грн": {
        localPatterns: [/^(карта андрей|андрей карта)$/i, /монобанк|monobank|mono|лозин|lozin/i],
        usdPatterns: [/^(карта андрей|андрей карта)$/i, /монобанк|monobank|mono|лозин|lozin/i]
      }
    }
  );

  assert.deepEqual(rows[0], ["монобанк грн", "330,0000", "339,9000", "237,9300", "339,8900", "-0,0100"]);
  assert.deepEqual(rows[1], ["приват 24-грн", "0,0000", "0,0000", "0,0000", "0,0000", "0,0000"]);
  assert.deepEqual(rows[2], ["Итого", "330,0000", "339,9000", "237,9300", "339,8900", "-0,0100"]);
});

test("buildMovementPaymentSummaryRows falls back blank clients to transferwise and paypal", () => {
  const rows = buildMovementPaymentSummaryRows(
    [
      ["NUMBER", "CLIENT", "PAYMENT METHOD", "ACCRUED", "ACCRUED +3%", "70% OF +3%", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"],
      ["1", "William", "", "100", "103", "72.1", "103", "0"],
      ["2", "Вильям", "", "50", "51.5", "36.05", "51.5", "0"],
      ["3", "Игнат Сачивко", "", "70", "72.1", "50.47", "72.1", "0"],
      ["4", "William", "карта Андрей", "10", "10.3", "7.21", "10.3", "0"]
    ],
    ["трансервайз дол", "пейпал дол", "монобанк грн"],
    {
      "монобанк грн": {
        usdPatterns: [/^(карта андрей|андрей карта)$/i]
      }
    }
  );

  assert.deepEqual(rows[0], ["трансервайз дол", "150,0000", "154,5000", "108,1500", "154,5000", "0,0000"]);
  assert.deepEqual(rows[1], ["пейпал дол", "70,0000", "72,1000", "50,4700", "72,1000", "0,0000"]);
  assert.deepEqual(rows[2], ["монобанк грн", "10,0000", "10,3000", "7,2100", "10,3000", "0,0000"]);
  assert.deepEqual(rows[3], ["Итого", "230,0000", "236,9000", "165,8300", "236,9000", "0,0000"]);
});

test("buildTransferPayoutRowsWithUsd divides amount by entered or dated fallback rate", () => {
  const header = ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"];
  const rows = buildTransferPayoutRowsWithUsd(
    header,
    [
      {
        transferDate: "2026-04-20",
        amount: "4000",
        currency: "UAH",
        channel: "приват 24-грн",
        rate: "40",
        usdAmount: "999"
      },
      {
        transferDate: "2026-04-21",
        amount: "8455,63",
        currency: "RUB",
        channel: "Яндекс руб",
        rate: "",
        usdAmount: ""
      }
    ],
    {
      movementValues: [
        ["DATE", "RUB RATE", "UAH RATE"],
        ["2026-04-21", "84.5563", "43.86"]
      ]
    }
  );

  assert.equal(rows[0][5], "40");
  assert.equal(rows[0][6], "100,0000");
  assert.equal(rows[1][5], "84,5563");
  assert.equal(rows[1][6], "100,0000");
  assert.equal(buildPayoutTotalRow(header, rows)[6], "200,0000");
});

test("calculateCommissionTotalsByChannel summarizes balance commissions independently from payouts", () => {
  const totals = calculateCommissionTotalsByChannel(
    [
      { date: "2026-04-25", channel: "трансервайз дол", usdAmount: "12,5", comment: "wise fee" },
      { date: "2026-04-25", channel: "монобанк грн", usdAmount: "3.25", comment: "mono fee" },
      { date: "2026-04-25", channel: "unknown", usdAmount: "99", comment: "ignored" }
    ],
    ["трансервайз дол", "монобанк грн", "пейпал дол"]
  );

  assert.deepEqual(totals, {
    "трансервайз дол": 12.5,
    "монобанк грн": 3.25,
    "пейпал дол": 0
  });
});
