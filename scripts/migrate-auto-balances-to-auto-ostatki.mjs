import {
  AUTO_BALANCE_HEADERS,
  AUTO_BALANCE_SHEET_NAME,
  MANUAL_SPREADSHEET_ID,
  SHEETS_API_BASE_URL,
  getManualGoogleSheetsAccessToken,
} from "../server/manual-google-sheets.js";

const MANUAL_BALANCE_SHEET_NAME = "Остатки";
const LEGACY_AUTO_RE = /wise auto snapshot|auto daily provider snapshot|provider snapshot|auto snapshot/i;

export function detectLegacyAutoRows(values = []) {
  return (values || []).slice(1)
    .map((row, index) => convertLegacyAutoRow(row, index + 2))
    .filter(Boolean);
}

export function convertLegacyAutoRow(row = [], sourceRow = null) {
  const comment = String(row[6] || "").trim();
  const source = String(row[7] || "").trim();
  if (!LEGACY_AUTO_RE.test(`${comment} ${source}`)) return null;
  const provider = inferProvider(`${comment} ${source} ${row[1] || ""}`);
  return {
    date: String(row[0] || "").trim(),
    provider,
    channel: String(row[1] || "").trim(),
    amount: String(row[2] || "").trim(),
    currency: String(row[3] || "").trim().toUpperCase(),
    rate: String(row[4] || "").trim(),
    usdAmount: String(row[5] || "").trim(),
    source: provider === "provider" ? "provider_auto" : `${provider}_auto`,
    fetchedAt: "",
    rawSourceId: "",
    status: "legacy",
    comment,
    sourceRow,
  };
}

export function summarizeMigration({ manualValues = [], autoValues = [] } = {}) {
  const detected = detectLegacyAutoRows(manualValues);
  const existingKeys = new Set((autoValues || []).slice(1).map((row) => makeAutoKey({
    date: row[0],
    provider: row[1],
    channel: row[2],
    amount: row[3],
    currency: row[4],
    rawSourceId: row[9],
  })));
  const wouldCopy = [];
  const duplicates = [];
  for (const row of detected) {
    if (existingKeys.has(makeAutoKey(row))) duplicates.push(row);
    else wouldCopy.push(row);
  }
  return {
    detected: detected.length,
    wouldCopy: wouldCopy.length,
    duplicates: duplicates.length,
    skipped: detected.length - wouldCopy.length - duplicates.length,
    detectedRows: detected,
    rowsToCopy: wouldCopy,
    duplicateRows: duplicates,
  };
}

export function buildAutoBalanceValues(rows = []) {
  return [
    AUTO_BALANCE_HEADERS,
    ...(rows || []).map((row) => [
      row.date || "",
      row.provider || "",
      row.channel || "",
      row.amount || "",
      row.currency || "",
      row.rate || "",
      row.usdAmount || "",
      row.source || "",
      row.fetchedAt || "",
      row.rawSourceId || "",
      row.status || "",
      row.comment || "",
    ]),
  ];
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const removeLegacyAuto = args.has("--remove-legacy-auto");
  if (removeLegacyAuto && !apply) {
    throw new Error("--remove-legacy-auto requires --apply");
  }
  const accessToken = await getManualGoogleSheetsAccessToken({ scope: "https://www.googleapis.com/auth/spreadsheets" });
  if (apply) await ensureSheet(accessToken, AUTO_BALANCE_SHEET_NAME);
  const [manualValues, autoValues] = await Promise.all([
    getValues(accessToken, MANUAL_BALANCE_SHEET_NAME, "A:H"),
    getValues(accessToken, AUTO_BALANCE_SHEET_NAME, "A:L", { optional: true }),
  ]);
  const summary = summarizeMigration({ manualValues, autoValues });
  const nextAutoRows = [
    ...(autoValues || []).slice(1).map((row) => ({
      date: row[0], provider: row[1], channel: row[2], amount: row[3], currency: row[4],
      rate: row[5], usdAmount: row[6], source: row[7], fetchedAt: row[8],
      rawSourceId: row[9], status: row[10], comment: row[11],
    })),
    ...summary.rowsToCopy,
  ];
  if (apply && summary.rowsToCopy.length) {
    await replaceSheetValues(accessToken, AUTO_BALANCE_SHEET_NAME, "A:L", buildAutoBalanceValues(nextAutoRows));
  }
  if (removeLegacyAuto && summary.detectedRows.length) {
    const detectedRows = new Set(summary.detectedRows.map((row) => row.sourceRow));
    const keptManualRows = (manualValues || []).filter((row, index) => index === 0 || !detectedRows.has(index + 1));
    await replaceSheetValues(accessToken, MANUAL_BALANCE_SHEET_NAME, "A:H", keptManualRows);
  }
  console.log(JSON.stringify({
    dryRun: !apply,
    removeLegacyAuto,
    detected: summary.detected,
    wouldCopy: summary.wouldCopy,
    duplicates: summary.duplicates,
    skipped: summary.skipped,
  }, null, 2));
}

function makeAutoKey(row = {}) {
  const rawSourceId = String(row.rawSourceId || "").trim();
  return [
    String(row.date || "").trim(),
    inferProvider(row.provider || row.source || row.comment || ""),
    String(row.channel || "").trim(),
    String(row.currency || "").trim().toUpperCase(),
    rawSourceId || String(row.amount || "").trim(),
  ].join("|");
}

function inferProvider(value) {
  const text = String(value || "").toLowerCase();
  if (/wise|transferwise|трансервайз/.test(text)) return "wise";
  if (/paypal|пейпал/.test(text)) return "paypal";
  if (/binance|бинанс/.test(text)) return "binance";
  if (/mono|monobank|монобанк/.test(text)) return "monobank";
  if (/privat|приват/.test(text)) return "privatbank";
  if (/yoomoney|юmoney|юмани|яндекс/.test(text)) return "yoomoney";
  return "provider";
}

async function ensureSheet(accessToken, title) {
  const metadataResponse = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const metadata = await metadataResponse.json();
  if (!metadataResponse.ok) throw new Error(metadata?.error?.message || `Sheets metadata failed with HTTP ${metadataResponse.status}`);
  if ((metadata.sheets || []).some((sheet) => sheet?.properties?.title === title)) return;
  const createResponse = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  const payload = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) throw new Error(payload?.error?.message || `Create ${title} failed with HTTP ${createResponse.status}`);
}

async function getValues(accessToken, title, columns, options = {}) {
  const range = encodeURIComponent(`'${title}'!${columns}`);
  const response = await fetch(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && options.optional && /Unable to parse range|not found|cannot find/i.test(String(payload?.error?.message || ""))) return [];
  if (!response.ok) throw new Error(payload?.error?.message || `Read ${title} failed with HTTP ${response.status}`);
  return payload.values || [];
}

export async function replaceSheetValues(accessToken, title, columns, values, { fetchImpl = fetch } = {}) {
  await clearValues(accessToken, title, columns, { fetchImpl });
  return putValues(accessToken, title, columns, values, { fetchImpl });
}

async function clearValues(accessToken, title, columns, { fetchImpl = fetch } = {}) {
  const range = encodeURIComponent(`'${title}'!${columns}`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Clear ${title} failed with HTTP ${response.status}`);
}

async function putValues(accessToken, title, columns, values, { fetchImpl = fetch } = {}) {
  const range = encodeURIComponent(`'${title}'!${columns}`);
  const response = await fetchImpl(`${SHEETS_API_BASE_URL}/spreadsheets/${MANUAL_SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ range: `'${title}'!${columns}`, majorDimension: "ROWS", values }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Write ${title} failed with HTTP ${response.status}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
