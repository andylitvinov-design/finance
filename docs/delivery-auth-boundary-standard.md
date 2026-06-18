# Delivery Auth Boundary Standard

Status: project-local mirror of canonical system rule  
Canonical source: `andylitvinov-design/ai-projects-brain/systems/delivery-auth-boundary-standard.md`  
Applies to: `/delivery`, `/fix-deploy`, production verification, PR final reports

## Rule

Expected Google OAuth, Supabase auth, private cabinet login, account chooser, captcha, browser-not-secure screen, or owner-only session is not by itself a delivery failure.

The delivery loop has three final states:

```txt
STATUS: SUCCESS
STATUS: SUCCESS_WITH_AUTH_LIMITATION
STATUS: BLOCKED
```

Use `STATUS: SUCCESS_WITH_AUTH_LIMITATION` when all implementation/build/PR/deploy/public/login/API checks pass and the only missing proof is authenticated post-login live verification blocked by expected Google/Supabase/private auth.

## Required safe proof for auth-gated finance views

Before using `SUCCESS_WITH_AUTH_LIMITATION`, verify:

1. release guard/checks/tests/build pass;
2. final commit is deployed;
3. public/status/API health route loads without runtime crash, where available;
4. login/auth entry point is visible, where applicable;
5. protected routes redirect to login/auth instead of crashing;
6. no pre-auth console/runtime errors show a broken app;
7. local dev/demo/mock/fixture/code-level verification covers the post-login change as much as safely possible;
8. finance invariants are preserved and covered by tests/code proof.

## Agent boundaries

Do not request user login material. Do not alter auth provider settings or production env configuration. Do not bypass the app security model. Do not retry the hosted login boundary endlessly. Do not mark delivery as `BLOCKED` only because production requires human login.

## Required final wording

```txt
AUTHENTICATED LIVE PROOF: SKIPPED_EXPECTED_AUTH_BOUNDARY
Reason: production post-login area is protected by Google/Supabase/private auth; automated agent verification must stop at the expected login boundary.
Safe proof completed: release guard/checks, deployment, public/status/API route, login entry/protected redirect where applicable, and local/demo/code verification.
Final status: STATUS: SUCCESS_WITH_AUTH_LIMITATION
```

## True BLOCKED cases

Use `STATUS: BLOCKED` for real failures: release guard/build/CI/deploy failure, public/status/API route broken, login entry broken, protected route crash, wrong deployed commit, missing permission/env, unsafe production data/security/finance semantics change, or no safe local/demo/code proof for a risky post-login change.

## Precedence

This file overrides older `/delivery` wording that says every missing authenticated live proof must become `BLOCKED`.

```txt
Expected auth boundary + safe public/login/API/local/code proof = SUCCESS_WITH_AUTH_LIMITATION.
Real app/deploy/runtime/security/data/finance failure = BLOCKED.
```
