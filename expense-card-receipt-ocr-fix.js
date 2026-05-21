// Parses Google Wallet / Payoneer receipt screenshots after server OCR fallback.
(function () {
  const originalParse = typeof parseExpenseOcrText === "function" ? parseExpenseOcrText : null;
  const months = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,"травня":5,"мая":5 };
  const norm = (v) => (typeof normalizeLookupText === "function" ? normalizeLookupText(v) : String(v || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim());
  const year = () => String(elements?.endDate?.value || elements?.startDate?.value || new Date().toISOString()).slice(0, 4);
  const channels = () => { try { return getManualFinanceChannels() || []; } catch { return []; } };
  function ccy(v) {
    const raw = String(v || "").toLowerCase();
    if (/€|eur|евр/.test(raw)) return "EUR";
    if (/c\$|cad/.test(raw)) return "CAD";
    if (/uah|грн|₴/.test(raw)) return "UAH";
    if (/rub|руб/.test(raw)) return "RUB";
    if (/\$|usd|дол/.test(raw)) return "USD";
    return "";
  }
  function channelCurrency(channel) {
    try { return String(inferManualFinanceChannelCurrency(channel) || "").toUpperCase(); } catch {}
    return ccy(channel) || (/uah|грн|приват|моно/i.test(channel) ? "UAH" : "USD");
  }
  function findChannel(fullText, currency) {
    const list = channels();
    const provider = /payoneer/i.test(fullText) ? "payoneer" : (/wise|transferwise/i.test(fullText) ? "wise" : "");
    const byProvider = provider ? list.find((x) => norm(x).includes(provider) && (!currency || channelCurrency(x) === currency)) : "";
    return byProvider || list.find((x) => !currency || channelCurrency(x) === currency) || list[0] || "";
  }
  function isReceipt(text) {
    const raw = norm(text);
    return /payoneer|google wallet|google pay|wallet|mastercard|visa|card/.test(raw) && /completed|purchase|recent activity|transaction details|made on phone/.test(raw);
  }
  function num(v) {
    try { const n = Math.abs(parseLooseNumber(v)); if (n) return n; } catch {}
    const s = String(v || "").replace(/\s+/g, "").replace(/,/g, "");
    const n = Math.abs(Number(s));
    return Number.isFinite(n) ? n : 0;
  }
  function amount(line) {
    const raw = String(line || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const p = raw.match(/(?:^|\s)(€|eur|\$|usd|c\$|cad|uah|грн|₴|rub|руб)\s*([+-]?\d[\d\s.,]*\d|[+-]?\d)(?=$|\s|[^\d])/i);
    const s = raw.match(/(?:^|\s)([+-]?\d[\d\s.,]*\d|[+-]?\d)\s*(€|eur|\$|usd|c\$|cad|uah|грн|₴|rub|руб)(?=$|\s|[^\p{L}])/iu);
    const m = p || s;
    if (!m) return null;
    const currency = ccy(p ? m[1] : m[2]);
    const value = num(p ? m[2] : m[1]);
    if (!currency || !value) return null;
    const around = raw.slice(Math.max(0, m.index - 20), Math.min(raw.length, m.index + m[0].length + 20)).toLowerCase();
    if (/balance|available|остат|залиш|баланс|fee|комисс|total/.test(around)) return null;
    return { amount: value, currency };
  }
  function dateFrom(line) {
    const raw = String(line || "").trim();
    const iso = raw.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
    if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
    const names = Object.keys(months).join("|");
    const md = raw.toLowerCase().match(new RegExp(`\\b(${names})\\.?\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\b`, "iu"));
    if (md) return `${md[3] || year()}-${String(months[md[1].replace(/\.$/, "")]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
    return "";
  }
  function goodName(line) {
    const raw = String(line || "").trim();
    if (!raw || amount(raw) || dateFrom(raw)) return false;
    if (/^[•.*\s-]*\d{3,4}$/.test(raw)) return false;
    if (/^(completed|recent activity|purchase made|payoneer card|get more|set it up|statement name|no file chosen|choose files?)\b/i.test(raw)) return false;
    if (/card|mastercard|visa|account ending|contactless|receipt|phone/i.test(raw)) return false;
    return /[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(raw);
  }
  function clean(line) {
    let out = String(line || "").replace(/(?:€|eur|\$|usd|c\$|cad|uah|грн|₴|rub|руб)\s*[+-]?\d[\d\s.,]*/ig, "").replace(/[+-]?\d[\d\s.,]*\s*(?:€|eur|\$|usd|c\$|cad|uah|грн|₴|rub|руб)/ig, "").replace(/\s+/g, " ").trim();
    try { if (typeof cleanupExpenseOcrOrganization === "function") out = cleanupExpenseOcrOrganization(out) || out; } catch {}
    return out || "Card purchase";
  }
  function parseCard(text, sourceImageIndex, uploadedAtDate) {
    const lines = String(text || "").split(/\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    const full = lines.join("\n");
    if (!isReceipt(full)) return { entries: [], warnings: [] };
    const date = lines.map(dateFrom).find(Boolean) || String(uploadedAtDate || "");
    for (let i = 0; i < lines.length; i += 1) {
      const a = amount(lines[i]);
      if (!a) continue;
      const merchant = clean(goodName(clean(lines[i])) ? lines[i] : (lines.slice(Math.max(0, i - 5), i).reverse().find(goodName) || lines.slice(i + 1, i + 5).find(goodName) || "Card purchase"));
      const channel = findChannel(full, a.currency);
      const id = ["browser-ocr-card", date || "unknown-date", norm(channel), a.currency, String(a.amount), norm(merchant)].join(":");
      const entry = { date, dateSource: date ? "screenshot" : "upload_fallback", uploadedAtDate, channel, direction: "expense", localAmount: a.amount, currency: a.currency, usdAmount: null, suggestedCategory: "business", organization: merchant, counterparty: merchant, confidence: 0.78, source: "browser_ocr_card_receipt", sourceImageIndex, sourceTransactionId: id, rawSourceId: id, raw_source_id: id, externalId: id, external_id: id };
      return { entries: [typeof normalizeExpenseAccountingEntry === "function" ? normalizeExpenseAccountingEntry(entry, 0) : entry], warnings: ["Card receipt OCR fallback parsed unsigned purchase amount."] };
    }
    return { entries: [], warnings: [] };
  }
  function patched(text, sourceImageIndex = 0, uploadedAtDate = "") {
    const original = originalParse ? originalParse(text, sourceImageIndex, uploadedAtDate) : { entries: [], warnings: [] };
    if (original?.entries?.length) return original;
    const parsed = parseCard(text, sourceImageIndex, uploadedAtDate);
    return parsed.entries.length ? { entries: parsed.entries, warnings: [...(original?.warnings || []), ...parsed.warnings] } : original;
  }
  try { parseExpenseOcrText = patched; window.parseExpenseOcrText = patched; } catch {}
})();