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
  const providerRows = providerEvidence
    .map((row, index) => normalizeProviderRow(row, index, { source: normalizedSource, channel: normalizedChannel, currency: normalizedCurrency }))
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
      return ledgerResult(row, matchedProvider?.status === "matched_wrong_date" ? "date_correction_candidate" : "confirmed_by_provider", matchedProvider);
    }
    const duplicateOfProvider = providerRows.find((provider) => sameOperation(provider, row) && Math.abs(daysBetween(provider.date, row.date)) <= 1);
    return ledgerResult(row, duplicateOfProvider ? "duplicate_candidate" : "not_in_provider_statement", null);
  });

  const migrationLedgerRows = manualMigrationRows.map((row) =>
    ledgerResult(row, "manual_migration_needs_confirmation", null)
  );
  const allLedgerResultRows = [...ledgerResultRows, ...migrationLedgerRows].sort(compareResultRows);
  const providerTotals = buildProviderTotals(providerRows);
  const ledgerTotals = buildLedgerTotals(providerLedgerRows, manualMigrationRows);
  const differences = buildDifferences(providerTotals, ledgerTotals);
  const statusCounts = countBy(providerResultRows, "status");
  const transactionStatus = resolveTransactionStatus(providerResultRows);
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
    provider_evidence_total: providerTotals.total,
    ledger_provider_total: ledgerTotals.total.yoomoney,
    ledger_manual_migration_total: ledgerTotals.total.manual_migration,
    transaction_delta: round(ledgerTotals.total.yoomoney.net - providerTotals.total.net),
    manual_migration_delta: round(ledgerTotals.total.combined.net - providerTotals.total.net),
    provider_totals: providerTotals,
    ledger_totals: ledgerTotals,
    differences,
    row_level: {
      provider_rows: providerResultRows.map(stripInternalMatch),
      ledger_rows: allLedgerResultRows.map(stripInternalMatch),
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
  const source = normalizeSource(row.source ?? ledger.source);
  return {
    index,
    sheetRowNumber: Number(row.sheetRowNumber || row.sheet_row_number || 0) || null,
    date: normalizeDate(ledger.date ?? row.date),
    source,
    channel: getLedgerChannel(row, signedAmount),
    currency: String(ledger.currency ?? row.currency ?? "").trim().toUpperCase(),
    signed_amount: round(signedAmount || 0),
    raw_source_id: String(ledger.raw_source_id ?? row.rawSourceId ?? row.raw_source_id ?? "").trim(),
    external_id: String(ledger.external_id ?? row.externalId ?? row.external_id ?? "").trim(),
    comment: String(ledger.comment ?? row.comment ?? "").trim(),
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

function ledgerResult(row, status, provider) {
  return {
    index: row.index,
    sheetRowNumber: row.sheetRowNumber,
    date: row.date,
    source: row.source,
    channel: row.channel,
    currency: row.currency,
    signed_amount: row.signed_amount,
    raw_source_id: row.raw_source_id,
    external_id: row.external_id,
    comment: row.comment,
    status,
    matched_provider: provider ? {
      evidence_id: provider.evidence_id,
      date: provider.date,
      signed_amount: provider.signed_amount,
      status: provider.status,
    } : null,
  };
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
      needs_provider_confirmation: true,
      do_not_apply_automatically: true,
      reason: row.classification,
    })),
  };
}

function resolveTransactionStatus(rows) {
  const failing = new Set(["missing_in_ledger", "duplicate_in_ledger", "extra_in_ledger", "amount_mismatch", "sign_mismatch", "channel_mismatch"]);
  return rows.some((row) => failing.has(row.status)) ? "mismatch" : "ok";
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
