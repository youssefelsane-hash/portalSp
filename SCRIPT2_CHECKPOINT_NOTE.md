# Script 2 Checkpoint — Active (2026-08-25)

## Latest verified work

- Completed: per-unit pricing now requires and persists an explicit quantity in preview, checkout,
  ordinary orders, and recurring templates. Existing per-unit history/templates are backfilled to
  the legacy meaning of one unit by migrations `0183` and `0184`.
- Completed: customer checkout sends hourly duration to price preview, so preview and creation use
  the same input; per-unit quantity changes refresh the displayed price automatically.
- Verified: PostgreSQL pricing/warranty/deposit matrix passed (9 integrated scenarios), catalog and
  recurring focused matrix passed (24 tests total), Jest open-handle detection passed, Flutter model
  test and analyze passed, API TypeScript and Nest build passed, migration checksums matched.
- Known tooling issue: repository API lint script currently invokes ESLint 9 without an
  `eslint.config.*` file and fails before linting any source. This predates the checkpoint; TypeScript,
  build, tests, and diff checks are green.
- Next task: continue the schedule/booking concurrency audit, then bounded technician reschedule
  requests, confirmed-order contact visibility, and global realtime message alerts.

---

# Historical Script 2 Checkpoint — RESOLVED (2026-08-17)

**Update**: the "not fully reviewed" batch described below was reviewed on
`claude/home-services-app-plan-v13gb2` after this branch merged `main` (which already contained
this note via PR #122). Full details, evidence, and two additional real bugs found/fixed during
the review (support-thread race, file-extension trust) are documented in
`docs/15-script-2-security-release-hardening.md`. This file is kept for history; treat
`docs/15-script-2-security-release-hardening.md` as the current source of truth for Script 2 status.

---

This checkpoint was created because the Codex usage limit was reached unexpectedly.

Important:
- The latest Script 2 changes are intentionally preserved.
- This latest batch was NOT fully reviewed end-to-end.
- Do NOT assume the current state is production-ready.
- Review the diff from the previous verified Script 2 commit before continuing.
- Re-run PostgreSQL/Redis integration tests, concurrency tests, migrations/checksums, build, TypeScript, and open-handle checks.
- Pay special attention to the latest Phase C/D work:
  - recurring-order occurrence claims/recovery
  - matching recovery
  - assistant-matching recovery
  - chat recovery
  - background worker invariants/timers
  - refund/reconciliation recovery
- Preserve all verified Script 1 work.
- Continue only on:
  codex/script-2-security-release-hardening
- Do not modify or merge main directly.

Status at interruption:
- Usage limit ended during active implementation.
- Some of the latest changes may be incomplete or only partially tested.
- The next agent should REVIEW FIRST, then continue from this exact branch state.
