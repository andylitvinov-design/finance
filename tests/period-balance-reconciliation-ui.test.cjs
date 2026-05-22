const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../period-balance-reconciliation-ui.js");
const POSITION_TABLE_HEADER = ["КАНАЛ", "ВАЛЮТА", "ОСТАТОК НА КОНЕЦ ДНЯ 23:59", "ПЛАН ИЗМЕНЕНИЕ", "ПЛАНОВЫЙ EOD BALANCE", "РЕАЛ ИЗМЕНЕНИЕ", "РЕАЛ РАСЧЕТНЫЙ EOD", "ФАКТ НА КОНЕЦ ПЕРИОДА 23:59 EOD", "ФАКТ ДАТА", "ФАКТ ИСТОЧНИК", "SOURCE ROW", "ФАКТ ПЕРЕНОС/ДЛЯ СРАВНЕНИЯ", "РАЗНИЦА ФАКТ-РЕАЛ", "ПЛАН-РЕАЛ", "СТАТУС", "ПРИЧИНА"];

test("period balance reconciliation UI wraps Analytics, not expense financial analysis", () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const expenseBlock = doc.createElement("div");
  const root = {
    document: doc,
    fetch: createOkFetch(),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
    renderExpenseFinancialAnalysis() {
      return expenseBlock;
    },
  };
  const originalExpenseRenderer = root.renderExpenseFinancialAnalysis;

  assert.equal(ui.installPeriodBalanceReconciliationUi(root), true);

  root.renderAnalyticsSections(analyticsContainer, []);
  const renderedExpense = root.renderExpenseFinancialAnalysis();

  assert.equal(root.renderExpenseFinancialAnalysis, originalExpenseRenderer);
  assert.equal(renderedExpense, expenseBlock);
  assert.equal(findByClass(expenseBlock, "period-balance-reconciliation-section").length, 0);
  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "period-balance-reconciliation-section").length, 1);
  assert.equal(analyticsContainer.children[0].className, "finance-analysis-section period-balance-reconciliation-section");
});

test("period balance reconciliation block replaces Analytics placeholder with API result", async () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const root = {
    document: doc,
    fetch: createOkFetch(),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
  };

  ui.installPeriodBalanceReconciliationUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);
  await flushPromises();

  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "period-balance-reconciliation-section").length, 1);
  assert.match(analyticsContainer.textContent, /ИТОГО: НЕ ОК/);
  assert.match(analyticsContainer.textContent, /OK позиций/);
  assert.doesNotMatch(analyticsContainer.textContent, /Изменение баланса по валютам/);
  assert.match(analyticsContainer.textContent, /Остатки по каналам оплаты/);
});

test("period balance UI shows fact source counts and required manual fact rows", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    summary: {
      status: "failed",
      positions_checked: 2,
      currencies_checked: 1,
      channels_checked: 2,
      planned_rows: 0,
      planned_source_status: "available_empty",
      missing_amount_net_rows: 0,
      status_counts: { ok: 0, mismatch: 1, missing_provider_balance: 1 },
      balance_source_counts: { manual_fact: 0, provider_auto: 1, missing: 1 },
      blocked: 1,
    },
    by_channel_currency: [
      {
        channel: "wise usd",
        currency: "USD",
        opening_fact_balance: 1000,
        real_delta: 70,
        calculated_closing_balance: 1070,
        manual_provider_closing_balance: 1050,
        displayed_fact_balance: 1050,
        balanceSource: "provider_auto",
        sourceSheet: "Авто Остатки",
        needsManualConfirmation: true,
        status: "mismatch",
      },
      {
        channel: "paypal usd",
        currency: "USD",
        opening_fact_balance: null,
        real_delta: 10,
        calculated_closing_balance: null,
        manual_provider_closing_balance: null,
        displayed_fact_balance: null,
        balanceSource: "missing",
        needsManualConfirmation: true,
        status: "missing_provider_balance",
      },
    ],
    required_manual_fact_rows: [
      {
        sheet: "Остатки",
        date: "2026-05-17",
        channel: "wise usd",
        currency: "USD",
        amount: null,
        amount_hint: 1050,
        balanceSource: "provider_auto",
        status: "mismatch",
        action: "Confirm provider auto balance, then enter the factual balance in Остатки.",
      },
      {
        sheet: "Остатки",
        date: "2026-05-17",
        channel: "paypal usd",
        currency: "USD",
        amount: null,
        balanceSource: "missing",
        status: "missing_provider_balance",
        action: "Enter factual manual/provider balance in Остатки.",
      },
    ],
    actionable_rows: [],
  }));

  assert.match(block.textContent, /Факт из Остатки/);
  assert.match(block.textContent, /Авто факт к подтверждению/);
  assert.match(block.textContent, /Нужно ввести факт/);
  assert.match(block.textContent, /Что добавить в Остатки/);
  assert.match(block.textContent, /2026-05-17/);
  assert.match(block.textContent, /wise usd/);
  assert.match(block.textContent, /auto, needs manual confirmation/);
  assert.match(block.textContent, /paypal usd/);
  assert.match(block.textContent, /add manual fact balance/);
});

test("period balance UI clarifies closing fact date source and hides unavailable planned zeroes", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    summary: {
      status: "failed",
      positions_checked: 2,
      currencies_checked: 1,
      channels_checked: 2,
      planned_rows: 0,
      planned_source_status: "available_empty",
      missing_amount_net_rows: 0,
      status_counts: { missing_provider_balance: 1, missing_opening_balance: 1 },
      blocked: 1,
    },
    by_channel_currency: [
      {
        channel: "Яндекс руб",
        currency: "RUB",
        opening_balance: 142858.88,
        opening_balance_date: "2026-04-28",
        planned_delta: 0,
        planned_rows: 0,
        real_delta: -72655.37,
        calculated_closing_balance: 70203.51,
        manual_provider_closing_balance: null,
        manual_provider_closing_balance_date: null,
        balanceSource: "missing",
        sourceSheet: "",
        sourceRow: null,
        nearest_manual_provider_fact_date: "2026-05-05",
        nearest_manual_provider_fact_amount: 68087.38,
        status: "missing_provider_balance",
      },
      {
        channel: "трансервайз евро",
        currency: "EUR",
        opening_balance: null,
        planned_delta: 0,
        planned_rows: 0,
        real_delta: -158.56,
        calculated_closing_balance: null,
        manual_provider_closing_balance: 158.56,
        manual_provider_closing_balance_date: "2026-05-19",
        balanceSource: "provider_auto",
        sourceSheet: "Авто Остатки",
        sourceRow: 13,
        sourceComment: "wise auto snapshot",
        status: "missing_opening_balance",
      },
    ],
    actionable_rows: [],
  }));

  const rows = getTableTextRows(findByClass(block, "period-balance-subsection")[0].children[1].children[0]);

  assert.ok(rows[0].some((cell) => cell.includes("ФАКТ НА КОНЕЦ ПЕРИОДА") && cell.includes("23:59")));
  assert.ok(rows[0].includes("ФАКТ ДАТА"));
  assert.ok(rows[0].includes("SOURCE ROW"));
  assert.ok(!rows[0].includes("ФАКТ РУЧНОЙ/ПРОВАЙДЕР"));

  const yandex = rows.find((row) => row[0] === "Яндекс руб");
  const wise = rows.find((row) => row[0] === "трансервайз евро");
  assert.equal(yandex[3], "—");
  assert.equal(yandex[7], "missing fact");
  assert.equal(yandex[8], "—");
  assert.equal(yandex[10], "—");
  assert.match(yandex.at(-1), /Нет факта на конец периода\. Есть ближайший факт: 2026-05-05 68087\.38\./);
  assert.equal(wise[7], "158.56");
  assert.equal(wise[8], "2026-05-19");
  assert.equal(wise[9], "auto, needs manual confirmation");
  assert.equal(wise[10], "Авто Остатки #13");
});

test("period balance reconciliation prepends Analytics container with DOM children collection", () => {
  const doc = createTestDocument();
  const analyticsContainer = createHtmlCollectionLikeContainer();
  const root = {
    document: doc,
    fetch: () => new Promise(() => {}),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      const coverage = doc.createElement("section");
      coverage.className = "finance-analysis-section balance-coverage-section";
      coverage.textContent = "Сверка остатков по счетам";
      container.appendChild(normal);
      container.appendChild(coverage);
    },
  };

  ui.installPeriodBalanceReconciliationUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);

  assert.deepEqual(
    analyticsContainer.childList.map((node) => node.className),
    [
      "finance-analysis-section period-balance-reconciliation-section",
      "normal-analytics-section",
      "finance-analysis-section balance-coverage-section",
    ]
  );
});

test("period balance reconciliation removes competing legacy balance block from Analytics composition", () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const root = {
    document: doc,
    fetch: () => new Promise(() => {}),
    renderAnalyticsSections(container) {
      const legacy = doc.createElement("div");
      legacy.className = "analytics-section";
      legacy.textContent = "БАЛАНС ВАЛЮТА БЫЛО СТАЛО РОСТ PLAN PROFIT РАЗНИЦА1 КОМИССИЯ ДОП РАСХОДЫ БАЛАНС EXTRA";
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.append(legacy, normal);
    },
  };

  ui.installPeriodBalanceReconciliationUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);

  assert.equal(findByClass(analyticsContainer, "period-balance-reconciliation-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.doesNotMatch(analyticsContainer.textContent, /PLAN PROFIT/);
  assert.doesNotMatch(analyticsContainer.textContent, /РАЗНИЦА1/);
  assert.doesNotMatch(analyticsContainer.textContent, /EXTRA/);
});

test("period balance verdict renders required total labels", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const text = block.textContent;

  [
    "ИТОГО: НЕ ОК",
    "Проверено позиций",
    "OK позиций",
    "Расхождения",
    "Нет начального",
    "Нет конечного",
    "Нет amount_net",
  ].forEach((label) => assert.match(text, new RegExp(escapeRegExp(label))));
});

test("period balance top summary keeps multi-currency totals separated", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const summary = findByClass(block, "period-balance-total-summary")[0];
  const table = findTag(summary, "TABLE")[0];
  const rows = getTableTextRows(table);

  assert.deepEqual(rows[0], ["Показатель", "EUR", "UAH", "USD"]);
  assert.deepEqual(rows[1], ["Полная сумма остатков на конец дня 23:59 перед/на старт", "200", "100", "1000"]);
  assert.deepEqual(rows[2], ["Полная сумма EOD balance на конец периода 23:59", "240", "70", "1125"]);
  assert.equal(rows[3][0], "Плановая сумма приходов");
  assert.equal(rows[3][1], "50");
  assert.equal(rows[3][3], "200");
});

test("period balance renders channel balances before secondary currency totals", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const subsections = findByClass(block, "period-balance-subsection");
  const titles = subsections.map((section) => section.children[0].textContent);

  assert.deepEqual(titles, [
    "Остатки по каналам оплаты",
    "Где исправить",
  ]);

  const channelRows = getTableTextRows(findTag(subsections[0], "TABLE")[0]);
  assert.equal(channelRows.length, 7);
  assert.deepEqual(channelRows[0], POSITION_TABLE_HEADER);
  assert.equal(channelRows[1][0], "wise usd");
  assert.deepEqual(channelRows[1], ["wise usd", "USD", "1000", "150", "1150", "125", "1125", "1125", "—", "manual fact", "—", "—", "0", "-25", "OK", "—"]);
  assert.equal(channelRows[2][0], "paypal eur");
  assert.equal(channelRows[3][0], "mono uah");
  assert.equal(channelRows[3][3], "0");
  assert.equal(channelRows[3][14], "Реальное расхождение");
  assert.deepEqual(channelRows.at(-3), ["ИТОГО EUR", "EUR", "200", "40", "240", "40", "240", "240", "—", "—", "—", "—", "0", "0", "Итого по валюте", "—"]);
  assert.deepEqual(channelRows.at(-2), ["ИТОГО UAH", "UAH", "100", "0", "100", "-25", "75", "70", "—", "—", "—", "—", "-5", "-25", "Итого по валюте", "—"]);
  assert.deepEqual(channelRows.at(-1), ["ИТОГО USD", "USD", "1000", "150", "1150", "125", "1125", "1125", "—", "—", "—", "—", "0", "-25", "Итого по валюте", "—"]);
  assert.match(block.textContent, /Сводка по валютам, справочно/);
  assert.doesNotMatch(block.textContent, /Итоги по валютам/);
  assert.doesNotMatch(block.textContent, /Итоги по всем каналам/);
});

test("period balance main table uses payment channel rows and preserves mismatch statuses", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    summary: {
      status: "failed",
      positions_checked: 5,
      currencies_checked: 4,
      channels_checked: 5,
      planned_rows: 0,
      planned_source_status: "available_empty",
      missing_amount_net_rows: 1,
      blocked: 3,
      status_counts: { mismatch: 1, missing_provider_balance: 1, missing_opening_balance: 1, missing_amount_net: 1 },
    },
    by_channel_currency: [
      {
        channel: "трансервайз дол",
        currency: "USD",
        opening_balance: 2704.25,
        planned_delta: 0,
        planned_closing_balance: 2704.25,
        real_delta: -1628,
        computed_real_closing_balance: 1076.25,
        manual_provider_closing_balance: 1070.48,
        factual_closing_balance: 1070.48,
        fact_source: "manual",
        real_difference: -5.77,
        plan_vs_real_delta: -1628,
        status: "mismatch",
      },
      {
        channel: "Яндекс руб",
        currency: "RUB",
        opening_balance: 100,
        planned_delta: 0,
        planned_closing_balance: 100,
        real_delta: 0,
        computed_real_closing_balance: 100,
        manual_provider_closing_balance: 100,
        factual_closing_balance: 100,
        fact_source: "manual",
        real_difference: 0,
        plan_vs_real_delta: 50,
        status: "ok",
      },
      {
        channel: "монобанк грн",
        currency: "UAH",
        opening_balance: 14033,
        planned_delta: 0,
        planned_closing_balance: 14033,
        real_delta: 0,
        computed_real_closing_balance: 14033,
        manual_provider_closing_balance: null,
        factual_closing_balance: null,
        fact_source: "missing",
        real_difference: null,
        plan_vs_real_delta: 0,
        status: "missing_provider_balance",
      },
      {
        channel: "БАНК КАНАДА cad",
        currency: "CAD",
        opening_balance: 10107.92,
        planned_delta: 0,
        planned_closing_balance: 10107.92,
        real_delta: 0,
        computed_real_closing_balance: 10107.92,
        manual_provider_closing_balance: null,
        carried_forward_balance: 7351,
        displayed_fact_balance: 7351,
        factual_closing_balance: 7351,
        fact_source: "carried_forward",
        real_difference: -2756.92,
        plan_vs_real_delta: 0,
        status: "carried_forward_conditional",
      },
      {
        channel: "Бинанс spot",
        currency: "USDT",
        opening_balance: null,
        planned_delta: 0,
        planned_closing_balance: null,
        real_delta: 103,
        computed_real_closing_balance: null,
        manual_provider_closing_balance: null,
        factual_closing_balance: null,
        fact_source: "missing",
        real_difference: null,
        plan_vs_real_delta: 103,
        status: "missing_opening_balance",
      },
      {
        channel: "пейпал евр",
        currency: "EUR",
        opening_balance: -349.14,
        planned_delta: 0,
        planned_closing_balance: -349.14,
        real_delta: -392.75,
        computed_real_closing_balance: -741.89,
        manual_provider_closing_balance: null,
        factual_closing_balance: null,
        fact_source: "missing",
        real_difference: null,
        plan_vs_real_delta: -392.75,
        missing_amount_net_rows: 1,
        status: "missing_amount_net",
      },
    ],
    actionable_rows: [],
  }));

  const mainSection = findByClass(block, "period-balance-subsection")[0];
  const rows = getTableTextRows(findTag(mainSection, "TABLE")[0]);
  const rowLabels = rows.slice(1).map((row) => row[0]);

  assert.equal(mainSection.children[0].textContent, "Остатки по каналам оплаты");
  assert.equal(rows[0][0], "КАНАЛ");
  ["трансервайз дол", "Яндекс руб", "монобанк грн", "БАНК КАНАДА cad", "Бинанс spot"].forEach((channel) => {
    assert.ok(rowLabels.includes(channel), `${channel} must render as a primary channel row`);
  });
  ["CAD", "EUR", "LOCAL", "RUB", "UAH", "UNKNOWN", "USD", "USDT"].forEach((currencyOnly) => {
    assert.ok(!rowLabels.includes(currencyOnly), `${currencyOnly} must not render as a primary channel row`);
  });
  ["ИТОГО CAD", "ИТОГО EUR", "ИТОГО RUB", "ИТОГО UAH", "ИТОГО USD", "ИТОГО USDT"].forEach((label) => {
    assert.ok(rowLabels.includes(label), `${label} total row must render when currency is present`);
  });
  assert.deepEqual(rows.find((row) => row[0] === "трансервайз дол").slice(1, 15), ["USD", "2704.25", "—", "—", "-1628", "1076.25", "1070.48", "—", "manual fact", "—", "—", "-5.77", "—", "Реальное расхождение"]);
  assert.deepEqual(rows.find((row) => row[0] === "БАНК КАНАДА cad").slice(1, 15), ["CAD", "10107.92", "—", "—", "0", "10107.92", "—", "—", "перенесён", "—", "7351", "-2756.92", "—", "Условно перенесено"]);
  assert.equal(rows.find((row) => row[0] === "Яндекс руб")[14], "OK");
  assert.equal(rows.find((row) => row[0] === "пейпал евр")[14], "Нет amount_net");
  assert.equal(rows.find((row) => row[0] === "Бинанс spot")[14], "Нет стартового остатка");
});

test("period balance analytics UI does not render raw daily snapshot inventory", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, {
    ...buildSnapshot({
      by_channel_currency: [
        {
          channel: "трансервайз дол",
          currency: "USD",
          opening_balance: 100,
          real_delta: 25,
          calculated_closing_balance: 125,
          factual_closing_balance: 125,
          real_difference: 0,
          status: "ok",
        },
      ],
      actionable_rows: [],
    }),
    balance_snapshots: {
      rows: [
        { date: "2026-05-01", channel: "трансервайз дол", currency: "USD", amount: 100 },
        { date: "2026-05-02", channel: "трансервайз дол", currency: "USD", amount: 101 },
        { date: "2026-05-17", channel: "трансервайз дол", currency: "USD", amount: 125 },
      ],
      input_rows: [
        { date: "2026-05-17", channel: "пейпал евр", currency: "EUR", status: "needs_input" },
      ],
      by_date: { "2026-05-01": [] },
    },
  });
  const text = block.textContent;

  assert.match(text, /Остатки по каналам оплаты/);
  assert.doesNotMatch(text, /2026-05-01/);
  assert.doesNotMatch(text, /2026-05-02/);
  assert.doesNotMatch(text, /2026-05-17/);
  assert.doesNotMatch(text, /input_rows/);
  assert.doesNotMatch(text, /needs_input/);
});

test("period balance actionable rows still render under fix section only", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot());
  const fixSection = findByClass(block, "period-balance-subsection").find((section) => section.children[0].textContent === "Где исправить");
  const rows = getTableTextRows(findTag(fixSection, "TABLE")[0]);

  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], "mono uah");
  assert.equal(rows[1][6], "Проверить Ledger movements");
});

test("period balance UI shows missing provider balance as blocked, not OK", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    summary: {
      status: "blocked",
      positions_checked: 1,
      currencies_checked: 1,
      channels_checked: 1,
      planned_rows: 0,
      planned_source_status: "available_empty",
      missing_amount_net_rows: 0,
      blocked: 1,
      status_counts: { ok: 0, mismatch: 0, missing_provider_balance: 1 },
    },
    by_channel_currency: [
      {
        channel: "wise usd",
        currency: "USD",
        opening_balance: 1000,
        real_delta: 100,
        computed_real_closing_balance: 1100,
        factual_closing_balance: null,
        real_difference: null,
        closing_balance_source: "missing",
        status: "missing_provider_balance",
        fix_action: "Добавить фактический остаток на дату окончания периода по этому счету/валюте.",
      },
    ],
    actionable_rows: [
      {
        channel: "wise usd",
        currency: "USD",
        status: "missing_provider_balance",
        real_difference: null,
        plan_vs_real_delta: 100,
        diagnosis: "Нет фактического остатка на дату; сверка заблокирована.",
        fix_action: "Добавить фактический остаток на дату окончания периода по этому счету/валюте.",
      },
    ],
  }));
  const text = block.textContent;

  assert.match(text, /Нет факта на дату/);
  assert.match(text, /Нет фактического остатка на дату/);
  assert.match(text, /Добавить фактический остаток на дату окончания периода/);
  const positionRows = getTableTextRows(findByClass(block, "period-balance-subsection")[0].children[1].children[0]);
  assert.equal(positionRows[1][14], "Нет фактического остатка на дату");
});

test("period balance UI keeps existing factual values visible when summary failed", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    summary: {
      status: "failed",
      positions_checked: 2,
      currencies_checked: 1,
      channels_checked: 2,
      planned_rows: 0,
      planned_source_status: "available_empty",
      missing_amount_net_rows: 0,
      blocked: 1,
      status_counts: { mismatch: 1, missing_provider_balance: 1 },
    },
    by_channel_currency: [
      {
        channel: "трансервайз дол",
        currency: "USD",
        opening_balance: 1000,
        real_delta: 76.25,
        computed_real_closing_balance: 1076.25,
        manual_provider_closing_balance: 1070.48,
        factual_closing_balance: 1070.48,
        fact_source: "manual",
        real_difference: -5.77,
        closing_balance_source: "exact",
        status: "mismatch",
        fix_action: "Проверить Ledger movements.",
      },
      {
        channel: "монобанк грн",
        currency: "UAH",
        opening_balance: 14033,
        real_delta: 0,
        computed_real_closing_balance: 14033,
        factual_closing_balance: null,
        real_difference: null,
        closing_balance_source: "missing",
        status: "missing_provider_balance",
        fix_action: "Добавить фактический остаток.",
      },
    ],
  }));

  const positionRows = getTableTextRows(findByClass(block, "period-balance-subsection")[0].children[1].children[0]);
  assert.equal(positionRows[1][7], "1070.48");
  assert.equal(positionRows[1][8], "—");
  assert.equal(positionRows[1][9], "manual fact");
  assert.equal(positionRows[1][12], "-5.77");
  assert.equal(positionRows[2][7], "—");
});

test("period balance UI separates manual, carried-forward, and missing fact values", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    by_channel_currency: [
      {
        channel: "provider usd",
        currency: "USD",
        opening_fact_balance: 10,
        planned_delta: 1,
        planned_closing_balance: 11,
        real_delta: 2,
        calculated_closing_balance: 12,
        computed_real_closing_balance: 12,
        manual_provider_closing_balance: 11.5,
        carried_forward_balance: 99,
        displayed_fact_balance: 11.5,
        factual_closing_balance: 11.5,
        fact_source: "provider",
        real_difference: -0.5,
        plan_vs_real_delta: 1,
        status: "mismatch",
      },
      {
        channel: "wise usd",
        currency: "USD",
        opening_fact_balance: 1000,
        planned_delta: 100,
        planned_closing_balance: 1100,
        real_delta: 100,
        calculated_closing_balance: 1100,
        computed_real_closing_balance: 1100,
        manual_provider_closing_balance: null,
        carried_forward_balance: null,
        displayed_fact_balance: null,
        factual_closing_balance: null,
        fact_source: "missing",
        real_difference: null,
        plan_vs_real_delta: 0,
        status: "missing_provider_balance",
      },
      {
        channel: "cash usd",
        currency: "USD",
        opening_fact_balance: 50,
        planned_delta: 0,
        planned_closing_balance: 50,
        real_delta: 0,
        calculated_closing_balance: 999,
        computed_real_closing_balance: 999,
        manual_provider_closing_balance: null,
        carried_forward_balance: 50,
        displayed_fact_balance: 50,
        factual_closing_balance: 50,
        fact_source: "carried_forward",
        real_difference: 0,
        plan_vs_real_delta: 0,
        status: "carried_forward_conditional",
      },
      {
        channel: "mono uah",
        currency: "UAH",
        opening_fact_balance: null,
        planned_delta: 0,
        planned_closing_balance: null,
        real_delta: -100,
        calculated_closing_balance: null,
        computed_real_closing_balance: null,
        manual_provider_closing_balance: null,
        carried_forward_balance: null,
        displayed_fact_balance: 900,
        factual_closing_balance: 900,
        factual_closing_balance_date: "2026-05-21",
        fact_source: "calculated",
        fact_status: "calculated_from_previous",
        balanceSource: "calculated_balance",
        real_difference: null,
        plan_vs_real_delta: null,
        status: "calculated_from_previous",
      },
    ],
    actionable_rows: [],
  }));

  const rows = getTableTextRows(findByClass(block, "period-balance-subsection")[0].children[1].children[0]);
  const provider = rows.find((row) => row[0] === "provider usd");
  const wise = rows.find((row) => row[0] === "wise usd");
  const cash = rows.find((row) => row[0] === "cash usd");
  const mono = rows.find((row) => row[0] === "mono uah");

  assert.deepEqual(rows[0], POSITION_TABLE_HEADER);
  assert.equal(provider[7], "11.5");
  assert.equal(provider[8], "—");
  assert.equal(provider[9], "auto, needs manual confirmation");
  assert.equal(wise[6], "1100");
  assert.equal(wise[7], "—");
  assert.equal(wise[8], "—");
  assert.equal(wise[9], "add manual fact balance");
  assert.equal(cash[6], "999");
  assert.equal(cash[7], "—");
  assert.equal(cash[11], "50");
  assert.equal(cash[9], "перенесён");
  assert.equal(cash[12], "0");
  assert.notEqual(cash[7], "999");
  assert.notEqual(cash[8], "999");
  assert.equal(mono[7], "900");
  assert.equal(mono[9], "calculated from previous");
  assert.equal(mono[14], "calculated from previous");
  assert.notEqual(mono[7], "missing fact");
});

test("period balance UI moves empty no-data rows out of the main table", () => {
  const doc = createTestDocument();
  const block = ui.renderPeriodBalanceBlock(doc, buildSnapshot({
    by_channel_currency: [
      {
        channel: "пейпал cad",
        currency: "CAD",
        opening_fact_balance: null,
        planned_delta: 0,
        planned_closing_balance: null,
        real_delta: 0,
        calculated_closing_balance: null,
        manual_provider_closing_balance: null,
        carried_forward_balance: null,
        displayed_fact_balance: null,
        fact_source: "missing",
        real_difference: null,
        plan_vs_real_delta: null,
        movement_rows: 0,
        planned_rows: 0,
        status: "no_data",
      },
      {
        channel: "missing movement",
        currency: "USD",
        opening_fact_balance: null,
        planned_delta: null,
        real_delta: 25,
        calculated_closing_balance: null,
        manual_provider_closing_balance: null,
        fact_source: "missing",
        real_difference: null,
        movement_rows: 1,
        planned_rows: 0,
        status: "missing_provider_balance",
      },
      {
        channel: "amount net problem",
        currency: "EUR",
        opening_fact_balance: null,
        planned_delta: null,
        real_delta: null,
        calculated_closing_balance: null,
        manual_provider_closing_balance: null,
        fact_source: "missing",
        real_difference: null,
        missing_amount_net_rows: 1,
        status: "missing_amount_net",
      },
      {
        channel: "carried mismatch",
        currency: "UAH",
        opening_fact_balance: 100,
        planned_delta: 0,
        real_delta: 0,
        calculated_closing_balance: 100,
        manual_provider_closing_balance: null,
        carried_forward_balance: 90,
        displayed_fact_balance: 90,
        fact_source: "carried_forward",
        real_difference: -10,
        status: "carried_forward_conditional",
      },
    ],
    actionable_rows: [],
  }));

  const mainRows = getTableTextRows(findByClass(block, "period-balance-subsection")[0].children[1].children[0]);
  const mainLabels = mainRows.slice(1).map((row) => row[0]);
  assert.ok(!mainLabels.includes("пейпал cad"));
  assert.ok(mainLabels.includes("missing movement"));
  assert.ok(mainLabels.includes("amount net problem"));
  assert.ok(mainLabels.includes("carried mismatch"));

  const hiddenSection = findByClass(block, "period-balance-no-data-subsection")[0];
  assert.equal(hiddenSection.children[0].textContent, "Строки без данных");
  assert.match(hiddenSection.textContent, /Скрыто строк без данных: 1/);
  assert.match(hiddenSection.textContent, /пейпал cad/);
});

test("period balance API failure renders non-blocking Analytics error", async () => {
  const doc = createTestDocument();
  const analyticsContainer = doc.createElement("div");
  const root = {
    document: doc,
    fetch: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, error: "service unavailable" }),
    }),
    renderAnalyticsSections(container) {
      const normal = doc.createElement("div");
      normal.className = "normal-analytics-section";
      normal.textContent = "Обычная аналитика";
      container.appendChild(normal);
    },
  };

  ui.installPeriodBalanceReconciliationUi(root);
  root.renderAnalyticsSections(analyticsContainer, []);
  await flushPromises();

  assert.equal(findByClass(analyticsContainer, "normal-analytics-section").length, 1);
  assert.equal(findByClass(analyticsContainer, "finance-status error").length, 1);
  assert.match(analyticsContainer.textContent, /Сверка баланса за период пока недоступна: service unavailable/);
});

function createOkFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => buildSnapshot(),
  });
}

function buildSnapshot(overrides = {}) {
  const summary = overrides.summary || {
    status: "failed",
    positions_checked: 3,
    currencies_checked: 2,
    channels_checked: 3,
    planned_rows: 2,
    planned_source_status: "ok",
    missing_amount_net_rows: 1,
    blocked: 0,
    status_counts: {
      ok: 2,
      mismatch: 1,
      missing_provider_balance: 0,
      missing_opening_balance: 0,
      missing_closing_balance: 0,
      missing_amount_net: 1,
      carried_forward_conditional: 0,
    },
  };
  const byChannelCurrency = overrides.by_channel_currency || [
    {
      channel: "wise usd",
      currency: "USD",
      opening_balance: 1000,
      planned_delta: 150,
      planned_closing_balance: 1150,
      real_delta: 125,
      computed_real_closing_balance: 1125,
      manual_provider_closing_balance: 1125,
      factual_closing_balance: 1125,
      fact_source: "manual",
      real_difference: 0,
      plan_vs_real_delta: -25,
      closing_balance_source: "exact",
      status: "ok",
    },
    {
      channel: "paypal eur",
      currency: "EUR",
      opening_balance: 200,
      planned_delta: 40,
      planned_closing_balance: 240,
      real_delta: 40,
      computed_real_closing_balance: 240,
      manual_provider_closing_balance: 240,
      factual_closing_balance: 240,
      fact_source: "manual",
      real_difference: 0,
      plan_vs_real_delta: 0,
      closing_balance_source: "exact",
      status: "ok",
    },
    {
      channel: "mono uah",
      currency: "UAH",
      opening_balance: 100,
      planned_delta: 0,
      planned_closing_balance: 100,
      real_delta: -25,
      computed_real_closing_balance: 75,
      manual_provider_closing_balance: 70,
      factual_closing_balance: 70,
      fact_source: "manual",
      real_difference: -5,
      plan_vs_real_delta: -25,
      closing_balance_source: "exact",
      status: "mismatch",
      diagnosis: "Расхождение",
      fix_action: "Проверить Ledger movements",
    },
  ];
  return {
    ok: true,
    period_balance_reconciliation: {
      period: { from: "2026-05-11", to: "2026-05-15" },
      summary,
      by_currency: [
        {
          currency: "USD",
          planned_inflow: 200,
          planned_outflow: 50,
          planned_delta: 150,
          real_inflow: 175,
          real_outflow: 50,
          real_delta: 125,
          plan_vs_real_delta: -25,
          real_difference: 0,
          status: "ok",
        },
        {
          currency: "EUR",
          planned_inflow: 50,
          planned_outflow: 10,
          planned_delta: 40,
          real_inflow: 60,
          real_outflow: 20,
          real_delta: 40,
          plan_vs_real_delta: 0,
          real_difference: 0,
          status: "ok",
        },
      ],
      by_channel_currency: byChannelCurrency,
      required_manual_fact_rows: overrides.required_manual_fact_rows || [],
      actionable_rows: overrides.actionable_rows || [
        {
          channel: "mono uah",
          currency: "UAH",
          real_difference: -5,
          plan_vs_real_delta: -25,
          status: "mismatch",
          diagnosis: "Расхождение",
          fix_action: "Проверить Ledger movements",
        },
      ],
    },
  };
}

function createTestDocument() {
  return {
    createElement(tagName) {
      return new TestElement(tagName);
    },
    getElementById() {
      return null;
    },
  };
}

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this._textContent = "";
    this._innerHTML = "";
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  insertBefore(child, reference) {
    child.parentElement = this;
    const index = this.children.indexOf(reference);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  replaceWith(replacement) {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index === -1) return;
    replacement.parentElement = this.parentElement;
    this.parentElement = null;
    siblings.splice(index, 1, replacement);
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, "");
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function createHtmlCollectionLikeContainer() {
  const container = {
    childList: [],
    get children() {
      return this.childList.reduce((collection, child, index) => {
        collection[index] = child;
        return collection;
      }, { length: this.childList.length });
    },
    appendChild(child) {
      child.parentElement = this;
      this.childList.push(child);
      return child;
    },
    insertBefore(child, reference) {
      child.parentElement = this;
      const index = this.childList.indexOf(reference);
      if (index === -1) {
        this.childList.push(child);
      } else {
        this.childList.splice(index, 0, child);
      }
      return child;
    },
  };
  return container;
}

function findByClass(root, className) {
  const expected = String(className).split(/\s+/).filter(Boolean);
  const result = [];
  visit(root, (node) => {
    const classes = String(node.className || "").split(/\s+/).filter(Boolean);
    if (expected.every((item) => classes.includes(item))) result.push(node);
  });
  return result;
}

function findTag(root, tagName) {
  const expected = String(tagName).toUpperCase();
  const result = [];
  visit(root, (node) => {
    if (node.tagName === expected) result.push(node);
  });
  return result;
}

function visit(node, visitor) {
  if (!node) return;
  visitor(node);
  (node.children || []).forEach((child) => visit(child, visitor));
}

function getTableTextRows(table) {
  return findTag(table, "TR").map((row) => row.children.map((cell) => cell.textContent));
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
