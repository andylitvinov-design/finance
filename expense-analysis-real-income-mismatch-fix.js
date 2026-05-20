// ============================================================
// EXPENSE ANALYSIS REAL INCOME MISMATCH FIX
// ============================================================
// Provider/API real income is the source of truth when present.
// Ledger fallback is only a fallback/diagnostic. For non-USD rows where
// Ledger USD was derived from a local currency rate, a difference against
// provider USD/net is expected and should not be emitted as console.warn noise.

(function installExpenseAnalysisRealIncomeMismatchFix() {
  if (typeof window === "undefined") return;
  if (window.__expenseAnalysisRealIncomeMismatchFixInstalled) return;
  window.__expenseAnalysisRealIncomeMismatchFixInstalled = true;

  const originalBuildLedgerRealIncomeSummaryByChannel = window.buildLedgerRealIncomeSummaryByChannel;
  const originalMergeExpenseAnalysisRealIncomeSummaryByChannel = window.mergeExpenseAnalysisRealIncomeSummaryByChannel;
  if (typeof originalBuildLedgerRealIncomeSummaryByChannel !== "function") return;
  if (typeof originalMergeExpenseAnalysisRealIncomeSummaryByChannel !== "function") return;

  function getIsoDate(value) {
    if (typeof normalizeIncomingSheetDateValue === "function") return normalizeIncomingSheetDateValue(value || "");
    return String(value || "").slice(0, 10);
  }

  function getRoundAmount(value) {
    if (typeof roundProviderSummaryAmount === "function") return roundProviderSummaryAmount(value);
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  function getNumber(value) {
    if (typeof parseLooseNumber === "function") return parseLooseNumber(value);
    const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isKnownProviderIncome(row) {
    return typeof isLedgerProviderIncomeSource === "function" && isLedgerProviderIncomeSource(row);
  }

  function isKnownProviderNonIncome(row) {
    return typeof isLedgerProviderNonIncomeRow === "function" && isLedgerProviderNonIncomeRow(row);
  }

  function getOperation(row) {
    return typeof getNormalizedLedgerFactOperation === "function"
      ? getNormalizedLedgerFactOperation(row)
      : String(row?.operation || "").trim().toLowerCase();
  }

  function getIncomeChannel(row) {
    return typeof getLedgerIncomeChannel === "function" ? getLedgerIncomeChannel(row) : "";
  }

  function ensureMetaChannel(meta, channel) {
    if (!meta[channel]) meta[channel] = { explicitUsdRows: 0, rateDerivedRows: 0 };
    return meta[channel];
  }

  function buildLedgerRealIncomeDerivationMeta(rows = [], period = {}) {
    const startDate = getIsoDate(period?.startDate || "");
    const endDate = getIsoDate(period?.endDate || "");
    const meta = {};
    (rows || []).forEach((row) => {
      const date = getIsoDate(row?.date || "");
      if ((startDate || endDate) && !date) return;
      if (startDate && date < startDate) return;
      if (endDate && date > endDate) return;
      if (!isKnownProviderIncome(row)) return;
      if (isKnownProviderNonIncome(row)) return;
      if (!["income", "servicein", "ezoin"].includes(getOperation(row))) return;
      const channel = getIncomeChannel(row);
      if (!channel) return;
      const channelMeta = ensureMetaChannel(meta, channel);
      const amountUsdRaw = String(row?.amountUsd ?? row?.amount_usd ?? "").trim();
      const hasExplicitUsd = amountUsdRaw && Math.abs(getNumber(amountUsdRaw)) > 0;
      if (hasExplicitUsd) channelMeta.explicitUsdRows += 1;
      else channelMeta.rateDerivedRows += 1;
    });
    return meta;
  }

  function isExpectedRateDerivedFallbackMismatch(apiSummary, ledgerSummary) {
    const currency = String(apiSummary?.currency || ledgerSummary?.currency || "").trim().toUpperCase();
    if (!currency || currency === "USD") return false;
    return Number(ledgerSummary?.rateDerivedRows || 0) > 0 && Number(ledgerSummary?.explicitUsdRows || 0) === 0;
  }

  function hasExpenseAnalysisRealIncomeValue(summary) {
    const value = summary?.realNetUsd;
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  window.buildLedgerRealIncomeSummaryByChannel = function patchedBuildLedgerRealIncomeSummaryByChannel(rows, usdRateLookup = { byChannel: {}, byCurrency: {} }, period = {}) {
    const summary = originalBuildLedgerRealIncomeSummaryByChannel.call(this, rows, usdRateLookup, period) || {};
    const meta = buildLedgerRealIncomeDerivationMeta(rows, period);
    Object.entries(meta).forEach(([channel, rowMeta]) => {
      if (!summary[channel]) return;
      summary[channel] = { ...summary[channel], ...rowMeta };
    });
    return summary;
  };

  window.mergeExpenseAnalysisRealIncomeSummaryByChannel = function patchedMergeExpenseAnalysisRealIncomeSummaryByChannel(apiSummaryByChannel = {}, ledgerSummaryByChannel = {}, period = {}) {
    const merged = { ...(apiSummaryByChannel || {}) };
    Object.entries(ledgerSummaryByChannel || {}).forEach(([channel, ledgerSummary]) => {
      const ledgerAmount = getRoundAmount(ledgerSummary?.realNetUsd);
      if (ledgerAmount <= 0) return;
      const apiSummary = merged[channel];
      if (!hasExpenseAnalysisRealIncomeValue(apiSummary)) {
        merged[channel] = ledgerSummary;
        return;
      }
      const apiAmount = getRoundAmount(apiSummary?.realNetUsd);
      if (apiAmount !== ledgerAmount && !isExpectedRateDerivedFallbackMismatch(apiSummary, ledgerSummary) && typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[expense-analysis] API real income summary differs from Ledger fallback", { channel, apiRealNetUsd: apiAmount, ledgerRealNetUsd: ledgerAmount, startDate: period?.startDate || "", endDate: period?.endDate || "" });
      }
    });
    return merged;
  };
})();

// Inline mobile screenshot hotfix: loaded from this existing script so it is not dependent on
// a second dynamic script request/cache. Fixes Android JPG FileReader/decode failures.
(function installInlineExpenseScreenshotReadFallback() {
  if (typeof window === "undefined" || window.__expenseScreenshotInlineReadFallbackInstalled) return;
  window.__expenseScreenshotInlineReadFallbackInstalled = true;
  const MAX = 8 * 1024 * 1024;
  const IMG_EXT = /\.(png|jpe?g|webp)$/i;
  const IMG_MIME = /^image\/(png|jpe?g|webp)$/i;
  function accepted(file) { return IMG_MIME.test(String(file?.type || "")) || IMG_EXT.test(String(file?.name || "")); }
  function mime(file) {
    const type = String(file?.type || "").toLowerCase();
    if (IMG_MIME.test(type)) return type.replace("image/jpg", "image/jpeg");
    const name = String(file?.name || "").toLowerCase();
    if (/\.png$/.test(name)) return "image/png";
    if (/\.webp$/.test(name)) return "image/webp";
    if (/\.jpe?g$/.test(name)) return "image/jpeg";
    return "image/jpeg";
  }
  function readByFileReader(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }
  function toDataUrl(buffer, type) {
    const bytes = new Uint8Array(buffer);
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(out)}`;
  }
  async function readDataUrl(file, type) {
    try {
      const dataUrl = await readByFileReader(file);
      if (/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) return dataUrl;
    } catch {}
    if (typeof file?.arrayBuffer !== "function") throw new Error(`Не удалось прочитать ${file?.name || "скриншот"}.`);
    return toDataUrl(await file.arrayBuffer(), type);
  }
  function decode(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => resolve(image);
      image.src = dataUrl;
    });
  }
  async function patchedPrepareExpenseScreenshotImage(file) {
    if (!accepted(file)) throw new Error(`Файл ${file?.name || ""} должен быть PNG, JPEG или WEBP.`);
    const type = mime(file);
    const dataUrl = await readDataUrl(file, type);
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) throw new Error(`Файл ${file?.name || "скриншот"} не похож на изображение.`);
    if (dataUrl.length > MAX) throw new Error(`Скриншот ${file?.name || ""} слишком большой.`);
    try {
      const image = await decode(dataUrl);
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width || maxSide, image.height || maxSide));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((image.width || maxSide) * scale));
      canvas.height = Math.max(1, Math.round((image.height || maxSide) * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const resized = canvas.toDataURL("image/jpeg", 0.82);
      if (resized.length <= MAX) return { name: file?.name || "screenshot", dataUrl: resized, uploadedAtDate: buildLocalTodayIsoDate() };
    } catch {}
    return { name: file?.name || "screenshot", dataUrl, uploadedAtDate: buildLocalTodayIsoDate() };
  }
  try { prepareExpenseScreenshotImage = patchedPrepareExpenseScreenshotImage; window.prepareExpenseScreenshotImage = patchedPrepareExpenseScreenshotImage; } catch {}
})();
