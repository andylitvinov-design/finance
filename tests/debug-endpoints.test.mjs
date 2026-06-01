import test from "node:test";
import assert from "node:assert/strict";

import statusHandler from "../api/status.js";
import indexHandler from "../api/index.js";
import {
  buildDebugUiState,
  buildExpensePlanReconciliationByChannel,
  composeDeployMetadata
} from "../server/debug-endpoints.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function repositoryFixture() {
  return {
    ok: true,
    schema: "ledger-v2-compatible",
    operations: [
      {
        date: "2026-05-02",
        operation: "income",
        toChannel: "пейпал дол",
        amount: "324",
        amountUsd: "311.06",
        amountNet: "311.06",
        source: "paypal",
        sourceTransactionId: "PAYPAL-1234567890",
        comment: "client email customer@example.com token abcdefghijklmnopqrstuvwxyz",
        ledgerV2: {
          date: "2026-05-02",
          operation: "income",
          to_channel: "пейпал дол",
          amount: "324",
          currency: "USD",
          amount_usd: "311.06",
          amount_net: "311.06",
          balance_amount: 311.06,
          source: "paypal",
          raw_source_id: "PAYPAL-RAW-1",
          category: "service",
          comment: "paid by customer@example.com with private_key abcdefghijklmnopqrstuvwxyz"
        }
      },
      {
        date: "2026-05-03",
        operation: "expense",
        fromChannel: "трансервайз дол",
        amount: "52.94",
        amountUsd: "-52.94",
        amountNet: "52.94",
        source: "wise",
        ledgerV2: {
          date: "2026-05-03",
          operation: "expense",
          from_channel: "трансервайз дол",
          amount: "52.94",
          currency: "USD",
          amount_usd: "-52.94",
          amount_net: "52.94",
          balance_amount: -52.94,
          source: "wise",
          category: "business_expense"
        }
      },
      {
        date: "2026-05-04",
        operation: "transfer",
        fromChannel: "трансервайз дол",
        toChannel: "cash usd",
        amount: "10",
        amountUsd: "-10",
        amountNet: "10",
        source: "manual",
        ledgerV2: {
          date: "2026-05-04",
          operation: "transfer",
          from_channel: "трансервайз дол",
          to_channel: "cash usd",
          amount: "10",
          currency: "USD",
          amount_usd: "-10",
          amount_net: "10",
          balance_amount: -10,
          source: "manual"
        }
      },
      {
        date: "2026-06-01",
        operation: "income",
        toChannel: "пейпал дол",
        amount: "999",
        amountUsd: "999",
        amountNet: "999",
        source: "paypal",
        ledgerV2: {
          date: "2026-06-01",
          operation: "income",
          to_channel: "пейпал дол",
          amount: "999",
          currency: "USD",
          amount_usd: "999",
          amount_net: "999",
          balance_amount: 999,
          source: "paypal"
        }
      }
    ],
    movementRows: [
      {
        DATE: "2026-05-02",
        "PAYMENT METHOD": "пейпал дол",
        "AMOUNT (USD)": "324",
        "ОПЛАЧЕНО КЛИЕНТОМ USD": "324",
        "ДОШЛО ДО НАС USD": "311.06"
      }
    ],
    warnings: []
  };
}

test("GET /api/debug-full returns deploy metadata and endpoint inventory", async () => {
  const envBackup = snapshotEnv([
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_REPO_SLUG",
    "VERCEL_PROJECT_NAME"
  ]);
  Object.assign(process.env, {
    VERCEL_GIT_COMMIT_SHA: "debugsha123",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_REPO_SLUG: "andylitvinov-design/finance",
    VERCEL_PROJECT_NAME: "ezohata-incoming-ledger"
  });

  try {
    const response = createResponseRecorder();
    await indexHandler({
      method: "GET",
      query: { action: "debugFull", from: "2026-05-01", to: "2026-05-09" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.body?.ok, true);
    assert.deepEqual(response.body?.period, { from: "2026-05-01", to: "2026-05-09" });
    assert.equal(response.body?.deploy?.commitSha, "debugsha123");
    assert.equal(response.body?.deploy?.commitRef, "main");
    assert.equal(response.body?.deploy?.project, "ezohata-incoming-ledger");
    assert.equal(response.body?.deploy?.source, "andylitvinov-design/finance");
    assert.equal(response.body?.endpoints?.status?.path, "/api/status");
    assert.equal(response.body?.endpoints?.dashboardData?.path, "/api?action=getDashboardData");
    assert.equal(response.body?.endpoints?.auditSnapshot?.path, "/api/audit-snapshot");
    assert.equal(response.body?.endpoints?.debugFull?.path, "/api/debug-full");
    assert.equal(response.body?.endpoints?.debugAnalytics?.path, "/api/debug-analytics");
    assert.equal(response.body?.endpoints?.debugUiState?.path, "/api/debug-ui-state");
    assert.deepEqual(response.body?.warnings, []);
  } finally {
    restoreEnv(envBackup);
  }
});

test("debug deploy metadata normalizes detached HEAD to main when SHA matches build metadata", () => {
  const deploy = composeDeployMetadata({
    buildMeta: {
      deploymentEnvironment: "production",
      commitSha: "mainsha123",
      commitRef: "main",
      gitRepoSlug: "andylitvinov-design/finance",
      gitCommitSha: "mainsha123",
      gitCommitRef: "main"
    },
    env: {
      VERCEL_GIT_COMMIT_SHA: "mainsha123",
      VERCEL_GIT_COMMIT_REF: "HEAD",
      VERCEL_GIT_REPO_SLUG: "andylitvinov-design/finance",
      VERCEL_PROJECT_NAME: "ezohata-incoming-ledger"
    }
  });

  assert.equal(deploy.commitSha, "mainsha123");
  assert.equal(deploy.commitRef, "main");
  assert.equal(deploy.metadataStatus, "ok");
});

test("debug deploy metadata normalizes detached HEAD to main when deployRef records main", () => {
  const deploy = composeDeployMetadata({
    buildMeta: {
      deploymentEnvironment: "production",
      commitSha: "mainsha123",
      commitRef: "HEAD",
      deployRef: "main",
      sourceRef: "main",
      gitRepoSlug: "andylitvinov-design/finance",
      gitCommitSha: "mainsha123",
      gitCommitRef: "HEAD"
    },
    env: {
      VERCEL_GIT_COMMIT_SHA: "mainsha123",
      VERCEL_GIT_COMMIT_REF: "HEAD",
      VERCEL_GIT_REPO_SLUG: "andylitvinov-design/finance",
      VERCEL_PROJECT_NAME: "ezohata-incoming-ledger"
    }
  });

  assert.equal(deploy.commitSha, "mainsha123");
  assert.equal(deploy.commitRef, "main");
  assert.equal(deploy.metadataStatus, "ok");
});

test("debug deploy metadata keeps detached HEAD without main source ref", () => {
  const deploy = composeDeployMetadata({
    buildMeta: {
      deploymentEnvironment: "production",
      commitSha: "mainsha123",
      commitRef: "HEAD",
      gitRepoSlug: "andylitvinov-design/finance",
      gitCommitSha: "mainsha123",
      gitCommitRef: "HEAD"
    },
    env: {
      VERCEL_GIT_COMMIT_SHA: "mainsha123",
      VERCEL_GIT_COMMIT_REF: "HEAD",
      VERCEL_GIT_REPO_SLUG: "andylitvinov-design/finance",
      VERCEL_PROJECT_NAME: "ezohata-incoming-ledger"
    }
  });

  assert.equal(deploy.commitSha, "mainsha123");
  assert.equal(deploy.commitRef, "HEAD");
  assert.equal(deploy.metadataStatus, "ok");
});

test("GET /api/debug-analytics returns period guard scaffold", async () => {
  const response = createResponseRecorder();
  await indexHandler({
    method: "GET",
    query: { action: "debugAnalytics", from: "2026-05-01", to: "2026-05-09" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body?.ok, true);
  assert.deepEqual(response.body?.period, { from: "2026-05-01", to: "2026-05-09" });
  assert.deepEqual(response.body?.periodGuard, {
    status: "needs_verification",
    rowsInsidePeriod: null,
    rowsOutsidePeriod: null,
    allTimeLeakDetected: "needs_verification",
    fieldsNeedingVerification: []
  });
  assert.deepEqual(response.body?.warnings, []);
});

test("debug UI state returns aggregate-only payload without row token", async () => {
  const envBackup = snapshotEnv(["AGENT_DEBUG_TOKEN", "DEBUG_SNAPSHOT_TOKEN", "EZOHATA_DEBUG_TOKEN"]);
  delete process.env.AGENT_DEBUG_TOKEN;
  delete process.env.DEBUG_SNAPSHOT_TOKEN;
  delete process.env.EZOHATA_DEBUG_TOKEN;
  const fixture = repositoryFixture();
  fixture.operations.push({
    date: "2026-05-05",
    operation: "expense",
    fromChannel: "трансервайз дол",
    amount: "10.88",
    amountUsd: "-10.88",
    amountNet: "10.88",
    source: "wise",
    category: "food",
    ledgerV2: {
      date: "2026-05-05",
      operation: "expense",
      from_channel: "трансервайз дол",
      amount: "10.88",
      currency: "USD",
      amount_usd: "-10.88",
      amount_net: "10.88",
      balance_amount: -10.88,
      source: "wise",
      category: "food"
    }
  });

  try {
    const payload = await buildDebugUiState({
      query: { from: "2026-05-01", to: "2026-05-31", includeRows: "1" },
      repositoryLoader: async () => fixture
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, "ok");
    assert.deepEqual(payload.period, { from: "2026-05-01", to: "2026-05-31" });
    assert.equal(payload.debug_access.includeRowsAuthorized, false);
    assert.match(payload.warnings.join("\n"), /no debug token env is configured/i);
    assert.equal(payload.finance_analysis.actual_income_rows, undefined);
    assert.deepEqual(payload.row_samples, {});
    assert.equal(payload.ui_aggregate_contract.top_payable_formula, "total_orders_usd * 0.7 - abs(total_paid_usd) + personal_orders_after_discount_usd");
    assert.equal(payload.top_metrics.formula, "total_orders_usd * 0.7 - abs(total_paid_usd) + personal_orders_after_discount_usd");
    assert.equal(payload.top_metrics.personal_orders_after_discount_usd, 0);
    assert.equal(payload.top_metrics.payable_usd, -84.26);
    assert.equal(payload.finance_analysis.actual_income[0].channel, "пейпал дол");
    assert.equal(payload.finance_analysis.actual_income[0].amount_usd_signed_sum, 311.06);
    assert.equal(payload.finance_analysis.actual_income[0].deduped_income_events_count, 1);
    assert.deepEqual(payload.finance_analysis.income_diagnostics[0], {
      channel: "пейпал дол",
      ledger_income_rows_count: 1,
      deduped_income_events_count: 1,
      duplicate_income_rows_count: 0,
      matched_planned_payment_count: 1,
      unmatched_income_rows_count: 0,
    });
    assert.equal(payload.expense_analysis.real_expense[0].channel, "трансервайз дол");
    assert.deepEqual(payload.expense_analysis.real_expense_breakdown[0], {
      channel: "трансервайз дол",
      total: 63.82,
      business: 52.94,
      personal: 10.88,
      byCategory: {
        business_expense: 52.94,
        food: 10.88,
      },
      bySubcategory: {},
      excluded_transfer_exchange: 10,
    });
    assert.equal(payload.transfer_analysis.transfers[0].channel, "трансервайз дол");
  } finally {
    restoreEnv(envBackup);
  }
});

test("debug UI state accepts explicit period range and reports raw versus deduped income events", async () => {
  const fixture = repositoryFixture();
  fixture.operations.push({
    date: "2026-05-02",
    operation: "income",
    toChannel: "пейпал дол",
    amount: "324",
    amountUsd: "311.06",
    amountNet: "311.06",
    source: "paypal",
    sourceTransactionId: "PAYPAL-1234567890",
    ledgerV2: {
      date: "2026-05-02",
      operation: "income",
      to_channel: "пейпал дол",
      amount: "324",
      currency: "USD",
      amount_usd: "311.06",
      amount_net: "311.06",
      balance_amount: 311.06,
      source: "paypal",
      raw_source_id: "PAYPAL-RAW-1",
    }
  });

  const payload = await buildDebugUiState({
    query: { period: "2026-05-01..2026-05-31" },
    repositoryLoader: async () => fixture
  });

  assert.deepEqual(payload.period, { from: "2026-05-01", to: "2026-05-31" });
  assert.equal(payload.finance_analysis.actual_income[0].rows, 2);
  assert.equal(payload.finance_analysis.actual_income[0].deduped_income_events_count, 1);
  assert.equal(payload.finance_analysis.actual_income[0].duplicate_income_rows, 1);
  assert.equal(payload.finance_analysis.income_diagnostics[0].ledger_income_rows_count, 2);
  assert.equal(payload.finance_analysis.income_diagnostics[0].deduped_income_events_count, 1);
});

test("debug UI state excludes provider card/refund/fee rows from income diagnostics", async () => {
  const fixture = repositoryFixture();
  fixture.operations.push(
    {
      date: "2026-05-08",
      operation: "income",
      toChannel: "трансервайз дол",
      amount: "4.40",
      amountUsd: "4.40",
      amountNet: "4.40",
      source: "wise",
      rawSourceId: "CARD-3766611855",
      comment: "Card transaction at Bolt",
      ledgerV2: {
        date: "2026-05-08",
        operation: "income",
        to_channel: "трансервайз дол",
        amount: "4.40",
        currency: "USD",
        amount_usd: "4.40",
        amount_net: "4.40",
        balance_amount: 4.40,
        source: "wise",
        raw_source_id: "CARD-3766611855",
        comment: "Card transaction at Bolt",
      }
    },
    {
      date: "2026-05-08",
      operation: "income",
      toChannel: "трансервайз дол",
      amount: "206",
      amountUsd: "206",
      amountNet: "206",
      source: "wise",
      rawSourceId: "WISE-INCOMING-1",
      ledgerV2: {
        date: "2026-05-08",
        operation: "income",
        direction: "in",
        to_channel: "трансервайз дол",
        amount: "206",
        currency: "USD",
        amount_usd: "206",
        amount_net: "206",
        balance_amount: 206,
        source: "wise",
        raw_source_id: "WISE-INCOMING-1",
      }
    },
    {
      date: "2026-05-08",
      operation: "income",
      toChannel: "пейпал дол",
      amount: "12",
      amountUsd: "12",
      amountNet: "12",
      source: "paypal",
      entryKind: "refund",
      ledgerV2: {
        date: "2026-05-08",
        operation: "income",
        to_channel: "пейпал дол",
        amount: "12",
        currency: "USD",
        amount_usd: "12",
        amount_net: "12",
        balance_amount: 12,
        source: "paypal",
      }
    },
    {
      date: "2026-05-08",
      operation: "income",
      toChannel: "пейпал дол",
      amount: "113.87",
      amountUsd: "113.87",
      amountNet: "113.87",
      source: "paypal",
      ledgerV2: {
        date: "2026-05-08",
        operation: "income",
        direction: "in",
        to_channel: "пейпал дол",
        amount: "113.87",
        currency: "USD",
        amount_usd: "113.87",
        amount_net: "113.87",
        balance_amount: 113.87,
        source: "paypal",
      }
    }
  );

  const payload = await buildDebugUiState({
    query: { period: "2026-05-05..2026-05-11" },
    repositoryLoader: async () => fixture
  });

  const wise = payload.finance_analysis.actual_income.find((row) => row.channel === "трансервайз дол");
  const paypal = payload.finance_analysis.actual_income.find((row) => row.channel === "пейпал дол");
  assert.equal(wise.rows, 1);
  assert.equal(wise.amount_usd_signed_sum, 206);
  assert.equal(paypal.rows, 1);
  assert.equal(paypal.amount_usd_signed_sum, 113.87);
});

test("debug UI state explains TransferWise expense delta with plan reconciliation", async () => {
  const fixture = {
    ok: true,
    schema: "ledger-v2-compatible",
    legacyExpenseRows: [
      {
        date: "2026-05-15",
        category: "total",
        amounts: {
          "трансервайз дол": "609.73",
        },
      },
    ],
    operations: [
      {
        date: "2026-05-03",
        operation: "expense",
        fromChannel: "трансервайз дол",
        amountUsd: "-640.25",
        amountNet: "640.25",
        source: "wise",
        ledgerV2: {
          date: "2026-05-03",
          operation: "expense",
          from_channel: "трансервайз дол",
          amount_usd: "-640.25",
          amount_net: "640.25",
          balance_amount: -640.25,
          source: "wise",
          category: "business",
        },
      },
      {
        date: "2026-05-04",
        operation: "expense",
        fromChannel: "трансервайз дол",
        amountUsd: "-150.67",
        amountNet: "150.67",
        source: "wise",
        ledgerV2: {
          date: "2026-05-04",
          operation: "expense",
          from_channel: "трансервайз дол",
          amount_usd: "-150.67",
          amount_net: "150.67",
          balance_amount: -150.67,
          source: "wise",
          category: "house",
        },
      },
      {
        date: "2026-05-05",
        operation: "expense",
        fromChannel: "трансервайз дол",
        amountUsd: "-10.88",
        amountNet: "10.88",
        source: "wise",
        ledgerV2: {
          date: "2026-05-05",
          operation: "expense",
          from_channel: "трансервайз дол",
          amount_usd: "-10.88",
          amount_net: "10.88",
          balance_amount: -10.88,
          source: "wise",
          category: "food",
        },
      },
      {
        date: "2026-05-06",
        operation: "exchange",
        fromChannel: "трансервайз дол",
        amountUsd: "-415",
        amountNet: "415",
        source: "wise",
        ledgerV2: {
          date: "2026-05-06",
          operation: "exchange",
          from_channel: "трансервайз дол",
          amount_usd: "-415",
          amount_net: "415",
          balance_amount: -415,
          source: "wise",
        },
      },
    ],
    warnings: [],
  };

  const payload = await buildDebugUiState({
    query: { from: "2026-05-01", to: "2026-05-15" },
    repositoryLoader: async () => fixture,
  });

  const breakdown = payload.expense_analysis.real_expense_breakdown.find((row) => row.channel === "трансервайз дол");
  assert.equal(breakdown.total, 801.8);
  assert.equal(breakdown.business, 640.25);
  assert.equal(breakdown.personal, 161.55);
  assert.deepEqual(breakdown.byCategory, {
    business: 640.25,
    house: 150.67,
    food: 10.88,
  });
  assert.equal(breakdown.excluded_transfer_exchange, 415);

  const reconciliation = payload.expense_analysis.reconciliation_by_channel.find((row) => row.channel === "трансервайз дол");
  assert.equal(reconciliation.planned_expense_usd, 609.73);
  assert.equal(reconciliation.business_real_expense_usd, 640.25);
  assert.equal(reconciliation.total_real_expense_usd, 801.8);
  assert.equal(reconciliation.personal_expense_usd, 161.55);
  assert.equal(reconciliation.excluded_transfer_exchange_usd, 415);
  assert.equal(reconciliation.delta_usd, 30.52);
  assert.equal(reconciliation.unexplained_delta, 0);
  assert.equal(reconciliation.rounding_delta, 0);
  assert.equal(reconciliation.status, "business_over_plan");
  assert.match(reconciliation.warnings.join("\n"), /No stable row-level join key/);
  assert.equal(reconciliation.business_real_rows, undefined);
});

test("expense reconciliation warns when arithmetic leaves unexplained delta above one cent", () => {
  const reconciliation = buildExpensePlanReconciliationByChannel({
    planRows: [{ channel: "пейпал дол", totalUsd: "100" }],
    breakdownRows: [{
      channel: "пейпал дол",
      total: 130,
      business: 120,
      personal: 5,
      excluded_transfer_exchange: 0,
    }],
  }).find((row) => row.channel === "пейпал дол");

  assert.equal(reconciliation.unexplained_delta, 5);
  assert.equal(reconciliation.status, "unexplained");
  assert.match(reconciliation.warnings.join("\n"), /unexplained delta above 0.01/);
});

test("debug UI state can expose safe sanitized rows with configured token", async () => {
  const envBackup = snapshotEnv(["AGENT_DEBUG_TOKEN"]);
  process.env.AGENT_DEBUG_TOKEN = "safe-debug-token";

  try {
    const payload = await buildDebugUiState({
      query: { period: "2026-05", includeRows: "1", debugToken: "safe-debug-token" },
      repositoryLoader: async () => repositoryFixture()
    });
    const serialized = JSON.stringify(payload).toLowerCase();

    assert.equal(payload.debug_access.includeRowsAuthorized, true);
    assert.equal(payload.finance_analysis.actual_income_rows.length, 1);
    assert.equal(payload.row_samples.income.length, 1);
    assert.equal(payload.row_samples.expense.length, 1);
    assert.equal(payload.row_samples.transfer.length, 1);
    assert.equal(serialized.includes("customer@example.com"), false);
    assert.equal(serialized.includes("private_key abcdefghijklmnopqrstuvwxyz"), false);
    assert.equal(serialized.includes("token abcdefghijklmnopqrstuvwxyz"), false);
    assert.match(payload.row_samples.income[0].comment_excerpt, /\[email redacted\]/);
    assert.match(payload.row_samples.income[0].comment_excerpt, /private_key \[redacted\]/);
  } finally {
    restoreEnv(envBackup);
  }
});

test("GET /api/debug-ui-state routes through existing index function", async () => {
  const response = createResponseRecorder();
  await indexHandler({
    method: "GET",
    query: { action: "debugUiState", from: "2099-01-01", to: "2099-01-02" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body?.ok, true);
  assert.ok(response.body?.debug_access);
  assert.ok(response.body?.ui_aggregate_contract);
});

test("POST debug endpoints return 405 JSON", async () => {
  for (const action of ["debugFull", "debugAnalytics", "debugUiState"]) {
    const response = createResponseRecorder();
    await indexHandler({ method: "POST", query: { action } }, response);

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.body?.ok, false);
    assert.match(response.body?.error, /Unsupported method: POST/);
  }
});

test("vercel rewrites expose debug paths through the existing index function", async () => {
  const { readFile } = await import("node:fs/promises");
  const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

  for (const expectedRewrite of [
    { source: "/api/balance-snapshots", destination: "/api/index?action=balanceSnapshots" },
    { source: "/api/debug-full", destination: "/api/index?action=debugFull" },
    { source: "/api/debug-analytics", destination: "/api/index?action=debugAnalytics" },
    { source: "/api/debug-ui-state", destination: "/api/index?action=debugUiState" }
  ]) {
    assert.ok(
      vercelConfig.rewrites.some((rewrite) => rewrite.source === expectedRewrite.source && rewrite.destination === expectedRewrite.destination),
      `${expectedRewrite.source} rewrite is configured`
    );
  }
  assert.ok(vercelConfig.rewrites.some((rewrite) => rewrite.source === "/api/manual-finance" && rewrite.destination === "/api/index?action=manualWorkbook&route=manual-finance"));
});

test("existing status and dashboard handlers keep their current contracts", async () => {
  const envBackup = snapshotEnv([
    "EZOHATA_V2_APPS_SCRIPT_URL",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
  ]);
  delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  try {
    const statusResponse = createResponseRecorder();
    await statusHandler({ method: "GET", query: {} }, statusResponse);
    assert.equal(statusResponse.statusCode, 200);
    assert.equal(statusResponse.body?.ok, true);
    assert.equal(statusResponse.body?.service, "ezohata-incoming-ledger");

    const dashboardResponse = createResponseRecorder();
    await indexHandler({
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-05-01",
        endDate: "2026-05-09"
      }
    }, dashboardResponse);
    assert.equal(dashboardResponse.statusCode, 200);
    assert.equal(dashboardResponse.body?.ok, true);
    assert.equal(dashboardResponse.body?.action, "getDashboardData");
    assert.equal(dashboardResponse.body?.source, "snapshot");
    assert.equal(dashboardResponse.body?.fallbackSnapshot, true);
  } finally {
    restoreEnv(envBackup);
  }
});
