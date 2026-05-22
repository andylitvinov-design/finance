export function buildProviderImportCoverage(options = {}) {
  const inputRowsCount = countRows(options.inputRows);
  const parsedRowsCount = countRows(options.parsedRows);
  const ledgerRowsCount = countRows(options.ledgerRows);
  const needsReviewRowsCount = countRows(options.needsReviewRows);
  const duplicateRowsCount = countRows(options.duplicateRows);
  const skippedRowsCount = countRows(options.skippedRows);
  const parserWarnings = normalizeWarnings(options.parserWarnings);

  return {
    provider: String(options.provider || "").trim(),
    source: String(options.source || "").trim(),
    channel: String(options.channel || "").trim(),
    currency: String(options.currency || "").trim(),
    period_from: String(options.periodFrom || options.period_from || "").trim(),
    period_to: String(options.periodTo || options.period_to || "").trim(),
    input_rows_count: inputRowsCount,
    parsed_rows_count: parsedRowsCount,
    ledger_rows_count: ledgerRowsCount,
    skipped_rows_count: skippedRowsCount,
    duplicate_rows_count: duplicateRowsCount,
    needs_review_rows_count: needsReviewRowsCount,
    parser_warnings: parserWarnings,
    hard_fail: inputRowsCount > 0 && ledgerRowsCount === 0
  };
}

export function validateBalanceAfterChain(rows = [], options = {}) {
  const orderedRows = normalizeRows(rows).filter((row) => getNumeric(row, options.balanceAfterKey || "balance_after") !== null);
  const gaps = [];
  let previousBalance = parseOptionalNumber(options.previousBalance);
  let checkedRows = 0;

  for (const row of orderedRows) {
    const signedAmount = getSignedAmount(row, options.amountKey || "signed_amount");
    const providerBalanceAfter = getNumeric(row, options.balanceAfterKey || "balance_after");
    if (signedAmount === null || providerBalanceAfter === null) continue;
    if (previousBalance === null) {
      previousBalance = providerBalanceAfter;
      continue;
    }
    checkedRows += 1;
    const expectedBalanceAfter = roundMoney(previousBalance + signedAmount);
    const actualBalanceAfter = roundMoney(providerBalanceAfter);
    if (Math.abs(expectedBalanceAfter - actualBalanceAfter) > 0.01) {
      gaps.push({
        row_id: getRowId(row),
        date: String(row.date || row.operationDate || row.operation_date || "").slice(0, 10),
        signed_amount: roundMoney(signedAmount),
        previous_balance: roundMoney(previousBalance),
        expected_balance_after: expectedBalanceAfter,
        provider_balance_after: actualBalanceAfter,
        balance_chain_gap: roundMoney(actualBalanceAfter - expectedBalanceAfter),
        likely_missing_row: Math.abs(actualBalanceAfter - expectedBalanceAfter) > 0.01,
        likely_duplicate: false,
        likely_wrong_sign: Math.abs(roundMoney(previousBalance - signedAmount) - actualBalanceAfter) <= 0.01
      });
    }
    previousBalance = providerBalanceAfter;
  }

  return {
    balance_chain_ok: gaps.length === 0,
    balance_chain_gap: gaps.length > 0,
    checked_rows_count: checkedRows,
    first_gap_row: gaps[0] || null,
    expected_balance_after: gaps[0]?.expected_balance_after ?? null,
    provider_balance_after: gaps[0]?.provider_balance_after ?? null,
    likely_duplicate: gaps.some((gap) => gap.likely_duplicate),
    likely_missing_row: gaps.some((gap) => gap.likely_missing_row),
    likely_wrong_sign: gaps.some((gap) => gap.likely_wrong_sign),
    likely_fee_double_count: false,
    gaps
  };
}

export function detectProviderDuplicateRows(rows = []) {
  const seen = new Map();
  const duplicates = [];
  for (const row of normalizeRows(rows)) {
    const key = getStableDuplicateKey(row);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates.push({
        key,
        first_row_id: getRowId(seen.get(key)),
        duplicate_row_id: getRowId(row),
        date: String(row.date || "").slice(0, 10),
        amount: getSignedAmount(row, "signed_amount")
      });
    } else {
      seen.set(key, row);
    }
  }
  return duplicates;
}

export function detectPossibleFeeDoubleCount(rows = []) {
  const normalizedRows = normalizeRows(rows)
    .map((row, index) => ({
      row,
      index,
      date: String(row.date || "").slice(0, 10),
      channel: String(row.from_channel || row.to_channel || row.channel || "").trim(),
      currency: String(row.currency || "").trim().toUpperCase(),
      signedAmount: getSignedAmount(row, "signed_amount")
    }))
    .filter((item) => item.signedAmount !== null && item.date && item.channel);
  const candidates = [];

  for (const total of normalizedRows) {
    for (let leftIndex = 0; leftIndex < normalizedRows.length; leftIndex += 1) {
      const left = normalizedRows[leftIndex];
      if (left.index === total.index || !sameStatementBucket(total, left)) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < normalizedRows.length; rightIndex += 1) {
        const right = normalizedRows[rightIndex];
        if (right.index === total.index || !sameStatementBucket(total, right)) continue;
        const sameSign = Math.sign(total.signedAmount) === Math.sign(left.signedAmount)
          && Math.sign(total.signedAmount) === Math.sign(right.signedAmount);
        const splitMatchesTotal = Math.abs(Math.abs(total.signedAmount) - (Math.abs(left.signedAmount) + Math.abs(right.signedAmount))) <= 0.01;
        if (sameSign && splitMatchesTotal) {
          candidates.push({
            date: total.date,
            channel: total.channel,
            currency: total.currency,
            total_row_id: getRowId(total.row),
            total_amount: roundMoney(total.signedAmount),
            split_row_ids: [getRowId(left.row), getRowId(right.row)],
            split_amounts: [roundMoney(left.signedAmount), roundMoney(right.signedAmount)],
            likely_fee_double_count: true
          });
        }
      }
    }
  }

  return {
    likely_fee_double_count: candidates.length > 0,
    candidates
  };
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (Number.isFinite(Number(value))) return Math.max(0, Number(value));
  return 0;
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows.filter(Boolean) : [];
}

function normalizeWarnings(warnings) {
  return Array.isArray(warnings)
    ? warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
    : [];
}

function getStableDuplicateKey(row) {
  const provider = String(row.provider || row.source || "").trim().toLowerCase();
  const rawId = String(row.raw_source_id || row.external_id || row.externalId || row.sourceTransactionId || "").trim();
  if (provider && rawId) return `${provider}:${rawId}`;
  const date = String(row.date || "").slice(0, 10);
  const channel = String(row.from_channel || row.to_channel || row.channel || "").trim().toLowerCase();
  const amount = getSignedAmount(row, "signed_amount");
  const counterparty = String(row.counterparty || row.counterpartyName || row.description || row.comment || "").trim().toLowerCase();
  if (!date || !channel || amount === null || !counterparty) return "";
  return `${provider || "provider"}:${date}:${channel}:${roundMoney(amount)}:${counterparty}`;
}

function sameStatementBucket(left, right) {
  return left.date === right.date
    && left.channel === right.channel
    && (!left.currency || !right.currency || left.currency === right.currency);
}

function getRowId(row) {
  return String(row.raw_source_id || row.external_id || row.externalId || row.sourceTransactionId || row.id || "").trim();
}

function getNumeric(row, key) {
  if (typeof key === "function") return parseOptionalNumber(key(row));
  return parseOptionalNumber(row?.[key]);
}

function getSignedAmount(row, key) {
  const explicit = getNumeric(row, key);
  if (explicit !== null && key === "signed_amount") return explicit;
  if (explicit !== null) return applyRowSign(row, explicit);
  const amount = parseOptionalNumber(row?.amount ?? row?.localAmount ?? row?.amount_net ?? row?.balance_amount);
  if (amount === null) return null;
  return applyRowSign(row, amount);
}

function applyRowSign(row, amount) {
  const direction = String(row?.direction || row?.operation || "").trim().toLowerCase();
  if (["out", "expense", "business_expense", "personal_expense", "exchange_out"].includes(direction)) return -Math.abs(amount);
  if (["in", "income", "servicein", "exchange_in"].includes(direction)) return Math.abs(amount);
  if (String(row?.from_channel || row?.fromChannel || "").trim() && !String(row?.to_channel || row?.toChannel || "").trim()) return -Math.abs(amount);
  return amount;
}

function parseOptionalNumber(value) {
  const raw = String(value ?? "").trim().replace(/\s+/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/,/g, "")
    : raw.replace(",", ".");
  const parsed = Number.parseFloat(normalized.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
