# Binance wallet accounting pre-patch evidence

Date: 2026-05-20

## Production status

- `/api/status`: `status=ok`, `commitSha=6f01a22093ab41fe712fb1fb156e6dd8541f674e`, `commitRef=main`, `gitRepoSlug=andylitvinov-design/finance`, `googleSheetReadOk=true`.
- Production source matches `origin/main`; this is not a deploy/source mismatch.

## Live audit, 2026-03-10..2026-05-20

- `/api/audit-snapshot?from=2026-03-10&to=2026-05-20`: `fallback_amount_rows=0`, `unknown_source_rows=0`.
- Binance balances are only under `Бинанс spot` and `binance save`; there is no `Binance funding`.
- Binance daily rows show the 2026-05-01 `-700 USDT` and 2026-05-08 `+915.5 USDT` movements under `Бинанс spot`, even though user evidence identifies Binance Pay as Funding wallet activity.

## Live UI/debug state

- `/api/debug-ui-state?from=2026-03-10&to=2026-05-20`: Binance income appears only as `Бинанс spot` with source `binance`.
- Binance expense appears only as `Бинанс spot` with source `binance`.
- No UI/debug aggregate exposes Spot/Funding/Save wallet split.

## Recent repo evidence

- `server/binance-transactions.js` imports account, deposit, withdrawal, and Pay endpoints.
- The normalizer routes Binance Pay through `getBinanceChannel()`, which defaults non-Earn rows to `Бинанс spot`.
- `server/auto-balance-snapshots.js` expects only `Бинанс spot` and `binance save` Binance balance facts.

## Failing layer

Failing layer: `provider/import -> normalization -> balance`.

Evidence for this layer:

- Binance Pay rows are imported but normalized to Spot.
- Funding is not a canonical account/channel, so Funding wallet balances and movements cannot reconcile independently.
- Earn Subscribe/Redemption/Interest are not represented as wallet-level transfers/income.

Evidence against other layers:

- Deploy/source is current and healthy on `main`.
- UI displays the server-provided channels; it is not the root cause of Funding becoming Spot.
- `fallback_amount_rows=0`, so the problem is not gross-as-net fallback.

Confidence: high.
