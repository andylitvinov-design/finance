## Root cause / failing layer

First prove the failing layer before patching.

- [ ] Layer: UI / API route / provider-import / normalization / ledger-save / balance / analytics / deploy-source.
- [ ] Confidence: high / medium / low.
- [ ] Evidence for:
- [ ] Evidence against / needs verification:

## Production source proof

- [ ] I ran `npm run preflight:production` or explained why it was not applicable.
- [ ] I verified the live URL / endpoint / method / status when this PR touches production behavior.
- [ ] I checked whether production is serving the expected repo, branch/ref, and commit.
- [ ] I checked relevant open PRs/commits before patching formula/UI/provider logic.

## Agent Debug Bundle

- [ ] I ran one of the following, or explained the exact blocker:

```bash
npm run debug:bundle -- --period=<YYYY-MM>
npm run debug:bundle -- --from=<YYYY-MM-DD> --to=<YYYY-MM-DD>
npm run debug:bundle -- --period=<YYYY-MM> --expected-sha=<sha>
```

- Command:
- `/api/status`:
- `/api/audit-snapshot`:
- `/api/debug-ui-state`:
- Deploy/source classification:
- Warnings / needs verification:

## Safety

- [ ] No private configuration values are added or exposed.
- [ ] Provider gross/net/fee/source semantics are unchanged unless explicitly proven as the root cause.
- [ ] Balance/amount_net semantics are unchanged unless explicitly proven as the root cause.
- [ ] Runtime fix is separated from migration/backfill.
- [ ] Data migration/backfill needed: no / yes with reason.

## Checks

- [ ] `node --test tests/*.test.*`
- [ ] `npm run preflight:production`
- [ ] `bash scripts/release-guard.sh`
- [ ] `npm run build`
- [ ] `npm run verify:production -- <expected-sha>` when production verification is applicable.

## Memory update

- [ ] I updated project memory or explicitly explained why no memory update was needed.

## Live verification

- Before:
- After:
- Remaining risks:
