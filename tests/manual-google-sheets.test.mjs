import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { loadManualRepositoryFromGoogleSheets } from "../api/manual-google-sheets.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  };
}

test("loadManualRepositoryFromGoogleSheets keeps timestamped expense rows inside the selected period shape", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  try {
    const fetchCalls = [];
    const repository = await loadManualRepositoryFromGoogleSheets({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url));
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return jsonResponse({ access_token: "token" });
        }
        if (String(url).includes("sheets.googleapis.com")) {
          return jsonResponse({
            valueRanges: [
              {
                range: "'Расходы'!A1:Z10",
                values: [
                  ["comment"],
                  ["дата", "категория", "Яндекс руб", "Бинанс spot", "приват 24-грн"],
                  ["2026-04-24 00:00:00", "exchange", "-74669", "874", ""],
                  ["2026-04-25 00:00:00", "exchange", "", "-950", "-4916"],
                  ["2026-04-30", "exchange", "", "", "-4916"],
                ],
              },
              { range: "'Остатки'!A1:D1", values: [["дата", "канал", "сумма"]] },
              { range: "'Переводы'!A1:D1", values: [["дата перевода", "кто", "сумма", "канал куда"]] },
              { range: "'Комиссии'!A1:D1", values: [["дата", "канал", "сумма в долларах"]] },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(repository.ok, true);
    assert.equal(repository.schema, "legacy-expense-grid");
    assert.deepEqual(repository.operations, []);
    assert.deepEqual(repository.expenseRows, [
      {
        date: "2026-04-24",
        category: "exchange",
        amounts: {
          "Яндекс руб": "-74669",
          "Бинанс spot": "874",
          "приват 24-грн": "",
        },
      },
      {
        date: "2026-04-25",
        category: "exchange",
        amounts: {
          "Яндекс руб": "",
          "Бинанс spot": "-950",
          "приват 24-грн": "-4916",
        },
      },
      {
        date: "2026-04-30",
        category: "exchange",
        amounts: {
          "Яндекс руб": "",
          "Бинанс spot": "",
          "приват 24-грн": "-4916",
        },
      },
    ]);
    assert.equal(fetchCalls.length, 2);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets parses normalized operation rows and builds compatibility views", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  try {
    const repository = await loadManualRepositoryFromGoogleSheets({
      fetchImpl: async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return jsonResponse({ access_token: "token" });
        }
        if (String(url).includes("sheets.googleapis.com")) {
          return jsonResponse({
            valueRanges: [
              {
                range: "'Расходы'!A1:Z10",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "comment"],
                  ["2026-04-24 00:00:00", "exchange", "Яндекс руб", "Бинанс spot", "-74669", "RUB", "-883.0684", "exchange", "sell rub"],
                  ["2026-04-24 00:00:00", "exchange", "Яндекс руб", "Бинанс spot", "874", "USD", "874", "exchange", "buy usd"],
                  ["2026-04-25 00:00:00", "exchange", "приват 24-грн", "binance save", "-4916", "UAH", "-112.0839", "exchange", "buy crypto"],
                  ["2026-04-25 00:00:00", "exchange", "binance save", "", "-950", "USD", "-950", "exchange", "send usd"],
                  ["2026-04-25 00:00:00", "income", "", "пейпал дол", "369", "USD", "369", "serviceIncome", "income"],
                  ["2026-04-26 00:00:00", "expense", "Яндекс руб", "", "1000", "RUB", "11.82", "food", "meal"],
                ],
              },
              { range: "'Остатки'!A1:D1", values: [["дата", "канал", "сумма"]] },
              { range: "'Переводы'!A1:D1", values: [["дата перевода", "кто", "сумма", "канал куда"]] },
              { range: "'Комиссии'!A1:D1", values: [["дата", "канал", "сумма в долларах"]] },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(repository.ok, true);
    assert.equal(repository.schema, "ledger-v1");
    assert.equal(repository.operations.length, 6);
    assert.deepEqual(repository.expenseRows, [
      {
        date: "2026-04-24",
        category: "exchange",
        amounts: {
          "Яндекс руб": "-74669",
          "пейпал дол": "",
          "пейпал евр": "",
          "пейпал сad": "",
          "приват 24-дол": "",
          "приват 24-евро": "",
          "приват 24-грн": "",
          "монобанк грн": "",
          "трансервайз дол": "",
          "трансервайз евро": "",
          "REVOLUT дол": "",
          "Payoneer - eur": "",
          "Payoneer - dol": "",
          "Бинанс spot": "874",
          "binance save": "",
          "Налично -я-евр": "",
          "местная валюты": "",
          "БАНК КАНАДА cad": "",
          "нал-мам-евро": "",
          "нал-мам-дол": "",
        },
      },
      {
        date: "2026-04-25",
        category: "exchange",
        amounts: {
          "Яндекс руб": "",
          "пейпал дол": "",
          "пейпал евр": "",
          "пейпал сad": "",
          "приват 24-дол": "",
          "приват 24-евро": "",
          "приват 24-грн": "-4916",
          "монобанк грн": "",
          "трансервайз дол": "",
          "трансервайз евро": "",
          "REVOLUT дол": "",
          "Payoneer - eur": "",
          "Payoneer - dol": "",
          "Бинанс spot": "-950",
          "binance save": "",
          "Налично -я-евр": "",
          "местная валюты": "",
          "БАНК КАНАДА cad": "",
          "нал-мам-евро": "",
          "нал-мам-дол": "",
        },
      },
      {
        date: "2026-04-25",
        category: "serviceIncome",
        amounts: {
          "Яндекс руб": "",
          "пейпал дол": "369",
          "пейпал евр": "",
          "пейпал сad": "",
          "приват 24-дол": "",
          "приват 24-евро": "",
          "приват 24-грн": "",
          "монобанк грн": "",
          "трансервайз дол": "",
          "трансервайз евро": "",
          "REVOLUT дол": "",
          "Payoneer - eur": "",
          "Payoneer - dol": "",
          "Бинанс spot": "",
          "binance save": "",
          "Налично -я-евр": "",
          "местная валюты": "",
          "БАНК КАНАДА cad": "",
          "нал-мам-евро": "",
          "нал-мам-дол": "",
        },
      },
      {
        date: "2026-04-26",
        category: "food",
        amounts: {
          "Яндекс руб": "1000",
          "пейпал дол": "",
          "пейпал евр": "",
          "пейпал сad": "",
          "приват 24-дол": "",
          "приват 24-евро": "",
          "приват 24-грн": "",
          "монобанк грн": "",
          "трансервайз дол": "",
          "трансервайз евро": "",
          "REVOLUT дол": "",
          "Payoneer - eur": "",
          "Payoneer - dol": "",
          "Бинанс spot": "",
          "binance save": "",
          "Налично -я-евр": "",
          "местная валюты": "",
          "БАНК КАНАДА cad": "",
          "нал-мам-евро": "",
          "нал-мам-дол": "",
        },
      },
    ]);
    assert.deepEqual(repository.views.byDateChannel, [
      { date: "2026-04-24", channel: "Бинанс spot", amount: 874, amountUsd: 874 },
      { date: "2026-04-24", channel: "Яндекс руб", amount: -74669, amountUsd: -883.0684 },
      { date: "2026-04-25", channel: "Бинанс spot", amount: -950, amountUsd: -950 },
      { date: "2026-04-25", channel: "пейпал дол", amount: 369, amountUsd: 369 },
      { date: "2026-04-25", channel: "приват 24-грн", amount: -4916, amountUsd: -112.0839 },
      { date: "2026-04-26", channel: "Яндекс руб", amount: 1000, amountUsd: 11.82 },
    ]);
    assert.deepEqual(repository.views.byCategory, [
      { category: "exchange", amount: -79661, amountUsd: -1071.1523, count: 4 },
      { category: "food", amount: 1000, amountUsd: 11.82, count: 1 },
      { category: "serviceIncome", amount: 369, amountUsd: 369, count: 1 },
    ]);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});
