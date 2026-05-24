# Git Worktree Merge Verification Rule

Applies to this finance repo and Codex/ChatGPT production debugging workflows.

## Rule

When a PR merge command prints a successful GitHub merge message and then prints a local worktree error, treat the GitHub merge as likely successful until remote verification proves otherwise.

Example pattern:

```text
Squashed and merged pull request
fatal: main is already used by worktree at <path>
```

This is a local worktree cleanup or branch-switch problem, not proof that the PR merge failed.

## Required handling

1. Verify remote truth before reporting failure:

```bash
gh pr view <PR_NUMBER> --json state,mergedAt,mergeCommit,url
git ls-remote origin main
```

2. If the PR is merged remotely, continue with the next separate step: deploy verification or local cleanup.

3. Do not rerun broad audits, recreate branches, or tell the user the merge failed solely because of a local worktree checkout error.

4. Avoid checking out `main` inside a feature worktree when `main` is already used by another worktree. Use:

```bash
git worktree list
```

Then operate from the existing main worktree, or use remote-only verification.

## Codex prompt requirement

Any prompt that asks Codex to merge, deploy, or verify a PR must include:

```text
After merge, if gh reports a local worktree error, verify PR merged remotely before taking action; do not assume merge or deploy failed.
```

## Reporting requirement

Report these as separate statuses:

- GitHub PR merge status
- local worktree cleanup status
- production deploy status
- live `/api/status` commit SHA
