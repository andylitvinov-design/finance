const STATUS = {
  CLOSABLE: "closable",
  BLOCKED: "blocked",
  NEEDS_VERIFICATION: "needs_verification",
};

export function buildBalanceClose({ period = {}, balanceCoverage = {}, balanceFixes = {} } = {}) {
  const missingAmountNetRows = Array.isArray(balanceFixes.missing_amount_net_rows)
    ? balanceFixes.missing_amount_net_rows.length
    : 0;
  const missingOstatkiRows = Array.isArray(balanceFixes.missing_ostatki_rows)
    ? balanceFixes.missing_ostatki_rows.length
    : 0;
  const mismatchRows = Number(balanceCoverage?.summary?.mismatch || 0);
  const needsVerificationRows = Number(balanceCoverage?.summary?.needs_verification || 0);
  const accountsWithMovement = Number(balanceCoverage?.summary?.accounts_with_movement || 0);
  const hardBlockers = missingAmountNetRows + missingOstatkiRows + mismatchRows;
  const canClose = hardBlockers === 0 && needsVerificationRows === 0;
  const status = canClose ? STATUS.CLOSABLE : (hardBlockers > 0 ? STATUS.BLOCKED : STATUS.NEEDS_VERIFICATION);

  return {
    period: { from: period?.from || "needs verification", to: period?.to || "needs verification" },
    status,
    can_close: canClose,
    blocking_counts: {
      missing_amount_net_rows: missingAmountNetRows,
      missing_ostatki_rows: missingOstatkiRows,
      mismatch_rows: mismatchRows,
      needs_verification_rows: needsVerificationRows,
    },
    steps: [
      buildStep("amount_net", "Fill Ledger amount_net gaps", missingAmountNetRows),
      buildStep("ostatki", "Add factual closing balances", missingOstatkiRows),
      buildStep("mismatch", "Review balance mismatches", mismatchRows),
      {
        name: "close_period",
        label: "Close period as reconciled",
        status: canClose ? "ok" : (needsVerificationRows ? "needs_verification" : "blocked"),
        count: needsVerificationRows,
        action: canClose ? "The period can be closed." : "Resolve blockers before closing.",
      },
    ],
    message: buildMessage({ status, accountsWithMovement, missingAmountNetRows, missingOstatkiRows, mismatchRows, needsVerificationRows }),
  };
}

function buildStep(name, label, count) {
  return {
    name,
    label,
    status: count ? "blocked" : "ok",
    count,
    action: count ? "Resolve this item before closing." : "OK",
  };
}

function buildMessage({ status, accountsWithMovement, missingAmountNetRows, missingOstatkiRows, mismatchRows, needsVerificationRows }) {
  if (status === STATUS.CLOSABLE) {
    return accountsWithMovement ? "Можно закрыть: все остатки по счетам за период сверены." : "Можно закрыть: за период нет движения по счетам для сверки.";
  }
  if (status === STATUS.NEEDS_VERIFICATION) {
    return `Нужно проверить: ${needsVerificationRows} строк(и) требуют проверки перед закрытием периода.`;
  }
  const parts = [];
  if (missingAmountNetRows) parts.push(`${missingAmountNetRows} строк(и) Ledger без amount_net`);
  if (missingOstatkiRows) parts.push(`${missingOstatkiRows} строк(и) Остатки отсутствуют`);
  if (mismatchRows) parts.push(`${mismatchRows} расхождени(я)`);
  return `Нельзя закрыть: ${parts.join(", ")}.`;
}
