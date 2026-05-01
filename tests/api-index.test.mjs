import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

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
    assert.equal(cryptoRow?.[18], "103");
    assert.equal(cryptoRow?.[19], "");
    assert.equal(cryptoRow?.[20], "");
    assert.equal(cryptoRow?.[22], "");
    assert.equal(cryptoRow?.[23], "NEEDS VERIFICATION");
    assert.match(String(cryptoRow?.[24] || ""), /provider fee\/net missing/i);
    assert.equal(correctedLozinaRow?.[17], "14870");
    assert.equal(correctedLozinaRow?.[18], "339,8857");
    assert.match(correctedLozinaRow?.[24], /source duplicate 14870 UAH/);
    assert.equal(correctedAccruedRow?.[8], "200");
    assert.equal(correctedAccruedRow?.[9], "206");
    assert.equal(correctedAccruedRow?.[17], "45175,8");
    assert.equal(correctedAccruedRow?.[18], "1030");
    assert.equal(correctedAccruedRow?.[22], "824");
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
    assert.equal(quantityRow?.[22], "");
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
    const missingPaymentRow = movementRows.find((row) => row?.[0] === "18101");
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
    assert.equal(missingPaymentRow?.[22], "");
    assert.equal(missingPaymentRow?.[23], "NEEDS VERIFICATION");
    assert.match(String(missingPaymentRow?.[24] || ""), /provider fee\/net missing|balance not calculated from incomplete source row/i);
    assert.equal(fullyMissingRow?.[22], "");
    assert.equal(fullyMissingRow?.[23], "NEEDS VERIFICATION");
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
                  range: "'Ledger'!A:P",
                  values: [
                    ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                    ["2026-04-24", "business_expense", "Яндекс руб", "", "74669", "RUB", "883.0684", "business", "", "out", "ledger source", "manual", "fact:2026-04-24:business:Яндекс руб:0", "", "", ""],
                    ["2026-04-24", "exchange_out", "Яндекс руб", "", "74669", "RUB", "883.0684", "exchange", "", "out", "ledger source", "manual", "fact:exchange:2026-04-24:0", "g1", "", ""],
                    ["2026-04-08", "business_expense", "пейпал дол", "", "15", "USD", "15", "business", "", "out", "ledger source", "manual", "fact:2026-04-08:business:пейпал дол:0", "", "", ""],
                    ["2026-04-10", "exchange_in", "", "пейпал дол", "10", "USD", "10", "exchange", "", "in", "ledger source", "manual", "fact:exchange:2026-04-10:0", "g2", "", ""],
                    ["2026-04-11", "personal_expense", "приват 24-грн", "", "860", "UAH", "20", "food", "", "out", "ledger source", "manual", "fact:2026-04-11:food:приват 24-грн:0", "", "", ""],
                    ["2026-04-12", "exchange_in", "", "приват 24-грн", "4300", "UAH", "100", "exchange", "", "in", "ledger source", "manual", "fact:exchange:2026-04-12:0", "g3", "", ""],
                    ["2026-04-15", "personal_expense", "приват 24-грн", "", "430", "UAH", "10", "travel", "", "out", "ledger source", "manual", "fact:2026-04-15:travel:приват 24-грн:0", "", "", ""],
                    ["2026-04-15", "personal_expense", "БАНК КАНАДА cad", "", "300", "CAD", "", "travel", "", "out", "ledger source", "manual", "fact:2026-04-15:travel:БАНК КАНАДА cad:0", "", "", ""],
                    ["2026-04-25", "income", "", "пейпал дол", "369", "USD", "369", "servicein", "", "in", "ledger source", "manual", "fact:2026-04-25:servicein:пейпал дол:0", "", "", ""],
                    ["2026-04-25", "income", "", "Бинанс spot", "108.15", "USD", "108.15", "servicein", "", "in", "ledger source", "manual", "fact:2026-04-25:servicein:Бинанс spot:0", "", "", ""]
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

test("GET getDashboardData exposes ledger-v1 manual metadata without fallback-looking compatibility mode", async () => {
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
    assert.equal(response.body?.data?.manual?.schema, "ledger-v1");
    assert.equal(response.body?.data?.manual?.primarySource, "ledger");
    assert.equal(response.body?.data?.manual?.compatibilityMode, undefined);
    assert.deepEqual(response.body?.data?.manual?.warnings || [], []);
    assert.ok((response.body?.data?.manual?.operations || []).length > 0);
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
            priceBase: 100,
            accruedPlus: 103,
            paymentMethod: "трансервайз евро",
            receivedUsd: 120,
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
                  amount: { value: "100", currency: "EUR" },
                  totalFees: { value: "5", currency: "EUR" },
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
    assert.equal(paypalRow?.[22], "105,06");
    assert.equal(wiseRow?.[18], "120");
    assert.equal(wiseRow?.[19], "5,8");
    assert.equal(wiseRow?.[20], "110,2");
    assert.equal(wiseRow?.[21], "110,2");
    assert.equal(wiseRow?.[22], "7,2");
    assert.equal(response.body?.data?.realIncome?.rowMatches?.length, 2);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["пейпал дол"]?.realNetUsd, 311.06);
    assert.equal(response.body?.data?.realIncome?.summaryByChannel?.["трансервайз евро"]?.realNetUsd, 110.2);
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
            receivedUsd: 206,
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
            return { total_pages: 1, transaction_details: [] };
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
    assert.equal(paypalRow?.[18], "206");
    assert.equal(paypalRow?.[19], "");
    assert.equal(paypalRow?.[20], "");
    assert.equal(paypalRow?.[21], "");
    assert.equal(paypalRow?.[22], "");
    assert.equal(paypalRow?.[23], "NEEDS VERIFICATION");
    assert.match(String(paypalRow?.[24] || ""), /needs verification/i);
    assert.match(String(paypalRow?.[24] || ""), /provider fee\/net missing/i);
    assert.match((response.body?.data?.realIncome?.warnings || []).join(" | "), /needs verification/i);
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
