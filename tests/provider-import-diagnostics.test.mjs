import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProviderImportCoverage,
  detectPossibleFeeDoubleCount,
  detectProviderDuplicateRows,
  validateBalanceAfterChain
} from "../server/provider-import-diagnostics.js";

test("buildProviderImportCoverage hard-fails non-empty imports with zero ledger rows", () => {
  const coverage = buildProviderImportCoverage({
    provider: "privatbank",
    source: "privat24",
    inputRows: [{ id: "raw-1" }],
    parsedRows: [],
    ledgerRows: [],
    skippedRows: [{ id: "raw-1" }],
    parserWarnings: ["no ledger rows"]
  });

  assert.equal(coverage.input_rows_count, 1);
  assert.equal(coverage.parsed_rows_count, 0);
  assert.equal(coverage.ledger_rows_count, 0);
  assert.equal(coverage.skipped_rows_count, 1);
  assert.equal(coverage.duplicate_rows_count, 0);
  assert.equal(coverage.needs_review_rows_count, 0);
  assert.deepEqual(coverage.parser_warnings, ["no ledger rows"]);
  assert.equal(coverage.hard_fail, true);
});

test("validateBalanceAfterChain catches a missing Privat24 operation from opening balance", () => {
  const result = validateBalanceAfterChain(
    [
      { date: "2026-05-12", raw_source_id: "missing-plus-5000", direction: "out", amount: "4842.92", balance_after: "11396.27" },
      { date: "2026-05-16", raw_source_id: "income-8700", direction: "in", amount: "8700", balance_after: "20096.27" }
    ],
    { amountKey: "amount", balanceAfterKey: "balance_after", previousBalance: "11239.19" }
  );

  assert.equal(result.balance_chain_ok, false);
  assert.equal(result.balance_chain_gap, true);
  assert.equal(result.first_gap_row.row_id, "missing-plus-5000");
  assert.equal(result.expected_balance_after, 6396.27);
  assert.equal(result.provider_balance_after, 11396.27);
  assert.equal(result.likely_missing_row, true);
});

test("validateBalanceAfterChain catches a missing -4842.92 operation between balances", () => {
  const result = validateBalanceAfterChain(
    [
      { date: "2026-05-04", raw_source_id: "income-5000", direction: "in", amount: "5000", balance_after: "16239.19" },
      { date: "2026-05-16", raw_source_id: "income-8700", direction: "in", amount: "8700", balance_after: "20096.27" }
    ],
    { amountKey: "amount", balanceAfterKey: "balance_after", previousBalance: "11239.19" }
  );

  assert.equal(result.balance_chain_ok, false);
  assert.equal(result.first_gap_row.row_id, "income-8700");
  assert.equal(result.expected_balance_after, 24939.19);
  assert.equal(result.provider_balance_after, 20096.27);
});

test("detectPossibleFeeDoubleCount flags total debit plus separate principal and fee rows", () => {
  const result = detectPossibleFeeDoubleCount([
    { date: "2026-05-22", raw_source_id: "total", from_channel: "приват 24-грн", amount: "20003", direction: "out", currency: "UAH" },
    { date: "2026-05-22", raw_source_id: "principal", from_channel: "приват 24-грн", amount: "20000", direction: "out", currency: "UAH" },
    { date: "2026-05-22", raw_source_id: "fee", from_channel: "приват 24-грн", amount: "3", direction: "out", currency: "UAH" }
  ]);

  assert.equal(result.likely_fee_double_count, true);
  assert.equal(result.candidates[0].total_row_id, "total");
  assert.deepEqual(result.candidates[0].split_row_ids, ["principal", "fee"]);
});

test("detectProviderDuplicateRows counts stable provider raw source duplicates", () => {
  const duplicates = detectProviderDuplicateRows([
    { source: "privat24", raw_source_id: "PB-1", date: "2026-05-01", amount: "10", direction: "in" },
    { source: "privat24", raw_source_id: "PB-1", date: "2026-05-01", amount: "10", direction: "in" }
  ]);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].key, "privat24:PB-1");
});
