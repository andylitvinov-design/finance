## Production source proof

- [ ] I ran `npm run preflight:production` or explained why it was not applicable.
- [ ] I verified the live URL / endpoint / method / status when this PR touches production behavior.
- [ ] I checked whether production is serving the expected repo, branch/ref, and commit.
- [ ] I checked relevant open PRs before patching formula/UI/provider logic.

## Failing layer proof

- [ ] I proved the first failing layer before patching.
- [ ] Layer: UI / API route / provider-import / normalization / ledger-save / balance / analytics / deploy-source.
- [ ] Evidence for:
- [ ] Evidence against / needs verification:

## Safety

- [ ] No secrets/env values are added or exposed.
- [ ] Provider gross/net/fee/source semantics are unchanged unless explicitly proven as the root cause.
- [ ] Balance/amount_net semantics are unchanged unless explicitly proven as the root cause.
- [ ] Runtime fix is separated from migration/backfill.

## Checks

- [ ] `node --test tests/*.test.*`
- [ ] `npm run preflight:production`
- [ ] `bash scripts/release-guard.sh`
- [ ] `npm run build`

## Memory update

- [ ] I updated `ai-projects-brain` project memory (`DEBUG_LOG.md`, `RISKS.md`, `CHECKS.md`, `STATE.md`, or `LOG.md`) or explicitly explained why no memory update was needed.

## Live verification

- Before:
- After:
- Remaining risks:
