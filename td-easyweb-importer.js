(function () {
  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseMoney(raw) {
    const text = compact(raw).replace(/,/g, "").replace(/[^\d.-]/g, "");
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function toIsoDate(raw) {
    const text = compact(raw);
    const numericMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (numericMatch) {
      const [, month, day, year] = numericMatch;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    const textMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (!textMatch) return "";
    const monthLookup = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      sept: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const month = monthLookup[textMatch[1].slice(0, 4).replace(/\.$/, "").toLowerCase()] || monthLookup[textMatch[1].slice(0, 3).toLowerCase()];
    const day = textMatch[2].padStart(2, "0");
    const year = textMatch[3];
    if (!month) return "";
    return `${year}-${month}-${day}`;
  }

  function readAccount() {
    const title = compact(document.querySelector("h1, h2, [data-automation-id='account-name']")?.textContent);
    const mask = compact(document.body.textContent.match(/\*{2,}\d{2,4}/)?.[0]);
    return {
      accountId: [title, mask].filter(Boolean).join(":") || "td-account",
      accountName: title || "TD Bank account",
      accountMask: mask || "",
    };
  }

  function readBalances() {
    const text = document.body.textContent || "";
    const amounts = text.match(/\$?\s?-?\d[\d,]*\.\d{2}/g) || [];
    return {
      amount: parseMoney(amounts[0] || ""),
      availableAmount: parseMoney(amounts[1] || amounts[0] || ""),
    };
  }

  function getCellText(cell) {
    return compact(cell?.innerText || cell?.textContent || "");
  }

  function getRowCells(row) {
    const cells = [...(row.querySelectorAll?.("th, td, [role='cell'], [role='columnheader']") || [])];
    return cells.length ? cells : [...(row.children || [])];
  }

  function normalizeHeader(value) {
    return compact(value).toLowerCase().replace(/[^a-z]+/g, "");
  }

  function isVisibleRow(row) {
    if (row.hidden || row.getAttribute?.("aria-hidden") === "true") return false;
    const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(row) : null;
    return !(style?.display === "none" || style?.visibility === "hidden");
  }

  function buildHeaderMap(cells) {
    const headers = cells.map((cell) => normalizeHeader(getCellText(cell)));
    return {
      date: headers.findIndex((header) => header === "date" || header === "transactiondate"),
      description: headers.findIndex((header) => header === "transactiondescription" || header === "description"),
      withdrawals: headers.findIndex((header) => header === "withdrawals" || header === "withdrawal" || header === "debit"),
      deposits: headers.findIndex((header) => header === "deposits" || header === "deposit" || header === "credit"),
      balance: headers.findIndex((header) => header === "balance"),
    };
  }

  function isActivityHeaderMap(map) {
    return map.date >= 0 && map.description >= 0 && map.withdrawals >= 0 && map.deposits >= 0 && map.balance >= 0;
  }

  function findActivityTable() {
    const tables = [...document.querySelectorAll("table")];
    for (const table of tables) {
      const rows = [...(table.querySelectorAll?.("tr, [role='row']") || [])];
      const headerIndex = rows.findIndex((row) => isActivityHeaderMap(buildHeaderMap(getRowCells(row))));
      if (headerIndex >= 0) {
        return {
          table,
          rows,
          headerIndex,
          headerMap: buildHeaderMap(getRowCells(rows[headerIndex])),
        };
      }
    }

    const rows = [...document.querySelectorAll("tr, [role='row']")];
    const headerIndex = rows.findIndex((row) => isActivityHeaderMap(buildHeaderMap(getRowCells(row))));
    if (headerIndex < 0) return null;
    return {
      table: null,
      rows,
      headerIndex,
      headerMap: buildHeaderMap(getRowCells(rows[headerIndex])),
    };
  }

  function parseActivityRow(row, headerMap, account) {
    if (!isVisibleRow(row)) return null;
    const cells = getRowCells(row).map(getCellText);
    if (cells.length <= Math.max(headerMap.date, headerMap.description, headerMap.withdrawals, headerMap.deposits)) return null;

    const occurredAt = toIsoDate(cells[headerMap.date]);
    const name = compact(cells[headerMap.description] || "TD transaction");
    const withdrawalAmount = parseMoney(cells[headerMap.withdrawals]);
    const depositAmount = parseMoney(cells[headerMap.deposits]);
    const amount = withdrawalAmount || depositAmount;
    if (!occurredAt || !name || !amount) return null;

    const runningBalance = headerMap.balance >= 0 ? parseMoney(cells[headerMap.balance]) : 0;
    const direction = withdrawalAmount ? "expense" : "income";
    const cashFlowDirection = withdrawalAmount ? "out" : "in";

    return {
      providerTransactionId: [account.accountMask, occurredAt, name, cashFlowDirection, amount, runningBalance].join(":"),
      accountId: account.accountId,
      accountName: account.accountName,
      accountMask: account.accountMask,
      occurredAt,
      name,
      amount,
      currency: "CAD",
      direction,
      cashFlowDirection,
      runningBalance,
      runningBalanceCurrency: "CAD",
      rawType: "td_easyweb_activity",
      raw: {
        date: cells[headerMap.date],
        description: cells[headerMap.description],
        withdrawal: cells[headerMap.withdrawals],
        deposit: cells[headerMap.deposits],
        balance: headerMap.balance >= 0 ? cells[headerMap.balance] : "",
      },
    };
  }

  function parseTextRow(row, account) {
    const text = compact(row.innerText || row.textContent || "");
    if (!text) return null;
    const moneyValues = text.match(/\$?\s?-?\d[\d,]*\.\d{2}/g) || [];
    const dateMatch = text.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
    if (!dateMatch || moneyValues.length < 2) return null;

    const lines = text.split(/\n+/).map(compact).filter(Boolean);
    const dateIndex = lines.findIndex((line) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(line));
    if (dateIndex < 0) return null;
    const nameCandidate = [...lines.slice(0, dateIndex).reverse(), ...lines.slice(dateIndex + 1)]
      .find((line) => !/\d{1,2}\/\d{1,2}\/\d{4}/.test(line) && !/\$?\s?-?\d[\d,]*\.\d{2}/.test(line) && !/^Open transaction details/i.test(line));
    const amount = moneyValues[0];
    const runningBalance = moneyValues[1];
    const occurredAt = toIsoDate(dateMatch[0]);
    const name = compact(nameCandidate || "TD transaction");

    return {
      providerTransactionId: [account.accountMask, occurredAt, name, amount, runningBalance].join(":"),
      accountId: account.accountId,
      accountName: account.accountName,
      accountMask: account.accountMask,
      occurredAt,
      name,
      amount: parseMoney(amount),
      currency: "CAD",
      direction: amount.includes("-") ? "expense" : "income",
      cashFlowDirection: amount.includes("-") ? "out" : "in",
      runningBalance: parseMoney(runningBalance),
      runningBalanceCurrency: "CAD",
      rawType: account.accountName.toLowerCase().includes("visa") ? "td_easyweb_credit_activity" : "td_easyweb_activity",
    };
  }

  function collect(options = {}) {
    const account = readAccount();
    const balances = readBalances();
    const activityTable = findActivityTable();
    const activityRows = activityTable
      ? activityTable.rows.slice(activityTable.headerIndex + 1).filter(isVisibleRow)
      : [];
    const parsedActivityRows = activityTable
      ? activityRows.map((row) => parseActivityRow(row, activityTable.headerMap, account)).filter(Boolean)
      : [];
    const parsedTextRows = [...document.querySelectorAll("tr, [role='row']")]
      .map((row) => parseTextRow(row, account))
      .filter(Boolean);
    const rows = parsedActivityRows.length ? parsedActivityRows : parsedTextRows;
    const unique = [...new Map(rows.map((row) => [row.providerTransactionId, row])).values()];
    const debug = {
      tdActivityTableFound: Boolean(activityTable),
      rowsFound: activityTable ? activityRows.length : [...document.querySelectorAll("tr, [role='row']")].filter(isVisibleRow).length,
      parsedRows: unique.length,
    };

    return {
      source: {
        provider: "tdbank",
        accountId: account.accountId,
        accountName: account.accountName,
        accountMask: account.accountMask,
        currency: "CAD",
        rawType: "td_easyweb_activity",
        requestedStartDate: compact(options.from),
        requestedEndDate: compact(options.to),
      },
      startDate: unique.at(-1)?.occurredAt || compact(options.from),
      endDate: unique[0]?.occurredAt || compact(options.to),
      items: unique,
      debug,
      balances: [{
        accountId: account.accountId,
        accountName: account.accountName,
        accountMask: account.accountMask,
        amount: balances.amount,
        availableAmount: balances.availableAmount,
        currency: "CAD",
      }],
    };
  }

  window.TD_EASYWEB_IMPORTER = { collect };
})();
