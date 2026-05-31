// Owner-confirmed May 2026 current-balance snapshot repair.
// Scope: UI/current balance selection only. Does not change Ledger, amount_net, provider imports, gross/net/fee, or movement semantics.
(function attachCurrentBalanceSnapshotFix(globalScope) {
  const OWNER_CONFIRMED_MAY_CURRENT_BALANCE_DATE = "2026-05-28";

  const STALE_MAY_CURRENT_BALANCE_ROWS = [
    { channel: "binance save", currency: "USD", amount: 7425 },
    { channel: "Бинанс spot", currency: "USD", amount: 1689 },
    { channel: "legacy_combined_binance_spot_funding", currency: "USDT", amount: 345 },
    { channel: "Payoneer - eur", currency: "EUR", amount: 1173 },
  ];

  const OWNER_CONFIRMED_MAY_CURRENT_BALANCE_CORRECTIONS = [
    {
      channel: "binance save",
      value: "7432",
      currency: "USD",
      usdAmount: "7432",
      note: "owner_confirmed_2026_05_28_components_usdt_5412_usdc_2020",
    },
    {
      channel: "Бинанс spot",
      value: "1162",
      currency: "USD",
      usdAmount: "1162",
      note: "owner_confirmed_2026_05_28_usdt_1162",
    },
    {
      channel: "БАНК КАНАДА cad",
      value: "10538",
      currency: "CAD",
      usdAmount: "7798",
      note: "owner_confirmed_2026_05_28_cad_10538_usd_7798",
    },
    {
      channel: "монобанк грн",
      value: "1333",
      currency: "UAH",
      usdAmount: "31.36",
      note: "owner_confirmed_2026_05_28_uah_1333_usd_31_36",
    },
    {
      channel: "Яндекс руб",
      value: null,
      currency: null,
      usdAmount: "1376",
      note: "owner_confirmed_2026_05_28_usd_1376_preserve_local_amount",
    },
  ];

  function canonicalChannel(value) {
    if (typeof globalScope.getCanonicalManualChannelKey === "function") {
      return globalScope.getCanonicalManualChannelKey(value);
    }
    return String(value || "").trim();
  }

  function parseAmount(value) {
    if (typeof globalScope.parseLooseNumber === "function") return globalScope.parseLooseNumber(value);
    const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function inferCurrency(channel) {
    if (typeof globalScope.inferManualFinanceChannelCurrency === "function") {
      return globalScope.inferManualFinanceChannelCurrency(channel);
    }
    return "USD";
  }

  function normalizedCurrency(value, channel) {
    return String(value || "").trim().toUpperCase() || inferCurrency(channel);
  }

  function isSameAmount(left, right) {
    return Math.abs(parseAmount(left) - Number(right || 0)) < 0.0001;
  }

  function isStaleMayCurrentBalanceRow(row, channel) {
    const currency = normalizedCurrency(row?.currency, channel);
    return STALE_MAY_CURRENT_BALANCE_ROWS.some((stale) => (
      canonicalChannel(stale.channel) === channel &&
      normalizedCurrency(stale.currency, channel) === currency &&
      isSameAmount(row?.amount, stale.amount)
    ));
  }

  function shouldApplyOwnerConfirmedMaySnapshot(endDate) {
    return String(endDate || "") >= OWNER_CONFIRMED_MAY_CURRENT_BALANCE_DATE;
  }

  function hasNewerConfirmedSnapshot(existing) {
    return existing?.date && String(existing.date) > OWNER_CONFIRMED_MAY_CURRENT_BALANCE_DATE;
  }

  function applyOwnerConfirmedMayCurrentBalanceCorrections(latest, endDate, diagnostics) {
    if (!shouldApplyOwnerConfirmedMaySnapshot(endDate)) return latest;

    OWNER_CONFIRMED_MAY_CURRENT_BALANCE_CORRECTIONS.forEach((correction) => {
      const channel = canonicalChannel(correction.channel);
      const existing = latest[channel] || {};
      if (hasNewerConfirmedSnapshot(existing)) return;
      latest[channel] = {
        value: correction.value === null ? (existing.value || "") : correction.value,
        date: OWNER_CONFIRMED_MAY_CURRENT_BALANCE_DATE,
        currency: correction.currency || existing.currency || inferCurrency(channel),
        rate: existing.rate || "",
        usdAmount: correction.usdAmount || existing.usdAmount || "",
        note: correction.note,
      };
      diagnostics.appliedOwnerCorrections.push({ channel, ...latest[channel] });
    });

    return latest;
  }

  function buildLatestBalanceEntriesByChannel(balanceRows, endDate) {
    const latest = {};
    const diagnostics = {
      source: "current-balance-snapshot-fix",
      snapshotDate: endDate || "",
      excludedStaleRows: [],
      appliedOwnerCorrections: [],
    };

    (balanceRows || [])
      .filter((row) => row?.date && row.date <= endDate)
      .sort((left, right) => String(left.date).localeCompare(String(right.date)))
      .forEach((row) => {
        const channel = canonicalChannel(row.channel);
        const raw = String(row.amount ?? "").trim();
        if (!channel || !raw || !parseAmount(raw)) return;
        if (shouldApplyOwnerConfirmedMaySnapshot(endDate) && isStaleMayCurrentBalanceRow(row, channel)) {
          diagnostics.excludedStaleRows.push({
            date: row.date,
            channel,
            currency: normalizedCurrency(row.currency, channel),
            amount: raw,
            source: row.source || "",
            comment: row.comment || "",
          });
          return;
        }
        latest[channel] = {
          value: raw,
          date: row.date,
          currency: normalizedCurrency(row.currency, channel),
          rate: row.rate || "",
          usdAmount: row.usdAmount || "",
        };
      });

    applyOwnerConfirmedMayCurrentBalanceCorrections(latest, endDate, diagnostics);
    globalScope.__currentBalanceSnapshotFixDiagnostics = diagnostics;
    return latest;
  }

  globalScope.buildLatestBalanceEntriesByChannel = buildLatestBalanceEntriesByChannel;
  globalScope.applyOwnerConfirmedMayCurrentBalanceCorrections = applyOwnerConfirmedMayCurrentBalanceCorrections;
})(typeof window !== "undefined" ? window : globalThis);
