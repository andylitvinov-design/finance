#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { loadManualRepositoryFromGoogleSheets } from "../server/manual-google-sheets.js";

const ACCOUNT = { channel: "Яндекс руб", currency: "RUB" };
const PERIOD = { from: "2026-04-02", to: "2026-04-24" };
const OPENING_BALANCE = 144000;
const PROVIDER_CLOSING_BALANCE = 139786;
const REMAINING_YANDEX_RUB_ANCHOR = {
  date: "2026-04-24",
  channel: "Яндекс руб",
  currency: "RUB",
  amount_rub: 334.08,
};
const CANDIDATE_SPECS = [
  {
    raw_source_id: "migration:2026-04-24:12:2",
    date: "2026-04-24",
    channel: "Яндекс руб",
    currency: "RUB",
    amount_net: 11287,
  },
  {
    raw_source_id: "migration:2026-04-24:13:2",
    date: "2026-04-24",
    channel: "Яндекс руб",
    currency: "RUB",
    amount_net: 74669,
  },
];
const CANDIDATE_ACTION = "archive_or_delete_after_owner_confirmation";
const RECOMMENDATION = "Archive/delete the two stale migration rows from active Ledger after owner confirmation; then backfill remaining ~334 RUB only from provider/manual proof.";

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    apply: false,
    archiveOnly: false,
    confirmYandexMigrationCollision: false,
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--archive-only") options.archiveOnly = true;
    else if (arg === "--confirm-yandex-migration-collision") options.confirmYandexMigrationCollision = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function auditYandexRubLedgerCollision({
  repository,
  loadRepository = loadManualRepositoryFromGoogleSheets,
} = {}) {
  const loadedRepository = repository || await loadRepository();
  if (!loadedRepository?.ok) {
    throw new Error(loadedRepository?.warning || "Manual Google Sheets repository could not be loaded.");
  }
  return buildYandexRubLedgerCollisionReport(loadedRepository);
}

export function buildYandexRubLedgerCollisionReport(repository = {}) {
  const operations = Array.isArray(repository.operations) ? repository.operations : [];
  const balances = Array.isArray(repository.balances) ? repository.balances : [];
  const candidateRows = CANDIDATE_SPECS.map((spec) => {
    const row = operations.find((operation) => getRawSourceId(operation) === spec.raw_source_id) || null;
    return validateCandidateRow(row, spec);
  });
  const validationErrors = candidateRows.flatMap((candidate) => candidate.validation_errors);
  const openingBalance = findBalanceAmount(balances, PERIOD.from) ?? OPENING_BALANCE;
  const providerClosingBalance = findBalanceAmount(balances, PERIOD.to) ?? PROVIDER_CLOSING_BALANCE;
  const movements = operations.filter(isAccountMovementInPeriod);
  const movementTotal = round(sum(movements.map((row) => getSignedBalanceAmount(row))));
  const candidateTotal = round(sum(candidateRows.map((candidate) => candidate.amount_net || 0)));
  const computedWithCandidates = round(openingBalance + movementTotal);
  const computedWithoutCandidates = round(computedWithCandidates + candidateTotal);
  const currentDiff = round(providerClosingBalance - computedWithCandidates);
  const remainingDiff = round(providerClosingBalance - computedWithoutCandidates);
  const remainingRubInput = buildRemainingYandexRubUsdInput(repository, {
    ...REMAINING_YANDEX_RUB_ANCHOR,
    amount_rub: remainingDiff,
  });

  return {
    ok: validationErrors.length === 0,
    dry_run: true,
    account: ACCOUNT,
    period: PERIOD,
    opening_balance: openingBalance,
    provider_closing_balance: providerClosingBalance,
    computed_with_candidates: computedWithCandidates,
    current_diff: currentDiff,
    candidates_total: candidateTotal,
    computed_without_candidates: computedWithoutCandidates,
    remaining_diff: remainingDiff,
    candidate_rows: candidateRows.map((candidate) => ({
      raw_source_id: candidate.raw_source_id,
      amount_net: candidate.amount_net,
      action: CANDIDATE_ACTION,
    })),
    recommendation: RECOMMENDATION,
    validation_errors: validationErrors,
    remaining_yandex_rub_usd_input: remainingRubInput,
    manual_repair_instructions: buildManualRepairInstructions(remainingRubInput),
  };
}

function validateCandidateRow(row, spec) {
  const validationErrors = [];
  if (!row) {
    validationErrors.push(`Missing Ledger row raw_source_id=${spec.raw_source_id}`);
    return {
      raw_source_id: spec.raw_source_id,
      amount_net: null,
      validation_errors: validationErrors,
    };
  }

  const amountNet = parseAmount(row.amountNet ?? row.amount_net ?? row.ledgerV2?.amount_net);
  const checks = [
    [normalizeDate(row.date ?? row.ledgerV2?.date) === spec.date, `date mismatch for ${spec.raw_source_id}`],
    [getMovementChannel(row) === spec.channel, `channel mismatch for ${spec.raw_source_id}`],
    [String(row.currency || row.ledgerV2?.currency || "").trim().toUpperCase() === spec.currency, `currency mismatch for ${spec.raw_source_id}`],
    [amountNet === spec.amount_net, `amount_net mismatch for ${spec.raw_source_id}`],
  ];
  for (const [passes, message] of checks) {
    if (!passes) validationErrors.push(message);
  }

  return {
    raw_source_id: spec.raw_source_id,
    amount_net: amountNet,
    validation_errors: validationErrors,
  };
}

function buildManualRepairInstructions(remainingRubInput = buildRemainingYandexRubUsdInput({}, REMAINING_YANDEX_RUB_ANCHOR)) {
  return [
    {
      step: 1,
      action: "Archive/delete from active Ledger only after owner confirmation.",
      rows: CANDIDATE_SPECS.map((spec) => ({ raw_source_id: spec.raw_source_id })),
    },
    {
      step: 2,
      action: "Append intraday/not-EOD marker to Остатки row.",
      row: {
        date: "2026-05-19",
        channel: "Яндекс руб",
        amount: 70203.51,
        currency: "RUB",
        comment_append: "intraday/not_eod: before two YooMoney deposits 420.51 + 420.51",
      },
    },
    {
      step: 3,
      action: "Backfill remaining YooMoney missing operations only with provider/manual proof; do not invent rows or historical USD/RUB rates.",
      rows: [
        remainingRubInput,
        "~2755.12 RUB around 2026-05-05",
        "~2755.53 RUB around 2026-05-20",
        "~40504.5 RUB between 2026-03-25 and 2026-04-02",
      ],
      source_rule: "Use provider operation_id if YooMoney returns it. If manual confirmed, use source=yoomoney_manual_confirmed and stable raw_source_id. For Яндекс руб/RUB USD conversion, use only an existing Sberbank Russia USD/RUB rate near the anchor date; never silently use CBR, market, current, or generic fallback rates.",
    },
  ];
}

function buildRemainingYandexRubUsdInput(repository = {}, row = REMAINING_YANDEX_RUB_ANCHOR) {
  const amountRub = round(row.amount_rub);
  const rateEvidence = findSberbankUsdRubRate(repository, row.date);
  const base = {
    date: row.date,
    channel: row.channel,
    currency: row.currency,
    amount_rub: amountRub,
  };
  if (!rateEvidence) {
    return {
      ...base,
      status: "needs_verification",
      required_input: "date | Яндекс руб | amount RUB | Sberbank USD/RUB rate | amount_usd",
    };
  }
  return {
    ...base,
    status: "ready_with_existing_sberbank_rate",
    sberbank_usd_rub_rate: rateEvidence.usd_rub_rate,
    amount_usd: roundUsd(amountRub / rateEvidence.usd_rub_rate),
    comment: "Sberbank Russia USD/RUB rate",
    source: "Sberbank Russia USD/RUB rate",
    rate_evidence: rateEvidence,
  };
}

function findSberbankUsdRubRate(repository = {}, anchorDate) {
  const candidates = [
    ...getExplicitSberbankRateCandidates(repository),
    ...getLedgerSberbankRateCandidates(repository),
  ].filter((candidate) => (
    candidate.date
    && candidate.usd_rub_rate >= 60
    && candidate.usd_rub_rate <= 150
  ));
  if (!candidates.length) return null;
  const anchor = Date.parse(`${anchorDate}T00:00:00Z`);
  return candidates
    .map((candidate) => ({
      ...candidate,
      distance_days: Number.isFinite(anchor)
        ? Math.abs((Date.parse(`${candidate.date}T00:00:00Z`) - anchor) / 86400000)
        : null,
    }))
    .sort((a, b) => (a.distance_days ?? 999999) - (b.distance_days ?? 999999))
    .at(0);
}

function getExplicitSberbankRateCandidates(repository = {}) {
  return (repository.sberbankUsdRubRates || repository.sberbank_usd_rub_rates || [])
    .map((row) => ({
      date: normalizeDate(row.date),
      usd_rub_rate: parseAmount(row.usd_rub_rate ?? row.usdRubRate ?? row.rate),
      source: "Sberbank Russia USD/RUB rate",
      raw_source_id: String(row.raw_source_id || row.rawSourceId || "").trim(),
    }));
}

function getLedgerSberbankRateCandidates(repository = {}) {
  return (repository.operations || [])
    .filter((row) => isYandexRubRow(row) && hasSberbankText(row))
    .map((row) => {
      const amountRub = Math.abs(parseAmount(row.amountNet ?? row.amount_net ?? row.ledgerV2?.amount_net ?? row.amount ?? row.ledgerV2?.amount) || 0);
      const amountUsd = Math.abs(parseAmount(row.amountUsd ?? row.amount_usd ?? row.ledgerV2?.amount_usd) || 0);
      return {
        date: normalizeDate(row.date ?? row.ledgerV2?.date),
        usd_rub_rate: amountRub > 0 && amountUsd > 0 ? roundRate(amountRub / amountUsd) : null,
        source: "Sberbank Russia USD/RUB rate",
        raw_source_id: getRawSourceId(row),
      };
    });
}

function isYandexRubRow(row) {
  const ledger = row?.ledgerV2 || {};
  const channelText = `${ledger.from_channel || ""} ${ledger.to_channel || ""} ${row?.fromChannel || ""} ${row?.toChannel || ""}`;
  const currency = String(row?.currency || ledger.currency || "").trim().toUpperCase();
  return currency === "RUB" && /яндекс/i.test(channelText);
}

function hasSberbankText(row) {
  const ledger = row?.ledgerV2 || {};
  const text = `${row?.comment || ""} ${row?.source || ""} ${ledger.comment || ""} ${ledger.source || ""}`;
  return /sberbank|сбербанк/i.test(text);
}

function isAccountMovementInPeriod(row) {
  const date = normalizeDate(row?.date ?? row?.ledgerV2?.date);
  if (date <= PERIOD.from || date > PERIOD.to) return false;
  const currency = String(row?.currency || row?.ledgerV2?.currency || "").trim().toUpperCase();
  return currency === ACCOUNT.currency && getMovementChannel(row) === ACCOUNT.channel;
}

function findBalanceAmount(balances, date) {
  const row = balances.find((candidate) =>
    normalizeDate(candidate?.date) === date
    && String(candidate?.channel || candidate?.accountName || candidate?.account || "").trim() === ACCOUNT.channel
    && String(candidate?.currency || "").trim().toUpperCase() === ACCOUNT.currency
  );
  return row ? parseAmount(row.balanceAmount ?? row.amount) : null;
}

function getMovementChannel(row) {
  const amount = getSignedBalanceAmount(row);
  const ledger = row?.ledgerV2 || {};
  if (amount < 0) return String(ledger.from_channel || row?.fromChannel || row?.from_channel || row?.toChannel || "").trim();
  return String(ledger.to_channel || row?.toChannel || row?.to_channel || row?.fromChannel || "").trim();
}

function getSignedBalanceAmount(row) {
  const amount = parseAmount(row?.ledgerV2?.balance_amount ?? row?.balanceAmount);
  if (amount !== null) return amount;
  const operation = String(row?.operation || row?.ledgerV2?.operation || "").trim();
  const amountNet = parseAmount(row?.amountNet ?? row?.amount_net ?? row?.ledgerV2?.amount_net);
  if (amountNet === null) return 0;
  return ["expense", "business_expense", "personal_expense", "exchange_out", "transfer"].includes(operation)
    ? -Math.abs(amountNet)
    : Math.abs(amountNet);
}

function getRawSourceId(row) {
  return String(row?.rawSourceId || row?.raw_source_id || row?.ledgerV2?.raw_source_id || row?.externalId || row?.external_id || "").trim();
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function parseAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundUsd(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function roundRate(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function printHumanReport(report) {
  console.log("Yandex RUB Ledger migration collision audit");
  console.log("Mode: dry-run only; no Google Sheets writes are implemented.");
  console.log(`Account: ${report.account.channel} / ${report.account.currency}`);
  console.log(`Period: ${report.period.from} -> ${report.period.to}`);
  console.log(`Opening balance: ${report.opening_balance}`);
  console.log(`Provider closing balance: ${report.provider_closing_balance}`);
  console.log(`Computed with candidate rows: ${report.computed_with_candidates}`);
  console.log(`Current diff: ${report.current_diff}`);
  console.log(`Candidate total: ${report.candidates_total}`);
  console.log(`Computed without candidate rows: ${report.computed_without_candidates}`);
  console.log(`Remaining diff: ${report.remaining_diff}`);
  console.log("");
  console.log("Candidate rows:");
  for (const row of report.candidate_rows) {
    console.log(`- ${row.raw_source_id}: amount_net=${row.amount_net}; action=${row.action}`);
  }
  console.log("");
  console.log(`Recommendation: ${report.recommendation}`);
  console.log("");
  console.log("Manual repair instructions:");
  for (const instruction of report.manual_repair_instructions) {
    console.log(`${instruction.step}. ${instruction.action}`);
    console.log(JSON.stringify(instruction.rows || instruction.row, null, 2));
    if (instruction.source_rule) console.log(instruction.source_rule);
  }
  if (report.validation_errors.length) {
    console.log("");
    console.log("Validation errors:");
    for (const error of report.validation_errors) console.log(`- ${error}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: node scripts/audit-yandex-rub-ledger-collision.mjs [--json]");
    console.log("--apply is intentionally refused; this script is dry-run only.");
    return;
  }
  if (options.apply) {
    throw new Error("--apply is intentionally not implemented. Archive/delete the two Ledger rows manually only after owner confirmation.");
  }
  const report = await auditYandexRubLedgerCollision();
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    printHumanReport(report);
    console.log("");
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
