// Hotfix: tolerant mobile image read + strict Privat24 browser OCR parser.
(function () {
  const MAX = 8 * 1024 * 1024;
  const IMG_EXT = /\.(png|jpe?g|webp)$/i;
  const IMG_MIME = /^image\/(png|jpe?g|webp)$/i;
  const MONTHS = {"січня":"01","сiчня":"01","января":"01","лютого":"02","февраля":"02","березня":"03","марта":"03","квітня":"04","квiтня":"04","апреля":"04","травня":"05","мая":"05","червня":"06","июня":"06","липня":"07","июля":"07","серпня":"08","августа":"08","вересня":"09","сентября":"09","жовтня":"10","октября":"10","листопада":"11","ноября":"11","грудня":"12","декабря":"12"};
  const originalExtractDate = typeof extractExpenseOcrDate === "function" ? extractExpenseOcrDate : null;
  const originalParseOcrText = typeof parseExpenseOcrText === "function" ? parseExpenseOcrText : null;

  function uiYear() { return String(elements?.endDate?.value || elements?.startDate?.value || new Date().toISOString()).slice(0, 4) || String(new Date().getFullYear()); }
  function mime(file) {
    const type = String(file?.type || "").toLowerCase();
    if (IMG_MIME.test(type)) return type.replace("image/jpg", "image/jpeg");
    const name = String(file?.name || "").toLowerCase();
    if (/\.png$/.test(name)) return "image/png";
    if (/\.webp$/.test(name)) return "image/webp";
    if (/\.jpe?g$/.test(name)) return "image/jpeg";
    return "";
  }
  function accepted(file) { return IMG_MIME.test(String(file?.type || "")) || IMG_EXT.test(String(file?.name || "")); }
  function readByFileReader(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onerror = () => reject(new Error(`read failed: ${file?.name || "screenshot"}`)); r.onload = () => resolve(String(r.result || "")); r.readAsDataURL(file); }); }
  function toDataUrl(buffer, type) { const bytes = new Uint8Array(buffer); let out = ""; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return `data:${type};base64,${btoa(out)}`; }
  async function readDataUrl(file, type) { try { const dataUrl = await readByFileReader(file); if (/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) return dataUrl; } catch {} if (typeof file?.arrayBuffer !== "function") throw new Error(`Не удалось прочитать ${file?.name || "скриншот"}.`); return toDataUrl(await file.arrayBuffer(), type); }
  function decode(dataUrl) { return new Promise((resolve, reject) => { const img = new Image(); img.onerror = reject; img.onload = () => resolve(img); img.src = dataUrl; }); }

  async function patchedPrepareExpenseScreenshotImage(file) {
    if (!accepted(file)) throw new Error(`Файл ${file?.name || ""} должен быть PNG, JPEG или WEBP.`);
    const type = mime(file) || "image/jpeg";
    const dataUrl = await readDataUrl(file, type);
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) throw new Error(`Файл ${file?.name || "скриншот"} не похож на изображение.`);
    if (dataUrl.length > MAX) throw new Error(`Скриншот ${file?.name || ""} слишком большой.`);
    try {
      const img = await decode(dataUrl);
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(img.width || maxSide, img.height || maxSide));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round((img.width || maxSide) * scale));
      c.height = Math.max(1, Math.round((img.height || maxSide) * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const resized = c.toDataURL("image/jpeg", 0.82);
      if (resized.length <= MAX) return { name: file?.name || "screenshot", dataUrl: resized, uploadedAtDate: buildLocalTodayIsoDate() };
    } catch {}
    return { name: file?.name || "screenshot", dataUrl, uploadedAtDate: buildLocalTodayIsoDate() };
  }

  function patchedExtractExpenseOcrDate(line) {
    const direct = originalExtractDate ? originalExtractDate(line) : "";
    if (direct) return direct;
    const raw = String(line || "").toLowerCase().replace(/ё/g, "е");
    const names = Object.keys(MONTHS).join("|");
    const m = raw.match(new RegExp(`(?:^|\\b)(\\d{1,2})\\s+(${names})(?:\\b|$)`, "i"));
    return m ? `${uiYear()}-${MONTHS[m[2]]}-${String(m[1]).padStart(2, "0")}` : "";
  }

  function looksLikePrivatContext(text) {
    const raw = String(text || "").toLowerCase();
    return /privat|приват|історія|история|карт|рахунок|рахун|uah|грн|₴|клієнт заплатив|клиент заплатил/.test(raw) && !/яндекс|yandex|yoomoney|юmoney|юмани/.test(raw);
  }
  function lineLooksLikeYandex(line, fullText) { return /яндекс|yandex|yoomoney|юmoney|юмани|кошелек|кошел[её]к/i.test(`${line || ""}\n${fullText || ""}`); }

  function parseAmount(line, fullText) {
    const raw = String(line || "").replace(/\u00a0/g, " ");
    const m = raw.match(/([+-])\s*(\d[\d\s.,]*\d|\d)\s*(UAH|грн|₴|USD|\$|EUR|€|RUB|руб|CAD|C\$)/i);
    if (!m) return null;
    const amount = Math.abs(parseLooseNumber(m[2]));
    if (!amount) return null;
    const cur = String(m[3]).toLowerCase();
    let currency = /uah|грн|₴/.test(cur) ? "UAH" : /eur|€/.test(cur) ? "EUR" : /rub|руб/.test(cur) ? "RUB" : /cad|c\$/.test(cur) ? "CAD" : "USD";
    if (currency === "RUB" && looksLikePrivatContext(fullText) && !lineLooksLikeYandex(line, fullText)) currency = "UAH";
    return { amount, currency, direction: m[1] === "+" ? "income" : "expense" };
  }
  function privatUahChannel() { const channels = getManualFinanceChannels(); return channels.find((x) => /приват\s*24.*грн/i.test(String(x || ""))) || "приват 24-грн"; }
  function usefulName(line) { const raw = String(line || "").trim(); if (!raw || /^\d{1,2}:\d{2}$/.test(raw)) return false; if (/^(історія|история|аналітика|аналитика|choose files?|no file chosen)$/i.test(raw)) return false; if (/^[•.*\s-]*\d{3,4}$/.test(raw)) return false; return true; }

  function patchedParseExpenseOcrText(text, sourceImageIndex = 0, uploadedAtDate = "") {
    const original = originalParseOcrText ? originalParseOcrText(text, sourceImageIndex, uploadedAtDate) : { entries: [], warnings: [] };
    const lines = String(text || "").split(/\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    const fullText = lines.join("\n");
    const privatContext = looksLikePrivatContext(fullText);
    const entries = [];
    let currentDate = "";
    let prev = "";
    for (const line of lines) {
      const date = patchedExtractExpenseOcrDate(line);
      if (date) { currentDate = date; prev = ""; continue; }
      const amount = parseAmount(line, fullText);
      if (!amount) { if (usefulName(line)) prev = line; continue; }
      if (amount.currency === "RUB" && privatContext && !lineLooksLikeYandex(line, fullText)) continue;
      const channel = amount.currency === "UAH" ? privatUahChannel() : inferExpenseOcrChannel(line);
      if (privatContext && amount.currency !== "UAH" && !lineLooksLikeYandex(line, fullText)) continue;
      const organization = prev || line.replace(/[+-]\s*\d[\d\s.,]*(UAH|грн|₴|USD|\$|EUR|€|RUB|руб|CAD|C\$)/ig, "").trim();
      entries.push(normalizeExpenseAccountingEntry({
        date: currentDate || uploadedAtDate,
        dateSource: currentDate ? "screenshot" : "upload_fallback",
        uploadedAtDate,
        channel,
        direction: amount.direction,
        localAmount: amount.amount,
        currency: amount.currency,
        usdAmount: null,
        suggestedCategory: amount.direction === "income" ? "serviceIncome" : "business",
        receivedType: amount.direction === "income" ? "serviceincome" : "",
        organization,
        counterparty: organization,
        confidence: 0.8,
        source: "browser_ocr_strict",
        sourceImageIndex
      }, entries.length));
      prev = "";
    }
    if (entries.length) return { entries, warnings: [privatContext ? "Privat24 OCR context detected; non-UAH/YooMoney rows suppressed." : "Browser OCR strict currency parser used; broad OCR rows suppressed."] };
    return { entries: original.entries || [], warnings: [...(original.warnings || []), ...((original.entries || []).length ? [] : ["Browser OCR did not find expense-like rows."])] };
  }

  try { prepareExpenseScreenshotImage = patchedPrepareExpenseScreenshotImage; window.prepareExpenseScreenshotImage = patchedPrepareExpenseScreenshotImage; } catch {}
  try { extractExpenseOcrDate = patchedExtractExpenseOcrDate; window.extractExpenseOcrDate = patchedExtractExpenseOcrDate; } catch {}
  try { parseExpenseOcrText = patchedParseExpenseOcrText; window.parseExpenseOcrText = patchedParseExpenseOcrText; } catch {}
})();
