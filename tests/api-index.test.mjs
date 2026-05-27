import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import handler, { buildOrderPaymentCoverageReport, buildServicePaymentGapDiagnostics } from "../api/index.js";

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

test("GET sync falls back to snapshot when Apps Script URL is missing", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;

  try {
    const request = {
      method: "GET",
      query: {
        action: "sync",
        startDate: "2026-04-01",
        endDate: "2026-04-21"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.action, "getDashboardData");
    assert.equal(response.body?.source, "snapshot");
    assert.equal(response.body?.fallbackSnapshot, true);
    assert.ok(response.body?.data?.tabs);
  } finally {
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET health reports snapshot fallback when Apps Script URL is missing", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;

  try {
    const request = {
      method: "GET",
      query: {
        health: "1"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.configured, false);
    assert.equal(response.body?.fallbackSnapshot, true);
  } finally {
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData maps to calculatePeriod for Apps Script v2", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";

  try {
    global.fetch = async (url) => {
      assert.match(String(url), /action=calculatePeriod/);
      assert.match(String(url), /startDate=2026-04-01/);
      assert.match(String(url), /endDate=2026-04-21/);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            action: "calculatePeriod",
            data: { tabs: { movement: { values: [["h"], ["v"]] } } }
          });
        }
      };
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-01",
        endDate: "2026-04-21"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.action, "calculatePeriod");
    assert.ok(response.body?.data?.tabs?.movement?.values);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData merges manual and auto balances before analytics normalization", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousServiceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-overlay@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: { startDate: "2026-05-01", endDate: "2026-05-19", timeZone: "Europe/Kyiv" },
                tabs: {
                  movement: { sheetName: "движение средства", values: [["NUMBER", "DATE", "BALANCE"]] },
                  analytics: {
                    sheetName: "аналитика",
                    values: [
                      ["Личные расходы"],
                      ["валюта", "now", "приход от услуг", "spent for business", "затраты-мои", "обмен", "обмен_usd", "затраты-мои usd", "now_usd"],
                      ["трансервайз дол", "0", "", "", "", "", "", "", ""],
                      ["трансервайз евро", "0", "", "", "", "", "", "", ""],
                      ["Итого", "0", "", "", "", "", "", "", ""],
                      [],
                      ["Plan"],
                      ["валюта", "пришло в местной валюте", "пришло в долларах", "затраты-мои", "затраты-мои-дол", "ушло", "обмен", "обмен_usd", "план-рост", "plan-profit"],
                      ["трансервайз дол", "0", "0", "0", "0", "0", "", "", "0", "0"],
                      ["трансервайз евро", "0", "0", "0", "0", "0", "", "", "0", "0"],
                      ["Итого", "0", "0", "0", "0", "0", "", "", "0", "0"],
                      [],
                      ["БАЛАНС"],
                      ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
                      ["трансервайз дол", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
                      ["трансервайз евро", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
                      ["Итого", "0", "0", "0", "0", "0", "0", "0", "0", "0"]
                    ]
                  }
                }
              }
            });
          }
        };
      }
      if (value.includes("oauth2.googleapis.com/token")) {
        return { ok: true, status: 200, async json() { return { access_token: "test-access-token" }; } };
      }
      if (value.includes("sheets.googleapis.com") && value.includes("values:batchGet")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              valueRanges: [
                {
                  range: "'Ledger'!A:Q",
                  values: [
                    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                    ["2026-05-10", "income", "", "трансервайз дол", "20", "USD", "20", "20", "servicein", "", "in", "inside", "wise", "wise-income", "", "", ""]
                  ]
                },
                { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "трансервайз дол"]] },
                {
                  range: "'Остатки'",
                  values: [
                    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
                    ["2026-05-19", "трансервайз дол", "1000", "USD", "1", "1000", "manual fact"]
                  ]
                },
                {
                  range: "'Авто Остатки'",
                  values: [
                    ["date", "provider", "channel", "amount", "currency", "rate", "amount_usd", "source", "fetched_at", "raw_source_id", "status", "comment"],
                    ["2026-05-19", "wise", "трансервайз дол", "999", "USD", "1", "999", "wise_auto", "2026-05-19T00:00:00Z", "wise-usd", "ok", "wise auto snapshot"],
                    ["2026-05-19", "wise", "трансервайз евро", "158,56", "EUR", "1,16", "183,9296", "wise_auto", "2026-05-19T00:00:00Z", "wise-eur", "ok", "wise auto snapshot"]
                  ]
                },
                { range: "'План'", values: [["date", "channel", "amount", "currency"]] },
                { range: "'Переводы'", values: [["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"]] },
                { range: "'Комиссии'", values: [["дата", "канал", "сумма в долларах", "комментарий"]] }
              ]
            };
          }
        };
      }
      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler(
      { method: "GET", query: { action: "getDashboardData", startDate: "2026-05-01", endDate: "2026-05-19" } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);

    const manual = response.body?.data?.manual || {};
    assert.equal(manual.autoBalances.length, 2);
    assert.equal(manual.balanceSnapshotMerge.auto_balance_rows_used_as_fallback, 1);
    assert.equal(manual.balanceSnapshotMerge.auto_balance_rows_ignored_due_to_manual, 1);
    assert.equal(manual.balanceRows.find((row) => row.channel === "трансервайз дол")?.amount, "1000");
    assert.equal(manual.balanceRows.find((row) => row.channel === "трансервайз евро")?.sourceSheet, "Авто Остатки");

    const analyticsRows = response.body?.data?.tabs?.analytics?.values || [];
    const balanceIndex = analyticsRows.findIndex((row) => row?.[0] === "БАЛАНС");
    const findBalanceRow = (channel) => analyticsRows.slice(balanceIndex + 2).find((row) => row?.[0] === channel);
    assert.equal(findBalanceRow("трансервайз дол")?.[2], "1000,0000");
    assert.equal(findBalanceRow("трансервайз евро")?.[2], "183,9296");
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    if (previousServiceEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousServiceEmail;
    if (previousPrivateKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousPrivateKey;
  }
});

test("GET getDashboardData forwards ISO dates and scopes manual ledger rows to the selected period", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousServiceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-overlay@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        assert.match(value, /startDate=2026-05-03/);
        assert.match(value, /endDate=2026-05-09/);
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: { startDate: "2026-05-03", endDate: "2026-05-09", timeZone: "Europe/Kyiv" },
                tabs: {
                  movement: { sheetName: "движение средства", values: [["NUMBER", "DATE", "BALANCE"]] },
                  analytics: {
                    sheetName: "аналитика",
                    values: [
                      ["Личные расходы"],
                      ["валюта", "now", "приход от услуг", "spent for business", "затраты-мои", "обмен", "обмен_usd", "затраты-мои usd", "now_usd"],
                      ["пейпал дол", "0", "", "", "", "", "", "", ""],
                      ["Итого", "0", "", "", "", "", "", "", ""],
                      [],
                      ["Plan"],
                      ["валюта", "пришло в местной валюте", "пришло в долларах", "затраты-мои", "затраты-мои-дол", "ушло", "обмен", "обмен_usd", "план-рост", "plan-profit"],
                      ["пейпал дол", "0", "999", "999", "999", "0", "", "", "999", "0"],
                      ["Итого", "0", "999", "999", "999", "0", "", "", "999", "0"],
                      [],
                      ["БАЛАНС"],
                      ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
                      ["пейпал дол", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
                      ["Итого", "0", "0", "0", "0", "0", "0", "0", "0", "0"]
                    ]
                  }
                }
              }
            });
          }
        };
      }
      if (value.includes("oauth2.googleapis.com/token")) {
        return { ok: true, status: 200, async json() { return { access_token: "test-access-token" }; } };
      }
      if (value.includes("sheets.googleapis.com") && value.includes("values:batchGet")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              valueRanges: [
                {
                  range: "'Ledger'!A:Q",
                  values: [
                    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                    ["2026-05-02", "income", "", "пейпал дол", "999", "USD", "999", "999", "servicein", "", "in", "outside", "manual", "outside", "", "", ""],
                    ["2026-05-03", "income", "", "пейпал дол", "100", "USD", "100", "100", "servicein", "", "in", "inside", "manual", "inside-income", "", "", ""],
                    ["2026-05-04", "business_expense", "пейпал дол", "", "10", "USD", "10", "10", "business", "", "out", "inside", "manual", "inside-expense", "", "", ""],
                    ["2026-05-10", "business_expense", "пейпал дол", "", "900", "USD", "900", "900", "business", "", "out", "outside", "manual", "outside-expense", "", "", ""]
                  ]
                },
                { range: "'Расходы'!A1:Z", values: [["дата", "категория", "пейпал дол"]] },
                { range: "'Остатки'!A1:G", values: [["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"]] },
                { range: "'Переводы'!A1:G", values: [["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"]] },
                { range: "'Комиссии'!A1:D", values: [["дата", "канал", "сумма в долларах", "комментарий"]] }
              ]
            };
          }
        };
      }
      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return { ok: true, status: 200, async text() { return ""; } };
      }
      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler({
      method: "GET",
      query: { action: "getDashboardData", startDate: "03/05/2026", endDate: "09/05/2026" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.deepEqual(response.body?.data?.period_applied, {
      start: "2026-05-03",
      end: "2026-05-09",
      source_rows_total: 4,
      source_rows_in_period: 2,
    });
    assert.deepEqual(
      (response.body?.data?.manual?.operations || []).map((row) => row.rawSourceId || row.raw_source_id),
      ["inside-income", "inside-expense"]
    );
    const personalTotal = response.body?.data?.tabs?.analytics?.values?.find((row) => row?.[0] === "Итого");
    assert.equal(personalTotal?.[2], "100,0000");
    assert.equal(personalTotal?.[3], "10,0000");
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    if (previousServiceEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousServiceEmail;
    if (previousPrivateKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousPrivateKey;
  }
});

test("GET getDashboardData overlays fresh source movement rows when upstream is stale", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-01",
                  endDate: "2026-04-30",
                  timeZone: "Europe/Kiev"
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.04.2026", "дата 2", "30.04.2026", "обновить", "", "источник: 1v2ZvGdutjyMkW0FZqxJ3P0GRVuKPlNxG1lvZiUZlWvo"],
                      ["Поменяй даты.", "", "", "", "", "", "Обновлено: 15.04.2026 18:07:45"],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACTION", "QTY", "ACCRUED", "ACCRUED +3%", "70% OF ACCRUED", "70% OF +3%", "RUB RATE", "UAH RATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ", "ПОЛУЧЕНО В РУБЛЯХ", "ПОЛУЧЕНО В ГРИВНАХ", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE", "STATUS", "REVIEW NOTE"],
                      ["18126", "16.04.2026", "Ярослав Архипов", "Чистка мышечных напряжений", "", "100", "", "", "100", "103", "70", "72.1", "84.5563", "UAH RATE", "крипта, дол", "103", "", "", "103", "0", "ARRIVED", ""],
                      ["ИТОГО", "", "", "", "", "4495,0000", "", "4,0000", "4695,0000", "4874,0000", "3286,5000", "3411,8100", "", "", "", "734,6500", "80117,1200", "142657,4400", "4939,2400", "65,2400"],
                      [],
                      ["показатели", "значение"],
                      ["2) начислено прайс +%", "4874,0000"],
                      ["4) получено в долларах", "4939,2400"],
                      ["6) 70% от прайс+%", "3411,8100"]
                    ]
                  },
                  orders: {
                    sheetName: "список моих заказы",
                    values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]]
                  }
                }
              }
            });
          }
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return [
              ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
              ",,,,,,,,-,,,,-,-,,,курс,курс,курс,3%,3%,3%,3%,,,-,План,План,План,доп,Реал,Реал,Реал,Реал,-,дата,время,-,-,-,-,-,,,,,-,-,-,-,-",
              ",,Дата ,Клиент,Название заказа,Коммент/ остаток,Прайс база,25% акция,кол-во,всего,пр+3%,,%а,%б,,,руб,евр,грн,к-р,к-гр,к-р,к-гр,к-евро,метод оплаты,валюта,дол,руб,грн, +,дол,евро,руб,грн,КАРТА грн,дата,время,хвост,готовность ,ОТЗЫВ?,отчет,Тип/карта,руб,грн,,,Примечание,ВК,№К,Отзыв был?,емейл",
              ",18116,2026-04-09,сын Валерии Лозиной,Убрать сигнал по уровню Высшей Психики,,100,,,,,,,,,,,,43.75,,,,,,карта Андрей,,,,,,,,,22490.05,,,,,,,,,,,,,,,,,",
              ",18103,2026-04-06,Сергей Ковалев,Остановка процессов,,200,,,,,,,,,,,,43.86,,,,,,приват ФОП,,,,,,1030.07,,,45175.80,,,,,,,,,,,,,,,,,",
              ",18118,2026-04-11,Сергей Ковалев,Программи фиксация возраста - 1го уровня,,500,,,,515,,,,,,,,43.67,,,,,,фоп приват,,,,,,,,,1000,,,,,,,,,,,,,,,,,",
              ",18120,2026-04-13,Сергей Ковалев,UAH with rub and uah rates,,200,,,,206,,,,,,84.5563,,43.67,,,,,,фоп приват,,,,,,,,,8996.02,,,,,,,,,,,,,,,,,",
              ",18121,2026-04-13,Сергей Ковалев,UAH fallback rate,,,,,,,,,,,,,,,,,,,,фоп приват,,,,,,,,,451.76,,,,,,,,,,,,,,,,,",
              ",18126,2026-04-17,Ярослав Архипов,Чистка мышечных напряжений,,100,,,,103,,,,,,,,,,,,,,крипта, дол,,,,,,103,,,,,,,,,,,,,,,,,,,,",
              ",18127,2026-04-19,Сергей Ковалев,Посвящение Масонов 1 ступень,,100,,,,103,,,,,,,,,,,,,,Андрей карта,,,,,,103,,,,,,,,,,,,,,,,,,,,",
              ",18129,2026-04-18,Олеся Сандырева,Динамика Точки Сборки - Свет сознания. Ускорение обработки информации.,оплата 2 частями,100,,2,,206,,,,,,84.5563,,,,,,,сайт, рубли,,,,,,,\"9 216,64 + 9 216,64\",,,,,,,,,,,,,,,,,,"
            ].join("\n");
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-01",
        endDate: "2026-04-30"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    const movementRows = response.body?.data?.tabs?.movement?.values || [];
    const movementSummaryRows = response.body?.data?.tabs?.movement?.summaryRows || [];
    const positions = movementRows.map((row) => row?.[0]).filter(Boolean);
    const cryptoRow = movementRows.find((row) => row?.[0] === "18126");
    const correctedLozinaRow = movementRows.find((row) => row?.[0] === "18116");
    const correctedAccruedRow = movementRows.find((row) => row?.[0] === "18103");
    const correctedKovalevRow = movementRows.find((row) => row?.[0] === "18118");
    const mixedRateUahRow = movementRows.find((row) => row?.[0] === "18120");
    const fallbackUahRateRow = movementRows.find((row) => row?.[0] === "18121");
    const quantityRow = movementRows.find((row) => row?.[0] === "18129");
    assert.equal(cryptoRow?.[9], "101");
    assert.equal(cryptoRow?.[11], "70,7");
    assert.equal(cryptoRow?.[18], "103");
    assert.equal(cryptoRow?.[19], "");
    assert.equal(cryptoRow?.[20], "");
    assert.equal(cryptoRow?.[22], "-2");
    assert.equal(cryptoRow?.[23], "NEEDS VERIFICATION");
    assert.match(String(cryptoRow?.[24] || ""), /provider fee\/net missing/i);
    assert.equal(correctedLozinaRow?.[17], "14870");
    assert.equal(correctedLozinaRow?.[18], "339,8857");
    assert.match(correctedLozinaRow?.[24], /source duplicate 14870 UAH/);
    assert.equal(correctedAccruedRow?.[8], "200");
    assert.equal(correctedAccruedRow?.[9], "206");
    assert.equal(correctedAccruedRow?.[17], "45175,8");
    assert.equal(correctedAccruedRow?.[18], "1030");
    assert.equal(correctedAccruedRow?.[22], "-824");
    assert.equal(correctedKovalevRow?.[17], "22490,05");
    assert.equal(correctedKovalevRow?.[18], "515");
    assert.equal(correctedKovalevRow?.[22], "0");
    assert.match(correctedKovalevRow?.[24], /source missing 515 USD UAH equivalent/);
    assert.equal(mixedRateUahRow?.[12], "84,5563");
    assert.equal(mixedRateUahRow?.[13], "43,67");
    assert.equal(mixedRateUahRow?.[18], "206");
    assert.equal(mixedRateUahRow?.[22], "0");
    assert.equal(fallbackUahRateRow?.[13], "43,67");
    assert.equal(fallbackUahRateRow?.[18], "10,3449");
    assert.equal(quantityRow?.[8], "200");
    assert.equal(quantityRow?.[9], "206");
    assert.equal(quantityRow?.[19], "");
    assert.equal(quantityRow?.[20], "");
    assert.equal(quantityRow?.[22], "206");
    assert.equal(quantityRow?.[23], "NEEDS VERIFICATION");
    assert.match(String(quantityRow?.[24] || ""), /provider fee\/net missing/i);
    assert.deepEqual(movementSummaryRows, [
      ["2) начислено прайс +%", "1440,0000"],
      ["4) получено в долларах", "2204,2306"],
      ["6) 70% от прайс+%", "1008,0000"],
      ["needs verification: provider fee/net missing", "2"]
    ]);
    assert.deepEqual(positions, [
      "дата 1",
      "Поменяй даты. Таблица автоматически подтянет записи за выбранный период из исходного файла.",
      "NUMBER",
      "18116",
      "18103",
      "18118",
      "18120",
      "18121",
      "18126",
      "18127",
      "18129",
      "Итого"
    ]);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData applies adjacent ACTION multiplier to fresh orders rows", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";

  const sourceRow = ({ number, action = "" }) => {
    const row = Array.from({ length: 51 }, () => "");
    row[1] = number;
    row[2] = "2026-05-06";
    row[3] = "Сергей Ковалев";
    row[4] = `Заказ ${number}`;
    row[6] = "100";
    row[7] = action;
    return row;
  };

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-05-03",
                  endDate: "2026-05-09",
                  timeZone: "Europe/Kiev"
                },
                tabs: {
                  movement: { sheetName: "движение средства", values: [["NUMBER", "DATE", "BALANCE"]] },
                  orders: { sheetName: "список моих заказы", values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]] }
                }
              }
            });
          }
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return [
              Array.from({ length: 51 }, () => "").join(","),
              Array.from({ length: 51 }, () => "").join(","),
              ",,Дата,Клиент,Название заказа,Коммент/ остаток,Прайс база,25% акция,кол-во,всего,пр+3%",
              sourceRow({ number: "18152" }).join(","),
              sourceRow({ number: "18153", action: "0.5" }).join(","),
              sourceRow({ number: "18154" }).join(","),
            ].join("\n");
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-05-03",
        endDate: "2026-05-09"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    const ordersRows = response.body?.data?.tabs?.orders?.values || [];
    const row18152 = ordersRows.find((row) => row?.[0] === "18152");
    const row18153 = ordersRows.find((row) => row?.[0] === "18153");
    const row18154 = ordersRows.find((row) => row?.[0] === "18154");
    const totalRow = ordersRows.find((row) => row?.[0] === "Итого");

    assert.equal(row18152?.[9], "51,5");
    assert.equal(row18152?.[22], "51,5");
    assert.equal(row18153?.[9], "51,5");
    assert.equal(row18153?.[22], "51,5");
    assert.equal(row18154?.[9], "103");
    assert.equal(row18154?.[22], "103");
    assert.equal(totalRow?.[9], "206,0000");
    assert.equal(totalRow?.[22], "206,0000");
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData overlays fresh source payout rows when upstream is stale", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-01",
                  endDate: "2026-04-30",
                  timeZone: "Europe/Kiev"
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.04.2026", "дата 2", "30.04.2026"],
                      ["Поменяй даты.", "", "", ""],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE"]
                    ]
                  },
                  payouts: {
                    sheetName: "список выплат",
                    values: [
                      ["Выплаты", "Журнал переводов за период"],
                      ["POSITION", "DATE", "CLIENT", "SERVICE", "PAYMENT METHOD", "ВАЛЮТА", "СУММА ТЕКУЩАЯ", "AMOUNT (USD)", "КУРС ПЕРЕВОДА", "COMMENT"],
                      ["18124", "15.04.2026", "Сергей Ковалев", "Энергетическая карта с нуля", "фоп приват", "грн", "451,7600", "10,3000", "43,8602", ""]
                    ]
                  }
                }
              }
            });
          }
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return [
              ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
              ",,,,,,,,-,,,,-,-,,,курс,курс,курс,3%,3%,3%,3%,,,-,План,План,План,доп,Реал,Реал,Реал,Реал,-,дата,время,-,-,-,-,-,,,,,-,-,-,-,-",
              ",,Дата ,Клиент,Название заказа,Коммент/ остаток,Прайс база,25% акция,кол-во,всего,пр+3%,,%а,%б,,,руб,евр,грн,к-р,к-гр,к-р,к-гр,к-евро,метод оплаты,валюта,дол,руб,грн, +,дол,евро,руб,грн,КАРТА грн,дата,время,хвост,готовность ,ОТЗЫВ?,отчет,Тип/карта,руб,грн,,,Примечание,ВК,№К,Отзыв был?,емейл",
              ",18108,2026-04-07,Сергей Ковалев,5) Программы Мана,,200,,,,,,,,,,,,43.86,,,,,,приват ФОП,,,,,,1030.07,,,45175.80,,,,,,,,,,,,,,,,,",
              ",18118,2026-04-11,Сергей Ковалев,Программи фиксация возраста - 1го уровня,,500,,,,515,,,,,,,,43.67,,,,,,фоп приват,,,,,,,,,1000,,,,,,,,,,,,,,,,,",
              ",18121,2026-04-13,Сергей Ковалев,на благотворительность,,100,,,,103,,,,,,,,,,,,,,фоп приват,,,,,,,,,451.76,,,,,,,,,,,,,,,,,",
              ",18127,2026-04-19,Сергей Ковалев,Посвящение Масонов 1 ступень,,100,,,,103,,,,,,,,,,,,,,Андрей карта,,,,,,103,,,,,,,,,,,,,,,,,,,,",
              ",18129,2026-04-18,Олеся Сандырева,Динамика Точки Сборки - Свет сознания. Ускорение обработки информации.,оплата 2 частями,100,,2,,206,,,,,,84.5563,,,,,,,сайт, рубли,,,,,,,\"9 216,64 + 9 216,64\",,,,,,,,,,,,,,,,,,"
            ].join("\n");
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-01",
        endDate: "2026-04-30"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    const payoutRows = response.body?.data?.tabs?.payouts?.values || [];
    const positions = payoutRows.map((row) => row?.[0]).filter(Boolean);
    const kovalevPayout = payoutRows.find((row) => row?.[0] === "18108");
    const correctedPayout = payoutRows.find((row) => row?.[0] === "18118");
    assert.deepEqual(positions, ["Выплаты", "POSITION", "18108", "18118", "18127", "Итого"]);
    assert.equal(kovalevPayout?.[5], "грн");
    assert.equal(kovalevPayout?.[6], "45175,8");
    assert.equal(kovalevPayout?.[7], "1030");
    assert.equal(correctedPayout?.[5], "грн");
    assert.equal(correctedPayout?.[6], "22490,05");
    assert.equal(correctedPayout?.[7], "515");
    assert.match(correctedPayout?.[9], /source missing 515 USD UAH equivalent/);
    assert.equal(payoutRows.some((row) => /благотвор/i.test(String(row?.[3] || ""))), false);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData keeps Kovalev Wise @bolieslavn rows in orders and syncs one Wise transfer", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousWiseToken = process.env.WISE_API_TOKEN;
  const previousPayPalClientId = process.env.PAYPAL_CLIENT_ID;
  const previousPayPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";
  delete process.env.WISE_API_TOKEN;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;

  const makeSourceRow = ({ number, client, paymentMethod }) => {
    const row = new Array(51).fill("");
    row[1] = number;
    row[2] = "2026-05-24";
    row[3] = client;
    row[4] = "Регулировка заливки";
    row[6] = "50";
    row[9] = "51.5";
    row[24] = paymentMethod;
    row[30] = "580";
    return row.join(",");
  };

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-05-01",
                  endDate: "2026-05-31",
                  timeZone: "Europe/Kiev"
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.05.2026", "дата 2", "31.05.2026"],
                      ["Поменяй даты.", "", "", ""],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE"]
                    ]
                  },
                  payouts: {
                    sheetName: "список выплат",
                    values: [
                      ["Выплаты", "Журнал переводов за период"],
                      ["POSITION", "DATE", "CLIENT", "SERVICE", "PAYMENT METHOD", "ВАЛЮТА", "СУММА ТЕКУЩАЯ", "AMOUNT (USD)", "КУРС ПЕРЕВОДА", "COMMENT"]
                    ]
                  }
                }
              }
            });
          }
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return [
              new Array(51).fill("").join(","),
              new Array(51).fill("").join(","),
              ",,Дата ,Клиент,Название заказа,Коммент/ остаток,Прайс база,25% акция,кол-во,всего,пр+3%,,%а,%б,,,руб,евр,грн,к-р,к-гр,к-р,к-гр,к-евро,метод оплаты,валюта,дол,руб,грн, +,дол,евро,руб,грн,КАРТА грн,дата,время,хвост,готовность ,ОТЗЫВ?,отчет,Тип/карта,руб,грн,,,Примечание,ВК,№К,Отзыв был?,емейл",
              makeSourceRow({ number: "18179", client: "Сергей Ковалев", paymentMethod: "Wise @bolieslavn" }),
              makeSourceRow({ number: "18180", client: "Мария Wise", paymentMethod: "Wise @bolieslavn" }),
              makeSourceRow({ number: "18181", client: "Sergey Kovalev", paymentMethod: "Wise bolieslavn" }),
              makeSourceRow({ number: "18182", client: "Сергей Ковалёв", paymentMethod: "transferwise @bolieslavn" }),
              makeSourceRow({ number: "18183", client: "Сергей Ковалев", paymentMethod: "Wise other" })
            ].join("\n");
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler({
      method: "GET",
      query: { action: "getDashboardData", startDate: "2026-05-01", endDate: "2026-05-31" }
    }, response);

    assert.equal(response.statusCode, 200);
    const movementRows = response.body?.data?.tabs?.movement?.values || [];
    const payoutRows = response.body?.data?.tabs?.payouts?.values || [];
    const movementIds = movementRows.map((row) => row?.[0]).filter(Boolean);
    const payoutIds = payoutRows.map((row) => row?.[0]).filter(Boolean);

    assert.equal(movementIds.includes("18179"), true);
    assert.equal(movementIds.includes("18181"), true);
    assert.equal(movementIds.includes("18182"), true);
    assert.equal(payoutIds.includes("18179"), true);
    assert.equal(payoutIds.includes("18181"), true);
    assert.equal(payoutIds.includes("18182"), true);
    assert.equal(movementIds.includes("18180"), true);
    assert.equal(movementIds.includes("18183"), true);
    assert.equal(payoutIds.includes("18183"), true);

    const transferRows = response.body?.data?.manual?.transfers || [];
    const wiseTransfers = transferRows.filter((row) => row.raw_source_id === "source-order:18179");
    assert.equal(wiseTransfers.length, 1);
    assert.equal(transferRows.some((row) => row.raw_source_id === "source-order:18180"), false);
    assert.equal(wiseTransfers[0]?.channel, "wise boleslav usd");
    assert.match(wiseTransfers[0]?.who || "", /Сергей Ковалев/);
    assert.match(wiseTransfers[0]?.who || "", /Немиша/);
    assert.match(wiseTransfers[0]?.comment || "", /Перевод Wise/);
    assert.match(wiseTransfers[0]?.comment || "", /не мне/);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    if (previousWiseToken === undefined) delete process.env.WISE_API_TOKEN;
    else process.env.WISE_API_TOKEN = previousWiseToken;
    if (previousPayPalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousPayPalClientId;
    if (previousPayPalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = previousPayPalClientSecret;
  }
});

test("GET getDashboardData does not duplicate existing Kovalev Wise source-order transfer", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousWiseToken = process.env.WISE_API_TOKEN;
  const previousPayPalClientId = process.env.PAYPAL_CLIENT_ID;
  const previousPayPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const previousGoogleEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousGoogleKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";
  delete process.env.WISE_API_TOKEN;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  const sourceRow = new Array(51).fill("");
  sourceRow[1] = "18179";
  sourceRow[2] = "2026-05-24";
  sourceRow[3] = "Сергей Ковалев";
  sourceRow[4] = "Регулировка заливки";
  sourceRow[6] = "50";
  sourceRow[9] = "51.5";
  sourceRow[24] = "Wise @bolieslavn";
  sourceRow[30] = "580";

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: { startDate: "2026-05-01", endDate: "2026-05-31" },
                manual: {
                  transfers: [{
                    transferDate: "2026-05-24",
                    who: "Сергей Ковалев",
                    amount: "580",
                    currency: "USD",
                    channel: "wise boleslav usd",
                    usdAmount: "580",
                    raw_source_id: "source-order:18179",
                    comment: "Перевод Wise / не мне"
                  }]
                },
                tabs: {
                  movement: { values: [[], [], ["NUMBER", "DATE", "CLIENT", "SERVICE"]] },
                  payouts: { values: [["Выплаты"], ["POSITION"]] },
                  analytics: { values: [["Показатели"], ["x", "0"]] }
                }
              }
            });
          }
        };
      }
      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return [
              new Array(51).fill("").join(","),
              new Array(51).fill("").join(","),
              ",,Дата ,Клиент,Название заказа,Коммент/ остаток,Прайс база,25% акция,кол-во,всего,пр+3%,,%а,%б,,,руб,евр,грн,к-р,к-гр,к-р,к-гр,к-евро,метод оплаты,валюта,дол,руб,грн, +,дол,евро,руб,грн,КАРТА грн,дата,время,хвост,готовность ,ОТЗЫВ?,отчет,Тип/карта,руб,грн,,,Примечание,ВК,№К,Отзыв был?,емейл",
              sourceRow.join(",")
            ].join("\n");
          }
        };
      }
      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler({
      method: "GET",
      query: { action: "getDashboardData", startDate: "2026-05-01", endDate: "2026-05-31" }
    }, response);

    assert.equal(response.statusCode, 200);
    const transferRows = response.body?.data?.manual?.transfers || [];
    assert.equal(transferRows.filter((row) => row.raw_source_id === "source-order:18179").length, 1);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    if (previousWiseToken === undefined) delete process.env.WISE_API_TOKEN;
    else process.env.WISE_API_TOKEN = previousWiseToken;
    if (previousPayPalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousPayPalClientId;
    if (previousPayPalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = previousPayPalClientSecret;
    if (previousGoogleEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousGoogleEmail;
    if (previousGoogleKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousGoogleKey;
  }
});

test("GET getDashboardData overlays fresh source movement rows even when upstream has none", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-06",
                  endDate: "2026-04-07",
                  timeZone: "Europe/Kiev"
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "06.04.2026", "дата 2", "07.04.2026"],
                      ["Поменяй даты."],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACTION", "QTY", "ACCRUED", "ACCRUED +3%", "70% OF ACCRUED", "70% OF +3%", "RUB RATE", "UAH RATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ", "ПОЛУЧЕНО В РУБЛЯХ", "ПОЛУЧЕНО В ГРИВНАХ", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE", "STATUS", "REVIEW NOTE"]
                    ]
                  },
                  orders: {
                    sheetName: "список моих заказы",
                    values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]]
                  }
                }
              }
            });
          }
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return [
              ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
              ",,,,,,,,-,,,,-,-,,,курс,курс,курс,3%,3%,3%,3%,,,-,План,План,План,доп,Реал,Реал,Реал,Реал,-,дата,время,-,-,-,-,-,,,,,-,-,-,-,-",
              ",,Дата ,Клиент,Название заказа,Коммент/ остаток,Прайс база,25% акция,кол-во,всего,пр+3%,,%а,%б,,,руб,евр,грн,к-р,к-гр,к-р,к-гр,к-евро,метод оплаты,валюта,дол,руб,грн, +,дол,евро,руб,грн,КАРТА грн,дата,время,хвост,готовность ,ОТЗЫВ?,отчет,Тип/карта,руб,грн,,,Примечание,ВК,№К,Отзыв был?,емейл",
              ",18101,2026-04-06,Сергей Ковалев,3) Около 190 000 лет назад – Повреждение Каналов 6 ед,,200,,,,,,,,,,,,,,,,,,,,,,,,,,,45175,8,,,,,,,,,,,,,,,,,",
              ",18102,2026-04-06,Сергей Ковалев,4) Заливка Выжигания – 6 ед,,200,,,,,,,,,,,,,,,,,,,,,,,,,,,45175,8,,,,,,,,,,,,,,,,,",
              ",18103,2026-04-06,Сергей Ковалев,5) Остановка процессов – 8 ед,,200,,,,1030,,,,,,,,43.86,,,,,,приват ФОП,,,,,,,,45175.80,,,,,,,,,,,,,,,,,",
              ",18104,2026-04-07,Сергей Ковалев,1) Ритуал создания энергетической пробки,,200,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
              ",18105,2026-04-07,Сергей Ковалев,2) Ритуал создания энергетической пробки,,200,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
              ",18106,2026-04-07,Сергей Ковалев,3) Ритуал создания энергетической пробки,,200,,,,,,,,,,,,,,,,,,,,,,,,,,,45175,8,,,,,,,,,,,,,,,,,",
              ",18107,2026-04-07,Сергей Ковалев,4) Программы-Посвящения,,200,,,,,,,,,,,,,,,,,,,,,,,,,,,45175,8,,,,,,,,,,,,,,,,,",
              ",18108,2026-04-07,Сергей Ковалев,5) Программы Мана,,200,,,,1030,,,,,,,,43.86,,,,,,приват ФОП,,,,,,,\"9216,64\",45175.80,,,,,,,,,,,,,,,,,"
            ].join("\n");
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-06",
        endDate: "2026-04-07"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);

    const movementRows = response.body?.data?.tabs?.movement?.values || [];
    const ordersRows = response.body?.data?.tabs?.orders?.values || [];
    const missingPaymentRow = movementRows.find((row) => row?.[0] === "18101");
    const explicitFopRow = movementRows.find((row) => row?.[0] === "18103");
    const fullyMissingRow = movementRows.find((row) => row?.[0] === "18104");
    const positions = movementRows.map((row) => row?.[0]).filter(Boolean);
    assert.deepEqual(positions, [
      "дата 1",
      "Поменяй даты. Таблица автоматически подтянет записи за выбранный период из исходного файла.",
      "NUMBER",
      "18101",
      "18102",
      "18103",
      "18104",
      "18105",
      "18106",
      "18107",
      "18108",
      "Итого"
    ]);
    assert.equal(missingPaymentRow?.[22], "206");
    assert.equal(missingPaymentRow?.[14], "приват-фоп");
    assert.equal(missingPaymentRow?.[23], "CHECK REQUIRED");
    assert.match(String(missingPaymentRow?.[24] || ""), /provider fee\/net missing|balance not calculated from incomplete source row/i);
    assert.equal(explicitFopRow?.[14], "приват ФОП");
    assert.equal(fullyMissingRow?.[22], "206");
    const clientRows = movementRows.filter((row) => /^\d+$/.test(String(row?.[0] || "")));
    assert.ok(clientRows.length > 0);
    assert.equal(clientRows.every((row) => String(row?.[22] || "").trim()), true);
    assert.equal(clientRows.filter((row) => row?.[2] === "Сергей Ковалев").every((row) => String(row?.[22] || "").trim()), true);
    assert.equal(fullyMissingRow?.[23], "CHECK REQUIRED");
    assert.equal(ordersRows.at(-1)?.[0], "Итого");
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData restores balances and current Plan layout from legacy upstream analytics", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousServiceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const previousFetch = global.fetch;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/example/exec";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-overlay@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "test-access-token" };
          }
        };
      }

      if (value.includes("sheets.googleapis.com") && value.includes("values:batchGet")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              valueRanges: [
                {
                  range: "'Ledger'!A:Q",
                  values: [
                    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                    ["2026-04-24", "business_expense", "Яндекс руб", "", "74669", "RUB", "883.0684", "74669", "business", "", "out", "ledger source", "manual", "fact:2026-04-24:business:Яндекс руб:0", "", "", ""],
                    ["2026-04-24", "exchange_out", "Яндекс руб", "", "74669", "RUB", "883.0684", "74669", "exchange", "", "out", "ledger source", "manual", "fact:exchange:2026-04-24:0", "g1", "", ""],
                    ["2026-04-08", "business_expense", "пейпал дол", "", "15", "USD", "15", "15", "business", "", "out", "ledger source", "manual", "fact:2026-04-08:business:пейпал дол:0", "", "", ""],
                    ["2026-04-10", "exchange_in", "", "пейпал дол", "10", "USD", "10", "10", "exchange", "", "in", "ledger source", "manual", "fact:exchange:2026-04-10:0", "g2", "", ""],
                    ["2026-04-11", "personal_expense", "приват 24-грн", "", "860", "UAH", "20", "860", "food", "", "out", "ledger source", "manual", "fact:2026-04-11:food:приват 24-грн:0", "", "", ""],
                    ["2026-04-12", "exchange_in", "", "приват 24-грн", "4300", "UAH", "100", "4300", "exchange", "", "in", "ledger source", "manual", "fact:exchange:2026-04-12:0", "g3", "", ""],
                    ["2026-04-15", "personal_expense", "приват 24-грн", "", "430", "UAH", "10", "430", "travel", "", "out", "ledger source", "manual", "fact:2026-04-15:travel:приват 24-грн:0", "", "", ""],
                    ["2026-04-15", "personal_expense", "БАНК КАНАДА cad", "", "300", "CAD", "", "300", "travel", "", "out", "ledger source", "manual", "fact:2026-04-15:travel:БАНК КАНАДА cad:0", "", "", ""],
                    ["2026-04-25", "income", "", "пейпал дол", "369", "USD", "369", "369", "servicein", "", "in", "ledger source", "manual", "fact:2026-04-25:servicein:пейпал дол:0", "", "", ""],
                    ["2026-04-25", "income", "", "Бинанс spot", "108.15", "USD", "108.15", "108.15", "servicein", "", "in", "ledger source", "manual", "fact:2026-04-25:servicein:Бинанс spot:0", "", "", ""]
                  ]
                },
                {
                  range: "'Расходы'!A1:V",
                  values: [
                    ["дата", "категория", "яндекс", "пейпал дол", "приват 24-грн"],
                    ["2026-04-24", "business", "74669", "", ""],
                    ["2026-04-24", "exchange", "-74669", "", ""],
                    ["2026-04-08", "business", "", "15", ""],
                    ["2026-04-11", "еда", "", "", "860"],
                    ["2026-04-10", "exchange", "", "10", ""],
                    ["2026-04-12", "обмен", "", "", "4300"],
                    ["2026-04-15", "study", "", "", "430"],
                    ["2026-05-01", "exchange", "", "999", "999"]
                  ]
                },
                {
                  range: "'Остатки'!A1:G",
                  values: [
                    ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
                    ["2026-04-28", "пейпал дол", "648,00", "USD", "", "648", ""],
                    ["2026-04-28", "приват 24-грн", "11480,00", "UAH", "43", "266,9767", ""]
                  ]
                },
                {
                  range: "'Переводы'!A1:G",
                  values: [
                    ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
                    ["2026-04-12", "test", "4300", "UAH", "приват 24-грн", "43", "100"]
                  ]
                },
                {
                  range: "'Комиссии'!A1:D",
                  values: [["дата", "канал", "сумма в долларах", "комментарий"]]
                }
              ]
            };
          }
        };
      }

      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-01",
                  endDate: "2026-04-28",
                  timeZone: "Europe/Kyiv"
                },
                manual: {
                  balances: [],
                  transfers: [],
                  notes: "",
                  checkDate: "2026-04-28",
                  status: "saved",
                  compatibilityMode: "incoming-repository"
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["NUMBER", "DATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"]
                    ]
                  },
                  analytics: {
                    sheetName: "аналитика",
                    values: [
                      ["Личные расходы", "", "", "", "", "", "", "", "", "display_name", "income_source_key", "expense_source_key", "past_usd_source_key", "currency_type"],
                      ["валюта", "now", "spent for business", "spent for food", "spent for house", "spent for study", "spent for travel/ fun", "затраты-мои", "now_usd"],
                      ["Яндекс руб", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0"],
                      ["пейпал дол", "648,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0"],
                      ["приват 24-грн", "11480,00", "8740,00", "2665,00", "0,00", "0,00", "0,00", "0,00", "2665"],
                      ["Бинанс spot", "1689,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0"],
                      ["binance save", "7425,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0"],
                      ["БАНК КАНАДА cad", "10078,00", "1000,00", "190,00", "238,00", "1000,00", "18,00", "300,00", "1746"],
                      ["Итого", "30631,00", "9740,00", "2855,00", "238,00", "1000,00", "18,00", "300,00", "4411"],
                      [],
                      ["Plan"],
                      ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "комиссии", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
                      ["Яндекс руб", "0", "0", "0", "", "0", "0", "0", "0"],
                      ["пейпал дол", "0", "369", "0", "", "369", "0", "0", "369"],
                      ["приват 24-грн", "0", "0", "0", "", "0", "0", "0", "0"],
                      ["Бинанс spot", "0", "108,15", "0", "", "108,15", "0", "0", "108,15"],
                      ["binance save", "0", "0", "0", "", "0", "0", "0", "0"],
                      ["БАНК КАНАДА cad", "0", "0", "0", "", "0", "0", "0", "0"],
                      ["Итого", "0", "477,15", "0", "", "477,15", "0", "0", "477,15"],
                      [],
                      ["БАЛАНС"],
                      ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
                      ["пейпал дол", "1849", "0", "-1849", "369", "-2218", "0", "-2218", "369"],
                      ["приват 24-грн", "123,3789954", "0", "-123,3789954", "0", "-123,3789954", "2917,2", "-3040,578995", "0"],
                      ["Бинанс spot", "904", "0", "-904", "108,15", "-1012,15", "0", "-1012,15", "108,15"],
                      ["binance save", "7421", "0", "-7421", "0", "-7421", "0", "-7421", "0"],
                      ["БАНК КАНАДА cad", "8891,1", "0", "-8891,1", "0", "-8891,1", "0", "-8891,1", "0"],
                      ["Итого", "19188,4789954", "0", "-19188,4789954", "477,15", "-19665,6289954", "2917,2", "-22582,828995", "477,15"]
                    ]
                  },
                  orders: {
                    sheetName: "список моих заказы",
                    values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]]
                  }
                }
              }
            });
          }
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return [
              ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
              ",,,,,,,,-,,,,-,-,,,курс,курс,курс,3%,3%,3%,3%,,,-,План,План,План,доп,Реал,Реал,Реал,Реал,-,дата,время,-,-,-,-,-,,,,,-,-,-,-,-",
              ",,Дата ,Клиент,Название заказа,Коммент/ остаток,Прайс база,25% акция,кол-во,всего,пр+3%,,%а,%б,,,руб,евр,грн,к-р,к-гр,к-р,к-гр,к-евро,метод оплаты,валюта,дол,руб,грн, +,дол,евро,руб,грн,КАРТА грн,дата,время,хвост,готовность ,ОТЗЫВ?,отчет,Тип/карта,руб,грн,,,Примечание,ВК,№К,Отзыв был?,емейл"
            ].join("\n");
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-01",
        endDate: "2026-04-28"
      }
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);

    const balances = response.body?.data?.manual?.balances || [];
    assert.ok(balances.length > 0);
    assert.equal(balances.find((row) => row.channel === "пейпал дол")?.amount, "648,00");

    const analyticsRows = response.body?.data?.tabs?.analytics?.values || [];
    const planIndex = analyticsRows.findIndex((row) => row?.[0] === "Plan");
    const balanceIndex = analyticsRows.findIndex((row) => row?.[0] === "БАЛАНС");
    assert.deepEqual(analyticsRows[planIndex + 1], [
      "валюта",
      "пришло в местной валюте",
      "пришло в долларах",
      "затраты-мои",
      "затраты-мои-дол",
      "ушло",
      "обмен",
      "обмен_usd",
      "план-рост",
      "plan-profit"
    ]);
    assert.equal(analyticsRows[planIndex + 1].includes("комиссии"), false);
    const paypalPlanRow = analyticsRows.slice(planIndex + 2, balanceIndex).find((row) => row?.[0] === "пейпал дол");
    const privatPlanRow = analyticsRows.slice(planIndex + 2, balanceIndex).find((row) => row?.[0] === "приват 24-грн");
    const yandexPlanRow = analyticsRows.slice(planIndex + 2, balanceIndex).find((row) => row?.[0] === "Яндекс руб");
    assert.equal(yandexPlanRow?.[3], "74669,0000");
    assert.equal(yandexPlanRow?.[4], "883,0684");
    assert.equal(yandexPlanRow?.[6], "-74669,0000");
    assert.equal(yandexPlanRow?.[7], "-883,0684");
    assert.equal(yandexPlanRow?.[8], "-883,0684");
    assert.equal(yandexPlanRow?.[9], "-1766,1368");
    assert.equal(paypalPlanRow?.[6], "10,0000");
    assert.equal(paypalPlanRow?.[7], "10,0000");
    assert.equal(paypalPlanRow?.[3], "15,0000");
    assert.equal(paypalPlanRow?.[4], "15,0000");
    assert.equal(paypalPlanRow?.[8], "379,0000");
    assert.equal(paypalPlanRow?.[9], "364,0000");
    assert.equal(privatPlanRow?.[3], "1290,0000");
    assert.equal(privatPlanRow?.[4], "30,0000");
    assert.equal(privatPlanRow?.[6], "4300,0000");
    assert.equal(privatPlanRow?.[7], "100,0000");
    assert.equal(privatPlanRow?.[8], "100,0000");
    assert.equal(privatPlanRow?.[9], "70,0000");
    const canadaPlanRow = analyticsRows.slice(planIndex + 2, balanceIndex).find((row) => row?.[0] === "БАНК КАНАДА cad");
    assert.equal(canadaPlanRow?.[3], "300,0000");
    const totalPlanRow = analyticsRows.slice(planIndex + 2, balanceIndex).find((row) => row?.[0] === "Итого");
    assert.equal(totalPlanRow?.[3], "76274,0000");
    assert.equal(totalPlanRow?.[4], "1150,0684");
    assert.equal(totalPlanRow?.[6], "-70359,0000");
    assert.equal(totalPlanRow?.[7], "-773,0684");
    assert.equal(totalPlanRow?.[8], "-295,9184");
    assert.equal(totalPlanRow?.[9], "-1445,9868");

    const findBalanceRow = (channel) =>
      analyticsRows.slice(balanceIndex + 2).find((row) => row?.[0] === channel);
    assert.equal(findBalanceRow("пейпал дол")?.[2], "648,0000");
    assert.notEqual(findBalanceRow("приват 24-грн")?.[2], "0,0000");
    assert.equal(findBalanceRow("Бинанс spot")?.[2], "1689,0000");
    assert.equal(findBalanceRow("binance save")?.[2], "7425,0000");
    assert.equal(findBalanceRow("БАНК КАНАДА cad")?.[2], "7457,7200");

    const totalBalanceRow = findBalanceRow("Итого");
    assert.notEqual(totalBalanceRow?.[2], "0,0000");
    const ostatokRow = findBalanceRow("ОСТАТОК");
    const vsegoRow = findBalanceRow("ВСЕГО");
    assert.equal(ostatokRow?.[1], totalBalanceRow?.[1]);
    assert.equal(ostatokRow?.[2], "");
    assert.equal(vsegoRow?.[1], "");
    assert.equal(
      parseFloat(String(vsegoRow?.[2]).replace(",", ".")),
      parseFloat(String(totalBalanceRow?.[1]).replace(",", ".")) +
        parseFloat(String(totalBalanceRow?.[2]).replace(",", "."))
    );
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
    if (previousServiceEmail === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousServiceEmail;
    }
    if (previousPrivateKey === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousPrivateKey;
    }
  }
});

test("GET getDashboardData keeps manual ledger overlay when amount_net is missing", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousServiceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const previousFetch = global.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-overlay@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "test-access-token" };
          }
        };
      }
      if (value.includes("sheets.googleapis.com") && value.includes("values:batchGet")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              valueRanges: [
                {
                  range: "'Ledger'!A:O",
                  values: [
                    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                    ["2026-04-25", "income", "", "paypal usd", "369", "USD", "369", "serviceincome", "", "", "income", "raw-1", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
                  ]
                },
                {
                  range: "'Расходы'!A1:Z10",
                  values: [["дата", "категория", "Яндекс руб"]]
                },
                {
                  range: "'Остатки'!A1:G",
                  values: [["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"]]
                },
                {
                  range: "'Переводы'!A1:G",
                  values: [["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"]]
                },
                {
                  range: "'Комиссии'!A1:D",
                  values: [["дата", "канал", "сумма в долларах", "комментарий"]]
                }
              ]
            };
          }
        };
      }
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-01",
                  endDate: "2026-04-28",
                  timeZone: "Europe/Kyiv"
                },
                manual: {
                  balances: [],
                  transfers: [],
                  notes: "",
                  checkDate: "2026-04-28",
                  status: "saved",
                  compatibilityMode: "incoming-repository"
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [["NUMBER", "DATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"]]
                  },
                  analytics: {
                    sheetName: "аналитика",
                    values: [
                      ["Личные расходы", "", "", "", "", "", "", "", "", "display_name", "income_source_key", "expense_source_key", "past_usd_source_key", "currency_type"],
                      ["валюта", "now", "spent for business", "затраты-мои", "now_usd"],
                      ["пейпал дол", "648,00", "0,00", "0,00", "648"],
                      [],
                      ["Plan"],
                      ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "комиссии", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
                      ["пейпал дол", "0", "369", "0", "", "369", "0", "0", "369"],
                      ["Итого", "0", "369", "0", "", "369", "0", "0", "369"],
                      [],
                      ["БАЛАНС"],
                      ["валюта", "БЫЛО", "СТАЛО", "РОСТ", "Plan Profit", "разница1", "КОМИССИЯ", "доп расходы", "БАЛАНС", "Extra"],
                      ["пейпал дол", "1849", "0", "-1849", "369", "-2218", "0", "-2218", "369"]
                    ]
                  }
                }
              }
            });
          }
        };
      }
      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return { ok: true, status: 200, async text() { return ""; } };
      }
      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler({
      method: "GET",
      query: { action: "getDashboardData", startDate: "2026-04-01", endDate: "2026-04-28" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.match((response.body?.data?.manual?.warnings || []).join(" | "), /amount_net.*balance was not calculated/);
    assert.equal(response.body?.data?.manual?.schema, "ledger-v1");
    assert.equal((response.body?.data?.manual?.ledgerV2Rows || []).length, 1);
    assert.equal((response.body?.data?.manual?.operations || []).length, 1);
    assert.equal(response.body?.data?.manual?.operations?.[0]?.toChannel, "пейпал дол");
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
    if (previousServiceEmail === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousServiceEmail;
    }
    if (previousPrivateKey === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousPrivateKey;
    }
  }
});

test("GET getDashboardData keeps ledger income fallback when raw exchange amount_usd is derived", async () => {
  const previous = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousServiceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const previousFetch = global.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-overlay@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "test-access-token" };
          }
        };
      }
      if (value.includes("sheets.googleapis.com") && value.includes("values:batchGet")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              valueRanges: [
                {
                  range: "'Ledger'!A:P",
                  values: [
                    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "source"],
                    ["2026-05-01", "income", "", "yoomoney", "2500", "RUB", "25", "2500", "income", "mcp"],
                    ["2026-05-02", "exchange_out", "Яндекс руб", "Бинанс spot", "0", "RUB", "", "3000", "exchange", "manual"],
                  ]
                },
                { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
                { range: "'Остатки'!A1:G", values: [["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"]] },
                { range: "'Переводы'!A1:G", values: [["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"]] },
                { range: "'Комиссии'!A1:D", values: [["дата", "канал", "сумма в долларах", "комментарий"]] }
              ]
            };
          }
        };
      }
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-05-01",
                  endDate: "2026-05-31",
                  timeZone: "Europe/Kyiv"
                },
                manual: {
                  balances: [],
                  transfers: [],
                  notes: "",
                  checkDate: "2026-05-31",
                  status: "saved",
                  compatibilityMode: "incoming-repository"
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [["NUMBER", "DATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE"]]
                  },
                  analytics: {
                    sheetName: "аналитика",
                    values: [
                      ["Plan"],
                      ["валюта", "пришло в местной валюте", "пришло в долларах", "затраты-мои", "затраты-мои-дол", "ушло", "обмен", "обмен_usd", "план-рост", "plan-profit"],
                      ["Яндекс руб", "0", "0", "0", "0", "0", "0", "0", "0", "0"]
                    ]
                  }
                }
              }
            });
          }
        };
      }
      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        return { ok: true, status: 200, async text() { return ""; } };
      }
      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler({
      method: "GET",
      query: { action: "getDashboardData", startDate: "2026-05-01", endDate: "2026-05-31" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.data?.manual?.operations?.length, 2);
    assert.doesNotMatch((response.body?.data?.manual?.warnings || []).join("\n"), /exchange row.*amount_usd/i);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["Яндекс руб"]?.realNetUsd, 25);
    assert.equal(response.body?.data?.realIncome?.summaryTotals?.realNetUsd, 25);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    if (previousServiceEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousServiceEmail;
    if (previousPrivateKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousPrivateKey;
  }
});

test("GET getDashboardData adds real income payload and movement net-income column", async () => {
  const previousUpstream = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousPayPalClientId = process.env.PAYPAL_CLIENT_ID;
  const previousPayPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const previousWiseToken = process.env.WISE_API_TOKEN;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.PAYPAL_CLIENT_ID = "client";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  process.env.WISE_API_TOKEN = "wise-token";

  const makeSourceRow = ({
    number,
    date,
    client,
    service,
    priceBase,
    accruedPlus,
    paymentMethod,
    receivedUsd,
  }) => {
    const row = new Array(51).fill("");
    row[1] = number;
    row[2] = date;
    row[3] = client;
    row[4] = service;
    row[6] = String(priceBase);
    row[9] = String(priceBase);
    row[10] = String(accruedPlus);
    row[24] = paymentMethod;
    row[30] = String(receivedUsd);
    return row;
  };

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-01",
                  endDate: "2026-04-30",
                  timeZone: "Europe/Kiev",
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.04.2026", "дата 2", "30.04.2026"],
                      [""],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACTION", "QTY", "ACCRUED", "ACCRUED +3%", "70% OF ACCRUED", "70% OF +3%", "RUB RATE", "UAH RATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ", "ПОЛУЧЕНО В РУБЛЯХ", "ПОЛУЧЕНО В ГРИВНАХ", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE", "STATUS", "REVIEW NOTE"],
                      ["ИТОГО", "", "", "", "", "300", "", "", "300", "309", "210", "216,3", "", "", "", "300", "", "", "300", "0"],
                      [],
                      ["показатели", "значение"],
                      ["4) получено в долларах", "300,0000"],
                    ],
                  },
                  orders: {
                    sheetName: "список моих заказы",
                    values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]],
                  },
                },
              },
            });
          },
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        const rows = [
          new Array(51).fill(""),
          new Array(51).fill(""),
          new Array(51).fill(""),
          makeSourceRow({
            number: "18111",
            date: "2026-04-07",
            client: "Инна Устименко",
            service: "Программа Харизма",
            priceBase: 200,
            accruedPlus: 206,
            paymentMethod: "сайт, дол, пэйпэл",
            receivedUsd: 315,
          }),
          makeSourceRow({
            number: "18112",
            date: "2026-04-11",
            client: "William Test",
            service: "Wise payment",
            priceBase: 950,
            accruedPlus: 978.5,
            paymentMethod: "трансервайз дол",
            receivedUsd: 1210.25,
          }),
        ];
        return {
          ok: true,
          status: 200,
          async text() {
            return rows.map((row) => row.join(",")).join("\n");
          },
        };
      }

      if (value.endsWith("/v1/oauth2/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "paypal-token" };
          },
        };
      }

      if (value.includes("/v1/reporting/transactions")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              total_pages: 1,
              transaction_details: [
                {
                  transaction_info: {
                    transaction_id: "PAYPAL-1",
                    transaction_initiation_date: "2026-04-07T10:00:00Z",
                    transaction_amount: { value: "324", currency_code: "USD" },
                    fee_amount: { value: "-12.94", currency_code: "USD" },
                  },
                },
              ],
            };
          },
        };
      }

      if (value.endsWith("/v2/profiles")) {
        return {
          ok: true,
          async json() {
            return [{ id: 123 }];
          },
        };
      }

      if (value.includes("/v4/profiles/123/balances")) {
        return {
          ok: true,
          async json() {
            return [{ id: "balance-1", currency: "EUR" }];
          },
        };
      }

      if (value.includes("/v1/profiles/123/balance-statements/balance-1/statement.json")) {
        return {
          ok: true,
          async json() {
            return {
              transactions: [
                {
                  type: "CREDIT",
                  date: "2026-04-11T09:00:00.000Z",
                  referenceNumber: "WISE-1",
                  amount: { value: "1210.25", currency: "USD" },
                  amountUsd: "978.5",
                  totalFees: { value: "231.75", currency: "USD" },
                  details: { description: "Client payment", type: "TRANSFER" },
                },
              ],
            };
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-01",
        endDate: "2026-04-30",
      },
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    const movementHeader = response.body?.data?.tabs?.movement?.values?.[2] || [];
    assert.equal(movementHeader[18], "ОПЛАЧЕНО КЛИЕНТОМ USD");
    assert.equal(movementHeader[19], "КОМИССИЯ ПРОВАЙДЕРА USD");
    assert.equal(movementHeader[20], "ДОШЛО ДО НАС USD");
    assert.equal(movementHeader[21], "ДОШЛО ФАКТ / PROVIDER NET");
    const paypalRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18111");
    const wiseRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18112");
    assert.equal(paypalRow?.[18], "315");
    assert.equal(paypalRow?.[19], "12,94");
    assert.equal(paypalRow?.[20], "311,06");
    assert.equal(paypalRow?.[21], "311,06");
    assert.equal(paypalRow?.[22], "-105,06");
    assert.equal(wiseRow?.[18], "1210,25");
    assert.equal(wiseRow?.[19], "231,75");
    assert.equal(wiseRow?.[20], "978,5");
    assert.equal(wiseRow?.[21], "978,5");
    assert.equal(wiseRow?.[22], "0");
    assert.equal(response.body?.data?.realIncome?.rowMatches?.length, 2);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["пейпал дол"]?.realNetUsd, 311.06);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["трансервайз дол"]?.realNetUsd, 978.5);
  } finally {
    global.fetch = previousFetch;
    if (previousUpstream === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previousUpstream;
    if (previousPayPalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousPayPalClientId;
    if (previousPayPalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = previousPayPalClientSecret;
    if (previousWiseToken === undefined) delete process.env.WISE_API_TOKEN;
    else process.env.WISE_API_TOKEN = previousWiseToken;
  }
});

test("GET getDashboardData keeps unmatched Wise provider income out of service income summary", async () => {
  const previousUpstream = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousWiseToken = process.env.WISE_API_TOKEN;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.WISE_API_TOKEN = "wise-token";

  const makeSourceRow = ({
    number,
    date,
    client,
    service,
    priceBase,
    accruedPlus,
    paymentMethod,
    receivedUsd,
  }) => {
    const row = new Array(51).fill("");
    row[1] = number;
    row[2] = date;
    row[3] = client;
    row[4] = service;
    row[6] = String(priceBase);
    row[9] = String(priceBase);
    row[10] = String(accruedPlus);
    row[24] = paymentMethod;
    row[30] = String(receivedUsd);
    return row;
  };

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-01",
                  endDate: "2026-04-30",
                  timeZone: "Europe/Kiev",
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.04.2026", "дата 2", "30.04.2026"],
                      [""],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACTION", "QTY", "ACCRUED", "ACCRUED +3%", "70% OF ACCRUED", "70% OF +3%", "RUB RATE", "UAH RATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ", "ПОЛУЧЕНО В РУБЛЯХ", "ПОЛУЧЕНО В ГРИВНАХ", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE", "STATUS", "REVIEW NOTE"],
                      ["ИТОГО", "", "", "", "", "950", "", "", "950", "978,5", "665", "684,95", "", "", "", "978,5", "", "", "978,5", "0"],
                      [],
                      ["показатели", "значение"],
                      ["4) получено в долларах", "978,5000"],
                    ],
                  },
                  orders: {
                    sheetName: "список моих заказы",
                    values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]],
                  },
                },
              },
            });
          },
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        const rows = [
          new Array(51).fill(""),
          new Array(51).fill(""),
          new Array(51).fill(""),
          makeSourceRow({
            number: "18140",
            date: "2026-04-11",
            client: "Wise Matched",
            service: "Matched payment",
            priceBase: 950,
            accruedPlus: 978.5,
            paymentMethod: "трансервайз дол",
            receivedUsd: 978.5,
          }),
        ];
        return {
          ok: true,
          status: 200,
          async text() {
            return rows.map((row) => row.join(",")).join("\n");
          },
        };
      }

      if (value.endsWith("/v2/profiles")) {
        return {
          ok: true,
          async json() {
            return [{ id: 123 }];
          },
        };
      }

      if (value.includes("/v4/profiles/123/balances")) {
        return {
          ok: true,
          async json() {
            return [{ id: "balance-1", currency: "USD" }];
          },
        };
      }

      if (value.includes("/v1/profiles/123/balance-statements/balance-1/statement.json")) {
        return {
          ok: true,
          async json() {
            return {
              transactions: [
                {
                  type: "CREDIT",
                  date: "2026-04-11T09:00:00.000Z",
                  referenceNumber: "WISE-MATCHED",
                  amount: { value: "1210.25", currency: "USD" },
                  amountUsd: "978.5",
                  details: { description: "Matched movement", type: "TRANSFER" },
                },
                {
                  type: "CREDIT",
                  date: "2026-04-18T09:00:00.000Z",
                  referenceNumber: "WISE-UNMATCHED",
                  amount: { value: "196.5", currency: "USD" },
                  amountUsd: "196.5",
                  details: { description: "No matching movement", type: "TRANSFER" },
                },
              ],
            };
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-01",
        endDate: "2026-04-30",
      },
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.data?.realIncome?.rowMatches?.length, 1);
    assert.equal(response.body?.data?.realIncome?.matchedEntries?.length, 1);
    assert.equal(response.body?.data?.realIncome?.unmatchedEntries?.length, 1);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["трансервайз дол"]?.realNetUsd, 978.5);
    assert.equal(response.body?.data?.realIncome?.summaryTotals?.realNetUsd, 978.5);
    assert.equal(response.body?.data?.realIncome?.serviceOrderSummaryByChannel?.["трансервайз дол"]?.realNetUsd, 978.5);
    assert.equal(response.body?.data?.realIncome?.serviceOrderSummaryTotals?.realNetUsd, 978.5);
    assert.equal(response.body?.data?.realIncome?.matchedEntries?.[0]?.realNetUsd, 978.5);
    assert.equal(response.body?.data?.realIncome?.unmatchedEntries?.[0]?.realNetUsd, 196.5);
    assert.equal(response.body?.data?.realIncome?.unmatchedSummaryByChannel?.["трансервайз дол"]?.realNetUsd, 196.5);
    assert.equal(response.body?.data?.realIncome?.allSummaryByChannel?.["трансервайз дол"]?.realNetUsd, 1175);
    assert.match(response.body?.data?.realIncome?.warnings?.join("\n") || "", /WISE-UNMATCHED: no movement row match/);
    assert.match(response.body?.data?.realIncome?.warnings?.join("\n") || "", /unmatched provider income: трансервайз дол 196,5 USD net/i);
  } finally {
    global.fetch = previousFetch;
    if (previousUpstream === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previousUpstream;
    if (previousWiseToken === undefined) delete process.env.WISE_API_TOKEN;
    else process.env.WISE_API_TOKEN = previousWiseToken;
  }
});

test("GET getDashboardData splits service income from refunds exchanges and unmatched provider inflows", async () => {
  const previousUpstream = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousPayPalClientId = process.env.PAYPAL_CLIENT_ID;
  const previousPayPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const previousWiseToken = process.env.WISE_API_TOKEN;
  const previousBinanceApiKey = process.env.BINANCE_API_KEY;
  const previousBinanceApiSecret = process.env.BINANCE_API_SECRET;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.PAYPAL_CLIENT_ID = "client";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  process.env.WISE_API_TOKEN = "wise-token";
  process.env.BINANCE_API_KEY = "binance-key";
  process.env.BINANCE_API_SECRET = "binance-secret";

  const makeSourceRow = ({ number, date, client, service, priceBase, accruedPlus, paymentMethod, receivedUsd }) => {
    const row = new Array(51).fill("");
    row[1] = number;
    row[2] = date;
    row[3] = client;
    row[4] = service;
    row[6] = String(priceBase);
    row[9] = String(priceBase);
    row[10] = String(accruedPlus);
    row[24] = paymentMethod;
    row[30] = String(receivedUsd);
    return row;
  };

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: { startDate: "2026-05-01", endDate: "2026-05-31", timeZone: "Europe/Kyiv" },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.05.2026", "дата 2", "31.05.2026"],
                      [""],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACTION", "QTY", "ACCRUED", "ACCRUED +3%", "70% OF ACCRUED", "70% OF +3%", "RUB RATE", "UAH RATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ", "ПОЛУЧЕНО В РУБЛЯХ", "ПОЛУЧЕНО В ГРИВНАХ", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE", "STATUS", "REVIEW NOTE"],
                      ["ИТОГО", "", "", "", "", "300", "", "", "300", "309", "210", "216,3", "", "", "", "311,06", "", "", "311,06", "0"],
                    ],
                  },
                  orders: { sheetName: "список моих заказы", values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]] },
                },
              },
            });
          },
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        const rows = [
          new Array(51).fill(""),
          new Array(51).fill(""),
          new Array(51).fill(""),
          makeSourceRow({
            number: "18111",
            date: "2026-05-07",
            client: "Инна Устименко",
            service: "Программа Харизма",
            priceBase: 300,
            accruedPlus: 309,
            paymentMethod: "сайт, дол, пэйпэл",
            receivedUsd: 315,
          }),
          makeSourceRow({
            number: "18112",
            date: "2026-05-08",
            client: "Валерия Лозина",
            service: "Service paid to Monobank card",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "карта Андрей",
            receivedUsd: 103,
          }),
          makeSourceRow({
            number: "18113",
            date: "2026-05-09",
            client: "Надежда Юзова",
            service: "Service paid through site RUB",
            priceBase: 50,
            accruedPlus: 54.5,
            paymentMethod: "сайт, рубли",
            receivedUsd: 54.5,
          }),
          makeSourceRow({
            number: "18164",
            date: "2026-05-14",
            client: "Crypto top-up",
            service: "Deposit should not count as service payment",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "Бинанс spot",
            receivedUsd: 103,
          }),
        ];
        return { ok: true, status: 200, async text() { return rows.map((row) => row.join(",")).join("\n"); } };
      }

      if (value.endsWith("/v1/oauth2/token")) {
        return { ok: true, status: 200, async json() { return { access_token: "paypal-token" }; } };
      }
      if (value.includes("/v1/reporting/transactions")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              total_pages: 1,
              transaction_details: [{
                transaction_info: {
                  transaction_id: "PAYPAL-SERVICE-1",
                  transaction_initiation_date: "2026-05-07T10:00:00Z",
                  transaction_amount: { value: "324", currency_code: "USD" },
                  fee_amount: { value: "-12.94", currency_code: "USD" },
                },
              }],
            };
          },
        };
      }

      if (value.endsWith("/v2/profiles")) return { ok: true, async json() { return [{ id: 123 }]; } };
      if (value.includes("/v4/profiles/123/balances")) return { ok: true, async json() { return [{ id: "balance-eur", currency: "EUR" }]; } };
      if (value.includes("/v1/profiles/123/balance-statements/balance-eur/statement.json")) {
        return {
          ok: true,
          async json() {
            return {
              transactions: [
                {
                  type: "CREDIT",
                  date: "2026-05-09T09:00:00.000Z",
                  referenceNumber: "WISE-HOTEL-REFUND",
                  amount: { value: "100", currency: "EUR" },
                  amountUsd: "116",
                  totalFees: { value: "0", currency: "EUR" },
                  details: { description: "Hotel refund", type: "REFUND" },
                },
                {
                  type: "CREDIT",
                  date: "2026-05-18T09:00:00.000Z",
                  referenceNumber: "WISE-UNMATCHED-MAY",
                  amount: { value: "50", currency: "EUR" },
                  amountUsd: "58",
                  totalFees: { value: "0", currency: "EUR" },
                  details: { description: "Unmatched incoming transfer", type: "TRANSFER" },
                },
              ],
            };
          },
        };
      }

      if (value.includes("/api/v3/account")) return { ok: true, status: 200, async text() { return JSON.stringify({ balances: [] }); } };
      if (value.includes("/sapi/v1/capital/deposit/hisrec")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify([{
              id: "5046711607171328256",
              amount: "103",
              coin: "USDT",
              completeTime: "2026-05-14T13:37:41Z",
              status: 1,
              txId: "0x4b98d74ed29a7e451dadf131e77e5032bca43d0add56438ef4ee91b5aef26640",
            }]);
          },
        };
      }
      if (value.includes("/sapi/v1/capital/withdraw/history")) return { ok: true, status: 200, async text() { return "[]"; } };
      if (value.includes("/sapi/v1/pay/transactions")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              data: [{
                transactionId: "BINANCE-YANDEX-FUNDING",
                transactionTime: 1778198400000,
                amount: "250",
                currency: "USDT",
                orderType: "C2C",
                counterparty: "Yandex RUB -> Binance funding",
                status: "SUCCESS",
              }],
            });
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler({ method: "GET", query: { action: "getDashboardData", startDate: "2026-05-01", endDate: "2026-05-31" } }, response);

    const realIncome = response.body?.data?.realIncome;
    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(realIncome?.summaryByChannel?.["пейпал дол"]?.realNetUsd, 311.06);
    assert.equal(realIncome?.summaryByChannel?.["трансервайз евро"]?.realNetUsd, 0);
    assert.equal(realIncome?.summaryByChannel?.["Бинанс spot"]?.realNetUsd, 0);
    assert.equal(realIncome?.summaryByChannel?.["Binance funding"]?.realNetUsd, 0);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["пейпал дол"]?.realNetUsd, 311.06);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["монобанк грн"]?.realNetUsd, 103);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["Яндекс руб"]?.realNetUsd, 54.5);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["трансервайз евро"]?.realNetUsd, 0);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["Бинанс spot"]?.realNetUsd, 0);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["Binance funding"]?.realNetUsd, 0);
    assert.equal(realIncome?.serviceOrderSummaryByChannel?.["пейпал дол"]?.realNetUsd, 311.06);
    assert.equal(realIncome?.serviceOrderSummaryByChannel?.["трансервайз евро"]?.realNetUsd, 0);
    assert.equal(realIncome?.serviceOrderSummaryByChannel?.["Бинанс spot"]?.realNetUsd, 0);
    assert.equal(realIncome?.serviceOrderSummaryByChannel?.["Binance funding"]?.realNetUsd, 0);
    assert.equal(realIncome?.refundSummaryByChannel?.["трансервайз евро"]?.realNetUsd, 116);
    assert.equal(realIncome?.exchangeSummaryByChannel?.["Бинанс spot"]?.realNetUsd, 103);
    assert.equal(realIncome?.exchangeSummaryByChannel?.["Binance funding"]?.realNetUsd, 250);
    assert.equal(realIncome?.unmatchedSummaryByChannel?.["трансервайз евро"]?.realNetUsd, 58);
    assert.equal(realIncome?.allSummaryByChannel?.["пейпал дол"]?.realNetUsd, 311.06);
    assert.equal(realIncome?.allSummaryByChannel?.["трансервайз евро"]?.realNetUsd, 174);
    assert.equal(realIncome?.allSummaryByChannel?.["Бинанс spot"]?.realNetUsd, 103);
    assert.equal(realIncome?.allSummaryByChannel?.["Binance funding"]?.realNetUsd, 250);
    assert.equal(realIncome?.summaryTotals?.realNetUsd, 311.06);
    assert.equal(realIncome?.servicePaymentSummaryTotals?.realNetUsd, 468.56);
    assert.equal(realIncome?.serviceOrderSummaryTotals?.realNetUsd, 311.06);
    assert.equal(realIncome?.allSummaryTotals?.realNetUsd, 838.06);
    assert.equal(realIncome?.refundEntries?.length, 1);
    assert.equal(realIncome?.exchangeEntries?.length, 2);
    assert.equal(realIncome?.unmatchedEntries?.length, 1);
    const paypalRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18111");
    assert.equal(paypalRow?.[20], "311,06");
    assert.equal(paypalRow?.[22], "-2,06");
  } finally {
    global.fetch = previousFetch;
    if (previousUpstream === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previousUpstream;
    if (previousPayPalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousPayPalClientId;
    if (previousPayPalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = previousPayPalClientSecret;
    if (previousWiseToken === undefined) delete process.env.WISE_API_TOKEN;
    else process.env.WISE_API_TOKEN = previousWiseToken;
    if (previousBinanceApiKey === undefined) delete process.env.BINANCE_API_KEY;
    else process.env.BINANCE_API_KEY = previousBinanceApiKey;
    if (previousBinanceApiSecret === undefined) delete process.env.BINANCE_API_SECRET;
    else process.env.BINANCE_API_SECRET = previousBinanceApiSecret;
  }
});

test("GET getDashboardData marks PayPal rows as needs verification when provider net is unavailable", async () => {
  const previousUpstream = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousPayPalClientId = process.env.PAYPAL_CLIENT_ID;
  const previousPayPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.PAYPAL_CLIENT_ID = "client";
  process.env.PAYPAL_CLIENT_SECRET = "secret";

  const makeSourceRow = ({ number, date, client, service, priceBase, accruedPlus, paymentMethod, receivedUsd }) => {
    const row = new Array(51).fill("");
    row[1] = number;
    row[2] = date;
    row[3] = client;
    row[4] = service;
    row[6] = String(priceBase);
    row[9] = String(priceBase);
    row[10] = String(accruedPlus);
    row[24] = paymentMethod;
    if (receivedUsd !== undefined) row[30] = String(receivedUsd);
    return row;
  };

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: {
                  startDate: "2026-04-01",
                  endDate: "2026-04-30",
                  timeZone: "Europe/Kiev",
                },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.04.2026", "дата 2", "30.04.2026"],
                      [""],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACTION", "QTY", "ACCRUED", "ACCRUED +3%", "70% OF ACCRUED", "70% OF +3%", "RUB RATE", "UAH RATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ", "ПОЛУЧЕНО В РУБЛЯХ", "ПОЛУЧЕНО В ГРИВНАХ", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE", "STATUS", "REVIEW NOTE"],
                    ],
                  },
                  orders: {
                    sheetName: "список моих заказы",
                    values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]],
                  },
                },
              },
            });
          },
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        const rows = [
          new Array(51).fill(""),
          new Array(51).fill(""),
          new Array(51).fill(""),
          makeSourceRow({
            number: "18129",
            date: "2026-04-18",
            client: "Олеся Сандырева",
            service: "Динамика",
            priceBase: 100,
            accruedPlus: 206,
            paymentMethod: "сайт, дол, пэйпэл",
            receivedUsd: 103,
          }),
          makeSourceRow({
            number: "18130",
            date: "2026-04-18",
            client: "Нет Оплаты",
            service: "No payment",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "сайт, дол, пэйпэл",
          }),
          makeSourceRow({
            number: "18131",
            date: "2026-04-18",
            client: "Сергей Ковалев",
            service: "No received 515",
            priceBase: 500,
            accruedPlus: 515,
            paymentMethod: "сайт, дол, пэйпэл",
          }),
          makeSourceRow({
            number: "18132",
            date: "2026-04-18",
            client: "Сергей Ковалев",
            service: "Empty Kovalev payment defaults to Privat FOP",
            priceBase: 500,
            accruedPlus: 515,
            paymentMethod: "",
            receivedUsd: 515,
          }),
          makeSourceRow({
            number: "18149",
            date: "2026-04-20",
            client: "Инна Устименко",
            service: "Empty payment channel defaults to PayPal",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "",
            receivedUsd: 103,
          }),
          makeSourceRow({
            number: "18151",
            date: "2026-04-20",
            client: "Инна Устименко",
            service: "Explicit non-empty channel is preserved",
            priceBase: 5,
            accruedPlus: 5.15,
            paymentMethod: "сайт, дол",
            receivedUsd: 115.5,
          }),
        ];
        return {
          ok: true,
          status: 200,
          async text() {
            return rows.map((row) => row.join(",")).join("\n");
          },
        };
      }

      if (value.endsWith("/v1/oauth2/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "paypal-token" };
          },
        };
      }

      if (value.includes("/v1/reporting/transactions")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              total_pages: 1,
              transaction_details: [
                {
                  transaction_info: {
                    transaction_id: "PAYPAL-NOFEE-1",
                    transaction_initiation_date: "2026-04-18T10:00:00Z",
                    transaction_amount: { value: "206", currency_code: "USD" },
                  },
                },
              ],
            };
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const request = {
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-04-01",
        endDate: "2026-04-30",
      },
    };
    const response = createResponseRecorder();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    const paypalRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18129");
    assert.equal(paypalRow?.[18], "103");
    assert.equal(paypalRow?.[19], "");
    assert.equal(paypalRow?.[20], "");
    assert.equal(paypalRow?.[21], "");
    assert.equal(paypalRow?.[22], "0");
    assert.equal(paypalRow?.[23], "NEEDS VERIFICATION");
    assert.match(String(paypalRow?.[24] || ""), /needs verification/i);
    assert.match(String(paypalRow?.[24] || ""), /provider fee\/net missing/i);
    const noPaymentRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18130");
    assert.equal(noPaymentRow?.[18], "");
    assert.equal(noPaymentRow?.[22], "103");
    const kovalevNoPaymentRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18131");
    assert.equal(kovalevNoPaymentRow?.[2], "Сергей Ковалев");
    assert.equal(kovalevNoPaymentRow?.[18], "");
    assert.equal(kovalevNoPaymentRow?.[22], "515");
    const kovalevDefaultedRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18132");
    assert.equal(kovalevDefaultedRow?.[14], "приват-фоп");
    assert.equal(kovalevDefaultedRow?.[18], "515");
    const innaDefaultedRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18149");
    assert.equal(innaDefaultedRow?.[14], "пейпал дол");
    assert.equal(innaDefaultedRow?.[18], "103");
    assert.doesNotMatch(String(innaDefaultedRow?.[24] || ""), /payment channel missing/i);
    const innaExplicitRow = response.body?.data?.tabs?.movement?.values?.find((row) => row?.[0] === "18151");
    assert.equal(innaExplicitRow?.[14], "сайт, дол");
    assert.equal(innaExplicitRow?.[18], "115,5");
    const clientRows = response.body?.data?.tabs?.movement?.values?.filter((row) => /^\d+$/.test(String(row?.[0] || ""))) || [];
    assert.equal(clientRows.every((row) => String(row?.[22] || "").trim()), true);
    const realIncomeWarnings = (response.body?.data?.realIncome?.warnings || []).join(" | ");
    assert.match(realIncomeWarnings, /needs verification/i);
    assert.match(realIncomeWarnings, /missing fee on income transaction PAYPAL-NOFEE-1/i);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["пейпал дол"]?.plannedReceivedUsd, 206);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["приват-фоп"]?.currency, "UAH");
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["приват-фоп"]?.plannedReceivedUsd, 515);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["приват-фоп"]?.realNetUsd, 515);
    assert.equal(response.body?.data?.realIncome?.servicePaymentSummaryByChannel?.["приват-фоп"]?.plannedReceivedUsd, 515);
    assert.equal(response.body?.data?.realIncome?.servicePaymentSummaryByChannel?.["приват-фоп"]?.realNetUsd, 515);
    assert.equal(response.body?.data?.realIncome?.servicePaymentSummaryByChannel?.["пейпал дол"]?.realNetUsd, 321.5);
    assert.equal(response.body?.data?.realIncome?.servicePaymentSummaryTotals?.realNetUsd, 836.5);
    assert.equal(response.body?.data?.realIncome?.serviceOrderSummaryByChannel?.["приват-фоп"]?.plannedReceivedUsd, 515);
    assert.equal(response.body?.data?.realIncome?.serviceOrderSummaryByChannel?.["приват-фоп"]?.realNetUsd, 0);
    assert.equal(response.body?.data?.realIncome?.serviceOrderSummaryTotals?.realNetUsd, 0);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["приват 24-грн"]?.plannedReceivedUsd, 0);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["приват 24-грн"]?.realNetUsd, 0);
  } finally {
    global.fetch = previousFetch;
    if (previousUpstream === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previousUpstream;
    if (previousPayPalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousPayPalClientId;
    if (previousPayPalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = previousPayPalClientSecret;
  }
});

test("service payment diagnostics keep Wise grouped rows on movement same-date client channel totals", () => {
  const makeMovementRow = ({ number, date, client, expectedUsd, paymentMethod, clientPaidUsd = "", providerNetUsd = "" }) => {
    const row = new Array(25).fill("");
    row[0] = number;
    row[1] = date;
    row[2] = client;
    row[9] = String(expectedUsd);
    row[14] = paymentMethod;
    row[18] = String(clientPaidUsd);
    row[20] = String(providerNetUsd);
    return row;
  };

  const movementValues = [
    ["header"],
    [""],
    ["NUMBER", "DATE", "CLIENT"],
    makeMovementRow({
      number: "18170",
      date: "2026-05-20",
      client: "Вилл",
      expectedUsd: 206,
      paymentMethod: "wise",
    }),
    makeMovementRow({
      number: "18171",
      date: "2026-05-22",
      client: "Вилл",
      expectedUsd: 206,
      paymentMethod: "wise",
    }),
    makeMovementRow({
      number: "18172",
      date: "2026-05-22",
      client: "Вилл",
      expectedUsd: 25.75,
      paymentMethod: "wise",
      clientPaidUsd: 231.75,
    }),
  ];

  const diagnostics = buildServicePaymentGapDiagnostics(movementValues, {}, {
    providerEntries: [{
      date: "2026-05-22",
      channel: "трансервайз дол",
      realNetUsd: 437.75,
    }],
  });
  const wiseGap = diagnostics.servicePaymentGapByChannel.find((row) => row.channel === "трансервайз дол");

  assert.deepEqual(wiseGap?.rows?.map((row) => row.rowNumber), ["18170"]);
  assert.equal(
    diagnostics.servicePaymentGapByChannel.some((row) => row.rows?.some((sourceRow) => sourceRow.rowNumber === "18171-18172")),
    false
  );
});

test("order payment coverage allocates grouped payments and leaves only unsafe rows actionable", () => {
  const makeMovementRow = ({
    number,
    date,
    client,
    service = `Service ${number}`,
    expectedUsd,
    paymentMethod,
    clientPaidUsd = "",
    providerNetUsd = "",
    status = "",
    reviewNote = "",
  }) => {
    const row = new Array(25).fill("");
    row[0] = number;
    row[1] = date;
    row[2] = client;
    row[3] = service;
    row[9] = String(expectedUsd);
    row[14] = paymentMethod;
    row[18] = String(clientPaidUsd);
    row[20] = String(providerNetUsd);
    row[23] = status;
    row[24] = reviewNote;
    return row;
  };
  const movementValues = [
    ["header"],
    [""],
    ["NUMBER", "DATE", "CLIENT"],
    makeMovementRow({
      number: "18170",
      date: "2026-05-20",
      client: "Вилл",
      service: "Повтор посвящения Тиферет",
      expectedUsd: 25.75,
      paymentMethod: "wise",
      clientPaidUsd: 25.75,
      status: "NEEDS VERIFICATION",
      reviewNote: "provider fee/net missing",
    }),
    makeMovementRow({
      number: "18171",
      date: "2026-05-22",
      client: "Вилл",
      service: "Маска Профессионала",
      expectedUsd: 206,
      paymentMethod: "wise",
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18172",
      date: "2026-05-22",
      client: "Вилл",
      service: "посвящение смерти повтор",
      expectedUsd: 25.75,
      paymentMethod: "wise",
      clientPaidUsd: 231.75,
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18149",
      date: "2026-05-05",
      client: "Инна Устименко",
      expectedUsd: 103,
      paymentMethod: "пейпал",
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18150",
      date: "2026-05-05",
      client: "Инна Устименко",
      expectedUsd: 5.15,
      paymentMethod: "пейпал",
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18151",
      date: "2026-05-05",
      client: "Инна Устименко",
      expectedUsd: 5.15,
      paymentMethod: "пейпал",
      clientPaidUsd: 115.5,
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18161",
      date: "2026-05-14",
      client: "Ярослав Архипов",
      expectedUsd: 25.25,
      paymentMethod: "крипта",
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18162",
      date: "2026-05-14",
      client: "Ярослав Архипов",
      expectedUsd: 25.25,
      paymentMethod: "крипта",
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18163",
      date: "2026-05-14",
      client: "Ярослав Архипов",
      expectedUsd: 25.25,
      paymentMethod: "крипта",
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18164",
      date: "2026-05-14",
      client: "Ярослав Архипов",
      expectedUsd: 25.25,
      paymentMethod: "крипта",
      clientPaidUsd: 103,
      status: "NEEDS VERIFICATION",
    }),
    makeMovementRow({
      number: "18204",
      date: "2026-05-05",
      client: "Crypto Topup",
      service: "Binance deposit top-up",
      expectedUsd: 103,
      paymentMethod: "Бинанс spot",
      clientPaidUsd: 103,
    }),
  ];

  const coverage = buildOrderPaymentCoverageReport(movementValues, {
    providerEntries: [{
      date: "2026-05-05",
      channel: "пейпал дол",
      realNetUsd: 113.87,
    }],
  });
  const byRow = Object.fromEntries(coverage.rows.map((row) => [row.rowNumber, row]));
  const actionable = coverage.rows.filter((row) => row.remainingUsd > 0.01 || row.status === "needs verification");

  assert.equal(byRow["18171"].remainingUsd, 0);
  assert.equal(byRow["18171"].allocationSource, "grouped same-date");
  assert.equal(byRow["18172"].remainingUsd, 0);
  assert.equal(byRow["18149"].allocatedPaidUsd, 103);
  assert.equal(byRow["18149"].allocationSource, "provider net");
  assert.equal(byRow["18150"].remainingUsd, 0);
  assert.equal(byRow["18151"].status, "overpaid");
  assert.equal(byRow["18170"].remainingUsd, 25.75);
  assert.equal(byRow["18170"].status, "needs verification");
  assert.equal(byRow["18204"].status, "excluded");
  assert.deepEqual(actionable.map((row) => row.rowNumber), ["18170"]);
  assert.equal(coverage.summary.totalAccruedOrdersUsd, 471.8);
  assert.equal(coverage.summary.totalAllocatedToOrdersUsd, 448.62);
  assert.equal(coverage.summary.totalRemainingOrderUsd, 25.75);
  assert.equal(coverage.summary.totalOverpaidOffsetUsd, 2.57);
  assert.equal(coverage.summary.totalExcludedNonServiceUsd, 103);
  assert.equal(coverage.summary.totalUnexplainedUsd, 0);
});

test("GET getDashboardData adds channel-level service payment gap diagnostics without changing service payment totals", async () => {
  const previousUpstream = process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  const previousFetch = global.fetch;
  const previousPayPalClientId = process.env.PAYPAL_CLIENT_ID;
  const previousPayPalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const previousBinanceApiKey = process.env.BINANCE_API_KEY;
  const previousBinanceApiSecret = process.env.BINANCE_API_SECRET;
  process.env.EZOHATA_V2_APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
  process.env.PAYPAL_CLIENT_ID = "client";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  process.env.BINANCE_API_KEY = "binance-key";
  process.env.BINANCE_API_SECRET = "binance-secret";

  const makeSourceRow = ({ number, date, client, service, comment = "", priceBase, accruedPlus, paymentMethod, receivedUsd, receivedUah, uahRate }) => {
    const row = new Array(51).fill("");
    row[1] = number;
    row[2] = date;
    row[3] = client;
    row[4] = service;
    row[5] = comment;
    row[6] = String(priceBase);
    row[9] = String(priceBase);
    row[10] = String(accruedPlus);
    if (uahRate !== undefined) row[18] = String(uahRate);
    row[24] = paymentMethod;
    if (receivedUsd !== undefined) row[30] = String(receivedUsd);
    if (receivedUah !== undefined) row[33] = String(receivedUah);
    return row;
  };

  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("script.google.com")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              action: "calculatePeriod",
              data: {
                period: { startDate: "2026-05-01", endDate: "2026-05-31", timeZone: "Europe/Kiev" },
                tabs: {
                  movement: {
                    sheetName: "движение средства",
                    values: [
                      ["дата 1", "01.05.2026", "дата 2", "31.05.2026"],
                      [""],
                      ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACTION", "QTY", "ACCRUED", "ACCRUED +3%", "70% OF ACCRUED", "70% OF +3%", "RUB RATE", "UAH RATE", "PAYMENT METHOD", "ПОЛУЧЕНО В ДОЛЛАРАХ", "ПОЛУЧЕНО В РУБЛЯХ", "ПОЛУЧЕНО В ГРИВНАХ", "ПОЛУЧЕНО В ДОЛЛАРАХ ИТОГО (СВОДНЫЙ)", "BALANCE", "STATUS", "REVIEW NOTE"],
                    ],
                  },
                  orders: { sheetName: "список моих заказы", values: [["NUMBER", "DATE", "CLIENT", "SERVICE"]] },
                },
              },
            });
          },
        };
      }

      if (value.includes("docs.google.com") && value.includes("export?format=csv")) {
        const rows = [
          new Array(51).fill(""),
          new Array(51).fill(""),
          new Array(51).fill(""),
          makeSourceRow({
            number: "18201",
            date: "2026-05-02",
            client: "PayPal Unsafe",
            service: "PayPal service without provider net",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "сайт, дол, пэйпэл",
            receivedUsd: 103,
          }),
          makeSourceRow({
            number: "18202",
            date: "2026-05-03",
            client: "Без Канала",
            service: "Missing payment channel",
            priceBase: 200,
            accruedPlus: 206,
            paymentMethod: "",
            receivedUsd: 206,
          }),
          makeSourceRow({
            number: "18203",
            date: "2026-05-04",
            client: "Прямой Платеж",
            service: "Direct card overpaid",
            priceBase: 50,
            accruedPlus: 51.5,
            paymentMethod: "монобанк грн",
            receivedUsd: 60,
          }),
          makeSourceRow({
            number: "18204",
            date: "2026-05-05",
            client: "Crypto Topup",
            service: "Binance deposit top-up",
            comment: "deposit",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "Бинанс spot",
            receivedUsd: 103,
          }),
          makeSourceRow({
            number: "18174",
            date: "2026-05-24",
            client: "Сергей Ковалев",
            service: "Приват ФОП no safe amount row 18174",
            priceBase: 200,
            accruedPlus: 206,
            paymentMethod: "приват-фоп",
          }),
          makeSourceRow({
            number: "18152",
            date: "2026-05-06",
            client: "Сергей Ковалев",
            service: "ФОП grouped first order",
            priceBase: 50,
            accruedPlus: 51.5,
            paymentMethod: "ФОП приват",
          }),
          makeSourceRow({
            number: "18153",
            date: "2026-05-06",
            client: "Сергей Ковалев",
            service: "ФОП grouped paid order",
            priceBase: 50,
            accruedPlus: 51.5,
            paymentMethod: "ФОП приват",
            receivedUah: 4537.15,
            uahRate: 44.05,
          }),
          makeSourceRow({
            number: "18165",
            date: "2026-05-14",
            client: "Сергей Ковалев",
            service: "ФОП grouped UAH payment",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "приват ФОП",
            receivedUah: 4815.25,
            uahRate: 42.5,
          }),
          makeSourceRow({
            number: "18166",
            date: "2026-05-14",
            client: "Сергей Ковалев",
            service: "ФОП grouped child order 1",
            priceBase: 5,
            accruedPlus: 5.15,
            paymentMethod: "приват ФОП",
            uahRate: 42.5,
          }),
          makeSourceRow({
            number: "18167",
            date: "2026-05-14",
            client: "Сергей Ковалев",
            service: "ФОП grouped child order 2",
            priceBase: 5,
            accruedPlus: 5.15,
            paymentMethod: "приват ФОП",
            uahRate: 42.5,
          }),
          makeSourceRow({
            number: "18171",
            date: "2026-05-22",
            client: "Вилл",
            service: "Wise grouped first order",
            priceBase: 200,
            accruedPlus: 206,
            paymentMethod: "wise",
          }),
          makeSourceRow({
            number: "18172",
            date: "2026-05-22",
            client: "Вилл",
            service: "Wise grouped paid order",
            priceBase: 25,
            accruedPlus: 25.75,
            paymentMethod: "wise",
            receivedUsd: 231.75,
          }),
          makeSourceRow({
            number: "18149",
            date: "2026-05-05",
            client: "Инна Устименко",
            service: "PayPal grouped first order",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "пейпал",
          }),
          makeSourceRow({
            number: "18150",
            date: "2026-05-05",
            client: "Инна Устименко",
            service: "PayPal grouped child order 1",
            priceBase: 5,
            accruedPlus: 5.15,
            paymentMethod: "пейпал",
          }),
          makeSourceRow({
            number: "18151",
            date: "2026-05-05",
            client: "Инна Устименко",
            service: "PayPal grouped paid order",
            priceBase: 5,
            accruedPlus: 5.15,
            paymentMethod: "пейпал",
            receivedUsd: 115.5,
          }),
          makeSourceRow({
            number: "18175",
            date: "2026-05-24",
            client: "Сергей Ковалев",
            service: "Приват ФОП no safe amount row 18175",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "приват-фоп",
          }),
          makeSourceRow({
            number: "18176",
            date: "2026-05-24",
            client: "Сергей Ковалев",
            service: "Каналы нарушения социальных связей",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "приват-фоп",
          }),
          makeSourceRow({
            number: "18177",
            date: "2026-05-24",
            client: "Сергей Ковалев",
            service: "Канал нарушения работоспособности систем",
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "приват-фоп",
          }),
          makeSourceRow({
            number: "18178",
            date: "2026-05-24",
            client: "Сергей Ковалев",
            service: "Чистка Енергетики з Експрес карти",
            priceBase: 30,
            accruedPlus: 30.9,
            paymentMethod: "приват-фоп",
          }),
          makeSourceRow({
            number: "18179",
            date: "2026-05-24",
            client: "Сергей Ковалев",
            service: "Регулировка заливки",
            priceBase: 50,
            accruedPlus: 51.5,
            paymentMethod: "Wise @bolieslavn",
            receivedUsd: 597.4,
          }),
        ];
        return { ok: true, status: 200, async text() { return rows.map((row) => row.join(",")).join("\n"); } };
      }

      if (value.endsWith("/v1/oauth2/token")) return { ok: true, status: 200, async json() { return { access_token: "paypal-token" }; } };
      if (value.includes("/v1/reporting/transactions")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              total_pages: 1,
              transaction_details: [{
                transaction_info: {
                  transaction_id: "PAYPAL-NOFEE-GAP",
                  transaction_initiation_date: "2026-05-02T10:00:00Z",
                  transaction_amount: { value: "103", currency_code: "USD" },
                },
              }, {
                transaction_info: {
                  transaction_id: "PAYPAL-INNA-GROUP",
                  transaction_initiation_date: "2026-05-05T10:00:00Z",
                  transaction_amount: { value: "118.80", currency_code: "USD" },
                  fee_amount: { value: "-4.93", currency_code: "USD" },
                },
              }],
            };
          },
        };
      }
      if (value.includes("/api/v3/account")) return { ok: true, status: 200, async text() { return JSON.stringify({ balances: [] }); } };
      if (value.includes("/sapi/v1/capital/deposit/hisrec")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify([{ id: "BINANCE-DEPOSIT-GAP", amount: "103", coin: "USDT", completeTime: "2026-05-05T13:00:00Z", status: 1 }]);
          },
        };
      }
      if (value.includes("/sapi/v1/capital/withdraw/history")) return { ok: true, status: 200, async text() { return "[]"; } };
      if (value.includes("/sapi/v1/pay/transactions")) return { ok: true, status: 200, async text() { return JSON.stringify({ data: [] }); } };
      throw new Error(`Unexpected fetch URL: ${value}`);
    };

    const response = createResponseRecorder();
    await handler({ method: "GET", query: { action: "getDashboardData", startDate: "2026-05-01", endDate: "2026-05-31" } }, response);

    assert.equal(response.statusCode, 200);
    const realIncome = response.body?.data?.realIncome;
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["пейпал дол"]?.realNetUsd, 103);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["монобанк грн"]?.realNetUsd, 60);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["приват-фоп"]?.realNetUsd, 216.3);
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["Бинанс spot"]?.realNetUsd, 0);
    assert.equal(realIncome?.servicePaymentSummaryTotals?.realNetUsd, 379.3);
    assert.equal(realIncome?.allSummaryByChannel?.["пейпал дол"]?.realGrossUsd, 118.8);
    assert.equal(realIncome?.allSummaryByChannel?.["пейпал дол"]?.realFeeUsd, 4.93);
    assert.equal(realIncome?.allSummaryByChannel?.["пейпал дол"]?.realNetUsd, 113.87);

    const paypalGap = realIncome?.servicePaymentGapByChannel?.find((row) => row.channel === "пейпал дол");
    assert.equal(paypalGap?.expectedUsd, 216.3);
    assert.equal(paypalGap?.includedUsd, 216.87);
    assert.equal(paypalGap?.missingUnsafeUsd, 103);
    assert.equal(paypalGap?.offsetUsd, 0.57);
    assert.equal(paypalGap?.netGapUsd, -0.57);
    assert.match(paypalGap?.rows?.find((row) => row.rowNumber === "18201")?.reason || "", /PayPal missing client-paid\/provider net|no safe amount/);
    assert.deepEqual(paypalGap?.rows?.map((row) => row.rowNumber).sort(), ["18149-18151", "18201"]);
    assert.match(paypalGap?.rows?.find((row) => row.rowNumber === "18149-18151")?.reason || "", /group net overpaid/);

    const missingChannelGap = realIncome?.servicePaymentGapByChannel?.find((row) => row.channel === "Без канала");
    assert.equal(missingChannelGap?.expectedUsd, 206);
    assert.equal(missingChannelGap?.includedUsd, 0);
    assert.equal(missingChannelGap?.netGapUsd, 206);
    assert.match(missingChannelGap?.rows?.[0]?.reason || "", /payment channel missing/);
    assert.equal(
      realIncome?.servicePaymentGapByChannel?.some((row) => row.rows?.some((sourceRow) => sourceRow.rowNumber === "18179")),
      false
    );
    assert.equal(
      realIncome?.servicePaymentGapByChannel?.some((row) => row.rows?.some((sourceRow) => ["18171", "18172"].includes(sourceRow.rowNumber))),
      false
    );
    assert.equal(realIncome?.servicePaymentSummaryByChannel?.["трансервайз дол"]?.realNetUsd, 0);

    const privateFopGap = realIncome?.servicePaymentGapByChannel?.find((row) => row.channel === "приват-фоп");
    assert.equal(privateFopGap?.expectedUsd, 545.9);
    assert.equal(privateFopGap?.includedUsd, 0);
    assert.equal(privateFopGap?.netGapUsd, 545.9);
    assert.deepEqual(Object.keys(privateFopGap?.rows?.[0] || {}).filter((key) => [
      "rowNumber",
      "date",
      "client",
      "order",
      "paymentMethod",
      "channel",
      "accruedUsd",
      "clientPaidUsd",
      "providerNetUsd",
      "included",
      "reason",
      "status",
      "reviewNote",
    ].includes(key)), [
      "rowNumber",
      "date",
      "client",
      "order",
      "paymentMethod",
      "channel",
      "accruedUsd",
      "clientPaidUsd",
      "providerNetUsd",
      "included",
      "reason",
      "status",
      "reviewNote",
    ]);
    assert.deepEqual(privateFopGap?.rows?.map((row) => [row.rowNumber, row.included, row.reason]), [
      ["18174", false, "no safe amount"],
      ["18175", false, "no safe amount"],
      ["18176", false, "no safe amount"],
      ["18177", false, "no safe amount"],
      ["18178", false, "no safe amount"],
    ]);
    assert.equal(
      realIncome?.servicePaymentGapByChannel?.some((row) => row.rows?.some((sourceRow) => ["18152", "18153", "18165", "18166", "18167"].includes(sourceRow.rowNumber))),
      false
    );

    const monoGap = realIncome?.servicePaymentGapByChannel?.find((row) => row.channel === "монобанк грн");
    assert.equal(monoGap?.expectedUsd, 51.5);
    assert.equal(monoGap?.includedUsd, 60);
    assert.equal(monoGap?.offsetUsd, 8.5);
    assert.equal(monoGap?.netGapUsd, -8.5);
    assert.match(monoGap?.rows?.[0]?.reason || "", /duplicate\/offset\/overpaid/);

    const binanceGap = realIncome?.servicePaymentGapByChannel?.find((row) => row.channel === "Бинанс spot");
    assert.equal(binanceGap?.expectedUsd, 101);
    assert.equal(binanceGap?.includedUsd, 0);
    assert.match(binanceGap?.rows?.[0]?.reason || "", /excluded deposit\/non-service/);

    assert.deepEqual(realIncome?.servicePaymentGapTotals, {
      expectedUsd: 1120.7,
      includedUsd: 276.87,
      missingUnsafeUsd: 955.9,
      offsetUsd: 9.07,
      netGapUsd: 843.83,
    });
    const coverage = realIncome?.orderPaymentCoverage;
    const coverageByRow = Object.fromEntries((coverage?.rows || []).map((row) => [row.rowNumber, row]));
    const actionableCoverageRows = (coverage?.rows || [])
      .filter((row) => row.remainingUsd > 0.01 || row.status === "needs verification")
      .map((row) => row.rowNumber);

    assert.equal(coverage?.summary?.totalAccruedOrdersUsd, 1519.25);
    assert.equal(coverage?.summary?.totalExcludedNonServiceUsd, 101);
    assert.equal(coverageByRow["18149"]?.remainingUsd, 0);
    assert.equal(coverageByRow["18149"]?.allocationSource, "provider net");
    assert.equal(coverageByRow["18171"]?.remainingUsd, 0);
    assert.equal(coverageByRow["18171"]?.allocationSource, "grouped same-date");
    assert.equal(coverageByRow["18204"]?.status, "excluded");
    assert.equal(actionableCoverageRows.includes("18149"), false);
    assert.equal(actionableCoverageRows.includes("18171"), false);
  } finally {
    global.fetch = previousFetch;
    if (previousUpstream === undefined) delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    else process.env.EZOHATA_V2_APPS_SCRIPT_URL = previousUpstream;
    if (previousPayPalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousPayPalClientId;
    if (previousPayPalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = previousPayPalClientSecret;
    if (previousBinanceApiKey === undefined) delete process.env.BINANCE_API_KEY;
    else process.env.BINANCE_API_KEY = previousBinanceApiKey;
    if (previousBinanceApiSecret === undefined) delete process.env.BINANCE_API_SECRET;
    else process.env.BINANCE_API_SECRET = previousBinanceApiSecret;
  }
});
