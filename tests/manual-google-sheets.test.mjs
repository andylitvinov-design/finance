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
