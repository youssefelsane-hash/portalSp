# Script 1 Final Financial Proof

## Scope

This report closes Script 1 sections 58-75. It records persisted outcomes, not
only successful responses. PostgreSQL is real local TEST infrastructure;
Redis is real where a tested flow uses it. Provider HTTP calls use controlled
provider boundaries so no customer or sandbox charge is created accidentally.

Run the post-suite invariant gate with:

```bash
DATABASE_URL=postgres://... npm --workspace @baytak/migrations run check:script1
```

The gate is read-only and exits non-zero when it finds a violation.

## Final Scenarios

| Scenario | Automated evidence | Persisted proof |
| --- | --- | --- |
| A — payment timeout | `payments.provider-outcome.spec.ts`, `cash-settlement-direction.spec.ts` | Timeout remains `PROCESSING`; late success becomes `SUCCEEDED`, settles once, and a second event is ignored. |
| B — additional-work refund | `cash-settlement-direction.spec.ts`, `refund-transaction-safety.spec.ts` | Refunding only the 2,000 component leaves the base component paid and reverses only its proportional earning allocation. |
| C — earning double approve | `domestic-worker-earning-approval.spec.ts` | One approval, one double entry, one balance increase. |
| D — complaint double resolve | `complaint-decision-concurrency.spec.ts` | One terminal complaint decision and at most one compensation double entry. |
| E — referral duplicate qualification | `referral-integrity.spec.ts`, `technician-referral-financial-integrity.spec.ts` | Unique source/milestone records and one wallet or promo effect. |
| F — technician double acquisition | `matching-accept-concurrency.spec.ts` | One active assignment for one technician, enforced again by a partial unique index. |
| G — webhook crash | `webhook-amount-verification.spec.ts`, `webhook-recovery.service.spec.ts`, `cash-settlement-direction.spec.ts` | Failed/stale event stays recoverable; exhausted stale work becomes `MANUAL_REVIEW`; committed settlement checkpoints pending effects so recovery delivers them without settling twice. |
| H — wallet refund crash | `refund-transaction-safety.spec.ts` | Refund remains `PROCESSING`; it cannot appear `COMPLETED` before the wallet credit commits. |
| I — wallet adjustment retry | `wallet-manual-adjustment.spec.ts` | One source row and one double entry for a repeated idempotency key. |
| J — multiple partial refunds | `refund-transaction-safety.spec.ts`, `cash-settlement-direction.spec.ts` | Legitimate partial rows persist and never exceed the payment; concurrent refunds of different payments serialize final order aggregation without duplicate earning reversal. |

## Durable Effects

Critical truth is stored before or with its effect:

- Payments, refunds, payouts, wallet adjustments, earnings, complaint
  compensation, and referral bonuses commit source state with their local
  financial effect or retain a recoverable non-terminal state.
- Webhooks, standard referrals, and technician QR referrals have bounded
  database recovery sweeps.
- A base-order payment webhook records its post-commit effects payload and
  stage in the financial transaction. Failed delivery resumes from that stage
  without rerunning settlement, and exhausted stale claims are terminalized as
  `MANUAL_REVIEW` for operator action.
- Prepaid settlement and schedule release now have bounded database sweeps in
  addition to immediate `EventEmitter` listeners.
- Technician QR bonus, wallet double entry, and normal policy decision commit
  together. The recovery sweep also recognizes the pre-Phase-4 order-referenced
  ledger shape: it rebuilds the source without crediting twice, reverses it when
  the order is terminal/deleted, and terminalizes a malformed historical pair
  as admin-visible `manual_review` instead of retrying forever.
- Matching round jobs use stable job IDs after enqueue. If initial dispatch is
  missed, order timeout/auto-cancel preserves financial truth and refunds a
  prepaid order; complete event-to-queue outbox coverage remains Script 2.

Notifications, WebSocket updates, and derived technician statistics are best
effort. Their loss does not alter ledger, payment, assignment, or order truth.

## Audit And Security

Human-sensitive paths retain actor, resource, before/after state, reason, and
financial amount in the existing audit log: refunds, payout decisions, earning
decisions, wallet adjustments, complaint decisions, admin order decisions,
technician cancellation penalties, promotions/loyalty, and manual payment
confirmation. These mandatory rows use the same transaction manager as the
business write; audit failure rolls the operation back. Automated standard and
QR referral rewards likewise commit their system audit with their durable source
row and financial/promo effect.

Fault injection proves this contract for adjustment, compensation, payout,
standard referral, and QR referral paths: the first attempt leaves no money,
terminal source state, or audit; retry creates the business effect and exactly
one audit. Standalone best-effort audit is retained only for legacy or
non-transactional non-financial calls.

Controllers continue to enforce authentication, role, exact permission,
ownership where applicable, DTO amount validation, and existing MFA step-up
policy. No RBAC was weakened. Request IDs flow through response envelopes and
audit metadata; payment/order/provider/job IDs provide operation correlation.
No OTP, token, provider credential, `.env`, or private document is logged or
included in this change.

Expected races return existing domain conflicts. Schedule exclusion violations
are translated from PostgreSQL `23P01`; assignment races are serialized before
the unique constraint is reached. The shared error envelope and response DTOs
remain compatible with current clients, so no UX redesign is introduced.

`RefundType.FULL` is a per-row classification: the refund row must equal the
payment's original amount. A 20,000 refund after an earlier 10,000 refund on a
30,000 payment is `PARTIAL`, although it clears the balance and moves the
payment to `REFUNDED`.

## Database And Performance

Migrations were preflighted against existing TEST data. The migration runner
verifies immutable SHA-256 checksums; migrations through `0121` are recorded
with matching checksums. The final gate also applied all 121 migrations to an
empty PostgreSQL database, reran the nine Script 1 invariants there, and
verified the installed `uq_orders_one_active_per_technician` definition and
the `0121` SHA-256 checksum. Migration `0121` found zero legacy active-resource
conflicts in TEST and replaced the technician partial unique index while
preserving the old index until the stronger one existed. Locks are scoped to
order, technician, payout, wallet, or business-source rows. Refund completion
rereads aggregate payment state while holding the order lock. Recovery scans
use indexed predicates and batches of 25; there are no unbounded retries.

The post-suite invariant gate verifies:

- wallet arithmetic and non-negative reserved balances;
- cumulative refund bounds and a real effect for every completed refund;
- earning, referral, payout, and adjustment ledger linkage;
- additional-work payment attribution to a batch on the same order.

## Known Limitations

- No real Paymob/Fawry charge or refund was issued. Provider signature/parsing
  tests and local settlement use controlled provider responses.
- A provider refund stuck in `PROCESSING` still requires provider-supported
  reconciliation/manual review; the provider contract cannot safely infer an
  external refund result without a provider reference lookup.
- A complete transactional outbox for every notification and workflow event is
  intentionally deferred to Script 2. The payment-confirmation webhook effects
  covered here are durably resumable; unrelated best-effort delivery remains
  outside that checkpoint and does not mutate financial truth.
- Admin frontend dependencies are absent in this workspace, so its full Next.js
  build cannot run here. API build/typecheck and changed backend tests are the
  authoritative verification for this phase.
- Migrations `0118` and `0121` deliberately fail rather than guessing if a pre-upgrade
  production database already contains duplicate active technician assignments,
  including a job in `awaiting_quote_approval`,
  or overlapping schedule slots. TEST preflight found zero of both; production
  rollout must run the same read-only preflight and reconcile any legacy rows
  before applying the constraint.

## Completion Report

**Phase:** Cross-cutting integrity proof and durable recovery.

**Findings covered:** Script 1 sections 58-75 and scenarios A-J.

**Root cause:** Strong individual fixes lacked one repeatable invariant gate,
one end-to-end late-payment proof, and recovery for two critical in-process
listeners.

**Existing code reused:** Row locks, state machines, wallet double entry,
provider-scoped webhook claims, recovery sweep pattern, audit infrastructure,
request IDs, and migration checksum runner.

**Idempotency and recovery:** Source uniqueness plus locked rereads; bounded
PostgreSQL sweeps reconstruct missed listener work.

**Final DB state verified:** Yes, by integration assertions and the invariant
gate after fixture cleanup.

**Temporary data cleaned:** Yes.

**Final automated verification:** the exact CI-style parallel command passed
61 suites / 362 tests and exited normally. The same 61 suites / 362 tests
passed serially with `--detectOpenHandles`, with no reported handle. API build
and TypeScript passed; the shared TEST runner verified matching checksums
through `0121`; a blank database accepted all 121 migrations; and all nine
invariants passed against both databases. The reproduced CI failures combined
non-unique parallel fixtures, cleanup paths that could skip
`DataSource.destroy()`, cross-suite recurring-template sweeps, and a recovery
interval that was neither `unref()`'d nor represented by a lifecycle-safe unit
test. UUID fixtures, guarded `finally` cleanup, a PostgreSQL advisory fixture
lock, and an unreferenced async interval removed both the assertion failures
and Jest force-exit. Lint remains unavailable because no `eslint` executable is
installed in this workspace. Shared-types typecheck also passed earlier in the
gate; admin typecheck could not start meaningfully because Next/React/Radix
dependencies and declarations are absent project-wide.

**Status:** `VERIFIED DONE`, subject to the explicit external-provider and
frontend dependency limitations above.
