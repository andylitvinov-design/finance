import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";

const DEBUG_ACTIONS = new Set(["debugFull", "debugAnalytics", "debugUiState"]);
const DEBUG_TOKEN_ENV_KEYS = ["AGENT_DEBUG_TOKEN", "DEBUG_SNAPSHOT_TOKEN", "EZOHATA_DEBUG_TOKEN"];
const SECRET_PATTERN = /(secret|token|private[_-]?key|authorization|bearer|cookie|client[_-]?secret)/i;

export function isDebugAction(action) {
  return DEBUG_ACTIONS.has(action);
}

export async function handleDebugAction(request, response, action) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }

  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: `Unsupported method: ${request.method}`
    });
  }

  if (action === "debugFull") {
    return response.status(200).json({
      ok: true,
      deploy: await getDeployMetadata(),
      period: getPeriod(request.query),
      endpoints: getEndpointInventory(),
      warnings: []
    });
  }

  if (action === "debugUiState") {
    const payload = await buildDebugUiState({ query: request.query || {} });
    return response.status(200).json(payload);
  }

  return response.status(200).json({
    ok: true,
    period: getPeriod(request.query),
    periodGuard: {
      status: "needs_verification",
      rowsInsidePeriod: null,
      rowsOutsidePeriod: null,
      allTimeLeakDetected: "needs_verification",
      fieldsNeedingVerification: []
    },
    warnings: []
  });
}

export async function buildDebugUiState(options = {}) {
  const query = options.query || {};
  const repositoryLoader = options.repositoryLoader || loadManualRepositoryFromGoogleSheets;
  const includeRowsRequested = parseBoolean(query.includeRows || query.rows || query.debugRows);
  const rowAccess = getDebugRowAccess(query);
  const warnings = [];
  if (includeRowsRequested && !rowAccess.authorized) {
    warnings.push(rowAccess.reason);
  }

  const deploy = await getDeployMetadata();
  const periodFilter = parsePeriodFilter(query);
  let repository;
  try {
    repository = await repositoryLoader();
  } catch (error) {
    repository = {
      ok: false,
      warning: `Manual repository read failed: ${String(error?.message || error)}`,
    };
  }

  if (!repository?.ok) {
    return {
      ok: true,
      status: "needs_verification",
      generated_at: new Date().toISOString(),
      project: "ezohata-incoming-ledger",
      deploy,
      period: periodFilter.period,
      debug_access: rowAccess.publicShape,
      ui_aggregate_contract: buildUiAggregateContract(),
      top_metrics: buildTopMetricsScaffold(),
      finance_analysis: emptyBreakdown(),
      expense_analysis: emptyBreakdown(),
      transfer_analysis: emptyBreakdown(),
      source_counts: {},
      row_samples: {},
      warnings: unique([
        ...warnings,
        "needs verification: manual Google Sheets repository is unavailable, so UI state cannot be reconstructed.",
        sanitizeWarning(repository?.warning),
      ]),
    };
  }

  const allOperations = Array.isArray(repository.operations) ? repository.operations : [];
  const operations = filterRowsByPeriod(allOperations, periodFilter);
  const resolvedPeriod = resolvePeriod(periodFilter, operations);
  const incomeRows = operations.filter((row) => getOperation(row) === "income");
  const expenseRows = operations.filter((row) => getOperation(row) === "expense");
  const transferRows = operations.filter((row) => getOperation(row) === "transfer");
  const exchangeRows = operations.filter((row) => getOperation(row) === "exchange");
  const movementLikeRows = getMovementLikeRows(repository, periodFilter);
  const topMetricInputs = buildTopMetricInputs(movementLikeRows, operations);
  const includeRows = includeRowsRequested && rowAccess.authorized;

  return {
    ok: true,
    status: "ok",
    generated_at: new Date().toISOString(),
    project: "ezohata-incoming-ledger",
    deploy,
    period: resolvedPeriod,
    debug_access: rowAccess.publicShape,
    ui_aggregate_contract: buildUiAggregateContract(),
    top_metrics: buildTopMetrics(topMetricInputs),
    finance_analysis: {
      source: "server_derived_ledger_operations",
      planned: buildPlannedMovementSummary(movementLikeRows),
      actual_income: groupRowsByChannel(incomeRows, { incomeEvents: true }),
      income_diagnostics: buildIncomeEventDiagnostics(incomeRows, movementLikeRows),
      actual_income_rows: includeRows ? incomeRows.map(safeLedgerRow) : undefined,
      warnings: movementLikeRows.length
        ? []
        : ["needs verification: movement/order planned rows were not available in the manual repository payload."],
    },
    expense_analysis: {
      source: "server_derived_ledger_operations",
      real_expense: groupRowsByChannel(expenseRows),
      transfer_outflows: groupRowsByChannel([...transferRows, ...exchangeRows].filter(isOutflowRow)),
      real_expense_rows: includeRows ? expenseRows.map(safeLedgerRow) : undefined,
    },
    transfer_analysis: {
      source: "server_derived_ledger_operations",
      transfers: groupRowsByChannel(transferRows),
      exchanges: groupRowsByChannel(exchangeRows),
      transfer_rows: includeRows ? transferRows.map(safeLedgerRow) : undefined,
      exchange_rows: includeRows ? exchangeRows.map(safeLedgerRow) : undefined,
    },
    source_counts: countBy(operations, normalizeSource),
    row_samples: includeRows
      ? {
          income: incomeRows.slice(0, 100).map(safeLedgerRow),
          expense: expenseRows.slice(0, 100).map(safeLedgerRow),
          transfer: transferRows.slice(0, 100).map(safeLedgerRow),
          exchange: exchangeRows.slice(0, 100).map(safeLedgerRow),
        }
      : {},
    warnings: unique([
      ...warnings,
      ...(Array.isArray(repository.warnings) ? repository.warnings.map(sanitizeWarning) : []),
      "debug-ui-state is read-only observability; it must not be used as a finance calculation source of truth.",
    ]),
  };
}

function buildUiAggregateContract() {
  return {
    failing_layer_goal: "UI aggregate observability",
    source_order: [
      "repo main",
      "production /api/status",
      "production /api/audit-snapshot",
      "production /api/debug-ui-state",
      "screenshot/user report",
    ],
    top_payable_formula: "total_orders_usd * 0.3 - total_paid_usd",
    row_level_mode: "safe rows require includeRows=1 and configured debug token",
    invariants: [
      "Balance uses amount_net.",
      "Rows with valid amount_net are not excluded only because source=unknown.",
      "PayPal gross is not net when fee is missing.",
      "Provider transport fixes must not change balance semantics.",
    ],
  };
}

function buildTopMetricsScaffold() {
  return {
    source: "unavailable",
    total_orders_usd: null,
    total_paid_usd: null,
    payable_usd: null,
    formula: "total_orders_usd * 0.3 - total_paid_usd",
    status: "needs_verification",
  };
}

function buildTopMetrics(inputs) {
  const totalOrdersUsd = inputs.totalOrdersUsd;
  const totalPaidUsd = inputs.totalPaidUsd;
  const payableUsd = totalOrdersUsd !== null && totalPaidUsd !== null
    ? round(totalOrdersUsd * 0.3 - totalPaidUsd)
    : null;
  return {
    source: inputs.source,
    total_orders_usd: totalOrdersUsd,
    total_paid_usd: totalPaidUsd,
    payable_usd: payableUsd,
    formula: "total_orders_usd * 0.3 - total_paid_usd",
    status: payableUsd === null ? "needs_verification" : "server_derived",
    notes: inputs.notes,
  };
}

function buildTopMetricInputs(movementRows, operations) {
  if (movementRows.length) {
    const totalOrdersUsd = sumByAliases(movementRows, [
      "Итоговая сумма заказов",
      "ACCRUED +3%",
      "70% OF +3%",
      "PRICE BASE",
      "AMOUNT (USD)",
    ]);
    const totalPaidUsd = sumByAliases(movementRows, [
      "Сумма оплачена",
      "ДОШЛО ДО НАС USD",
      "ОПЛАЧЕНО КЛИЕНТОМ USD",
      "ПОЛУЧЕНО В ДОЛЛАРАХ",
    ]);
    return {
      source: "movement_or_order_rows_best_effort",
      totalOrdersUsd,
      totalPaidUsd,
      notes: ["Best-effort from movement/order rows; verify against UI if headers changed."],
    };
  }
  const incomeUsd = operations
    .filter((row) => getOperation(row) === "income")
    .reduce((sum, row) => sum + Math.max(0, parseNumber(getLedgerValue(row, "amount_usd")) || 0), 0);
  return {
    source: "ledger_income_fallback",
    totalOrdersUsd: null,
    totalPaidUsd: round(incomeUsd),
    notes: ["Movement/order rows unavailable; total_orders_usd cannot be reconstructed safely."],
  };
}

function buildPlannedMovementSummary(rows) {
  if (!rows.length) return emptyBreakdown();
  const grouped = new Map();
  for (const row of rows) {
    const channel = normalizeChannel(getByAliases(row, ["PAYMENT METHOD", "paymentMethod", "channel", "toChannel", "fromChannel"]));
    if (!channel) continue;
    const amount = parseNumber(getByAliases(row, ["AMOUNT (USD)", "ДОШЛО ДО НАС USD", "ОПЛАЧЕНО КЛИЕНТОМ USD", "ПОЛУЧЕНО В ДОЛЛАРАХ"]));
    const current = grouped.get(channel) || { channel, rows: 0, amount_usd_sum: 0 };
    current.rows += 1;
    if (amount !== null) current.amount_usd_sum += amount;
    grouped.set(channel, current);
  }
  return Array.from(grouped.values())
    .sort((left, right) => left.channel.localeCompare(right.channel))
    .map((row) => ({ ...row, amount_usd_sum: round(row.amount_usd_sum) }));
}

function emptyBreakdown() {
  return [];
}

function groupRowsByChannel(rows, options = {}) {
  const grouped = new Map();
  const incomeEvents = new Set();
  for (const row of rows || []) {
    const channel = getRowChannel(row);
    if (!channel) continue;
    const key = channel;
    const amountUsd = parseNumber(getLedgerValue(row, "amount_usd"));
    const amountNet = parseNumber(getLedgerValue(row, "amount_net"));
    const current = grouped.get(key) || {
      channel: key,
      rows: 0,
      amount_usd_signed_sum: 0,
      amount_usd_abs_sum: 0,
      amount_net_abs_sum: 0,
      missing_amount_net_rows: 0,
      sources: {},
    };
    current.rows += 1;
    if (options.incomeEvents) {
      const eventKey = buildIncomeEventDedupeKey(row, channel);
      if (incomeEvents.has(eventKey)) {
        current.duplicate_income_rows = (current.duplicate_income_rows || 0) + 1;
      } else {
        incomeEvents.add(eventKey);
        current.deduped_income_events_count = (current.deduped_income_events_count || 0) + 1;
      }
    }
    if (amountUsd !== null) {
      current.amount_usd_signed_sum += amountUsd;
      current.amount_usd_abs_sum += Math.abs(amountUsd);
    }
    if (amountNet !== null) {
      current.amount_net_abs_sum += Math.abs(amountNet);
    } else {
      current.missing_amount_net_rows += 1;
    }
    const source = normalizeSource(row);
    current.sources[source] = (current.sources[source] || 0) + 1;
    grouped.set(key, current);
  }
  return Array.from(grouped.values())
    .sort((left, right) => left.channel.localeCompare(right.channel))
    .map((row) => ({
      ...row,
      amount_usd_signed_sum: round(row.amount_usd_signed_sum),
      amount_usd_abs_sum: round(row.amount_usd_abs_sum),
      amount_net_abs_sum: round(row.amount_net_abs_sum),
    }));
}

function buildIncomeEventDiagnostics(incomeRows, movementRows) {
  const grouped = groupRowsByChannel(incomeRows, { incomeEvents: true });
  const matchedPlannedByChannel = Object.fromEntries(
    buildPlannedMovementSummary(movementRows).map((row) => [row.channel, row.rows])
  );
  return grouped.map((row) => ({
    channel: row.channel,
    ledger_income_rows_count: row.rows,
    deduped_income_events_count: row.deduped_income_events_count || 0,
    duplicate_income_rows_count: row.duplicate_income_rows || 0,
    matched_planned_payment_count: matchedPlannedByChannel[row.channel] || 0,
    unmatched_income_rows_count: Math.max(0, row.rows - (matchedPlannedByChannel[row.channel] || 0)),
  }));
}

function buildIncomeEventDedupeKey(row = {}, channel = "") {
  const sourceTransactionId = normalizeEventKeyPart(
    row?.sourceTransactionId ||
    row?.ledgerV2?.external_id ||
    row?.externalId ||
    row?.external_id ||
    ""
  );
  if (sourceTransactionId) return `source:${sourceTransactionId}`;
  const rawSourceId = normalizeEventKeyPart(
    row?.ledgerV2?.raw_source_id ||
    row?.rawSourceId ||
    row?.raw_source_id ||
    ""
  );
  if (rawSourceId) return `raw:${rawSourceId}`;
  return [
    "fallback",
    normalizeEventKeyPart(channel),
    normalizeRowDate(row),
    normalizeEventKeyPart(row?.ledgerV2?.currency || row?.currency || ""),
    normalizeEventAmount(row?.ledgerV2?.amount_net ?? row?.amountNet ?? row?.amount_net ?? row?.netAmount ?? row?.amount),
    normalizeHeader(row?.ledgerV2?.comment || row?.comment || row?.counterparty || row?.description || row?.organization || ""),
  ].join("|");
}

function normalizeEventKeyPart(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEventAmount(value) {
  const numeric = parseNumber(value);
  return numeric === null ? "" : String(round(Math.abs(numeric)));
}

function safeLedgerRow(row, index = 0) {
  const ledger = row?.ledgerV2 || {};
  const rawId = String(
    ledger.raw_source_id ||
    ledger.external_id ||
    row.raw_source_id ||
    row.rawSourceId ||
    row.sourceTransactionId ||
    row.id ||
    `row-${index + 1}`
  ).trim();
  return {
    rowId: sanitizeText(rawId).slice(0, 80),
    date: normalizeDate(ledger.date || row.date),
    operation: getOperation(row),
    direction: getDirection(row),
    from_channel: sanitizeText(ledger.from_channel || row.fromChannel || row.from_channel || "").slice(0, 80),
    to_channel: sanitizeText(ledger.to_channel || row.toChannel || row.to_channel || "").slice(0, 80),
    channel: getRowChannel(row),
    amount: parseNumber(ledger.amount ?? row.amount),
    currency: sanitizeText(ledger.currency || row.currency || "").slice(0, 12).toUpperCase(),
    amount_usd: parseNumber(ledger.amount_usd ?? row.amountUsd ?? row.amount_usd),
    amount_net: parseNumber(ledger.amount_net ?? row.amountNet ?? row.amount_net),
    source: normalizeSource(row),
    category: sanitizeText(ledger.category || row.category || "").slice(0, 80),
    subcategory: sanitizeText(ledger.subcategory || row.subcategory || "").slice(0, 80),
    sourceTransactionId: sanitizeText(row.sourceTransactionId || ledger.external_id || "").slice(0, 80),
    rawSourceId: sanitizeText(ledger.raw_source_id || row.rawSourceId || row.raw_source_id || "").slice(0, 80),
    comment_excerpt: sanitizeText(ledger.comment || row.comment || row.description || "").slice(0, 120),
  };
}

function getMovementLikeRows(repository, periodFilter) {
  const candidates = [
    ...(Array.isArray(repository?.movementRows) ? repository.movementRows : []),
    ...(Array.isArray(repository?.orderRows) ? repository.orderRows : []),
    ...(Array.isArray(repository?.orders) ? repository.orders : []),
  ];
  return filterRowsByPeriod(candidates, periodFilter);
}

function filterRowsByPeriod(rows, periodFilter) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const date = normalizeRowDate(row);
    if (!date) return false;
    if (periodFilter.from && date < periodFilter.from) return false;
    if (periodFilter.to && date > periodFilter.to) return false;
    return true;
  });
}

function parsePeriodFilter(query = {}) {
  const period = String(query.period || "").trim();
  const range = period.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    return {
      from: range[1],
      to: range[2],
      period: { from: range[1], to: range[2] },
    };
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    return {
      from: `${period}-01`,
      to: lastDayOfMonth(period),
      period: { from: `${period}-01`, to: lastDayOfMonth(period) },
    };
  }
  const from = normalizeDate(query.from || query.startDate || query.dateFrom);
  const to = normalizeDate(query.to || query.endDate || query.dateTo);
  return {
    from,
    to,
    period: {
      from: from || "needs verification",
      to: to || "needs verification",
    },
  };
}

function resolvePeriod(periodFilter, rows) {
  if (periodFilter.from || periodFilter.to) return periodFilter.period;
  const dates = (rows || []).map(normalizeRowDate).filter(Boolean).sort();
  return {
    from: dates[0] || "needs verification",
    to: dates.at(-1) || "needs verification",
  };
}

function getPeriod(query = {}) {
  return {
    from: normalizeValue(query.from || query.startDate),
    to: normalizeValue(query.to || query.endDate)
  };
}

function getEndpointInventory() {
  return {
    status: {
      path: "/api/status",
      methods: ["GET", "OPTIONS"]
    },
    auditSnapshot: {
      path: "/api/audit-snapshot",
      methods: ["GET", "OPTIONS"],
      query: { period: "YYYY-MM", from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
    },
    debugUiState: {
      path: "/api/debug-ui-state",
      methods: ["GET", "OPTIONS"],
      query: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", includeRows: "0|1" }
    },
    dashboardData: {
      path: "/api?action=getDashboardData",
      methods: ["GET"],
      query: { startDate: "from", endDate: "to" }
    },
    debugFull: {
      path: "/api/debug-full",
      methods: ["GET", "OPTIONS"]
    },
    debugAnalytics: {
      path: "/api/debug-analytics",
      methods: ["GET", "OPTIONS"]
    }
  };
}

async function getDeployMetadata() {
  const [buildMeta, packageJson, vercelProject] = await Promise.all([
    loadBuildMeta(),
    loadJson(path.join(process.cwd(), "package.json")),
    loadJson(path.join(process.cwd(), ".vercel", "project.json"))
  ]);

  const commitSha = normalizeValue(
    process.env.VERCEL_GIT_COMMIT_SHA
    || buildMeta.gitCommitSha
    || buildMeta.commitSha
  );
  const commitRef = normalizeValue(
    process.env.VERCEL_GIT_COMMIT_REF
    || buildMeta.gitCommitRef
    || buildMeta.commitRef
  );
  return {
    commitSha: commitSha || "unknown",
    commitRef: commitRef || "unknown",
    project: normalizeValue(
      process.env.VERCEL_PROJECT_NAME
      || vercelProject.projectName
      || packageJson.name
    ) || "ezohata-incoming-ledger",
    source: normalizeValue(
      process.env.VERCEL_GIT_REPO_SLUG
      || buildMeta.gitRepoSlug
    ) || "andylitvinov-design/finance",
    deploymentUrl: normalizeValue(process.env.VERCEL_URL) || "unknown",
    productionUrl: normalizeValue(process.env.VERCEL_PROJECT_PRODUCTION_URL) || "unknown",
    deploymentEnvironment: normalizeValue(process.env.VERCEL_ENV || buildMeta.deploymentEnvironment) || "unknown",
    metadataStatus: commitSha && commitRef ? "ok" : "needs_verification",
  };
}

async function loadBuildMeta() {
  const generated = await loadJson(path.join(process.cwd(), ".generated", "build-meta.override.json"));
  if (Object.keys(generated).length) return generated;
  return await loadJson(path.join(process.cwd(), "ops", "build-meta.json"));
}

async function loadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function getDebugRowAccess(query = {}) {
  const configuredToken = DEBUG_TOKEN_ENV_KEYS
    .map((key) => String(process.env[key] || "").trim())
    .find(Boolean);
  const suppliedToken = String(query.debugToken || query.token || "").trim();
  const authorized = Boolean(configuredToken && suppliedToken && suppliedToken === configuredToken);
  return {
    authorized,
    reason: configuredToken
      ? "includeRows requested, but debug token is missing or invalid; returning aggregate-only payload."
      : "includeRows requested, but no debug token env is configured; returning aggregate-only payload.",
    publicShape: {
      includeRowsAuthorized: authorized,
      tokenConfigured: Boolean(configuredToken),
      tokenEnvKeys: DEBUG_TOKEN_ENV_KEYS,
    },
  };
}

function getOperation(row) {
  const raw = String(row?.ledgerV2?.operation || row?.operation || "").trim();
  if (raw === "business_expense" || raw === "personal_expense") return "expense";
  if (raw === "exchange_in" || raw === "exchange_out") return "exchange";
  if (raw === "partner_transfer") return "transfer";
  return raw || "adjustment";
}

function getDirection(row) {
  const balanceAmount = parseNumber(row?.ledgerV2?.balance_amount ?? row?.balanceAmount);
  if (balanceAmount !== null) return balanceAmount < 0 ? "out" : balanceAmount > 0 ? "in" : "zero";
  const operation = getOperation(row);
  if (operation === "expense") return "out";
  if (operation === "income") return "in";
  return operation;
}

function isOutflowRow(row) {
  return getDirection(row) === "out" || getOperation(row) === "expense";
}

function getRowChannel(row) {
  const ledger = row?.ledgerV2 || {};
  const direction = getDirection(row);
  const channel = direction === "out"
    ? (ledger.from_channel || row.fromChannel || row.from_channel || ledger.to_channel || row.toChannel || row.to_channel)
    : (ledger.to_channel || row.toChannel || row.to_channel || ledger.from_channel || row.fromChannel || row.from_channel);
  return normalizeChannel(channel);
}

function getLedgerValue(row, key) {
  const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return row?.ledgerV2?.[key] ?? row?.[camel] ?? row?.[key];
}

function normalizeSource(row) {
  const raw = String(row?.source || row?.ledgerV2?.source || "").trim().toLowerCase();
  if (!raw || raw === "other" || raw === "google_sheets" || raw === "provider" || raw === "import" || raw === "mcp") return "unknown";
  if (raw === "privat_bank") return "privatbank";
  if (raw === "tdbank") return "td_bank";
  return sanitizeText(raw).slice(0, 40) || "unknown";
}

function normalizeRowDate(row) {
  return normalizeDate(
    row?.ledgerV2?.date ||
    row?.date ||
    row?.DATE ||
    row?.operationDate ||
    row?.transactionDate ||
    row?.transferDate ||
    row?.createdAt ||
    row?.created_at ||
    ""
  );
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const displayMatch = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (displayMatch) {
    return `${displayMatch[3]}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
  }
  return "";
}

function lastDayOfMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function sumByAliases(rows, aliases) {
  let found = false;
  let sum = 0;
  for (const row of rows || []) {
    const value = parseNumber(getByAliases(row, aliases));
    if (value !== null) {
      found = true;
      sum += value;
    }
  }
  return found ? round(sum) : null;
}

function getByAliases(row, aliases) {
  if (!row || typeof row !== "object") return "";
  for (const alias of aliases || []) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
    const normalizedAlias = normalizeHeader(alias);
    const matchedKey = Object.keys(row).find((key) => normalizeHeader(key) === normalizedAlias);
    if (matchedKey) return row[matchedKey];
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "");
}

function normalizeChannel(value) {
  return sanitizeText(value).trim().replace(/\s+/g, " ").slice(0, 80);
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBoolean(value) {
  return ["1", "true", "yes", "rows"].includes(String(value || "").trim().toLowerCase());
}

function countBy(rows, iteratee) {
  const counts = {};
  for (const row of rows || []) {
    const key = iteratee(row) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function round(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function unique(values) {
  return [...new Set((values || []).map(sanitizeWarning).filter(Boolean))];
}

function sanitizeWarning(value) {
  const sanitized = sanitizeText(value).trim();
  return sanitized || "";
}

function sanitizeText(value) {
  let text = String(value || "");
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]");
  text = text.replace(/Basic\s+[A-Za-z0-9+/=._~-]+/gi, "Basic [redacted]");
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]");
  text = text.replace(/\b\d{12,19}\b/g, "[number redacted]");
  text = text.replace(/(access_token|refresh_token|client_secret|private_key|token|secret)["':=]+\s*[^\s,;]+/gi, "$1 [redacted]");
  text = text.replace(/(access_token|refresh_token|client_secret|private_key|token|secret)\s+[A-Za-z0-9._~+/-]{12,}/gi, "$1 [redacted]");
  if (SECRET_PATTERN.test(text)) {
    text = text.replace(/[A-Za-z0-9._~+/-]{24,}/g, "[redacted]");
  }
  return text;
}

function normalizeValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}
