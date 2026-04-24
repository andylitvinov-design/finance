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

test("GET getDashboardData preserves upstream movement rows even when raw source has newer rows", async () => {
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
                      ["18126", "16.04.2026", "Ярослав Архипов", "Чистка мышечных напряжений", "", "100", "", "", "100", "103", "70", "72.1", "84.5563", "UAH RATE", "крипта, дол", "103", "", "", "103", "0", "ARRIVED", ""]
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
    const positions = movementRows.map((row) => row?.[0]).filter(Boolean);
    assert.deepEqual(positions, ["дата 1", "Поменяй даты.", "NUMBER", "18126"]);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData preserves upstream payout rows even when raw source has newer rows", async () => {
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
    assert.deepEqual(positions, ["Выплаты", "POSITION", "18124"]);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});

test("GET getDashboardData does not invent Kovalev movement rows from raw source when upstream has none", async () => {
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
    assert.deepEqual(positions, ["дата 1", "Поменяй даты.", "NUMBER"]);
    assert.deepEqual(ordersRows, [["NUMBER", "DATE", "CLIENT", "SERVICE"]]);
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) {
      delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
    } else {
      process.env.EZOHATA_V2_APPS_SCRIPT_URL = previous;
    }
  }
});
