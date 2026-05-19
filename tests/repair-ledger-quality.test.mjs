import assert from "node:assert/strict";
import test from "node:test";

import {
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
    task: "all",
    to: "",
  });
});

test("parseArgs supports required task names and legacy mismatch alias", () => {
  assert.equal(parseArgs(["--task", "mismatches"]).task, "mismatches");
  assert.equal(parseArgs(["--task", "missing-balances"]).task, "missing-balances");
  assert.equal(parseArgs(["--task", "normalize-sources"]).task, "normalize-sources");
  assert.equal(parseArgs(["--task", "yoomoney-reconcile", "--from", "2026-05-01", "--to", "2026-05-19"]).task, "yoomoney-reconcile");
  assert.equal(parseArgs(["--task", "yoomoney-reconcile", "--from", "2026-05-01", "--to", "2026-05-19"]).from, "2026-05-01");
  assert.equal(parseArgs(["--task", "yoomoney-reconcile", "--from", "2026-05-01", "--to", "2026-05-19"]).to, "2026-05-19");
  assert.equal(parseArgs(["--task", "mismatch-report"]).task, "mismatches");
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
