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
    const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return "";
    const [, month, day, year] = match;
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

  function parseRow(row, account) {
    const text = compact(row.innerText || row.textContent || "");
    if (!text) return null;
    const moneyValues = text.match(/\$?\s?-?\d[\d,]*\.\d{2}/g) || [];
    const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);
    if (!dateMatch || moneyValues.length < 2) return null;

    const lines = text.split(/\n+/).map(compact).filter(Boolean);
    const dateIndex = lines.findIndex((line) => /\d{2}\/\d{2}\/\d{4}/.test(line));
    if (dateIndex < 0) return null;
    const nameCandidate = [...lines.slice(0, dateIndex).reverse(), ...lines.slice(dateIndex + 1)]
      .find((line) => !/\d{2}\/\d{2}\/\d{4}/.test(line) && !/\$?\s?-?\d[\d,]*\.\d{2}/.test(line) && !/^Open transaction details/i.test(line));
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
      runningBalance: parseMoney(runningBalance),
      runningBalanceCurrency: "CAD",
      rawType: account.accountName.toLowerCase().includes("visa") ? "td_easyweb_credit_activity" : "td_easyweb_activity",
    };
  }

  function collect(options = {}) {
    const account = readAccount();
    const balances = readBalances();
    const rows = [...document.querySelectorAll("tr, [role='row']")]
      .map((row) => parseRow(row, account))
      .filter(Boolean);
    const unique = [...new Map(rows.map((row) => [row.providerTransactionId, row])).values()];

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
