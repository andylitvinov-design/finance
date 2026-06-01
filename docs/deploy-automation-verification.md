# Deploy automation verification

This file is a docs-only marker used to verify that the GitHub Actions production deploy workflow runs on pushes to `main`.

Current deployment model:

- Vercel Git Integration is not the source of truth for production deploys.
- `.github/workflows/deploy-production.yml` is the production deploy automation path.
- The workflow supports both `push` to `main` and manual `workflow_dispatch`.
- GitHub Actions repository secrets required by the workflow:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`

Do not store secret values in this file or anywhere in the repository.

Verification expectation:

1. Push/merge to `main` creates a new commit.
2. `Deploy Production Fallback` starts automatically.
3. The workflow prepares `.vercel/project.json` from GitHub Actions secrets without printing values.
4. Release guard, tests, build, Vercel build/deploy, and production SHA verification pass.
5. `/api/status` reports the pushed `main` commit SHA.
