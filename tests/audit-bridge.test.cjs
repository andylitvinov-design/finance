const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAuditPrompt,
  createAuditBridge,
  fetchAuditSnapshot,
  getAuditSnapshotUrl,
} = require("../audit-bridge.js");

test("buildAuditPrompt pretty-prints snapshot JSON with required checklist", () => {
  const snapshot = {
    ok: true,
    balances: { fallback_amount_rows: 2 },
    paypal: { gross_total_usd: 324, net_total_usd: 311.06 },
    warnings: ["needs verification"],
  };

  const prompt = buildAuditPrompt(snapshot);

  assert.equal(prompt, [
    "Сделай аудит ezohata-incoming-ledger по snapshot.",
    "",
    "Проверь:",
    "- balance",
    "- fallback_amount_rows",
    "- PayPal gross/net",
    "- exchange amount_usd",
    "- source unknown",
    "- warnings",
    "",
    "Snapshot:",
    JSON.stringify(snapshot, null, 2),
  ].join("\n"));
  assert.match(prompt, /\n    "fallback_amount_rows": 2/);
});

test("audit snapshot URL is fixed and never includes includeRows", async () => {
  const calls = [];
  const snapshot = { ok: true, summary: { ledger_rows: 1 } };
  const payload = await fetchAuditSnapshot(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return snapshot;
      },
    };
  });

  assert.deepEqual(payload, snapshot);
  assert.equal(getAuditSnapshotUrl(), "/api/audit-snapshot");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/audit-snapshot");
  assert.deepEqual(calls[0].options, { cache: "no-store" });
  assert.equal(String(calls[0].url).includes("includeRows"), false);
});

test("clipboard failure exposes fallback prompt without opening ChatGPT", async () => {
  const fallbackPrompts = [];
  const statuses = [];
  const opened = [];
  const bridge = createAuditBridge({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, warnings: [] };
      },
    }),
    clipboard: {
      async writeText() {
        throw new Error("blocked");
      },
    },
    openWindow(url) {
      opened.push(url);
    },
    setStatus(message, isError = false) {
      statuses.push({ message, isError });
    },
    showFallback(prompt) {
      fallbackPrompts.push(prompt);
    },
  });

  const result = await bridge.runAudit();

  assert.equal(result.copied, false);
  assert.equal(fallbackPrompts.length, 1);
  assert.match(fallbackPrompts[0], /^Сделай аудит ezohata-incoming-ledger по snapshot\./);
  assert.deepEqual(opened, []);
  assert.deepEqual(statuses.at(-1), {
    message: "Clipboard unavailable. Скопируй prompt вручную.",
    isError: true,
  });
});
