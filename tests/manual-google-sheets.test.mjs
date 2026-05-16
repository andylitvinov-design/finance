import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { loadManualRepositoryFromGoogleSheets, probeGoogleSheetAccess } from "../server/manual-google-sheets.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jsonResponse(payload, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return payload;
    },
  };
}

test("probeGoogleSheetAccess reports missing credentials without fetching", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  try {
    let fetchCount = 0;
    const probe = await probeGoogleSheetAccess({
      fetchImpl: async () => {
        fetchCount += 1;
        throw new Error("fetch should not be called");
      },
    });

    assert.equal(probe.configured, false);
    assert.equal(probe.hasEmail, false);
    assert.equal(probe.hasPrivateKey, false);
    assert.equal(probe.keyLooksPem, false);
    assert.equal(probe.authClientCreated, false);
    assert.equal(probe.readOk, false);
    assert.equal(probe.error, "service_account_credentials_missing");
    assert.equal(fetchCount, 0);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("probeGoogleSheetAccess validates malformed private key without exposing it", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "not-a-private-key";

  try {
    const probe = await probeGoogleSheetAccess({
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
    });

    assert.equal(probe.configured, false);
    assert.equal(probe.hasEmail, true);
    assert.equal(probe.hasPrivateKey, true);
    assert.equal(probe.keyLooksPem, false);
    assert.equal(probe.readOk, false);
    assert.equal(probe.error, "service_account_private_key_invalid_pem");
    assert.equal(JSON.stringify(probe).includes("not-a-private-key"), false);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("probeGoogleSheetAccess normalizes escaped private key newlines and reads one row", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString()
    .replace(/\n/g, "\\n");

  try {
    const fetchCalls = [];
    const probe = await probeGoogleSheetAccess({
      fetchImpl: async (url) => {
        fetchCalls.push(String(url));
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return jsonResponse({ access_token: "token" });
        }
        if (String(url).includes("sheets.googleapis.com")) {
          return jsonResponse({ values: [["date", "operation"], ["2026-05-01", "income"]] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(probe.configured, true);
    assert.equal(probe.hasEmail, true);
    assert.equal(probe.hasPrivateKey, true);
    assert.equal(probe.keyLooksPem, true);
    assert.equal(probe.authClientCreated, true);
    assert.equal(probe.readOk, true);
    assert.equal(probe.rowCount, 2);
    assert.equal(probe.error, null);
    assert.equal(fetchCalls.length, 2);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("probeGoogleSheetAccess reports token request failure safely", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  try {
    const probe = await probeGoogleSheetAccess({
      fetchImpl: async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return jsonResponse({ error_description: "invalid_grant" }, { ok: false, status: 401 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(probe.configured, true);
    assert.equal(probe.authClientCreated, false);
    assert.equal(probe.readOk, false);
    assert.equal(probe.rowCount, 0);
    assert.equal(probe.error, "invalid_grant");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("probeGoogleSheetAccess reports sheet read failure safely", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  try {
    const probe = await probeGoogleSheetAccess({
      fetchImpl: async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return jsonResponse({ access_token: "token" });
        }
        if (String(url).includes("sheets.googleapis.com")) {
          return jsonResponse({ error: { message: "The caller does not have permission" } }, { ok: false, status: 403 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(probe.configured, true);
    assert.equal(probe.authClientCreated, true);
    assert.equal(probe.readOk, false);
    assert.equal(probe.rowCount, 0);
    assert.equal(probe.error, "The caller does not have permission");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

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
              {
                range: "'Остатки'!A1:G",
                values: [
                  ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
                  ["2026-04-23", "трансервайз дол", "1000", "USD", "1", "1000", "opening"],
                ],
              },
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
                range: "'Ledger'!A:V",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_gross", "amount_fee", "amount_net", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-24 00:00:00", "exchange_out", "Яндекс руб", "Бинанс spot", "-74669", "RUB", "-883.0684", "74669", "", "74669", "exchange", "", "out", "sell rub", "mcp", "ledger-1", "g1", "", ""],
                  ["2026-04-24 00:00:00", "exchange_in", "Яндекс руб", "Бинанс spot", "874", "USD", "874", "874", "", "874", "exchange", "", "in", "buy usd", "mcp", "ledger-2", "g1", "", ""],
                  ["2026-04-25 00:00:00", "exchange_out", "приват 24-грн", "binance save", "-4916", "UAH", "-112.0839", "4916", "", "4916", "exchange", "", "out", "buy crypto", "mcp", "ledger-3", "g2", "", ""],
                  ["2026-04-25 00:00:00", "exchange_out", "binance save", "", "-950", "USD", "-950", "950", "", "950", "exchange", "", "out", "send usd", "mcp", "ledger-4", "g2", "", ""],
                  ["2026-04-25 00:00:00", "income", "", "пейпал дол", "369", "USD", "369", "369", "", "369", "serviceIncome", "", "in", "income", "manual", "ledger-5", "", "", ""],
                  ["2026-04-25 00:00:00", "income", "", "трансервайз дол", "1210.25", "USD", "1210.25", "1210.25", "", "", "serviceIncome", "", "in", "wise fact income", "wise", "ledger-wise-income", "", "", ""],
                  ["2026-04-26 00:00:00", "expense", "Яндекс руб", "", "1000", "RUB", "11.82", "1000", "", "1000", "food", "", "out", "meal", "photo", "ledger-6", "", "", ""],
	                  ["2026-04-27 00:00:00", "business_expense", "Яндекс руб", "", "85956", "RUB", "942", "85956", "", "85956", "business", "", "out", "rub expense", "mcp", "ledger-7", "", "", ""],
	                ],
	              },
	              {
	                range: "'План'!A1:D10",
	                values: [
	                  ["month", "orders_income_plan_usd", "services_income_plan_usd", "business_expense_plan_usd"],
	                  ["2026-04", "1000", "250", "300"],
	                ],
	              },
	              {
	                range: "'Расходы'!A1:Z10",
                values: [
                  ["дата", "категория", "Яндекс руб"],
                  ["2026-04-24", "business", "999999"],
                ],
              },
              {
                range: "'Остатки'!A1:G",
                values: [
                  ["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"],
                  ["2026-04-23", "трансервайз дол", "1000", "USD", "1", "1000", "opening"],
                ],
              },
              { range: "'Переводы'!A1:D1", values: [["дата перевода", "кто", "сумма", "канал куда"]] },
              { range: "'Комиссии'!A1:D1", values: [["дата", "канал", "сумма в долларах"]] },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assert.equal(repository.ok, true);
    assert.equal(repository.schema, "ledger-v2-compatible");
    assert.equal(repository.operations.length, 8);
    assert.equal(repository.ledgerV2Rows.length, 8);
    assert.equal(repository.operations[0].source, "yoomoney");
    assert.equal(repository.operations[0].ledgerV2.operation, "exchange");
    assert.equal(repository.operations[0].ledgerV2.external_id, "ledger-1");
    assert.equal(repository.operations[4].source, "manual");
    assert.equal(repository.operations[4].ledgerV2.category, "service");
	    assert.equal(repository.views.fallback_amount_rows, 0);
	    assert.equal(repository.views.missing_amount_net_rows, 1);
	    assert.equal(repository.views.excluded_missing_amount_net_rows, 1);
    assert.equal(repository.operations[5].source, "wise");
    assert.equal(repository.operations[6].source, "photo");
	    assert.equal(repository.operations[7].amountUsd, "942");
	    assert.equal(repository.monthlyPlanRows.length, 1);
	    assert.deepEqual(repository.plannedRows, [
	      { date: "2026-04-01", channel: "План: заказы", currency: "USD", amount: 1000, operation: "income", source: "monthly_plan" },
	      { date: "2026-04-01", channel: "План: услуги", currency: "USD", amount: 250, operation: "income", source: "monthly_plan" },
	      { date: "2026-04-01", channel: "План: бизнес расходы", currency: "USD", amount: 300, operation: "expense", source: "monthly_plan" },
	    ]);
	    assert.deepEqual(repository.balances, [
      {
        date: "2026-04-23",
        channel: "трансервайз дол",
        accountName: "трансервайз дол",
        amount: "1000",
        balanceAmount: "1000",
        currency: "USD",
        rate: "1",
        usdAmount: "1000",
        comment: "opening",
        source: "manual-google-sheets",
      },
    ]);
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
          "приват-фоп": "",
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
          "приват-фоп": "",
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
          "приват-фоп": "",
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
          "приват-фоп": "",
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
	        date: "2026-04-27",
	        category: "business",
	        amounts: {
	          "Яндекс руб": "85956",
	          "пейпал дол": "",
	          "пейпал евр": "",
	          "пейпал сad": "",
	          "приват 24-дол": "",
	          "приват 24-евро": "",
	          "приват 24-грн": "",
	          "приват-фоп": "",
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
	      { date: "2026-04-26", channel: "Яндекс руб", amount: -1000, amountUsd: 11.82 },
	      { date: "2026-04-27", channel: "Яндекс руб", amount: -85956, amountUsd: 942 },
	    ]);
	    assert.deepEqual(repository.views.byCategory, [
	      { category: "business", amount: 85956, amountUsd: 942, count: 1 },
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

test("loadManualRepositoryFromGoogleSheets keeps ledger operations when amount_net is missing", async () => {
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
                  ["2026-04-25", "income", "", "paypal usd", "369", "USD", "369", "serviceincome", "", "in", "income", "raw-1", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
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
    assert.equal(repository.schema, "ledger-v1");
    assert.equal(repository.operations.length, 1);
    assert.equal(repository.ledgerV2Rows.length, 1);
    assert.equal(repository.operations[0].toChannel, "пейпал дол");
    assert.match((repository.warnings || []).join(" | "), /amount_net.*balance was not calculated/);
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
                range: "'Ledger'!A:P",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-25", "income", "", "paypal usd", "369", "USD", "369", "369", "serviceIncome", "", "", "income", "raw-1", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
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
    assert.equal(repository.schema, "ledger-v2-compatible");
    assert.equal(repository.operations.length, 1);
    assert.equal(repository.operations[0].source, "paypal");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets normalizes migration raw_source_id rows as migration without a physical source column", async () => {
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
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "subcategory", "direction", "comment", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-25", "personal_expense", "Яндекс руб", "", "1000", "RUB", "11.82", "1000", "food", "", "out", "migrated expense", "migration:2026-04-25:19:8", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
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
    assert.equal(repository.schema, "ledger-v2-compatible");
    assert.equal(repository.operations.length, 1);
    assert.equal(repository.operations[0].source, "migration");
    assert.equal(repository.operations[0].rawSourceId, "migration:2026-04-25:19:8");
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets infers provider source from channels when legacy source is generic", async () => {
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
                range: "'Ledger'!A:R",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "subcategory", "direction", "comment", "source", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-25", "income", "", "пейпал дол", "100", "USD", "100", "100", "serviceincome", "", "in", "legacy provider", "mcp", "legacy-1", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
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
    assert.equal(repository.operations.length, 1);
    assert.equal(repository.operations[0].source, "paypal");
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
                range: "'Ledger'!A:P",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category"],
                  ["2026-04-25", "exchange_out", "приват 24-грн", "binance save", "-4300", "UAH", "", "4300", "exchange"],
                  ["2026-04-25", "exchange_in", "приват 24-грн", "binance save", "100", "USD", "", "100", "exchange"],
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
    assert.equal(repository.schema, "ledger-v2-compatible");
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

test("loadManualRepositoryFromGoogleSheets includes Russian display-date transfer rows", async () => {
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
                values: [["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category"]],
              },
              { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
              { range: "'Остатки'!A1:G", values: [["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"]] },
              {
                range: "'Переводы'!A1:G",
                values: [
                  ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
                  ["24.04.2026", "я", "950", "USD", "usdt", "1", "950"],
                  ["5 мая", "я", "26000", "грн", "фоп", "44,05", "590,2384"],
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
    assert.deepEqual(repository.transfers, [
      { transferDate: "2026-04-24", who: "я", amount: "950", currency: "USD", channel: "usdt", rate: "1", usdAmount: "950" },
      { transferDate: "2026-05-05", who: "я", amount: "26000", currency: "грн", channel: "фоп", rate: "44,05", usdAmount: "590,2384" },
    ]);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets warns when transfer sheet rows cannot be parsed", async () => {
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
                values: [["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category"]],
              },
              { range: "'Расходы'!A1:Z10", values: [["дата", "категория", "Яндекс руб"]] },
              { range: "'Остатки'!A1:G", values: [["дата", "канал", "сумма", "валюта", "курс", "сумма_usd", "комментарий"]] },
              {
                range: "'Переводы'!A1:G",
                values: [
                  ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"],
                  ["не дата", "я", "26000", "грн", "фоп", "44,05", "590,2384"],
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
    assert.deepEqual(repository.transfers, []);
    assert.match(repository.warnings.join("\n"), /Переводы sheet has data rows but no parsed transfer rows/);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("loadManualRepositoryFromGoogleSheets keeps valid ledger rows when raw exchange amount_usd is derived", async () => {
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
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category", "source"],
                  ["2026-05-01", "income", "", "yoomoney", "2500", "RUB", "25", "2500", "income", "mcp"],
                  ["2026-05-02", "business_expense", "yoomoney", "", "1000", "RUB", "10", "1000", "business", "mcp"],
                  ["2026-05-03", "exchange_out", "Яндекс руб", "Бинанс spot", "0", "RUB", "", "3000", "exchange", "manual"],
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
    assert.equal(repository.schema, "ledger-v2-compatible");
    assert.equal(repository.operations.length, 3);
    assert.equal(repository.operations[0].amountUsd, "25");
    assert.equal(repository.operations[0].source, "yoomoney");
    assert.equal(repository.operations[0].sheetRowNumber, 2);
    assert.equal(repository.operations[1].amountUsd, "10");
    assert.equal(repository.operations[1].sheetRowNumber, 3);
    assert.equal(repository.operations[2].amountUsd, "");
    assert.equal(repository.operations[2].ledgerV2.amount_usd, "-35.47932");
    assert.doesNotMatch(repository.warnings.join("\n"), /exchange row.*amount_usd/i);
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
                range: "'Ledger'!A:P",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_net", "category"],
                  ["2026-04-24", "exchange_out", "Яндекс руб", "", "74669", "RUB", "883.0684", "74669", "exchange"],
                  ["2026-04-24", "exchange_in", "", "Бинанс spot", "874", "USD", "874", "874", "exchange"],
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
      { date: "2026-04-24", channel: "Яндекс руб", amount: -74669, amountUsd: -883.0684 },
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
    assert.match(fetchCalls[1], /ranges=%27Ledger%27%21A%3AV/);
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
                range: "'Ledger'!A:V",
                values: [
                  ["date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd", "amount_gross", "amount_fee", "amount_net", "category", "subcategory", "direction", "comment", "counterparty", "description", "source", "external_id", "raw_source_id", "transfer_group_id", "created_at", "updated_at"],
                  ["2026-04-25", "business_expense", "приват 24-грн", "", "4386", "UAH", "", "4386", "", "4386", "business", "", "out", "comment", "ТОВ Сервіс", "Оплата", "mcp", "PB-1", "PB-1", "", "2026-04-25T09:00:00.000Z", "2026-04-25T09:00:00.000Z"],
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
