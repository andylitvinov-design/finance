# Delivery Auth Boundary Standard

Status: project-local mirror of canonical system rule  
Applies to: `/delivery`, `/fix-deploy`, production verification, PR final reports  
Scope: all auth-gated apps and dashboards across projects

## Purpose

Many user projects have production areas protected by Google OAuth, Supabase auth, private cabinet login, owner-only sessions, or other human authentication boundaries.

An agent must not confuse an expected authentication boundary with a broken deployment.

## Final statuses

Delivery workflows must support three final states:

```txt
STATUS: SUCCESS
STATUS: SUCCESS_WITH_AUTH_LIMITATION
STATUS: BLOCKED
```

Use them as follows:

- `STATUS: SUCCESS` — implementation is complete, checks pass, deployment is verified, and the requested live behavior is verified in the target environment.
- `STATUS: SUCCESS_WITH_AUTH_LIMITATION` — implementation is complete, checks pass, deployment/public/auth-entry verification pass, and the only missing proof is authenticated post-login live verification blocked by an expected auth boundary.
- `STATUS: BLOCKED` — a real blocker prevents safe completion or verification: build failure, CI failure, deployment failure, runtime crash, missing permission, missing secret/env, unsafe action, no safe local/demo/code proof, or a real product/data/security risk.

## Auth boundary is not a delivery failure

Expected Google OAuth, Supabase auth, private cabinet login, account chooser, captcha, browser-not-secure screen, or owner-only session is not by itself a delivery failure.

The agent must not:

- ask the user for real Google credentials;
- ask for cookies, tokens, refresh tokens, or secrets;
- attempt to bypass OAuth/security controls;
- retry OAuth endlessly;
- mark delivery as `BLOCKED` only because production requires human login;
- write “live verification failed” when the only failure is expected authentication.

## Required verification for auth-gated production apps

When production post-login behavior cannot be checked safely, verify the strongest safe substitute:

1. Build/checks pass.
2. Deployment for the final commit is successful.
3. Public live route loads without runtime crash.
4. Login/auth entry point is visible.
5. Protected routes redirect to login/auth instead of crashing.
6. No pre-auth console/runtime errors indicate a broken app.
7. If available, local dev/demo/mock/fixture/auth simulation verifies the post-login behavior.
8. If no local/demo/mock auth exists, use code-level evidence and report the missing simulation explicitly.

If items 1–6 pass and item 7 or 8 gives reasonable safe evidence, final status may be:

```txt
STATUS: SUCCESS_WITH_AUTH_LIMITATION
```

## Final report wording

Use this exact language when appropriate:

```txt
AUTHENTICATED LIVE PROOF: SKIPPED_EXPECTED_AUTH_BOUNDARY
Reason: production post-login area is protected by Google/Supabase/private auth, and using real credentials/cookies/secrets is not allowed.
Safe proof completed: build, deployment, public route, login entry, protected-route redirect, and local/demo/code verification where available.
Final status: STATUS: SUCCESS_WITH_AUTH_LIMITATION
```

Do not say:

```txt
STATUS: BLOCKED
```

when the only blocker is expected auth.

## When auth-gated delivery is truly blocked

Use `STATUS: BLOCKED` if any of these are true:

- build/checks fail and cannot be safely fixed;
- deployment failed or deployed the wrong commit;
- public route does not load;
- login page/auth entry is broken;
- protected route crashes instead of redirecting;
- there is no safe local/demo/code-level way to verify the requested post-login behavior and the change is too risky to infer from code;
- verification requires secrets/env/credentials/cookies or destructive production access;
- the task changes finance semantics, auth/security rules, production data, billing, or secrets without explicit authorization.

## Required machine-readable fields

Where a `.delivery/status.json` schema exists, add or emulate these fields:

```json
{
  "status": "SUCCESS | SUCCESS_WITH_AUTH_LIMITATION | BLOCKED",
  "liveVerification": {
    "checked": true,
    "mode": "PUBLIC_LIVE | PREVIEW_DEPLOYMENT | LOCAL_AUTH_SIMULATION | AUTH_BOUNDARY",
    "authBoundary": "NONE | GOOGLE_OAUTH_EXPECTED | SUPABASE_AUTH_EXPECTED | PRIVATE_CABINET_EXPECTED | OWNER_SESSION_REQUIRED",
    "postLoginStatus": "VERIFIED | SKIPPED_EXPECTED_AUTH_BOUNDARY | OWNER_REQUIRED | NOT_APPLICABLE",
    "route": "...",
    "expected": "...",
    "actual": "...",
    "evidence": "..."
  }
}
```

## Precedence

This standard overrides older `/delivery` wording that says every missing authenticated live proof must become `BLOCKED`.

For auth-gated apps, the rule is:

```txt
Expected auth boundary + safe public/login/local/code proof = SUCCESS_WITH_AUTH_LIMITATION.
Real app/deploy/runtime/security/data failure = BLOCKED.
```
