import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLedgerQualityRepairs,
  buildBalanceCorrectionsReport,
  buildFactBalanceGapsReport,
  buildMissingBalancesReport,
  buildLedgerQualityRepairReport,
  buildUpdatedLedgerRow,
  inferSafeSource,
  parseArgs,
} from "../scripts/repair-ledger-quality.mjs";

function operation(overrides = {}) {
  const amountNet = overrides.amountNet ?? overrides.amount_net ?? "100";
  const amount = overrides.amount ?? amountNet;
  const balanceAmount = overrides.balanceAmount ?? Number(String(amountNet || "0").replace(",", "."));
  return {
    sheetRowNumber: overrides.sheetRowNumber ?? 2,
    date: overrides.date ?? "2026-05-01",
    operation: overrides.operation ?? "income",
    fromChannel: overrides.fromChannel ?? "",
    toChannel: overrides.toChannel ?? "пейпал евр",
    amount: String(amount),
    currency: overrides.currency ?? "EUR",
    amountUsd: overrides.amountUsd ?? "",
    amountGross: overrides.amountGross ?? String(amount),
    amountFee: overrides.amountFee ?? "",
    amountNet: String(amountNet ?? ""),
    category: overrides.category ?? "ezohata",
    direction: overrides.direction ?? "in",
    comment: overrides.comment ?? "",
    source: overrides.source ?? "paypal",
    rawSourceId: overrides.rawSourceId ?? "PAYPAL-1",
    ledgerV2: {
      date: overrides.date ?? "2026-05-01",
      operation: overrides.operation === "business_expense" ? "expense" : (overrides.operation ?? "income"),
      from_channel: overrides.fromChannel ?? "",
      to_channel: overrides.toChannel ?? "пейпал евр",
      amount: String(amount),
      currency: overrides.currency ?? "EUR",
      amount_usd: overrides.amountUsd ?? "",
      amount_gross: overrides.amountGross ?? String(amount),
      amount_fee: overrides.amountFee ?? "",
      amount_net: String(amountNet ?? ""),
      balance_amount: balanceAmount,
      category: overrides.category ?? "ezohata",
      direction: overrides.direction ?? "in",
      comment: overrides.comment ?? "",
      source: overrides.source ?? "paypal",
      raw_source_id: overrides.rawSourceId ?? "PAYPAL-1",
      external_id: overrides.externalId ?? overrides.rawSourceId ?? "PAYPAL-1",
    },
  };
}

test("parseArgs defaults to dry-run all tasks", () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    confirmFile: "",
    from: "",
    json: false,
    maxApply: 10,
    onlyConfirmed: false,
    task: "all",
    to: "",
  });
});

test("parseArgs supports required task names and legacy mismatch alias", () => {
  assert.equal(parseArgs(["--task", "mismatches"]).task, "mismatches");
  assert.equal(parseArgs(["--task", "balance-corrections"]).task, "balance-corrections");
  assert.equal(parseArgs(["--task", "fact-balance-gaps"]).task, "fact-balance-gaps");
  assert.equal(parseArgs(["--task", "missing-balances"]).task, "missing-balances");
  assert.equal(parseArgs(["--task", "normalize-sources"]).task, "normalize-sources");
  assert.equal(parseArgs(["--task", "yoomoney-reconcile", "--from", "2026-05-01", "--to", "2026-05-19"]).task, "yoomoney-reconcile");
  assert.equal(parseArgs(["--task", "yoomoney-reconcile", "--from", "2026-05-01", "--to", "2026-05-19"]).from, "2026-05-01");
  assert.equal(parseArgs(["--task", "yoomoney-reconcile", "--from", "2026-05-01", "--to", "2026-05-19"]).to, "2026-05-19");
  assert.equal(parseArgs(["--task", "mismatch-report"]).task, "mismatches");
  assert.equal(parseArgs(["--apply", "--only-confirmed", "--max-apply", "2"]).apply, true);
  assert.equal(parseArgs(["--apply", "--only-confirmed", "--max-apply", "2"]).onlyConfirmed, true);
  assert.equal(parseArgs(["--apply", "--only-confirmed", "--max-apply", "2"]).maxApply, 2);
  assert.throws(() => parseArgs(["--max-apply", "-1"]), /Invalid --max-apply/);
});

test("PayPal Personal missing fee is not converted into fake net", () => {
  const report = buildLedgerQualityRepairReport({
    repository: {
      operations: [
        operation({
          sheetRowNumber: 21,
          amount: "36",
          amountGross: "36",
          amountFee: "",
          amountNet: "",
          rawSourceId: "5U351082V9506951V",
          comment: "fee_unavailable_personal_account",
        }),
      ],
      balances: [],
    },
  });

  assert.equal(report.summary.fallback_amount_rows, 0);
  assert.equal(report.missingAmountNet.rows.length, 1);
  assert.equal(report.missingAmountNet.rows[0].classification, "paypal_personal_needs_manual_confirmation");
  assert.equal(report.missingAmountNet.rows[0].recommended_amount_net, null);
  assert.equal(report.missingAmountNet.rows[0].after, null);
  assert.equal(report.missingAmountNet.summary.needsManualVerification, 1);
});

test("PayPal Personal manual confirmation fills amount_net while fee remains unavailable", () => {
  const report = buildLedgerQualityRepairReport({
    confirmations: {
      missingAmountNet: [
        {
          sheetRowNumber: 21,
          raw_source_id: "5U351082V9506951V",
          amount_net: "36",
        },
      ],
    },
    repository: {
      operations: [
        operation({
          sheetRowNumber: 21,
          amount: "36",
          amountGross: "36",
          amountFee: "",
          amountNet: "",
          rawSourceId: "5U351082V9506951V",
          comment: "fee_unavailable_personal_account",
        }),
      ],
      balances: [],
    },
  });

  const row = report.missingAmountNet.rows[0];
  assert.equal(row.classification, "paypal_personal_needs_manual_confirmation");
  assert.equal(row.after.amount_net, "36");
  assert.equal(row.after.amount_fee, "");
  assert.equal(row.after.source, "paypal_personal_manual");
  assert.match(row.after.comment, /manual_provider_confirmed/);
  assert.equal(report.missingAmountNet.summary.wouldUpdate, 1);
});

test("PayPal gross is never used as net without manual confirmation", () => {
  const report = buildLedgerQualityRepairReport({
    repository: {
      operations: [
        operation({
          sheetRowNumber: 93,
          amount: "200",
          amountGross: "200",
          amountFee: "",
          amountNet: "",
          rawSourceId: "51J71784GD5986719",
        }),
      ],
      balances: [],
    },
  });

  const row = report.missingAmountNet.rows[0];
  assert.equal(row.amount_gross, "200");
  assert.equal(row.recommended_amount_net, null);
  assert.equal(row.after, null);
  assert.equal(row.skippedReason, "amount_net is not manually/provider confirmed");
});

test("source=unknown with valid amount_net remains included in balance", () => {
  const report = buildLedgerQualityRepairReport({
    repository: {
      operations: [
        operation({
          sheetRowNumber: 7,
          source: "other",
          toChannel: "cash usd",
          currency: "USD",
          amount: "50",
          amountGross: "50",
          amountNet: "50",
          balanceAmount: 50,
        }),
      ],
      balances: [],
    },
  });

  assert.equal(report.summary.fallback_amount_rows, 0);
  assert.equal(report.summary.excluded_missing_amount_net_rows, 0);
  assert.equal(report.balances.by_channel[0].channel, "cash usd");
  assert.equal(report.balances.by_channel[0].balance_amount, 50);
  assert.equal(report.normalizeSources.summary.detected, 1);
});

test("source normalization changes only source and updated_at", () => {
  const row = operation({
    sheetRowNumber: 5,
    source: "other",
    fromChannel: "Яндекс руб",
    toChannel: "",
    operation: "business_expense",
    currency: "RUB",
    amount: "1000",
    amountGross: "1000",
    amountFee: "15",
    amountNet: "985",
    balanceAmount: -985,
    rawSourceId: "legacy-1",
  });
  const report = buildLedgerQualityRepairReport({
    repository: { operations: [row], balances: [] },
    now: "2026-05-19T09:30:00.000Z",
  });

  const sourceFix = report.normalizeSources.rows[0];
  assert.equal(sourceFix.after.source, "yoomoney");
  assert.equal(sourceFix.after.updated_at, "2026-05-19T09:30:00.000Z");
  assert.deepEqual(Object.keys(sourceFix.after).sort(), ["source", "updated_at"]);

  const header = ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_gross", "amount_fee", "amount_net", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "updated_at"];
  const current = ["2026-05-01", "business_expense", "Яндекс руб", "", "1000", "RUB", "12", "1000", "15", "985", "business", "", "out", "old", "other", "legacy-1", "old-time"];
  const updated = buildUpdatedLedgerRow({ header, currentRow: current, patch: sourceFix.after });
  assert.equal(updated[7], "1000");
  assert.equal(updated[8], "15");
  assert.equal(updated[9], "985");
  assert.equal(updated[1], "business_expense");
  assert.equal(updated[2], "Яндекс руб");
  assert.equal(updated[14], "yoomoney");
});

test("inferSafeSource maps deterministic provider evidence and skips ambiguous rows", () => {
  assert.equal(inferSafeSource(operation({ source: "other", toChannel: "пейпал дол" })), "paypal");
  assert.equal(inferSafeSource(operation({ source: "google_sheets", toChannel: "трансервайз дол", rawSourceId: "wise:1" })), "wise");
  assert.equal(inferSafeSource(operation({ source: "provider", fromChannel: "БАНК КАНАДА cad", toChannel: "", currency: "CAD", rawSourceId: "td:1" })), "td_bank");
  assert.equal(inferSafeSource(operation({ source: "other", fromChannel: "unknown cash", toChannel: "", rawSourceId: "legacy:1" })), "");
});

test("mismatch report distinguishes wrong sign, wrong channel, and wrong factual balance", () => {
  const report = buildLedgerQualityRepairReport({
    repository: {
      operations: [
        operation({
          sheetRowNumber: 10,
          date: "2026-05-02",
          operation: "business_expense",
          fromChannel: "Яндекс руб",
          toChannel: "",
          currency: "RUB",
          amountNet: "50",
          amount: "50",
          balanceAmount: 50,
          source: "yoomoney",
        }),
        operation({
          sheetRowNumber: 11,
          date: "2026-05-03",
          operation: "income",
          fromChannel: "",
          toChannel: "Яндекс руб",
          currency: "RUB",
          amountNet: "10",
          amount: "10",
          balanceAmount: 10,
          source: "yoomoney",
        }),
        operation({
          sheetRowNumber: 12,
          date: "2026-05-03",
          operation: "business_expense",
          fromChannel: "wrong card",
          toChannel: "",
          currency: "RUB",
          amountNet: "30",
          amount: "30",
          balanceAmount: -30,
          source: "yoomoney",
        }),
        operation({
          sheetRowNumber: 13,
          date: "2026-05-04",
          operation: "income",
          fromChannel: "",
          toChannel: "монобанк грн",
          currency: "UAH",
          amountNet: "100",
          amount: "100",
          balanceAmount: 100,
          source: "monobank",
        }),
      ],
      balances: [
        { date: "2026-05-01", channel: "Яндекс руб", currency: "RUB", amount: "100", balanceAmount: "100", sourceSheet: "Остатки", sourceRow: 2 },
        { date: "2026-05-02", channel: "Яндекс руб", currency: "RUB", amount: "50", balanceAmount: "50", sourceSheet: "Остатки", sourceRow: 3 },
        { date: "2026-05-03", channel: "Яндекс руб", currency: "RUB", amount: "90", balanceAmount: "90", sourceSheet: "Остатки", sourceRow: 4 },
        { date: "2026-05-03", channel: "монобанк грн", currency: "UAH", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 5 },
        { date: "2026-05-04", channel: "монобанк грн", currency: "UAH", amount: "1200", balanceAmount: "1200", sourceSheet: "Остатки", sourceRow: 6 },
      ],
    },
  });

  const classifications = Object.fromEntries(
    report.mismatchReport.rows.map((row) => [`${row.date}|${row.channel}`, row.classification])
  );
  assert.equal(classifications["2026-05-02|Яндекс руб"], "wrong_sign");
  assert.equal(classifications["2026-05-03|Яндекс руб"], "wrong_channel");
  assert.equal(classifications["2026-05-04|монобанк грн"], "wrong_factual_balance");

  const wrongSign = report.mismatchReport.rows.find((row) => row.classification === "wrong_sign");
  const wrongChannel = report.mismatchReport.rows.find((row) => row.classification === "wrong_channel");
  assert.equal(wrongSign.after, null);
  assert.equal(wrongChannel.after, null);
  assert.equal(report.mismatchReport.summary.wouldUpdate, 0);
  assert.equal(report.mismatchReport.summary.needsManualVerification, 3);
});

test("balance correction diagnostics output exact mismatch row and never write computed balance as fact", () => {
  const report = buildLedgerQualityRepairReport({
    task: "balance-corrections",
    repository: {
      operations: [
        operation({
          sheetRowNumber: 41,
          date: "2026-05-04",
          operation: "income",
          toChannel: "монобанк грн",
          currency: "UAH",
          amountNet: "4305",
          amount: "4305",
          balanceAmount: 4305,
          source: "monobank",
        }),
      ],
      balances: [
        {
          date: "2026-05-03",
          channel: "монобанк грн",
          currency: "UAH",
          amount: "26670",
          balanceAmount: "26670",
          sourceSheet: "Остатки",
          sourceRow: 12,
        },
        {
          date: "2026-05-04",
          channel: "монобанк грн",
          currency: "UAH",
          amount: "31975",
          balanceAmount: "31975",
          sourceSheet: "Остатки",
          sourceRow: 13,
        },
      ],
      autoBalances: [],
    },
  });

  assert.equal(report.balanceCorrections.summary.detected, 1);
  assert.equal(report.balanceCorrections.summary.wouldUpdate, 0);
  assert.equal(report.balanceCorrections.summary.needsManualVerification, 1);
  assert.deepEqual({
    date: report.balanceCorrections.rows[0].date,
    channel: report.balanceCorrections.rows[0].channel,
    currency: report.balanceCorrections.rows[0].currency,
    status: report.balanceCorrections.rows[0].status,
    opening_balance: report.balanceCorrections.rows[0].opening_balance,
    provider_balance: report.balanceCorrections.rows[0].provider_balance,
    computed_balance: report.balanceCorrections.rows[0].computed_balance,
    diff: report.balanceCorrections.rows[0].diff,
    current_source: report.balanceCorrections.rows[0].current_source,
    current_source_type: report.balanceCorrections.rows[0].current_source_type,
    recommended_action: report.balanceCorrections.rows[0].recommended_action,
    target_sheet: report.balanceCorrections.rows[0].target_sheet,
    conflict: report.balanceCorrections.rows[0].conflict,
    after: report.balanceCorrections.rows[0].after,
  }, {
    date: "2026-05-04",
    channel: "монобанк грн",
    currency: "UAH",
    status: "mismatch",
    opening_balance: 26670,
    provider_balance: 31975,
    computed_balance: 30975,
    diff: 1000,
    current_source: "Остатки row 13",
    current_source_type: "manual_fact",
    recommended_action: "Verify provider/manual statement before changing data; if provider_balance is factual, correct Ledger movement, otherwise correct the Остатки row.",
    target_sheet: "Остатки",
    conflict: null,
    after: null,
  });
  assert.equal(report.balanceCorrections.rows[0].confidence, "low");
  assert.equal(report.balanceCorrections.rows[0].needs_provider_confirmation, true);
});

test("balance correction diagnostics report manual-over-auto conflicts without hiding them", () => {
  const report = buildBalanceCorrectionsReport({
    operations: [
      operation({
        sheetRowNumber: 51,
        date: "2026-05-02",
        operation: "income",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "206",
        amount: "206",
        balanceAmount: 206,
        source: "wise",
      }),
    ],
    balances: [
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 2 },
      { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206", balanceAmount: "1206", sourceSheet: "Остатки", sourceRow: 3 },
    ],
    autoBalances: [
      { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "999", balanceAmount: "999", sourceSheet: "Авто Остатки", sourceRow: 8, provider: "wise" },
    ],
  });

  assert.equal(report.rows.length, 0);
  assert.equal(report.summary.conflicts, 1);
  assert.deepEqual(report.conflicts[0], {
    date: "2026-05-02",
    channel: "wise usd",
    currency: "USD",
    manual_source: "Остатки row 3",
    manual_amount: 1206,
    auto_source: "Авто Остатки row 8",
    auto_amount: 999,
    diff: -207,
    resolution: "manual Остатки wins; keep auto row ignored unless provider evidence proves manual row is wrong",
  });
});

test("balance correction diagnostics use Авто Остатки only as existing fallback source", () => {
  const report = buildBalanceCorrectionsReport({
    operations: [
      operation({
        sheetRowNumber: 61,
        date: "2026-05-02",
        operation: "income",
        toChannel: "wise eur",
        currency: "EUR",
        amountNet: "50",
        amount: "50",
        balanceAmount: 50,
        source: "wise",
      }),
    ],
    balances: [
      { date: "2026-05-01", channel: "wise eur", currency: "EUR", amount: "100", balanceAmount: "100", sourceSheet: "Остатки", sourceRow: 4 },
    ],
    autoBalances: [
      { date: "2026-05-02", channel: "wise eur", currency: "EUR", amount: "140", balanceAmount: "140", sourceSheet: "Авто Остатки", sourceRow: 9, provider: "wise" },
    ],
  });

  assert.equal(report.summary.detected, 1);
  assert.equal(report.rows[0].current_source, "Авто Остатки row 9");
  assert.equal(report.rows[0].current_source_type, "provider_auto");
  assert.equal(report.rows[0].target_sheet, "Авто Остатки");
  assert.equal(report.rows[0].recommended_action, "Verify provider auto snapshot against statement/import; do not copy computed balance into Остатки unless manually confirmed.");
  assert.equal(report.rows[0].after, null);
});

test("balance correction diagnostics emit exact missing Остатки row with computed amount as hint only", () => {
  const report = buildBalanceCorrectionsReport({
    operations: [
      operation({
        sheetRowNumber: 71,
        date: "2026-05-02",
        operation: "income",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "206",
        amount: "206",
        balanceAmount: 206,
        source: "wise",
      }),
    ],
    balances: [
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 2 },
    ],
    autoBalances: [],
  });

  assert.equal(report.rows[0].status, "missing_provider_balance");
  assert.equal(report.rows[0].current_source, "missing");
  assert.equal(report.rows[0].target_sheet, "Остатки");
  assert.equal(report.rows[0].computed_balance, 1206);
  assert.equal(report.rows[0].provider_balance, null);
  assert.match(report.rows[0].recommended_action, /Add factual provider\/manual closing balance/);
  assert.match(report.rows[0].recommended_action, /computed_balance=1206 is only a hint/);
  assert.equal(report.rows[0].after, null);
});

test("fact balance gaps report lists missing, auto pending, mismatch, and missing opening rows", () => {
  const rows = buildFactBalanceGapsReport({
    period: { from: "2026-05-01", to: "2026-05-19" },
    operations: [
      operation({
        date: "2026-05-03",
        operation: "business_expense",
        fromChannel: "трансервайз дол",
        toChannel: "",
        currency: "USD",
        amountNet: "1848.82",
        amount: "1848.82",
        balanceAmount: -1848.82,
        source: "wise",
      }),
      operation({
        date: "2026-05-05",
        operation: "income",
        fromChannel: "",
        toChannel: "Бинанс spot",
        currency: "USDT",
        amountNet: "103",
        amount: "103",
        balanceAmount: 103,
        source: "binance",
      }),
      operation({
        date: "2026-05-05",
        operation: "business_expense",
        fromChannel: "paypal usd",
        toChannel: "",
        currency: "USD",
        amountNet: "25",
        amount: "25",
        balanceAmount: -25,
        source: "paypal",
      }),
    ],
    balances: [
      { date: "2026-04-30", channel: "трансервайз дол", currency: "USD", amount: "2704.25", sourceSheet: "Остатки", sourceRow: 2 },
      { date: "2026-04-30", channel: "paypal usd", currency: "USD", amount: "100", sourceSheet: "Остатки", sourceRow: 3 },
    ],
    autoBalances: [
      { date: "2026-05-19", channel: "трансервайз дол", currency: "USD", amount: "849.66", sourceSheet: "Авто Остатки", sourceRow: 12, provider: "wise" },
    ],
  }).rows;

  const wise = rows.find((row) => row.channel === "трансервайз дол");
  const binance = rows.find((row) => row.channel === "Бинанс spot");
  const paypal = rows.find((row) => row.channel === "paypal usd");
  assert.equal(wise.factStatus, "auto_pending");
  assert.equal(wise.factBalance, 849.66);
  assert.equal(wise.sourceSheet, "Авто Остатки");
  assert.equal(wise.sourceRow, 12);
  assert.equal(wise.difference, -5.77);
  assert.match(wise.recommendedAction, /confirm provider auto balance/);
  assert.equal(binance.openingStatus, "missing_opening_balance");
  assert.equal(binance.factStatus, "missing");
  assert.match(binance.recommendedAction, /opening balance/);
  assert.equal(paypal.factStatus, "missing");
  assert.match(paypal.recommendedAction, /add fact balance/);
  assert.equal(rows.every((row) => row.after === null), true);
});

test("missing balance report keeps manual Остатки ahead of Авто Остатки", () => {
  const report = buildLedgerQualityRepairReport({
    task: "missing-balances",
    repository: {
      operations: [
        operation({
          sheetRowNumber: 20,
          date: "2026-05-02",
          operation: "income",
          toChannel: "wise usd",
          currency: "USD",
          amountNet: "206",
          amount: "206",
          balanceAmount: 206,
          source: "wise",
        }),
      ],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 2 },
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206", balanceAmount: "1206", sourceSheet: "Остатки", sourceRow: 3 },
      ],
      autoBalances: [
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "9999", balanceAmount: "9999", sourceSheet: "Авто Остатки", sourceRow: 7, provider: "wise" },
      ],
    },
  });

  assert.equal(report.missingBalances.summary.detected, 0);
});

test("Авто Остатки remains fallback only for missing provider balances", () => {
  const report = buildLedgerQualityRepairReport({
    task: "missing-balances",
    repository: {
      operations: [
        operation({
          sheetRowNumber: 20,
          date: "2026-05-02",
          operation: "income",
          toChannel: "wise usd",
          currency: "USD",
          amountNet: "206",
          amount: "206",
          balanceAmount: 206,
          source: "wise",
        }),
      ],
      balances: [
        { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 2 },
      ],
      autoBalances: [
        { date: "2026-05-02", channel: "wise usd", currency: "USD", amount: "1206", balanceAmount: "1206", sourceSheet: "Авто Остатки", sourceRow: 7, provider: "wise" },
      ],
    },
  });

  assert.equal(report.missingBalances.summary.detected, 0);
});

test("missing balance report emits amount_hint but no factual write without source", () => {
  const rows = buildMissingBalancesReport({
    operations: [
      operation({
        sheetRowNumber: 20,
        date: "2026-05-02",
        operation: "income",
        toChannel: "wise usd",
        currency: "USD",
        amountNet: "206",
        amount: "206",
        balanceAmount: 206,
        source: "wise",
      }),
    ],
    balances: [
      { date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 2 },
    ],
  });

  assert.equal(rows.summary.detected, 1);
  assert.equal(rows.rows[0].status, "missing_provider_balance");
  assert.equal(rows.rows[0].amount_hint, 1206);
  assert.equal(rows.rows[0].after, null);
  assert.match(rows.rows[0].manual_action, /amount_hint=1206/);
});

test("balance correction dry-run proves Wise negative card sign fix without mutating", () => {
  const report = buildLedgerQualityRepairReport({
    task: "balance-corrections",
    now: "2026-05-19T12:00:00.000Z",
    repository: {
      operations: [
        operation({
          sheetRowNumber: 310,
          date: "2026-05-19",
          operation: "expense",
          fromChannel: "трансервайз евро",
          toChannel: "",
          currency: "EUR",
          amount: "55.6",
          amountNet: "55.6",
          balanceAmount: -55.6,
          source: "wise",
          rawSourceId: "CARD-3806683062",
          comment: "Card transaction of -55.60 EUR issued by Yellowsquare Greece Ike Athens",
        }),
        operation({
          sheetRowNumber: 311,
          date: "2026-05-19",
          operation: "expense",
          fromChannel: "трансервайз евро",
          toChannel: "",
          currency: "EUR",
          amount: "102.96",
          amountNet: "102.96",
          balanceAmount: -102.96,
          source: "wise",
          rawSourceId: "CARD-3806680329",
          comment: "Card transaction of -102.96 EUR issued by Yellowsquare Greece Ike Athens",
        }),
      ],
      balances: [],
      autoBalances: [
        { date: "2026-05-18", channel: "трансервайз евро", currency: "EUR", amount: "0", balanceAmount: "0", sourceSheet: "Авто Остатки", sourceRow: 11, provider: "wise", source: "wise_auto", rawSourceId: "4920195", status: "zero_balance" },
        { date: "2026-05-19", channel: "трансервайз евро", currency: "EUR", amount: "158.56", balanceAmount: "158.56", sourceSheet: "Авто Остатки", sourceRow: 13, provider: "wise", source: "wise_auto", rawSourceId: "4920195", status: "ok" },
      ],
    },
  });

  const row = report.balanceCorrections.rows[0];
  assert.equal(report.balanceCorrections.summary.wouldUpdate, 1);
  assert.equal(row.classification, "wrong_sign");
  assert.equal(row.confidence, "high");
  assert.equal(row.needs_provider_confirmation, false);
  assert.equal(row.target, "Ledger");
  assert.equal(row.source_reference, "Авто Остатки row 13");
  assert.equal(row.after.length, 2);
  assert.deepEqual(row.after.map((entry) => entry.sheetRowNumber), [310, 311]);
  assert.equal(row.after[0].patch.operation, "income");
  assert.equal(row.after[0].patch.to_channel, "трансервайз евро");
  assert.match(row.after[0].patch.comment, /balance_correction_provider_auto_sign_fix/);
  assert.equal(report.summary.fallback_amount_rows, 0);
  assert.equal(report.summary.unknown_source_rows, 0);
});

test("balance correction dry-run keeps ambiguous known rows as needs_provider_confirmation", () => {
  const report = buildLedgerQualityRepairReport({
    task: "balance-corrections",
    repository: {
      operations: [
        operation({
          sheetRowNumber: 175,
          date: "2026-05-04",
          operation: "income",
          toChannel: "монобанк грн",
          currency: "UAH",
          amount: "4305",
          amountNet: "4305",
          balanceAmount: 4305,
          source: "monobank",
          rawSourceId: "Re-m6Z1uX6oq-5D0eg",
        }),
      ],
      balances: [
        { date: "2026-05-03", channel: "монобанк грн", currency: "UAH", amount: "26670", balanceAmount: "26670", sourceSheet: "Остатки", sourceRow: 57 },
        { date: "2026-05-04", channel: "монобанк грн", currency: "UAH", amount: "31975", balanceAmount: "31975", sourceSheet: "Остатки", sourceRow: 58 },
      ],
      autoBalances: [],
    },
  });

  const row = report.balanceCorrections.rows[0];
  assert.equal(row.date, "2026-05-04");
  assert.equal(row.channel, "монобанк грн");
  assert.equal(row.confidence, "low");
  assert.equal(row.needs_provider_confirmation, true);
  assert.equal(row.after, null);
});

test("apply refuses without --only-confirmed and refuses low-confidence rows", async () => {
  await assert.rejects(
    () => applyLedgerQualityRepairs({ report: { balanceCorrections: { rows: [] } }, task: "balance-corrections" }),
    /--apply requires --only-confirmed/
  );

  await assert.rejects(
    () => applyLedgerQualityRepairs({
      onlyConfirmed: true,
      task: "balance-corrections",
      report: {
        balanceCorrections: {
          rows: [{
            date: "2026-05-04",
            channel: "монобанк грн",
            currency: "UAH",
            confidence: "low",
            needs_provider_confirmation: true,
            after: [{ target: "Ledger", sheetRowNumber: 10, patch: { operation: "income" } }],
          }],
        },
      },
      accessToken: "test",
      fetchImpl: async () => { throw new Error("should not fetch"); },
    }),
    /Refusing to apply 1 unconfirmed/
  );
});

test("apply is idempotent for already-updated Ledger rows", async () => {
  const header = ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_gross", "amount_fee", "amount_net", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "updated_at"];
  const current = ["2026-05-19", "income", "", "трансервайз евро", "55.6", "EUR", "", "55.6", "", "55.6", "", "", "in", "Card transaction of -55.60 EUR issued by Yellowsquare; balance_correction_provider_auto_sign_fix", "wise", "CARD-3806683062", "2026-05-19T12:00:00.000Z"];
  let putCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("A1%3AV1")) return jsonResponse({ values: [header] });
    if (String(url).includes("A310%3AV310")) return jsonResponse({ values: [current] });
    if (options.method === "PUT") putCalls += 1;
    return jsonResponse({});
  };

  const result = await applyLedgerQualityRepairs({
    onlyConfirmed: true,
    task: "balance-corrections",
    accessToken: "test",
    fetchImpl,
    report: {
      balanceCorrections: {
        rows: [{
          date: "2026-05-19",
          channel: "трансервайз евро",
          currency: "EUR",
          confidence: "high",
          needs_provider_confirmation: false,
          after: [{
            target: "Ledger",
            sheetRowNumber: 310,
            raw_source_id: "CARD-3806683062",
            patch: {
              operation: "income",
              from_channel: "",
              to_channel: "трансервайз евро",
              direction: "in",
              comment: "Card transaction of -55.60 EUR issued by Yellowsquare; balance_correction_provider_auto_sign_fix",
              updated_at: "2026-05-19T12:00:00.000Z",
            },
          }],
        }],
      },
    },
  });

  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedRows[0].skippedReason, "idempotent");
  assert.equal(putCalls, 0);
});

test("confirmed provider auto balance requires source metadata and is not computed truth", () => {
  const unconfirmed = buildLedgerQualityRepairReport({
    task: "balance-corrections",
    repository: {
      operations: [operation({ date: "2026-05-02", toChannel: "wise usd", currency: "USD", amountNet: "206", amount: "206", balanceAmount: 206, source: "wise" })],
      balances: [{ date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 2 }],
      autoBalances: [],
    },
  });
  assert.equal(unconfirmed.balanceCorrections.rows[0].computed_balance, 1206);
  assert.equal(unconfirmed.balanceCorrections.rows[0].after, null);

  const confirmed = buildLedgerQualityRepairReport({
    task: "balance-corrections",
    confirmations: {
      balanceCorrections: [{
        date: "2026-05-02",
        channel: "wise usd",
        currency: "USD",
        target: "Авто Остатки",
        amount: "1207",
        provider: "wise",
        source: "wise_auto",
        raw_source_id: "wise-balance-1",
        source_reference: "Wise balance API balance id wise-balance-1",
        confidence: "high",
      }],
    },
    repository: {
      operations: [operation({ date: "2026-05-02", toChannel: "wise usd", currency: "USD", amountNet: "206", amount: "206", balanceAmount: 206, source: "wise" })],
      balances: [{ date: "2026-05-01", channel: "wise usd", currency: "USD", amount: "1000", balanceAmount: "1000", sourceSheet: "Остатки", sourceRow: 2 }],
      autoBalances: [],
    },
  });
  assert.equal(confirmed.balanceCorrections.rows[0].confidence, "high");
  assert.equal(confirmed.balanceCorrections.rows[0].target, "Авто Остатки");
  assert.equal(confirmed.balanceCorrections.rows[0].after[0].amount, 1207);
  assert.notEqual(confirmed.balanceCorrections.rows[0].after[0].amount, confirmed.balanceCorrections.rows[0].computed_balance);
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}
