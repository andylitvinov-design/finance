const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAuditPrompt,
  createAuditBridge,
  fetchAuditSnapshot,
  getAuditSnapshotUrl,
  getDebuggerUrl,
  getLiveUrl,
  shouldUseMobileSafeMode,
} = require("../audit-bridge.js");

const EZOHATA_AUDITOR_URL = "https://chatgpt.com/g/g-p-69f388d310288191a55fdcd2cd90edef-ezohata-auditor/project";

test("buildAuditPrompt pretty-prints snapshot JSON with debugger checklist", () => {
  const snapshot = {
    ok: true,
    balances: { fallback_amount_rows: 2 },
    paypal: { gross_total_usd: 324, net_total_usd: 311.06 },
    warnings: ["needs verification"],
  };

  const prompt = buildAuditPrompt(snapshot, { liveUrl: "https://example.test/app" });

  assert.match(prompt, /^EzoHata Debugger task\./);
  assert.match(prompt, /First prove the failing layer before patching\./);
  assert.match(prompt, /Live URL: https:\/\/example\.test\/app/);
  assert.match(prompt, /Snapshot endpoint: \/api\/audit-snapshot/);
  assert.match(prompt, /Repo: andylitvinov-design\/finance/);
  assert.match(prompt, /amount_net invariant/);
  assert.match(prompt, /PayPal gross\/net\/fee completeness/);
  assert.match(prompt, /\n    "fallback_amount_rows": 2/);
});

test("debugger and live URLs fall back to safe defaults", () => {
  assert.equal(getDebuggerUrl({ debuggerUrl: "not a url" }), EZOHATA_AUDITOR_URL);
  assert.equal(getLiveUrl({ liveUrl: "not a url" }), "https://ezohata-incoming-ledger.vercel.app/");
  assert.equal(getDebuggerUrl({ debuggerUrl: "https://chatgpt.com/g/ezo-debugger/" }), "https://chatgpt.com/g/ezo-debugger/");
});

test("mobile safe mode only applies to mobile ChatGPT debugger URLs", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36";

  assert.equal(shouldUseMobileSafeMode({
    debuggerUrl: "https://chatgpt.com/g/ezo-debugger/",
    userAgent: android,
  }), true);
  assert.equal(shouldUseMobileSafeMode({
    debuggerUrl: "https://chatgpt.com/g/ezo-debugger/",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  }), false);
  assert.equal(shouldUseMobileSafeMode({
    debuggerUrl: "https://auditor.example.test/",
    userAgent: android,
  }), false);
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

test("desktop runAudit copies prompt and opens configured debugger URL", async () => {
  const writes = [];
  const opened = [];
  const bridge = createAuditBridge({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, warnings: [] };
      },
    }),
    clipboard: {
      async writeText(value) {
        writes.push(value);
      },
    },
    openWindow(url) {
      opened.push(url);
    },
    setStatus() {},
    showFallback() {
      throw new Error("fallback should not be shown");
    },
    debuggerUrl: "https://chatgpt.com/g/ezo-debugger/",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  });

  const result = await bridge.runAudit();

  assert.equal(result.copied, true);
  assert.equal(result.debuggerUrl, "https://chatgpt.com/g/ezo-debugger/");
  assert.deepEqual(opened, ["https://chatgpt.com/g/ezo-debugger/"]);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /^EzoHata Debugger task\./);
  assert.match(writes[0], /Snapshot:\n/);
});

test("Android runAudit copies prompt but does not open ChatGPT debugger URL", async () => {
  const writes = [];
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
      async writeText(value) {
        writes.push(value);
      },
    },
    openWindow(url) {
      opened.push(url);
    },
    setStatus(message, isError = false) {
      statuses.push({ message, isError });
    },
    showFallback() {
      throw new Error("fallback should not be shown");
    },
    debuggerUrl: "https://chatgpt.com/g/ezo-debugger/",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36",
  });

  const result = await bridge.runAudit();

  assert.equal(result.copied, true);
  assert.equal(result.mobileSafeMode, true);
  assert.equal(result.debuggerUrl, "https://chatgpt.com/g/ezo-debugger/");
  assert.deepEqual(opened, []);
  assert.equal(writes.length, 1);
  assert.deepEqual(statuses.at(-1), {
    message: "Prompt copied. Mobile safe mode: открой EzoHata Auditor вручную и вставь prompt.",
    isError: false,
  });
});

test("runAudit opens EzoHata Auditor by default", async () => {
  const opened = [];
  const bridge = createAuditBridge({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, warnings: [] };
      },
    }),
    clipboard: {
      async writeText() {},
    },
    openWindow(url) {
      opened.push(url);
    },
    setStatus() {},
    showFallback() {
      throw new Error("fallback should not be shown");
    },
  });

  const result = await bridge.runAudit();

  assert.equal(result.copied, true);
  assert.equal(result.debuggerUrl, EZOHATA_AUDITOR_URL);
  assert.deepEqual(opened, [EZOHATA_AUDITOR_URL]);
});

test("clipboard failure exposes fallback prompt without opening debugger", async () => {
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
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36",
  });

  const result = await bridge.runAudit();

  assert.equal(result.copied, false);
  assert.equal(fallbackPrompts.length, 1);
  assert.match(fallbackPrompts[0], /^EzoHata Debugger task\./);
  assert.deepEqual(opened, []);
  assert.deepEqual(statuses.at(-1), {
    message: "Clipboard unavailable. Скопируй prompt вручную.",
    isError: true,
  });
});

test("copyCurrentPrompt only copies and never opens debugger", async () => {
  const opened = [];
  const writes = [];
  const statuses = [];
  const bridge = createAuditBridge({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, warnings: [] };
      },
    }),
    clipboard: {
      async writeText(value) {
        writes.push(value);
      },
    },
    openWindow(url) {
      opened.push(url);
    },
    setStatus(message, isError = false) {
      statuses.push({ message, isError });
    },
    showFallback() {
      throw new Error("fallback should not be shown");
    },
    debuggerUrl: "https://chatgpt.com/g/ezo-debugger/",
  });

  const result = await bridge.copyCurrentPrompt();

  assert.equal(result.copied, true);
  assert.deepEqual(opened, []);
  assert.equal(writes.length, 1);
  assert.deepEqual(statuses.at(-1), {
    message: "Prompt copied.",
    isError: false,
  });
});
