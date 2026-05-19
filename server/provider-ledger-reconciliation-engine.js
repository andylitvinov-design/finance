const DAY_MS = 86400000;

export function buildYooMoneyProviderEvidenceFixture() {
  return [
    providerRow("2026-04-08", 9350.24),
    providerRow("2026-04-08", 9350.24),
    providerRow("2026-04-09", 9350.24),
    providerRow("2026-04-09", -4297, "RK*OOO_SALEBOT"),
    providerRow("2026-04-11", 850),
    providerRow("2026-04-14", 9376.54),
    providerRow("2026-04-14", 9376.54),
    providerRow("2026-04-14", -6990, "BITRIX24"),
    providerRow("2026-04-18", 9376.54),
    providerRow("2026-04-18", 9376.54),
    providerRow("2026-04-24", -12920),
    providerRow("2026-04-24", 12920, "refund"),
    providerRow("2026-04-24", -5195),
    providerRow("2026-04-25", 2755.86),
    providerRow("2026-04-27", 2633.9),
    providerRow("2026-04-28", 438.98),
    providerRow("2026-05-05", -74771.5),
    providerRow("2026-05-06", -25),
    providerRow("2026-05-07", -500),
    providerRow("2026-05-08", 8674.29),
    providerRow("2026-05-08", 4337.15),
    providerRow("2026-05-09", -4297),
    providerRow("2026-05-09", 431.82),
    providerRow("2026-05-10", 8.82),
    providerRow("2026-05-10", 8.82),
    providerRow("2026-05-10", 8.82),
    providerRow("2026-05-10", 8.82),
    providerRow("2026-05-10", 8.82),
    providerRow("2026-05-10", 440.77),
    providerRow("2026-05-14", -6990),
  ].map((row, index) => ({
    ...row,
    provider: "yoomoney",
    source: "yoomoney",
    channel: "Яндекс руб",
    currency: "RUB",
    evidence_id: `yoomoney-fixture-${index + 1}`,
  }));
}

function providerRow(date, signedAmount, description = "") {
  return { date, signedAmount, signed_amount: signedAmount, description };
}

export function buildProviderLedgerReconciliation({
  source = "",
  channel = "",
  currency = "",
  providerEvidence = [],
  ledgerRows = [],
  balanceDiagnostics = [],
  period = {},
} = {}) {
  const normalizedSource = normalizeSource(source);
  const normalizedChannel = String(channel || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const allProviderRows = providerEvidence
    .map((row, index) => normalizeProviderRow(row, index, { source: normalizedSource, channel: normalizedChannel, currency: normalizedCurrency }))
    .filter((row) => row.source === normalizedSource && row.currency === normalizedCurrency && row.channel === normalizedChannel);
  const providerRows = allProviderRows
    .filter((row) => isInPeriod(row.date, period));
  const ledger = ledgerRows
    .map((row, index) => normalizeLedgerRow(row, index))
    .filter((row) => isInPeriod(row.date, period))
    .filter((row) => row.currency === normalizedCurrency && row.channel === normalizedChannel);
  const providerLedgerRows = ledger.filter((row) => normalizeSource(row.source) === normalizedSource);
  const manualMigrationRows = ledger.filter((row) => isManualMigration(row));
  const usedLedgerIndexes = new Set();
  const providerResultRows = [];

  for (const provider of providerRows) {
    const exact = findUnused(providerLedgerRows, usedLedgerIndexes, (ledgerRow) => sameOperation(provider, ledgerRow) && provider.date === ledgerRow.date);
    if (exact) {
      usedLedgerIndexes.add(exact.index);
      providerResultRows.push(providerResult(provider, "matched_exact", exact));
      continue;
    }

    const nearby = findUnused(providerLedgerRows, usedLedgerIndexes, (ledgerRow) =>
      sameOperation(provider, ledgerRow) && Math.abs(daysBetween(provider.date, ledgerRow.date)) <= 1
    );
    if (nearby) {
      usedLedgerIndexes.add(nearby.index);
      providerResultRows.push(providerResult(provider, "matched_wrong_date", nearby, {
        needs_source_id_confirmation: !provider.source_id && !nearby.raw_source_id,
      }));
      continue;
    }

    const amountMismatch = findUnused(providerLedgerRows, usedLedgerIndexes, (ledgerRow) =>
      provider.date === ledgerRow.date && Math.sign(provider.signed_amount) === Math.sign(ledgerRow.signed_amount)
    );
    if (amountMismatch) {
      providerResultRows.push(providerResult(provider, "amount_mismatch", amountMismatch));
      continue;
    }

    const signMismatch = findUnused(providerLedgerRows, usedLedgerIndexes, (ledgerRow) =>
      provider.date === ledgerRow.date && Math.abs(Math.abs(provider.signed_amount) - Math.abs(ledgerRow.signed_amount)) <= 0.0001
    );
    if (signMismatch) {
      providerResultRows.push(providerResult(provider, "sign_mismatch", signMismatch));
      continue;
    }

    providerResultRows.push(providerResult(provider, "missing_in_ledger", null, {
      needs_source_id_confirmation: !provider.source_id,
    }));
  }

  const ledgerResultRows = providerLedgerRows.map((row) => {
    if (usedLedgerIndexes.has(row.index)) {
      const matchedProvider = providerResultRows.find((provider) => provider.matched_ledger?.index === row.index);
      return ledgerResult(row, matchedProvider?.status === "matched_wrong_date" ? "date_correction_candidate" : "confirmed_by_provider", matchedProvider, {
        providerRows,
        allProviderRows,
        providerLedgerRows,
        period,
      });
    }
    const duplicateOfProvider = providerRows.find((provider) => sameOperation(provider, row) && Math.abs(daysBetween(provider.date, row.date)) <= 1);
    return ledgerResult(row, duplicateOfProvider ? "duplicate_candidate" : "not_in_provider_statement", null, {
      providerRows,
      allProviderRows,
      providerLedgerRows,
      period,
    });
  });

  const migrationLedgerRows = manualMigrationRows.map((row) =>
    ledgerResult(row, "manual_migration_needs_confirmation", null, {
      providerRows,
      allProviderRows,
      providerLedgerRows: ledger,
      period,
    })
  );
  const allLedgerResultRows = [...ledgerResultRows, ...migrationLedgerRows].sort(compareResultRows);
  const confirmedLedgerRows = ledgerResultRows.filter((row) =>
    row.status === "confirmed_by_provider" || row.status === "date_correction_candidate"
  );
  const extraLedgerRows = ledgerResultRows.filter((row) =>
    row.status === "duplicate_candidate" || row.status === "not_in_provider_statement" || row.status === "unsafe_to_mutate"
  );
  const wrongDateRows = providerResultRows.filter((row) => row.status === "matched_wrong_date");
  const extraProviderRows = providerResultRows.filter((row) =>
    row.status === "missing_in_ledger"
      || row.status === "amount_mismatch"
      || row.status === "sign_mismatch"
      || row.status === "channel_mismatch"
  );
  const providerTotals = buildProviderTotals(providerRows);
  const ledgerTotals = buildLedgerTotals(confirmedLedgerRows, manualMigrationRows);
  const legacySourceYooMoneyTotal = buildLedgerOnlyTotal(providerLedgerRows);
  const extraLedgerTotal = buildLedgerOnlyTotal(extraLedgerRows);
  const confirmedMatchedLedgerTotal = ledgerTotals.total.yoomoney;
  const manualMigrationTotal = ledgerTotals.total.manual_migration;
  const combinedTotal = ledgerTotals.total.combined;
  const differences = buildDifferences(providerTotals, ledgerTotals);
  const statusCounts = countBy(providerResultRows, "status");
  const monthlyTotalStatus = resolveMonthlyTotalStatus(providerTotals.total, confirmedMatchedLedgerTotal);
  const dateAlignmentStatus = wrongDateRows.length ? "needs_source_id_confirmation" : "ok";
  const extraLedgerStatus = extraLedgerRows.length ? "needs_confirmation" : "ok";
  const manualMigrationStatus = migrationLedgerRows.length ? "manual_migration_needs_confirmation" : "ok";
  const transactionStatus = resolveTransactionStatus({
    providerRows: providerResultRows,
    monthlyTotalStatus,
  });
  const balanceDiag = buildBalanceDiagnostics(balanceDiagnostics, transactionStatus);

  return {
    source: normalizedSource,
    channel: normalizedChannel,
    currency: normalizedCurrency,
    period: {
      from: normalizeDate(period.from) || null,
      to: normalizeDate(period.to) || null,
    },
    transaction_reconciliation_status: transactionStatus,
    monthly_total_status: monthlyTotalStatus,
    date_alignment_status: dateAlignmentStatus,
    extra_ledger_status: extraLedgerStatus,
    manual_migration_status: manualMigrationStatus,
    provider_evidence_total: providerTotals.total,
    ledger_provider_total: confirmedMatchedLedgerTotal,
    raw_ledger_yoomoney_total: confirmedMatchedLedgerTotal,
    confirmed_matched_ledger_total: confirmedMatchedLedgerTotal,
    legacy_source_yoomoney_total: legacySourceYooMoneyTotal.total,
    extra_ledger_total: extraLedgerTotal.total,
    ledger_manual_migration_total: manualMigrationTotal,
    manual_migration_total: manualMigrationTotal,
    combined_total: combinedTotal,
    provider_net: providerTotals.total.net,
    raw_ledger_yoomoney_net: confirmedMatchedLedgerTotal.net,
    confirmed_matched_ledger_net: confirmedMatchedLedgerTotal.net,
    transaction_monthly_delta: round(confirmedMatchedLedgerTotal.net - providerTotals.total.net),
    transaction_delta: round(confirmedMatchedLedgerTotal.net - providerTotals.total.net),
    manual_migration_delta: round(combinedTotal.net - providerTotals.total.net),
    provider_totals: providerTotals,
    ledger_totals: ledgerTotals,
    differences,
    row_level: {
      provider_rows: providerResultRows.map(stripInternalMatch),
      ledger_rows: allLedgerResultRows.map(stripInternalMatch),
      provider_total_rows: providerRows.map(stripInternalMatch),
      ledger_yoomoney_total_rows: confirmedLedgerRows.map(stripInternalMatch),
      excluded_ledger_rows: [...extraLedgerRows, ...migrationLedgerRows].sort(compareResultRows).map(stripInternalMatch),
      extra_provider_rows: extraProviderRows.map(stripInternalMatch),
      extra_ledger_rows: extraLedgerRows.map(stripInternalMatch),
      wrong_date_rows: wrongDateRows.map(stripInternalMatch),
      manual_migration_rows: migrationLedgerRows.map(stripInternalMatch),
      provider_status_counts: statusCounts,
      ledger_status_counts: countBy(allLedgerResultRows, "status"),
      matched_exact: providerResultRows.filter((row) => row.status === "matched_exact"),
      matched_wrong_date: providerResultRows.filter((row) => row.status === "matched_wrong_date"),
      missing_in_ledger: providerResultRows.filter((row) => row.status === "missing_in_ledger"),
      duplicate_in_ledger: allLedgerResultRows.filter((row) => row.status === "duplicate_candidate"),
      extra_manual_migration: migrationLedgerRows,
    },
    safe_fixes_available: buildSafeFixes(providerResultRows, allLedgerResultRows),
    manual_blockers: buildManualBlockers(providerResultRows, migrationLedgerRows, balanceDiag),
    balance_diagnostics: balanceDiag,
    stale_ostatki_rows: balanceDiag.rows,
    manual_confirmation_required_rows: [
      ...migrationLedgerRows,
      ...balanceDiag.copyable_rows,
      ...providerResultRows.filter((row) => row.status === "needs_source_id_confirmation"),
    ].map(stripInternalMatch),
  };
}

function normalizeProviderRow(row, index, fallback) {
  const signedAmount = parseAmount(row.signedAmount ?? row.signed_amount ?? row.amount);
  return {
    index,
    evidence_id: String(row.evidence_id || row.id || `provider-${index + 1}`),
    date: normalizeDate(row.date),
    source: normalizeSource(row.source || row.provider || fallback.source),
    channel: String(row.channel || fallback.channel || "").trim(),
    currency: String(row.currency || fallback.currency || "").trim().toUpperCase(),
    signed_amount: round(signedAmount || 0),
    description: String(row.description || row.comment || "").trim(),
    source_id: String(row.raw_source_id || row.rawSourceId || row.external_id || row.externalId || row.source_id || "").trim(),
  };
}

function normalizeLedgerRow(row, index) {
  const ledger = row?.ledgerV2 || {};
  const signedAmount = parseAmount(ledger.balance_amount ?? row.balanceAmount ?? row.balance_amount);
  const amountNet = parseAmount(ledger.amount_net ?? row.amountNet ?? row.amount_net);
  const amount = parseAmount(ledger.amount ?? row.amount);
  const source = normalizeSource(row.source ?? ledger.source);
  const comment = String(ledger.comment ?? row.comment ?? "").trim();
  return {
    index,
    sheetRowNumber: Number(row.sheetRowNumber || row.sheet_row_number || 0) || null,
    date: normalizeDate(ledger.date ?? row.date),
    operation: String(ledger.operation ?? row.operation ?? (signedAmount < 0 ? "expense" : "income")).trim(),
    source,
    from_channel: String(ledger.from_channel ?? row.fromChannel ?? row.from_channel ?? "").trim(),
    to_channel: String(ledger.to_channel ?? row.toChannel ?? row.to_channel ?? "").trim(),
    channel: getLedgerChannel(row, signedAmount),
    currency: String(ledger.currency ?? row.currency ?? "").trim().toUpperCase(),
    amount: amount ?? (amountNet ?? Math.abs(signedAmount || 0)),
    amount_net: amountNet ?? Math.abs(signedAmount || 0),
    signed_amount: round(signedAmount || 0),
    raw_source_id: String(ledger.raw_source_id ?? row.rawSourceId ?? row.raw_source_id ?? "").trim(),
    external_id: String(ledger.external_id ?? row.externalId ?? row.external_id ?? "").trim(),
    transfer_group_id: String(ledger.transfer_group_id ?? row.transferGroupId ?? row.transfer_group_id ?? "").trim(),
    comment,
    counterparty: String(ledger.counterparty ?? row.counterparty ?? parseCounterparty(comment)).trim(),
    description: String(ledger.description ?? row.description ?? comment).trim(),
    created_at: String(ledger.created_at ?? row.createdAt ?? row.created_at ?? "").trim(),
    updated_at: String(ledger.updated_at ?? row.updatedAt ?? row.updated_at ?? "").trim(),
  };
}

function getLedgerChannel(row, signedAmount) {
  const ledger = row?.ledgerV2 || {};
  const from = String(ledger.from_channel ?? row.fromChannel ?? row.from_channel ?? "").trim();
  const to = String(ledger.to_channel ?? row.toChannel ?? row.to_channel ?? "").trim();
  return signedAmount < 0 ? (from || to) : (to || from);
}

function findUnused(rows, used, predicate) {
  return rows.find((row) => !used.has(row.index) && predicate(row)) || null;
}

function sameOperation(provider, ledgerRow) {
  return provider.currency === ledgerRow.currency
    && Math.abs(provider.signed_amount - ledgerRow.signed_amount) <= 0.0001;
}

function providerResult(provider, status, ledgerRow, extra = {}) {
  return {
    evidence_id: provider.evidence_id,
    date: provider.date,
    source: provider.source,
    channel: provider.channel,
    currency: provider.currency,
    signed_amount: provider.signed_amount,
    description: provider.description,
    source_id: provider.source_id,
    status,
    matched_ledger: ledgerRow ? ledgerResult(ledgerRow, "matched", null) : null,
    ...extra,
  };
}

function ledgerResult(row, status, provider, context = {}) {
  const classification = classifyLedgerRow(row, status, context);
  return {
    index: row.index,
    sheetRowNumber: row.sheetRowNumber,
    date: row.date,
    operation: row.operation,
    from_channel: row.from_channel,
    to_channel: row.to_channel,
    amount: row.amount,
    amount_net: row.amount_net,
    source: row.source,
    channel: row.channel,
    currency: row.currency,
    signed_amount: row.signed_amount,
    raw_source_id: row.raw_source_id,
    external_id: row.external_id,
    transfer_group_id: row.transfer_group_id,
    comment: row.comment,
    counterparty: row.counterparty,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status,
    classification,
    evidence_checks: buildLedgerEvidenceChecks(row, context),
    manual_request: buildManualRequest(row),
    matched_provider: provider ? {
      evidence_id: provider.evidence_id,
      date: provider.date,
      signed_amount: provider.signed_amount,
      status: provider.status,
    } : null,
  };
}

function classifyLedgerRow(row, status, context = {}) {
  if (status === "confirmed_by_provider") return "real_provider_operation_missing_from_screenshots";
  if (status === "date_correction_candidate") return "wrong_date_outside_provider_window";
  const checks = buildLedgerEvidenceChecks(row, context);
  if (checks.same_source_id_ledger_rows.length) return "duplicate_of_existing_provider_row";
  if (status === "duplicate_candidate") return "duplicate_of_existing_provider_row";
  if (normalizeSource(row.source) !== normalizeSource(context.source || row.source)) return "wrong_source";
  if (row.channel !== (context.channel || row.channel)) return "wrong_channel";
  return "needs_manual_confirmation";
}

function buildLedgerEvidenceChecks(row, {
  providerRows = [],
  allProviderRows = providerRows,
  providerLedgerRows = [],
  period = {},
} = {}) {
  const aprilProviderRows = allProviderRows.filter((provider) => provider.date >= "2026-04-01" && provider.date <= "2026-04-30" && sameOperation(provider, row));
  const mayProviderRows = allProviderRows.filter((provider) => provider.date >= "2026-05-01" && provider.date <= "2026-05-31" && sameOperation(provider, row));
  const nearbyProviderRows = allProviderRows.filter((provider) =>
    sameOperation(provider, row) && Math.abs(daysBetween(provider.date, row.date)) <= 3
  );
  const sameAmountOppositeSignRows = allProviderRows.filter((provider) =>
    provider.currency === row.currency && Math.abs(provider.signed_amount + row.signed_amount) <= 0.0001
  );
  const rowIds = new Set([row.raw_source_id, row.external_id].filter(Boolean));
  const sameSourceIdLedgerRows = providerLedgerRows
    .filter((candidate) => candidate.index !== row.index)
    .filter((candidate) => [candidate.raw_source_id, candidate.external_id].some((id) => rowIds.has(id)))
    .map(compactLedgerEvidenceRow);

  return {
    april_provider_rows: aprilProviderRows.map(compactProviderEvidenceRow),
    may_provider_rows: mayProviderRows.map(compactProviderEvidenceRow),
    nearby_provider_rows: nearbyProviderRows.map(compactProviderEvidenceRow),
    same_amount_opposite_sign_rows: sameAmountOppositeSignRows.map(compactProviderEvidenceRow),
    same_source_id_ledger_rows: sameSourceIdLedgerRows,
    period: {
      from: normalizeDate(period.from) || null,
      to: normalizeDate(period.to) || null,
    },
  };
}

function compactProviderEvidenceRow(row) {
  return {
    evidence_id: row.evidence_id,
    date: row.date,
    signed_amount: row.signed_amount,
    currency: row.currency,
    description: row.description,
    source_id: row.source_id,
  };
}

function compactLedgerEvidenceRow(row) {
  return {
    sheetRowNumber: row.sheetRowNumber,
    date: row.date,
    signed_amount: row.signed_amount,
    currency: row.currency,
    source: row.source,
    raw_source_id: row.raw_source_id,
    external_id: row.external_id,
    comment: row.comment,
  };
}

function buildManualRequest(row) {
  return `Confirm whether Ledger row ${row.sheetRowNumber || "unknown"} / raw_source_id ${row.raw_source_id || row.external_id || "missing"} is a real YooMoney operation; provide screenshot/detail.`;
}

function buildProviderTotals(rows) {
  const byMonth = {};
  for (const row of rows) addSignedAmount(byMonth, row.date.slice(0, 7), row.signed_amount);
  return finalizeTotals(byMonth);
}

function buildLedgerTotals(providerRows, migrationRows) {
  const providerByMonth = {};
  const migrationByMonth = {};
  for (const row of providerRows) addSignedAmount(providerByMonth, row.date.slice(0, 7), row.signed_amount);
  for (const row of migrationRows) addSignedAmount(migrationByMonth, row.date.slice(0, 7), row.signed_amount);
  const months = new Set([...Object.keys(providerByMonth), ...Object.keys(migrationByMonth)]);
  const byMonth = {};
  for (const month of months) {
    const yoomoney = finalizeTotal(providerByMonth[month]);
    const manualMigration = finalizeTotal(migrationByMonth[month]);
    byMonth[month] = {
      yoomoney,
      manual_migration: manualMigration,
      combined: finalizeTotal({
        income: yoomoney.income + manualMigration.income,
        expense: yoomoney.expense + manualMigration.expense,
        net: yoomoney.net + manualMigration.net,
      }),
    };
  }
  return {
    by_month: byMonth,
    total: {
      yoomoney: sumNestedTotals(byMonth, "yoomoney"),
      manual_migration: sumNestedTotals(byMonth, "manual_migration"),
      combined: sumNestedTotals(byMonth, "combined"),
    },
  };
}

function buildLedgerOnlyTotal(rows) {
  const byMonth = {};
  for (const row of rows) addSignedAmount(byMonth, row.date.slice(0, 7), row.signed_amount);
  return finalizeTotals(byMonth);
}

function buildDifferences(providerTotals, ledgerTotals) {
  const months = new Set([...Object.keys(providerTotals.by_month), ...Object.keys(ledgerTotals.by_month)]);
  const byMonth = {};
  for (const month of months) {
    const provider = providerTotals.by_month[month] || finalizeTotal();
    const ledger = ledgerTotals.by_month[month] || { yoomoney: finalizeTotal(), combined: finalizeTotal() };
    byMonth[month] = {
      provider_vs_yoomoney: round(ledger.yoomoney.net - provider.net),
      provider_vs_combined: round(ledger.combined.net - provider.net),
    };
  }
  return { by_month: byMonth };
}

function addSignedAmount(group, month, signedAmount) {
  if (!month) return;
  const current = group[month] || { income: 0, expense: 0, net: 0 };
  if (signedAmount >= 0) current.income += signedAmount;
  else current.expense += Math.abs(signedAmount);
  current.net += signedAmount;
  group[month] = current;
}

function finalizeTotals(byMonth) {
  const finalized = {};
  for (const [month, total] of Object.entries(byMonth)) finalized[month] = finalizeTotal(total);
  return { by_month: finalized, total: sumTotals(Object.values(finalized)) };
}

function finalizeTotal(total = {}) {
  const row = {
    income: round(total.income || 0),
    expense: round(total.expense || 0),
    net: round(total.net || 0),
  };
  row.income_display = formatMoney(row.income);
  row.expense_display = formatMoney(row.expense);
  row.net_display = formatMoney(row.net);
  return row;
}

function sumTotals(rows) {
  return finalizeTotal(rows.reduce((acc, row) => ({
    income: acc.income + Number(row.income || 0),
    expense: acc.expense + Number(row.expense || 0),
    net: acc.net + Number(row.net || 0),
  }), { income: 0, expense: 0, net: 0 }));
}

function sumNestedTotals(byMonth, key) {
  return sumTotals(Object.values(byMonth).map((row) => row[key] || finalizeTotal()));
}

function buildSafeFixes(providerRows, ledgerRows) {
  return {
    date_correction: providerRows
      .filter((row) => row.status === "matched_wrong_date")
      .map((row) => ({
        evidence_id: row.evidence_id,
        provider_date: row.date,
        ledger_row: row.matched_ledger?.sheetRowNumber || null,
        ledger_date: row.matched_ledger?.date || null,
        apply_allowed: Boolean(row.source_id && row.matched_ledger?.raw_source_id && row.source_id === row.matched_ledger.raw_source_id),
      })),
    duplicate_marking: ledgerRows.filter((row) => row.status === "duplicate_candidate"),
    source_correction: [],
  };
}

function buildManualBlockers(providerRows, migrationRows, balanceDiagnostics) {
  return {
    missing_source_id: providerRows.filter((row) => row.status === "needs_source_id_confirmation" || row.needs_source_id_confirmation),
    missing_balance_after_operation: [],
    manual_migration_confirmation_needed: migrationRows,
    stale_ostatki_needs_provider_balance: balanceDiagnostics.rows,
  };
}

function buildBalanceDiagnostics(rows, transactionStatus) {
  const normalizedRows = (rows || []).map((row) => {
    const computed = row.computed_closing_balance ?? row.calculated_closing_balance ?? row.closing_balance ?? null;
    const classification = transactionStatus === "ok"
      ? "stale_or_wrong_ostatki_needs_provider_balance"
      : "operation_sum_mismatch";
    return {
      date: normalizeDate(row.date),
      channel: row.channel || "",
      currency: String(row.currency || "").trim().toUpperCase(),
      status: row.status || "",
      classification,
      computed_closing_balance: computed,
      amount_hint: computed,
      provider_reported_balance: row.provider_reported_balance ?? row.manual_provider_closing_balance ?? null,
      sourceRow: row.sourceRow ?? row.source_row ?? null,
      current_ostatki_amount: row.provider_reported_balance ?? row.manual_provider_closing_balance ?? null,
      computed_amount_hint: computed,
      required_provider_evidence: "Provider balance after operation for the exact date/channel/currency; computed amount is a hint, not factual balance.",
      needs_provider_confirmation: true,
      do_not_apply_automatically: true,
    };
  });
  return {
    rows: normalizedRows,
    status_counts: countBy(normalizedRows, "classification"),
    copyable_rows: normalizedRows.map((row) => ({
      sheet: "Остатки",
      date: row.date,
      channel: row.channel,
      currency: row.currency,
      amount: null,
      amount_hint: row.amount_hint,
      current_ostatki_amount: row.current_ostatki_amount,
      computed_amount_hint: row.computed_amount_hint,
      required_provider_evidence: row.required_provider_evidence,
      needs_provider_confirmation: true,
      do_not_apply_automatically: true,
      reason: row.classification,
    })),
  };
}

function resolveMonthlyTotalStatus(providerTotal, ledgerTotal) {
  return Math.abs(round(Number(ledgerTotal?.net || 0) - Number(providerTotal?.net || 0))) <= 0.0001
    ? "ok"
    : "mismatch";
}

function resolveTransactionStatus({ providerRows, monthlyTotalStatus }) {
  const failingProvider = new Set(["missing_in_ledger", "duplicate_in_ledger", "extra_in_ledger", "amount_mismatch", "sign_mismatch", "channel_mismatch"]);
  return monthlyTotalStatus !== "ok"
    || providerRows.some((row) => failingProvider.has(row.status))
    ? "mismatch"
    : "ok";
}

function stripInternalMatch(row) {
  if (!row || typeof row !== "object") return row;
  const { index, matched_ledger, matched_provider, ...rest } = row;
  return {
    ...rest,
    ...(matched_ledger ? { matched_ledger: stripInternalMatch(matched_ledger) } : {}),
    ...(matched_provider ? { matched_provider } : {}),
  };
}

function countBy(rows, field) {
  return (rows || []).reduce((acc, row) => {
    const key = row?.[field] || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function compareResultRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  return Number(left.sheetRowNumber || 0) - Number(right.sheetRowNumber || 0);
}

function isManualMigration(row) {
  return normalizeSource(row.source) === "migration" || /^migration[:_-]/i.test(row.raw_source_id || "");
}

function parseCounterparty(comment) {
  const raw = String(comment || "").trim();
  if (!raw) return "";
  return raw.split("|")[0].trim();
}

function isInPeriod(date, period = {}) {
  if (!date) return false;
  const from = normalizeDate(period.from);
  const to = normalizeDate(period.to);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function daysBetween(left, right) {
  return Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / DAY_MS);
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeSource(value) {
  const source = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["yoo_money", "yamoney", "yandex", "юмани", "юmoney"].includes(source)) return "yoomoney";
  return source;
}

function parseAmount(value) {
  const parsed = Number(String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}
