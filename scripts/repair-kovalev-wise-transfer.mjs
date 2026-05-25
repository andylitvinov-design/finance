const DEFAULT_BASE_URL = "https://ezohata-incoming-ledger.vercel.app";
const DEFAULT_ORDER_ID = "18179";
const TRANSFER_SHEET_TITLE = "Переводы";
const TARGET_CHANNEL = "wise boleslav usd";
const RAW_SOURCE_PREFIX = "source-order";

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    orderId: DEFAULT_ORDER_ID,
    startDate: "",
    endDate: "",
    apply: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--base-url") options.baseUrl = argv[++index] || options.baseUrl;
    else if (arg === "--order-id") options.orderId = argv[++index] || options.orderId;
    else if (arg === "--start-date") options.startDate = argv[++index] || "";
    else if (arg === "--end-date") options.endDate = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/repair-kovalev-wise-transfer.mjs [--apply] [--order-id 18179]",
    "Dry-run is default. --apply writes/upserts the single derived row into Переводы."
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await repairKovalevWiseTransfer(options);
  console.log(JSON.stringify(result, null, 2));
}

async function repairKovalevWiseTransfer(options = {}) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const orderId = String(options.orderId || DEFAULT_ORDER_ID).trim();
  const dashboard = await fetchJson(`${baseUrl}/api/index?action=getDashboardData&startDate=${encodeURIComponent(options.startDate || "2026-05-01")}&endDate=${encodeURIComponent(options.endDate || "2026-05-31")}`);
  const source = findSourceOrder(dashboard?.data, orderId);
  const target = buildTargetTransferRow(source);
  const transferSheet = await readTransferSheet(baseUrl);
  const upsert = upsertTransferRow(transferSheet.values, target);
  const result = {
    ok: true,
    mode: options.apply ? "apply" : "dry-run",
    orderId,
    source,
    targetRow: target.values,
    targetObject: target.object,
    rawSourceId: target.rawSourceId,
    existingMatch: upsert.existingMatch,
    changed: upsert.changed,
    duplicateCount: upsert.duplicateCount,
    writeRange: `${quoteSheetTitle(TRANSFER_SHEET_TITLE)}!A1:J`,
    applied: false
  };
  if (!options.apply) return result;
  if (!upsert.changed) return { ...result, applied: false, note: "target row already present" };
  await writeTransferSheet(baseUrl, upsert.values);
  return { ...result, applied: true };
}

function findSourceOrder(data = {}, orderId) {
  const rows = data?.tabs?.movement?.values || data?.tabs?.orders?.values || [];
  const row = rows.find((item) => String(item?.[0] || "").trim() === orderId);
  if (!row) throw new Error(`Order ${orderId} was not found in live dashboard data.`);
  const source = {
    orderId,
    date: normalizeIsoDate(row[1]),
    client: String(row[2] || "").trim(),
    service: String(row[3] || "").trim(),
    paymentMethod: String(row[14] || "").trim(),
    amount: String(row[15] || row[18] || "").trim(),
    currency: "USD",
    status: String(row[23] || "").trim(),
    reviewNote: String(row[24] || "").trim()
  };
  if (!source.date) throw new Error(`Order ${orderId} has no parseable date.`);
  if (!isKovalevWiseBoleslav(source)) {
    throw new Error(`Order ${orderId} does not match Kovalev + Wise + bolieslavn guard.`);
  }
  if (!parseMoney(source.amount)) throw new Error(`Order ${orderId} has no positive USD amount.`);
  return source;
}

function buildTargetTransferRow(source) {
  const amount = formatMoney(source.amount);
  const rawSourceId = `${RAW_SOURCE_PREFIX}:${source.orderId}`;
  return {
    rawSourceId,
    values: [
      source.date,
      source.client,
      amount,
      "USD",
      TARGET_CHANNEL,
      "",
      amount,
      rawSourceId,
      source.orderId,
      rawSourceId
    ],
    object: {
      transferDate: source.date,
      who: source.client,
      amount,
      currency: "USD",
      channel: TARGET_CHANNEL,
      rate: "",
      usdAmount: amount,
      raw_source_id: rawSourceId,
      orderId: source.orderId,
      sourceTransactionId: rawSourceId
    }
  };
}

async function readTransferSheet(baseUrl) {
  const payload = await manualSheetsFetch(baseUrl, {
    method: "GET",
    path: `/spreadsheets/1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY/values/${encodeURIComponent(`${quoteSheetTitle(TRANSFER_SHEET_TITLE)}!A1:J`)}`
  });
  return { values: Array.isArray(payload?.values) ? payload.values : [] };
}

async function writeTransferSheet(baseUrl, values) {
  return await manualSheetsFetch(baseUrl, {
    method: "PUT",
    path: `/spreadsheets/1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY/values/${encodeURIComponent(`${quoteSheetTitle(TRANSFER_SHEET_TITLE)}!A1:J`)}?valueInputOption=USER_ENTERED`,
    body: { values }
  });
}

async function manualSheetsFetch(baseUrl, request) {
  const payload = await fetchJson(`${baseUrl}/api/manual-transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sheetsFetch", ...request })
  });
  if (!payload?.ok) throw new Error(payload?.error || "Manual transfers request failed.");
  return payload.data || {};
}

function upsertTransferRow(values, target) {
  const output = values.length ? values.map((row) => row.slice()) : [];
  if (!output.length) output.push(["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"]);
  output[0] = ensureTransferHeaders(output[0]);
  const matchingIndexes = [];
  for (let index = 1; index < output.length; index += 1) {
    if (matchesTargetTransfer(output[index], target)) matchingIndexes.push(index);
  }
  const duplicateCount = Math.max(0, matchingIndexes.length - 1);
  if (!matchingIndexes.length) {
    output.push(target.values.slice());
    return { values: output, changed: true, existingMatch: false, duplicateCount };
  }
  const first = matchingIndexes[0];
  const changed = JSON.stringify(normalizeWidth(output[first], target.values.length)) !== JSON.stringify(target.values);
  output[first] = target.values.slice();
  return { values: output, changed, existingMatch: true, duplicateCount };
}

function ensureTransferHeaders(header) {
  const next = normalizeWidth(header, 10);
  const required = ["дата перевода", "кто", "сумма", "валюта", "канал куда", "курс", "сумма в долларах"];
  required.forEach((value, index) => {
    if (!String(next[index] || "").trim()) next[index] = value;
  });
  next[7] = next[7] || "raw_source_id";
  next[8] = next[8] || "orderId";
  next[9] = next[9] || "sourceTransactionId";
  return next;
}

function matchesTargetTransfer(row, target) {
  const normalized = normalizeWidth(row, 10);
  if (String(normalized[7] || "").trim() === target.rawSourceId) return true;
  return normalizeIsoDate(normalized[0]) === target.object.transferDate &&
    normalizeLookupText(normalized[1]) === normalizeLookupText(target.object.who) &&
    formatMoney(normalized[2]) === target.object.amount &&
    normalizeLookupText(normalized[4]) === normalizeLookupText(target.object.channel);
}

function isKovalevWiseBoleslav(source) {
  const client = normalizeLookupText(source.client);
  const paymentMethod = normalizeLookupText(source.paymentMethod);
  return /(ковалев|kovalev)/.test(client) &&
    /(wise|transferwise|трансервайз)/.test(paymentMethod) &&
    /bolieslavn?/.test(paymentMethod);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}: ${url}`);
  return payload;
}

function normalizeWidth(row, width) {
  const output = Array.isArray(row) ? row.slice(0, width) : [];
  while (output.length < width) output.push("");
  return output;
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const display = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (display) return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
  return "";
}

function parseMoney(value) {
  const normalized = String(value || "").replace(/\s/g, "").replace(",", ".").replace(/[^\d.+-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value) {
  const numeric = parseMoney(value);
  return String(Math.round(numeric * 10000) / 10000).replace(".", ",");
}

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}

export {
  buildTargetTransferRow,
  isKovalevWiseBoleslav,
  repairKovalevWiseTransfer,
  upsertTransferRow
};
