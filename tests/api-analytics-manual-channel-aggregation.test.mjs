import test from "node:test";
import assert from "node:assert/strict";

import { normalizeServerAnalyticsPayload } from "../api/analytics-normalizer.js";

function sectionRows(values, title) {
  const index = values.findIndex((row) => String(row?.[0] || "").trim().toLowerCase() === title.toLowerCase());
  assert.notEqual(index, -1, `Section ${title} not found`);
  const header = values[index + 1] || [];
  const rows = [];
  for (let cursor = index + 2; cursor < values.length; cursor += 1) {
    const row = values[cursor] || [];
    if (!row.some((cell) => String(cell || "").trim())) break;
    rows.push(row);
  }
  return { header, rows };
}

function rowObject(header, row) {
  return Object.fromEntries(header.map((cell, index) => [String(cell || "").trim(), row[index] || ""]));
}

function rowByChannel(header, rows, channel) {
  const row = rows.find((item) => String(item[0] || "").trim() === channel);
  assert.ok(row, `Row ${channel} not found`);
  return rowObject(header, row);
}

test("normalizeServerAnalyticsPayload rebuilds Plan rows for canonical manual channels across aliases", () => {
  const values = [
    ["Личные расходы"],
    ["канал", "now", "spent for business", "spent for flat", "spent for food", "spent for fun", "spent for study", "spent for travel", "затраты-мои", "обмен", "обмен_usd", "затраты-мои usd", "now_usd"],
    ["пейпал дол", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["пейпал евр", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["приват 24-грн", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["монобанк грн", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["Итого", "", "", "", "", "", "", "", "", "", "", "", ""],
    [],
    ["Plan"],
    ["валюта", "пришло в местной валюте", "пришло в долларах", "затраты-мои", "затраты-мои-дол", "ушло", "обмен", "обмен_usd", "план-рост", "plan-profit"],
    ["пейпал дол", "", "", "", "", "1", "", "", "10", "10"],
    ["пейпал евр", "", "", "", "", "2", "", "", "20", "20"],
    ["приват 24-грн", "", "", "", "", "3", "", "", "30", "30"],
    ["монобанк грн", "", "", "", "", "4", "", "", "40", "40"],
    ["Итого", "", "", "", "", "10", "", "", "100", "100"],
    [],
    ["БАЛАНС"],
    ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
    ["пейпал дол", "0", "", "", "0", "", "", "", "", ""],
    ["пейпал евр", "0", "", "", "0", "", "", "", "", ""],
    ["приват 24-грн", "0", "", "", "0", "", "", "", "", ""],
    ["монобанк грн", "0", "", "", "0", "", "", "", "", ""],
    ["Итого", "0", "", "", "0", "", "", "", "", ""],
    []
  ];

  const payload = normalizeServerAnalyticsPayload({
    period: { startDate: "2026-04-01", endDate: "2026-04-30" },
    tabs: { analytics: { values, rowCount: values.length, columnCount: 13 } },
    manual: {
      expenseRows: [
        {
          date: "2026-04-12",
          category: "business",
          amounts: { "paypal usd": "10", "paypal eur": "20", "privat 24 грн": "30", "monobank uah": "40" }
        },
        {
          date: "2026-04-13",
          category: "flat",
          amounts: { "paypal usd": "1", "paypal eur": "2", "privat 24 грн": "3", "monobank uah": "4" }
        },
        {
          date: "2026-04-14",
          category: "food",
          amounts: { "paypal usd": "5", "paypal eur": "6", "privat 24 грн": "7", "monobank uah": "8" }
        },
        {
          date: "2026-04-15",
          category: "fun",
          amounts: { "paypal usd": "9", "paypal eur": "10", "privat 24 грн": "11", "monobank uah": "12" }
        },
        {
          date: "2026-04-16",
          category: "study",
          amounts: { "paypal usd": "13", "paypal eur": "14", "privat 24 грн": "15", "monobank uah": "16" }
        },
        {
          date: "2026-04-17",
          category: "travel",
          amounts: { "paypal usd": "17", "paypal eur": "18", "privat 24 грн": "19", "monobank uah": "20" }
        },
        {
          date: "2026-04-18",
          category: "exchange",
          amounts: { "paypal usd": "21", "paypal eur": "22", "privat 24 грн": "23", "monobank uah": "24" }
        }
      ],
      transfers: [
        { date: "2026-04-18", channel: "paypal eur", amount: "22", currency: "EUR", usdAmount: "26.4" },
        { date: "2026-04-18", channel: "privat 24 грн", amount: "23", currency: "UAH", usdAmount: "0.575" },
        { date: "2026-04-18", channel: "monobank uah", amount: "24", currency: "UAH", usdAmount: "0.6" }
      ],
      balances: [
        { date: "2026-04-30", channel: "paypal usd", amount: "250", currency: "USD" },
        { date: "2026-04-30", channel: "paypal eur", amount: "350", currency: "EUR", usdAmount: "420" },
        { date: "2026-04-30", channel: "privat 24 грн", amount: "4500", currency: "UAH", usdAmount: "112.5" },
        { date: "2026-04-30", channel: "monobank uah", amount: "5500", currency: "UAH", usdAmount: "137.5" }
      ]
    }
  });

  const plan = sectionRows(payload.tabs.analytics.values, "Plan");

  assert.equal(rowByChannel(plan.header, plan.rows, "пейпал дол")["затраты-мои"], "55,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "пейпал дол")["обмен"], "21,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "пейпал дол")["обмен_usd"], "21,0000");

  assert.equal(rowByChannel(plan.header, plan.rows, "пейпал евр")["затраты-мои"], "70,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "пейпал евр")["обмен"], "22,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "пейпал евр")["обмен_usd"], "26,4000");

  assert.equal(rowByChannel(plan.header, plan.rows, "приват 24-грн")["затраты-мои"], "85,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "приват 24-грн")["обмен"], "23,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "приват 24-грн")["обмен_usd"], "0,5750");

  assert.equal(rowByChannel(plan.header, plan.rows, "монобанк грн")["затраты-мои"], "100,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "монобанк грн")["обмен"], "24,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "монобанк грн")["обмен_usd"], "0,6000");

  const total = rowByChannel(plan.header, plan.rows, "Итого");
  assert.equal(total["затраты-мои"], "310,0000");
  assert.equal(total["обмен"], "90,0000");
  assert.equal(total["обмен_usd"], "48,5750");
});

test("normalizeServerAnalyticsPayload sums timestamped exchange rows across the full inclusive period", () => {
  const values = [
    ["Plan"],
    ["валюта", "пришло в местной валюте", "пришло в долларах", "затраты-мои", "затраты-мои-дол", "ушло", "обмен", "обмен_usd", "план-рост", "plan-profit"],
    ["Яндекс руб", "", "", "", "", "0", "", "", "0", "0"],
    ["Бинанс spot", "", "", "", "", "0", "", "", "0", "0"],
    ["приват 24-грн", "", "", "", "", "0", "", "", "0", "0"],
    ["Итого", "", "", "", "", "0", "", "", "0", "0"],
    [],
    ["БАЛАНС"],
    ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
    ["Яндекс руб", "0", "", "", "0", "", "", "", "", ""],
    ["Бинанс spot", "0", "", "", "0", "", "", "", "", ""],
    ["приват 24-грн", "0", "", "", "0", "", "", "", "", ""],
    ["Итого", "0", "", "", "0", "", "", "", "", ""],
    []
  ];

  const payload = normalizeServerAnalyticsPayload({
    period: { startDate: "2026-04-01", endDate: "2026-04-30" },
    tabs: { analytics: { values, rowCount: values.length, columnCount: 10 } },
    manual: {
      expenseRows: [
        {
          date: "2026-03-31 00:00:00",
          category: "exchange",
          amounts: { "Яндекс руб": "-111" }
        },
        {
          date: "2026-04-24 00:00:00",
          category: "exchange",
          amounts: { "Яндекс руб": "-74669", "Бинанс spot": "874" }
        },
        {
          date: "2026-04-25 00:00:00",
          category: "exchange",
          amounts: { "privat 24 грн": "-4916", "binance save": "-950" }
        },
        {
          date: "2026-04-30",
          category: "exchange",
          amounts: { "приват 24-грн": "-4916" }
        },
        {
          date: "2026-05-01 00:00:00",
          category: "exchange",
          amounts: { "Бинанс spot": "222" }
        }
      ],
      transfers: [],
      balances: []
    }
  });

  const plan = sectionRows(payload.tabs.analytics.values, "Plan");
  assert.equal(rowByChannel(plan.header, plan.rows, "Яндекс руб")["обмен"], "-74669,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "Бинанс spot")["обмен"], "-76,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "приват 24-грн")["обмен"], "-9832,0000");

  const total = rowByChannel(plan.header, plan.rows, "Итого");
  assert.equal(total["обмен"], "-84577,0000");
});

test("normalizeServerAnalyticsPayload builds Plan exchange from normalized operations rows", () => {
  const values = [
    ["Plan"],
    ["валюта", "пришло в местной валюте", "пришло в долларах", "затраты-мои", "затраты-мои-дол", "ушло", "обмен", "обмен_usd", "план-рост", "plan-profit"],
    ["Яндекс руб", "", "", "", "", "0", "", "", "0", "0"],
    ["Бинанс spot", "", "", "", "", "0", "", "", "0", "0"],
    ["приват 24-грн", "", "", "", "", "0", "", "", "0", "0"],
    ["Итого", "", "", "", "", "0", "", "", "0", "0"],
    [],
    ["БАЛАНС"],
    ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
    ["Яндекс руб", "0", "", "", "0", "", "", "", "", ""],
    ["Бинанс spot", "0", "", "", "0", "", "", "", "", ""],
    ["приват 24-грн", "0", "", "", "0", "", "", "", "", ""],
    ["Итого", "0", "", "", "0", "", "", "", "", ""],
    []
  ];

  const payload = normalizeServerAnalyticsPayload({
    period: { startDate: "2026-04-01", endDate: "2026-04-30" },
    tabs: { analytics: { values, rowCount: values.length, columnCount: 10 } },
    manual: {
      operations: [
        { date: "2026-04-24 00:00:00", operation: "exchange", fromChannel: "Яндекс руб", toChannel: "Бинанс spot", amount: "-74669", amountUsd: "-883.0684", category: "exchange" },
        { date: "2026-04-24 00:00:00", operation: "exchange", fromChannel: "Яндекс руб", toChannel: "Бинанс spot", amount: "874", amountUsd: "874", category: "exchange" },
        { date: "2026-04-25 00:00:00", operation: "exchange", fromChannel: "приват 24-грн", toChannel: "binance save", amount: "-4916", amountUsd: "-112.0839", category: "exchange" },
        { date: "2026-04-25 00:00:00", operation: "exchange", fromChannel: "binance save", toChannel: "", amount: "-950", amountUsd: "-950", category: "exchange" },
        { date: "2026-04-30", operation: "exchange", fromChannel: "приват 24-грн", toChannel: "binance save", amount: "-4916", amountUsd: "-112.0839", category: "exchange" }
      ],
      expenseRows: [],
      transfers: [],
      balances: []
    }
  });

  const plan = sectionRows(payload.tabs.analytics.values, "Plan");
  assert.equal(rowByChannel(plan.header, plan.rows, "Яндекс руб")["обмен"], "-74669,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "Яндекс руб")["обмен_usd"], "-883,0684");
  assert.equal(rowByChannel(plan.header, plan.rows, "Бинанс spot")["обмен"], "-76,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "Бинанс spot")["обмен_usd"], "-76,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "приват 24-грн")["обмен"], "-9832,0000");

  const total = rowByChannel(plan.header, plan.rows, "Итого");
  assert.equal(total["обмен"], "-84577,0000");
});

test("normalizeServerAnalyticsPayload derives exchange_usd from operation currency when amount_usd is blank", () => {
  const values = [
    ["Plan"],
    ["валюта", "пришло в местной валюте", "пришло в долларах", "затраты-мои", "затраты-мои-дол", "ушло", "обмен", "обмен_usd", "план-рост", "plan-profit"],
    ["приват 24-грн", "", "", "", "", "0", "", "", "0", "0"],
    ["Бинанс spot", "", "", "", "", "0", "", "", "0", "0"],
    ["Итого", "", "", "", "", "0", "", "", "0", "0"],
    [],
    ["БАЛАНС"],
    ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
    ["приват 24-грн", "0", "", "", "0", "", "", "", "", ""],
    ["Бинанс spot", "0", "", "", "0", "", "", "", "", ""],
    ["Итого", "0", "", "", "0", "", "", "", "", ""],
    []
  ];

  const payload = normalizeServerAnalyticsPayload({
    period: { startDate: "2026-04-01", endDate: "2026-04-30" },
    tabs: { analytics: { values, rowCount: values.length, columnCount: 10 } },
    manual: {
      operations: [
        { date: "2026-04-25", operation: "exchange_out", fromChannel: "приват 24-грн", toChannel: "binance save", amount: "-4300", amountUsd: "", currency: "UAH", category: "exchange" },
        { date: "2026-04-25", operation: "exchange_in", fromChannel: "приват 24-грн", toChannel: "binance save", amount: "100", amountUsd: "", currency: "USD", category: "exchange" }
      ],
      expenseRows: [],
      transfers: [
        { date: "2026-04-12", channel: "приват 24-грн", amount: "4300", currency: "UAH", usdAmount: "100" }
      ],
      balances: []
    }
  });

  const plan = sectionRows(payload.tabs.analytics.values, "Plan");
  assert.equal(rowByChannel(plan.header, plan.rows, "приват 24-грн")["обмен"], "-4300,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "приват 24-грн")["обмен_usd"], "-100,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "Бинанс spot")["обмен"], "100,0000");
  assert.equal(rowByChannel(plan.header, plan.rows, "Бинанс spot")["обмен_usd"], "100,0000");
});
