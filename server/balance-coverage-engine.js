const STATUS = {
  OK: "ok",
  MISMATCH: "mismatch",
  MISSING_OPENING: "missing_opening_balance",
  MISSING_PROVIDER: "missing_provider_balance",
  NEEDS_VERIFICATION: "needs_verification",
};

export function buildBalanceCoverage(dailyBalanceResult = {}) {
  const dailyRows = Array.isArray(dailyBalanceResult.rows) ? dailyBalanceResult.rows : [];
  const accounts = dailyRows.map(toCoverageAccount).sort(compareCoverageRows);
  const summary = buildCoverageSummary(accounts, dailyBalanceResult.summary || {});

  return {
    accounts,
    actionable_accounts: buildActionableAccounts(accounts),
    summary,
  };
}

function toCoverageAccount(row) {
  const hasOpeningBalance = row?.opening_balance !== null && row?.opening_balance !== undefined;
  const hasClosingBalance = row?.provider_reported_balance !== null && row?.provider_reported_balance !== undefined;
  const status = normalizeStatus(row?.status);
  const account = {
    date: String(row?.date || ""),
    channel: String(row?.channel || ""),
    currency: String(row?.currency || ""),
    movement_rows: 1,
    has_movement: true,
    has_opening_balance: hasOpeningBalance,
    has_closing_balance: hasClosingBalance,
    opening_balance: hasOpeningBalance ? round(row.opening_balance) : null,
    inflow: round(row?.inflow),
    outflow: round(row?.outflow),
    net_change: round(row?.net_change),
    computed_closing_balance: row?.closing_balance === null || row?.closing_balance === undefined
      ? null
      : round(row.closing_balance),
    provider_reported_balance: hasClosingBalance ? round(row.provider_reported_balance) : null,
    difference: row?.difference === null || row?.difference === undefined ? null : round(row.difference),
    status,
    balance_source: hasClosingBalance ? "manual" : "missing",
  };
  return {
    ...account,
    diagnosis: buildDiagnosis(account),
    fix_action: buildFixAction(account),
    fix_priority: getFixPriority(status),
    formula: buildFormula(account),
  };
}

function buildDiagnosis(account) {
  if (account.status === STATUS.OK) {
    return "Сверено: opening_balance + inflow - outflow equals provider_reported_balance.";
  }
  if (account.status === STATUS.MISSING_OPENING) {
    return `Нет начального остатка: не найдена строка Остатки до ${account.date} для ${account.channel} ${account.currency}.`;
  }
  if (account.status === STATUS.MISSING_PROVIDER) {
    return `Нет фактического остатка: не найдена строка Остатки за ${account.date} для ${account.channel} ${account.currency}.`;
  }
  if (account.status === STATUS.MISMATCH) {
    return `Расхождение: provider_reported_balance отличается от computed_closing_balance на ${formatDiagnosticNumber(account.difference)}.`;
  }
  return `Нужна проверка: найдена неполная строка Остатки или недостаточно данных для ${account.date} ${account.channel} ${account.currency}.`;
}

function buildFixAction(account) {
  if (account.status === STATUS.OK) return "Действий не требуется.";
  if (account.status === STATUS.MISSING_OPENING) {
    return "Добавить фактический начальный остаток в Остатки до даты движения; сумму взять из провайдера, не рассчитывать автоматически.";
  }
  if (account.status === STATUS.MISSING_PROVIDER) {
    return "Добавить фактический остаток закрытия в Остатки за дату движения; computed_closing_balance можно использовать как ожидаемую строку только после сверки с провайдером.";
  }
  if (account.status === STATUS.MISMATCH) {
    return "Проверить Ledger movement, amount_net и строку Остатки: фактический остаток не равен расчетному.";
  }
  return "Проверить, что строка Остатки содержит дату, счет, валюту и сумму.";
}

function buildFormula(account) {
  return [
    `opening_balance ${formatFormulaValue(account.opening_balance)}`,
    `+ inflow ${formatFormulaValue(account.inflow)}`,
    `- outflow ${formatFormulaValue(account.outflow)}`,
    `= computed_closing_balance ${formatFormulaValue(account.computed_closing_balance)}`,
    `; provider_reported_balance ${formatFormulaValue(account.provider_reported_balance)}`,
    `; difference ${formatFormulaValue(account.difference)}`,
  ].join(" ");
}

function getFixPriority(status) {
  const priority = {
    [STATUS.MISMATCH]: 1,
    [STATUS.NEEDS_VERIFICATION]: 2,
    [STATUS.MISSING_OPENING]: 3,
    [STATUS.MISSING_PROVIDER]: 4,
    [STATUS.OK]: 0,
  };
  return priority[status] ?? 99;
}

function buildCoverageSummary(accounts, dailySummary) {
  const statusCounts = {
    [STATUS.OK]: 0,
    [STATUS.MISMATCH]: 0,
    [STATUS.MISSING_OPENING]: 0,
    [STATUS.MISSING_PROVIDER]: 0,
    [STATUS.NEEDS_VERIFICATION]: 0,
  };

  for (const account of accounts) {
    if (statusCounts[account.status] !== undefined) statusCounts[account.status] += 1;
  }

  return {
    accounts_with_movement: accounts.length,
    fully_reconciled_accounts: statusCounts[STATUS.OK],
    missing_opening_balance: statusCounts[STATUS.MISSING_OPENING],
    missing_provider_balance: statusCounts[STATUS.MISSING_PROVIDER],
    mismatch: statusCounts[STATUS.MISMATCH],
    needs_verification: statusCounts[STATUS.NEEDS_VERIFICATION],
    excluded_missing_amount_net_rows: Number(dailySummary.excluded_missing_amount_net_rows || 0),
    status_counts: statusCounts,
  };
}

function buildActionableAccounts(accounts) {
  return (accounts || [])
    .filter((account) => account.status && account.status !== STATUS.OK)
    .sort(compareActionableRows)
    .slice(0, 10);
}

function normalizeStatus(value) {
  const status = String(value || "").trim();
  return Object.values(STATUS).includes(status) ? status : STATUS.NEEDS_VERIFICATION;
}

function compareActionableRows(left, right) {
  const leftPriority = getFixPriority(left.status);
  const rightPriority = getFixPriority(right.status);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return compareCoverageRows(left, right);
}

function compareCoverageRows(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.channel !== right.channel) return left.channel.localeCompare(right.channel);
  return left.currency.localeCompare(right.currency);
}

function round(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function formatDiagnosticNumber(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(round(numeric)) : String(value);
}

function formatFormulaValue(value) {
  if (value === null || value === undefined || value === "") return "missing";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(round(numeric)) : String(value);
}
