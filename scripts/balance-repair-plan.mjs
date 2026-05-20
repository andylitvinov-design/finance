#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_AUDIT_URL = "https://ezohata-incoming-ledger.vercel.app/api/audit-snapshot";

export function buildBalanceRepairPlan(snapshot = {}) {
  const period = snapshot.period || {};
  const fixes = snapshot.balance_fixes || {};
  const coverage = snapshot.balance_coverage || {};
  const weekly = coverage.weekly_summary || {};
  const actionableAccounts = Array.isArray(coverage.actionable_accounts) ? coverage.actionable_accounts : [];
  const actions = [];

  for (const row of fixes.missing_amount_net_rows || []) {
    actions.push({
      priority: 1,
      severity: "critical",
      problem: "missing_amount_net",
      date: row.date || "",
      movement_date: "",
      operation: row.operation || "",
      channel: row.channel || "",
      currency: row.currency || "",
      difference: null,
      amount: row.amount ?? null,
      recommended_amount_net: row.recommended_amount_net ?? null,
      raw_source_id: row.raw_source_id || "",
      diagnosis: row.reason || "amount_net is empty, so the row is excluded from balance reconciliation.",
      action: row.action || "Fill amount_net after verifying provider net amount.",
      formula: "",
      verification_required: row.recommended_amount_net === null,
      safe_to_apply: row.recommended_amount_net !== null,
    });
  }

  for (const row of actionableAccounts.filter((item) => item?.status === "mismatch")) {
    actions.push({
      priority: 2,
      severity: "critical",
      problem: "balance_mismatch",
      date: row.date || "",
      movement_date: "",
      operation: "",
      channel: row.channel || "",
      currency: row.currency || "",
      difference: row.difference ?? null,
      amount: row.provider_reported_balance ?? null,
      recommended_amount_net: null,
      opening_balance: row.opening_balance ?? null,
      inflow: row.inflow ?? null,
      outflow: row.outflow ?? null,
      computed_closing_balance: row.computed_closing_balance ?? null,
      provider_reported_balance: row.provider_reported_balance ?? null,
      raw_source_id: "",
      diagnosis: row.diagnosis || "Computed closing balance differs from Остатки.",
      action: row.fix_action || "Check Ledger movement, amount_net, provider statement, and Остатки row.",
      formula: row.formula || "",
      verification_required: true,
      safe_to_apply: false,
    });
  }

  for (const row of fixes.missing_opening_balance_rows || []) {
    actions.push({
      priority: 3,
      severity: "high",
      problem: "missing_opening_balance",
      date: row.required_date || "",
      movement_date: row.movement_date || "",
      operation: "",
      channel: row.channel || "",
      currency: row.currency || "",
      difference: null,
      amount: null,
      recommended_amount_net: null,
      raw_source_id: "",
      diagnosis: row.diagnosis || "Opening Остатки snapshot is missing before movement date.",
      action: row.action || "Add factual opening balance from provider/manual statement.",
      formula: "",
      verification_required: true,
      safe_to_apply: false,
    });
  }

  for (const row of fixes.missing_ostatki_rows || []) {
    actions.push({
      priority: 4,
      severity: "medium",
      problem: "missing_provider_balance",
      date: row.date || "",
      movement_date: "",
      operation: "",
      channel: row.channel || "",
      currency: row.currency || "",
      difference: null,
      amount: null,
      recommended_amount_net: null,
      expected_closing_hint: row.expected_closing_hint ?? row.computed_closing_balance ?? null,
      raw_source_id: "",
      diagnosis: "No factual closing Остатки row exists for this date/channel/currency.",
      action: "Verify provider closing balance; do not copy expected_closing_hint into Остатки as fact.",
      formula: "",
      verification_required: true,
      safe_to_apply: false,
    });
  }

  actions.sort(compareRepairActions);

  return {
    period,
    status: weekly.status || "needs_verification",
    summary: {
      accounts_checked: Number(weekly.accounts_checked || 0),
      fully_reconciled: Number(weekly.fully_reconciled || 0),
      mismatch: Number(weekly.mismatch || 0),
      missing_provider_balance: Number(weekly.missing_provider_balance || 0),
      missing_opening_balance: Number(weekly.missing_opening_balance || 0),
      missing_amount_net_rows: Number(weekly.missing_amount_net_rows || 0),
      excluded_missing_amount_net_rows: Number(weekly.excluded_missing_amount_net_rows || 0),
      actions: actions.length,
    },
    actions,
    paypal_manual_confirmations: buildPayPalManualConfirmations(actions),
    balance_template_rows: buildBalanceTemplateRows(actions),
    tsv: buildRepairTsv(actions),
    balance_template_tsv: buildBalanceTemplateTsv(buildBalanceTemplateRows(actions)),
    copyable_ostatki_rows: "",
    warnings: [
      "Do not write computed Остатки rows as factual balances until provider/manual statements confirm them.",
      "Fix missing amount_net and mismatches before collecting missing_provider_balance factual statements.",
      "PayPal personal rows must be manually confirmed from account activity; gross amount must not be copied into amount_net.",
    ],
  };
}

export function buildBalanceRepairPlanText(plan = {}) {
  const summary = plan.summary || {};
  const lines = [
    "Balance repair plan",
    `Period: ${plan.period?.from || "needs verification"}..${plan.period?.to || "needs verification"}`,
    `Status: ${plan.status || "needs_verification"}`,
    `Checked: ${summary.fully_reconciled || 0}/${summary.accounts_checked || 0} reconciled`,
    `Blocking: mismatch=${summary.mismatch || 0}, missing_amount_net=${summary.missing_amount_net_rows || 0}, missing_provider_balance=${summary.missing_provider_balance || 0}, missing_opening_balance=${summary.missing_opening_balance || 0}`,
    "",
    "Repair actions:",
  ];

  if (!plan.actions?.length) {
    lines.push("No repair actions. Balance coverage is clean for this period.");
  } else {
    for (const action of plan.actions) {
      lines.push([
        `P${action.priority}`,
        action.problem,
        action.date || "—",
        action.channel || "—",
        action.currency || "—",
        action.difference === null || action.difference === undefined ? "" : `difference=${action.difference}`,
        action.recommended_amount_net === null || action.recommended_amount_net === undefined ? "" : `recommended_amount_net=${action.recommended_amount_net}`,
        action.action,
      ].filter(Boolean).join(" | "));
      if (action.formula) lines.push(`  formula: ${action.formula}`);
    }
  }

  if (plan.balance_template_tsv) {
    lines.push("", "Blank balance templates for provider/manual confirmation:", plan.balance_template_tsv);
  }

  if (plan.paypal_manual_confirmations?.length) {
    lines.push("", "PayPal manual confirmations:");
    for (const row of plan.paypal_manual_confirmations) {
      lines.push([
        row.date || "—",
        row.channel || "—",
        row.currency || "—",
        row.raw_source_id || "—",
        "confirmed_amount_net must be filled manually",
      ].join(" | "));
    }
  }

  if (plan.tsv) lines.push("", "Repair TSV:", plan.tsv);
  for (const warning of plan.warnings || []) lines.push(`WARNING: ${warning}`);
  return lines.join("\n");
}

function buildRepairTsv(actions = []) {
  if (!actions.length) return "";
  const header = [
    "priority",
    "severity",
    "problem",
    "date",
    "movement_date",
    "operation",
    "channel",
    "currency",
    "difference",
    "amount",
    "recommended_amount_net",
    "opening_balance",
    "inflow",
    "outflow",
    "computed_closing_balance",
    "expected_closing_hint",
    "provider_reported_balance",
    "raw_source_id",
    "verification_required",
    "safe_to_apply",
    "action",
  ];
  return [
    header.join("\t"),
    ...actions.map((row) => [
      row.priority,
      row.severity,
      row.problem,
      row.date || "",
      row.movement_date || "",
      row.operation || "",
      row.channel || "",
      row.currency || "",
      formatCell(row.difference),
      formatCell(row.amount),
      formatCell(row.recommended_amount_net),
      formatCell(row.opening_balance),
      formatCell(row.inflow),
      formatCell(row.outflow),
      formatCell(row.computed_closing_balance),
      formatCell(row.expected_closing_hint),
      formatCell(row.provider_reported_balance),
      row.raw_source_id || "",
      row.verification_required ? "yes" : "no",
      row.safe_to_apply ? "yes" : "no",
      row.action || "",
    ].join("\t")),
  ].join("\n");
}

function buildPayPalManualConfirmations(actions = []) {
  return actions
    .filter((row) => row.problem === "missing_amount_net")
    .filter((row) => /paypal|пейпал/i.test(`${row.channel} ${row.raw_source_id}`))
    .map((row) => ({
      date: row.date || "",
      operation: row.operation || "",
      channel: row.channel || "",
      currency: row.currency || "",
      gross_amount_reference: row.amount ?? null,
      confirmed_amount_net: "",
      confirmed_fee: "",
      raw_source_id: row.raw_source_id || "",
      confirmation_source: "",
      notes: "",
      safe_to_apply: false,
      action: "Open PayPal personal activity and manually confirm net/fee before filling amount_net.",
    }));
}

function buildBalanceTemplateRows(actions = []) {
  return actions
    .filter((row) => row.problem === "missing_provider_balance" || row.problem === "missing_opening_balance")
    .map((row) => ({
      date: row.date || "",
      channel: row.channel || "",
      currency: row.currency || "",
      confirmed_balance: "",
      computed_reference_balance: row.expected_closing_hint ?? row.computed_closing_balance ?? "",
      purpose: row.problem,
      verification_source: "",
      safe_to_apply: false,
      action: row.problem === "missing_opening_balance"
        ? "Fill factual opening balance from provider/manual statement before movement date."
        : "Fill factual closing balance from provider/manual statement for period end date.",
    }));
}

function buildBalanceTemplateTsv(rows = []) {
  if (!rows.length) return "";
  const header = [
    "date",
    "channel",
    "currency",
    "confirmed_balance",
    "computed_reference_balance",
    "purpose",
    "verification_source",
    "safe_to_apply",
    "action",
  ];
  return [
    header.join("\t"),
    ...rows.map((row) => [
      row.date,
      row.channel,
      row.currency,
      row.confirmed_balance,
      formatCell(row.computed_reference_balance),
      row.purpose,
      row.verification_source,
      row.safe_to_apply ? "yes" : "no",
      row.action,
    ].join("\t")),
  ].join("\n");
}

function compareRepairActions(left, right) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if ((left.date || "") !== (right.date || "")) return String(left.date || "").localeCompare(String(right.date || ""));
  if ((left.channel || "") !== (right.channel || "")) return String(left.channel || "").localeCompare(String(right.channel || ""));
  return String(left.currency || "").localeCompare(String(right.currency || ""));
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\t/g, " ").replace(/\n/g, " ");
}

function buildAuditUrl(args) {
  const url = new URL(args.url || DEFAULT_AUDIT_URL);
  if (args.period) url.searchParams.set("period", args.period);
  if (args.from) url.searchParams.set("from", args.from);
  if (args.to) url.searchParams.set("to", args.to);
  return url.toString();
}

function parseArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--snapshot-file") args.snapshotFile = argv[++index];
    else if (arg === "--url") args.url = argv[++index];
    else if (arg === "--period") args.period = argv[++index];
    else if (arg === "--from") args.from = argv[++index];
    else if (arg === "--to") args.to = argv[++index];
  }
  return args;
}

async function loadSnapshot(args) {
  if (args.snapshotFile) return JSON.parse(await readFile(args.snapshotFile, "utf8"));
  const response = await fetch(buildAuditUrl(args), { headers: { Accept: "application/json" } });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Audit snapshot returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(`Audit snapshot failed HTTP ${response.status}: ${payload?.error || text.slice(0, 300)}`);
  }
  return payload;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const snapshot = await loadSnapshot(args);
  const plan = buildBalanceRepairPlan(snapshot);
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(buildBalanceRepairPlanText(plan));
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
