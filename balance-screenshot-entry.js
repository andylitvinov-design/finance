(function initBalanceScreenshotEntry(root) {
  "use strict";

  const PARSE_ENDPOINT = "./api/parse-balance-screenshot";
  const SAVE_ENDPOINT = "./api/save-balance-snapshot";
  const MAX_IMAGE_COUNT = 8;
  const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i;
  const EDITABLE_FIELDS = ["channel", "currency", "amount", "rate", "usdAmount", "comment"];

  // ----- pure helpers (unit-tested) -----------------------------------------

  function getTodayIso(now = new Date()) {
    const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function normalizeIsoDate(value) {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  }

  function toEditableRows(batchRows = []) {
    return (Array.isArray(batchRows) ? batchRows : []).map((row) => ({
      channel: String(row?.channel || row?.channelRaw || "").trim(),
      currency: String(row?.currency || "").trim().toUpperCase(),
      amount: row?.amount === null || row?.amount === undefined ? "" : String(row.amount),
      rate: row?.rate === null || row?.rate === undefined ? "" : String(row.rate),
      usdAmount: row?.usdAmount === null || row?.usdAmount === undefined ? "" : String(row.usdAmount),
      comment: String(row?.comment || "").trim(),
      confidence: Number.isFinite(Number(row?.confidence)) ? Number(row.confidence) : null,
      duplicateOfExisting: Boolean(row?.duplicateOfExisting),
      duplicateInBatch: Boolean(row?.duplicateInBatch),
    }));
  }

  function makeEmptyRow() {
    return {
      channel: "",
      currency: "",
      amount: "",
      rate: "",
      usdAmount: "",
      comment: "",
      confidence: null,
      duplicateOfExisting: false,
      duplicateInBatch: false,
    };
  }

  function isRowSavable(row) {
    const hasChannel = Boolean(String(row?.channel || "").trim());
    const hasCurrency = Boolean(String(row?.currency || "").trim());
    const hasAmount = String(row?.amount ?? "").trim() !== "" || String(row?.usdAmount ?? "").trim() !== "";
    return hasChannel && hasCurrency && hasAmount;
  }

  function buildSavePayload({ date, rows = [], batchId = "" } = {}) {
    const isoDate = normalizeIsoDate(date);
    const sourceTag = batchId ? `owner_confirmed screenshot ${batchId}` : "owner_confirmed screenshot";
    const savableRows = (Array.isArray(rows) ? rows : [])
      .filter(isRowSavable)
      .map((row) => ({
        date: isoDate,
        channel: String(row.channel || "").trim(),
        currency: String(row.currency || "").trim().toUpperCase(),
        amount: String(row.amount ?? "").trim(),
        rate: String(row.rate ?? "").trim(),
        usdAmount: String(row.usdAmount ?? "").trim(),
        comment: String(row.comment || "").trim() || sourceTag,
      }));
    return { rows: savableRows };
  }

  function summarizeDraft(rows = []) {
    const list = Array.isArray(rows) ? rows : [];
    return {
      total: list.length,
      savable: list.filter(isRowSavable).length,
      duplicates: list.filter((row) => row.duplicateOfExisting).length,
    };
  }

  // Best-effort browser-OCR line parser used only when the AI provider is
  // unavailable. It never invents amounts — unparsed lines are ignored and the
  // user fills the table manually.
  function parseBalanceOcrText(text = "") {
    const rows = [];
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parsed = parseBalanceOcrLine(line);
        if (!parsed) return;
        const row = makeEmptyRow();
        row.channel = parsed.channel;
        row.amount = parsed.amount;
        row.currency = parsed.currency;
        row.confidence = parsed.confidence;
        rows.push(row);
      });
    return rows;
  }

  function parseBalanceOcrLine(line) {
    const cleaned = normalizeOcrWhitespace(line);
    if (!cleaned) return null;

    const tableMatch = cleaned.match(/^([+-]?[\d][\d\s.,]*)\s+(.+?)\s+([+-]?[\d][\d\s.,]*)\s*([A-Za-zА-Яа-я$€₴₽]{1,6})?$/);
    const simpleMatch = cleaned.match(/^(.+?)[\s:]+([+-]?[\d][\d\s.,]*)\s*([A-Za-zА-Яа-я$€₴₽]{1,6})?$/);
    const match = tableMatch || simpleMatch;
    if (!match) return null;

    const rawLabel = tableMatch ? match[2] : match[1];
    const rawAmount = tableMatch ? match[3] : match[2];
    const explicitCurrency = tableMatch ? match[4] : match[3];
    const amount = normalizeOcrAmount(rawAmount);
    if (!amount) return null;

    const channel = normalizeOcrChannelLabel(rawLabel);
    if (!channel || isProbablyNumericOnlyLabel(channel)) return null;

    const currency = normalizeOcrCurrency(explicitCurrency || inferOcrCurrencyFromLabel(channel));
    return { channel, amount, currency, confidence: currency ? 0.62 : 0.38 };
  }

  function normalizeOcrWhitespace(value) {
    return String(value || "")
      .replace(/[|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeOcrAmount(value) {
    const amount = String(value || "")
      .replace(/\s+/g, "")
      .replace(/,/g, ".")
      .replace(/\.(?=.*\.)/g, "");
    return amount && Number.isFinite(Number(amount)) ? amount : "";
  }

  function normalizeOcrChannelLabel(label) {
    let value = normalizeOcrWhitespace(label)
      .replace(/^[\[({]?[A-ZА-ЯІЇЄЁ]{1,4}[\])}]?\s+(?=(?:binance|бинанс|б[иі]тпансе|бтпансе))/i, "")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .trim();

    value = value
      .replace(/(?:б[иі]тпансе|бтпансе|бинансе)/gi, "binance")
      .replace(/(?:заме|заве)/gi, "save")
      .replace(/(?:изас|шзас|издс)/gi, "usdc")
      .replace(/(?:еиг|ешг)/gi, "eur")
      .replace(/\b(?:дол|dol)\b/gi, "usd")
      .replace(/\s+/g, " ")
      .trim();

    return value;
  }

  function isProbablyNumericOnlyLabel(label) {
    return /^[+-]?[\d\s.,]+$/.test(String(label || "").trim());
  }

  function inferOcrCurrencyFromLabel(label) {
    const normalized = ` ${String(label || "").toLowerCase()} `;
    if (/\busdc\b/.test(normalized)) return "USDC";
    if (/\busdt\b/.test(normalized)) return "USDT";
    if (/\busd\b|\bdol\b|\bдол\b/.test(normalized)) return "USD";
    if (/\beur\b|\beuro\b|\bевр\b/.test(normalized)) return "EUR";
    if (/\bcad\b|банк канада/.test(normalized)) return "CAD";
    if (/\buah\b|грн|24-грн|монобанк/.test(normalized)) return "UAH";
    if (/\brub\b|руб/.test(normalized)) return "RUB";
    if (/\bchf\b|франк/.test(normalized)) return "CHF";
    if (/\bgbp\b|фунт/.test(normalized)) return "GBP";
    return "";
  }

  const KNOWN_CURRENCY_CODES = new Set([
    "USD", "EUR", "UAH", "RUB", "CAD", "GBP", "CHF", "PLN", "USDT", "USDC", "BTC", "ETH",
  ]);

  function normalizeOcrCurrency(token) {
    const raw = String(token || "").trim().toUpperCase();
    if (!raw) return "";
    if (raw === "$" || raw === "USD") return "USD";
    if (raw === "€" || raw === "EUR") return "EUR";
    if (raw === "₴" || raw === "UAH" || raw === "ГРН") return "UAH";
    if (raw === "₽" || raw === "RUB" || raw === "РУБ") return "RUB";
    if (KNOWN_CURRENCY_CODES.has(raw)) return raw;
    if (/^[A-Z]{3}$/.test(raw)) return raw;
    return "";
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("Файл не выбран."));
        return;
      }
      const FileReaderImpl = root.FileReader;
      if (!FileReaderImpl) {
        reject(new Error("FileReader недоступен в этом окружении."));
        return;
      }
      const reader = new FileReaderImpl();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        if (!IMAGE_DATA_URL_PATTERN.test(dataUrl)) {
          reject(new Error("Поддерживаются только PNG, JPEG или WEBP."));
          return;
        }
        resolve({ dataUrl, name: String(file.name || "balance-screenshot").slice(0, 120) });
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
      reader.readAsDataURL(file);
    });
  }

  function getKnownChannels() {
    try {
      if (typeof root.getManualFinanceChannels === "function") {
        const channels = root.getManualFinanceChannels();
        if (Array.isArray(channels)) return channels.filter(Boolean);
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  // ----- rendering ----------------------------------------------------------

  function renderEntryPanel(doc = root.document, options = {}) {
    const panel = doc.createElement("div");
    panel.className = "balance-entry-panel";

    const intro = doc.createElement("p");
    intro.className = "balance-entry-note";
    intro.textContent =
      "Загрузите скриншот остатков по каналам. AI разберёт суммы в черновик — ничего не сохраняется, пока вы не подтвердите.";
    panel.appendChild(intro);

    // date row
    const dateRow = doc.createElement("div");
    dateRow.className = "balance-entry-daterow";
    const dateLabel = doc.createElement("label");
    dateLabel.className = "balance-entry-datelabel";
    dateLabel.textContent = "Дата остатков";
    dateLabel.setAttribute("for", "balanceEntryDate");
    const dateInput = doc.createElement("input");
    dateInput.type = "date";
    dateInput.id = "balanceEntryDate";
    dateInput.className = "balance-entry-date";
    dateInput.value = normalizeIsoDate(options.defaultDate) || getTodayIso();
    const todayButton = doc.createElement("button");
    todayButton.type = "button";
    todayButton.className = "secondary balance-entry-today";
    todayButton.textContent = "Сегодня";
    todayButton.title = "Поставить сегодняшнюю дату";
    todayButton.addEventListener("click", (event) => {
      event?.preventDefault?.();
      dateInput.value = getTodayIso();
    });
    dateRow.appendChild(dateLabel);
    dateRow.appendChild(dateInput);
    dateRow.appendChild(todayButton);
    panel.appendChild(dateRow);

    // dropzone
    const dropzone = doc.createElement("div");
    dropzone.className = "balance-entry-dropzone";
    dropzone.setAttribute("role", "button");
    dropzone.setAttribute("tabindex", "0");
    dropzone.innerHTML =
      '<div class="balance-entry-dropzone-icon">🧾</div>' +
      '<div class="balance-entry-dropzone-title">Перетащите скриншот сюда</div>' +
      '<div class="balance-entry-dropzone-sub">или нажмите, чтобы выбрать · можно вставить из буфера (Ctrl/⌘+V)</div>';
    const fileInput = doc.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp";
    fileInput.multiple = true;
    fileInput.className = "balance-entry-fileinput";
    fileInput.style.display = "none";
    dropzone.appendChild(fileInput);
    panel.appendChild(dropzone);

    // thumbnails (original screenshot provenance)
    const thumbs = doc.createElement("div");
    thumbs.className = "balance-entry-thumbs";
    panel.appendChild(thumbs);

    // status
    const status = doc.createElement("div");
    status.className = "balance-entry-status";
    status.setAttribute("aria-live", "polite");
    panel.appendChild(status);

    // preview container
    const preview = doc.createElement("div");
    preview.className = "balance-entry-preview";
    panel.appendChild(preview);

    const view = {
      doc,
      panel,
      dateInput,
      dropzone,
      fileInput,
      thumbs,
      status,
      preview,
      rows: [],
      batchId: "",
      screenshots: [],
      loading: false,
      saving: false,
    };

    wireUploadHandlers(view);
    renderPreview(view);
    setStatus(view, "Готово к загрузке скриншота.", "idle");

    return panel;
  }

  function setStatus(view, message, tone = "idle") {
    if (!view?.status) return;
    view.status.textContent = message || "";
    view.status.className = `balance-entry-status${tone && tone !== "idle" ? ` balance-entry-status--${tone}` : ""}`;
  }

  function wireUploadHandlers(view) {
    const { dropzone, fileInput, doc } = view;

    dropzone.addEventListener("click", () => {
      if (!view.loading) fileInput.click?.();
    });
    dropzone.addEventListener("keydown", (event) => {
      if (event?.key === "Enter" || event?.key === " ") {
        event.preventDefault?.();
        if (!view.loading) fileInput.click?.();
      }
    });
    fileInput.addEventListener("change", (event) => {
      const files = Array.from(event?.target?.files || []);
      if (files.length) handleFiles(view, files);
      try {
        fileInput.value = "";
      } catch {
        /* ignore */
      }
    });

    ["dragenter", "dragover"].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        dropzone.classList?.add("is-dragover");
      });
    });
    ["dragleave", "dragend", "drop"].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        dropzone.classList?.remove("is-dragover");
      });
    });
    dropzone.addEventListener("drop", (event) => {
      const files = Array.from(event?.dataTransfer?.files || []).filter((file) =>
        /^image\/(png|jpe?g|webp)$/.test(String(file?.type || ""))
      );
      if (files.length) handleFiles(view, files);
    });

    if (doc?.addEventListener) {
      doc.addEventListener("paste", (event) => {
        if (!view.panel?.isConnected) return;
        const items = Array.from(event?.clipboardData?.items || []);
        const files = items
          .filter((item) => String(item?.type || "").startsWith("image/"))
          .map((item) => item.getAsFile?.())
          .filter(Boolean);
        if (files.length) {
          event?.preventDefault?.();
          handleFiles(view, files);
        }
      });
    }
  }

  async function handleFiles(view, files) {
    const limited = files.slice(0, MAX_IMAGE_COUNT);
    if (files.length > MAX_IMAGE_COUNT) {
      setStatus(view, `Можно не больше ${MAX_IMAGE_COUNT} скриншотов за раз. Лишние пропущены.`, "warn");
    }
    view.loading = true;
    setStatus(view, "Готовлю скриншоты…", "busy");
    let images = [];
    try {
      images = await Promise.all(limited.map((file) => readImageFile(file)));
    } catch (error) {
      view.loading = false;
      setStatus(view, error?.message || "Не удалось прочитать файлы.", "error");
      return;
    }
    renderThumbnails(view, images);
    await requestDraft(view, images);
  }

  function renderThumbnails(view, images) {
    const { thumbs, doc } = view;
    if (!thumbs) return;
    thumbs.innerHTML = "";
    images.forEach((image) => {
      const figure = doc.createElement("figure");
      figure.className = "balance-entry-thumb";
      const img = doc.createElement("img");
      img.src = image.dataUrl;
      img.alt = image.name;
      figure.appendChild(img);
      const caption = doc.createElement("figcaption");
      caption.textContent = image.name;
      figure.appendChild(caption);
      thumbs.appendChild(figure);
    });
  }

  async function requestDraft(view, images) {
    view.loading = true;
    setStatus(view, "Отправляю скриншот на разбор…", "busy");
    try {
      const response = await fetch(PARSE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          date: view.dateInput?.value || getTodayIso(),
          channels: getKnownChannels(),
          images,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Разбор не удался (${response.status}).`);
      }
      const batch = payload.batch || {};
      view.batchId = batch.batchId || "";
      view.screenshots = batch.screenshots || images;
      const draftRows = toEditableRows(batch.rows);

      if (payload.source === "browser-ocr-required" || !draftRows.length) {
        const fallback = await runBrowserOcrFallback(view, images);
        view.rows = fallback.rows.length ? fallback.rows : draftRows;
        if (!view.rows.length) view.rows = [makeEmptyRow()];
        const warnings = [...(payload.warnings || []), ...fallback.warnings];
        renderPreview(view);
        setStatus(
          view,
          view.rows.some(isRowSavable)
            ? `Серверный AI недоступен — использован разбор в браузере. Проверьте и дополните строки.${warnings.length ? " " + warnings.join(" ") : ""}`
            : "AI недоступен. Добавьте строки остатков вручную и сохраните.",
          "warn"
        );
        return;
      }

      view.rows = draftRows;
      renderPreview(view);
      const summary = summarizeDraft(view.rows);
      const dupNote = summary.duplicates ? ` Возможных дубликатов: ${summary.duplicates}.` : "";
      const warnNote = (batch.warnings || []).length ? ` ${batch.warnings.join(" ")}` : "";
      setStatus(
        view,
        `Распознано строк: ${summary.total}. Проверьте суммы и каналы перед сохранением.${dupNote}${warnNote}`,
        summary.duplicates ? "warn" : "ok"
      );
    } catch (error) {
      const fallback = await runBrowserOcrFallback(view, images);
      view.rows = fallback.rows.length ? fallback.rows : [makeEmptyRow()];
      renderPreview(view);
      setStatus(
        view,
        `${error?.message || "Разбор не удался."} ${fallback.rows.length ? "Использован разбор в браузере — проверьте строки." : "Добавьте строки вручную."}`,
        "warn"
      );
    } finally {
      view.loading = false;
    }
  }

  async function runBrowserOcrFallback(view, images) {
    const warnings = [];
    if (!root.Tesseract?.recognize) {
      return { rows: [], warnings: ["OCR в браузере недоступен."] };
    }
    const rows = [];
    for (const [index, image] of images.entries()) {
      setStatus(view, `OCR в браузере: скриншот ${index + 1} из ${images.length}…`, "busy");
      try {
        const result = await root.Tesseract.recognize(image.dataUrl, "eng+rus+ukr", { logger: () => {} });
        rows.push(...parseBalanceOcrText(result?.data?.text || ""));
      } catch (error) {
        warnings.push(String(error?.message || error));
      }
    }
    return { rows, warnings };
  }

  function renderPreview(view) {
    const { preview, doc } = view;
    if (!preview) return;
    preview.innerHTML = "";

    const rows = Array.isArray(view.rows) ? view.rows : [];
    if (!rows.length) {
      const empty = doc.createElement("div");
      empty.className = "balance-entry-empty";
      empty.textContent = "Пока нет строк. Загрузите скриншот или добавьте строку вручную.";
      preview.appendChild(empty);
    } else {
      const table = doc.createElement("table");
      table.className = "balance-entry-table";
      const thead = doc.createElement("thead");
      thead.innerHTML =
        "<tr>" +
        ["Канал", "Валюта", "Сумма", "Курс", "Сумма USD", "Комментарий", ""]
          .map((label) => `<th>${label}</th>`)
          .join("") +
        "</tr>";
      table.appendChild(thead);
      const tbody = doc.createElement("tbody");
      rows.forEach((row, index) => tbody.appendChild(renderRow(view, row, index)));
      table.appendChild(tbody);
      preview.appendChild(table);
    }

    const controls = doc.createElement("div");
    controls.className = "balance-entry-controls";

    const addButton = doc.createElement("button");
    addButton.type = "button";
    addButton.className = "ghost balance-entry-add";
    addButton.textContent = "+ Добавить строку";
    addButton.addEventListener("click", () => {
      view.rows = [...(view.rows || []), makeEmptyRow()];
      renderPreview(view);
    });
    controls.appendChild(addButton);

    const summary = summarizeDraft(rows);
    const saveButton = doc.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary balance-entry-save";
    saveButton.textContent = view.saving ? "Сохраняю…" : `Подтвердить и сохранить (${summary.savable})`;
    saveButton.disabled = view.saving || summary.savable === 0;
    saveButton.addEventListener("click", () => confirmAndSave(view));
    controls.appendChild(saveButton);

    preview.appendChild(controls);
  }

  function renderRow(view, row, index) {
    const { doc } = view;
    const tr = doc.createElement("tr");
    tr.className = "balance-entry-row";
    if (row.duplicateOfExisting) tr.classList?.add("is-duplicate");

    EDITABLE_FIELDS.forEach((field) => {
      const td = doc.createElement("td");
      td.className = `balance-entry-cell balance-entry-cell--${field}`;
      const input = doc.createElement("input");
      input.type = field === "amount" || field === "rate" || field === "usdAmount" ? "text" : "text";
      input.className = "balance-entry-input";
      input.value = row[field] == null ? "" : String(row[field]);
      input.setAttribute("data-field", field);
      input.setAttribute("inputmode", field === "channel" || field === "currency" || field === "comment" ? "text" : "decimal");
      input.addEventListener("input", (event) => {
        view.rows[index] = { ...view.rows[index], [field]: event?.target?.value ?? "" };
        updateSaveButton(view);
      });
      td.appendChild(input);
      if (field === "channel" && row.duplicateOfExisting) {
        const badge = doc.createElement("span");
        badge.className = "balance-entry-dupbadge";
        badge.textContent = "дубликат";
        badge.title = "Уже есть строка с такой датой, каналом и валютой. Сохранение перезапишет её.";
        td.appendChild(badge);
      }
      tr.appendChild(td);
    });

    const actionTd = doc.createElement("td");
    actionTd.className = "balance-entry-cell balance-entry-cell--actions";
    const removeButton = doc.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost balance-entry-remove";
    removeButton.textContent = "✕";
    removeButton.title = "Удалить строку";
    removeButton.setAttribute("aria-label", "Удалить строку");
    removeButton.addEventListener("click", () => {
      view.rows = view.rows.filter((_, position) => position !== index);
      renderPreview(view);
    });
    actionTd.appendChild(removeButton);
    tr.appendChild(actionTd);

    return tr;
  }

  function updateSaveButton(view) {
    const saveButton = view.preview?.querySelector?.(".balance-entry-save");
    if (!saveButton) return;
    const summary = summarizeDraft(view.rows);
    saveButton.disabled = view.saving || summary.savable === 0;
    saveButton.textContent = view.saving ? "Сохраняю…" : `Подтвердить и сохранить (${summary.savable})`;
  }

  async function confirmAndSave(view) {
    if (view.saving) return;
    const date = normalizeIsoDate(view.dateInput?.value);
    if (!date) {
      setStatus(view, "Укажите дату остатков перед сохранением.", "error");
      return;
    }
    const payload = buildSavePayload({ date, rows: view.rows, batchId: view.batchId });
    if (!payload.rows.length) {
      setStatus(view, "Нет строк для сохранения. Заполните канал, валюту и сумму.", "error");
      return;
    }
    view.saving = true;
    updateSaveButton(view);
    setStatus(view, `Сохраняю ${payload.rows.length} строк остатков…`, "busy");
    try {
      const response = await fetch(SAVE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Сохранение не удалось (${response.status}).`);
      }
      const inserted = Number(result.inserted || 0);
      const updated = Number(result.updated || 0);
      setStatus(
        view,
        `Остатки сохранены: добавлено ${inserted}, обновлено ${updated}. Данные внесены в БД.`,
        "ok"
      );
      view.rows = [];
      view.batchId = "";
      view.screenshots = [];
      if (view.thumbs) view.thumbs.innerHTML = "";
      renderPreview(view);
    } catch (error) {
      setStatus(view, error?.message || "Сохранение не удалось.", "error");
    } finally {
      view.saving = false;
      updateSaveButton(view);
    }
  }

  const api = {
    getTodayIso,
    normalizeIsoDate,
    toEditableRows,
    makeEmptyRow,
    isRowSavable,
    buildSavePayload,
    summarizeDraft,
    parseBalanceOcrText,
    normalizeOcrCurrency,
    renderEntryPanel,
    EDITABLE_FIELDS,
  };

  root.EzohataBalanceScreenshotEntry = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
