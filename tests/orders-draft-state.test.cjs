const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const ORDERS_HELPER = require("../orders-helper.js");

function createOrdersContext() {
  const storage = new Map();
  const context = {
    console,
    ORDERS_HELPER,
    MANUAL_FINANCE_TOTAL_LABEL: "Итого",
    MANUAL_ORDERS_HEADERS: ORDERS_HELPER.SIMPLE_HEADERS,
    MANUAL_ORDERS_DEFAULT_ROWS: 1,
    state: {
      manualOrders: {
        loading: false,
        data: null,
        dirty: false,
        status: "",
        error: false,
        textDraft: "",
        draftRowKeys: [],
      },
      data: { tabs: {} },
    },
    elements: {
      startDate: { value: "2026-05-21" },
      endDate: { value: "2026-05-21" },
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    hasConfiguredManualOrdersEndpoint: () => false,
    hasManualWorkbookServerAccess: () => false,
    getManualOrdersConfig: () => ({ sheetName: "Мои заказы", spreadsheetUrl: "" }),
    renderTabs: () => {},
    applyManualOrdersToDashboard: () => {},
    loadDashboardData: async () => {},
    clearManualServerCache: () => {},
    getManualOrdersSheetDirect: async () => ({ headers: ORDERS_HELPER.SIMPLE_HEADERS, rows: [] }),
    saveManualOrdersSheetDirect: async () => ({ savedAt: "test" }),
    findDateColumnIndex(header) {
      return header.findIndex((cell) => String(cell || "").trim().toLowerCase().includes("дата"));
    },
    parseIsoDate(value) {
      const [year, month, day] = String(value).split("-").map(Number);
      return new Date(year, month - 1, day);
    },
    parseDisplayDate(value, fallbackYear) {
      const raw = String(value || "").trim();
      if (!raw) return null;
      const fullDateMatch = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      if (fullDateMatch) return new Date(Number(fullDateMatch[3]), Number(fullDateMatch[2]) - 1, Number(fullDateMatch[1]));
      const shortDateMatch = raw.match(/^(\d{2})[./](\d{2})$/);
      if (shortDateMatch) return new Date(Number(fallbackYear), Number(shortDateMatch[2]) - 1, Number(shortDateMatch[1]));
      return null;
    },
    hasAnyValue(row) {
      return Array.isArray(row) && row.some((cell) => String(cell || "").trim());
    },
    padRowToWidth(row, width) {
      const output = (Array.isArray(row) ? row : []).slice(0, width);
      while (output.length < width) output.push("");
      return output;
    },
    parseLooseNumber(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const parsed = Number(raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    },
    formatSheetNumber(value) {
      const parsed = Number(value || 0);
      return String(Math.round(parsed * 10000) / 10000).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
    },
    findHeaderIndexByAliases(header, aliases) {
      const normalizedAliases = aliases.map((alias) => String(alias).trim().toLowerCase());
      return header.findIndex((cell) => normalizedAliases.includes(String(cell || "").trim().toLowerCase()));
    },
    isTableTotalRow(row) {
      return Array.isArray(row) && row.some((cell) => String(cell || "").trim().toLowerCase().replace(/ё/g, "е") === "итого");
    },
    roundTo2(value) {
      return Math.round(Number(value || 0) * 100) / 100;
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "orders.js"), "utf8"), context, {
    filename: "orders.js",
  });
  return context;
}

test("loaded manual order rows without draft markers are classified as saved", () => {
  const context = createOrdersContext();
  const row = ["21.05.2026", "Андрей", "источник", "25", "50%", "12.5"];

  context.state.manualOrders.data = context.buildManualOrdersStateFromPayload({
    headers: ORDERS_HELPER.SIMPLE_HEADERS,
    rows: [row],
  });

  const groups = context.getManualOrdersRowsBySaveStatus(context.state.manualOrders.data.rows);
  assert.deepEqual(Array.from(groups.draft), []);
  assert.deepEqual(Array.from(groups.saved.map(({ row }) => Array.from(row))), [row]);
});

test("parsing text adds only unique new rows as draft and skips saved duplicates", () => {
  const context = createOrdersContext();
  const savedRow = ["21.05.2026", "Андрей", "старый заказ", "25", "50%", "12.5"];
  context.state.manualOrders.data = context.buildManualOrdersStateFromPayload({
    headers: ORDERS_HELPER.SIMPLE_HEADERS,
    rows: [savedRow],
  });
  context.state.manualOrders.textDraft = [
    "21.05.2026 Андрей",
    "1) старый заказ 25",
    "2) новый заказ 50",
  ].join("\n");

  context.appendManualOrdersFromText();

  const groups = context.getManualOrdersRowsBySaveStatus(context.state.manualOrders.data.rows);
  assert.deepEqual(Array.from(groups.saved.map(({ row }) => row[2])), ["старый заказ"]);
  assert.deepEqual(Array.from(groups.draft.map(({ row }) => row[2])), ["новый заказ"]);
  assert.equal(context.state.manualOrders.dirty, true);
  assert.match(context.state.manualOrders.status, /новых 1/);
  assert.match(context.state.manualOrders.status, /уже в источнике 1/);
});

test("save and load clear manual orders draft markers", async () => {
  const context = createOrdersContext();
  const row = ["21.05.2026", "Андрей", "новый заказ", "25", "50%", "12.5"];
  context.state.manualOrders.data = context.buildManualOrdersStateFromPayload({
    headers: ORDERS_HELPER.SIMPLE_HEADERS,
    rows: [row],
  });
  context.markManualOrderRowAsDraft(row);
  assert.equal(context.isManualOrderDraftRow(row), true);

  await context.saveManualOrdersSheet();
  assert.deepEqual(Array.from(context.state.manualOrders.draftRowKeys), []);

  context.markManualOrderRowAsDraft(row);
  context.state.manualOrders.data = context.buildManualOrdersStateFromPayload({
    headers: ORDERS_HELPER.SIMPLE_HEADERS,
    rows: [row],
  });
  context.clearManualOrdersDraftMarkers();
  assert.deepEqual(Array.from(context.state.manualOrders.draftRowKeys), []);
});

test("editing a draft row keeps the normalized row marked as draft", () => {
  const context = createOrdersContext();
  const row = ["21.05.2026", "Андрей", "новый заказ", "25", "50%", "12.5"];
  context.state.manualOrders.data = context.buildManualOrdersStateFromPayload({
    headers: ORDERS_HELPER.SIMPLE_HEADERS,
    rows: [row],
  });
  context.markManualOrderRowAsDraft(row);

  context.updateManualOrderValue(0, 3, "50");

  const dataRows = context.getManualOrdersDataRows(context.state.manualOrders.data.rows);
  assert.equal(context.isManualOrderDraftRow(dataRows[0]), true);
  assert.deepEqual(dataRows[0], ["21.05.2026", "Андрей", "новый заказ", "50", "50%", "25"]);
});

test("adding a manual order row creates a draft card row", () => {
  const context = createOrdersContext();
  const savedRow = ["21.05.2026", "Андрей", "источник", "25", "50%", "12.5"];
  context.state.manualOrders.data = context.buildManualOrdersStateFromPayload({
    headers: ORDERS_HELPER.SIMPLE_HEADERS,
    rows: [savedRow],
  });

  context.addManualOrderRow();

  const groups = context.getManualOrdersRowsBySaveStatus(context.state.manualOrders.data.rows);
  assert.equal(groups.saved.length, 1);
  assert.equal(groups.draft.length, 1);
  assert.deepEqual(Array.from(groups.draft[0].row), ["", "", "", "", "", ""]);
});

test("manual order discount calculation remains unchanged", () => {
  const context = createOrdersContext();

  assert.deepEqual(
    context.recalculateManualOrderRow(["21.05.2026", "Андрей", "личный", "25", "50%", ""]),
    ["21.05.2026", "Андрей", "личный", "25", "50%", "12.5"]
  );
});
