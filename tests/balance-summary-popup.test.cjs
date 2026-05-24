const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function resetBalanceModule() {
  delete require.cache[require.resolve("../balance-summary-popup.js")];
  delete global.document;
  delete global.window;
  delete global.state;
  delete global.elements;
  delete global.buildTopMetricsSummary;
  delete global.EzohataBalanceSummaryPopup;
}

function loadApi() {
  resetBalanceModule();
  return require("../balance-summary-popup.js");
}

function makeMockDocument() {
  return {
    createElement(tag) {
      return {
        tag,
        children: [],
        textContent: "",
        className: "",
        id: "",
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        setAttribute() {},
      };
    },
  };
}

function collectText(node) {
  if (!node) return "";
  return [node.textContent || "", ...(node.children || []).map(collectText)].filter(Boolean).join("\n");
}

function collectNodes(node, predicate, result = []) {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  (node.children || []).forEach((child) => collectNodes(child, predicate, result));
  return result;
}

test("top balance button replaced old top audit launcher while bottom audit script stays loaded", () => {
  assert.match(indexHtml, /id="balanceLauncherButton"[^>]*>Баланс<\/button>/);
  assert.doesNotMatch(indexHtml, /id="auditLauncherButton"[^>]*>Аудит<\/button>/);
  assert.match(indexHtml, /audit-site-tab\.js/);
});

test("balance summary does not discount myOrders twice", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({ totalOrdersPlusPercent: 1100, myOrders: 200, paid: 500 });

  assert.equal(summary.totalOrdersPlusPercent, 1100);
  assert.equal(summary.myOrders, 200);
  assert.equal(summary.myOrdersPayable, 200);
  assert.equal(summary.myOrdersHalf, 200);
  assert.equal(summary.totalAccrued, 1300);
  assert.equal(summary.remainingToPay, 800);
  resetBalanceModule();
});

test("orders payment summary uses accrued with percent, discounted personal orders, and paid once", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    totalOrdersPlusPercent: 1400.3,
    myOrders: 647.5,
    paid: 965.7039,
  });

  assert.equal(Number(summary.orders.toFixed(4)), 1400.3);
  assert.equal(Number(summary.myOrdersPayable.toFixed(4)), 647.5);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 2047.8);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1082.0961);
  resetBalanceModule();
});

test("occurred table uses OCCURRED as base and OCCURRED plus percent as total", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "OCCURRED", "OCCURRED +3%", "ACCRUED", "ACCRUED +3%"],
              ["1", "2026-05-04", "432.8", "445.784", "9999", "9999"],
              ["2", "2026-05-10", "1000", "1030", "9999", "9999"],
            ],
          },
          orders: { values: [] },
        },
      },
    },
    totalPaid: 500,
    personalOrdersAfterDiscount: 200,
  }, { startDate: "2026-05-01", endDate: "2026-05-21" });

  assert.equal(summary.orders, 1475.784);
  assert.equal(summary.totalOrdersPlusPercent, 1475.784);
  assert.equal(Number(summary.percentToOrders.toFixed(4)), 42.984);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1175.784);
  assert.doesNotMatch(summary.diagnostics.join("\n"), /source not found for orders|source not found for percentToOrders/);
  resetBalanceModule();
});

test("default summary reads app state table instead of falling back to top metrics", () => {
  resetBalanceModule();
  global.state = {
    data: {
      tabs: {
        movement: {
          values: [
            ["NUMBER", "DATE", "OCCURRED", "OCCURRED +3%"],
            ["1", "2026-05-04", "100", "103"],
          ],
        },
        orders: { values: [] },
      },
    },
  };
  global.elements = { startDate: { value: "2026-05-01" }, endDate: { value: "2026-05-21" } };
  global.buildTopMetricsSummary = () => ({ totalOrders: 9999, totalPaid: 0, personalOrdersAfterDiscount: 0 });

  const api = require("../balance-summary-popup.js");
  const summary = api.buildBalanceTextSummary();

  assert.equal(summary.orders, 103);
  assert.equal(summary.totalOrdersPlusPercent, 103);
  assert.equal(summary.percentToOrders, 3);
  assert.doesNotMatch(summary.diagnostics.join("\n"), /source not found for orders/);
  resetBalanceModule();
});

test("selected period excludes outside occurred rows", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "OCCURRED", "OCCURRED +3%"],
              ["1", "2026-04-30", "1000", "1030"],
              ["2", "2026-05-10", "1000", "1030"],
            ],
          },
          orders: { values: [] },
        },
      },
    },
    totalPaid: 500,
    personalOrdersAfterDiscount: 200,
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(summary.orders, 1030);
  assert.equal(summary.percentToOrders, 30);
  assert.equal(summary.totalOrdersPlusPercent, 1030);
  assert.equal(summary.remainingToPay, 730);
  resetBalanceModule();
});

test("legacy accrued columns still work as fallback", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "ACCRUED", "ACCRUED +3%"],
              ["1", "2026-05-04", "400", "412"],
              ["2", "2026-05-10", "600", "618"],
            ],
          },
          orders: { values: [] },
        },
      },
    },
    totalPaid: 0,
    personalOrdersAfterDiscount: 0,
  }, { startDate: "2026-05-01", endDate: "2026-05-21" });

  assert.equal(summary.orders, 1030);
  assert.equal(summary.totalOrdersPlusPercent, 1030);
  assert.equal(summary.percentToOrders, 30);
  resetBalanceModule();
});

test("top metric fallback treats totalOrders as accrued plus percent", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({ totalOrders: 2047.8, totalPaid: 965.7039, personalOrdersAfterDiscount: 647.5 });

  assert.equal(Number(summary.orders.toFixed(4)), 2047.8);
  assert.equal(Number(summary.percentToOrders.toFixed(4)), 61.434);
  assert.equal(Number(summary.totalOrdersPlusPercent.toFixed(4)), 2047.8);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 2047.8);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1082.0961);
  resetBalanceModule();
});

test("canonical top metrics override row-summed movement table in popup", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    totalOrders: 2047.8,
    ordersAccruedWithPercent: 1400.3,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    personalOrdersGross: 1295,
    personalOrdersAfterDiscount: 647.5,
    percentRate: 3,
    ordersPaymentSummary: {
      ordersAccruedWithPercent: 1400.3,
      percentRate: 3,
      myOrdersGross: 1295,
      myOrdersDiscounted: 647.5,
      totalAccrued: 2047.8,
      totalPaid: 965.7039,
      remainingToPay: 1082.0961,
    },
    state: {
      data: {
        tabs: {
          movement: {
            values: [
              ["NUMBER", "DATE", "PRICE BASE", "ACCRUED", "ACCRUED +3%"],
              ["1", "2026-05-04", "1460", "1460", "1503.2632"],
              ["Итого", "", "1460", "1360", "1400.3"],
            ],
          },
          orders: { values: [] },
        },
      },
    },
  }, { startDate: "2026-05-01", endDate: "2026-05-21" });

  assert.equal(Number(summary.ordersBase.toFixed(4)), 1360);
  assert.equal(Number(summary.orders.toFixed(4)), 1400.3);
  assert.equal(Number(summary.myOrders.toFixed(4)), 1295);
  assert.equal(Number(summary.myOrdersPayable.toFixed(4)), 647.5);
  assert.equal(Number(summary.totalAccrued.toFixed(4)), 2047.8);
  assert.equal(Number(summary.remainingToPay.toFixed(4)), 1082.0961);
  resetBalanceModule();
});

test("percent rate renders as percent label, not monetary percent amount", () => {
  const api = loadApi();
  const items = [];
  const doc = {
    createElement(tag) {
      const node = {
        tag,
        children: [],
        textContent: "",
        appendChild(child) {
          this.children.push(child);
          if (tag === "ol" && child.tag === "li") items.push(child.textContent);
        },
        setAttribute() {},
      };
      return node;
    },
  };
  api.renderBalanceSummaryBlock({
    orders: 1400.3,
    percentRate: 3,
    totalOrdersPlusPercent: 1400.3,
    myOrders: 647.5,
    myOrdersPayable: 647.5,
    totalAccrued: 2047.8,
    totalPaid: 965.7039,
    remainingToPay: 1082.0961,
    diagnostics: [],
  }, doc);

  assert.match(items.join("\n"), /Процент к заказам: 3%/);
  assert.doesNotMatch(items.join("\n"), /63,2632/);
  resetBalanceModule();
});

test("zero orders with plus column returns zero percent amount instead of NaN", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    state: { data: { tabs: { movement: { values: [["NUMBER", "DATE", "OCCURED", "OCCURED +3%"], ["1", "2026-05-04", "0", "0"]] }, orders: { values: [] } } } },
    totalPaid: 0,
    personalOrdersAfterDiscount: 0,
  }, { startDate: "2026-05-01", endDate: "2026-05-21" });

  assert.equal(Number.isNaN(summary.percentToOrders), false);
  assert.equal(summary.percentToOrders, 0);
  resetBalanceModule();
});

test("balance popup renders income distribution by channel from matched service/order summary", () => {
  const api = loadApi();
  const summary = api.buildBalanceTextSummary({
    totalOrdersPlusPercent: 1000,
    totalPaid: 250,
    personalOrdersAfterDiscount: 100,
    state: {
      data: {
        realIncome: {
          serviceOrderSummaryByChannel: {
            PayPal: { realNetUsd: 125 },
            Wise: { realNetUsd: 375 },
            Empty: { realNetUsd: 0 },
            "Wise refund": { realNetUsd: 0, plannedReceivedUsd: 915.5 },
          },
        },
        tabs: { movement: { values: [] }, orders: { values: [] } },
      },
    },
  });
  const block = api.renderBalanceSummaryBlock(summary, makeMockDocument());
  const text = collectText(block);

  assert.match(text, /Распределение оплат заказов\/услуг по каналам/);
  assert.match(text, /Возвраты, обмены и внутренние переводы исключены из процентов/);
  assert.match(text, /Wise/);
  assert.match(text, /375,0000/);
  assert.match(text, /75\.0%/);
  assert.match(text, /PayPal/);
  assert.match(text, /125,0000/);
  assert.match(text, /25\.0%/);
  assert.doesNotMatch(text, /Empty/);
  assert.doesNotMatch(text, /Wise refund/);
  assert.doesNotMatch(text, /915,5000/);
  resetBalanceModule();
});

test("income distribution ignores zero and planned-only channels and totals positive rows to 100 percent", () => {
  const api = loadApi();
  const distribution = api.buildIncomeChannelDistribution({
    data: {
      realIncome: {
        serviceOrderSummaryByChannel: {
          PayPal: { realNetUsd: 566.5 },
          Wise: { realNetUsd: 30 },
          Zero: { realNetUsd: 0 },
          "Wise refund": { realNetUsd: 0, plannedReceivedUsd: 915.5 },
          "Binance funding": { plannedReceivedUsd: 915.5 },
          Blank: {},
        },
      },
    },
  });

  assert.equal(distribution.channels.length, 2);
  assert.equal(distribution.total, 596.5);
  assert.equal(Number(distribution.channels.reduce((sum, row) => sum + row.percent, 0).toFixed(4)), 100);
  assert.deepEqual(distribution.channels.map((row) => row.channel), ["PayPal", "Wise"]);
  assert.equal(distribution.channels.find((row) => row.channel === "PayPal").amount, 566.5);
  assert.equal(Number(distribution.channels.find((row) => row.channel === "PayPal").percent.toFixed(4)), 94.9707);
  assert.equal(distribution.channels.some((row) => row.channel === "Wise refund"), false);
  assert.equal(distribution.channels.some((row) => row.channel === "Binance funding"), false);
  resetBalanceModule();
});

test("income distribution does not use planned received fallback from realIncome summary", () => {
  const api = loadApi();
  const distribution = api.buildIncomeChannelDistribution({
    data: {
      realIncome: {
        serviceOrderSummaryByChannel: {
          PayPal: { plannedReceivedUsd: 80 },
          Wise: { realNetUsd: 20, plannedReceivedUsd: 200 },
          "Binance funding": { plannedReceivedUsd: 915.5 },
        },
      },
    },
  });

  assert.equal(distribution.total, 20);
  assert.deepEqual(distribution.channels.map((row) => row.channel), ["Wise"]);
  assert.equal(distribution.channels.find((row) => row.channel === "Wise").percent, 100);
  assert.equal(distribution.channels.some((row) => row.channel === "PayPal"), false);
  assert.equal(distribution.channels.some((row) => row.channel === "Binance funding"), false);
  assert.doesNotMatch(distribution.diagnostics.join("\n"), /plannedReceivedUsd fallback/);
  resetBalanceModule();
});

test("income distribution falls back to movement only when realIncome summary is absent", () => {
  const api = loadApi();
  const movementValues = [
    ["DATE", "PAYMENT CHANNEL", "NET RECEIVED USD", "OPERATION"],
    ["2026-05-05", "PayPal", "100", "income"],
    ["2026-05-06", "Wise", "50", "income"],
  ];
  const absentSummary = api.buildIncomeChannelDistribution({
    data: { tabs: { movement: { values: movementValues } } },
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });
  const presentZeroSummary = api.buildIncomeChannelDistribution({
    data: {
      realIncome: {
        serviceOrderSummaryByChannel: {
          "Binance funding": { realNetUsd: 0, plannedReceivedUsd: 915.5 },
        },
      },
      tabs: { movement: { values: movementValues } },
    },
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(absentSummary.source, "movement table");
  assert.equal(absentSummary.total, 150);
  assert.deepEqual(absentSummary.channels.map((row) => row.channel), ["PayPal", "Wise"]);
  assert.equal(presentZeroSummary.source, "realIncome.serviceOrderSummaryByChannel");
  assert.equal(presentZeroSummary.total, 0);
  assert.deepEqual(presentZeroSummary.channels, []);
  resetBalanceModule();
});

test("income distribution renders empty service-income state without movement fallback", () => {
  const api = loadApi();
  const movementValues = [
    ["DATE", "PAYMENT CHANNEL", "NET RECEIVED USD", "OPERATION"],
    ["2026-05-05", "Binance funding", "915.5", "income"],
    ["2026-05-06", "Wise refund", "1712.8585", "income"],
  ];
  const distribution = api.buildIncomeChannelDistribution({
    data: {
      realIncome: {
        serviceOrderSummaryByChannel: {
          "Binance funding": { realNetUsd: 0, plannedReceivedUsd: 915.5 },
          "Wise refund": { realNetUsd: 0, plannedReceivedUsd: 1712.8585 },
        },
      },
      tabs: { movement: { values: movementValues } },
    },
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });
  const block = api.renderBalanceSummaryBlock({
    ordersBase: 0,
    percentRate: 3,
    totalOrdersPlusPercent: 0,
    myOrders: 0,
    myOrdersPayable: 0,
    totalAccrued: 0,
    totalPaid: 0,
    remainingToPay: 0,
    diagnostics: [],
    incomeChannelDistribution: distribution,
  }, makeMockDocument());
  const text = collectText(block);

  assert.equal(distribution.source, "realIncome.serviceOrderSummaryByChannel");
  assert.equal(distribution.total, 0);
  assert.deepEqual(distribution.channels, []);
  assert.doesNotMatch(text, /Binance funding/);
  assert.doesNotMatch(text, /915,5000/);
  assert.doesNotMatch(text, /Wise refund/);
  assert.doesNotMatch(text, /2628,3585/);
  assert.match(text, /Нет подтвержденных оплат заказов\/услуг по каналам за период/);
  resetBalanceModule();
});

test("income distribution uses positive realIncome rows even when movement has extra inflows", () => {
  const api = loadApi();
  const distribution = api.buildIncomeChannelDistribution({
    data: {
      realIncome: {
        serviceOrderSummaryByChannel: {
          PayPal: { realNetUsd: 566.5 },
        },
      },
      tabs: {
        movement: {
          values: [
            ["DATE", "PAYMENT CHANNEL", "NET RECEIVED USD", "OPERATION"],
            ["2026-05-05", "PayPal", "566.5", "income"],
            ["2026-05-06", "Binance funding", "915.5", "income"],
          ],
        },
      },
    },
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(distribution.source, "realIncome.serviceOrderSummaryByChannel");
  assert.equal(distribution.total, 566.5);
  assert.deepEqual(distribution.channels.map((row) => row.channel), ["PayPal"]);
  assert.equal(distribution.channels[0].amount, 566.5);
  assert.equal(distribution.channels[0].percent, 100);
  resetBalanceModule();
});

test("income distribution excludes broad unmatched provider inflows when service summary exists", () => {
  const api = loadApi();
  const distribution = api.buildIncomeChannelDistribution({
    data: {
      realIncome: {
        serviceOrderSummaryByChannel: {
          PayPal: { realNetUsd: 566.5 },
        },
        summaryByChannel: {
          PayPal: { realNetUsd: 566.5 },
          "Бинанс spot": { realNetUsd: 103, plannedReceivedUsd: 0 },
          "приват-фоп": { realNetUsd: 7736.7595, plannedReceivedUsd: 0 },
        },
        unmatchedSummaryByChannel: {
          "Бинанс spot": { realNetUsd: 103, plannedReceivedUsd: 0 },
          "приват-фоп": { realNetUsd: 7736.7595, plannedReceivedUsd: 0 },
        },
      },
      tabs: {
        movement: {
          values: [
            ["DATE", "PAYMENT CHANNEL", "NET RECEIVED USD", "OPERATION"],
            ["2026-05-05", "Бинанс spot", "103", "income"],
            ["2026-04-22", "приват-фоп", "7736.7595", "income"],
          ],
        },
      },
    },
  }, { startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal(distribution.source, "realIncome.serviceOrderSummaryByChannel");
  assert.equal(distribution.total, 566.5);
  assert.deepEqual(distribution.channels.map((row) => row.channel), ["PayPal"]);
  assert.equal(distribution.channels.some((row) => row.channel === "Бинанс spot"), false);
  assert.equal(distribution.channels.some((row) => row.channel === "приват-фоп"), false);
  resetBalanceModule();
});

test("income distribution percentages use service income summary only", () => {
  const api = loadApi();
  const distribution = api.buildIncomeChannelDistribution({
    data: {
      realIncome: {
        serviceOrderSummaryByChannel: {
          PayPal: { realNetUsd: 100 },
          Wise: { realNetUsd: 300 },
        },
        summaryByChannel: {
          PayPal: { realNetUsd: 100 },
          Wise: { realNetUsd: 300 },
          "Бинанс spot": { realNetUsd: 103 },
          "приват-фоп": { realNetUsd: 7736.7595 },
        },
        refundSummaryByChannel: {
          Wise: { realNetUsd: 200 },
        },
        exchangeSummaryByChannel: {
          "Binance funding": { realNetUsd: 500 },
        },
        allSummaryByChannel: {
          PayPal: { realNetUsd: 100 },
          Wise: { realNetUsd: 500 },
          "Binance funding": { realNetUsd: 500 },
        },
      },
    },
  });

  assert.equal(distribution.title, "Распределение оплат заказов/услуг по каналам");
  assert.equal(distribution.total, 400);
  assert.equal(distribution.channels.find((row) => row.channel === "Wise").percent, 75);
  assert.equal(distribution.channels.find((row) => row.channel === "PayPal").percent, 25);
  assert.equal(distribution.channels.some((row) => row.channel === "Binance funding"), false);
  resetBalanceModule();
});

test("existing balance popup lines remain unchanged when distribution is appended", () => {
  const api = loadApi();
  const block = api.renderBalanceSummaryBlock({
    ordersBase: 1000,
    percentRate: 3,
    totalOrdersPlusPercent: 1030,
    myOrders: 200,
    myOrdersPayable: 100,
    totalAccrued: 1130,
    totalPaid: 500,
    remainingToPay: 630,
    diagnostics: [],
    incomeChannelDistribution: {
      title: "Распределение оплат заказов/услуг по каналам",
      total: 100,
      channels: [{ channel: "PayPal", amount: 100, percent: 100 }],
      diagnostics: [],
    },
  }, makeMockDocument());
  const items = collectNodes(block, (node) => node.tag === "li").map((node) => node.textContent);

  assert.deepEqual(items, [
    "Сумма заказов за период (ACCRUED): 1000,0000",
    "Процент к заказам: 3%",
    "Итого: Заказы + % (ACCRUED +3%): 1030,0000",
    "Мои заказы: 200,0000",
    "Мои заказы к начислению (уже с учетом скидки): 100,0000",
    "ВСЕГО НАЧИСЛЕНО: 1130,0000",
    "ВСЕГО оплачено: 500,0000",
    "ОСТАТОК оплатить: 630,0000",
  ]);
  resetBalanceModule();
});

test("empty income distribution source does not crash and renders diagnostic", () => {
  const api = loadApi();
  const block = api.renderBalanceSummaryBlock({
    ordersBase: 0,
    percentRate: 3,
    totalOrdersPlusPercent: 0,
    myOrders: 0,
    myOrdersPayable: 0,
    totalAccrued: 0,
    totalPaid: 0,
    remainingToPay: 0,
    diagnostics: [],
    incomeChannelDistribution: api.buildIncomeChannelDistribution({ data: { tabs: { movement: { values: [] } } } }),
  }, makeMockDocument());

  assert.match(collectText(block), /needs verification: source not found for income channel distribution/);
  resetBalanceModule();
});
