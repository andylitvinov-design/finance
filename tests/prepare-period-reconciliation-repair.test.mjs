import assert from "node:assert/strict";
import test from "node:test";

import { applyRequestedRepairs, buildRepairReport, parseArgs } from "../scripts/prepare-period-reconciliation-repair.mjs";

function operation(overrides = {}) {
  const row = {
    sheetRowNumber: 246,
    date: "2026-05-11",
    operation: "income",
    fromChannel: "",
    toChannel: "пейпал евр",
    amount: "36",
    currency: "EUR",
    amountGross: "36",
    amountFee: "",
    amountNet: "",
    source: "paypal",
    rawSourceId: "5U351082V9506951V",
    ledgerV2: {
      date: "2026-05-11",
      operation: "income",
      from_channel: "",
      to_channel: "пейпал евр",
      amount: "36",
      currency: "EUR",
      amount_gross: "36",
      amount_fee: "",
      amount_net: "",
      source: "paypal",
      external_id: "5U351082V9506951V",
    },
  };
  return { ...row, ...overrides, ledgerV2: { ...row.ledgerV2, ...(overrides.ledgerV2 || {}) } };
}

test("PayPal personal missing fee/net is not silently gross-as-net in repair report", () => {
  const report = buildRepairReport({
    options: parseArgs(["--from", "2026-05-01", "--to", "2026-05-17"]),
    repository: {
      operations: [operation()],
      balances: [{ date: "2026-05-01", channel: "пейпал евр", currency: "EUR", amount: "0" }],
      plannedRows: [],
      plannedSourceStatus: "available",
      ledgerValues: [],
    },
  });

  assert.equal(report.reconciliation_summary.missing_amount_net_rows, 1);
  assert.equal(report.paypal_personal_manual_confirmation_candidates[0].confirmed_amount_net, null);
  assert.equal(report.paypal_personal_manual_confirmation_candidates[0].warning_status, "fee_unavailable_personal_account");
});

test("PayPal personal manual confirmation marks source and warning explicitly", () => {
  const options = parseArgs(["--paypal-personal-confirm", "5U351082V9506951V=36"]);
  const report = buildRepairReport({
    options,
    repository: {
      operations: [operation()],
      balances: [],
      plannedRows: [],
      plannedSourceStatus: "available",
      ledgerValues: [],
    },
  });

  const candidate = report.paypal_personal_manual_confirmation_candidates[0];
  assert.equal(candidate.confirmed_amount_net, 36);
  assert.equal(candidate.source_after_apply, "paypal_personal_manual");
  assert.equal(candidate.warning_status, "fee_unavailable_personal_account");
});

test("missing provider balance generates blank template with expected closing hint only", () => {
  const report = buildRepairReport({
    options: parseArgs(["--from", "2026-05-01", "--to", "2026-05-17"]),
    repository: {
      operations: [operation({
        sheetRowNumber: 20,
        date: "2026-05-02",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "100",
        balanceAmount: 100,
        source: "wise",
        ledgerV2: { to_channel: "wise usd", currency: "USD", amount_net: "100", balance_amount: 100, source: "wise" },
      })],
      balances: [{ date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1000" }],
      plannedRows: [],
      plannedSourceStatus: "available",
      ledgerValues: [],
    },
  });

  const row = report.missing_balance_template_rows.find((item) => item.channel === "wise usd");
  assert.equal(row.amount, null);
  assert.equal(row.expected_closing_hint, 1100);
  assert.match(row.safe_fill, /blank until factual/);
});

test("carried-forward conditional row produces safe Остатки repair row for period end", () => {
  const report = buildRepairReport({
    options: parseArgs(["--from", "2026-05-01", "--to", "2026-05-17"]),
    repository: {
      operations: [],
      balances: [
        { date: "2026-04-30", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
        { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      ledgerValues: [],
    },
  });

  assert.equal(report.dryRun, true);
  assert.equal(report.ostatki_repair_rows.length, 1);
  assert.deepEqual(report.ostatki_repair_rows[0], {
    date: "2026-05-17",
    channel: "БАНК КАНАДА cad",
    currency: "CAD",
    amount: 7351,
    factual_closing_balance_date: "2026-05-01",
    closing_balance_source: "carried_forward",
    fact_source: "carried_forward",
    status: "carried_forward_conditional",
    movement_rows: 0,
    missing_amount_net_rows: 0,
    action: "append_carried_forward_balance",
    can_write_to_ostatki: true,
    safe_fill: "eligible only after explicit confirmation: no movement, no missing amount_net, carried forward from last observed Остатки",
    comment: "carried_forward_conditional from 2026-05-01 via period reconciliation",
  });
});

test("missing provider balance with movement requires manual provider fact and no auto amount", () => {
  const report = buildRepairReport({
    options: parseArgs(["--from", "2026-05-01", "--to", "2026-05-17"]),
    repository: {
      operations: [operation({
        sheetRowNumber: 20,
        date: "2026-05-02",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "100",
        balanceAmount: 100,
        source: "wise",
        ledgerV2: { to_channel: "wise usd", currency: "USD", amount_net: "100", balance_amount: 100, source: "wise" },
      })],
      balances: [{ date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1000" }],
      plannedRows: [],
      plannedSourceStatus: "available",
      ledgerValues: [],
    },
  });

  const row = report.ostatki_repair_rows.find((item) => item.channel === "wise usd");
  assert.equal(row.amount, null);
  assert.equal(row.expected_closing_hint, 1100);
  assert.equal(row.action, "manual_provider_fact_required");
  assert.equal(row.can_write_to_ostatki, false);
  assert.match(row.safe_fill, /нужен фактический баланс провайдера/);
});

test("apply is explicit and appends only eligible carried-forward Остатки rows", async () => {
  const report = buildRepairReport({
    options: parseArgs(["--from", "2026-05-01", "--to", "2026-05-17"]),
    repository: {
      operations: [operation({
        sheetRowNumber: 20,
        date: "2026-05-02",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "100",
        balanceAmount: 100,
        source: "wise",
        ledgerV2: { to_channel: "wise usd", currency: "USD", amount_net: "100", balance_amount: 100, source: "wise" },
      })],
      balances: [
        { date: "2026-04-30", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
        { date: "2026-05-01", channel: "БАНК КАНАДА cad", currency: "CAD", amount: "7351" },
        { date: "2026-04-30", channel: "wise usd", currency: "USD", amount: "1000" },
      ],
      plannedRows: [],
      plannedSourceStatus: "available",
      ledgerValues: [],
    },
  });
  let appendCalls = 0;

  assert.equal(report.dryRun, true);
  const applied = await applyRequestedRepairs({
    report,
    appendOstatkiRowsImpl: async ({ rows }) => {
      appendCalls += 1;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].action, "append_carried_forward_balance");
      assert.equal(rows[0].channel, "БАНК КАНАДА cad");
      return { appended: rows, skipped: [], appendRowCount: rows.length };
    },
  });

  assert.equal(appendCalls, 1);
  assert.equal(applied.type, "ostatki_append");
  assert.equal(applied.appendRowCount, 1);
});

test("Binance USDT movement without provider fact generates blank provider template, not calculated amount", () => {
  const report = buildRepairReport({
    options: parseArgs(["--from", "2026-05-01", "--to", "2026-05-17"]),
    repository: {
      operations: [operation({
        sheetRowNumber: 290,
        date: "2026-05-14",
        toChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "103",
        balanceAmount: 103,
        source: "binance",
        rawSourceId: "5046711607171328256",
        ledgerV2: { to_channel: "Бинанс spot", currency: "USDT", amount_net: "103", balance_amount: 103, source: "binance", external_id: "5046711607171328256" },
      })],
      balances: [],
      plannedRows: [],
      plannedSourceStatus: "available",
      ledgerValues: [],
    },
  });

  assert.equal(report.missing_opening_balance_rows.length, 0);
  assert.deepEqual(report.missing_balance_template_rows[0], {
    date: "2026-05-17",
    channel: "Бинанс spot",
    currency: "USDT",
    amount: null,
    expected_closing_hint: null,
    expected_closing_source: "computed_from_opening_plus_amount_net_movements",
    safe_fill: "blank until factual provider/manual balance is entered",
    status: "missing_provider_balance",
  });
  assert.equal(report.ostatki_repair_rows[0].amount, null);
  assert.equal(report.ostatki_repair_rows[0].expected_closing_hint, null);
  assert.equal(report.ostatki_repair_rows[0].can_write_to_ostatki, false);
});
