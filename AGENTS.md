# Active Incoming Ledger

## Status

- This is the only active EzoHata incoming-ledger implementation.
- The production source of truth is `https://github.com/andylitvinov-design/finance.git`, this repository root, on a branch based on `origin/main`.
- `https://github.com/andylitvinov-design/ezohata-incoming-ledger.git` is not the production source of truth unless an explicit migration is being performed and verified end-to-end.
- Do not use the legacy `reconcile-v2/` folder as a new source of production commits.
- Production URL: `https://ezohata-incoming-ledger.vercel.app/`

## Deployment

- Start production-facing work from `origin/main`, run `bash scripts/release-guard.sh`, then push a branch and merge through PR.
- If the current branch is not based on `origin/main`, create a fresh branch/worktree from `origin/main` and port only the needed changes.
- Vercel deploys the root app after `main` is updated. Manual production deploys must be run only from this repository root.
- Never deploy from `data/` or from a stale `reconcile-v2/` checkout.
