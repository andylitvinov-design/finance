"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");

test("sheet-config routes dashboard API through /api/index", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "sheet-config.json"), "utf8"));
  assert.equal(config.endpoint, "/api/index");
});

test("vercel keeps /api/index from clean-url redirecting to raw /api source", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  assert.equal(config.cleanUrls, false);
});

test("dashboard non-JSON module response becomes structured UI error", async () => {
  const context = createDashboardApiContext({
    endpoint: "/api/index",
    fetchImpl: async () => createResponse({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: "import { readFile } from \"node:fs/promises\";\nexport default async function handler() {}"
    })
  });

  await assert.rejects(
    () => context.loadDashboardDataViaEndpoint("2026-05-15", "2026-05-21"),
    (error) => {
      assert.match(error.message, /Dashboard endpoint returned non-JSON response/);
      assert.match(error.message, /application\/javascript/);
      assert.match(error.message, /import \{ readFile \}/);
      assert.doesNotMatch(error.message, /Unexpected token|SyntaxError/);
      assert.equal(error.status, 200);
      assert.equal(error.contentType, "application/javascript; charset=utf-8");
      assert.match(error.bodyExcerpt, /^import \{ readFile \}/);
      return true;
    }
  );
});

test("callDashboardApi reports invalid JSON without raw SyntaxError", async () => {
  const context = createDashboardApiContext({
    endpoint: "/api/index",
    fetchImpl: async () => createResponse({
      status: 502,
      contentType: "application/json; charset=utf-8",
      body: "{not valid json"
    })
  });

  await assert.rejects(
    () => context.callDashboardApi("2026-05-15", "2026-05-21"),
    (error) => {
      assert.match(error.message, /Dashboard endpoint returned invalid JSON/);
      assert.match(error.message, /502/);
      assert.doesNotMatch(error.message, /Unexpected token|SyntaxError/);
      assert.equal(error.status, 502);
      return true;
    }
  );
});

test("loadDashboardDataViaEndpoint accepts valid dashboard JSON", async () => {
  const context = createDashboardApiContext({
    endpoint: "/api/index",
    fetchImpl: async () => createResponse({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ ok: true, data: { tabs: { movement: { values: [] } } } })
    })
  });

  const payload = await context.loadDashboardDataViaEndpoint("2026-05-15", "2026-05-21");
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { tabs: { movement: { values: [] } } });
});

function createDashboardApiContext({ endpoint, fetchImpl }) {
  const source = fs.readFileSync(path.join(repoRoot, "main.js"), "utf8");
  const context = {
    FILE_PROTOCOL_DASHBOARD_ORIGIN: "https://ezohata-incoming-ledger.vercel.app",
    state: { config: { endpoint } },
    window: {
      location: {
        href: "https://ezohata-incoming-ledger.vercel.app/",
        protocol: "https:"
      }
    },
    fetch: fetchImpl,
    URL
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(source, "normalizeEndpointUrl"),
    extractFunction(source, "getDashboardEndpoint"),
    extractFunction(source, "buildDashboardResponseError"),
    extractFunction(source, "readDashboardJsonResponse"),
    extractFunction(source, "callDashboardApi"),
    extractFunction(source, "loadDashboardDataViaEndpoint"),
    "this.callDashboardApi = callDashboardApi;",
    "this.loadDashboardDataViaEndpoint = loadDashboardDataViaEndpoint;"
  ].join("\n"), context);
  return context;
}

function createResponse({ status, contentType, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? contentType : null;
      }
    },
    async text() {
      return body;
    }
  };
}

function extractFunction(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}
