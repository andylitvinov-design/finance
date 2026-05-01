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

test("loadManualRepositoryFromGoogleSheets ignores legacy Расходы as an operations source", async () => {
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
    assert.equal(repository.schema, "ledger-v1-empty");
    assert.deepEqual(repository.operations, []);
    assert.deepEqual(repository.expenseRows, []);
    assert.equal(repository.fallbackSchema, null);
    assert.deepEqual(repository.warnings, ["legacy Расходы ignored: Ledger is the only operations source."]);
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
                range: "'Ledger'!A:P",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-24 00:00:00", "exchange_out", "Яндекс руб", "Бинанс spot", "-74669", "RUB", "-883.0684", "exchange", "", "out", "sell rub", "mcp", "ledger-1", "g1", "", ""],
                  ["2026-04-24 00:00:00", "exchange_in", "Яндекс руб", "Бинанс spot", "874", "USD", "874", "exchange", "", "in", "buy usd", "mcp", "ledger-2", "g1", "", ""],
                  ["2026-04-25 00:00:00", "exchange_out", "приват 24-грн", "binance save", "-4916", "UAH", "-112.0839", "exchange", "", "out", "buy crypto", "mcp", "ledger-3", "g2", "", ""],
                  ["2026-04-25 00:00:00", "exchange_out", "binance save", "", "-950", "USD", "-950", "exchange", "", "out", "send usd", "mcp", "ledger-4", "g2", "", ""],
                  ["2026-04-25 00:00:00", "income", "", "пейпал дол", "369", "USD", "369", "serviceIncome", "", "in", "income", "manual", "ledger-5", "", "", ""],
                  ["2026-04-26 00:00:00", "expense", "Яндекс руб", "", "1000", "RUB", "11.82", "food", "", "out", "meal", "photo", "ledger-6", "", "", ""],
                ],
              },
              {
                range: "'Расходы'!A1:Z10",
                values: [
                  ["дата", "категория", "Яндекс руб"],
                  ["2026-04-24", "business", "999999"],
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
    assert.equal(repository.ledgerV2Rows.length, 6);
    assert.equal(repository.operations[0].source, "mcp");
    assert.equal(repository.operations[0].ledgerV2.operation, "exchange");
    assert.equal(repository.operations[0].ledgerV2.external_id, "ledger-1");
    assert.equal(repository.operations[4].source, "manual");
    assert.equal(repository.operations[4].ledgerV2.category, "service");
    assert.match((repository.warnings || []).join(" | "), /amount_net.*falls back to amount/);
    assert.equal(repository.operations[5].source, "photo");
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
          "Бинанс spot": "",
          "binance save": "-950",
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
      { date: "2026-04-25", channel: "binance save", amount: -950, amountUsd: -950 },
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

test("loadManualRepositoryFromGoogleSheets tolerates missing Ledger source column and keeps non-migration source blank", async () => {
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
                range: "'Ledger'!A:O",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-25", "income", "", "paypal usd", "369", "USD", "369", "serviceIncome", "", "", "income", "raw-1", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
                ],
              },
              { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
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
    assert.equal(repository.operations.length, 1);
    assert.equal(repository.operations[0].source, "");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets normalizes migration raw_source_id rows as manual without a physical source column", async () => {
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
                range: "'Ledger'!A:O",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-25", "personal_expense", "Яндекс руб", "", "1000", "RUB", "11.82", "food", "", "out", "migrated expense", "migration:2026-04-25:19:8", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
                ],
              },
              { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
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
    assert.equal(repository.operations.length, 1);
    assert.equal(repository.operations[0].source, "manual");
    assert.equal(repository.operations[0].rawSourceId, "migration:2026-04-25:19:8");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets derives missing amount_usd for exchange operations from currency and transfer rates", async () => {
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
                range: "'Ledger'!A:O",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category"],
                  ["2026-04-25", "exchange_out", "приват 24-грн", "binance save", "-4300", "UAH", "", "exchange"],
                  ["2026-04-25", "exchange_in", "приват 24-грн", "binance save", "100", "USD", "", "exchange"],
                ],
              },
              { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
              { range: "'Остатки'!A1:G", values: [["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"]] },
              {
                range: "'Переводы'!A1:G",
                values: [
                  ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
                  ["2026-04-12", "test", "4300", "UAH", "приват 24-грн", "43", "100"],
                ],
              },
              { range: "'Комиссии'!A1:D", values: [["дата", "канал", "сумма в долларах", "комментарий"]] },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(repository.ok, true);
    assert.equal(repository.schema, "ledger-v1");
    assert.equal(repository.operations[0].amountUsd, "-100");
    assert.equal(repository.operations[1].amountUsd, "100");
    assert.deepEqual(repository.views.byDateChannel, [
      { date: "2026-04-25", channel: "binance save", amount: 100, amountUsd: 100 },
      { date: "2026-04-25", channel: "приват 24-грн", amount: -4300, amountUsd: -100 },
    ]);
    assert.deepEqual(repository.views.byCategory, [
      { category: "exchange", amount: -4200, amountUsd: 0, count: 2 },
    ]);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets normalizes explicit exchange amount_usd sign for exchange_out rows", async () => {
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
                range: "'Ledger'!A:O",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category"],
                  ["2026-04-24", "exchange_out", "Яндекс руб", "", "74669", "RUB", "883.0684", "exchange"],
                  ["2026-04-24", "exchange_in", "", "Бинанс spot", "874", "USD", "874", "exchange"],
                ],
              },
              { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
              { range: "'Остатки'!A1:G", values: [["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"]] },
              { range: "'Переводы'!A1:G", values: [["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"]] },
              { range: "'Комиссии'!A1:D", values: [["дата", "канал", "сумма в долларах", "комментарий"]] },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(repository.ok, true);
    assert.equal(repository.operations[0].amountUsd, "-883,0684");
    assert.equal(repository.operations[1].amountUsd, "874");
    assert.deepEqual(repository.views.byDateChannel, [
      { date: "2026-04-24", channel: "Бинанс spot", amount: 874, amountUsd: 874 },
      { date: "2026-04-24", channel: "Яндекс руб", amount: 74669, amountUsd: -883.0684 },
    ]);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets keeps empty Ledger as explicit ledger-v1-empty schema", async () => {
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
                range: "'Ledger'!A:O",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                ],
              },
              {
                range: "'Расходы'!A1:Z10",
                values: [
                  ["дата", "категория", "Яндекс руб"],
                  ["2026-04-24", "exchange", "-74669"],
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
    assert.equal(repository.schema, "ledger-v1-empty");
    assert.deepEqual(repository.operations, []);
    assert.deepEqual(repository.expenseRows, []);
    assert.equal(repository.fallbackSchema, null);
    assert.deepEqual(repository.warnings, ["legacy Расходы ignored: Ledger is the only operations source."]);
    assert.match(fetchCalls[1], /ranges=%27Ledger%27%21A%3AS/);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets fills UAH amount_usd and reads detail fields", async () => {
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
                range: "'Ledger'!A:S",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "category", "subcategory", "direction", "comment", "counterparty", "description", "source", "external_id", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-25", "business_expense", "приват 24-грн", "", "4386", "UAH", "", "business", "", "out", "comment", "ТОВ Сервіс", "Оплата", "mcp", "PB-1", "PB-1", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
                ],
              },
              { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
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
    assert.equal(repository.operations[0].amountUsd, "100");
    assert.equal(repository.operations[0].counterparty, "ТОВ Сервіс");
    assert.equal(repository.operations[0].description, "Оплата");
    assert.equal(repository.operations[0].externalId, "PB-1");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});
