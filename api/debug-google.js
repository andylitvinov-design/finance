import { MANUAL_SPREADSHEET_ID, probeGoogleSheetAccess } from "./manual-google-sheets.js";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    return response.status(200).json({ ok: true });
  }

  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  }

  if (process.env.ENABLE_DEBUG_GOOGLE !== "1") {
    return response.status(404).json({ ok: false, error: "debug_google_disabled" });
  }

  const probe = await probeGoogleSheetAccess();
  return response.status(200).json({
    ok: probe.readOk,
    spreadsheetId: MANUAL_SPREADSHEET_ID,
    ...probe,
  });
}
