import test from "node:test";
import assert from "node:assert/strict";

import { buildDailyCurrencyBalances } from "../server/daily-balance-engine.js";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-02",
    operation: "income",
    fromChannel: "",
    toChannel: "wise usd",
    amount: "300",
    currency: "USD",
    amountNet: "300",
    balanceAmount: 300,
    ledgerV2: {
      date: "2026-05-02",
      operation: "income",
      from_channel: "",
      to_channel: "wise usd",
      amount: "300",
      currency: "USD",
      amount_net: "300",
      balance_amount: 300,
    },
  };
  return {
    ...row,
    ...overrides,
    ledgerV2: {
      ...row.ledgerV2,
      ...(overrides.ledgerV2 || {}),
    },
  };
}

test("same channel with USD and EUR produces separate daily balance rows", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ currency: "USD", ledgerV2: { currency: "USD", balance_amount: 100, amount_net: "100" } }),
      operation({ currency: "EUR", ledgerV2: { currency: "EUR", balance_amount: 200, amount_net: "200" } }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-01", channel: "wise usd", amount: "500", currency: "EUR" },
    ]
  );

  assert.deepEqual(
    result.rows.map((row) => ({ channel: row.channel, currency: row.currency, net_change: row.net_change })),
    [
      { channel: "wise usd", currency: "EUR", net_change: 200 },
      { channel: "wise usd", currency: "USD", net_change: 100 },
    ]
  );
});

test("opening plus income minus expense calculates closing balance", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ ledgerV2: { to_channel: "wise usd", currency: "USD", amount_net: "300", balance_amount: 300 } }),
      operation({
        operation: "expense",
        fromChannel: "wise usd",
        toChannel: "",
        amountNet: "50",
        balanceAmount: -50,
        ledgerV2: {
          operation: "expense",
          from_channel: "wise usd",
          to_channel: "",
          currency: "USD",
          amount_net: "50",
          balance_amount: -50,
        },
      }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1250", currency: "USD" },
    ]
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    date: "2026-05-02",
    channel: "wise usd",
    currency: "USD",
    opening_balance: 1000,
    inflow: 300,
    outflow: 50,
    net_change: 250,
    closing_balance: 1250,
    provider_reported_balance: 1250,
    difference: 0,
    opening_amount_usd: 1000,
    closing_amount_usd: 1250,
    delta_amount_usd: 250,
    status: "ok",
  });
});

test("no-movement EOD fact between movement days becomes the next opening", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({
        date: "2026-04-28",
        toChannel: "Яндекс руб",
        currency: "RUB",
        amountNet: "438.98",
        balanceAmount: 438.98,
        ledgerV2: {
          date: "2026-04-28",
          operation: "income",
          to_channel: "Яндекс руб",
          currency: "RUB",
          amount_net: "438.98",
          balance_amount: 438.98,
        },
      }),
      operation({
        date: "2026-05-05",
        operation: "exchange_out",
        fromChannel: "Яндекс руб",
        toChannel: "",
        currency: "RUB",
        amountNet: "74771.5",
        balanceAmount: -74771.5,
        ledgerV2: {
          date: "2026-05-05",
          operation: "exchange",
          from_channel: "Яндекс руб",
          to_channel: "",
          currency: "RUB",
          amount_net: "74771.5",
          balance_amount: -74771.5,
        },
      }),
    ],
    [
      { date: "2026-04-27", channel: "Яндекс руб", amount: "142419.9", currency: "RUB" },
      { date: "2026-04-28", channel: "Яндекс руб", amount: "142858.88", currency: "RUB" },
      { date: "2026-05-01", channel: "Яндекс руб", amount: "145614", currency: "RUB" },
      { date: "2026-05-05", channel: "Яндекс руб", amount: "68087.38", currency: "RUB" },
    ]
  );

  const may5 = result.rows.find((row) => row.date === "2026-05-05");
  assert.equal(may5.opening_balance, 145614);
  assert.equal(may5.closing_balance, 70842.5);
  assert.equal(may5.provider_reported_balance, 68087.38);
  assert.equal(may5.difference, -2755.12);
  assert.equal(may5.status, "mismatch");
});

test("missing amount_net row is excluded and counted", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ ledgerV2: { amount_net: "", balance_amount: 999 } }),
      operation({ ledgerV2: { amount_net: "10", balance_amount: 10 } }),
    ],
    [{ date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" }]
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].net_change, 10);
  assert.equal(result.summary.excluded_missing_amount_net_rows, 1);
});

test("exchange CAD out and USD in do not mix currencies", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({
        operation: "exchange_out",
        fromChannel: "td cad",
        toChannel: "wise usd",
        currency: "CAD",
        ledgerV2: {
          operation: "exchange",
          from_channel: "td cad",
          to_channel: "wise usd",
          currency: "CAD",
          amount_net: "100",
          balance_amount: -100,
        },
      }),
      operation({
        operation: "exchange_in",
        fromChannel: "td cad",
        toChannel: "wise usd",
        currency: "USD",
        ledgerV2: {
          operation: "exchange",
          from_channel: "td cad",
          to_channel: "wise usd",
          currency: "USD",
          amount_net: "73",
          balance_amount: 73,
        },
      }),
    ],
    [
      { date: "2026-05-01", channel: "td cad", amount: "1000", currency: "CAD" },
      { date: "2026-05-01", channel: "wise usd", amount: "500", currency: "USD" },
    ]
  );

  assert.deepEqual(
    result.rows.map((row) => ({
      channel: row.channel,
      currency: row.currency,
      net_change: row.net_change,
      closing_balance: row.closing_balance,
    })),
    [
      { channel: "td cad", currency: "CAD", net_change: -100, closing_balance: 900 },
      { channel: "wise usd", currency: "USD", net_change: 73, closing_balance: 573 },
    ]
  );
});

test("Binance Earn internal transfer changes wallets but not combined Binance total", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({
        date: "2026-03-28",
        operation: "transfer",
        fromChannel: "Бинанс spot",
        toChannel: "",
        amountNet: "896",
        balanceAmount: -896,
        ledgerV2: {
          date: "2026-03-28",
          operation: "transfer",
          from_channel: "Бинанс spot",
          to_channel: "",
          currency: "USDT",
          amount_net: "896",
          balance_amount: -896,
        },
      }),
      operation({
        date: "2026-03-28",
        operation: "transfer",
        fromChannel: "",
        toChannel: "binance save",
        amountNet: "896",
        balanceAmount: 896,
        ledgerV2: {
          date: "2026-03-28",
          operation: "transfer",
          from_channel: "",
          to_channel: "binance save",
          currency: "USDT",
          amount_net: "896",
          balance_amount: 896,
        },
      }),
    ],
    [
      { date: "2026-03-27", channel: "Бинанс spot", amount: "1000", currency: "USDT" },
      { date: "2026-03-27", channel: "binance save", amount: "7000", currency: "USDT" },
    ]
  );

  const byChannel = Object.fromEntries(result.rows.map((row) => [row.channel, row]));
  assert.equal(byChannel["Бинанс spot"].net_change, -896);
  assert.equal(byChannel["binance save"].net_change, 896);
  assert.equal(result.rows.reduce((sum, row) => sum + row.net_change, 0), 0);
});

test("provider reported balance mismatch returns mismatch status and difference", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ ledgerV2: { amount_net: "300", balance_amount: 300 } })],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1249", currency: "USD" },
    ]
  );

  assert.equal(result.rows[0].closing_balance, 1300);
  assert.equal(result.rows[0].provider_reported_balance, 1249);
  assert.equal(result.rows[0].difference, -51);
  assert.equal(result.rows[0].status, "mismatch");
  assert.equal(result.summary.mismatch_rows, 1);
});

test("mismatched provider snapshot does not become next opening anchor", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({
        date: "2026-05-09",
        operation: "expense",
        fromChannel: "wise usd",
        toChannel: "",
        amountNet: "137.96",
        balanceAmount: -137.96,
        ledgerV2: {
          date: "2026-05-09",
          operation: "expense",
          from_channel: "wise usd",
          to_channel: "",
          currency: "USD",
          amount_net: "137.96",
          balance_amount: -137.96,
        },
      }),
      operation({
        date: "2026-05-10",
        operation: "expense",
        fromChannel: "wise usd",
        toChannel: "",
        amountNet: "167.01",
        balanceAmount: -167.01,
        ledgerV2: {
          date: "2026-05-10",
          operation: "expense",
          from_channel: "wise usd",
          to_channel: "",
          currency: "USD",
          amount_net: "167.01",
          balance_amount: -167.01,
        },
      }),
      operation({
        date: "2026-05-11",
        operation: "expense",
        fromChannel: "wise usd",
        toChannel: "",
        amountNet: "35.13",
        balanceAmount: -35.13,
        ledgerV2: {
          date: "2026-05-11",
          operation: "expense",
          from_channel: "wise usd",
          to_channel: "",
          currency: "USD",
          amount_net: "35.13",
          balance_amount: -35.13,
        },
      }),
      operation({
        date: "2026-05-12",
        operation: "expense",
        fromChannel: "wise usd",
        toChannel: "",
        amountNet: "52.94",
        balanceAmount: -52.94,
        ledgerV2: {
          date: "2026-05-12",
          operation: "expense",
          from_channel: "wise usd",
          to_channel: "",
          currency: "USD",
          amount_net: "52.94",
          balance_amount: -52.94,
        },
      }),
    ],
    [
      { date: "2026-05-08", channel: "wise usd", amount: "2391.31", currency: "USD" },
      { date: "2026-05-09", channel: "wise usd", amount: "2419.07", currency: "USD", source: "provider_auto", sourceSheet: "Авто Остатки" },
      { date: "2026-05-12", channel: "wise usd", amount: "2026.03", currency: "USD" },
    ]
  );

  const may9 = result.rows.find((row) => row.date === "2026-05-09");
  const may12 = result.rows.find((row) => row.date === "2026-05-12");
  assert.equal(may9.status, "mismatch");
  assert.equal(may9.difference, 165.72);
  assert.equal(may12.outflow, 52.94);
  assert.equal(may12.opening_balance, 2051.21);
  assert.equal(may12.difference, 27.76);
});

test("Ostatki same-day date is treated as end-of-day provider reported balance", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ ledgerV2: { amount_net: "300", balance_amount: 300 } })],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1300", currency: "USD" },
    ]
  );

  assert.equal(result.rows[0].opening_balance, 1000);
  assert.equal(result.rows[0].closing_balance, 1300);
  assert.equal(result.rows[0].provider_reported_balance, 1300);
  assert.equal(result.rows[0].status, "ok");
});

test("small closing-anchor rounding difference still computes bounded movement row", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({
        date: "2026-05-11",
        toChannel: "монобанк грн",
        currency: "UAH",
        amountUsd: "207.52",
        amountNet: "9105",
        balanceAmount: 9105,
        ledgerV2: {
          date: "2026-05-11",
          operation: "income",
          to_channel: "монобанк грн",
          currency: "UAH",
          amount_usd: "207.52",
          amount_net: "9105",
          balance_amount: 9105,
        },
      }),
    ],
    [
      { date: "2026-05-06", channel: "монобанк грн", amount: "3928", currency: "UAH", usdAmount: "89.71", source: "manual_fact", sourceSheet: "Остатки" },
      { date: "2026-05-20", channel: "монобанк грн", amount: "13033.14", currency: "UAH", source: "manual_owner_confirmed", sourceSheet: "Остатки" },
    ]
  );

  assert.equal(result.rows[0].status, "computed_between_confirmed_anchors");
  assert.equal(result.rows[0].difference, null);
  assert.equal(result.rows[0].provider_reported_balance, null);
  assert.equal(result.rows[0].source, "computed_from_opening_and_ledger");
  assert.equal(result.rows[0].opening_amount_usd, 89.71);
  assert.equal(result.rows[0].closing_amount_usd, 297.23);
});

test("movement dates between confirmed opening and closing anchors are computed from ledger amount_net", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-10", ledgerV2: { date: "2026-05-10", amount_net: "20", balance_amount: 20 } }),
      operation({ date: "2026-05-20", ledgerV2: { date: "2026-05-20", amount_net: "-10", balance_amount: -10 } }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD", sourceSheet: "Остатки" },
      { date: "2026-05-20", channel: "wise usd", amount: "1310", currency: "USD", sourceSheet: "Остатки" },
    ]
  );

  const may2 = result.rows.find((row) => row.date === "2026-05-02");
  const may10 = result.rows.find((row) => row.date === "2026-05-10");
  const may20 = result.rows.find((row) => row.date === "2026-05-20");

  assert.equal(may2.status, "computed_between_confirmed_anchors");
  assert.equal(may2.source, "computed_from_opening_and_ledger");
  assert.equal(may2.factual_provider_balance, false);
  assert.equal(may2.computed_balance, true);
  assert.equal(may2.provider_reported_balance, null);
  assert.equal(may2.closing_balance, 1300);
  assert.equal(may2.next_confirmed_balance_date, "2026-05-20");

  assert.equal(may10.status, "computed_between_confirmed_anchors");
  assert.equal(may10.closing_balance, 1320);
  assert.equal(may10.provider_reported_balance, null);

  assert.equal(may20.status, "ok");
  assert.equal(may20.provider_reported_balance, 1310);
  assert.equal(may20.difference, 0);
});

test("closing anchor mismatch keeps intermediate movement rows actionable", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-20", ledgerV2: { date: "2026-05-20", amount_net: "20", balance_amount: 20 } }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-20", channel: "wise usd", amount: "1400", currency: "USD" },
    ]
  );

  const may2 = result.rows.find((row) => row.date === "2026-05-02");
  const may20 = result.rows.find((row) => row.date === "2026-05-20");
  assert.equal(may2.status, "missing_provider_balance");
  assert.equal(may2.missing_provider_balance_context, "later_fact_exists");
  assert.equal(may20.status, "mismatch");
  assert.equal(may20.difference, 80);
});

test("missing amount_net blocks anchor interval computation", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-10", ledgerV2: { date: "2026-05-10", amount_net: "", balance_amount: 20 } }),
      operation({ date: "2026-05-20", ledgerV2: { date: "2026-05-20", amount_net: "-10", balance_amount: -10 } }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-20", channel: "wise usd", amount: "1290", currency: "USD" },
    ]
  );

  const may2 = result.rows.find((row) => row.date === "2026-05-02");
  const may10 = result.rows.find((row) => row.date === "2026-05-10");
  assert.equal(may2.status, "missing_provider_balance");
  assert.equal(may10.status, "missing_amount_net");
  assert.equal(may10.closing_balance, null);
});

test("movement without a later confirmed closing anchor remains missing provider balance", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-10", ledgerV2: { date: "2026-05-10", amount_net: "20", balance_amount: 20 } }),
    ],
    [{ date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" }]
  );

  assert.deepEqual(
    result.rows.map((row) => row.status),
    ["missing_provider_balance", "missing_provider_balance"]
  );
});

test("previous snapshot plus intervening movement produces next opening balance", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-03", ledgerV2: { date: "2026-05-03", amount_net: "20", balance_amount: 20 } }),
    ],
    [{ date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" }]
  );

  const may3 = result.rows.find((row) => row.date === "2026-05-03");
  assert.equal(may3.opening_balance, 1300);
  assert.equal(may3.closing_balance, 1320);
  assert.equal(may3.provider_reported_balance, null);
  assert.equal(may3.status, "missing_provider_balance");
});

test("missing opening balance does not create a false mismatch", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ ledgerV2: { amount_net: "300", balance_amount: 300 } })],
    [{ date: "2026-05-02", channel: "wise usd", amount: "1300", currency: "USD" }]
  );

  assert.equal(result.rows[0].opening_balance, null);
  assert.equal(result.rows[0].closing_balance, null);
  assert.equal(result.rows[0].provider_reported_balance, 1300);
  assert.equal(result.rows[0].difference, null);
  assert.equal(result.rows[0].status, "missing_opening_balance");
});

test("summary includes status counts and top actionable rows", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-03", ledgerV2: { date: "2026-05-03", amount_net: "20", balance_amount: 20 } }),
      operation({
        date: "2026-05-04",
        fromChannel: "broken usd",
        ledgerV2: {
          date: "2026-05-04",
          from_channel: "broken usd",
          to_channel: "",
          currency: "USD",
          amount_net: "1",
          balance_amount: -1,
        },
      }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1299", currency: "USD" },
      { date: "2026-05-04", channel: "broken usd", amount: "10", currency: "" },
    ]
  );

  assert.deepEqual(result.summary.status_counts, {
    ok: 0,
    computed_between_confirmed_anchors: 0,
    mismatch: 1,
    missing_opening_balance: 0,
    missing_provider_balance: 1,
    missing_amount_net: 0,
    needs_verification: 1,
  });
  assert.deepEqual(
    result.actionable_rows.map((row) => row.status),
    ["mismatch", "needs_verification", "missing_provider_balance"]
  );
});
