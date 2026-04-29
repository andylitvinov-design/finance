# STATE

## Repository

- Canonical repo: `https://github.com/andylitvinov-design/finance`
- Deprecated read-only repo: `https://github.com/andylitvinov-design/ezohata-incoming-ledger`
- Production URL: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)
- App shape: static HTML/CSS/JS frontend in repo root + Vercel `api/` functions

## Current status

- Root repo is the only canonical source for production changes.
- `reconcile-v2/` is legacy audit material and must not be restored as a second source tree.
- Minimal npm wrapper now owns local validation:
  - `npm install`
  - `npm test`
  - `npm run build`
  - `npm run release-guard`

## Deploy expectations

- Preview and production deploys must come only from `andylitvinov-design/finance`.
- Canonical Vercel project is `finance`; production alias remains `ezohata-incoming-ledger.vercel.app`.
- Vercel env transfer must cover `.env.example`.
- Old repo should remain deprecated read-only reference only.

## Current audit focus

- PayPal and Wise statement fetch paths
- analytics and fact range aggregation
- orders totals and balance calculations
- release guard and git remote safety
