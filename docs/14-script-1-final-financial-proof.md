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
decisions, wallet adjustments, complaint decisions, admin reassignment, and
manual payment confirmation. Automated rewards retain durable source rows and
ledger references rather than pretending to be human audit actions.

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
verifies immutable SHA-256 checksums; migrations through `0120` are recorded
with matching checksums. TEST initially carried an older checksum for `0119`;
a read-only catalog check proved its enum, columns, defaults, and check
constraint exactly matched committed `0119`, then a conditional one-row
baseline correction was applied before the runner reverified `0001`-`0120` and
applied `0120`. Locks are scoped to order, technician, payout, wallet, or
business-source rows. Refund completion rereads aggregate payment state while
holding the order lock. Recovery scans use indexed predicates and batches of
25; there are no global locks or unbounded retries.

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
- Migration `0118` deliberately fails rather than guessing if a pre-upgrade
  production database already contains duplicate active technician assignments
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

**Final automated verification:** 27 suites / 145 tests passed with
`--detectOpenHandles` and exited normally; API build/typecheck passed;
migrations `0001`-`0120` had matching checksums; and all nine post-suite
invariants passed. The reproduced Jest hang came from a legacy suite whose
failed cleanup skipped `DataSource.destroy()`; fixture isolation plus `finally`
cleanup removed the open PostgreSQL `TCPWRAP`. Lint was unavailable because no
`eslint` executable is installed in this workspace. Shared-types typecheck also
passed; admin typecheck could not start meaningfully because Next/React/Radix
dependencies and declarations are absent project-wide.

**Status:** `VERIFIED DONE`, subject to the explicit external-provider and
frontend dependency limitations above.
