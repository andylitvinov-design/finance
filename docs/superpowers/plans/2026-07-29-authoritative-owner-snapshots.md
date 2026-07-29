# Authoritative Owner Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 2026-07-01 and 2026-07-29 owner-confirmed full snapshots authoritative without deleting legacy or provider facts.

**Architecture:** Persist the compatible A:J sheet layout atomically. Column H remains source, I carries a versioned snapshot-contract status payload, and J preserves the raw owner-input reference. Runtime parses this metadata, chooses a single reliable owner-confirmed full batch for each effective date, and exposes excluded legacy/provider rows as diagnostics rather than adding them to the factual total.

**Tech Stack:** Node.js ESM, node:test, Google Sheets values API, Vercel API routes.

---

### Task 1: Define and test the authoritative snapshot contract

**Files:**
- Create: `server/authoritative-balance-snapshot-contract.js`
- Test: `tests/authoritative-balance-snapshot-contract.test.mjs`

- [ ] Write failing tests for full-batch priority, explicit zero, aggregate exclusion, totals, factual change, and legacy metadata.
- [ ] Implement status serialization/parsing and date-scoped full-batch composition.
- [ ] Run the focused contract test.

### Task 2: Preserve A:J and compose runtime facts

**Files:**
- Modify: `api/save-balance-snapshot.js`
- Modify: `server/manual-google-sheets.js`
- Modify: `server/balance-snapshot-merge.js`
- Test: `tests/save-balance-snapshot-route.test.mjs`
- Test: `tests/balance-snapshot-merge.test.mjs`

- [ ] Write failing route and merge tests for A:J atomic sorting and authoritative composition.
- [ ] Restore A:J I/O, parse contract metadata, and return excluded rows as diagnostics.
- [ ] Run focused persistence and composition tests.

### Task 3: Add a dry-run-safe owner backfill

**Files:**
- Create: `scripts/backfill-owner-confirmed-july-2026-snapshots.mjs`
- Test: `tests/backfill-owner-confirmed-july-2026-snapshots.test.mjs`

- [ ] Write failing tests for supplied totals, dry run, conflict reporting, and repeat-apply idempotency.
- [ ] Implement a script that plans first and applies only the two owner batches.
- [ ] Run its dry-run against the current repository data before any apply.

### Task 4: Surface reconciliation provenance and verify delivery

**Files:**
- Modify: `server/period-balance-reconciliation-route.js`
- Modify: `period-balance-reconciliation-ui.js` (only if the existing UI lacks an API-provided provenance field)
- Test: `tests/period-balance-reconciliation-source-priority.test.mjs`

- [ ] Add failing API tests for factual-full opening/closing provenance and the +1364.00 factual change.
- [ ] Add minimal diagnostics and UI source labels without altering amount_net or reconciliation formulas.
- [ ] Run focused tests, full node:test, build, release guard, production verification, PR checks, deploy, and live before/after evidence.
