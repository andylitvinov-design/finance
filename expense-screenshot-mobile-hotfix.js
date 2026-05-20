// Hotfix: make mobile screenshot upload/OCR more tolerant for Privat24 images.
(function () {
  const MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;
  const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
  const IMAGE_MIME = /^image\/(png|jpe?g|webp)$/i;
  const MONTHS = {
    "січня":"01","сiчня":"01","января":"01",
    "лютого":"02","февраля":"02",
    "березня":"03","марта":"03",
    "квітня":"04","квiтня":"04","апреля":"04",
    "травня":"05","мая":"05",
    "червня":"06","июня":"06",
    "липня":"07","июля":"07",
    "серпня":"08","августа":"08",
    "вересня":"09","сентября":"09",
    "жовтня":"10","октября":"10",
    "листопада":"11","ноября":"11",
    "грудня":"12","декабря":"12"
  };

  const originalExtractDate = typeof extractExpenseOcrDate === "function" ? extractExpenseOcrDate : null;
  const originalParseOcrText = typeof parseExpenseOcrText === "function" ? parseExpenseOcrText : null;

  function yearFromUi() {
    return String(elements?.endDate?.value || elements?.startDate?.value || new Date().toISOString()).slice(0, 4) || String(new Date().getFullYear());
  }

  function mimeFromFile(file) {
    const type = String(file?.type || "").toLowerCase();
    if (IMAGE_MIME.test(type)) return type.replace("image/jpg", "image/jpeg");
    const name = String(file?.name || "").toLowerCase();
    if (/\.png$/.test(name)) return "image/png";
    if (/\.webp$/.test(name)) return "image/webp";
    if (/\.jpe?g$/.test(name)) return "image/jpeg";
    return "";
  }

  function acceptedImage(file) {
    return IMAGE_MIME.test(String(file?.type || "")) || IMAGE_EXT.test(String(file?.name || ""));
  }

  function fileReaderDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`read failed: ${file?.name || "screenshot"}`));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  function bufferToDataUrl(buffer, mime) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  async function readDataUrl(file, mime) {
    try {
      const dataUrl = await fileReaderDataUrl(file);
      if (/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) return dataUrl;
    } catch {}
    if (typeof file?.arrayBuffer !== "function") throw new Error(`Не удалось прочитать ${file?.name || "скриншот"}.`);
    return bufferToDataUrl(await file.arrayBuffer(), mime);
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
    if (!acceptedImage(file)) throw new Error(`Файл ${file?.name || ""} должен быть PNG, JPEG или WEBP.`);
    const mime = mimeFromFile(file) || "image/jpeg";
    const dataUrl = await readDataUrl(file, mime);
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) throw new Error(`Файл ${file?.name || "скриншот"} не похож на изображение.`);
    if (dataUrl.length > MAX_DATA_URL_LENGTH) throw new Error(`Скриншот ${file?.name || ""} слишком большой.`);
    try {
      const image = await decode(dataUrl);
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width || maxSide, image.height || maxSide));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((image.width || maxSide) * scale));
      canvas.height = Math.max(1, Math.round((image.height || maxSide) * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const resized = canvas.toDataURL("image/jpeg", 0.82);
      if (resized.length <= MAX_DATA_URL_LENGTH) return { name: file?.name || "screenshot", dataUrl: resized, uploadedAtDate: buildLocalTodayIsoDate() };
    } catch {}
    return { name: file?.name || "screenshot", dataUrl, uploadedAtDate: buildLocalTodayIsoDate() };
  }

  function patchedExtractExpenseOcrDate(line) {
    const direct = originalExtractDate ? originalExtractDate(line) : "";
    if (direct) return direct;
    const raw = String(line || "").toLowerCase().replace(/ё/g, "е");
    const monthNames = Object.keys(MONTHS).join("|");
    const match = raw.match(new RegExp(`(?:^|\\b)(\\d{1,2})\\s+(${monthNames})(?:\\b|$)`, "i"));
    return match ? `${yearFromUi()}-${MONTHS[match[2]]}-${String(match[1]).padStart(2, "0")}` : "";
  }

  function parseAmount(line) {
    const raw = String(line || "").replace(/\u00a0/g, " ");
    const match = raw.match(/([+-])?\s*(\d[\d\s.,]*\d|\d)\s*(UAH|грн|₴|USD|\$|EUR|€|RUB|руб|CAD|C\$)/i);
    if (!match) return null;
    const amount = Math.abs(parseLooseNumber(match[2]));
    if (!amount) return null;
    const cur = String(match[3]).toLowerCase();
    const currency = /uah|грн|₴/.test(cur) ? "UAH" : /eur|€/.test(cur) ? "EUR" : /rub|руб/.test(cur) ? "RUB" : /cad|c\$/.test(cur) ? "CAD" : "USD";
    return { amount, currency, direction: match[1] === "+" ? "income" : "expense" };
  }

  function privatUahChannel() {
    const channels = getManualFinanceChannels();
    return channels.find((channel) => /приват\s*24.*грн/i.test(String(channel || ""))) || "приват 24-грн";
  }

  function patchedParseExpenseOcrText(text, sourceImageIndex = 0, uploadedAtDate = "") {
    const original = originalParseOcrText ? originalParseOcrText(text, sourceImageIndex, uploadedAtDate) : { entries: [], warnings: [] };
    const lines = String(text || "").split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const entries = [];
    let currentDate = "";
    let previousText = "";
    for (const line of lines) {
      const date = patchedExtractExpenseOcrDate(line);
      if (date) { currentDate = date; previousText = ""; continue; }
      const amount = parseAmount(line);
      if (!amount) {
        if (!/^\d{1,2}:\d{2}$/.test(line) && !/^(історія|история|аналітика|аналитика)$/i.test(line)) previousText = line;
        continue;
      }
      const channel = amount.currency === "UAH" ? privatUahChannel() : inferExpenseOcrChannel(line);
      const organization = previousText || line.replace(/[+-]?\s*\d[\d\s.,]*(UAH|грн|₴|USD|\$|EUR|€|RUB|руб|CAD|C\$)/ig, "").trim();
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
        confidence: 0.72,
        source: "browser_ocr",
        sourceImageIndex
      }, entries.length));
      previousText = "";
    }
    const merged = [...entries];
    (original.entries || []).forEach((entry) => {
      const duplicate = merged.some((candidate) => candidate.date === entry.date && candidate.channel === entry.channel && candidate.currency === entry.currency && Math.abs(Number(candidate.localAmount || 0) - Number(entry.localAmount || 0)) < 0.0001);
      if (!duplicate) merged.push(entry);
    });
    return { entries: merged, warnings: [...(original.warnings || []), ...(merged.length ? [] : ["Browser OCR did not find expense-like rows."])] };
  }

  try { prepareExpenseScreenshotImage = patchedPrepareExpenseScreenshotImage; window.prepareExpenseScreenshotImage = patchedPrepareExpenseScreenshotImage; } catch {}
  try { extractExpenseOcrDate = patchedExtractExpenseOcrDate; window.extractExpenseOcrDate = patchedExtractExpenseOcrDate; } catch {}
  try { parseExpenseOcrText = patchedParseExpenseOcrText; window.parseExpenseOcrText = patchedParseExpenseOcrText; } catch {}
})();
