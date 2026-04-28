import test from "node:test";
import assert from "node:assert/strict";

import handler from "../api/index.js";

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
    assert.equal(correctedLozinaRow?.[17], "14870");
    assert.equal(correctedLozinaRow?.[18], "339,8857");
    assert.match(correctedLozinaRow?.[21], /source duplicate 14870 UAH/);
    assert.equal(correctedAccruedRow?.[8], "200");
    assert.equal(correctedAccruedRow?.[9], "206");
    assert.equal(correctedAccruedRow?.[17], "45175,8");
    assert.equal(correctedAccruedRow?.[18], "1030");
    assert.equal(correctedAccruedRow?.[19], "824");
    assert.equal(correctedKovalevRow?.[17], "22490,05");
    assert.equal(correctedKovalevRow?.[18], "515");
    assert.equal(correctedKovalevRow?.[19], "0");
    assert.match(correctedKovalevRow?.[21], /source missing 515 USD UAH equivalent/);
    assert.equal(mixedRateUahRow?.[12], "84,5563");
    assert.equal(mixedRateUahRow?.[13], "43,67");
    assert.equal(mixedRateUahRow?.[18], "206");
    assert.equal(mixedRateUahRow?.[19], "0");
    assert.equal(fallbackUahRateRow?.[13], "43,67");
    assert.equal(fallbackUahRateRow?.[18], "10,3449");
    assert.equal(quantityRow?.[8], "200");
    assert.equal(quantityRow?.[9], "206");
    assert.deepEqual(movementSummaryRows, [
      ["2) начислено прайс +%", "4874,0000"],
      ["4) получено в долларах", "4939,2400"],
      ["6) 70% от прайс+%", "3411,8100"]
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
                      ["пейпал дол", "648,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0"],
                      ["приват 24-грн", "11480,00", "8740,00", "2665,00", "0,00", "0,00", "0,00", "0,00", "2665"],
                      ["Бинанс spot", "1689,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0"],
                      ["binance save", "7425,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0"],
                      ["БАНК КАНАДА cad", "10078,00", "1000,00", "190,00", "238,00", "1000,00", "18,00", "300,00", "1746"],
                      ["Итого", "30631,00", "9740,00", "2855,00", "238,00", "1000,00", "18,00", "300,00", "4411"],
                      [],
                      ["Plan"],
                      ["валюта", "пришло в местной валюте", "пришло в долларах", "ушло", "комиссии", "план-рост", "затраты-мои", "затраты-мои-дол", "plan-profit"],
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
  }
});
