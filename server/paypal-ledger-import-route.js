import { fetchPayPalStatementEntriesFromMcp } from "../api/paypal-transactions.js";
import { appendManualLedgerRows, loadManualRepositoryFromGoogleSheets } from "./manual-google-sheets.js";
import { buildPayPalLedgerImportPlan, buildPayPalLedgerImportVerification } from "./paypal-ledger-import.js";

const MAX_IMPORT_RANGE_DAYS = 31;

function parseBody(body) {
  if (typeof body !== "string") return body || {};
  try { return JSON.parse(body || "{}"); } catch { throw new Error("Invalid JSON body."); }
}

function date(value) {
  const normalized = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error("startDate and endDate must be YYYY-MM-DD.");
  return normalized;
}

function safeError(error) {
  return String(error?.message || error || "PayPal import failed.")
    .replace(/(refresh_token|access_token|client_secret)=[^\s&]+/gi, "$1=[redacted]")
    .slice(0, 300);
}

export default async function paypalLedgerImportHandler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: `Unsupported method: ${request.method}` });
  try {
    const payload = parseBody(request.body);
    const startDate = date(payload.startDate);
    const endDate = date(payload.endDate);
    const days = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
    if (startDate > endDate || days > MAX_IMPORT_RANGE_DAYS) {
      return response.status(400).json({ ok: false, error: `Use a period between 1 and ${MAX_IMPORT_RANGE_DAYS} days.`, phase: "validation" });
    }
    const repository = await loadManualRepositoryFromGoogleSheets();
    if (!repository.ok) throw new Error(repository.warning || "Ledger repository is unavailable.");
    const provider = await fetchPayPalStatementEntriesFromMcp({
      startDate,
      endDate,
      clientId: String(process.env.PAYPAL_MCP_CLIENT_ID || "").trim(),
      refreshToken: String(process.env.PAYPAL_MCP_REFRESH_TOKEN || "").trim(),
      restClientId: String(process.env.PAYPAL_CLIENT_ID || "").trim(),
      restClientSecret: String(process.env.PAYPAL_CLIENT_SECRET || "").trim(),
      environment: process.env.PAYPAL_ENVIRONMENT || "live",
    });
    const plan = buildPayPalLedgerImportPlan({ entries: provider.entries, existingRows: repository.operations });
    const dryRun = payload.apply !== true;
    const save = dryRun ? { addedCount: 0, duplicateCount: 0, skippedCount: 0 } : await appendManualLedgerRows({ rows: plan.rows });
    return response.status(200).json({
      ok: true,
      dryRun,
      source: provider.source,
      date_from: startDate,
      date_to: endDate,
      counts: {
        ...plan.counts,
        fetched: provider.transactionCount,
        normalized: provider.entries.length,
        ...(dryRun ? {} : {
          new: save.addedCount,
          duplicates: plan.counts.duplicates + save.duplicateCount,
          skipped: plan.counts.skipped + save.skippedCount,
        }),
      },
      finance_verification: buildPayPalLedgerImportVerification(plan.rows),
      warnings: (provider.warnings || []).length,
    });
  } catch (error) {
    return response.status(400).json({ ok: false, error: "paypal_import_unavailable", phase: "provider_or_ledger", message: safeError(error) });
  }
}
