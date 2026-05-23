import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import handler from "../api/ledger-operation.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

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
    },
  };
}

function jsonResponse(payload, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return payload;
    },
  };
}

test("/api/ledger-operation updates only the target physical Ledger row and preserves omitted values", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const previousFetch = global.fetch;
  const requests = [];

  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "token" });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A1%3AV1")) {
      return jsonResponse({
        values: [[
          "date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd",
          "amount_gross", "amount_fee", "amount_net", "category", "subcategory", "direction",
          "comment", "counterparty", "description", "source", "external_id", "raw_source_id",
          "transfer_group_id", "created_at", "updated_at"
        ]],
      });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A7%3AV7") && options.method === "GET") {
      return jsonResponse({
        values: [[
          "2026-05-01", "expense", "Яндекс руб", "", "1000", "RUB", "10",
          "1000", "15", "985", "business", "", "out", "old comment",
          "Shop", "old description", "yoomoney", "YM-1", "raw-1", "tg-1",
          "2026-05-01T00:00:00.000Z", "2026-05-01T01:00:00.000Z"
        ]],
      });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A7%3AV7") && options.method === "PUT") {
      return jsonResponse({ updatedRange: "'Ledger'!A7:V7" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = createResponseRecorder();
    await handler({
      method: "POST",
      body: {
        action: "update",
        sheetRowNumber: 7,
        comment: "new comment",
        category: "food",
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    const put = requests.find((request) => request.options.method === "PUT");
    assert.ok(put, "target row update request should be sent");
    assert.match(put.url, /'Ledger'!A7%3AV7/);
    const body = JSON.parse(put.options.body);
    assert.equal(body.range, "'Ledger'!A7:V7");
    assert.equal(body.values.length, 1);
    assert.equal(body.values[0][10], "food");
    assert.equal(body.values[0][13], "new comment");
    assert.equal(body.values[0][7], "1000");
    assert.equal(body.values[0][8], "15");
    assert.equal(body.values[0][9], "985");
    assert.equal(body.values[0][16], "yoomoney");
    assert.notEqual(body.values[0][21], "2026-05-01T01:00:00.000Z");
    assert.equal(requests.filter((request) => request.options.method === "PUT").length, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("/api/ledger-operation canonicalizes stale FOP transfer payload before Sheets PUT", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const previousFetch = global.fetch;
  const requests = [];

  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "token" });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A1%3AV1")) {
      return jsonResponse({
        values: [[
          "date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd",
          "amount_gross", "amount_fee", "amount_net", "category", "subcategory", "direction",
          "comment", "counterparty", "description", "source", "external_id", "raw_source_id",
          "transfer_group_id", "created_at", "updated_at"
        ]],
      });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A12%3AV12") && options.method === "GET") {
      return jsonResponse({
        values: [[
          "2026-05-22", "business_expense", "приват 24-грн", "Перевод ФОП", "20003", "UAH", "",
          "20003", "", "20003", "business", "", "out", "",
          "", "", "browser_ocr", "ext-1", "raw-1", "",
          "2026-05-22T00:00:00.000Z", "2026-05-22T01:00:00.000Z"
        ]],
      });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A12%3AV12") && options.method === "PUT") {
      return jsonResponse({ updatedRange: "'Ledger'!A12:V12" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = createResponseRecorder();
    await handler({
      method: "POST",
      body: {
        action: "update",
        sheetRowNumber: 12,
        operation: "business_expense",
        category: "business",
        toChannel: "Перевод ФОП",
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    const put = requests.find((request) => request.options.method === "PUT");
    assert.ok(put, "target row update request should be sent");
    const values = JSON.parse(put.options.body).values[0];
    assert.equal(values[1], "partner_transfer");
    assert.equal(values[2], "приват 24-грн");
    assert.equal(values[3], "приват-фоп");
    assert.equal(values[4], "20003");
    assert.equal(values[5], "UAH");
    assert.equal(values[7], "20003");
    assert.equal(values[9], "20003");
    assert.equal(values[10], "partner");
    assert.equal(values[12], "out");
    assert.equal(values[16], "browser_ocr");
    assert.equal(values[18], "raw-1");
    assert.equal(requests.filter((request) => request.options.method === "PUT").length, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});

test("/api/ledger-operation leaves normal business expense payload unchanged", async () => {
  const previousEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const previousFetch = global.fetch;
  const requests = [];

  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "token" });
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A1%3AV1")) {
      return jsonResponse({
        values: [[
          "date", "operation", "from_channel", "to_channel", "amount", "currency", "amount_usd",
          "amount_gross", "amount_fee", "amount_net", "category", "subcategory", "direction",
          "comment", "counterparty", "description", "source", "external_id", "raw_source_id",
          "transfer_group_id", "created_at", "updated_at"
        ]],
      });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A13%3AV13") && options.method === "GET") {
      return jsonResponse({
        values: [[
          "2026-05-22", "business_expense", "приват 24-грн", "", "150", "UAH", "",
          "150", "", "150", "business", "", "out", "",
          "", "", "browser_ocr", "ext-2", "raw-2", "",
          "2026-05-22T00:00:00.000Z", "2026-05-22T01:00:00.000Z"
        ]],
      });
    }
    if (String(url).includes("sheets.googleapis.com") && String(url).includes("values/'Ledger'!A13%3AV13") && options.method === "PUT") {
      return jsonResponse({ updatedRange: "'Ledger'!A13:V13" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = createResponseRecorder();
    await handler({
      method: "POST",
      body: {
        action: "update",
        sheetRowNumber: 13,
        operation: "business_expense",
        category: "business",
        toChannel: "",
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    const values = JSON.parse(requests.find((request) => request.options.method === "PUT").options.body).values[0];
    assert.equal(values[1], "business_expense");
    assert.equal(values[3], "");
    assert.equal(values[10], "business");
    assert.equal(values[12], "out");
  } finally {
    global.fetch = previousFetch;
    if (previousEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previousKey;
  }
});
