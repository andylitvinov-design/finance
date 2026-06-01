# Balance System Upgrade Plan

## Goal

Create one reliable balance system where automatic balances are as close as possible to real user balances, and every stale/manual/unsupported source is visible with a clear required action.

The target architecture has three separate layers:

1. **Balance facts** — verified provider/manual/screenshot balances.
2. **Daily calculated balances** — previous balance plus Ledger movements.
3. **Reconciliation** — calculated balance vs factual balance, with last fact date/source and action required.

The UI must show one canonical current balance total. Diagnostics may show alternate/local calculations, but they must be labeled and must not be used as the primary total.

---

## Current failure pattern

The app has historically mixed these paths:

- Google Sheets `Остатки` manual rows;
- auto/provider balance rows;
- selected-date snapshots;
- period balance reconciliation;
- top-card `Остатки`;
- popup `Остатки` tables;
- local UI fallback totals.

This produced different totals in different places. Recent fixes made selected-date totals and period totals match, but the architecture must be formalized so the system does not regress.

Known failure modes to prevent:

- native row exists but USD is empty, so it is silently counted as USD 0;
- Binance aggregate rows and component rows are both counted;
- top-card and popup use different totals;
- refresh button recalculates but does not actually refresh every supported provider;
- unsupported/manual channels look fresh;
- provider errors are hidden or shown as raw SyntaxError/non-JSON text.

---

## Layer 1: Balance facts

A balance fact is a verified balance from a provider, owner/manual input, or screenshot.

Each fact must include:

- `date`;
- `fetched_at` or `confirmed_at`;
- `channel`;
- `currency`;
- `native_amount`;
- `amount_usd`;
- `fx_rate`, `fx_rate_date`, `fx_rate_source`;
- `source_type`: `provider`, `manual_owner`, `screenshot`, `auto_balance`;
- `provider_status`;
- `confidence`;
- `comment`.

Facts are source-of-truth for their date/channel/currency. If the user confirms a balance manually, that owner-confirmed fact must override calculated forecasts for the same date/channel/currency.

Manual writes must use existing safe routes/helpers, not direct Google Sheets mutation.

---

## Layer 2: Daily calculated balances

A calculated balance is derived, not factual.

Formula:

```text
calculated_balance[date, channel, currency]
= previous_day_closing_balance[channel, currency]
+ sum(ledger movements for date/channel/currency)
```

Each calculated row should include:

- opening native balance;
- daily movement native;
- calculated closing native;
- opening USD;
- movement USD;
- calculated closing USD;
- movement source;
- calculation status.

If there is no fresh fact for a channel/currency, the UI may show calculated balance, but it must be marked as `calculated_only` or `stale_fact`.

---

## Layer 3: Reconciliation

Reconciliation compares calculated closing balance with factual closing balance.

Each row must show:

- calculated opening;
- movement;
- calculated closing;
- factual closing if available;
- last fact date/time;
- last fact source;
- difference;
- status;
- required action.

Statuses:

- `ok`;
- `mismatch`;
- `calculated_only`;
- `stale_fact`;
- `missing_fact`;
- `fx_missing`;
- `provider_error`;
- `manual_required`;
- `needs_permission`.

This table must make clear which balances are facts and which are only calculations from older facts.

---

## FX and USD rules

USD conversion must be consistent across selected-date snapshots, period reconciliation, top-card, and popup.

Rules:

1. Preserve trusted `amount_usd` if present.
2. For `USD`, `USDT`, `USDC`, if `amount_usd` is missing, use native amount as USD.
3. For non-USD, if `amount_usd` is missing, use the FX/rates table for that date.
4. If FX rate is missing, return `amount_usd = null` and `status = fx_missing`.
5. Never silently count a non-zero native amount as USD 0.
6. Return rate, rate date, and rate source for auditability.

Codex must identify and document the current FX source: sheet/table name, columns, helper/function, fallback behavior, and missing-rate behavior.

---

## Canonical total rules

There must be one canonical current balance total.

Priority:

1. selected-date balance snapshot canonical total, if valid;
2. period balance reconciliation total, if selected-date is unavailable;
3. `needs verification` if neither is available.

Top-card `Остатки` and popup primary `ВСЕГО USD` must use the same canonical total.

Diagnostic/local/calculated totals may remain only as diagnostics. If any diagnostic total differs from canonical total, UI must show a clear warning with the delta.

---

## Refresh-all button

Add/finalize one button in the `Остатки` popup:

```text
Обновить все остатки
```

Preferred endpoint:

```text
POST /api/refresh-all-balances
```

The endpoint must:

1. Accept selected date or period.
2. Run all implemented provider refreshes safely.
3. Pull current balances where supported.
4. Import transactions where supported.
5. Save/update provider balance facts through existing safe helpers.
6. Never write fake data for unsupported providers.
7. Run selected-date balance snapshot after refresh.
8. Run period balance reconciliation after refresh.
9. Return a structured JSON report.

One provider failure must not break the whole refresh.

If a provider returns HTML/plain text/non-JSON, wrap it into structured JSON with provider, status, error, and a safe excerpt. Do not surface raw SyntaxError to the user.

---

## Required automatic provider scope

First required automatic refresh targets:

- Wise / TransferWise;
- Binance;
- PayPal.

Also prove and report status for:

- Yandex;
- Monobank;
- Payoneer;
- Privat24;
- Revolut;
- Bank Canada;
- cash/manual/local/unknown channels.

If a provider is not implemented or cannot refresh current balances, show it as manual/stale with required action.

---

## Provider capability matrix

Backend must return a provider/channel matrix with:

- channel;
- currency;
- provider;
- supports current balance auto-refresh;
- supports transaction import;
- access/status: `available`, `missing`, `needs_permission`, `not_implemented`;
- last import date;
- last balance date;
- last factual balance date/source;
- stale flag and stale reason;
- required action;
- severity.

Manual-only, unsupported, or stale channels must never be silent.

---

## UI requirements

The `Остатки` popup must show:

- `Обновить все остатки` button;
- loading state;
- refresh report;
- provider capability matrix;
- red rows for stale/manual/error channels;
- selected-date total;
- period total;
- delta;
- `totals_match`.

Report sections:

- `Успешно обновлено`;
- `Ошибки провайдеров`;
- `Требуется ручное действие`;
- `Stale/manual channels`;
- `Итоговые суммы`.

After refresh, top-card and popup primary total must use the canonical total.

---

## Owner-confirmed snapshot flow

When the user provides manual balances:

1. Build proposed owner-confirmed snapshot payload.
2. Run dry-run first.
3. Show proposed rows and total.
4. If accepted, write through existing safe helper.
5. Mark source/comment as owner-confirmed for that date.
6. Re-run selected-date snapshot and period reconciliation.
7. Show before/after totals.

Owner-confirmed facts override calculated forecasts for the same date/channel/currency.

---

## Tests required

Add tests for:

1. provider success path;
2. one provider failure while others continue;
3. non-JSON provider error converted to structured JSON;
4. unsupported/manual channel warning;
5. Monobank `needs_permission` warning;
6. USD native fallback;
7. FX missing returns `fx_missing`, not zero;
8. selected-date total equals period total when canonical source matches;
9. top-card equals popup primary total;
10. owner-confirmed fact overrides calculated forecast;
11. daily balance calculation from previous day plus movement;
12. reconciliation shows last fact date/source and difference.

Checks:

```bash
node --test tests/balance-snapshots-api.test.mjs
node --test tests/remainders-summary-popup.test.cjs
node --test tests/period-balance-reconciliation-engine.test.mjs
node --test tests/*.test.*
bash scripts/release-guard.sh
npm run build
```

---

## Live acceptance

After deploy:

```bash
git checkout main
git pull origin main
npx vercel@latest --prod --yes
curl -sS 'https://ezohata-incoming-ledger.vercel.app/api/status?ts='$(date +%s)
npm run verify:production -- <new-main-sha>
```

Acceptance:

1. Source gate passes.
2. Button exists and calls refresh endpoint.
3. Wise, Binance, and PayPal are attempted if implemented.
4. Provider results are shown.
5. Unsupported/manual channels are red.
6. Top-card `Остатки` equals popup primary total.
7. Selected-date total equals period total, or difference is explicitly diagnosed.
8. No non-zero native row becomes USD 0.
9. No stale/manual provider is silently treated as fresh.
10. Report says what the user must still update manually.

---

## Codex output required

Codex must report:

- source gate result;
- failing layer proof;
- current button behavior proof;
- provider capability matrix;
- FX source proof;
- changed files/functions;
- tests/checks;
- live SHA before/after;
- deploy URL;
- sample refresh report;
- unsupported/manual channels;
- remaining risks;
- user manual actions still needed.
