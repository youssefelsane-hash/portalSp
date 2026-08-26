# Script 2 Checkpoint — Active (2026-08-26)

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
- Completed after the pricing checkpoint: precise-time assignment now rejects overlapping ranges
  under the technician lock while allowing adjacent ranges. Real PostgreSQL concurrency and guard
  tests passed (16 scenarios, open-handle detection enabled).
- Completed: bounded technician reschedule requests are durable and customer-controlled. The
  current slot remains booked until approval; approval moves the booking atomically, duplicate
  concurrent approvals execute once, and the admin setting defaults to two requests per order.
  Request/decision in-app notifications commit with the state. Migration `0185` and every previous
  checksum passed; the focused real PostgreSQL suite passed 12/12 with open-handle detection.
- Completed: both Flutter apps now consume the durable reschedule workflow. The technician selects
  one of their available future slots and supplies a reason; the current appointment stays visible
  while awaiting a decision. The customer sees a prominent approve/keep-current card in order
  details. Focused model tests passed in both apps and changed-file analysis has no errors/warnings
  (only pre-existing informational deprecations elsewhere in the same large screens).
- Completed: mutual contact visibility now uses one shared confirmed-order status invariant. The
  technician receives customer name/phone only after acceptance and only after order ownership or
  team-membership authorization; offer/pre-acceptance payloads do not query or expose it. API build,
  focused Jest with open-handle detection, and changed-file Dart analysis passed.
- Completed: customer/technician order chat, admin/customer support replies, and admin/technician
  internal chat now persist the recipient's in-app notification atomically with each message. API
  build and both real PostgreSQL suites passed (8 scenarios) with open-handle detection.
- Integrated: `origin/main` at `c90b793`, including day-based rescheduling and the expanded
  technician job brief. Duplicate customer contact fields/UI introduced by the parallel phone
  implementations were removed; one shared visibility policy and one job-summary card remain.
  Both reschedule models are preserved: direct day/slot changes and customer-approved technician
  slot proposals use a consistent order-then-slot lock order. API build, 23 merged Jest/PostgreSQL
  scenarios with open-handle detection, Flutter model test, and focused Dart analysis passed.
- Completed: both mobile apps now show a lifecycle-aware floating unread alert on every
  authenticated screen. Push remains instant; a five-second foreground poll provides a durable
  fallback. Notification taps now open customer order/support chat, technician order chat, or the
  exact technician/admin internal thread. Customer Flutter tests passed 13/13, technician tests
  passed 10/10, and focused Dart analysis reported no issues in either app.
- Completed: admin-managed rotating homepage hero images (`homepage.hero_images`, migration
  `0186`) now drive customer mobile and web from one public source, with safe URL filtering, a
  four-image cap, animated indicators, and backward-compatible branding/gradient fallbacks. All
  migration checksums matched; API test/build, admin and web typechecks, Dart analysis, and customer
  Flutter tests (13/13) passed.
- Integrated: latest `origin/main` at `2c2c988` by fast-forward. This includes migrations
  `0187`-`0189`, near-term dispatch, viewed-order tracking, and the project milestone/comment flow.
  Migration `0189_project_comments.sql` was missing from the shared local TEST database and caused
  both admin and customer project-room routes to return 500; all migrations now apply with matching
  checksums, and the real PostgreSQL project flow passes 17/17.
- Completed: warranty-claim admin responses now use the documented snake_case contract, short
  customer claim descriptions show an actionable inline validation message, and warranty revisits
  no longer incorrectly require the original service's commercial scheduling fields. Eligible
  technician results are deduplicated at the shared API source before reaching admin/customer UIs.
  Focused Jest/PostgreSQL tests pass 7/7 with open-handle detection, API build and admin typecheck
  pass, and the focused Flutter test/analyze pass with no issues.
- Completed: the project room is now connected end to end. Admins can link same-customer orders,
  issue an active warranty plan, and post customer-visible or internal updates; customers can read
  and send general project updates and retry a failed room load. Project creation now sends a stable
  idempotency key, so a lost response or simultaneous double submit returns the same project rather
  than creating a duplicate. Migration `0190` adds the scoped uniqueness invariant. Comment, order
  link, and project-warranty writes are atomic with their audit records. The real PostgreSQL project
  suite passes 18/18, including concurrency and injected audit failures, with open-handle detection;
  API build, admin typecheck, four focused Flutter tests, Dart analysis, and migration checksums pass.
- Completed: registered companies now participate explicitly in large-team auto-matching. Migration
  `0191` adds admin-controlled crew threshold (4) and modest rank boost (3). The boost requires a
  TEAM order, a commercial registration, and enough currently eligible company staff; small jobs,
  independent bookings, informal teams, and understaffed companies receive zero adjustment. One
  representative per prioritized company enters a dispatch batch. Admin candidate lists now use a
  real technician profile ID and display its company instead of passing a company UUID to technician
  explain/reassign routes. The company admin pages now visually distinguish registered companies
  from professional teams with a premium workspace. Real PostgreSQL matching tests pass 36/36 and
  focused company/admin marketplace regressions pass 8/8 with open-handle detection; API build,
  shared-types build/typecheck, and admin typecheck pass.
- Integrated: latest verified `origin/main` at `504aa5d`. The running TEST database was missing
  migrations `0194`-`0196`; this made TypeORM select absent technician trust columns and new
  earnings/debt tables, producing HTTP 500 responses across admin technicians, companies, academy,
  matching, and technician payouts. All migrations through `0196` now
  apply with matching checksums. Focused real PostgreSQL coverage for company/trust presentation,
  support chat delivery, matching, monthly statements, and debt settlement passes 26/26 with open
  handle detection.
- Completed: customer mobile hero images now remain mounted and decoded together, then cross-fade
  opacity instead of replacing `DecorationImage`; the blue gradient no longer flashes between
  admin-configured slides and failed images fall back safely. Technician payout UI now identifies a
  negative wallet as platform debt, disables payout requests until covered, and rejects amounts
  above the available balance before network submission. Focused Flutter tests pass 10/10 across
  hero, overflow, payout, and financial breakdown scenarios; changed-file analysis reports no
  issues in both apps.
- Completed: the admin warranty-claims queue now returns and displays the customer's name and
  phone, warranty name, linked order/project references, and the complete defect description
  instead of an eight-character customer ID and truncated text. The enriched snake_case contract
  is covered by the real PostgreSQL ownership/concurrency/state-machine suite (4/4) with open-handle
  detection; API build and admin typecheck pass.
- Completed: project and warranty admin pages now have permission-scoped realtime topics. Customer
  project creation, quote decisions, milestone decisions/comments, and warranty-claim opening emit
  only after their transaction succeeds; admin project/claim changes do the same. The open admin
  list and expanded project room refetch their REST source of truth immediately without a manual
  refresh. Gateway plus real PostgreSQL project/warranty suites pass 25/25 with open-handle
  detection; API build and admin typecheck pass.
- Completed: media URLs stored by an older local API address are now portable. Absolute `/uploads/`
  links are rebased to the currently configured API origin in admin, customer, and technician apps,
  while genuine external CDN/S3 URLs remain unchanged. Chat images, complaint attachments,
  technician onboarding documents, and before/after order photos therefore survive a local IP or
  deployment-origin change. Focused admin and Flutter URL tests pass 8/8; admin typecheck and
  changed-file analysis for both mobile apps pass with no issues.
- Completed: technician order acceptance now returns the same complete financial/customer/service
  projection as the canonical detail route. The mobile app no longer falls back to a false zero
  earning immediately after accepting either a normal order or a work opportunity. Opportunity
  cards and push notifications now show the order's real scheduled day/date instead of claiming
  every offer is today. Focused API tests pass 8/8, the real PostgreSQL opportunity suite passes
  10/10 with open-handle detection, Flutter tests pass 7/7, changed-file analysis and the API build
  pass, and a real Nest startup completed without dependency-injection errors.
- Next task: make the customer homepage search compact and focus-expandable with admin-controlled
  explanatory copy, then add durable customer/technician notifications for project and admin
  workflow actions.

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
